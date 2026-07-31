const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { execFile } = require("child_process")
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

const unavailableStorage = (message) => {
  const error = new Error(message)
  error.code = "EVAULTUNAVAILABLE"
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

const revealInFileManager = (filePath, platform = process.platform) =>
  new Promise((resolve, reject) => {
    const command = platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "explorer.exe"
        : "xdg-open"
    const args = platform === "darwin"
      ? ["-R", filePath]
      : platform === "win32"
        ? [`/select,${filePath}`]
        : [path.dirname(filePath)]
    execFile(command, args, {
      timeout: 10000,
      windowsHide: true
    }, (error) => error ? reject(error) : resolve())
  })

class Vault {
  constructor(kernel) {
    this.kernel = kernel
    this.fileManagerLauncher = (filePath) =>
      revealInFileManager(
        filePath,
        this.kernel.platform || process.platform
      )
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
    this._anchorStores = []
    this._anchorStoresById = new Map()
    this._anchorStoresByDevice = new Map()
    this._fallbackConfig = null
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
    const store = this.defaultAnchorStore()
    return store
      ? path.resolve(store.root, "sha256")
      : path.resolve(this.globalConfigRoot(), "vault", "sha256")
  }

  storePathFor(hash, storeId = null) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new TypeError("Invalid vault content identifier.")
    }
    const store = storeId
      ? this._anchorStoresById.get(storeId)
      : this.defaultAnchorStore()
    if (!store) throw new Error("No anchor store is configured.")
    return path.resolve(
      store.root, "sha256", hash.slice(0, 2), hash)
  }

  globalConfigRoot() {
    return this.kernel.store && typeof this.kernel.store.root === "string"
      ? path.resolve(this.kernel.store.root)
      : path.resolve(this.kernel.homedir, ".pinokio")
  }

  readConfig() {
    const stored = this.kernel.store &&
      typeof this.kernel.store.get === "function"
      ? this.kernel.store.get("vault")
      : this._fallbackConfig
    const config = stored && typeof stored === "object" ? stored : {}
    return {
      locations: Array.isArray(config.locations)
        ? config.locations.filter((item) => typeof item === "string")
        : [],
      anchor_stores: Array.isArray(config.anchor_stores)
        ? config.anchor_stores.filter((item) =>
          item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          item.id &&
          typeof item.root === "string" &&
          typeof item.probe_path === "string")
        : []
    }
  }

  writeConfig(config) {
    const value = {
      locations: [...new Set((config.locations || [])
        .filter((item) => typeof item === "string")
        .map((item) => path.resolve(item)))],
      anchor_stores: (config.anchor_stores || []).map((store) => ({
        id: store.id,
        root: path.resolve(store.root),
        probe_path: path.resolve(store.probe_path)
      }))
    }
    if (this.kernel.store && typeof this.kernel.store.set === "function") {
      this.kernel.store.set("vault", value)
    } else {
      this._fallbackConfig = value
    }
    return value
  }

  configuredLocations() {
    return this.readConfig().locations
  }

  defaultAnchorStore() {
    const home = path.resolve(this.kernel.homedir)
    return this._anchorStores.find((store) =>
      store.available && isPathWithin(store.probe_path, home)) ||
      this._anchorStores[0] ||
      null
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
    const store = options.store_id
      ? this._anchorStoresById.get(options.store_id)
      : this._anchorStores.find((candidate) =>
        isPathWithin(path.resolve(candidate.root, "sha256"), storePath))
    if (!store) {
      throw unsafeStoragePath(storePath)
    }
    const blobRoot = path.resolve(store.root, "sha256")
    if (!isPathWithin(blobRoot, storePath)) {
      throw unsafeStoragePath(storePath)
    }
    if (options.createParent) {
      await this.ensureAnchorStore(store, options.dev)
    }
    if (!await this.directoryIfSafe(store.root) ||
        !await this.directoryIfSafe(blobRoot)) {
      return null
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

  async ensureAnchorStore(store, expectedDev = null) {
    if (!store) throw new Error("No anchor store is configured.")
    const managementParent = path.dirname(store.root)
    const parentStat = await lstatIfPresent(managementParent)
    if (!parentStat) {
      await fs.promises.mkdir(managementParent, {
        recursive: true,
        mode: 0o700
      })
    } else if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw unsafeStoragePath(managementParent)
    }
    await this.ensureDirectory(store.root)
    const markerPath = path.resolve(store.root, "store.json")
    const markerStat = await lstatIfPresent(markerPath)
    if (markerStat && (!markerStat.isFile() || markerStat.isSymbolicLink())) {
      throw unsafeStoragePath(markerPath)
    }
    if (markerStat) {
      let marker
      try {
        marker = JSON.parse(await fs.promises.readFile(markerPath, "utf8"))
      } catch (error) {
        throw unsafeStoragePath(markerPath)
      }
      if (!marker || marker.id !== store.id || marker.version !== 1) {
        throw unsafeStoragePath(markerPath)
      }
    } else {
      await fs.promises.writeFile(
        markerPath,
        `${JSON.stringify({ id: store.id, version: 1 }, null, 2)}\n`,
        { flag: "wx", mode: 0o600 }
      )
    }
    const rootStat = await fs.promises.stat(store.root)
    if (expectedDev !== null && rootStat.dev !== expectedDev) {
      throw unavailableStorage(
        "The configured anchor store is on a different filesystem.")
    }
    const mode = await this.probe(store.root)
    store.available = true
    store.dev = rootStat.dev
    store.mode = mode
    this._anchorStoresByDevice.set(rootStat.dev, store)
    if (mode !== "link") {
      throw unavailableStorage(
        "This filesystem does not support hardlinks.")
    }
    await this.ensureDirectory(path.resolve(store.root, "sha256"))
    return store
  }

  async validateAnchorStore(store, expectedDev = null) {
    if (!store) throw new Error("No anchor store is configured.")
    const markerPath = path.resolve(store.root, "store.json")
    const [rootStat, markerStat] = await Promise.all([
      this.directoryIfSafe(store.root),
      lstatIfPresent(markerPath)
    ])
    if (!rootStat ||
        !markerStat ||
        !markerStat.isFile() ||
        markerStat.isSymbolicLink()) {
      throw unsafeStoragePath(store.root)
    }
    let marker
    try {
      marker = JSON.parse(await fs.promises.readFile(markerPath, "utf8"))
    } catch (error) {
      throw unsafeStoragePath(markerPath)
    }
    if (!marker || marker.id !== store.id || marker.version !== 1) {
      throw unsafeStoragePath(markerPath)
    }
    const current = await fs.promises.stat(store.root)
    if (expectedDev !== null && current.dev !== expectedDev) {
      throw unavailableStorage(
        "The configured anchor store is on a different filesystem.")
    }
    store.available = true
    store.dev = current.dev
    return current
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
    this.registry = new Registry(this.root)
    await this.registry.load()
    await this.importLegacyLocationConfig()
    await this.refreshAnchorStores()
    await this.migrateLegacyAnchorStore()
    this.mode = this.defaultAnchorStore() &&
      this.defaultAnchorStore().mode === "copy"
      ? "copy"
      : "link"
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
    await this.refreshAnchorStores()
    await this.refreshSources()
    return { enabled: true, mode: this.mode }
  }

  async importLegacyLocationConfig() {
    const config = this.readConfig()
    const legacy = await this.registry.externalSources()
    const locations = [...new Set([
      ...config.locations.map((item) => path.resolve(item)),
      ...legacy.map((item) => path.resolve(item))
    ])]
    if (locations.length !== config.locations.length ||
        locations.some((item, index) =>
          item !== path.resolve(config.locations[index] || ""))) {
      this.writeConfig(Object.assign({}, config, { locations }))
    }
  }

  async migrateLegacyAnchorStore() {
    const legacyRoot = path.resolve(this.root, "sha256")
    const legacyStat = await lstatIfPresent(legacyRoot)
    if (!legacyStat) return false
    if (!legacyStat.isDirectory() || legacyStat.isSymbolicLink()) {
      throw unsafeStoragePath(legacyRoot)
    }
    if (!(await fs.promises.readdir(legacyRoot)).length) {
      await fs.promises.rmdir(legacyRoot)
      return true
    }
    const store = this.anchorStoreForDevice(legacyStat.dev)
    if (!store) {
      throw unavailableStorage(
        "The legacy anchor store has no configured store on its filesystem.")
    }
    const targetRoot = path.resolve(store.root, "sha256")
    if (samePath(legacyRoot, targetRoot)) return false

    await this.ensureAnchorStore(store, legacyStat.dev)
    const targetEntries = await fs.promises.readdir(targetRoot)
    if (targetEntries.length) {
      throw unavailableStorage(
        "Both the legacy and configured anchor stores contain files.")
    }
    await fs.promises.rmdir(targetRoot)
    try {
      await fs.promises.rename(legacyRoot, targetRoot)
    } catch (error) {
      await this.ensureDirectory(targetRoot).catch(() => {})
      throw error
    }
    return true
  }

  async refreshAnchorStores() {
    let config = this.readConfig()
    const candidates = [
      {
        probe_path: path.resolve(this.kernel.homedir),
        preferred_root: path.resolve(this.globalConfigRoot(), "vault"),
        home: true
      },
      ...config.locations.map((location) => ({
        probe_path: path.resolve(location),
        home: false
      }))
    ]
    const configured = []
    for (const entry of config.anchor_stores) {
      if (typeof entry.id !== "string" ||
          !entry.id ||
          typeof entry.root !== "string" ||
          typeof entry.probe_path !== "string") continue
      configured.push({
        id: entry.id,
        root: path.resolve(entry.root),
        probe_path: path.resolve(entry.probe_path)
      })
    }

    const observed = []
    for (const store of configured) {
      try {
        const stat = await fs.promises.stat(store.probe_path)
        if (stat.isDirectory()) observed.push({ store, dev: stat.dev })
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
    }
    let changed = configured.length !== config.anchor_stores.length
    for (const candidate of candidates) {
      let stat
      try {
        stat = await fs.promises.stat(candidate.probe_path)
      } catch (error) {
        if (isMissingError(error)) continue
        throw error
      }
      if (!stat.isDirectory() ||
          observed.some((item) => item.dev === stat.dev)) continue
      const filesystemAnchor = candidate.home
        ? null
        : await this.filesystemAnchor(candidate.probe_path, stat.dev)
      const store = {
        id: crypto.randomUUID(),
        root: candidate.home
          ? candidate.preferred_root
          : path.resolve(filesystemAnchor, ".pinokio", "vault"),
        probe_path: candidate.probe_path
      }
      configured.push(store)
      observed.push({ store, dev: stat.dev })
      changed = true
    }
    if (changed) {
      config = this.writeConfig(Object.assign({}, config, {
        anchor_stores: configured
      }))
    }

    const stores = []
    for (const entry of config.anchor_stores) {
      const store = {
        id: entry.id,
        root: path.resolve(entry.root),
        probe_path: path.resolve(entry.probe_path),
        available: false,
        dev: null,
        mode: null
      }
      try {
        const probeStat = await fs.promises.stat(store.probe_path)
        if (!probeStat.isDirectory()) {
          stores.push(store)
          continue
        }
        const rootStat = await lstatIfPresent(store.root)
        if (rootStat &&
            (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
          throw unsafeStoragePath(store.root)
        }
        store.available = true
        store.dev = probeStat.dev
        store.mode = this.volumeModes.get(store.dev) || null
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
      stores.push(store)
    }
    this._anchorStores = stores
    this._anchorStoresById = new Map(
      stores.map((store) => [store.id, store]))
    this._anchorStoresByDevice = new Map()
    for (const store of stores) {
      if (!store.available || !Number.isFinite(store.dev)) continue
      if (this._anchorStoresByDevice.has(store.dev)) {
        store.available = false
        store.error = "duplicate_device"
        continue
      }
      this._anchorStoresByDevice.set(store.dev, store)
    }
    return stores
  }

  async filesystemAnchor(directory, expectedDev = null) {
    let current = path.resolve(directory)
    const first = await fs.promises.stat(current)
    const dev = expectedDev === null ? first.dev : expectedDev
    if (!first.isDirectory() || first.dev !== dev) {
      throw new Error("The configured location is not on the expected filesystem.")
    }
    while (true) {
      const parent = path.dirname(current)
      if (parent === current) return current
      let parentStat
      try {
        parentStat = await fs.promises.stat(parent)
      } catch (error) {
        if (isMissingError(error)) return current
        throw error
      }
      if (parentStat.dev !== dev) return current
      current = parent
    }
  }

  anchorStoreForDevice(dev) {
    return this._anchorStoresByDevice.get(dev) || null
  }

  anchorStores() {
    return this._anchorStores
  }

  anchorStoreForPath(filePath) {
    return this._anchorStores.find((store) =>
      isPathWithin(path.resolve(store.root, "sha256"), filePath)) || null
  }

  storageRoots() {
    const roots = [
      this.root,
      ...this._anchorStores.map((store) => store.root)
    ].map((item) => path.resolve(item))
    for (const root of [...roots]) {
      try {
        roots.push(path.resolve(fs.realpathSync(root)))
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
    }
    return [...new Set(roots)]
  }

  isStorageRoot(directory) {
    const target = path.resolve(directory)
    return this.storageRoots().some((root) => samePath(root, target))
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
    const decorate = async (source) => {
      if (!source.root) return source
      try {
        const [stat, realRoot] = await Promise.all([
          fs.promises.lstat(source.root),
          fs.promises.realpath(source.root)
        ])
        source.canonical_root = path.resolve(realRoot)
        source.dev = stat.dev
        source.available = stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          (source.kind !== "external" || samePath(realRoot, source.root))
        const store = this.anchorStoreForDevice(stat.dev)
        source.shareable = source.available &&
          !!store &&
          store.mode !== "copy"
        source.store_id = store ? store.id : null
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

    for (const configuredPath of this.configuredLocations()) {
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
      const bases = new Set([
        path.resolve(source.root),
        source.canonical_root && path.resolve(source.canonical_root)
      ].filter(Boolean))
      for (const resolved of bases) {
        const key = process.platform === "win32"
          ? resolved.toLowerCase()
          : resolved
        if (!this._sourceBases.has(key)) this._sourceBases.set(key, [])
        this._sourceBases.get(key).push(source)
      }
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
    const pinokio = this._sourcesById.get("pinokio")
    const candidates = [
      {
        root: path.resolve(pinokio && pinokio.root || this.kernel.homedir),
        canonical_root: path.resolve(
          pinokio && pinokio.canonical_root ||
          pinokio && pinokio.root ||
          this.kernel.homedir
        ),
        source_id: "pinokio"
      },
      ...this._sources
      .filter((source) =>
        source.kind === "external" && source.available && source.root)
      .map((source) => ({
        root: path.resolve(source.root),
        canonical_root: path.resolve(source.canonical_root || source.root),
        source_id: source.id
      }))
    ].sort((left, right) =>
      left.canonical_root.length - right.canonical_root.length ||
      left.canonical_root.localeCompare(right.canonical_root))
    const roots = []
    for (const candidate of candidates) {
      const canonical = candidate.canonical_root
      if (roots.some((root) =>
        isPathWithin(root.canonical_root, canonical))) continue
      for (let index = roots.length - 1; index >= 0; index--) {
        if (isPathWithin(canonical, roots[index].canonical_root)) {
          roots.splice(index, 1)
        }
      }
      roots.push(candidate)
    }
    return roots.map(({ root, source_id: sourceIdValue }) => ({
      root,
      source_id: sourceIdValue
    }))
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

  async revealFile(scopeId, filePath) {
    if (typeof filePath !== "string" ||
        !path.isAbsolute(filePath)) {
      return { error: "Choose a valid file." }
    }
    if (scopeId && !this._sourcesById.has(scopeId)) {
      return { error: "That location is no longer available." }
    }
    const entry = await this.registry.getFile(path.resolve(filePath))
    if (!entry || entry.unavailable_reason === "stale") {
      return { error: "This file is no longer tracked. Scan again to refresh this view." }
    }
    const source = this.sourceForPath(entry.path, entry.source_id)
    if (!source || !this.sourceIsWithinScope(source, scopeId)) {
      return { error: "This file is outside the current location." }
    }
    if (!await this.canonicalPathIsWithinSource(entry.path, source)) {
      return { error: "This file is no longer available at the scanned location." }
    }
    const current = await lstatIfPresent(entry.path)
    if (!current || !current.isFile()) {
      return { error: "This file is no longer available at the scanned location." }
    }
    try {
      await this.fileManagerLauncher(entry.path)
    } catch (error) {
      return { error: "The file manager could not open this file." }
    }
    return { revealed: true }
  }

  locationForPath(filePath, preferredId = null) {
    const source = this.sourceForPath(filePath, preferredId)
    if (!source) {
      return {
        source_id: null,
        relative_path: path.basename(filePath)
      }
    }
    const resolvedPath = path.resolve(filePath)
    const sourceBase = source.canonical_root &&
      isPathWithin(source.canonical_root, resolvedPath)
      ? source.canonical_root
      : source.root
    const relative = path.relative(sourceBase, resolvedPath)
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
    if (isPathWithin(home, canonical)) {
      throw new Error(
        "That folder is already inside Pinokio and is included in scans.")
    }
    await this.refreshSources()
    const existing = this._sources.find((source) =>
      source.kind === "external" &&
      source.root &&
      samePath(source.root, canonical))
    if (existing) return { created: false, source: existing }

    const config = this.readConfig()
    this.writeConfig(Object.assign({}, config, {
      locations: [...config.locations, canonical]
    }))
    await this.refreshAnchorStores()
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
    const config = this.readConfig()
    this.writeConfig(Object.assign({}, config, {
      locations: config.locations.filter((item) =>
        !samePath(item, source.root))
    }))
    await this.registry.removeExternalSourceState(source.root, source.id)
    await this.refreshAnchorStores()
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
    if (!this.enabled) return { error: "Disk Saver is disabled." }
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
      case "reveal":
        return this.revealFile(
          typeof payload.scope_id === "string" && payload.scope_id
            ? payload.scope_id
            : null,
          payload.path
        )
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
      case "deduplicate_files": {
        if (!Array.isArray(payload.paths) ||
            payload.paths.length === 0 ||
            payload.paths.length > MAX_BULK_FILE_ACTIONS ||
            payload.paths.some((item) =>
              typeof item !== "string" || !item)) {
          return { error: "Choose valid duplicate files to deduplicate." }
        }
        const paths = [...new Set(payload.paths.map((item) =>
          path.resolve(item)))]
        return this.runMutation(() => this.runFileAction({
          kind: "deduplicate-files",
          files_total: paths.length,
          files_completed: 0
        }, (progress) => this.deduplicateFiles(paths, progress)))
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
        return this.runMutation(() =>
          this.reclaim(payload.hash, payload.store_id))
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

  async refreshInodeSnapshots(hash, dev, ino, storeId = null) {
    const store = storeId
      ? this._anchorStoresById.get(storeId)
      : this.anchorStoreForDevice(dev)
    const storePath = store ? this.storePathFor(hash, store.id) : null
    const storeStat = storePath
      ? await this.storeStatIfPresent(storePath, { store_id: store.id })
      : null
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
        size: storeStat ? storeStat.size : content.size
      }))
    }
    if (store && storeStat) {
      await this.registry.upsertAnchor({
        store_id: store.id,
        hash,
        path: storePath,
        verified_at: Date.now(),
        dev: storeStat.dev,
        ino: storeStat.ino,
        size: storeStat.size,
        mtime: storeStat.mtimeMs,
        ctime: storeStat.ctimeMs,
        nlink: storeStat.nlink,
        mode: storeStat.mode,
        uid: storeStat.uid,
        gid: storeStat.gid
      })
    } else if (store) {
      await this.registry.removeAnchor(store.id, hash)
    }
  }

  async reclassifyHashes(hashes) {
    const stores = this.anchorStores()
      .filter((store) =>
        store.available && Number.isFinite(store.dev))
      .map((store) => ({
        store_id: store.id,
        dev: store.dev,
        can_link: store.mode !== "copy"
      }))
    for (const hash of new Set(hashes)) {
      const anchorSnapshots = []
      for (const store of this.anchorStores()) {
        const storePath = this.storePathFor(hash, store.id)
        const stat = await this.storeStatIfPresent(storePath, {
          store_id: store.id
        })
        if (stat) anchorSnapshots.push(fileSnapshot(stat))
      }
      await this.registry.reclassifyHash(
        hash,
        stores,
        anchorSnapshots
      )
    }
  }

  async verifyStoreContent(hash, storePath, storeStat, storeId = null) {
    if (!storeStat || !storeStat.isFile()) return { valid: false }
    const store = storeId
      ? this._anchorStoresById.get(storeId)
      : this.anchorStoreForPath(storePath)
    if (!store) return { valid: false }
    const content = await this.registry.getContent(hash)
    const anchor = await this.registry.getAnchor(store.id, hash)
    if (anchor &&
        anchor.verified_at &&
        anchor.dev === storeStat.dev &&
        anchor.ino === storeStat.ino &&
        anchor.size === storeStat.size &&
        anchor.mtime === storeStat.mtimeMs &&
        anchor.ctime === storeStat.ctimeMs) {
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
      verified_at: Date.now()
    })
    await this.registry.upsertAnchor({
      store_id: store.id,
      hash,
      path: storePath,
      verified_at: Date.now(),
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      mtime: after.mtimeMs,
      ctime: after.ctimeMs,
      nlink: after.nlink,
      mode: after.mode,
      uid: after.uid,
      gid: after.gid
    })
    return { valid: true, snapshot: fileSnapshot(after) }
  }

  async adopt(filePath, hash, expected, selectedStore = null) {
    const current = await lstatIfPresent(filePath)
    if (!current ||
        !current.isFile() ||
        !sameSnapshot(expected, current)) {
      return { status: "stale" }
    }
    const store = selectedStore || this.anchorStoreForDevice(current.dev)
    if (!store) return { status: "unavailable" }
    const storePath = this.storePathFor(hash, store.id)
    let storeStat
    try {
      storeStat = await this.storeStatIfPresent(storePath, {
        createParent: true,
        dev: current.dev,
        store_id: store.id
      })
    } catch (error) {
      if (error && (
        error.code === "EVAULTUNAVAILABLE" ||
        NO_LINK_CODES.has(error.code) ||
        LOCK_CODES.has(error.code)
      )) {
        return { status: "unavailable" }
      }
      throw error
    }
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
    storeStat = await this.storeStatIfPresent(storePath, {
      store_id: store.id
    })
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
      first_seen: Date.now()
    })
    await this.registry.upsertAnchor({
      store_id: store.id,
      hash,
      path: storePath,
      verified_at: Date.now(),
      dev: storeStat.dev,
      ino: storeStat.ino,
      size: storeStat.size,
      mtime: storeStat.mtimeMs,
      ctime: storeStat.ctimeMs,
      nlink: storeStat.nlink,
      mode: storeStat.mode,
      uid: storeStat.uid,
      gid: storeStat.gid
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
    await this.refreshInodeSnapshots(hash, after.dev, after.ino, store.id)
    return { status: "ready", store_id: store.id }
  }

  async ensureAnchorForHash(hash, targetStat) {
    const dev = targetStat.dev
    const store = this.anchorStoreForDevice(dev)
    if (!store) return { status: "unavailable" }
    const storePath = this.storePathFor(hash, store.id)
    let existingStore
    try {
      existingStore = await this.storeStatIfPresent(storePath, {
        store_id: store.id
      })
      if (existingStore) await this.validateAnchorStore(store, dev)
    } catch (error) {
      if (error && (
        error.code === "EVAULTPATH" ||
        error.code === "EVAULTUNAVAILABLE" ||
        NO_LINK_CODES.has(error.code) ||
        LOCK_CODES.has(error.code)
      )) {
        return { status: "unavailable" }
      }
      throw error
    }
    if (existingStore) {
      if (existingStore.dev !== dev) return { status: "unavailable" }
      const verified = await this.verifyStoreContent(
        hash, storePath, existingStore, store.id)
      return verified.valid
        ? { status: "ready", stat: existingStore, store_id: store.id }
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
      candidate.path, hash, fileSnapshot(after), store)
    if (adopted.status !== "ready") return adopted
    return {
      status: "ready",
      store_id: store.id,
      stat: await this.storeStatIfPresent(storePath, {
        store_id: store.id
      })
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
    if (prepared.status !== "ready") {
      if (prepared.status === "unavailable") {
        await this.reclassifyHashes([target.hash])
      }
      return prepared
    }
    const storePath = this.storePathFor(target.hash, prepared.store_id)
    let storeStat = await this.storeStatIfPresent(
      storePath, { store_id: prepared.store_id })
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
      target.hash, storePath, storeStat, prepared.store_id)
    if (!verified.valid) return { status: "stale" }

    const temporary = `${target.path}${TMP_SUFFIX}`
    let temporaryStat = null
    let committedStat = null
    try {
      await fs.promises.link(storePath, temporary)
      temporaryStat = await fs.promises.lstat(temporary)
      if (this.sourceAppIsRunning(source)) {
        await unlinkIfSame(temporary, temporaryStat)
        return { status: "locked" }
      }
      const [currentTarget, currentStore, currentTemporary] =
        await Promise.all([
          lstatIfPresent(target.path),
          this.storeStatIfPresent(storePath, {
            store_id: prepared.store_id
          }),
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
    storeStat = await this.storeStatIfPresent(storePath, {
      store_id: prepared.store_id
    })
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
      target.hash, finalStat.dev, finalStat.ino, prepared.store_id)
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

  deduplicationSummary() {
    return {
      converted: 0,
      bytes_saved: 0,
      locked: 0,
      stale: 0,
      incompatible: 0,
      unavailable: 0,
      failed: 0
    }
  }

  addDeduplicationResult(summary, result) {
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
  }

  async recordDeduplicationSummary(
    summary,
    representative = null,
    sourceId = null
  ) {
    if (!summary.converted) return
    const event = {
      kind: "convert",
      bytes: summary.bytes_saved,
      files: summary.converted
    }
    if (summary.converted === 1 && representative) {
      event.hash = representative.hash
      event.path = representative.path
      event.app = representative.app
      event.source_id = representative.source_id
    } else if (sourceId) {
      event.source_id = sourceId
    }
    if (!await this.recordEvent(event)) summary.activity_warning = true
  }

  async deduplicateFiles(filePaths, progress = null) {
    const summary = Object.assign(this.deduplicationSummary(), {
      results: []
    })
    let representative = null
    let commonSourceId
    for (const filePath of new Set(filePaths.map((item) =>
      path.resolve(item)))) {
      try {
        const result = await this.convert(filePath)
        this.addDeduplicationResult(summary, result)
        if (result.status === "converted") {
          if (!representative) representative = result
          const sourceId = result.source_id || null
          commonSourceId = commonSourceId === undefined
            ? sourceId
            : commonSourceId === sourceId ? commonSourceId : null
        }
        summary.results.push({ path: filePath, status: result.status })
      } catch (error) {
        summary.failed += 1
        summary.results.push({ path: filePath, status: "failed" })
      } finally {
        if (progress) progress.files_completed += 1
      }
    }
    await this.recordDeduplicationSummary(
      summary,
      representative,
      commonSourceId
    )
    return summary
  }

  async deduplicateScope(scopeId = null, options = {}) {
    const sourceIds = this.scopeSourceIds(scopeId)
    const summary = this.deduplicationSummary()
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
          this.addDeduplicationResult(summary, result)
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
      await this.recordDeduplicationSummary(
        summary,
        null,
        scopedSource && scopedSource.kind !== "virtual"
          ? scopeId
          : null
      )
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

  async reclaim(hash, storeId = null) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      return { status: "not-found" }
    }
    const anchors = await this.registry.anchorsForHash(hash)
    const anchor = storeId
      ? anchors.find((item) => item.store_id === storeId)
      : anchors.length === 1 ? anchors[0] : null
    if (!anchor) return { status: "not-found" }
    const store = this._anchorStoresById.get(anchor.store_id)
    if (!store) return { status: "unavailable" }
    const storePath = this.storePathFor(hash, store.id)
    if (!samePath(storePath, anchor.path)) return { status: "stale" }
    try {
      await this.validateAnchorStore(store, anchor.dev)
    } catch (error) {
      return { status: "stale" }
    }
    const stat = await this.storeStatIfPresent(storePath, {
      store_id: store.id
    })
    if (!stat) {
      await this.registry.removeAnchor(store.id, hash)
      return { status: "gone" }
    }
    const expected = {
      size: anchor.size,
      mtime: anchor.mtime,
      ctime: anchor.ctime,
      dev: anchor.dev,
      ino: anchor.ino
    }
    if (!sameSnapshot(expected, stat)) return { status: "stale" }
    if (stat.nlink !== 1) return { status: "in-use" }
    await fs.promises.unlink(storePath)
    await this.registry.removeAnchor(store.id, hash)
    const hasFiles = await this.registry.hasFilesForHash(hash)
    const remainingAnchors = await this.registry.anchorsForHash(hash)
    if (!hasFiles && !remainingAnchors.length) {
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
    let cursor = { store_id: "", hash: "" }
    while (true) {
      const anchors = await this.registry.reclaimableBatch(cursor, 100)
      if (!anchors.length) break
      for (const row of anchors) {
        cursor = { store_id: row.store_id, hash: row.hash }
        try {
          const result = await this.reclaim(row.hash, row.store_id)
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

  publicDuplicateGroupItems(page) {
    return (page.rows || []).map((row) => Object.assign({
      kind: "duplicate_group",
      hash: row.hash,
      path: row.representative_path,
      size: Number(row.size) || 0,
      total_count: Number(row.total_count) || 0,
      eligible_count: Number(row.eligible_count) || 0,
      can_save: Number(row.can_save) || 0,
      app: row.representative_app || null
    }, this.locationForPath(
      row.representative_path,
      row.representative_source_id
    )))
  }

  publicDuplicateChildItems(rows) {
    const publicStatus = {
      reference: "tracked",
      duplicate: "duplicate",
      unavailable: "duplicate",
      linked: "shared"
    }
    return (rows || []).map((row) => Object.assign({
      kind: "duplicate_path",
      path: row.path,
      hash: row.hash,
      size: Number(row.size) || 0,
      app: row.app || null,
      status: publicStatus[row.status],
      registry_status: row.status,
      shareable: row.status === "duplicate",
      selectable: !!row.selectable,
      unavailable_reason: row.status === "unavailable"
        ? row.unavailable_reason || "different_disk"
        : null
    }, this.locationForPath(row.path, row.source_id)))
  }

  async duplicateGroupChildren(scopeId, hash, options = {}) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new TypeError("Invalid vault content identifier.")
    }
    const locationId = typeof options.location_id === "string" &&
      options.location_id
      ? options.location_id
      : null
    const query = String(options.query || "").slice(0, 500).trim()
    const cursor = typeof options.cursor === "string"
      ? options.cursor.slice(0, 2048)
      : ""
    const pageSize = boundedInteger(
      options.page_size, 100, 1, STATUS_PAGE_SIZE)
    const result = await this.registry.duplicateGroupChildren({
      hash,
      sourceIds: this.scopeSourceIds(scopeId),
      activeSourceIds: this.scopeSourceIds(scopeId, locationId),
      query,
      cursor,
      pageSize,
      unrestricted: !scopeId,
      activeUnrestricted: !scopeId && !locationId
    })
    return {
      hash,
      items: this.publicDuplicateChildItems(result.rows),
      total: Number(result.total) || 0,
      next_cursor: result.nextCursor || null
    }
  }

  async duplicateGroupSelection(scopeId, hash, options = {}) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new TypeError("Invalid vault content identifier.")
    }
    const locationId = typeof options.location_id === "string" &&
      options.location_id
      ? options.location_id
      : null
    const result = await this.registry.duplicateGroupSelection({
      hash,
      sourceIds: this.scopeSourceIds(scopeId, locationId),
      query: String(options.query || "").slice(0, 500).trim(),
      unrestricted: !scopeId && !locationId
    })
    return {
      hash,
      paths: result.paths || [],
      exceeded: !!result.exceeded
    }
  }

  async status(scopeId = null, options = {}) {
    if (!this.enabled || !this.registry) return { enabled: false }
    const view = STATUS_VIEWS.has(options.view) ? options.view : "all"
    const groupDuplicates =
      view === "duplicates" && options.display_mode === "files"
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
      sizeSort: groupDuplicates
        ? options.size_sort || "desc"
        : options.size_sort,
      groupDuplicates,
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
    } else if (groupDuplicates) {
      items = this.publicDuplicateGroupItems(snapshot.page)
    } else {
      items = this.publicFileItems(snapshot.page)
    }

    const lastScan = await this.scanForScope(scopeId)
    const before = lastScan && Number.isFinite(lastScan.bytes_total)
      ? lastScan.bytes_total
      : 0
    const saved = Math.max(0, Number(snapshot.saved) || 0)
    const currentCount = Number(snapshot.total) || 0
    const pageTotal = Number(snapshot.pageTotal) || 0
    const pages = Math.max(1, Math.ceil(pageTotal / pageSize))
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
          count: currentCount,
          locations: Number(snapshot.currentLocations) || 0,
          shareable_bytes:
            Number(snapshot.currentShareableBytes) || 0,
          deduplicate_bytes:
            Number(snapshot.currentDeduplicateBytes) || 0,
          separate_count:
            Number(snapshot.currentSeparateCount) || 0,
          separate_bytes:
            Number(snapshot.currentSeparateBytes) || 0
        },
        page: requestedPage,
        page_size: pageSize,
        start: requestedPage * pageSize,
        end: Math.min(
          (requestedPage * pageSize) + items.length,
          pageTotal
        ),
        total: pageTotal,
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
