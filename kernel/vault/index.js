const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Worker } = require('worker_threads')
const Registry = require('./registry')
const Sweeper = require('./sweeper')
const { walkBatches, statMany } = require('./walker')
const { fileSnapshot, sameSnapshot, sameContentState } = require('./snapshot')
const {
  SIZE_THRESHOLD, CANDIDATE_SIZE_OPTIONS, TMP_SUFFIX, SHA256_RE,
  DIR_CONCURRENCY, STAT_CONCURRENCY, HASH_INACTIVITY_MS
} = require('./constants')

// Shared model store engine (spec/requirements/shared-model-store.md).
// Store + registry + volume probe + hashing + adopt/convert/verify, plus the
// user-facing operations behind the vault dashboard (detach, undo, reclaim).
// Nothing here runs automatically except startup verify; discovery happens
// only through the user's manual scan.

const NO_LINK_CODES = new Set(["EXDEV", "ENOTSUP", "ENOSYS"])
const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES"])
const isMissingError = (error) => !!(error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
const isAccessError = (error) => !!(error && (error.code === "EACCES" || error.code === "EPERM"))
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
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
}

const samePath = (left, right) => {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

const sameFileMetadata = (left, right) => {
  if (!left || !right) return false
  if ((left.mode & 0o7777) !== (right.mode & 0o7777)) return false
  if (left.uid !== undefined && right.uid !== undefined && left.uid !== right.uid) return false
  if (left.gid !== undefined && right.gid !== undefined && left.gid !== right.gid) return false
  return true
}

const sourceId = (kind, name) => `${kind}:${encodeURIComponent(name)}`

class Vault {
  constructor(kernel) {
    this.kernel = kernel
    this.enabled = false
    this.initialized = false
    this.mode = null          // 'link' | 'copy' for the vault's own volume
    this.volumeModes = new Map()  // dev -> 'link' | 'copy'
    this.registry = null
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
    this._sourceBases = new Map()
    this.operationTail = Promise.resolve()
    this.initializationPromise = null
    this.verificationPending = false
    this.scanError = null
    this.scanScopeId = null
    this.fileActionProgress = null
  }
  get root() {
    return path.resolve(this.kernel.homedir, "vault")
  }
  get blobRoot() {
    return path.resolve(this.root, "sha256")
  }
  get sourceRoot() {
    return path.resolve(this.root, "sources")
  }
  storePathFor(hash) {
    if (typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new TypeError("Invalid vault content identifier.")
    }
    return path.resolve(this.blobRoot, hash.slice(0, 2), hash)
  }
  async directoryIfSafe(directory) {
    const st = await lstatIfPresent(directory)
    if (st && !st.isDirectory()) throw unsafeStoragePath(directory)
    return st
  }
  async ensureDirectory(directory) {
    let st = await this.directoryIfSafe(directory)
    if (st) return st
    try {
      await fs.promises.mkdir(directory)
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error
    }
    st = await this.directoryIfSafe(directory)
    if (!st) throw unsafeStoragePath(directory)
    return st
  }
  async storeStatIfPresent(storePath, options = {}) {
    if (!isPathWithin(this.blobRoot, storePath)) throw unsafeStoragePath(storePath)
    if (!await this.directoryIfSafe(this.root) || !await this.directoryIfSafe(this.blobRoot)) {
      throw unsafeStoragePath(this.blobRoot)
    }
    const shard = path.dirname(storePath)
    let shardStat = await this.directoryIfSafe(shard)
    if (!shardStat && options.createParent) shardStat = await this.ensureDirectory(shard)
    if (!shardStat) return null
    return lstatIfPresent(storePath)
  }
  // All dashboard mutations share one queue. Status reads remain concurrent,
  // while scans, conversions, repair, undo, detach, and reclaim can never
  // publish interleaved filesystem/registry state.
  runExclusive(operation) {
    const pending = this.operationTail.then(operation, operation)
    this.operationTail = pending.catch(() => {})
    return pending
  }
  // A filesystem mutation is committed before its registry snapshot is
  // flushed. Keep that distinction in the response: failed persistence is
  // retried by Registry and must not make an already-completed action look as
  // though it never happened.
  runMutation(operation) {
    return this.runExclusive(async () => {
      const result = await operation()
      try {
        if (this.registry) await this.registry.flush()
      } catch (error) {
        return Object.assign({}, result, { persistence_warning: true })
      }
      return result
    })
  }
  async runFileAction(progress, operation) {
    this.fileActionProgress = progress
    try {
      return await operation(progress)
    } finally {
      if (this.fileActionProgress === progress) this.fileActionProgress = null
    }
  }
  startScan(scopeId = null, sizeThreshold = this.sizeThreshold) {
    if (!this.enabled || !this.sweeper) return { started: false, disabled: true }
    if (this.scanPromise) return { started: false, already_running: true }
    this.sizeThreshold = sizeThreshold
    this.scanError = null
    this.scanScopeId = scopeId
    this.scanPromise = this.runExclusive(() => this.sweeper.scan(scopeId))
      .catch((error) => {
        this.scanError = error && error.message ? error.message : String(error)
        throw error
      })
      .finally(() => {
        this.scanPromise = null
        this.scanScopeId = null
      })
    this.scanPromise.catch(() => {})
    return { started: true }
  }
  async perform(action, payload = {}) {
    if (!this.enabled) return { error: "Save space is disabled." }
    await this.ensureInitialized()
    switch (action) {
      case "add_source": {
        const result = await this.runExclusive(() => this.addExternalSource(payload.path))
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
      case "scan": {
        if (payload.scope_id && !this.scanSource(payload.scope_id)) {
          return { error: "That scan location is no longer available." }
        }
        let sizeThreshold = this.sizeThreshold
        if (payload.candidate_size != null) {
          if (!CANDIDATE_SIZE_OPTIONS.includes(payload.candidate_size)) {
            return { error: "Choose a valid minimum file size." }
          }
          sizeThreshold = payload.candidate_size
        }
        return this.startScan(payload.scope_id || null, sizeThreshold)
      }
      case "deduplicate":
        if (typeof payload.path === "string" && payload.path) {
          return this.runMutation(() => this.runFileAction({
            kind: "deduplicate-file",
            path: path.resolve(payload.path)
          }, () => this.deduplicateFile(payload.path, {
            batch_id: `batch-${crypto.randomUUID()}`
          })))
        }
        const selection = payload.selection || null
        if (selection && selection !== "duplicates" && selection !== "kept-separate") {
          return { error: "Choose files to deduplicate." }
        }
        if (payload.scope_id != null &&
            (typeof payload.scope_id !== "string" || !payload.scope_id)) {
          return { error: "Choose a valid location to deduplicate." }
        }
        const scopeId = typeof payload.scope_id === "string" && payload.scope_id
          ? payload.scope_id
          : null
        if (!selection && !scopeId) {
          return { error: "Choose a location to deduplicate." }
        }
        return this.runMutation(() => this.runFileAction({
          kind: "deduplicate",
          scope_id: scopeId,
          selection: selection || "duplicates",
          files_total: 0,
          files_completed: 0
        }, async (progress) => {
          const options = {
            batch_id: `batch-${crypto.randomUUID()}`,
            progress
          }
          return selection
            ? this.deduplicateSelection(selection, scopeId, options)
            : this.deduplicateScope(scopeId, options)
        }))
      case "reclaim":
        return this.runMutation(() => this.reclaim(payload.hash))
      case "reclaim_all":
        return this.runMutation(() => this.reclaimAll())
      case "repair":
      case "rebuild":
        if (this.scanPromise || (this.sweeper && this.sweeper.state.active)) {
          return { error: "Wait for the current scan to finish before repairing the index." }
        }
        return this.runMutation(async () => {
          await this.rebuild(undefined, { flush: false })
          return { done: true }
        })
      case "undo":
        return this.runMutation(() => this.undoBatch(payload.batch_id))
      case "detach":
        if (typeof payload.path !== "string" || !payload.path) return { status: "not-found" }
        return this.runMutation(() => {
          const targetPath = path.resolve(payload.path)
          const kind = this.registry.duplicates.has(targetPath)
            ? "keep-separate"
            : "make-separate"
          return this.runFileAction({ kind, path: targetPath }, () => this.detach(targetPath))
        })
      default:
        return { error: "unknown action" }
    }
  }
  async refreshSources() {
    const home = path.resolve(this.kernel.homedir)
    const apiRoot = path.resolve(home, "api")
    const sources = [
      { id: "pinokio", kind: "pinokio", label: "Pinokio", root: home, parent_id: null },
      { id: "apps", kind: "virtual", label: "Apps", root: apiRoot, parent_id: "pinokio" },
      { id: "external", kind: "virtual", label: "External folders", root: null, parent_id: null }
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
        const st = await fs.promises.stat(source.root)
        source.dev = st.dev
        source.available = st.isDirectory()
        source.shareable = source.available && storeDev !== null && st.dev === storeDev && this.mode === "link"
      } catch (error) {
        if (!isMissingError(error)) throw error
        source.available = false
        source.shareable = false
      }
      return source
    }

    const seenExternalRoots = new Set()
    const addExternalEntries = async (importRoot, idPrefix = "") => {
      let entries = []
      try {
        entries = await fs.promises.readdir(importRoot, { withFileTypes: true })
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
      for (const entry of entries) {
        if (!entry.isSymbolicLink()) continue
        const mountPath = path.resolve(importRoot, entry.name)
        try {
          const root = await fs.promises.realpath(mountPath)
          const st = await fs.promises.stat(root)
          if (!st.isDirectory()) continue
          const canonical = path.resolve(root)
          if (seenExternalRoots.has(canonical)) continue
          seenExternalRoots.add(canonical)
          sources.push(await decorate({
            id: sourceId("external", `${idPrefix}${entry.name}`), kind: "external", label: entry.name,
            root: canonical, mount_path: mountPath, parent_id: "external"
          }))
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
    }

    let apiEntries = []
    try {
      apiEntries = await fs.promises.readdir(apiRoot, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    for (const entry of apiEntries) {
      const mountPath = path.resolve(apiRoot, entry.name)
      if (entry.isDirectory()) {
        sources.push(await decorate({
          id: sourceId("app", entry.name), kind: "app", label: entry.name,
          app: entry.name, root: mountPath, parent_id: "apps"
        }))
      }
    }
    await addExternalEntries(apiRoot)
    if (await this.directoryIfSafe(this.sourceRoot)) {
      await addExternalEntries(this.sourceRoot, "vault:")
    }

    let homeEntries = []
    try {
      homeEntries = await fs.promises.readdir(home, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    for (const entry of homeEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "api" || entry.name === "vault") continue
      sources.push(await decorate({
        id: sourceId("folder", entry.name), kind: "folder", label: entry.name,
        root: path.resolve(home, entry.name), parent_id: "pinokio"
      }))
    }
    const homeSource = sources.find((source) => source.id === "pinokio")
    if (homeSource) await decorate(homeSource)
    this._sources = sources
    this._sourceBases = new Map()
    for (const source of sources) {
      if (!source.root || source.kind === "virtual") continue
      for (const base of [source.root, source.mount_path]) {
        if (!base) continue
        const resolved = path.resolve(base)
        const key = process.platform === "win32" ? resolved.toLowerCase() : resolved
        if (!this._sourceBases.has(key)) this._sourceBases.set(key, [])
        this._sourceBases.get(key).push(source)
      }
    }
    return sources
  }
  sources() {
    return this._sources
  }
  async addExternalSource(folderPath) {
    if (!this.enabled) throw new Error("Save space is disabled.")
    if (typeof folderPath !== "string" || !path.isAbsolute(folderPath.trim())) {
      throw new Error("Choose a valid folder.")
    }
    const requested = folderPath.trim()
    let canonical
    let stats
    try {
      canonical = path.resolve(await fs.promises.realpath(requested))
      stats = await fs.promises.stat(canonical)
    } catch (error) {
      throw new Error("That folder is no longer available.")
    }
    if (!stats.isDirectory()) throw new Error("Choose a folder, not a file.")

    const home = path.resolve(this.kernel.homedir)
    const canonicalHome = path.resolve(await fs.promises.realpath(home))
    if (isPathWithin(canonicalHome, canonical) || isPathWithin(canonical, canonicalHome)) {
      throw new Error("That folder is already inside Pinokio and is included in scans.")
    }

    await this.refreshSources()
    const existing = this._sources.find((source) => source.kind === "external" && source.root && samePath(source.root, canonical))
    if (existing) {
      return { created: false, source: existing }
    }

    const importRoot = this.sourceRoot
    await this.ensureDirectory(importRoot)
    const baseLabel = path.basename(canonical) || "external-folder"
    let mountPath = null
    for (let index = 1; index < 10000; index++) {
      const label = index === 1 ? baseLabel : `${baseLabel}-${index}`
      const candidate = path.resolve(importRoot, label)
      try {
        await fs.promises.symlink(canonical, candidate, this.kernel.platform === "win32" ? "junction" : "dir")
        mountPath = candidate
        break
      } catch (error) {
        if (error && error.code === "EEXIST") continue
        if (error && (error.code === "EACCES" || error.code === "EPERM")) {
          throw new Error("Pinokio does not have permission to add that folder.")
        }
        throw new Error("Pinokio could not add that folder.")
      }
    }
    if (!mountPath) throw new Error("Pinokio could not create a unique name for that folder.")

    try {
      await this.refreshSources()
      const source = this._sources.find((item) => item.kind === "external" && item.mount_path && samePath(item.mount_path, mountPath))
      if (!source) throw new Error("The folder could not be added. Restart Pinokio and try again.")
      return { created: true, source }
    } catch (error) {
      // Adding a source is transactional. Roll back only the exact directory
      // link created above; preserve any path an external writer replaced.
      try {
        const [mounted, target] = await Promise.all([
          fs.promises.lstat(mountPath),
          fs.promises.realpath(mountPath)
        ])
        if (mounted.isSymbolicLink() && samePath(target, canonical)) {
          await fs.promises.unlink(mountPath)
        }
      } catch {
        // The original error remains authoritative; an unverified path is
        // deliberately preserved rather than deleted.
      }
      throw error
    }
  }
  sourceForPath(filePath, preferredId) {
    let cursor = path.resolve(filePath)
    while (true) {
      const key = process.platform === "win32" ? cursor.toLowerCase() : cursor
      const matches = this._sourceBases.get(key)
      if (matches && matches.length) {
        return matches.find((source) => source.id === preferredId) || matches[0]
      }
      const parent = path.dirname(cursor)
      if (parent === cursor) return null
      cursor = parent
    }
  }
  async canonicalPathIsWithinSource(filePath, source, options = {}) {
    if (!source || !source.root) return false
    try {
      const [canonicalRoot, canonicalFile] = await Promise.all([
        fs.promises.realpath(source.root),
        fs.promises.realpath(filePath)
      ])
      return isPathWithin(canonicalRoot, canonicalFile)
    } catch (error) {
      if (options.strictErrors && !isMissingError(error)) throw error
      return false
    }
  }
  locationForPath(filePath, preferredId) {
    const source = this.sourceForPath(filePath, preferredId)
    if (!source) return { source_id: null, relative_path: path.basename(filePath) }
    const absolute = path.resolve(filePath)
    let base = source.root
    if (source.mount_path && isPathWithin(source.mount_path, absolute)) base = source.mount_path
    const relative = path.relative(base, absolute).split(path.sep).join("/") || path.basename(absolute)
    return {
      source_id: source.id,
      source_kind: source.kind,
      source_label: source.label,
      relative_path: relative
    }
  }
  async recordEvent(event) {
    let entry = event
    if (event.path) {
      const location = this.locationForPath(event.path, event.source_id)
      const context = location.source_id ? location : { relative_path: event.path }
      entry = Object.assign({}, event, context)
    }
    try {
      await this.registry.appendEvent(entry)
      return true
    } catch (error) {
      return false
    }
  }
  scanSource(scopeId) {
    if (!scopeId) return null
    return this._sources.find((source) =>
      source.id === scopeId && source.kind !== "virtual" && source.available && source.root) || null
  }
  scanRoots(scopeId = null) {
    if (scopeId) {
      const source = this.scanSource(scopeId)
      return source ? [{ root: path.resolve(source.root), source_id: source.id }] : []
    }
    const home = path.resolve(this.kernel.homedir)
    const candidates = [{ root: home, source_id: "pinokio" }]
    for (const source of this._sources) {
      if (source.kind !== "external" || !source.available || !source.root) continue
      const canonical = path.resolve(source.root)
      if (isPathWithin(home, canonical) || isPathWithin(canonical, home)) continue
      candidates.push({ root: canonical, source_id: source.id })
    }
    candidates.sort((left, right) => left.root.length - right.root.length)
    const roots = []
    for (const candidate of candidates) {
      if (roots.some((existing) => isPathWithin(existing.root, candidate.root))) continue
      roots.push(candidate)
    }
    return roots
  }
  reconcileConfiguredSources() {
    if (!this.registry) return
    const configured = (filePath, sourceId) => !!this.sourceForPath(filePath, sourceId)
    for (const [filePath, entry] of [...this.registry.links]) {
      if (!configured(filePath, entry.source_id)) this.registry.untrack(filePath)
    }
    for (const [filePath, entry] of [...this.registry.duplicates]) {
      if (!configured(filePath, entry.source_id)) this.registry.untrack(filePath)
    }
    for (const [filePath, entry] of [...this.registry.scanIndex]) {
      if (!configured(filePath, entry.source_id)) this.registry.untrack(filePath)
    }
  }
  // Kill switch: system ENVIRONMENT variable PINOKIO_VAULT, default unset =
  // enabled. Read directly (single key) to avoid loading the environment
  // module chain before the kernel is fully up.
  async isEnabled() {
    let value = process.env.PINOKIO_VAULT
    if (value === undefined && this.kernel.homedir) {
      try {
        const raw = await fs.promises.readFile(path.resolve(this.kernel.homedir, "ENVIRONMENT"), "utf8")
        for (const line of raw.split("\n")) {
          const m = line.match(/^\s*PINOKIO_VAULT\s*=\s*(.*)\s*$/)
          if (m) value = m[1].trim()
        }
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
    }
    return String(value).toLowerCase() !== "false"
  }
  // Disabled ⇒ do nothing observable: no directory, no registry, no probes.
  async init(options = {}) {
    this.enabled = await this.isEnabled()
    if (!this.enabled) return { enabled: false }
    if (options.existingOnly) {
      try {
        await fs.promises.stat(this.root)
      } catch (error) {
        if (error && error.code === "ENOENT") return { enabled: true, fresh: true }
        throw error
      }
    }
    return this.initializeStorage()
  }
  async initializeStorage() {
    if (this.initialized) return { enabled: true, mode: this.mode }
    await this.ensureDirectory(this.root)
    await this.ensureDirectory(this.blobRoot)
    this.registry = new Registry(this.root)
    this.mode = await this.probe(this.root)
    await this.refreshSources()
    const loaded = await this.registry.load()
    const missingWithBlobs = !loaded.existed && await this.hasStoredBlobs()
    if (loaded.corrupt || missingWithBlobs) {
      await this.rebuild(undefined, { preserveState: false })
    }
    this.sweeper = new Sweeper(this)
    this.initialized = true
    return {
      enabled: true,
      mode: this.mode,
      corrupt_recovered: !!loaded.corrupt,
      missing_recovered: missingWithBlobs
    }
  }
  async ensureInitialized() {
    if (!this.enabled) return { enabled: false }
    if (this.initialized && !this.verificationPending) return { enabled: true, mode: this.mode }
    if (!this.initializationPromise) {
      this.initializationPromise = (async () => {
        const result = this.initialized
          ? { enabled: true, mode: this.mode }
          : await this.initializeStorage()
        await this.runExclusive(async () => {
          await this.verify()
          await this.registry.flush()
        })
        this.verificationPending = false
        return result
      })().catch((error) => {
        if (this.initialized) this.verificationPending = true
        throw error
      }).finally(() => {
        this.initializationPromise = null
      })
    }
    return this.initializationPromise
  }
  async hasStoredBlobs() {
    let shards = []
    try {
      shards = await fs.promises.readdir(this.blobRoot, { withFileTypes: true })
    } catch (error) {
      if (isMissingError(error)) return false
      throw error
    }
    for (const shard of shards) {
      if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue
      const shardPath = path.resolve(this.blobRoot, shard.name)
      const shardStat = await this.directoryIfSafe(shardPath)
      if (!shardStat) continue
      let names = []
      try {
        names = await fs.promises.readdir(shardPath)
      } catch (error) {
        if (isMissingError(error)) continue
        throw error
      }
      if (names.some((name) => SHA256_RE.test(name) && name.startsWith(shard.name))) return true
    }
    return false
  }
  // Capability probe: temp file + node:fs.link + nlink check. Once per volume.
  async probe(dir) {
    const dev = (await fs.promises.stat(dir)).dev
    if (this.volumeModes.has(dev)) return this.volumeModes.get(dev)
    const a = path.resolve(dir, `.pinokio-probe-${crypto.randomBytes(6).toString("hex")}`)
    const b = a + "-link"
    let mode = "copy"
    let aStat = null
    let bStat = null
    let failure = null
    try {
      await fs.promises.writeFile(a, "probe", { flag: "wx" })
      aStat = await fs.promises.lstat(a)
      await fs.promises.link(a, b)
      bStat = await fs.promises.lstat(b)
      if (sameIdentity(bStat, aStat) && bStat.nlink === 2) mode = "link"
    } catch (error) {
      if (!NO_LINK_CODES.has(error && error.code)) failure = error
    } finally {
      try {
        await unlinkIfSame(b, bStat)
        await unlinkIfSame(a, aStat)
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
      worker.on("message", ({ id, hash, size, bytes_read: bytesRead, error, code }) => {
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
        // Keep the worker warm across the scan queue. Starting one worker per
        // file costs ~30ms and adds up quickly on a first scan.
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
        this.failHashWorker(worker, error)
      })
      worker.on("exit", (code) => {
        if (this.worker !== worker) return
        this.failHashWorker(worker, new Error(`hash worker exited with code ${code}`))
      })
    }
    const worker = this.worker
    const id = ++this.workerSeq
    return new Promise((resolve, reject) => {
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : null
      const job = {
        worker,
        resolve,
        reject,
        reportProgress: (bytes) => {
          if (!onProgress) return
          // Progress is observational and must never fail a content hash.
          try { onProgress(bytes) } catch (_) {}
        },
        inactivityTimer: null,
        resetInactivity: null
      }
      job.resetInactivity = () => {
        clearTimeout(job.inactivityTimer)
        const inactivityMs = Math.max(1, Number(this.hashInactivityMs) || HASH_INACTIVITY_MS)
        job.inactivityTimer = setTimeout(() => {
          const failure = new Error(`Timed out while reading ${path.basename(filePath)}`)
          failure.code = "ETIMEDOUT"
          this.failHashWorker(worker, failure, true)
        }, inactivityMs)
        if (job.inactivityTimer.unref) job.inactivityTimer.unref()
      }
      this.workerJobs.set(id, job)
      job.resetInactivity()
      try {
        worker.postMessage({ id, filePath })
      } catch (error) {
        this.failHashWorker(worker, error, true)
      }
    })
  }
  async refreshLinkSnapshots(hash, dev, ino) {
    if (!this.registry) return
    const key = this.registry.inoKey(dev, ino)
    const paths = [...(this.registry.pathsByIno.get(key) || [])]
    for (const linkPath of paths) {
      const entry = this.registry.links.get(linkPath)
      if (!entry || entry.hash !== hash) continue
      try {
        const source = this.sourceForPath(linkPath, entry.source_id)
        if (!source || !await this.canonicalPathIsWithinSource(linkPath, source)) continue
        const st = await fs.promises.lstat(linkPath)
        if (st.dev !== dev || st.ino !== ino) continue
        this.registry.setScanEntry(linkPath, Object.assign(fileSnapshot(st), {
          hash,
          source_id: entry.source_id || null
        }))
      } catch (error) {}
    }
    this.registry.schedulePersist()
  }
  async verifyStoreContent(hash, storePath, storeStat) {
    if (!storeStat || !storeStat.isFile()) return { valid: false }
    const key = this.registry.inoKey(storeStat.dev, storeStat.ino)
    for (const linkPath of this.registry.pathsByIno.get(key) || []) {
      const entry = this.registry.links.get(linkPath)
      if (!entry) continue
      if (entry.hash !== hash || entry.mode !== "link" ||
          entry.dev !== storeStat.dev || entry.ino !== storeStat.ino) continue
      const expected = this.registry.scanIndex.get(linkPath)
      if (expected && expected.hash === hash && sameSnapshot(expected, storeStat)) {
        return { valid: true, snapshot: fileSnapshot(storeStat) }
      }
    }

    const before = fileSnapshot(storeStat)
    let hashed
    try {
      hashed = await this.hashFile(storePath)
    } catch (error) {
      return { valid: false }
    }
    let after
    try {
      after = await this.storeStatIfPresent(storePath)
    } catch (error) {
      return { valid: false }
    }
    if (!sameSnapshot(before, after) || hashed.hash !== hash || hashed.size !== after.size) {
      return { valid: false }
    }
    await this.refreshLinkSnapshots(hash, after.dev, after.ino)
    return { valid: true, snapshot: fileSnapshot(after) }
  }
  // adopt: give an existing file a store name. Metadata-only, never copies.
  async adopt(filePath, hash, meta = {}) {
    if (!this.enabled) return { status: "disabled" }
    const storePath = this.storePathFor(hash)
    const st = await fs.promises.lstat(filePath)
    if (!st.isFile()) return { status: "stale" }
    if (meta.expected && !sameSnapshot(meta.expected, st)) return { status: "stale" }
    const before = fileSnapshot(st)
    const linkEntry = {
      hash,
      app: meta.app || null,
      source_id: meta.source_id || null,
      dev: st.dev,
      ino: st.ino,
      mode: "link"
    }
    const storeStat = await this.storeStatIfPresent(storePath, {
      createParent: this.mode === "link"
    })
    if (storeStat) {
      if (storeStat.dev === st.dev && storeStat.ino === st.ino) {
        const current = await lstatIfPresent(filePath)
        if (!sameSnapshot(before, current)) return { status: "stale" }
        this.registry.addBlob(hash, { size: st.size, source_urls: meta.source_urls || [] })
        this.registry.addLink(filePath, linkEntry)
        await this.refreshLinkSnapshots(hash, st.dev, st.ino)
        return { status: "already" }
      }
      const current = await lstatIfPresent(filePath)
      if (!sameSnapshot(before, current)) return { status: "stale" }
      return { status: "duplicate", storePath }
    }
    const registerCopy = async () => {
      const current = await lstatIfPresent(filePath)
      if (!sameSnapshot(before, current)) return { status: "stale" }
      linkEntry.mode = "copy"
      this.registry.addBlob(hash, { size: st.size, source_urls: meta.source_urls || [] })
      this.registry.addLink(filePath, linkEntry)
      await this.refreshLinkSnapshots(hash, st.dev, st.ino)
      await this.recordEvent({
        kind: "adopt", hash, path: filePath, app: meta.app || null,
        source_id: meta.source_id || null, bytes_saved: 0, mode: "copy"
      })
      return { status: "copy-mode" }
    }
    if (this.mode === "copy") return registerCopy()
    try {
      await fs.promises.link(filePath, storePath)
    } catch (e) {
      if (NO_LINK_CODES.has(e.code)) {
        return registerCopy()
      }
      throw e
    }
    const [current, currentStore] = await Promise.all([
      lstatIfPresent(filePath),
      this.storeStatIfPresent(storePath)
    ])
    if (!sameContentState(before, current) || !currentStore ||
        currentStore.dev !== st.dev || currentStore.ino !== st.ino) {
      // Remove only a store name that still points either to the inode we
      // intended to link or to the current source inode that won the race.
      // An unrelated replacement at the reserved store path is preserved.
      const ownsStoreName = currentStore && (
        (currentStore.dev === st.dev && currentStore.ino === st.ino) ||
        (current && currentStore.dev === current.dev && currentStore.ino === current.ino)
      )
      if (ownsStoreName) {
        try {
          await fs.promises.unlink(storePath)
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
      return { status: "stale" }
    }
    this.registry.addBlob(hash, { size: st.size, source_urls: meta.source_urls || [] })
    this.registry.addLink(filePath, linkEntry)
    await this.refreshLinkSnapshots(hash, st.dev, st.ino)
    await this.recordEvent({ kind: "adopt", hash, path: filePath, app: meta.app || null, source_id: meta.source_id || null, bytes_saved: 0 })
    return { status: "adopted" }
  }
  // convert: replace a byte-identical duplicate with a link to an existing
  // blob. Atomic link+rename; target is never missing at any instant.
  async convert(targetPath, hash, meta = {}) {
    if (!this.enabled) return { status: "disabled" }
    const storePath = this.storePathFor(hash)
    let storeStat
    try {
      storeStat = await this.storeStatIfPresent(storePath)
    } catch (e) {
      return { status: "no-blob" }
    }
    if (!storeStat) return { status: "no-blob" }
    let targetStat = await fs.promises.lstat(targetPath)
    if (!storeStat.isFile() || !targetStat.isFile()) return { status: "stale" }
    if (meta.expected && !sameSnapshot(meta.expected, targetStat)) {
      // Windows metadata operations can change ctime without changing the
      // file's identity or bytes. Recover only that isolated mismatch by
      // hashing the target again, then retain the exact pre-rename check below.
      if (!sameContentState(meta.expected, targetStat)) return { status: "stale" }
      const before = fileSnapshot(targetStat)
      let verifiedTarget
      try {
        verifiedTarget = await this.hashFile(targetPath)
      } catch (error) {
        return { status: "stale" }
      }
      const after = await lstatIfPresent(targetPath)
      if (!sameSnapshot(before, after) ||
          verifiedTarget.hash !== hash || verifiedTarget.size !== after.size) {
        return { status: "stale" }
      }
      targetStat = after
    }
    if (storeStat.dev !== targetStat.dev) {
      return { status: "unavailable", code: "EXDEV" }
    }
    if (storeStat.dev === targetStat.dev && storeStat.ino === targetStat.ino) {
      this.registry.addLink(targetPath, { hash, app: meta.app || null, source_id: meta.source_id || null, dev: storeStat.dev, ino: storeStat.ino, mode: "link" })
      await this.refreshLinkSnapshots(hash, storeStat.dev, storeStat.ino)
      return { status: "already" }
    }
    if (storeStat.size !== targetStat.size) {
      return { status: "size-mismatch" }
    }
    if (!sameFileMetadata(storeStat, targetStat)) {
      return { status: "metadata-mismatch" }
    }
    const verifiedStore = await this.verifyStoreContent(hash, storePath, storeStat)
    if (!verifiedStore.valid) return { status: "stale-blob" }
    if (meta.source && this.sourceAppIsRunning(meta.source)) return { status: "locked" }
    const tmp = targetPath + TMP_SUFFIX
    let ownsTmp = false
    try {
      try {
        await fs.promises.link(storePath, tmp)
        ownsTmp = true
      } catch (e) {
        if (e.code === "EEXIST") {
          let tmpStat = null
          try { tmpStat = await fs.promises.lstat(tmp) } catch (error) {}
          if (!tmpStat || tmpStat.dev !== storeStat.dev || tmpStat.ino !== storeStat.ino) {
            return { status: "conflict" }
          }
        } else {
          throw e
        }
      }
      // Narrow the portable stat/rename race as far as Node permits. The app
      // guard prevents known Pinokio writers; arbitrary external writers in the
      // final syscall-sized interval are the documented residual limitation.
      if (meta.source && this.sourceAppIsRunning(meta.source)) {
        if (ownsTmp) await unlinkIfSame(tmp, storeStat).catch(() => {})
        return { status: "locked" }
      }
      const currentTmpStat = await lstatIfPresent(tmp)
      if (!currentTmpStat || currentTmpStat.dev !== storeStat.dev || currentTmpStat.ino !== storeStat.ino) {
        if (ownsTmp) await unlinkIfSame(tmp, storeStat).catch(() => {})
        return { status: "conflict" }
      }
      const currentTargetStat = await fs.promises.lstat(targetPath)
      if (!sameSnapshot(fileSnapshot(targetStat), currentTargetStat)) {
        if (ownsTmp) await unlinkIfSame(tmp, storeStat).catch(() => {})
        return { status: "stale" }
      }
      const currentStoreStat = await this.storeStatIfPresent(storePath)
      // Creating our temporary hardlink changes ctime on the shared inode.
      // Identity, size, and mtime still detect replacement or content writes.
      if (!currentStoreStat || !sameContentState(verifiedStore.snapshot, currentStoreStat) ||
          !sameFileMetadata(currentStoreStat, currentTargetStat)) {
        if (ownsTmp) await unlinkIfSame(tmp, storeStat).catch(() => {})
        return { status: "stale-blob" }
      }
      await fs.promises.rename(tmp, targetPath)
      ownsTmp = false
    } catch (e) {
      if (ownsTmp) await unlinkIfSame(tmp, storeStat).catch(() => {})
      if (LOCK_CODES.has(e.code)) {
        return { status: "locked" }
      }
      if (NO_LINK_CODES.has(e.code)) {
        return { status: "unavailable", code: e.code }
      }
      throw e
    }
    let st
    try {
      st = await fs.promises.lstat(targetPath)
    } catch (error) {
      if (isMissingError(error)) return { status: "stale" }
      // rename() is the commit point: it succeeded with a temporary name
      // whose identity was already verified. A later metadata read failure
      // must not report the completed replacement as failed.
      st = storeStat
    }
    if (st.dev !== storeStat.dev || st.ino !== storeStat.ino) {
      return { status: "stale" }
    }
    this.registry.addLink(targetPath, {
      hash, app: meta.app || null, source_id: meta.source_id || null,
      dev: st.dev, ino: st.ino, mode: "link", batch_id: meta.batch_id || null
    })
    await this.refreshLinkSnapshots(hash, st.dev, st.ino)
    this.registry.addSaved(storeStat.size)
    await this.recordEvent({
      kind: "convert", hash, path: targetPath, app: meta.app || null, source_id: meta.source_id || null,
      bytes_saved: storeStat.size, batch_id: meta.batch_id || null
    })
    return { status: "converted", bytes_saved: storeStat.size }
  }
  sourceAppIsRunning(source) {
    if (!source || source.kind !== "app") return false
    const appRoot = path.resolve(this.kernel.homedir, "api", source.app)
    const api = this.kernel.api || {}
    const running = api.running || {}
    const runningPaths = api.running_paths || {}
    return Object.keys(running).some((runningId) => {
      if (!running[runningId]) return false
      const runningPath = runningPaths[runningId] || (path.isAbsolute(runningId) ? runningId.split("?")[0] : null)
      return !!(runningPath && isPathWithin(appRoot, runningPath))
    })
  }
  async deduplicateFile(filePath, options = {}) {
    if (!this.enabled || typeof filePath !== "string" || !filePath) {
      return { status: this.enabled ? "not-found" : "disabled" }
    }
    await this.refreshSources()
    return this.deduplicateExcludedFile(filePath, options)
  }
  async deduplicateExcludedFile(filePath, options = {}) {
    const targetPath = path.resolve(filePath)
    const excluded = this.registry.excluded.get(targetPath)
    if (!excluded) return { status: "not-found" }
    const source = this.sourceForPath(targetPath, excluded.source_id)
    if (!source || !await this.canonicalPathIsWithinSource(targetPath, source)) {
      return { status: "stale" }
    }
    if (!source.shareable) return { status: "unavailable" }
    if (this.sourceAppIsRunning(source)) return { status: "locked" }

    const before = await lstatIfPresent(targetPath)
    if (!before || !before.isFile()) return { status: "stale" }
    let hashed
    try {
      hashed = await this.hashFile(targetPath)
    } catch (error) {
      return { status: "stale" }
    }
    const after = await lstatIfPresent(targetPath)
    if (!sameSnapshot(fileSnapshot(before), after) || hashed.size !== after.size) {
      return { status: "stale" }
    }
    if (!this.registry.blobs.has(hashed.hash)) return { status: "no-match" }
    if (!await this.canonicalPathIsWithinSource(targetPath, source)) return { status: "stale" }
    const current = await lstatIfPresent(targetPath)
    if (!sameSnapshot(fileSnapshot(after), current)) return { status: "stale" }

    const result = await this.convert(targetPath, hashed.hash, {
      app: source.kind === "app" ? source.app : null,
      source_id: source.id,
      batch_id: options.batch_id || `batch-${crypto.randomUUID()}`,
      source,
      expected: fileSnapshot(current)
    })
    if (result.status === "converted" || result.status === "already") {
      this.registry.allowSharing(targetPath)
    }
    return result
  }
  sourceIsWithinScope(source, scopeId) {
    if (!scopeId) return true
    const seen = new Set()
    let current = source
    while (current && !seen.has(current.id)) {
      if (current.id === scopeId) return true
      seen.add(current.id)
      current = this._sources.find((item) => item.id === current.parent_id)
    }
    return false
  }
  async deduplicateSelection(selection, scopeId, options = {}) {
    if (selection === "duplicates") {
      return this.deduplicateScope(scopeId, Object.assign({}, options, { includeDescendants: true }))
    }
    await this.refreshSources()
    if (scopeId && !this._sources.some((source) => source.id === scopeId)) {
      return { error: "That location is no longer available. Scan again to refresh it." }
    }
    const paths = [...this.registry.excluded].filter(([filePath, entry]) => {
      const source = this.sourceForPath(filePath, entry.source_id)
      return source ? this.sourceIsWithinScope(source, scopeId) : !scopeId
    }).map(([filePath]) => filePath)
    if (options.progress) options.progress.files_total = paths.length
    const summary = {
      converted: 0, bytes_saved: 0, locked: 0, stale: 0, unmatched: 0,
      incompatible: 0, unavailable: 0, failed: 0
    }
    const batch = options.batch_id || `batch-${crypto.randomUUID()}`
    for (const filePath of paths) {
      try {
        const result = await this.deduplicateExcludedFile(filePath, { batch_id: batch })
        if (result.status === "converted" || result.status === "already") {
          summary.converted += 1
          summary.bytes_saved += result.bytes_saved || 0
        } else if (result.status === "locked") {
          summary.locked += 1
        } else if (result.status === "stale") {
          summary.stale += 1
        } else if (result.status === "no-match" || result.status === "no-blob" ||
            result.status === "size-mismatch") {
          summary.unmatched += 1
        } else if (result.status === "metadata-mismatch") {
          summary.incompatible += 1
        } else if (result.status === "unavailable" || result.status === "copy-mode") {
          summary.unavailable += 1
        } else {
          summary.failed += 1
        }
      } catch (error) {
        summary.failed += 1
      }
      if (options.progress) options.progress.files_completed += 1
    }
    return summary
  }
  async deduplicateScope(scopeId, options = {}) {
    await this.refreshSources()
    const includeDescendants = options.includeDescendants === true
    const source = scopeId
      ? this._sources.find((item) => item.id === scopeId && (includeDescendants || item.kind !== "virtual"))
      : null
    if ((!includeDescendants || scopeId) && !source) {
      return { error: "That location is no longer available. Scan again to refresh it." }
    }
    if (!includeDescendants) {
      if (!source.shareable) return { error: "This location is on a disk that cannot share space with this vault." }
      if (this.sourceAppIsRunning(source)) {
        return { error: "This app has a running script. Stop it first, then deduplicate." }
      }
    }

    const registry = this.registry
    const batch = options.batch_id || `batch-${crypto.randomUUID()}`
    const summary = { converted: 0, bytes_saved: 0, locked: 0, stale: 0, incompatible: 0, unavailable: 0, failed: 0 }
    const staleHashes = new Set()
    const entries = [...registry.duplicates]
    const matchesScope = (currentSource) => currentSource && currentSource.shareable &&
      (includeDescendants ? this.sourceIsWithinScope(currentSource, scopeId) : currentSource.id === scopeId)
    if (options.progress) {
      options.progress.files_total = entries.reduce((total, [filePath, entry]) => {
        const currentSource = this.sourceForPath(filePath, entry.source_id)
        return total + (matchesScope(currentSource) ? 1 : 0)
      }, 0)
    }
    const completeProgress = () => {
      if (options.progress) options.progress.files_completed += 1
    }
    for (const [filePath, entry] of entries) {
      const currentSource = this.sourceForPath(filePath, entry.source_id)
      if (!matchesScope(currentSource)) continue
      if (!await this.canonicalPathIsWithinSource(filePath, currentSource)) {
        summary.stale += 1
        completeProgress()
        continue
      }
      const indexed = registry.scanIndex.get(filePath)
      const expected = indexed && indexed.hash === entry.hash
        ? indexed
        : (entry.dev !== undefined && entry.ino !== undefined &&
            entry.mtime !== undefined && entry.ctime !== undefined ? entry : null)
      if (!expected) {
        summary.stale += 1
        completeProgress()
        continue
      }
      if (staleHashes.has(entry.hash)) {
        summary.stale += 1
        completeProgress()
        continue
      }
      try {
        const result = await this.convert(filePath, entry.hash, {
          app: currentSource.kind === "app" ? currentSource.app : (entry.app || null),
          source_id: currentSource.id,
          batch_id: batch,
          source: currentSource,
          expected
        })
        if (result.status === "converted" || result.status === "already") {
          summary.converted += 1
          summary.bytes_saved += result.bytes_saved || 0
        } else if (result.status === "locked") {
          summary.locked += 1
        } else if (result.status === "stale") {
          summary.stale += 1
        } else if (result.status === "stale-blob") {
          staleHashes.add(entry.hash)
          summary.stale += 1
        } else if (result.status === "metadata-mismatch") {
          entry.unavailable_reason = "metadata"
          summary.incompatible += 1
        } else if (result.status === "unavailable" || result.status === "copy-mode") {
          summary.unavailable += 1
        } else {
          summary.failed += 1
        }
      } catch (error) {
        summary.failed += 1
      }
      completeProgress()
    }
    registry.schedulePersist()
    return summary
  }
  // reclaim: delete an orphan's store name. Refuses when any app name remains.
  async reclaim(hash, options = {}) {
    if (!this.enabled) return { status: "disabled" }
    const storePath = this.storePathFor(hash)
    if (!this.registry.blobs.has(hash)) return { status: "not-found" }
    const st = await this.storeStatIfPresent(storePath)
    if (!st) {
      const hasCopyNames = options.hasCopyNames === undefined
        ? [...this.registry.links.values()].some((entry) => entry.hash === hash && entry.mode === "copy")
        : options.hasCopyNames
      if (hasCopyNames) return { status: "unavailable" }
      if (!options.deferRegistry) this.registry.removeBlob(hash)
      return options.deferRegistry ? { status: "gone", remove_hash: true } : { status: "gone" }
    }
    if (!st.isFile()) {
      if (!options.deferRegistry) this.registry.removeBlob(hash)
      return options.deferRegistry
        ? { status: "invalid", remove_hash: true }
        : { status: "invalid" }
    }
    if (st.nlink > 1) return { status: "in-use" }
    await fs.promises.unlink(storePath)
    if (!options.deferRegistry) this.registry.removeBlob(hash)
    await this.recordEvent({ kind: "reclaim", hash, bytes_saved: st.size })
    return options.deferRegistry
      ? { status: "reclaimed", bytes_freed: st.size, remove_hash: true }
      : { status: "reclaimed", bytes_freed: st.size }
  }
  // Startup registry verification (trigger 5): bounded by registry size,
  // never a discovery walk. Prunes dead links, flags orphans, removes stray
  // conversion tmp files, re-adopts blobs whose store name was deleted.
  async verify(options = {}) {
    if (!this.enabled || !this.registry) return
    const preservePath = options.preservePath || (() => false)
    const includePath = options.includePath || (() => true)
    const handleAccessError = (error, filePath) => !!(
      isAccessError(error) && options.onAccessError && options.onAccessError(error, filePath)
    )
    if (options.reconcile !== false) this.reconcileConfiguredSources()
    for (const [linkPath, entry] of [...this.registry.links]) {
      if (!includePath(linkPath)) continue
      if (preservePath(linkPath)) continue
      try {
        const source = this.sourceForPath(linkPath, entry.source_id)
        const managedPath = source && await this.canonicalPathIsWithinSource(linkPath, source, { strictErrors: true })
        if (!managedPath) {
          this.registry.untrack(linkPath)
          continue
        }
        const st = await lstatIfPresent(linkPath)
        if (!st || !st.isFile() || st.ino !== entry.ino || st.dev !== entry.dev) {
          this.registry.untrack(linkPath)
        }
      } catch (error) {
        if (!handleAccessError(error, linkPath)) throw error
      }
    }
    for (const [dupPath, entry] of [...this.registry.duplicates]) {
      if (!includePath(dupPath)) continue
      if (preservePath(dupPath)) continue
      let valid = false
      try {
        const source = this.sourceForPath(dupPath, entry.source_id)
        const st = await lstatIfPresent(dupPath)
        valid = !!(source && st && st.isFile() &&
          await this.canonicalPathIsWithinSource(dupPath, source, { strictErrors: true }))
      } catch (error) {
        if (handleAccessError(error, dupPath)) continue
        throw error
      }
      if (!valid) {
        this.registry.untrack(dupPath)
        continue
      }
      const storeStat = await this.storeStatIfPresent(this.storePathFor(entry.hash))
      if (storeStat && storeStat.isFile()) {
        await unlinkIfSame(dupPath + TMP_SUFFIX, storeStat)
      }
    }
    if (options.verifyBlobs === false) {
      this.registry.schedulePersist()
      return
    }
    const linksByHash = new Map()
    for (const [linkPath, entry] of this.registry.links) {
      if (!linksByHash.has(entry.hash)) linksByHash.set(entry.hash, [])
      linksByHash.get(entry.hash).push([linkPath, entry])
    }
    const invalidBlobs = new Set()
    for (const [hash, blob] of [...this.registry.blobs]) {
      const storePath = this.storePathFor(hash)
      const st = await this.storeStatIfPresent(storePath)
      if (!st) {
        const names = linksByHash.get(hash) || []
        const copyNames = names.filter(([, entry]) => entry.mode === "copy")
        // Deleting a name changes ctime, so trusted re-adoption compares the
        // preserved identity, size, and mtime. Changed or legacy-unsnapshotted
        // content waits for the next explicit scan instead of being assigned a
        // stale hash filename during startup.
        let readopted = false
        let inaccessibleName = false
        for (const [linkPath, entry] of names) {
          if (entry.mode !== "link") continue
          if (preservePath(linkPath)) {
            inaccessibleName = true
            continue
          }
          let source
          let linkStat
          try {
            source = this.sourceForPath(linkPath, entry.source_id)
            if (!source || !await this.canonicalPathIsWithinSource(linkPath, source, { strictErrors: true })) continue
            linkStat = await lstatIfPresent(linkPath)
          } catch (error) {
            if (!handleAccessError(error, linkPath)) throw error
            inaccessibleName = true
            continue
          }
          const expected = this.registry.scanIndex.get(linkPath)
          if (!linkStat || !expected || expected.hash !== hash ||
              entry.dev !== linkStat.dev || entry.ino !== linkStat.ino ||
              !sameContentState(expected, linkStat)) continue
          const before = fileSnapshot(linkStat)
          let created = false
          try {
            await this.storeStatIfPresent(storePath, { createParent: true })
            await fs.promises.link(linkPath, storePath)
            created = true
          } catch (error) {
            if (!error || error.code !== "EEXIST") throw error
            const currentStore = await this.storeStatIfPresent(storePath)
            const currentLink = await lstatIfPresent(linkPath)
            if (!currentStore || !sameContentState(before, currentLink) ||
                currentStore.dev !== linkStat.dev || currentStore.ino !== linkStat.ino) continue
          }
          const [currentLink, currentStore] = await Promise.all([
            lstatIfPresent(linkPath),
            this.storeStatIfPresent(storePath)
          ])
          if (!sameContentState(before, currentLink) || !currentStore ||
              currentStore.dev !== linkStat.dev || currentStore.ino !== linkStat.ino) {
            const ownsStoreName = created && currentStore && (
              (currentStore.dev === linkStat.dev && currentStore.ino === linkStat.ino) ||
              (currentLink && currentStore.dev === currentLink.dev && currentStore.ino === currentLink.ino)
            )
            if (ownsStoreName) await fs.promises.unlink(storePath)
            continue
          }
          await this.refreshLinkSnapshots(hash, linkStat.dev, linkStat.ino)
          readopted = true
          break
        }
        // On a volume without file sharing support, copy-mode names are the
        // durable content group. They remain useful for duplicate discovery
        // even though there is no canonical file in the vault tree.
        if (readopted || copyNames.length || inaccessibleName) {
          blob.orphan = false
          blob.verified_at = inaccessibleName && !readopted ? null : Date.now()
        } else {
          invalidBlobs.add(hash)
        }
        continue
      }
      if (!st.isFile()) {
        invalidBlobs.add(hash)
        continue
      }
      blob.orphan = st.nlink === 1
      blob.verified_at = Date.now()
    }
    this.registry.removeBlobs(invalidBlobs)
    this.registry.schedulePersist()
  }
  // Rebuild derived state from disk: store filenames are hashes, stat gives
  // nlink, and (dev, ino) matching re-associates app paths. The replacement
  // maps are assembled off to the side and swapped in only after the walk so
  // a long repair never persists a half-reset registry.
  async rebuild(roots, options = {}) {
    if (!this.enabled) return
    const registry = this.registry
    const preserveState = options.preserveState !== false
    const preserved = preserveState ? {
      blobs: new Map(registry.blobs),
      links: new Map(registry.links),
      excluded: new Map(registry.excluded),
      totals: Object.assign({}, registry.totals),
      lastScan: registry.lastScan ? Object.assign({}, registry.lastScan) : null,
      sourceScans: new Map([...registry.sourceScans].map(([id, scan]) => [id, Object.assign({}, scan)])),
      duplicates: new Map(registry.duplicates),
      scanIndex: new Map(registry.scanIndex)
    } : null
    const rebuiltBlobs = new Map()
    const rebuiltLinks = new Map()
    const storeInoToHash = new Map()
    let shards = []
    try {
      shards = await fs.promises.readdir(this.blobRoot, { withFileTypes: true })
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    for (const shardEntry of shards) {
      if (!shardEntry.isDirectory() || shardEntry.isSymbolicLink() ||
          !/^[0-9a-f]{2}$/.test(shardEntry.name)) continue
      const shard = shardEntry.name
      const shardPath = path.resolve(this.blobRoot, shard)
      if (!await this.directoryIfSafe(shardPath)) continue
      let names = []
      try {
        names = await fs.promises.readdir(shardPath)
      } catch (error) {
        if (isMissingError(error)) continue
        throw error
      }
      for (const name of names) {
        if (!SHA256_RE.test(name) || !name.startsWith(shard)) continue
        try {
          const st = await fs.promises.lstat(path.resolve(this.blobRoot, shard, name))
          if (!st.isFile()) continue
          const previous = registry.blobs.get(name)
          rebuiltBlobs.set(name, {
            size: st.size,
            first_seen: previous && previous.first_seen ? previous.first_seen : Date.now(),
            source_urls: previous && Array.isArray(previous.source_urls) ? [...previous.source_urls] : [],
            verified_at: Date.now(),
            orphan: st.nlink === 1
          })
          storeInoToHash.set(`${st.dev}:${st.ino}`, name)
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
    }
    await this.refreshSources()
    const walkRoots = roots
      ? roots.map((root) => typeof root === "string" ? { root, source_id: null } : root)
      : this.scanRoots()
    for (const entry of walkRoots) {
      await this.walkForInoMatch(
        entry.root,
        storeInoToHash,
        entry.source_id === "pinokio" ? null : entry.source_id,
        rebuiltLinks
      )
    }
    const rebuiltDuplicates = new Map()
    const rebuiltScanIndex = new Map()
    const trustedHashes = new Set()
    if (preserved) {
      // Copy-mode content has no store inode to rediscover. Preserve only names
      // whose exact scan snapshot still proves the recorded content group.
      for (const [linkPath, link] of preserved.links) {
        if (link.mode !== "copy" || preserved.excluded.has(linkPath)) continue
        const blob = preserved.blobs.get(link.hash)
        const expected = preserved.scanIndex.get(linkPath)
        const source = this.sourceForPath(linkPath, link.source_id)
        if (!blob || !expected || expected.hash !== link.hash || !source ||
            !await this.canonicalPathIsWithinSource(linkPath, source, { strictErrors: true })) continue
        try {
          const st = await fs.promises.lstat(linkPath)
          if (!st.isFile() || st.size < this.sizeThreshold ||
              link.dev !== st.dev || link.ino !== st.ino ||
              !sameSnapshot(expected, st)) continue
          if (!rebuiltBlobs.has(link.hash)) {
            rebuiltBlobs.set(link.hash, Object.assign({}, blob, {
              size: st.size,
              verified_at: Date.now(),
              orphan: false
            }))
          }
          rebuiltLinks.set(linkPath, Object.assign({}, link, {
            app: source.kind === "app" ? source.app : (link.app || null),
            source_id: source.id,
            dev: st.dev,
            ino: st.ino,
            mode: "copy"
          }))
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
      // A store filename is only a trustworthy content hash when at least one
      // surviving name still matches the snapshot captured when that content
      // was hashed. Repair itself never hashes, so unverified names are left
      // without a scan-index entry and the next manual scan hashes them once.
      for (const [linkPath, link] of rebuiltLinks) {
        const expected = preserved.scanIndex.get(linkPath)
        if (!expected || expected.hash !== link.hash) continue
        try {
          const st = await fs.promises.lstat(linkPath)
          if (sameSnapshot(expected, st)) trustedHashes.add(link.hash)
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
      for (const [linkPath, link] of rebuiltLinks) {
        if (!trustedHashes.has(link.hash)) continue
        try {
          const st = await fs.promises.lstat(linkPath)
          rebuiltScanIndex.set(linkPath, {
            hash: link.hash, size: st.size, dev: st.dev, ino: st.ino,
            mtime: st.mtimeMs, ctime: st.ctimeMs,
            source_id: link.source_id || null
          })
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
      for (const [duplicatePath, duplicate] of preserved.duplicates) {
        if (preserved.excluded.has(duplicatePath) || rebuiltLinks.has(duplicatePath) ||
            !rebuiltBlobs.has(duplicate.hash) || !trustedHashes.has(duplicate.hash) ||
            !this.sourceForPath(duplicatePath, duplicate.source_id)) continue
        try {
          const source = this.sourceForPath(duplicatePath, duplicate.source_id)
          if (!await this.canonicalPathIsWithinSource(duplicatePath, source, { strictErrors: true })) continue
          const st = await fs.promises.lstat(duplicatePath)
          const indexed = preserved.scanIndex.get(duplicatePath)
          const expected = indexed && indexed.hash === duplicate.hash ? indexed : duplicate
          if (st.isFile() && sameSnapshot(expected, st)) {
            rebuiltDuplicates.set(duplicatePath, Object.assign({}, duplicate, {
              size: st.size, dev: st.dev, ino: st.ino, mtime: st.mtimeMs, ctime: st.ctimeMs
            }))
            rebuiltScanIndex.set(duplicatePath, {
              hash: duplicate.hash, size: st.size, dev: st.dev, ino: st.ino,
              mtime: st.mtimeMs, ctime: st.ctimeMs,
              source_id: duplicate.source_id || expected.source_id || null
            })
          }
        } catch (error) {
          if (!isMissingError(error)) throw error
        }
      }
      for (const excludedPath of preserved.excluded.keys()) {
        rebuiltLinks.delete(excludedPath)
        rebuiltScanIndex.delete(excludedPath)
      }
    }
    const rebuiltByIno = new Map()
    const rebuiltPathsByIno = new Map()
    for (const [linkPath, entry] of rebuiltLinks) {
      const key = registry.inoKey(entry.dev, entry.ino)
      rebuiltByIno.set(key, entry.hash)
      if (!rebuiltPathsByIno.has(key)) rebuiltPathsByIno.set(key, new Set())
      rebuiltPathsByIno.get(key).add(linkPath)
    }
    registry.replaceState({
      blobs: rebuiltBlobs,
      links: rebuiltLinks,
      scanIndex: rebuiltScanIndex,
      duplicates: rebuiltDuplicates,
      excluded: preserved ? preserved.excluded : new Map(),
      lastScan: preserved ? preserved.lastScan : null,
      sourceScans: preserved ? preserved.sourceScans : new Map(),
      totals: preserved ? preserved.totals : { lifetime_bytes_saved: 0 },
      byIno: rebuiltByIno,
      pathsByIno: rebuiltPathsByIno
    })
    if (options.flush !== false) await registry.flush()
  }
  async walkForInoMatch(root, storeInoToHash, preferredSourceId = null, outputLinks = null) {
    const vaultRoot = path.resolve(this.root)
    for await (const batch of walkBatches(root, {
      concurrency: this.dirConcurrency,
      skipDirectory: (full) => full === vaultRoot,
      strictErrors: true
    })) {
      const files = batch.flatMap((group) => group.files.map((file) => file.path))
      const stats = await statMany(files, this.statConcurrency, null, {
        strictErrors: true,
        followSymlinks: false
      })
      for (let index = 0; index < files.length; index++) {
        const st = stats[index]
        if (!st || !st.isFile() || st.size < this.sizeThreshold) continue
        const hash = storeInoToHash.get(`${st.dev}:${st.ino}`)
        if (hash) {
          const source = this.sourceForPath(files[index], preferredSourceId)
          const previous = this.registry.links.get(files[index])
          const batchId = previous && previous.hash === hash && previous.mode === "link" &&
            previous.dev === st.dev && previous.ino === st.ino
            ? previous.batch_id || null
            : null
          const link = {
            hash, app: source && source.kind === "app" ? source.app : null,
            source_id: source ? source.id : null, dev: st.dev, ino: st.ino,
            mode: "link", created: Date.now(),
            batch_id: batchId
          }
          if (outputLinks) outputLinks.set(files[index], link)
          else this.registry.addLink(files[index], link)
        }
      }
    }
  }
  cloudSyncProvider() {
    const home = path.resolve(this.kernel.homedir || "").replace(/\\/g, "/").toLowerCase()
    if (home.includes("/onedrive") || home.includes("/one drive")) return "OneDrive"
    if (home.includes("/dropbox")) return "Dropbox"
    if (home.includes("/library/mobile documents/") || home.includes("/icloud drive/")) return "iCloud Drive"
    return null
  }
  // Global state for the vault page and the health endpoint. Answered from
  // memory + one stat per blob and occupied shard; never a walk.
  async status(scopeId = null) {
    if (!this.enabled || !this.registry) return { enabled: false }
    const registry = this.registry
    const scope = scopeId ? this.scanSource(scopeId) : null
    if (scopeId && !scope) throw new Error("That location is no longer available.")
    const scopeHashes = scopeId ? new Set() : null
    if (scopeHashes) {
      for (const entry of registry.links.values()) {
        if (entry.source_id === scopeId) scopeHashes.add(entry.hash)
      }
      for (const entry of registry.duplicates.values()) {
        if (entry.source_id === scopeId) scopeHashes.add(entry.hash)
      }
    }
    const blobs = []
    const blobByHash = new Map()
    const storeStats = new Map()
    const namesByHash = new Map()
    const undoBatchMap = new Map()
    for (const [linkPath, entry] of registry.links) {
      if (scopeHashes && !scopeHashes.has(entry.hash)) continue
      if (!namesByHash.has(entry.hash)) namesByHash.set(entry.hash, [])
      const location = this.locationForPath(linkPath, entry.source_id)
      namesByHash.get(entry.hash).push(Object.assign({
        path: linkPath, app: entry.app || null, mode: entry.mode
      }, location))
      if (entry.batch_id && (!scopeId || entry.source_id === scopeId)) {
        if (!undoBatchMap.has(entry.batch_id)) {
          undoBatchMap.set(entry.batch_id, { batch_id: entry.batch_id, files: 0, bytes: 0, ts: null })
        }
        const batch = undoBatchMap.get(entry.batch_id)
        const blob = registry.blobs.get(entry.hash)
        batch.files += 1
        batch.bytes += blob && Number.isFinite(blob.size) ? blob.size : 0
      }
    }
    const pendingBytesByHash = new Map()
    for (const entry of registry.duplicates.values()) {
      if (scopeId && entry.source_id !== scopeId) continue
      pendingBytesByHash.set(entry.hash, (pendingBytesByHash.get(entry.hash) || 0) + (entry.size || 0))
    }
    const blobEntries = [...registry.blobs].filter(([hash]) => !scopeHashes || scopeHashes.has(hash))
    if (!await this.directoryIfSafe(this.root) || !await this.directoryIfSafe(this.blobRoot)) {
      throw unsafeStoragePath(this.blobRoot)
    }
    const storePaths = blobEntries.map(([hash]) => this.storePathFor(hash))
    await Promise.all([...new Set(storePaths.map((storePath) => path.dirname(storePath)))]
      .map((shard) => this.directoryIfSafe(shard)))
    const blobStats = await statMany(
      storePaths,
      this.statConcurrency,
      null,
      { strictErrors: true, followSymlinks: false }
    )
    let bytesOnDisk = 0
    let wouldBe = 0
    let trackedLogicalBytes = 0
    for (let index = 0; index < blobEntries.length; index++) {
      const [hash, blob] = blobEntries[index]
      const names = namesByHash.get(hash) || []
      const apps = new Set(names.map((name) => name.app).filter(Boolean))
      const storeStat = blobStats[index] && blobStats[index].isFile() ? blobStats[index] : null
      const nlink = storeStat ? storeStat.nlink : null
      storeStats.set(hash, storeStat)
      const size = blob.size || 0
      const linkedCopy = storeStat || names.some((name) => name.mode === "link") ? 1 : 0
      const physicalCopies = linkedCopy + names.filter((name) => name.mode === "copy").length
      const pendingBytes = pendingBytesByHash.get(hash) || 0
      trackedLogicalBytes += (size * names.length) + pendingBytes
      bytesOnDisk += (size * physicalCopies) + pendingBytes
      wouldBe += (size * Math.max(physicalCopies, names.length)) + pendingBytes
      const orphan = !!(storeStat && storeStat.nlink === 1)
      const publicBlob = {
        hash, size: blob.size || 0, orphan, nlink,
        names, apps: [...apps], source_urls: blob.source_urls || []
      }
      blobs.push(publicBlob)
      blobByHash.set(hash, publicBlob)
    }
    if (!scopeId) {
      // The scan total covers every regular file, including files below the
      // candidate threshold and files the user kept separate. The registry
      // figures above cover only content tracked by Save space. Add the
      // remainder to both sides so the global comparison represents the
      // complete scanned locations instead of silently omitting small files.
      const lastScan = registry.scanFor()
      const scannedBytes = lastScan && Number.isFinite(lastScan.bytes_total)
        ? lastScan.bytes_total
        : null
      const untrackedScannedBytes = scannedBytes === null
        ? 0
        : Math.max(0, scannedBytes - trackedLogicalBytes)
      bytesOnDisk += untrackedScannedBytes
      wouldBe += untrackedScannedBytes
    }
    const duplicates = []
    for (const [p, entry] of registry.duplicates) {
      if (scopeId && entry.source_id !== scopeId) continue
      const location = this.locationForPath(p, entry.source_id)
      const source = this.sourceForPath(p, location.source_id)
      const index = registry.scanIndex.get(p)
      const storeStat = storeStats.get(entry.hash)
      const shareable = !!(source && source.shareable && storeStat && !entry.unavailable_reason &&
        (!index || index.dev === undefined || index.dev === storeStat.dev))
      let unavailableReason = entry.unavailable_reason || null
      if (!shareable && !unavailableReason) {
        unavailableReason = source && storeStat && index && index.dev !== undefined && index.dev !== storeStat.dev
          ? "different_disk"
          : "unsupported_disk"
      }
      const blob = blobByHash.get(entry.hash)
      const match = blob ? blob.names.find((name) => name.path !== p) || null : null
      duplicates.push(Object.assign({
        path: p, hash: entry.hash, size: entry.size || 0, app: entry.app || null,
        shareable, unavailable_reason: unavailableReason, match
      }, location))
    }
    const events = (await registry.readEvents()).reverse()
      .filter((event) => !scopeId || event.source_id === scopeId)
      .map((event) => {
      const currentLocation = event.path ? this.locationForPath(event.path, event.source_id) : null
      const fallbackLocation = currentLocation && currentLocation.source_id
        ? currentLocation
        : (event.path ? { relative_path: event.path } : {})
      const publicEvent = Object.assign({}, fallbackLocation, event)
      if (event.kind === "convert" && event.batch_id && event.path) {
        const current = registry.links.get(event.path)
        publicEvent.undoable = !!(current && (
          current.batch_id === event.batch_id ||
          (!current.batch_id && current.hash === event.hash)
        ))
        const batch = undoBatchMap.get(event.batch_id)
        if (batch && Number.isFinite(event.ts)) {
          batch.ts = Math.max(batch.ts || 0, event.ts)
        }
      }
      return publicEvent
    })
    const undoBatches = [...undoBatchMap.values()].sort((a, b) =>
      (b.ts || 0) - (a.ts || 0) || a.batch_id.localeCompare(b.batch_id))
    const scan = this.scanStatus()
    const excluded = []
    for (const [p, meta] of registry.excluded) {
      if (scopeId && meta.source_id !== scopeId) continue
      excluded.push(Object.assign({
        path: p,
        ts: meta.ts || null,
        size: Number(meta.size) || 0
      }, this.locationForPath(p, meta.source_id)))
    }
    const publicSources = this._sources.filter((source) => !scopeId || source.id === scopeId).map((source) => ({
      id: source.id, kind: source.kind, label: source.label, root: source.root,
      display_path: source.kind === "pinokio" ? source.root : (source.mount_path || source.root),
      target_path: source.kind === "external" ? source.root : null,
      parent_id: scopeId ? null : source.parent_id, app: source.app || null,
      available: source.available !== false, shareable: source.kind === "virtual" ? null : !!source.shareable
    }))
    const result = {
      enabled: true,
      mode: this.mode,
      scan,
      last_scan: registry.scanFor(scopeId),
      bytes_on_disk: bytesOnDisk,
      bytes_without_sharing: wouldBe,
      saved_by_sharing: wouldBe - bytesOnDisk,
      lifetime_bytes_saved: registry.totals.lifetime_bytes_saved,
      reclaimable: blobs.filter((b) => b.orphan).reduce((sum, b) => sum + b.size, 0),
      pending_bytes: duplicates.filter((d) => d.shareable).reduce((sum, d) => sum + d.size, 0),
      file_action: this.fileActionStatus(scopeId),
      activity_error: registry.eventError,
      cloud_sync_warning: this.cloudSyncProvider(),
      sources: publicSources, blobs, duplicates, excluded, events,
      undo_batches: undoBatches
    }
    if (scopeId) {
      const duplicateBytes = duplicates.reduce((sum, item) => sum + item.size, 0)
      const excludedBytes = excluded.reduce((sum, item) => sum + item.size, 0)
      let linkedBytes = 0
      let effectiveLinkedBytes = 0
      let sharedBytes = 0
      for (const blob of blobs) {
        const scopedNames = blob.names.filter((name) => name.source_id === scopeId)
        const scopedLinks = scopedNames.filter((name) => name.mode === "link").length
        const scopedCopies = scopedNames.length - scopedLinks
        const registeredLinks = blob.names.filter((name) => name.mode === "link").length
        // The store name is one hardlink but not a user-visible location.
        // Registry count prevents stale filesystem metadata from over-attributing the inode.
        const filesystemLinks = Number.isFinite(blob.nlink) ? Math.max(0, blob.nlink - 1) : 0
        const sharingLocations = Math.max(1, registeredLinks, filesystemLinks)
        linkedBytes += blob.size * scopedNames.length
        effectiveLinkedBytes += (blob.size * scopedCopies) +
          (blob.size * scopedLinks / sharingLocations)
        if (registeredLinks >= 2) sharedBytes += blob.size * scopedLinks
      }
      const trackedBytes = linkedBytes + duplicateBytes + excludedBytes
      const effectiveTrackedBytes = effectiveLinkedBytes + duplicateBytes + excludedBytes
      const folderBytes = result.last_scan && Number.isFinite(result.last_scan.bytes_total)
        ? result.last_scan.bytes_total
        : null
      result.scope_id = scopeId
      result.tracked_bytes = trackedBytes
      result.effective_bytes = folderBytes === null
        ? null
        : Math.max(0, folderBytes - trackedBytes) + effectiveTrackedBytes
      result.shared_bytes = sharedBytes
      result.reclaimable = 0
    }
    return result
  }
  scanStatus() {
    const sweeper = this.sweeper
    if (!sweeper) return null
    const pending = !!this.scanPromise && !sweeper.state.active
    const state = pending
      ? Object.assign(sweeper.idleState(), { phase: "queued", scope_id: this.scanScopeId })
      : sweeper.state
    return Object.assign({}, state, {
      current_file: sweeper.currentHash ? path.basename(sweeper.currentHash.path) : null,
      current_file_bytes: sweeper.currentHash ? sweeper.currentHash.bytes : null,
      current_file_size: sweeper.currentHash ? sweeper.currentHash.size : null,
      pending,
      error: this.scanError
    })
  }
  fileActionStatus(scopeId = null) {
    const progress = this.fileActionProgress
    if (!progress) return null
    if (scopeId) {
      if (progress.scope_id && progress.scope_id !== scopeId) return null
      if (progress.path) {
        const source = this.sourceForPath(progress.path)
        if (!source || source.id !== scopeId) return null
      }
    }
    return Object.assign({}, progress)
  }
  progressStatus(scopeId = null) {
    return {
      enabled: !!this.enabled,
      scan: this.scanStatus(),
      file_action: this.fileActionStatus(scopeId),
      last_scan: this.registry ? this.registry.scanFor(scopeId) : null
    }
  }
  async copyOut(filePath, sourcePath, expectedTarget, expectedSource = expectedTarget, options = {}) {
    const tmp = filePath + TMP_SUFFIX
    let copiedStat = null
    try {
      await fs.promises.copyFile(sourcePath, tmp, fs.constants.COPYFILE_EXCL)
      copiedStat = await fs.promises.lstat(tmp)
      if (options.canReplace && !options.canReplace()) {
        await unlinkIfSame(tmp, copiedStat)
        return { status: "locked" }
      }
      const currentTarget = await lstatIfPresent(filePath)
      const currentSource = sourcePath === filePath ? currentTarget : await lstatIfPresent(sourcePath)
      const currentTmp = await lstatIfPresent(tmp)
      if (!currentTarget || !currentSource || !sameSnapshot(expectedTarget, currentTarget) ||
          !sameSnapshot(expectedSource, currentSource) || !sameIdentity(currentTmp, copiedStat)) {
        await unlinkIfSame(tmp, copiedStat)
        return { status: "stale" }
      }
      await fs.promises.rename(tmp, filePath)
      let finalStat
      try {
        finalStat = await lstatIfPresent(filePath)
      } catch (error) {
        // The independent copy was committed by rename(). Preserve that
        // completed action when only the post-commit metadata read failed.
        finalStat = copiedStat
      }
      if (!finalStat || finalStat.dev !== copiedStat.dev || finalStat.ino !== copiedStat.ino) {
        return { status: "stale" }
      }
      copiedStat = null
      return { status: "copied", stat: finalStat }
    } catch (error) {
      await unlinkIfSame(tmp, copiedStat).catch(() => {})
      if (error && error.code === "EEXIST") return { status: "conflict" }
      if (isMissingError(error)) return { status: "stale" }
      throw error
    }
  }
  // detach: make one name an independent copy again ("go back"), and pin it
  // so future scans neither re-list nor re-share it. Works on linked names
  // (copies bytes out) and on pending duplicates (just ignores them).
  async detach(filePath) {
    if (!this.enabled) return { status: "disabled" }
    await this.refreshSources()
    const entry = this.registry.links.get(filePath)
    if (entry) {
      const source = this.sourceForPath(filePath, entry.source_id)
      if (!source || !await this.canonicalPathIsWithinSource(filePath, source)) {
        return { status: "stale" }
      }
      if (entry.mode === "copy") {
        const st = await lstatIfPresent(filePath)
        if (!st || !st.isFile() || st.dev !== entry.dev || st.ino !== entry.ino) return { status: "stale" }
        this.registry.exclude(filePath, {
          ts: Date.now(), source_id: entry.source_id || null, size: st.size
        })
        await this.recordEvent({
          kind: "skip", hash: entry.hash, path: filePath,
          app: entry.app || null, source_id: entry.source_id || null, size: st.size
        })
        return { status: "ignored" }
      }
      if (this.sourceAppIsRunning(source)) return { status: "locked" }
      const before = await lstatIfPresent(filePath)
      if (!before || !before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino) return { status: "stale" }
      const copied = await this.copyOut(filePath, filePath, fileSnapshot(before), fileSnapshot(before), {
        canReplace: () => !this.sourceAppIsRunning(source)
      })
      if (copied.status !== "copied") return copied
      const st = copied.stat
      this.registry.exclude(filePath, { ts: Date.now(), source_id: entry.source_id || null, size: st.size })
      await this.refreshLinkSnapshots(entry.hash, entry.dev, entry.ino)
      await this.recordEvent({ kind: "detach", hash: entry.hash, path: filePath, app: entry.app || null, source_id: entry.source_id || null, size: st.size })
      return { status: "detached" }
    }
    if (this.registry.duplicates.has(filePath)) {
      const dup = this.registry.duplicates.get(filePath)
      this.registry.exclude(filePath, { ts: Date.now(), source_id: dup.source_id || null, size: dup.size || 0 })
      await this.recordEvent({ kind: "skip", hash: dup.hash, path: filePath, app: dup.app || null, source_id: dup.source_id || null, size: dup.size || 0 })
      return { status: "ignored" }
    }
    return { status: "not-found" }
  }
  // Undo a conversion batch: replace each converted name with an independent
  // copy of the bytes (spec, UX contract surface 3).
  async undoBatch(batchId) {
    if (!this.enabled || !batchId) return { undone: 0 }
    await this.refreshSources()
    const events = await this.registry.readEvents()
    const conversionEvents = new Map(events
      .filter((event) => event.kind === "convert" && event.batch_id === batchId && event.path)
      .map((event) => [event.path, event]))
    const targets = new Set(conversionEvents.keys())
    for (const [filePath, entry] of this.registry.links) {
      if (entry.batch_id === batchId) targets.add(filePath)
    }
    const summary = { undone: 0, bytes: 0, failed: 0 }
    for (const filePath of targets) {
      const event = conversionEvents.get(filePath) || {}
      const entry = this.registry.links.get(filePath)
      if (!entry || (entry.batch_id && entry.batch_id !== batchId) ||
          (event.hash && entry.hash !== event.hash)) continue
      const storePath = this.storePathFor(entry.hash)
      try {
        const source = this.sourceForPath(filePath, entry.source_id || event.source_id)
        if (!source || !await this.canonicalPathIsWithinSource(filePath, source)) {
          summary.failed += 1
          continue
        }
        if (this.sourceAppIsRunning(source)) {
          summary.failed += 1
          continue
        }
        const st = await fs.promises.lstat(filePath)
        const storeStat = await this.storeStatIfPresent(storePath)
        if (!st.isFile() || !storeStat || !storeStat.isFile()) {
          summary.failed += 1
          continue
        }
        if (st.ino !== storeStat.ino || st.dev !== storeStat.dev ||
            st.dev !== entry.dev || st.ino !== entry.ino) {
          summary.failed += 1
          continue
        }
        const copied = await this.copyOut(filePath, storePath, fileSnapshot(st), fileSnapshot(storeStat), {
          canReplace: () => !this.sourceAppIsRunning(source)
        })
        if (copied.status !== "copied") {
          summary.failed += 1
          continue
        }
        const independentStat = copied.stat
        const duplicateEntry = {
          hash: entry.hash, size: storeStat.size, app: entry.app || null,
          source_id: entry.source_id || event.source_id || null, discovered: Date.now(),
          dev: independentStat.dev, ino: independentStat.ino,
          mtime: independentStat.mtimeMs, ctime: independentStat.ctimeMs
        }
        const scanEntry = {
          hash: entry.hash, size: independentStat.size,
          dev: independentStat.dev, ino: independentStat.ino,
          mtime: independentStat.mtimeMs, ctime: independentStat.ctimeMs,
          source_id: entry.source_id || event.source_id || null
        }
        this.registry.setDuplicate(filePath, duplicateEntry, scanEntry)
        await this.refreshLinkSnapshots(entry.hash, entry.dev, entry.ino)
        const bytesSaved = event.bytes_saved || storeStat.size
        this.registry.totals.lifetime_bytes_saved = Math.max(0,
          this.registry.totals.lifetime_bytes_saved - bytesSaved)
        await this.recordEvent({
          kind: "undo", hash: entry.hash, path: filePath,
          source_id: entry.source_id || event.source_id || null, batch_id: batchId,
          bytes_saved: bytesSaved
        })
        summary.undone += 1
        summary.bytes += storeStat.size
      } catch (e) {
        summary.failed += 1
      }
    }
    this.registry.schedulePersist()
    return summary
  }
  async reclaimAll() {
    if (!this.enabled) return { reclaimed: 0, bytes_freed: 0 }
    const summary = { reclaimed: 0, bytes_freed: 0, failed: 0 }
    const removedHashes = new Set()
    const copyHashes = new Set([...this.registry.links.values()]
      .filter((entry) => entry.mode === "copy")
      .map((entry) => entry.hash))
    try {
      for (const [hash] of [...this.registry.blobs]) {
        const result = await this.reclaim(hash, {
          deferRegistry: true,
          hasCopyNames: copyHashes.has(hash)
        })
        if (result.remove_hash) removedHashes.add(hash)
        if (result.status === "reclaimed") {
          summary.reclaimed += 1
          summary.bytes_freed += result.bytes_freed || 0
        } else if (!["gone", "in-use", "unavailable"].includes(result.status)) summary.failed += 1
      }
    } finally {
      this.registry.removeBlobs(removedHashes)
    }
    return summary
  }
}

Vault.SIZE_THRESHOLD = SIZE_THRESHOLD
Vault.TMP_SUFFIX = TMP_SUFFIX

module.exports = Vault
