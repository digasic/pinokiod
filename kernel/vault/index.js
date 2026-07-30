const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { Worker } = require("worker_threads")
const Registry = require("./registry")
const Sweeper = require("./sweeper")
const { fileSnapshot, sameSnapshot, sameContentState } = require("./snapshot")
const {
  SIZE_THRESHOLD,
  CANDIDATE_SIZE_OPTIONS,
  TMP_SUFFIX,
  SHA256_RE,
  DIR_CONCURRENCY,
  STAT_CONCURRENCY,
  HASH_INACTIVITY_MS
} = require("./constants")

const NO_LINK_CODES = new Set([
  "EXDEV", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EACCES"
])
const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES"])
const STATUS_PAGE_SIZE = 500
const MAX_BULK_FILE_ACTIONS = 500
const STATUS_VIEWS = new Set([
  "all", "duplicates", "shared", "tracked", "reclaimable", "activity"
])
const STATUS_FILTERS = new Set([
  "all", "duplicate", "shared", "tracked"
])

const isMissingError = (error) => !!(error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR"))

const lstatIfPresent = async (filePath) => {
  try {
    return await fs.promises.lstat(filePath)
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

const sameIdentity = (left, right) => !!(
  left && right && left.dev === right.dev && left.ino === right.ino
)

const unlinkIfSame = async (filePath, expected) => {
  if (!expected) return false
  const current = await lstatIfPresent(filePath)
  if (!sameIdentity(current, expected)) return false
  try {
    await fs.promises.unlink(filePath)
    return true
  } catch (error) {
    if (isMissingError(error)) return false
    throw error
  }
}

const unsafeStoragePath = (filePath) => {
  const error = new Error(`Storage path is not a real directory: ${filePath}`)
  error.code = "EVAULTPATH"
  return error
}

const isPathWithin = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  )
}

const samePath = (left, right) => {
  const first = path.resolve(left)
  const second = path.resolve(right)
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second
}

const sameFileMetadata = (left, right) => {
  if (!left || !right) return false
  if ((left.mode & 0o7777) !== (right.mode & 0o7777)) return false
  if (left.uid !== undefined && right.uid !== undefined &&
      left.uid !== right.uid) return false
  if (left.gid !== undefined && right.gid !== undefined &&
      left.gid !== right.gid) return false
  return true
}

const sourceId = (kind, name) => `${kind}:${encodeURIComponent(name)}`
const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}
const rowSnapshot = (row) => ({
  size: row.size,
  mtime: row.mtime,
  ctime: row.ctime,
  dev: row.dev,
  ino: row.ino
})

class Vault {
  constructor(kernel) {
    this.kernel = kernel
    this.enabled = false
    this.initialized = false
    this.mode = null
    this.volumeModes = new Map()
    this.registry = null
    this.sweeper = null
    this.worker = null
    this.workerJobs = new Map()
    this.workerSeq = 0
    this.workerIdleTimer = null
    this.workerIdleMs = 750
    this.hashInactivityMs = HASH_INACTIVITY_MS
    this.statConcurrency = STAT_CONCURRENCY
    this.dirConcurrency = DIR_CONCURRENCY
    this.sizeThreshold = SIZE_THRESHOLD
    this._sources = []
    this._sourcesById = new Map()
    this._sourceBases = new Map()
    this.operationTail = Promise.resolve()
    this.initializationPromise = null
    this.scanPromise = null
    this.scanError = null
    this.scanScopeId = null
    this.scanCancelRequested = false
    this.lastScanCache = new Map()
    this.fileActionProgress = null
    this.fileActionCancelRequested = false
  }

  get root() {
    return path.resolve(this.kernel.homedir, "vault")
  }

  get blobRoot() {
    return path.resolve(this.root, "sha256")
  }

