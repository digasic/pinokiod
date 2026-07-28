const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { SHA256_RE } = require('./constants')

const isMissingError = (error) => !!(error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
const isRecord = (value) => !!(value && typeof value === "object" && !Array.isArray(value))
const SNAPSHOT_SECTIONS = ["blobs", "links", "scan_index", "duplicates", "excluded"]
const SNAPSHOT_GENERATION_RE = /^registry-[0-9a-f]{24}$/
const SNAPSHOT_SHARD_ENTRIES = 10000
const SNAPSHOT_SHARD_THRESHOLD = 100000
const SCAN_MARK = Symbol("vault-scan-mark")
const unsafeRegistryPath = (filePath) => {
  const error = new Error(`Storage index path is not safe: ${filePath}`)
  error.code = "EVAULTPATH"
  return error
}
const lstatIfPresent = async (filePath) => {
  try {
    return await fs.promises.lstat(filePath)
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

// Persisted record of blobs and their known names.
// The registry is a cache of the filesystem, never the source of truth
// (spec/requirements/shared-model-store.md "Registry").
class Registry {
  constructor(root) {
    this.root = root
    this.snapshotPath = path.resolve(root, "registry.json")
    this.eventsPath = path.resolve(root, "events.ndjson")
    this.reset()
    this.persistTimer = null
    this.persistDelay = 500
    this.persistFailures = 0
    this.flushPromise = Promise.resolve()
    this.eventPromise = Promise.resolve()
    this.persistDepth = 0
    this.persistDirty = false
    this.maxEvents = 2000
    this.compactEvery = 500
    this.maxEventBytesPerEntry = 4096
    this.eventsSinceCompact = 0
    this.snapshotGeneration = null
    this.snapshotShardEntries = SNAPSHOT_SHARD_ENTRIES
    this.snapshotShardThreshold = SNAPSHOT_SHARD_THRESHOLD
  }
  reset() {
    this.blobs = new Map()      // hash -> { size, first_seen, source_urls, verified_at, orphan }
    this.links = new Map()      // path -> { hash, app, source_id, dev, ino, created, mode, batch_id? }
    this.scanIndex = new Map()  // path -> { size, mtime, dev, ino, hash, source_id }
    this.duplicates = new Map() // path -> { hash, size, app, source_id, discovered } pending user conversion
    this.excluded = new Map()   // path -> { ts, source_id, size } user chose "keep independent"
    this.lastScan = null        // scan totals, duration, and hash work
    this.sourceScans = new Map() // source id -> last complete scoped scan
    this.totals = { lifetime_bytes_saved: 0 }
    this.byIno = new Map()      // "dev:ino" -> hash
    this.pathsByIno = new Map() // "dev:ino" -> Set(paths), for bounded group updates
    this.eventsCache = null
    this.eventError = null
    this.snapshotGeneration = null
    this.currentScanToken = null
    this.currentScanAffectedHashes = null
  }
  beginScanPresence() {
    const token = Symbol("vault-scan")
    this.currentScanToken = token
    this.currentScanAffectedHashes = new Set()
    return token
  }
  endScanPresence(token) {
    if (this.currentScanToken === token) {
      this.currentScanToken = null
      this.currentScanAffectedHashes = null
    }
  }
  markCurrentScan(entry) {
    if (entry && this.currentScanToken) entry[SCAN_MARK] = this.currentScanToken
    return entry
  }
  seenInScan(entry, token) {
    return !!(entry && token && entry[SCAN_MARK] === token)
  }
  noteCurrentScanHash(hash) {
    if (hash && this.currentScanAffectedHashes) {
      this.currentScanAffectedHashes.add(hash)
    }
  }
  affectedScanHashes(token) {
    return this.currentScanToken === token && this.currentScanAffectedHashes
      ? this.currentScanAffectedHashes
      : new Set()
  }
  async rootDirectory(create = false) {
    let st = await lstatIfPresent(this.root)
    if (!st && create) {
      try {
        await fs.promises.mkdir(this.root)
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error
      }
      st = await lstatIfPresent(this.root)
    }
    if (st && !st.isDirectory()) throw unsafeRegistryPath(this.root)
    return st
  }
  async readFile(filePath) {
    const before = await fs.promises.lstat(filePath)
    if (!before.isFile()) throw unsafeRegistryPath(filePath)
    const handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw unsafeRegistryPath(filePath)
      }
      return await handle.readFile("utf8")
    } finally {
      await handle.close()
    }
  }
  async readEventTail() {
    const before = await fs.promises.lstat(this.eventsPath)
    if (!before.isFile()) throw unsafeRegistryPath(this.eventsPath)
    const handle = await fs.promises.open(
      this.eventsPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw unsafeRegistryPath(this.eventsPath)
      }
      const limit = Math.max(64 * 1024, this.maxEvents * this.maxEventBytesPerEntry)
      const length = Math.min(opened.size, limit)
      if (!length) return ""
      const start = opened.size - length
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      let raw = buffer.subarray(0, bytesRead).toString("utf8")
      if (start > 0) {
        const newline = raw.indexOf("\n")
        raw = newline === -1 ? "" : raw.slice(newline + 1)
      }
      return raw
    } finally {
      await handle.close()
    }
  }
  async atomicWrite(filePath, contents) {
    await this.rootDirectory(true)
    const tmp = path.resolve(this.root,
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`)
    let tmpStat = null
    try {
      await fs.promises.writeFile(tmp, contents, { flag: "wx" })
      tmpStat = await fs.promises.lstat(tmp)
      const current = await lstatIfPresent(tmp)
      if (!current || current.dev !== tmpStat.dev || current.ino !== tmpStat.ino) {
        throw unsafeRegistryPath(tmp)
      }
      await fs.promises.rename(tmp, filePath)
      tmpStat = null
    } finally {
      if (tmpStat) {
        const current = await lstatIfPresent(tmp).catch(() => null)
        if (current && current.dev === tmpStat.dev && current.ino === tmpStat.ino) {
          await fs.promises.unlink(tmp).catch(() => {})
        }
      }
    }
  }
  sectionMap(section) {
    if (section === "scan_index") return this.scanIndex
    return this[section]
  }
  async generationDirectory(name, create = false) {
    if (!SNAPSHOT_GENERATION_RE.test(String(name || ""))) {
      throw unsafeRegistryPath(String(name || "registry generation"))
    }
    const target = path.resolve(this.root, name)
    if (path.dirname(target) !== path.resolve(this.root)) throw unsafeRegistryPath(target)
    if (create) {
      await this.rootDirectory(true)
      await fs.promises.mkdir(target, { mode: 0o700 })
    }
    const st = await lstatIfPresent(target)
    if (!st || !st.isDirectory()) throw unsafeRegistryPath(target)
    return { path: target, stat: st }
  }
  async writeSnapshotShard(directory, directoryStat, section, index, entries) {
    const fileName = `${section}-${String(index).padStart(6, "0")}.json`
    const target = path.resolve(directory, fileName)
    await this.atomicWrite(target, JSON.stringify(entries))
    const [currentDirectory, shard] = await Promise.all([
      lstatIfPresent(directory),
      lstatIfPresent(target)
    ])
    if (!currentDirectory || !currentDirectory.isDirectory() ||
        currentDirectory.dev !== directoryStat.dev || currentDirectory.ino !== directoryStat.ino ||
        !shard || !shard.isFile()) {
      throw unsafeRegistryPath(target)
    }
  }
  async writeShardedSnapshot() {
    let generation
    let directory
    let directoryStat
    for (let attempt = 0; attempt < 3; attempt++) {
      generation = `registry-${crypto.randomBytes(12).toString("hex")}`
      try {
        const created = await this.generationDirectory(generation, true)
        directory = created.path
        directoryStat = created.stat
        break
      } catch (error) {
        if (!error || error.code !== "EEXIST" || attempt === 2) throw error
      }
    }
    if (!directory) throw unsafeRegistryPath(this.root)
    const shardCounts = {}
    let committed = false
    try {
      for (const section of SNAPSHOT_SECTIONS) {
        const entries = []
        let shardIndex = 0
        for (const entry of this.sectionMap(section)) {
          entries.push(entry)
          if (entries.length < this.snapshotShardEntries) continue
          await this.writeSnapshotShard(
            directory, directoryStat, section, shardIndex++, entries.splice(0))
        }
        if (entries.length) {
          await this.writeSnapshotShard(
            directory, directoryStat, section, shardIndex++, entries)
        }
        shardCounts[section] = shardIndex
      }
      const manifest = {
        version: 2,
        generation,
        shard_entries: this.snapshotShardEntries,
        shards: shardCounts,
        last_scan: this.lastScan,
        source_scans: Object.fromEntries(this.sourceScans),
        totals: this.totals
      }
      await this.atomicWrite(this.snapshotPath, JSON.stringify(manifest))
      committed = true
      const previousGeneration = this.snapshotGeneration
      this.snapshotGeneration = generation
      if (previousGeneration && previousGeneration !== generation) {
        await this.removeSnapshotGeneration(previousGeneration).catch(() => {})
      }
    } catch (error) {
      if (!committed) await this.removeSnapshotGeneration(generation).catch(() => {})
      throw error
    }
  }
  async removeSnapshotGeneration(name) {
    if (!SNAPSHOT_GENERATION_RE.test(String(name || ""))) return
    const target = path.resolve(this.root, name)
    if (path.dirname(target) !== path.resolve(this.root)) return
    const st = await lstatIfPresent(target)
    if (!st) return
    if (!st.isDirectory()) {
      if (st.isSymbolicLink()) await fs.promises.unlink(target)
      return
    }
    await fs.promises.rm(target, { recursive: true, force: false })
  }
  async *snapshotEntries(json, section) {
    if (json.version !== 2) {
      for (const entry of Object.entries(json[section] || {})) yield entry
      return
    }
    const generation = json.generation
    const shards = json.shards
    const count = shards && shards[section]
    if (!Number.isSafeInteger(count) || count < 0 || count > 100000) {
      const error = new Error("Storage index shard manifest is invalid.")
      error.code = "EVAULTCORRUPT"
      throw error
    }
    let directory
    let directoryStat
    try {
      const generationInfo = await this.generationDirectory(generation, false)
      directory = generationInfo.path
      directoryStat = generationInfo.stat
    } catch (error) {
      if (error && error.code === "EVAULTPATH") error.code = "EVAULTCORRUPT"
      throw error
    }
    for (let index = 0; index < count; index++) {
      const target = path.resolve(
        directory, `${section}-${String(index).padStart(6, "0")}.json`)
      let parsed
      try {
        parsed = JSON.parse(await this.readFile(target))
      } catch (error) {
        if (error && (["ENOENT", "ENOTDIR", "EVAULTPATH"].includes(error.code) ||
            error.name === "SyntaxError")) {
          error.code = "EVAULTCORRUPT"
        }
        throw error
      }
      const currentDirectory = await lstatIfPresent(directory)
      if (!currentDirectory || !currentDirectory.isDirectory() ||
          currentDirectory.dev !== directoryStat.dev ||
          currentDirectory.ino !== directoryStat.ino ||
          !Array.isArray(parsed)) {
        const error = new Error("Storage index shard is invalid.")
        error.code = "EVAULTCORRUPT"
        throw error
      }
      for (const entry of parsed) {
        if (Array.isArray(entry) && entry.length === 2) yield entry
      }
    }
  }
  async appendFile(filePath, contents) {
    await this.rootDirectory(true)
    let before
    let handle
    for (let attempt = 0; attempt < 2; attempt++) {
      before = await lstatIfPresent(filePath)
      if (before && !before.isFile()) throw unsafeRegistryPath(filePath)
      const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND |
        (fs.constants.O_NOFOLLOW || 0) |
        (before ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL)
      try {
        handle = await fs.promises.open(filePath, flags, 0o600)
        break
      } catch (error) {
        if (!before && error && error.code === "EEXIST" && attempt === 0) continue
        throw error
      }
    }
    if (!handle) throw unsafeRegistryPath(filePath)
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || (before &&
          (opened.dev !== before.dev || opened.ino !== before.ino))) {
        throw unsafeRegistryPath(filePath)
      }
      await handle.writeFile(contents)
    } finally {
      await handle.close()
    }
  }
  scanFor(sourceId = null) {
    return sourceId ? (this.sourceScans.get(sourceId) || null) : this.lastScan
  }
  setLastScan(meta, sourceId = null) {
    if (sourceId) this.sourceScans.set(sourceId, meta)
    else this.lastScan = meta
    this.schedulePersist()
  }
  inoKey(dev, ino) {
    return `${dev}:${ino}`
  }
  addBlob(hash, meta) {
    if (!this.blobs.has(hash)) {
      this.blobs.set(hash, Object.assign({
        size: 0,
        first_seen: Date.now(),
        source_urls: [],
        verified_at: null
      }, meta))
    } else if (meta && meta.source_urls && meta.source_urls.length) {
      const blob = this.blobs.get(hash)
      for (const url of meta.source_urls) {
        if (!blob.source_urls.includes(url)) blob.source_urls.push(url)
      }
    }
    this.schedulePersist()
  }
  addLink(filePath, entry) {
    const previous = this.links.get(filePath)
    if (previous && previous.dev !== undefined && previous.ino !== undefined) {
      this.removeIno(previous.dev, previous.ino, filePath)
    }
    // A path has exactly one derived classification. Registering a physical
    // name always clears an older pending-duplicate classification first.
    const previousDuplicate = this.duplicates.get(filePath)
    if (previousDuplicate) this.noteCurrentScanHash(previousDuplicate.hash)
    this.duplicates.delete(filePath)
    const next = Object.assign({ created: Date.now(), mode: "link" }, entry)
    const sameTrackedFile = previous && previous.hash === next.hash &&
      previous.mode === next.mode && previous.dev === next.dev && previous.ino === next.ino
    if (next.batch_id === undefined && sameTrackedFile && previous.batch_id) {
      next.batch_id = previous.batch_id
    }
    this.markCurrentScan(next)
    this.links.set(filePath, next)
    this.markCurrentScan(this.scanIndex.get(filePath))
    if (entry.dev !== undefined && entry.ino !== undefined) {
      const key = this.inoKey(entry.dev, entry.ino)
      this.byIno.set(key, entry.hash)
      if (!this.pathsByIno.has(key)) this.pathsByIno.set(key, new Set())
      this.pathsByIno.get(key).add(filePath)
    }
    this.schedulePersist()
  }
  setDuplicate(filePath, entry, scanEntry = null) {
    const previous = this.duplicates.get(filePath) || null
    if (previous && previous.hash !== entry.hash) this.noteCurrentScanHash(previous.hash)
    this.removeLink(filePath)
    this.markCurrentScan(entry)
    this.duplicates.set(filePath, entry)
    if (scanEntry) this.scanIndex.set(filePath, this.markCurrentScan(scanEntry))
    this.schedulePersist()
    return previous
  }
  setScanEntry(filePath, entry) {
    this.scanIndex.set(filePath, this.markCurrentScan(entry))
    this.schedulePersist()
  }
  untrack(filePath) {
    const hadLink = this.links.has(filePath)
    const duplicate = this.duplicates.get(filePath)
    if (duplicate) this.noteCurrentScanHash(duplicate.hash)
    const hadDuplicate = this.duplicates.delete(filePath)
    const hadIndex = this.scanIndex.delete(filePath)
    if (hadLink) this.removeLink(filePath)
    if (hadDuplicate || hadIndex) this.schedulePersist()
  }
  exclude(filePath, entry) {
    this.untrack(filePath)
    this.excluded.set(filePath, entry)
    this.schedulePersist()
  }
  allowSharing(filePath) {
    const entry = this.excluded.get(filePath) || null
    if (!this.excluded.delete(filePath)) return null
    this.schedulePersist()
    return entry
  }
  removeLink(filePath) {
    const entry = this.links.get(filePath)
    if (entry) {
      this.noteCurrentScanHash(entry.hash)
      this.links.delete(filePath)
      this.removeIno(entry.dev, entry.ino, filePath)
      this.schedulePersist()
    }
  }
  removeIno(dev, ino, filePath) {
    if (dev === undefined || ino === undefined) return
    const key = this.inoKey(dev, ino)
    const paths = this.pathsByIno.get(key)
    if (paths && filePath !== undefined) paths.delete(filePath)
    if (!paths || paths.size === 0) {
      this.pathsByIno.delete(key)
      this.byIno.delete(key)
    }
  }
  removeBlob(hash) {
    this.removeBlobs(new Set([hash]))
  }
  removeBlobs(hashes) {
    if (!hashes || hashes.size === 0) return
    for (const hash of hashes) this.blobs.delete(hash)
    for (const [p, entry] of this.links) {
      if (hashes.has(entry.hash)) {
        this.removeLink(p)
        this.scanIndex.delete(p)
      }
    }
    // A pending review item is only actionable while its matching Vault copy
    // exists. Clear the dependent cache records with the content group.
    for (const [p, entry] of this.duplicates) {
      if (hashes.has(entry.hash)) {
        this.duplicates.delete(p)
        this.scanIndex.delete(p)
      }
    }
    this.schedulePersist()
  }
  addSaved(bytes) {
    this.totals.lifetime_bytes_saved += bytes
    this.schedulePersist()
  }
  replaceState(state) {
    this.blobs = state.blobs
    this.links = state.links
    this.scanIndex = state.scanIndex
    this.duplicates = state.duplicates
    this.excluded = state.excluded
    this.lastScan = state.lastScan
    this.sourceScans = state.sourceScans
    this.totals = state.totals
    this.byIno = state.byIno
    this.pathsByIno = state.pathsByIno
    this.schedulePersist()
  }
  // Returns { corrupt: true } when the snapshot cannot be parsed so the caller
  // can require an explicit Repair Index without modifying stored files.
  async load() {
    this.reset()
    let raw
    try {
      await this.rootDirectory(false)
      raw = await this.readFile(this.snapshotPath)
    } catch (e) {
      if (e && e.code === "ENOENT") return { corrupt: false, existed: false }
      throw e
    }
    let json
    try {
      json = JSON.parse(raw)
    } catch (e) {
      return { corrupt: true, existed: true }
    }
    if (!isRecord(json)) {
      return { corrupt: true, existed: true }
    }
    try {
      for await (const [k, v] of this.snapshotEntries(json, "blobs")) {
        if (SHA256_RE.test(k) && isRecord(v)) {
          this.blobs.set(k, Object.assign({}, v, {
            size: Number.isFinite(v.size) && v.size >= 0 ? v.size : 0,
            source_urls: Array.isArray(v.source_urls)
              ? v.source_urls.filter((url) => typeof url === "string")
              : []
          }))
        }
      }
      for await (const [k, v] of this.snapshotEntries(json, "links")) {
        if (!isRecord(v) || !SHA256_RE.test(v.hash) ||
            !Number.isFinite(v.dev) || !Number.isFinite(v.ino)) continue
        const link = Object.assign({}, v, { mode: v.mode === "copy" ? "copy" : "link" })
        this.links.set(k, link)
        if (link.dev !== undefined && link.ino !== undefined) {
          const key = this.inoKey(link.dev, link.ino)
          this.byIno.set(key, link.hash)
          if (!this.pathsByIno.has(key)) this.pathsByIno.set(key, new Set())
          this.pathsByIno.get(key).add(k)
        }
      }
      for await (const [k, v] of this.snapshotEntries(json, "scan_index")) {
        if (isRecord(v) && (!v.hash || SHA256_RE.test(v.hash)) &&
            [v.size, v.mtime, v.ctime, v.dev, v.ino].every(Number.isFinite)) {
          this.scanIndex.set(k, v)
        }
      }
      for await (const [k, v] of this.snapshotEntries(json, "duplicates")) {
        if (isRecord(v) && SHA256_RE.test(v.hash) && !this.links.has(k)) {
          this.duplicates.set(k, Object.assign({}, v, {
            size: Number.isFinite(v.size) && v.size >= 0 ? v.size : 0
          }))
        }
      }
      for await (const [k, v] of this.snapshotEntries(json, "excluded")) {
        if (!isRecord(v)) continue
        const linked = this.links.get(k)
        if (linked) {
          this.links.delete(k)
          this.removeIno(linked.dev, linked.ino, k)
        }
        this.duplicates.delete(k)
        this.scanIndex.delete(k)
        this.excluded.set(k, Object.assign({}, v, {
          size: Number.isFinite(v.size) && v.size >= 0 ? v.size : 0
        }))
      }
    } catch (error) {
      if (!error || error.code !== "EVAULTCORRUPT") throw error
      this.reset()
      return { corrupt: true, existed: true }
    }
    if (isRecord(json.last_scan)) {
      this.lastScan = json.last_scan
    }
    for (const [sourceId, scan] of Object.entries(json.source_scans || {})) {
      if (isRecord(scan)) this.sourceScans.set(sourceId, scan)
    }
    if (json.totals && Number.isFinite(json.totals.lifetime_bytes_saved)) {
      this.totals = { lifetime_bytes_saved: Math.max(0, json.totals.lifetime_bytes_saved) }
    }
    this.snapshotGeneration = json.version === 2 ? json.generation : null
    return { corrupt: false, existed: true }
  }
  beginBatch() {
    if (this.persistDepth === 0 && this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
      this.persistDirty = true
    }
    this.persistDepth += 1
  }
  async endBatch(options = {}) {
    if (this.persistDepth > 0) this.persistDepth -= 1
    if (this.persistDepth || !this.persistDirty) return
    if (options.flush === false) this.schedulePersist()
    else await this.flush()
  }
  schedulePersist(delay = this.persistDelay) {
    this.persistDirty = true
    if (this.persistDepth > 0) {
      return
    }
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flush().catch(() => {})
    }, delay)
    if (this.persistTimer.unref) this.persistTimer.unref()
  }
  async flush() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persistDirty = false
    const entryCount = SNAPSHOT_SECTIONS.reduce(
      (sum, section) => sum + this.sectionMap(section).size, 0)
    const useShards = entryCount > this.snapshotShardThreshold
    const json = useShards ? null : {
      version: 1,
      blobs: Object.fromEntries(this.blobs),
      links: Object.fromEntries(this.links),
      scan_index: Object.fromEntries(this.scanIndex),
      duplicates: Object.fromEntries(this.duplicates),
      excluded: Object.fromEntries(this.excluded),
      last_scan: this.lastScan,
      source_scans: Object.fromEntries(this.sourceScans),
      totals: this.totals
    }
    const write = async () => {
      if (useShards) {
        await this.writeShardedSnapshot()
        return
      }
      await this.atomicWrite(this.snapshotPath, JSON.stringify(json))
      const previousGeneration = this.snapshotGeneration
      this.snapshotGeneration = null
      if (previousGeneration) {
        await this.removeSnapshotGeneration(previousGeneration).catch(() => {})
      }
    }
    const pending = this.flushPromise.then(write, write)
    this.flushPromise = pending.catch(() => {})
    try {
      await pending
      this.persistFailures = 0
    } catch (error) {
      // The in-memory mutation remains authoritative after a failed write.
      // Keep it dirty and retry instead of silently losing it on restart.
      const retryDelay = Math.min(this.persistDelay * (2 ** this.persistFailures), 30000)
      this.persistFailures += 1
      this.schedulePersist(retryDelay)
      throw error
    }
  }
  async appendEvent(event) {
    const line = JSON.stringify(Object.assign({ ts: Date.now() }, event)) + "\n"
    const append = async () => {
      await this.appendFile(this.eventsPath, line)
      if (this.eventsCache) this.eventsCache.push(JSON.parse(line))
      this.eventsSinceCompact += 1
      if ((this.eventsCache && this.eventsCache.length > this.maxEvents + this.compactEvery) ||
          this.eventsSinceCompact >= this.compactEvery) {
        await this.compactEventsNow()
      }
    }
    const pending = this.eventPromise.then(append, append)
    // One ordered writer prevents a scan with many matches from opening an
    // unbounded number of concurrent append operations. Keep the writer
    // usable after a failure while returning the real append result so the
    // dashboard can expose missing activity without misreporting the action.
    this.eventPromise = pending.then(
      () => { this.eventError = null },
      (error) => {
        this.eventError = error && error.message ? error.message : String(error)
      }
    )
    return pending
  }
  async compactEventsNow(events = null) {
    if (!events) {
      let raw = ""
      try {
        raw = await this.readEventTail()
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error
      }
      events = this.parseEvents(raw)
    }
    const recent = events.slice(-this.maxEvents)
    await this.atomicWrite(this.eventsPath,
      recent.map((event) => JSON.stringify(event)).join("\n") + (recent.length ? "\n" : ""))
    this.eventsCache = recent
    this.eventsSinceCompact = 0
  }
  parseEvents(raw) {
    const events = []
    for (const line of String(raw || "").split("\n")) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (isRecord(event)) events.push(event)
      } catch (error) {}
    }
    return events
  }
  // Torn final line (crash mid-append) is discarded, per persistence rules.
  async readEvents() {
    const read = async () => {
      if (this.eventsCache) {
        return this.eventsCache.slice(-this.maxEvents)
      }
      let raw
      try {
        await this.rootDirectory(false)
        raw = await this.readEventTail()
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error
        this.eventsCache = []
        return []
      }
      const events = this.parseEvents(raw)
      this.eventsCache = events.slice(-this.maxEvents)
      return this.eventsCache.slice()
    }
    const pending = this.eventPromise.then(read, read)
    this.eventPromise = pending.then(() => {}, () => {})
    return pending
  }
}

module.exports = Registry