  storePathFor(hash) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new TypeError("Invalid vault content identifier.")
    }
    return path.resolve(this.blobRoot, hash.slice(0, 2), hash)
  }

  async directoryIfSafe(directory) {
    const stat = await lstatIfPresent(directory)
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw unsafeStoragePath(directory)
    }
    return stat
  }

  async ensureDirectory(directory) {
    let stat = await this.directoryIfSafe(directory)
    if (stat) return stat
    try {
      await fs.promises.mkdir(directory, { mode: 0o700 })
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error
    }
    stat = await this.directoryIfSafe(directory)
    if (!stat) throw unsafeStoragePath(directory)
    return stat
  }

  async storeStatIfPresent(storePath, options = {}) {
    if (!isPathWithin(this.blobRoot, storePath)) {
      throw unsafeStoragePath(storePath)
    }
    if (!await this.directoryIfSafe(this.root) ||
        !await this.directoryIfSafe(this.blobRoot)) {
      throw unsafeStoragePath(this.blobRoot)
    }
    const shard = path.dirname(storePath)
    let shardStat = await this.directoryIfSafe(shard)
    if (!shardStat && options.createParent) {
      shardStat = await this.ensureDirectory(shard)
    }
    if (!shardStat) return null
    const stat = await lstatIfPresent(storePath)
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
      throw unsafeStoragePath(storePath)
    }
    return stat
  }

  runExclusive(operation) {
    const pending = this.operationTail.then(operation, operation)
    this.operationTail = pending.catch(() => {})
    return pending
  }

  runMutation(operation) {
    return this.runExclusive(operation)
  }

  async runFileAction(progress, operation) {
    this.fileActionCancelRequested = false
    this.fileActionProgress = progress
    try {
      return await operation(progress)
    } finally {
      if (this.fileActionProgress === progress) {
        this.fileActionProgress = null
      }
      this.fileActionCancelRequested = false
    }
  }

  cancelFileAction() {
    if (!this.fileActionProgress ||
        !this.fileActionProgress.cancelable) {
      return { cancel_requested: false }
    }
    this.fileActionCancelRequested = true
    this.fileActionProgress.cancel_requested = true
    return { cancel_requested: true }
  }

  async isEnabled() {
    let value = process.env.PINOKIO_VAULT
    if (value === undefined && this.kernel.homedir) {
      try {
        const raw = await fs.promises.readFile(
          path.resolve(this.kernel.homedir, "ENVIRONMENT"), "utf8")
        for (const line of raw.split("\n")) {
          const match = line.match(/^\s*PINOKIO_VAULT\s*=\s*(.*)\s*$/)
          if (match) value = match[1].trim()
        }
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
    }
    return String(value).toLowerCase() !== "false"
  }

  async init(options = {}) {
    this.enabled = await this.isEnabled()
    if (!this.enabled) return { enabled: false }
    if (options.deferStorage) return { enabled: true }
    return this.initializeStorage()
  }

  async initializeStorage() {
    if (this.initialized) return { enabled: true, mode: this.mode }
    await this.ensureDirectory(this.root)
    await this.ensureDirectory(this.blobRoot)
    this.registry = new Registry(this.root)
    await this.registry.load()
    this.mode = await this.probe(this.root)
    await this.refreshSources()
    this.sweeper = new Sweeper(this)
    this.initialized = true
    return { enabled: true, mode: this.mode }
  }

  async ensureInitialized() {
    if (!this.enabled) return { enabled: false }
    if (this.initialized) return { enabled: true, mode: this.mode }
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeStorage().finally(() => {
        this.initializationPromise = null
      })
    }
    return this.initializationPromise
  }

  async openWorkspace() {
    if (!this.initialized) return this.ensureInitialized()
    await this.refreshSources()
    return { enabled: true, mode: this.mode }
  }

  async probe(directory) {
    const dev = (await fs.promises.stat(directory)).dev
    if (this.volumeModes.has(dev)) return this.volumeModes.get(dev)
    const first = path.resolve(
      directory, `.pinokio-probe-${crypto.randomBytes(6).toString("hex")}`)
    const second = `${first}-link`
    let mode = "copy"
    let firstStat = null
    let secondStat = null
    let failure = null
    try {
      await fs.promises.writeFile(first, "probe", { flag: "wx" })
      firstStat = await fs.promises.lstat(first)
      await fs.promises.link(first, second)
      secondStat = await fs.promises.lstat(second)
      if (sameIdentity(firstStat, secondStat) && secondStat.nlink === 2) {
        mode = "link"
      }
    } catch (error) {
      if (!NO_LINK_CODES.has(error && error.code)) failure = error
    } finally {
      try {
        await unlinkIfSame(second, secondStat)
        await unlinkIfSame(first, firstStat)
      } catch (error) {
        if (!failure) failure = error
      }
    }
    if (failure) throw failure
    this.volumeModes.set(dev, mode)
    return mode
  }

  failHashWorker(worker, error, terminate = false) {
    if (this.worker === worker) {
      if (this.workerIdleTimer) clearTimeout(this.workerIdleTimer)
      this.workerIdleTimer = null
      this.worker = null
    }
    for (const [id, job] of [...this.workerJobs]) {
      if (job.worker !== worker) continue
      clearTimeout(job.inactivityTimer)
      this.workerJobs.delete(id)
      job.reject(error)
    }
    if (terminate) worker.terminate().catch(() => {})
  }

  async hashFile(filePath, options = {}) {
    if (this.workerIdleTimer) {
      clearTimeout(this.workerIdleTimer)
      this.workerIdleTimer = null
    }
    if (!this.worker) {
      const worker = new Worker(path.resolve(__dirname, "hash_worker.js"))
      this.worker = worker
      worker.unref()
      worker.on("message", ({
        id, hash, size, bytes_read: bytesRead, error, code
      }) => {
        const job = this.workerJobs.get(id)
        if (!job || job.worker !== worker) return
        if (Number.isFinite(bytesRead)) {
          job.resetInactivity()
          job.reportProgress(bytesRead)
          return
        }
        clearTimeout(job.inactivityTimer)
        this.workerJobs.delete(id)
        if (error) {
          const failure = new Error(error)
          if (code) failure.code = code
          job.reject(failure)
        } else {
          job.reportProgress(size)
          job.resolve({ hash, size })
        }
        if (this.workerJobs.size === 0 && this.worker === worker) {
          this.workerIdleTimer = setTimeout(() => {
            this.workerIdleTimer = null
            if (this.workerJobs.size === 0 && this.worker === worker) {
              this.worker = null
              worker.terminate().catch(() => {})
            }
          }, this.workerIdleMs)
          if (this.workerIdleTimer.unref) this.workerIdleTimer.unref()
        }
      })
      worker.on("error", (error) => {
        if (this.worker !== worker) return
        const failure = new Error(error && error.message
          ? error.message
          : "Hash worker failed.")
        failure.code = "EVAULTHASHWORKER"
        this.failHashWorker(worker, failure)
      })
      worker.on("exit", (code) => {
        if (this.worker === worker) {
          const failure = new Error(`hash worker exited with code ${code}`)
          failure.code = "EVAULTHASHWORKER"
          this.failHashWorker(worker, failure)
        }
      })
    }
    const worker = this.worker
    const id = ++this.workerSeq
    return new Promise((resolve, reject) => {
      const onProgress = typeof options.onProgress === "function"
        ? options.onProgress
        : null
      const job = {
        worker,
        resolve,
        reject,
        reportProgress: (bytes) => {
          if (!onProgress) return
          try {
            onProgress(bytes)
          } catch (error) {}
        },
        inactivityTimer: null,
        resetInactivity: null
      }
      job.resetInactivity = () => {
        clearTimeout(job.inactivityTimer)
        const timeout = Math.max(
          1, Number(this.hashInactivityMs) || HASH_INACTIVITY_MS)
        job.inactivityTimer = setTimeout(() => {
          const failure = new Error(
            `Timed out while reading ${path.basename(filePath)}`)
          failure.code = "ETIMEDOUT"
          this.failHashWorker(worker, failure, true)
        }, timeout)
        if (job.inactivityTimer.unref) job.inactivityTimer.unref()
      }
      this.workerJobs.set(id, job)
      job.resetInactivity()
      try {
        worker.postMessage({ id, filePath })
      } catch (error) {
        const failure = new Error(error && error.message
          ? error.message
          : "Hash worker could not accept work.")
        failure.code = "EVAULTHASHWORKER"
        this.failHashWorker(worker, failure, true)
      }
    })
  }

  async refreshSources() {
    const home = path.resolve(this.kernel.homedir)
    const apiRoot = path.resolve(home, "api")
    const sources = [
      {
        id: "pinokio", kind: "pinokio", label: "Pinokio",
        root: home, parent_id: null
      },
      {
        id: "apps", kind: "virtual", label: "Apps",
        root: apiRoot, parent_id: "pinokio"
      },
      {
        id: "external", kind: "virtual", label: "External folders",
        root: null, parent_id: null
      }
    ]
    let storeDev = null
    try {
      storeDev = (await fs.promises.stat(this.root)).dev
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    const decorate = async (source) => {
      if (!source.root) return source
      try {
        const [stat, realRoot] = await Promise.all([
          fs.promises.lstat(source.root),
          fs.promises.realpath(source.root)
        ])
        source.dev = stat.dev
        source.available = stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          (source.kind !== "external" || samePath(realRoot, source.root))
        source.shareable = source.available &&
          storeDev !== null &&
          stat.dev === storeDev &&
          this.mode === "link"
      } catch (error) {
        if (!isMissingError(error)) throw error
        source.available = false
        source.shareable = false
      }
      return source
    }

    let apps = []
    try {
      apps = await fs.promises.readdir(apiRoot, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    for (const entry of apps) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      sources.push(await decorate({
        id: sourceId("app", entry.name),
        kind: "app",
        label: entry.name,
        app: entry.name,
        root: path.resolve(apiRoot, entry.name),
        parent_id: "apps"
      }))
    }

    for (const configuredPath of await this.registry.externalSources()) {
      sources.push(await decorate({
        id: sourceId("external", configuredPath),
        kind: "external",
        label: path.basename(configuredPath) || configuredPath,
        root: configuredPath,
        parent_id: "external",
        configured: true
      }))
    }

    let homeEntries = []
    try {
      homeEntries = await fs.promises.readdir(home, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    for (const entry of homeEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() ||
          entry.name === "api" || entry.name === "vault") continue
      sources.push(await decorate({
        id: sourceId("folder", entry.name),
        kind: "folder",
        label: entry.name,
        root: path.resolve(home, entry.name),
        parent_id: "pinokio"
      }))
    }

    const pinokio = sources.find((source) => source.id === "pinokio")
    if (pinokio) await decorate(pinokio)
    this._sources = sources
    this._sourcesById = new Map(
      sources.map((source) => [source.id, source])
    )
    this._sourceBases = new Map()
    for (const source of sources) {
      if (!source.root || source.kind === "virtual") continue
      const resolved = path.resolve(source.root)
      const key = process.platform === "win32"
        ? resolved.toLowerCase()
        : resolved
      if (!this._sourceBases.has(key)) this._sourceBases.set(key, [])
      this._sourceBases.get(key).push(source)
    }
    return sources
  }

  sources() {
    return this._sources
  }

  sourceForPath(filePath, preferredId = null) {
    let cursor = path.resolve(filePath)
    while (true) {
      const key = process.platform === "win32"
        ? cursor.toLowerCase()
        : cursor
      const matches = this._sourceBases.get(key)
      if (matches && matches.length) {
        return matches.find((source) => source.id === preferredId) || matches[0]
      }
      const parent = path.dirname(cursor)
      if (parent === cursor) return null
      cursor = parent
    }
  }

  sourceIsWithinScope(source, scopeId) {
    if (!scopeId) return true
    const seen = new Set()
    let current = source
    while (current && !seen.has(current.id)) {
      if (current.id === scopeId) return true
      seen.add(current.id)
      current = this._sourcesById.get(current.parent_id)
    }
    return false
  }

  scanSource(scopeId) {
    if (!scopeId) return null
    const source = this._sourcesById.get(scopeId)
    return source &&
      source.kind !== "virtual" &&
      source.available &&
      source.root
      ? source
      : null
  }

  scanRoots(scopeId = null) {
    if (scopeId) {
      const source = this.scanSource(scopeId)
      return source
        ? [{ root: path.resolve(source.root), source_id: source.id }]
        : []
    }
    const home = path.resolve(this.kernel.homedir)
    const candidates = [{ root: home, source_id: "pinokio" }]
    const external = this._sources
      .filter((source) =>
        source.kind === "external" && source.available && source.root)
      .sort((left, right) =>
        path.resolve(left.root).length - path.resolve(right.root).length)
    for (const source of external) {
      const canonical = path.resolve(source.root)
      if (candidates.some((candidate) =>
        isPathWithin(candidate.root, canonical))) continue
      candidates.push({ root: canonical, source_id: source.id })
    }
    return candidates
  }

  scopeSourceIds(scopeId = null, locationId = null) {
    return this._sources
      .filter((source) => source.kind !== "virtual")
      .filter((source) => !scopeId || this.sourceIsWithinScope(source, scopeId))
      .filter((source) =>
        !locationId || this.sourceIsWithinScope(source, locationId))
      .map((source) => source.id)
  }

  async canonicalPathIsWithinSource(filePath, source) {
    if (!source || !source.root) return false
    try {
      const rootStat = await fs.promises.lstat(source.root)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false
      const [root, target] = await Promise.all([
        fs.promises.realpath(source.root),
        fs.promises.realpath(filePath)
      ])
      if (source.kind === "external" && !samePath(root, source.root)) {
        return false
      }
      return isPathWithin(root, target)
    } catch (error) {
      if (!isMissingError(error)) throw error
      return false
    }
  }

  locationForPath(filePath, preferredId = null) {
    const source = this.sourceForPath(filePath, preferredId)
    if (!source) {
      return {
        source_id: null,
        relative_path: path.basename(filePath)
      }
    }
    const relative = path.relative(source.root, path.resolve(filePath))
      .split(path.sep).join("/") || path.basename(filePath)
    return {
      source_id: source.id,
      source_kind: source.kind,
      source_label: source.label,
      relative_path: relative
    }
  }

  async addExternalSource(folderPath) {
    if (typeof folderPath !== "string" ||
        !path.isAbsolute(folderPath.trim())) {
      throw new Error("Choose a valid folder.")
    }
    const canonical = path.resolve(
      await fs.promises.realpath(folderPath.trim()))
    const stat = await fs.promises.stat(canonical)
    if (!stat.isDirectory()) throw new Error("Choose a folder, not a file.")

    const home = path.resolve(await fs.promises.realpath(this.kernel.homedir))
    if (isPathWithin(home, canonical) || isPathWithin(canonical, home)) {
      throw new Error(
        "That folder is already inside Pinokio and is included in scans.")
    }
    await this.refreshSources()
    const existing = this._sources.find((source) =>
      source.kind === "external" &&
      source.root &&
      samePath(source.root, canonical))
    if (existing) return { created: false, source: existing }

    await this.registry.addExternalSource(canonical)
    await this.refreshSources()
    const source = this._sources.find((candidate) =>
      candidate.kind === "external" &&
      samePath(candidate.root, canonical))
    return { created: true, source }
  }

  async removeExternalSource(sourceIdToRemove) {
    await this.refreshSources()
    const source = this._sources.find((candidate) =>
      candidate.id === sourceIdToRemove &&
      candidate.kind === "external" &&
      candidate.configured)
    if (!source) {
      return { error: "That external folder is no longer configured." }
    }
    await this.registry.removeExternalSourceState(source.root, source.id)
    await this.refreshSources()
    return {
      removed: true,
      source_id: source.id,
      label: source.label
    }
  }

  async recordEvent(event) {
    try {
      await this.registry.addEvent(event)
      return true
    } catch (error) {
      return false
    }
  }

  startScan(scopeId = null, sizeThreshold = this.sizeThreshold) {
    if (!this.enabled || !this.sweeper) {
      return { started: false, disabled: true }
    }
    if (this.scanPromise) return { started: false, already_running: true }
    this.sizeThreshold = sizeThreshold
    this.scanError = null
    this.scanScopeId = scopeId
    this.scanCancelRequested = false
    this.scanPromise = this.runExclusive(() => {
      if (this.scanCancelRequested) {
        this.sweeper.state = Object.assign(this.sweeper.idleState(), {
          phase: "cancelled",
          scope_id: scopeId
        })
        return { cancelled: true }
      }
      return this.sweeper.scan(scopeId)
    }).catch((error) => {
      this.scanError = error && error.message
        ? error.message
        : String(error)
    }).finally(() => {
      this.scanPromise = null
      this.scanScopeId = null
      this.scanCancelRequested = false
    })
    return { started: true }
  }

  cancelScan() {
    if (!this.scanPromise || !this.sweeper) {
      return { cancel_requested: false }
    }
    this.scanCancelRequested = true
    if (this.sweeper.state.active && this.sweeper.currentHash &&
        this.worker) {
      const error = new Error("Scan cancelled.")
      error.code = "EVAULTCANCELLED"
      this.failHashWorker(this.worker, error, true)
    }
    return {
      cancel_requested: this.sweeper.state.active
        ? this.sweeper.cancel()
        : true
    }
  }

  async perform(action, payload = {}) {
    if (!this.enabled) return { error: "Save space is disabled." }
    await this.ensureInitialized()
    switch (action) {
      case "add_source": {
        const result = await this.runExclusive(() =>
          this.addExternalSource(payload.path))
        return {
          created: result.created,
          source: {
            id: result.source.id,
            label: result.source.label,
            target_path: result.source.root,
            shareable: !!result.source.shareable
          }
        }
      }
      case "remove_source":
        if (typeof payload.source_id !== "string" || !payload.source_id) {
          return { error: "Choose an external folder to remove." }
        }
        return this.runMutation(() =>
          this.removeExternalSource(payload.source_id))
      case "scan": {
        if (payload.scope_id && !this.scanSource(payload.scope_id)) {
          return { error: "That scan location is no longer available." }
        }
        let threshold = this.sizeThreshold
        if (payload.candidate_size != null) {
          if (!CANDIDATE_SIZE_OPTIONS.includes(payload.candidate_size)) {
            return { error: "Choose a valid minimum file size." }
          }
          threshold = payload.candidate_size
        }
        return this.startScan(payload.scope_id || null, threshold)
      }
      case "cancel_scan":
        return this.cancelScan()
      case "cancel_file_action":
        return this.cancelFileAction()
      case "deduplicate": {
        const scopeId = typeof payload.scope_id === "string" &&
          payload.scope_id
          ? payload.scope_id
          : null
        if (scopeId && !this._sources.some((source) =>
          source.id === scopeId)) {
          return { error: "That location is no longer available." }
        }
        if (typeof payload.path === "string" && payload.path) {
          return this.runMutation(() => this.runFileAction({
            kind: "deduplicate-file",
            path: path.resolve(payload.path)
          }, () => this.deduplicateFile(payload.path)))
        }
        const filesTotal = await this.countActionFiles("duplicate", scopeId)
        return this.runMutation(() => this.runFileAction({
          kind: "deduplicate",
          scope_id: scopeId,
          files_total: filesTotal,
          files_completed: 0
        }, (progress) => this.deduplicateScope(scopeId, { progress })))
      }
      case "detach":
        if (typeof payload.path !== "string" || !payload.path) {
          return { status: "not-found" }
        }
        return this.runMutation(() => this.runFileAction({
          kind: "make-separate",
          path: path.resolve(payload.path)
        }, () => this.separate(payload.path)))
      case "separate_files": {
        if (!Array.isArray(payload.paths) ||
            payload.paths.length === 0 ||
            payload.paths.length > MAX_BULK_FILE_ACTIONS ||
            payload.paths.some((item) =>
              typeof item !== "string" || !item)) {
          return { error: "Choose valid deduplicated files to separate." }
        }
        return this.runMutation(() => this.runFileAction({
          kind: "separate-files",
          files_total: new Set(payload.paths.map((item) =>
            path.resolve(item))).size,
          files_completed: 0
        }, (progress) => this.separateFiles(payload.paths, progress)))
      }
      case "separate_all": {
        const selection = this.separateSelection(payload)
        if (selection.error) return { error: selection.error }
        const total = await this.registry.matchingFileSummary(
          "linked", selection.sourceIds, selection.query)
        if (!total.count) {
          return { error: "No matching deduplicated files remain." }
        }
        return this.runMutation(() => this.runFileAction({
          kind: "separate-files",
          files_total: total.count,
          files_completed: 0,
          all_matching: true,
          cancelable: true,
          cancel_requested: false
        }, (progress) =>
          this.separateMatchingFiles(selection, progress)))
      }
      case "reclaim":
        return this.runMutation(() => this.reclaim(payload.hash))
      case "reclaim_all":
        return this.runMutation(() => this.reclaimAll())
      default:
        return { error: "unknown action" }
    }
  }

  sourceAppIsRunning(source) {
    if (!source || source.kind !== "app") return false
    const appRoot = path.resolve(this.kernel.homedir, "api", source.app)
    const api = this.kernel.api || {}
    const running = api.running || {}
    const runningPaths = api.running_paths || {}
    return Object.keys(running).some((id) => {
      if (!running[id]) return false
      const runningPath = runningPaths[id] ||
        (path.isAbsolute(id) ? id.split("?")[0] : null)
      return !!(runningPath && isPathWithin(appRoot, runningPath))
    })
  }

  async refreshInodeSnapshots(hash, dev, ino) {
    const storePath = this.storePathFor(hash)
    const storeStat = await this.storeStatIfPresent(storePath)
    let inodeStat = storeStat &&
      storeStat.dev === dev &&
      storeStat.ino === ino
      ? storeStat
      : null
    if (!inodeStat) {
      const row = await this.registry.firstFileForInode(hash, dev, ino)
      if (row) {
        try {
          const stat = await fs.promises.lstat(row.path)
          if (stat.isFile() && stat.dev === dev && stat.ino === ino) {
            inodeStat = stat
          }
        } catch (error) {}
      }
    }
    if (inodeStat) {
      await this.registry.updateInodeSnapshots(
        dev, ino, fileSnapshot(inodeStat))
    }
    const content = await this.registry.getContent(hash)
    if (content) {
      await this.registry.upsertContent(Object.assign({}, content, {
        hash,
        size: storeStat ? storeStat.size : content.size,
        anchor_present: !!storeStat,
        anchor_dev: storeStat ? storeStat.dev : null,
        anchor_ino: storeStat ? storeStat.ino : null,
        anchor_size: storeStat ? storeStat.size : null,
        anchor_mtime: storeStat ? storeStat.mtimeMs : null,
        anchor_ctime: storeStat ? storeStat.ctimeMs : null,
        anchor_nlink: storeStat ? storeStat.nlink : null
      }))
    }
  }

  async reclassifyHashes(hashes) {
    const storeDev = (await fs.promises.stat(this.root)).dev
    for (const hash of new Set(hashes)) {
      const storeStat = await this.storeStatIfPresent(
        this.storePathFor(hash))
      await this.registry.reclassifyHash(
        hash,
        storeDev,
        this.mode === "link",
        storeStat ? fileSnapshot(storeStat) : null
      )
    }
  }

  async verifyStoreContent(hash, storePath, storeStat) {
    if (!storeStat || !storeStat.isFile()) return { valid: false }
    const content = await this.registry.getContent(hash)
    if (content &&
        content.anchor_verified_at &&
        content.anchor_present &&
        content.anchor_dev === storeStat.dev &&
        content.anchor_ino === storeStat.ino &&
        content.anchor_size === storeStat.size &&
        content.anchor_mtime === storeStat.mtimeMs &&
        content.anchor_ctime === storeStat.ctimeMs) {
      return { valid: true, snapshot: fileSnapshot(storeStat) }
    }
    const before = fileSnapshot(storeStat)
    let hashed
    try {
      hashed = await this.hashFile(storePath)
    } catch (error) {
      return { valid: false }
    }
    const after = await this.storeStatIfPresent(storePath)
    if (!after ||
        !sameSnapshot(before, after) ||
        hashed.hash !== hash ||
        hashed.size !== after.size) {
      return { valid: false }
    }
    await this.registry.upsertContent({
      hash,
      size: after.size,
      first_seen: content && content.first_seen,
      verified_at: Date.now(),
      anchor_verified_at: Date.now(),
      anchor_present: true,
      anchor_dev: after.dev,
      anchor_ino: after.ino,
      anchor_size: after.size,
      anchor_mtime: after.mtimeMs,
      anchor_ctime: after.ctimeMs,
      anchor_nlink: after.nlink
    })
    return { valid: true, snapshot: fileSnapshot(after) }
  }

  async adopt(filePath, hash, expected) {
    const current = await lstatIfPresent(filePath)
    if (!current ||
        !current.isFile() ||
        !sameSnapshot(expected, current)) {
      return { status: "stale" }
    }
    if (this.mode !== "link") return { status: "unavailable" }
    const storePath = this.storePathFor(hash)
    let storeStat = await this.storeStatIfPresent(storePath, {
      createParent: true
    })
    if (storeStat) {
      if (sameIdentity(storeStat, current)) return { status: "ready" }
      return { status: "exists" }
    }
    try {
      await fs.promises.link(filePath, storePath)
    } catch (error) {
      if (NO_LINK_CODES.has(error && error.code)) {
        return { status: "unavailable" }
      }
      throw error
    }
    storeStat = await this.storeStatIfPresent(storePath)
    const after = await lstatIfPresent(filePath)
    if (!storeStat ||
        !after ||
        !sameIdentity(storeStat, after) ||
        !sameContentState(expected, after)) {
      if (storeStat) await unlinkIfSame(storePath, storeStat)
      return { status: "stale" }
    }
    const existing = await this.registry.getFile(filePath)
    await this.registry.upsertContent({
      hash,
      size: storeStat.size,
      verified_at: Date.now(),
      anchor_verified_at: Date.now(),
      anchor_present: true,
      anchor_dev: storeStat.dev,
      anchor_ino: storeStat.ino,
      anchor_size: storeStat.size,
      anchor_mtime: storeStat.mtimeMs,
      anchor_ctime: storeStat.ctimeMs,
      anchor_nlink: storeStat.nlink
    })
    await this.registry.upsertFile(Object.assign({}, existing, {
      path: filePath,
      hash,
      size: after.size,
      mtime: after.mtimeMs,
      ctime: after.ctimeMs,
      dev: after.dev,
      ino: after.ino,
      source_id: existing && existing.source_id,
      app: existing && existing.app,
      status: "linked"
    }))
    await this.refreshInodeSnapshots(hash, after.dev, after.ino)
    return { status: "ready" }
  }

  async ensureAnchorForHash(hash, targetStat) {
    const dev = targetStat.dev
    const storePath = this.storePathFor(hash)
    const existingStore = await this.storeStatIfPresent(storePath)
    if (existingStore) {
      if (existingStore.dev !== dev) return { status: "unavailable" }
      const verified = await this.verifyStoreContent(
        hash, storePath, existingStore)
      return verified.valid
        ? { status: "ready", stat: existingStore }
        : { status: "stale" }
    }

    const candidate = await this.registry.anchorCandidate(
      hash,
      dev,
      targetStat.mode & 0o7777,
      targetStat.uid,
      targetStat.gid
    )
    if (!candidate) return { status: "no-source" }
    const source = this.sourceForPath(candidate.path, candidate.source_id)
    if (!source ||
        !await this.canonicalPathIsWithinSource(candidate.path, source)) {
      return { status: "stale" }
    }
    if (this.sourceAppIsRunning(source)) return { status: "locked" }
    const before = await lstatIfPresent(candidate.path)
    if (!before ||
        !before.isFile() ||
        !sameSnapshot(rowSnapshot(candidate), before)) {
      return { status: "stale" }
    }
    const hashed = await this.hashFile(candidate.path)
    const after = await lstatIfPresent(candidate.path)
    if (!after ||
        !sameSnapshot(fileSnapshot(before), after) ||
        hashed.hash !== hash) {
      return { status: "stale" }
    }
    const adopted = await this.adopt(
      candidate.path, hash, fileSnapshot(after))
    if (adopted.status !== "ready") return adopted
    return {
      status: "ready",
      stat: await this.storeStatIfPresent(storePath)
    }
  }

  async convert(targetPath) {
    const target = await this.registry.getFile(targetPath)
    if (!target ||
        target.unavailable_reason === "stale" ||
        target.status !== "duplicate" ||
        !target.hash) {
      return { status: "not-found" }
    }
    const source = this.sourceForPath(target.path, target.source_id)
    if (!source ||
        !await this.canonicalPathIsWithinSource(target.path, source)) {
      return { status: "stale" }
    }
    if (this.sourceAppIsRunning(source)) return { status: "locked" }

    let targetStat = await lstatIfPresent(target.path)
    if (!targetStat ||
        !targetStat.isFile() ||
        !sameSnapshot(rowSnapshot(target), targetStat)) {
      return { status: "stale" }
    }
    const prepared = await this.ensureAnchorForHash(target.hash, targetStat)
    if (prepared.status !== "ready") return prepared
    let storeStat = await this.storeStatIfPresent(
      this.storePathFor(target.hash))
    if (!storeStat) return { status: "stale" }
    if (storeStat.dev !== targetStat.dev) {
      return { status: "unavailable" }
    }
    if (sameIdentity(storeStat, targetStat)) {
      await this.registry.upsertFile(Object.assign({}, target, {
        status: "linked"
      }))
      return { status: "already", bytes_saved: 0 }
    }
    if (storeStat.size !== targetStat.size) {
      return { status: "size-mismatch" }
    }
    if (!sameFileMetadata(storeStat, targetStat)) {
      return { status: "metadata-mismatch" }
    }
    const verified = await this.verifyStoreContent(
      target.hash, this.storePathFor(target.hash), storeStat)
    if (!verified.valid) return { status: "stale" }

    const temporary = `${target.path}${TMP_SUFFIX}`
    let temporaryStat = null
    let committedStat = null
    try {
      await fs.promises.link(this.storePathFor(target.hash), temporary)
      temporaryStat = await fs.promises.lstat(temporary)
      if (this.sourceAppIsRunning(source)) {
        await unlinkIfSame(temporary, temporaryStat)
        return { status: "locked" }
      }
      const [currentTarget, currentStore, currentTemporary] =
        await Promise.all([
          lstatIfPresent(target.path),
          this.storeStatIfPresent(this.storePathFor(target.hash)),
          lstatIfPresent(temporary)
        ])
      if (!currentTarget ||
          !sameSnapshot(fileSnapshot(targetStat), currentTarget) ||
          !currentStore ||
          !currentTemporary ||
          !sameIdentity(currentStore, currentTemporary) ||
          !sameContentState(verified.snapshot, currentStore)) {
        await unlinkIfSame(temporary, temporaryStat)
        return { status: "stale" }
      }
      committedStat = temporaryStat
      await fs.promises.rename(temporary, target.path)
      temporaryStat = null
    } catch (error) {
      if (temporaryStat) {
        await unlinkIfSame(temporary, temporaryStat).catch(() => {})
      }
      if (LOCK_CODES.has(error && error.code)) return { status: "locked" }
      if (NO_LINK_CODES.has(error && error.code)) {
        return { status: "unavailable" }
      }
      if (error && error.code === "EEXIST") return { status: "conflict" }
      throw error
    }

    let finalStat
    try {
      finalStat = await fs.promises.lstat(target.path)
    } catch (error) {
      if (!committedStat) throw error
      finalStat = committedStat
    }
    storeStat = await this.storeStatIfPresent(this.storePathFor(target.hash))
    if (!storeStat || !sameIdentity(finalStat, storeStat)) {
      return { status: "stale" }
    }
    await this.registry.upsertFile(Object.assign({}, target, {
      size: finalStat.size,
      mtime: finalStat.mtimeMs,
      ctime: finalStat.ctimeMs,
      dev: finalStat.dev,
      ino: finalStat.ino,
      status: "linked"
    }))
    await this.refreshInodeSnapshots(
      target.hash, finalStat.dev, finalStat.ino)
    return {
      status: "converted",
      bytes_saved: finalStat.size,
      hash: target.hash,
      path: target.path,
      app: target.app,
      source_id: target.source_id
    }
  }

  async countActionFiles(status, scopeId = null) {
    const sourceIds = this.scopeSourceIds(scopeId)
    if (scopeId && !sourceIds.length) return 0
    return this.registry.countActionFiles(status, sourceIds)
  }

  separateSelection(payload = {}) {
    const scopeId = typeof payload.scope_id === "string" &&
      payload.scope_id
      ? payload.scope_id
      : null
    const locationId = typeof payload.location_id === "string" &&
      payload.location_id
      ? payload.location_id
      : null
    if (scopeId && !this._sourcesById.has(scopeId)) {
      return { error: "That location is no longer available." }
    }
    if (locationId && !this._sourcesById.has(locationId)) {
      return { error: "That location is no longer available." }
    }
    const view = STATUS_VIEWS.has(payload.view) ? payload.view : "all"
    const statusFilter = STATUS_FILTERS.has(payload.status_filter)
      ? payload.status_filter
      : "all"
    if (view !== "shared" &&
        !(view === "all" &&
          (statusFilter === "all" || statusFilter === "shared"))) {
      return {
        error: "The current view has no deduplicated files to separate."
      }
    }
    const sourceIds = this.scopeSourceIds(scopeId, locationId)
    if (!sourceIds.length) {
      return { error: "That location is no longer available." }
    }
    return {
      sourceIds,
      query: String(payload.query || "").slice(0, 500).trim()
    }
  }

  async deduplicateFile(filePath) {
    const result = await this.convert(path.resolve(filePath))
    if (result.status === "converted") {
      if (!await this.recordEvent({
        kind: "convert",
        hash: result.hash,
        app: result.app,
        source_id: result.source_id,
        bytes: result.bytes_saved,
        files: 1
      })) {
        result.activity_warning = true
      }
    }
    return result
  }

  async deduplicateScope(scopeId = null, options = {}) {
    const sourceIds = this.scopeSourceIds(scopeId)
    const summary = {
      converted: 0,
      bytes_saved: 0,
      locked: 0,
      stale: 0,
      incompatible: 0,
      unavailable: 0,
      failed: 0
    }
    if (scopeId && !sourceIds.length) return summary
    let cursor = ""
    while (true) {
      const rows = await this.registry.fileBatch(
        "duplicate", sourceIds, cursor, 100)
      if (!rows.length) break
      for (const row of rows) {
        cursor = row.path
        try {
          const result = await this.convert(row.path)
          if (result.status === "converted") {
            summary.converted += 1
            summary.bytes_saved += result.bytes_saved || 0
          } else if (result.status === "already") {
            // Another selected path already caused this inode to be shared.
          } else if (result.status === "locked") {
            summary.locked += 1
          } else if (result.status === "metadata-mismatch") {
            summary.incompatible += 1
          } else if (result.status === "unavailable") {
            summary.unavailable += 1
          } else {
            summary.stale += 1
          }
        } catch (error) {
          summary.failed += 1
        }
        if (options.progress) options.progress.files_completed += 1
      }
    }
    if (summary.converted) {
      const scopedSource = scopeId
        ? this._sources.find((source) => source.id === scopeId)
        : null
      if (!await this.recordEvent({
        kind: "convert",
        bytes: summary.bytes_saved,
        files: summary.converted,
        source_id: scopedSource && scopedSource.kind !== "virtual"
          ? scopeId
          : null
      })) {
        summary.activity_warning = true
      }
    }
    return summary
  }

  async copyOut(filePath, expected, source) {
    const temporary = `${filePath}${TMP_SUFFIX}`
    let temporaryStat = null
    try {
      await fs.promises.copyFile(
        filePath, temporary, fs.constants.COPYFILE_EXCL)
      if (Number.isFinite(expected.atimeMs) &&
          Number.isFinite(expected.mtimeMs)) {
        await fs.promises.utimes(
          temporary,
          new Date(expected.atimeMs),
          new Date(expected.mtimeMs)
        )
      }
      temporaryStat = await fs.promises.lstat(temporary)
      if (this.sourceAppIsRunning(source)) {
        await unlinkIfSame(temporary, temporaryStat)
        return { status: "locked" }
      }
      const [current, currentTemporary] = await Promise.all([
        lstatIfPresent(filePath),
        lstatIfPresent(temporary)
      ])
      if (!current ||
          !sameSnapshot(expected, current) ||
          !sameIdentity(temporaryStat, currentTemporary)) {
        await unlinkIfSame(temporary, temporaryStat)
        return { status: "stale" }
      }
      await fs.promises.rename(temporary, filePath)
      let finalStat
      try {
        finalStat = await fs.promises.lstat(filePath)
      } catch (error) {
        // rename() already committed the separate copy. Preserve that
        // successful action if only the post-commit metadata read failed.
        finalStat = temporaryStat
      }
      if (!sameIdentity(finalStat, temporaryStat)) {
        return { status: "stale" }
      }
      temporaryStat = null
      return {
        status: "copied",
        stat: finalStat
      }
    } catch (error) {
      if (temporaryStat) {
        await unlinkIfSame(temporary, temporaryStat).catch(() => {})
      }
      if (error && error.code === "EEXIST") return { status: "conflict" }
      if (isMissingError(error)) return { status: "stale" }
      if (LOCK_CODES.has(error && error.code)) return { status: "locked" }
      throw error
    }
  }

  async separate(filePath, options = {}) {
    const entry = await this.registry.getFile(filePath)
    if (!entry || entry.unavailable_reason === "stale") {
      return { status: "not-found" }
    }
    const source = this.sourceForPath(entry.path, entry.source_id)
    if (!source ||
        !await this.canonicalPathIsWithinSource(entry.path, source)) {
      return { status: "stale" }
    }
    const current = await lstatIfPresent(entry.path)
    if (!current ||
        !current.isFile() ||
        !sameSnapshot(rowSnapshot(entry), current)) {
      return { status: "stale" }
    }
    if (entry.status !== "linked") return { status: "not-found" }
    if (this.sourceAppIsRunning(source)) return { status: "locked" }
    const copied = await this.copyOut(
      entry.path, current, source)
    if (copied.status !== "copied") return copied
    await this.registry.upsertFile(Object.assign(
      {},
      entry,
      fileSnapshot(copied.stat),
      {
        status: "linked",
        unavailable_reason: null
      }
    ))
    await this.refreshInodeSnapshots(entry.hash, entry.dev, entry.ino)
    if (options.reclassify !== false) {
      await this.reclassifyHashes([entry.hash])
    }
    const result = {
      status: "detached",
      bytes: entry.size,
      hash: entry.hash
    }
    if (options.recordActivity !== false && !await this.recordEvent({
      kind: "detach",
      hash: entry.hash,
      path: entry.path,
      app: entry.app,
      source_id: entry.source_id,
      bytes: entry.size
    })) result.activity_warning = true
    return result
  }

  async separateFiles(filePaths, progress = null) {
    const summary = {
      separated: 0,
      bytes: 0,
      failed: 0,
      results: []
    }
    let separatedEntry = null
    let commonSourceId
    const affectedHashes = new Set()
    for (const filePath of new Set(filePaths.map((item) =>
      path.resolve(item)))) {
      try {
        const entry = await this.registry.getFile(filePath)
        const result = entry && entry.status === "linked"
          ? await this.separate(filePath, {
              recordActivity: false,
              reclassify: false
            })
          : { status: "ineligible" }
        if (result.status === "detached") {
          summary.separated += 1
          summary.bytes += result.bytes || 0
          separatedEntry = entry
          affectedHashes.add(result.hash)
          const entrySourceId = entry.source_id || null
          commonSourceId = summary.separated === 1
            ? entrySourceId
            : commonSourceId === entrySourceId ? commonSourceId : null
        } else {
          summary.failed += 1
        }
        summary.results.push({ path: filePath, status: result.status })
      } catch (error) {
        summary.failed += 1
        summary.results.push({ path: filePath, status: "failed" })
      } finally {
        if (progress) progress.files_completed += 1
      }
    }
    if (affectedHashes.size) {
      await this.reclassifyHashes(affectedHashes)
    }
    const event = {
      kind: "detach",
      bytes: summary.bytes,
      files: summary.separated
    }
    if (summary.separated === 1 && separatedEntry) {
      event.hash = separatedEntry.hash
      event.path = separatedEntry.path
      event.app = separatedEntry.app
      event.source_id = separatedEntry.source_id
    } else if (commonSourceId) {
      event.source_id = commonSourceId
    }
    if (summary.separated && !await this.recordEvent(event)) {
      summary.activity_warning = true
    }
    return summary
  }

  async separateMatchingFiles(selection, progress = null) {
    const summary = {
      separated: 0,
      bytes: 0,
      failed: 0,
      cancelled: false
    }
    let separatedEntry = null
    let commonSourceId
    let cursor = ""
    while (true) {
      if (this.fileActionCancelRequested) {
        summary.cancelled = true
        break
      }
      const rows = await this.registry.fileBatch(
        "linked",
        selection.sourceIds,
        cursor,
        100,
        selection.query
      )
      if (!rows.length) break
      const affectedHashes = new Set()
      for (const row of rows) {
        if (this.fileActionCancelRequested) {
          summary.cancelled = true
          break
        }
        cursor = row.path
        try {
          const entry = await this.registry.getFile(row.path)
          const result = entry && entry.status === "linked"
            ? await this.separate(row.path, {
                recordActivity: false,
                reclassify: false
              })
            : { status: "ineligible" }
          if (result.status === "detached") {
            summary.separated += 1
            summary.bytes += result.bytes || 0
            separatedEntry = entry
            affectedHashes.add(result.hash)
            const entrySourceId = entry.source_id || null
            commonSourceId = summary.separated === 1
              ? entrySourceId
              : commonSourceId === entrySourceId ? commonSourceId : null
          } else {
            summary.failed += 1
          }
        } catch (error) {
          summary.failed += 1
        } finally {
          if (progress) progress.files_completed += 1
        }
      }
      if (affectedHashes.size) {
        await this.reclassifyHashes(affectedHashes)
      }
      if (summary.cancelled) break
    }
    const event = {
      kind: "detach",
      bytes: summary.bytes,
      files: summary.separated
    }
    if (summary.separated === 1 && separatedEntry) {
      event.hash = separatedEntry.hash
      event.path = separatedEntry.path
      event.app = separatedEntry.app
      event.source_id = separatedEntry.source_id
    } else if (commonSourceId) {
      event.source_id = commonSourceId
    }
    if (summary.separated && !await this.recordEvent(event)) {
      summary.activity_warning = true
    }
    return summary
  }

  async reclaim(hash) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      return { status: "not-found" }
    }
    const content = await this.registry.getContent(hash)
    if (!content || !content.anchor_present) {
      return { status: "not-found" }
    }
    const storePath = this.storePathFor(hash)
    const stat = await this.storeStatIfPresent(storePath)
    if (!stat) {
      await this.registry.upsertContent(Object.assign({}, content, {
        hash,
        anchor_present: false,
        anchor_verified_at: null
      }))
      return { status: "gone" }
    }
    const expected = {
      size: content.anchor_size,
      mtime: content.anchor_mtime,
      ctime: content.anchor_ctime,
      dev: content.anchor_dev,
      ino: content.anchor_ino
    }
    if (!sameSnapshot(expected, stat)) return { status: "stale" }
    if (stat.nlink !== 1) return { status: "in-use" }
    await fs.promises.unlink(storePath)
    const hasFiles = await this.registry.hasFilesForHash(hash)
    if (hasFiles) {
      await this.registry.upsertContent(Object.assign({}, content, {
        hash,
        anchor_present: false,
        anchor_verified_at: null,
        anchor_dev: null,
        anchor_ino: null,
        anchor_size: null,
        anchor_mtime: null,
        anchor_ctime: null,
        anchor_nlink: null
      }))
    } else {
      await this.registry.removeContent(hash)
    }
    const result = { status: "reclaimed", bytes_freed: stat.size }
    if (!await this.recordEvent({
      kind: "reclaim",
      hash,
      bytes: stat.size
    })) result.activity_warning = true
    return result
  }

  async reclaimAll() {
    const summary = { reclaimed: 0, bytes_freed: 0, failed: 0 }
    let cursor = ""
    while (true) {
      const hashes = await this.registry.reclaimableBatch(cursor, 100)
      if (!hashes.length) break
      for (const row of hashes) {
        cursor = row.hash
        try {
          const result = await this.reclaim(row.hash)
          if (result.status === "reclaimed") {
            summary.reclaimed += 1
            summary.bytes_freed += result.bytes_freed || 0
            if (result.activity_warning) summary.activity_warning = true
          } else if (!["gone", "in-use"].includes(result.status)) {
            summary.failed += 1
          }
        } catch (error) {
          summary.failed += 1
        }
      }
    }
    return summary
  }

  async scanForScope(scopeId) {
    const direct = await this.registry.scanFor(scopeId)
    const key = scopeId || ""
    if (direct || !scopeId) {
      if (direct) this.lastScanCache.set(key, direct)
      else this.lastScanCache.delete(key)
      return direct
    }
    const global = await this.registry.scanFor()
    if (global) this.lastScanCache.set("", global)
    else this.lastScanCache.delete("")
    if (!global ||
        !global.source_files ||
        !Object.prototype.hasOwnProperty.call(
          global.source_files, scopeId)) {
      this.lastScanCache.delete(key)
      return null
    }
    const scoped = Object.assign({}, global, {
      files: global.source_files[scopeId] || 0,
      bytes_total: global.source_bytes[scopeId] || 0,
      hash_failures: global.source_hash_failures
        ? global.source_hash_failures[scopeId] || 0
        : 0
    })
    const sourceIds = new Set(this.scopeSourceIds(scopeId))
    scoped.exclusions = Array.isArray(global.exclusions)
      ? global.exclusions.filter((entry) =>
        entry && sourceIds.has(entry.source_id))
      : []
    scoped.partial = scoped.exclusions.length > 0
    scoped.outcome = scoped.partial
      ? "completed_with_exclusions"
      : "complete"
    this.lastScanCache.set(key, scoped)
    return scoped
  }

  sourceCountMaps(summaryRows) {
    const counts = {
      all: {},
      duplicates: {},
      shareable: {}
    }
    const add = (target, sourceIdValue, amount) => {
      let current = this._sourcesById.get(sourceIdValue)
      const seen = new Set()
      while (current && !seen.has(current.id)) {
        target[current.id] = (target[current.id] || 0) + amount
        seen.add(current.id)
        current = current.parent_id
          ? this._sourcesById.get(current.parent_id)
          : null
      }
    }
    for (const row of summaryRows) {
      const amount = Number(row.file_count) || 0
      if (!["reference", "duplicate", "linked", "unavailable"]
        .includes(row.status)) continue
      add(counts.all, row.source_id, amount)
      if (row.status === "duplicate" || row.status === "unavailable") {
        add(counts.duplicates, row.source_id, amount)
      }
      if (row.status === "duplicate") {
        add(counts.shareable, row.source_id, amount)
      }
    }
    return counts
  }

  publicFileItems(page) {
    const hashSiblings = new Map()
    for (const sibling of page.hashSiblings || []) {
      if (!hashSiblings.has(sibling.hash)) {
        hashSiblings.set(sibling.hash, [])
      }
      hashSiblings.get(sibling.hash).push(sibling)
    }
    const inodeSiblings = new Map()
    for (const sibling of page.inodeSiblings || []) {
      const key = `${sibling.dev}:${sibling.ino}`
      if (!inodeSiblings.has(key)) inodeSiblings.set(key, [])
      inodeSiblings.get(key).push(sibling)
    }
    return (page.rows || []).map((row) => {
      const sampledMatches = row.status === "linked"
        ? inodeSiblings.get(`${row.dev}:${row.ino}`) || []
        : hashSiblings.get(row.hash) || []
      const allMatches = [
        row,
        ...sampledMatches.filter((match) => match.path !== row.path)
      ]
      const locations = allMatches.map((match) =>
        Object.assign({
          path: match.path,
          app: match.app,
          dev: match.dev,
          ino: match.ino
        }, this.locationForPath(match.path, match.source_id)))
      const publicStatus = {
        reference: "tracked",
        duplicate: "duplicate",
        unavailable: "duplicate",
        linked: "shared"
      }[row.status]
      const result = Object.assign({
        path: row.path,
        hash: row.hash,
        size: row.size,
        app: row.app,
        status: publicStatus,
        shareable: row.status === "duplicate",
        unavailable_reason: row.status === "unavailable"
          ? row.unavailable_reason || "different_disk"
          : null,
        location_count: sampledMatches.length
          ? Number(sampledMatches[0].location_count) || 1
          : 1,
        locations
      }, this.locationForPath(row.path, row.source_id))
      if (row.status === "duplicate" || row.status === "unavailable") {
        const match = allMatches.find((candidate) =>
          candidate.path !== row.path)
        result.match = match
          ? Object.assign({
            path: match.path,
            app: match.app
          }, this.locationForPath(match.path, match.source_id))
          : null
      }
      return result
    })
  }

  async status(scopeId = null, options = {}) {
    if (!this.enabled || !this.registry) return { enabled: false }
    const view = STATUS_VIEWS.has(options.view) ? options.view : "all"
    const statusFilter = STATUS_FILTERS.has(options.status_filter)
      ? options.status_filter
      : "all"
    const query = String(options.query || "").slice(0, 500).trim()
    const cursor = typeof options.cursor === "string"
      ? options.cursor.slice(0, 2048)
      : ""
    const pageSize = boundedInteger(
      options.page_size, STATUS_PAGE_SIZE, 1, STATUS_PAGE_SIZE)
    const requestedPage = boundedInteger(
      options.page, 0, 0, Number.MAX_SAFE_INTEGER)
    const locationId = typeof options.location_id === "string" &&
      options.location_id
      ? options.location_id
      : null
    const scopeSourceIds = this.scopeSourceIds(scopeId)
    const locationSourceIds = this.scopeSourceIds(
      scopeId,
      locationId
    )
    const snapshot = await this.registry.statusSnapshot({
      scopeSourceIds,
      locationSourceIds,
      scoped: !!scopeId,
      scopeUnrestricted: !scopeId,
      locationUnrestricted: !scopeId && !locationId,
      view,
      statusFilter,
      query,
      pageSize,
      sizeSort: options.size_sort,
      cursor
    })
    let items
    if (view === "activity") {
      items = (snapshot.page.rows || []).map((event) => Object.assign(
        {},
        event.path
          ? this.locationForPath(event.path, event.source_id)
          : {},
        event
      ))
    } else if (view === "reclaimable") {
      items = snapshot.page.rows || []
    } else {
      items = this.publicFileItems(snapshot.page)
    }

    const lastScan = await this.scanForScope(scopeId)
    const before = lastScan && Number.isFinite(lastScan.bytes_total)
      ? lastScan.bytes_total
      : 0
    const saved = Math.max(0, Number(snapshot.saved) || 0)
    const total = Number(snapshot.total) || 0
    const pages = Math.max(1, Math.ceil(total / pageSize))
    const publicSources = this._sources
      .filter((source) => !scopeId || source.id === scopeId)
      .map((source) => ({
        id: source.id,
        kind: source.kind,
        label: source.label,
        root: source.root,
        display_path: source.root,
        target_path: source.kind === "external" ? source.root : null,
        parent_id: scopeId ? null : source.parent_id,
        app: source.app || null,
        available: source.available !== false,
        shareable: source.kind === "virtual" ? null : !!source.shareable,
        removable: source.kind === "external" &&
          source.configured === true
      }))
    const sourceCounts = this.sourceCountMaps(snapshot.scopeRows)
    const result = {
      enabled: true,
      mode: this.mode,
      scan: this.scanStatus(),
      last_scan: lastScan,
      bytes_without_sharing: before,
      bytes_on_disk: Math.max(0, before - saved),
      saved_by_sharing: saved,
      effective_bytes: Math.max(0, before - saved),
      reclaimable: Number(snapshot.reclaimable) || 0,
      pending_bytes: Number(snapshot.pending) || 0,
      file_action: this.fileActionStatus(scopeId),
      sources: publicSources,
      items,
      inventory: {
        view,
        counts: snapshot.counts,
        source_counts: sourceCounts,
        shareable_by_source: sourceCounts.shareable,
        shareable_duplicates:
          Number(snapshot.shareableDuplicates) || 0,
        duplicate_locations:
          Number(snapshot.duplicateLocations) || 0,
        current: {
          count: total,
          locations: Number(snapshot.currentLocations) || 0,
          shareable_bytes:
            Number(snapshot.currentShareableBytes) || 0,
          separate_count:
            Number(snapshot.currentSeparateCount) || 0,
          separate_bytes:
            Number(snapshot.currentSeparateBytes) || 0
        },
        page: requestedPage,
        page_size: pageSize,
        start: requestedPage * pageSize,
        end: Math.min((requestedPage * pageSize) + items.length, total),
        total,
        pages,
        cursor: cursor || null,
        next_cursor: snapshot.page.nextCursor || null,
        has_previous: requestedPage > 0,
        has_next: !!snapshot.page.nextCursor
      }
    }
    if (scopeId) result.scope_id = scopeId
    return result
  }

  scanStatus() {
    if (!this.sweeper) return null
    const pending = !!this.scanPromise && !this.sweeper.state.active
    const state = pending
      ? Object.assign(this.sweeper.idleState(), {
        phase: "queued",
        scope_id: this.scanScopeId
      })
      : this.sweeper.state
    return Object.assign({}, state, {
      current_file: this.sweeper.currentHash
        ? path.basename(this.sweeper.currentHash.path)
        : null,
      current_file_bytes: this.sweeper.currentHash
        ? this.sweeper.currentHash.bytes
        : null,
      current_file_size: this.sweeper.currentHash
        ? this.sweeper.currentHash.size
        : null,
      pending,
      error: this.scanError
    })
  }

  fileActionStatus(scopeId = null) {
    const progress = this.fileActionProgress
    if (!progress) return null
    if (scopeId && progress.scope_id &&
        progress.scope_id !== scopeId) return null
    return Object.assign({}, progress)
  }

  async progressStatus(scopeId = null) {
    return {
      enabled: !!this.enabled,
      scan: this.scanStatus(),
      file_action: this.fileActionStatus(scopeId),
      last_scan: this.lastScanCache.get(scopeId || "") || null
    }
  }
}

module.exports = Vault
