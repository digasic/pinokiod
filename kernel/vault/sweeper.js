const fs = require("fs")
const path = require("path")
const { walkBatches, statMany } = require("./walker")
const { fileSnapshot, sameSnapshot } = require("./snapshot")
const {
  DIR_CONCURRENCY,
  STAT_CONCURRENCY,
  SHA256_RE
} = require("./constants")

const PREVIEW_GROUP_LIMIT = 20

const PATH_ERROR_CODES = new Set([
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "EIO",
  "EISDIR",
  "ELOOP",
  "ENODATA",
  "ENOENT",
  "ENOTDIR",
  "ENXIO",
  "EPERM",
  "EROFS",
  "ESTALE",
  "ETIMEDOUT",
  "EWOULDBLOCK"
])

const isPathError = (error) => !!(
  error && PATH_ERROR_CODES.has(error.code))

const exclusionReason = (error) => {
  if (!error) return "unreadable"
  if (error.code === "EACCES" || error.code === "EPERM") {
    return "permission_denied"
  }
  if (error.code === "ENOENT" || error.code === "ENOTDIR") {
    return "disappeared"
  }
  if (["EAGAIN", "ENODATA", "ETIMEDOUT", "EWOULDBLOCK"]
    .includes(error.code)) return "not_resident"
  return "unreadable"
}

const cancelledError = () => {
  const error = new Error("Scan cancelled.")
  error.code = "EVAULTCANCELLED"
  return error
}

class Sweeper {
  constructor(vault) {
    this.vault = vault
    this.state = this.idleState()
    this.currentHash = null
    this.cancelRequested = false
    this.statConcurrency = vault.statConcurrency || STAT_CONCURRENCY
    this.dirConcurrency = vault.dirConcurrency || DIR_CONCURRENCY
    this.exclusions = new Map()
    this.previewGroups = new Map()
    this.completedHashInodes = new Set()
  }

  idleState() {
    return {
      active: false,
      phase: "idle",
      dirs: 0,
      files: 0,
      bytes_total: 0,
      source_bytes: {},
      source_files: {},
      source_hash_failures: {},
      scope_id: null,
      candidates: 0,
      hashed: 0,
      hash_total: 0,
      hash_bytes: 0,
      hash_work_files: 0,
      hash_work_bytes: 0,
      hash_files_completed: 0,
      hash_bytes_completed: 0,
      queued: 0,
      inode_reuses: 0,
      unstable_hashes: 0,
      hash_failures: 0,
      exclusions: [],
      preview: {
        provisional: true,
        duplicate_files: 0,
        bytes: 0,
        groups: []
      },
      started: null,
      duration_ms: null,
      walk_duration_ms: null,
      hash_wait_duration_ms: null,
      hash_duration_ms: 0
    }
  }

  cancel() {
    if (!this.state.active) return false
    this.cancelRequested = true
    return true
  }

  checkpoint() {
    if (this.cancelRequested) throw cancelledError()
  }

  publicationSourceIds(scopeId) {
    const sources = this.vault.sources().filter((source) =>
      source.kind !== "virtual" && source.available !== false)
    if (!scopeId) return sources.map((source) => source.id)
    const selected = this.vault.scanSource(scopeId)
    if (!selected) return []
    return sources
      .filter((source) => this.vault.sourceIsWithinScope(source, scopeId))
      .map((source) => source.id)
  }

  async scan(scopeId = null) {
    if (this.state.active) return { already_running: true }
    this.cancelRequested = false
    this.exclusions.clear()
    this.previewGroups.clear()
    this.completedHashInodes.clear()
    this.state = Object.assign(this.idleState(), {
      active: true,
      phase: "discovering",
      started: Date.now(),
      scope_id: scopeId
    })

    const registry = this.vault.registry
    const runId = await registry.beginScan(scopeId)
    let outcome = "failed"
    let fatalError = null
    try {
      await this.vault.refreshSources()
      if (!scopeId) {
        const unavailable = this.vault.sources().find((source) =>
          source.kind === "external" &&
          source.configured === true &&
          source.available === false)
        if (unavailable) {
          throw new Error(
            `Configured scan location is unavailable: ${unavailable.root}`)
        }
      }
      const scanRoots = this.vault.scanRoots(scopeId)
      if (!scanRoots.length) {
        throw new Error("That scan location is no longer available.")
      }

      const anchorStores = this.anchorStoresForScope(scopeId)
      await this.stageAnchors(runId, anchorStores)
      this.checkpoint()

      const walkStarted = Date.now()
      for (const source of scanRoots) {
        if (!Object.prototype.hasOwnProperty.call(
          this.state.source_bytes, source.source_id
        )) {
          this.state.source_bytes[source.source_id] = 0
          this.state.source_files[source.source_id] = 0
        }
        await this.walk(source.root, runId, source.source_id)
        this.checkpoint()
      }
      this.state.walk_duration_ms = Date.now() - walkStarted
      await registry.stageExclusions(runId, this.exclusionList())

      this.state.phase = "hashing"
      const hashStarted = Date.now()
      await this.hashCandidates(runId)
      await registry.stageExclusions(runId, this.exclusionList())
      await this.verifyCandidateAnchors(runId)
      await registry.stageExclusions(runId, this.exclusionList())
      this.state.hash_wait_duration_ms = Date.now() - hashStarted

      outcome = this.exclusions.size
        ? "completed_with_exclusions"
        : "complete"
      this.state.phase = "publishing"
      this.state.duration_ms = Date.now() - this.state.started
      const metadata = this.scanMetadata(scopeId, outcome)
      const stores = anchorStores
        .filter((store) =>
          store.available && Number.isFinite(store.dev))
        .map((store) => ({
          store_id: store.id,
          dev: store.dev,
          can_link: store.mode !== "copy",
          root: store.root
        }))
      await registry.publishScan(
        runId,
        this.publicationSourceIds(scopeId),
        metadata,
        stores
      )
    } catch (error) {
      await registry.abortScan(runId).catch(() => {})
      if (error && error.code === "EVAULTCANCELLED") {
        outcome = "cancelled"
      } else {
        fatalError = error
      }
    } finally {
      this.currentHash = null
      this.state.active = false
      this.state.phase = outcome
      this.state.duration_ms = Date.now() - this.state.started
      this.clearPreview()
    }

    if (fatalError) throw fatalError
    return {
      dirs: this.state.dirs,
      files: this.state.files,
      bytes_total: this.state.bytes_total,
      candidates: this.state.candidates,
      outcome,
      partial: outcome === "completed_with_exclusions",
      cancelled: outcome === "cancelled",
      exclusions: this.exclusionList()
    }
  }

  scanMetadata(scopeId, outcome = "complete") {
    return {
      scope_id: scopeId || "",
      outcome,
      partial: outcome === "completed_with_exclusions",
      exclusions: this.exclusionList(),
      dirs: this.state.dirs,
      files: this.state.files,
      bytes_total: this.state.bytes_total,
      source_bytes: Object.assign({}, this.state.source_bytes),
      source_files: Object.assign({}, this.state.source_files),
      source_hash_failures: Object.assign({}, this.state.source_hash_failures),
      candidates: this.state.candidates,
      hashed: this.state.hashed,
      hash_total: this.state.hash_total,
      hash_bytes: this.state.hash_bytes,
      hash_work_files: this.state.hash_work_files,
      hash_work_bytes: this.state.hash_work_bytes,
      hash_files_completed: this.state.hash_files_completed,
      hash_bytes_completed: this.state.hash_bytes_completed,
      inode_reuses: this.state.inode_reuses,
      unstable_hashes: this.state.unstable_hashes,
      hash_failures: this.state.hash_failures,
      candidate_min_bytes: this.vault.sizeThreshold,
      duration_ms: Date.now() - this.state.started,
      walk_duration_ms: this.state.walk_duration_ms || 0,
      hash_wait_duration_ms: this.state.hash_wait_duration_ms || 0,
      hash_duration_ms: this.state.hash_duration_ms || 0
    }
  }

  recordExclusion(
    error,
    filePath,
    sourceId = null,
    reason = null,
    observed = null
  ) {
    if (!reason && !isPathError(error)) return false
    const target = path.resolve(filePath)
    const firstExclusion = !this.exclusions.has(target)
    const source = this.vault.sourceForPath(target, sourceId)
    this.exclusions.set(target, {
      path: target,
      source_id: source ? source.id : sourceId,
      reason: reason || exclusionReason(error),
      created_at: Date.now()
    })
    if (firstExclusion && observed) {
      const observedSourceId = observed.source_id || sourceId || "pinokio"
      const observedSize = Math.max(0, Number(observed.size) || 0)
      this.state.files = Math.max(0, this.state.files - 1)
      this.state.bytes_total = Math.max(
        0, this.state.bytes_total - observedSize)
      this.state.source_files[observedSourceId] = Math.max(
        0, (this.state.source_files[observedSourceId] || 0) - 1)
      this.state.source_bytes[observedSourceId] = Math.max(
        0, (this.state.source_bytes[observedSourceId] || 0) - observedSize)
    }
    this.state.exclusions = this.exclusionList().slice(0, 100)
    return true
  }

  exclusionList() {
    return [...this.exclusions.values()]
  }

  clearPreview() {
    this.previewGroups.clear()
    this.state.preview = {
      provisional: true,
      duplicate_files: 0,
      bytes: 0,
      groups: []
    }
  }

  applyPreview(change) {
    if (!change) return
    this.state.preview.duplicate_files = Math.max(
      0,
      this.state.preview.duplicate_files +
        (Number(change.duplicate_files_delta) || 0)
    )
    this.state.preview.bytes = Math.max(
      0,
      this.state.preview.bytes + (Number(change.bytes_delta) || 0)
    )
    for (const group of change.groups || []) {
      if (!group || !group.hash) continue
      if (!(Number(group.duplicate_files) > 0)) {
        this.previewGroups.delete(group.hash)
      } else if (this.previewGroups.has(group.hash) ||
          this.previewGroups.size < PREVIEW_GROUP_LIMIT) {
        this.previewGroups.set(group.hash, group)
      }
    }
    this.state.preview.groups = [...this.previewGroups.values()]
      .sort((left, right) =>
        right.bytes - left.bytes || left.hash.localeCompare(right.hash))
  }

  applyHashWork(work) {
    if (!work) return
    this.state.hash_work_files = Math.max(
      0, Number(work.hash_work_files) || 0)
    this.state.hash_work_bytes = Math.max(
      0, Number(work.hash_work_bytes) || 0)
  }

  completeHashWork(entry) {
    if (entry.nlink > 1 && entry.ino !== 0) {
      const key = `${entry.dev}:${entry.ino}`
      if (this.completedHashInodes.has(key)) return
      this.completedHashInodes.add(key)
    }
    this.state.hash_files_completed += 1
    this.state.hash_bytes_completed += entry.size
  }

  anchorStoresForScope(scopeId) {
    const available = this.vault.anchorStores().filter((store) =>
      store.available && Number.isFinite(store.dev))
    if (!scopeId) return available
    const source = this.vault.scanSource(scopeId)
    return source && Number.isFinite(source.dev)
      ? available.filter((store) => store.dev === source.dev)
      : []
  }

  async stageAnchors(runId, stores = this.vault.anchorStores()) {
    for (const store of stores) {
      const blobRoot = path.resolve(store.root, "sha256")
      let stat
      try {
        stat = await fs.promises.lstat(blobRoot)
      } catch (error) {
        if (error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")) continue
        if (this.recordExclusion(error, blobRoot)) continue
        throw error
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue
      try {
        await this.vault.validateAnchorStore(store, stat.dev)
      } catch (error) {
        if (this.recordExclusion(error, blobRoot, null, "anchor_store")) {
          continue
        }
        throw error
      }

      for await (const directoryResults of walkBatches(blobRoot, {
        concurrency: this.dirConcurrency,
        strictErrors: true,
        onError: (error, filePath) =>
          this.recordExclusion(error, filePath)
      })) {
        this.checkpoint()
        const files = directoryResults.flatMap((group) =>
          group.files.map((file) => file.path))
        const stats = await statMany(files, this.statConcurrency, null, {
          followSymlinks: false,
          strictErrors: true,
          onError: (error, filePath) =>
            this.recordExclusion(error, filePath)
        })
        const anchors = []
        for (let index = 0; index < files.length; index++) {
          const filePath = files[index]
          const fileStat = stats[index]
          const hash = path.basename(filePath)
          if (!fileStat || !fileStat.isFile() || !SHA256_RE.test(hash)) continue
          if (path.basename(path.dirname(filePath)) !== hash.slice(0, 2)) continue
          anchors.push(anchorEntry(store.id, filePath, hash, fileStat))
        }
        const staged = await this.vault.registry.stageAnchors(runId, anchors)
        this.applyHashWork(staged && staged.work)
      }
    }
  }

  async walk(root, runId, preferredSourceId = null) {
    const rootHandle = await fs.promises.opendir(root)
    await rootHandle.close()
    for await (const directoryResults of walkBatches(root, {
      concurrency: this.dirConcurrency,
      skipDirectory: (full) => this.vault.isStorageRoot(full),
      strictErrors: true,
      strictRoot: true,
      onError: (error, filePath) =>
        this.recordExclusion(error, filePath, preferredSourceId)
    })) {
      this.checkpoint()
      this.state.dirs += directoryResults
        .filter((group) => group.firstChunk).length
      const files = directoryResults.flatMap((group) =>
        group.files.map((file) => file.path))
      await this.considerFiles(files, runId, preferredSourceId)
    }
  }

  async considerFiles(filePaths, runId, preferredSourceId) {
    const stats = await statMany(filePaths, this.statConcurrency, null, {
      followSymlinks: false,
      strictErrors: true,
      onError: (error, filePath) =>
        this.recordExclusion(error, filePath, preferredSourceId)
    })
    const entries = []
    for (let index = 0; index < filePaths.length; index++) {
      this.checkpoint()
      const stat = stats[index]
      if (stat && stat.isFile()) {
        const entry = this.considerStat(
          filePaths[index], stat, preferredSourceId)
        if (entry) entries.push(entry)
      }
    }
    const staged = await this.vault.registry.stageFiles(
      runId, entries, this.vault.sizeThreshold)
    this.state.candidates += Number(staged && staged.changes) || 0
    this.applyPreview(staged && staged.preview)
    this.applyHashWork(staged && staged.work)
  }

  considerStat(filePath, stat, preferredSourceId) {
    const source = this.vault.sourceForPath(filePath, preferredSourceId)
    const sourceId = source ? source.id : preferredSourceId || "pinokio"
    const app = source && source.kind === "app" ? source.app : null
    this.state.files += 1
    this.state.bytes_total += stat.size
    this.state.source_files[sourceId] =
      (this.state.source_files[sourceId] || 0) + 1
    this.state.source_bytes[sourceId] =
      (this.state.source_bytes[sourceId] || 0) + stat.size
    return {
      path: filePath,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      nlink: stat.nlink,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid,
      source_id: sourceId,
      app,
      managed: false
    }
  }

  async hashCandidates(runId) {
    let cursor = null
    while (true) {
      this.checkpoint()
      const batch = await this.vault.registry.hashWorkBatch(runId, cursor)
      if (!batch.length) return
      for (const candidate of batch) {
        this.checkpoint()
        cursor = {
          size: candidate.size,
          dev: candidate.dev,
          ino: candidate.ino,
          path: candidate.path
        }
        if (candidate.reusable_hash) {
          const updated = await this.vault.registry.setStageInodeHash(
            runId, candidate.dev, candidate.ino, candidate.reusable_hash)
          this.state.inode_reuses += updated.changes
          this.applyPreview(updated.preview)
          continue
        }
        await this.hashCandidateRoutes(runId, candidate)
      }
    }
  }

  async hashCandidateRoutes(runId, work) {
    let candidate = work
    let deferCompletion = false
    while (candidate) {
      this.checkpoint()
      const started = Date.now()
      this.state.hash_total += 1
      this.state.queued = 1
      this.currentHash = {
        path: candidate.path,
        size: candidate.size,
        bytes: 0
      }
      try {
        const expected = stageSnapshot(candidate)
        const result = await this.vault.hashFile(candidate.path, {
          onProgress: (bytes) => {
            if (this.currentHash &&
                this.currentHash.path === candidate.path) {
              this.currentHash.bytes = bytes
            }
          }
        })
        const current = await fs.promises.lstat(candidate.path)
        if (result.size !== current.size ||
            !sameSnapshot(expected, current)) {
          this.state.unstable_hashes += 1
          const retry = await this.vault.registry.markStageHashFailed(
            runId, candidate)
          this.recordExclusion(
            null,
            candidate.path,
            candidate.source_id,
            "changed_during_scan",
            candidate
          )
          candidate = retry.next
          deferCompletion = !candidate && retry.anchor_fallback
          continue
        }
        const updated = candidate.nlink > 1 && candidate.ino !== 0
          ? await this.vault.registry.setStageInodeHash(
            runId, candidate.dev, candidate.ino, result.hash)
          : await this.vault.registry.setStageHash(
            runId, candidate.path, result.hash)
        this.state.hashed += 1
        this.state.hash_bytes += result.size
        this.state.inode_reuses += Math.max(0, updated.changes - 1)
        this.applyPreview(updated.preview)
        candidate = null
        deferCompletion = false
      } catch (error) {
        const retry = await this.vault.registry.markStageHashFailed(
          runId, candidate)
        if (error && error.code === "EVAULTCANCELLED") throw error
        if (!this.recordExclusion(
          error, candidate.path, candidate.source_id, null, candidate
        )) throw error
        this.state.hash_failures += 1
        const sourceId = candidate.source_id || "pinokio"
        this.state.source_hash_failures[sourceId] =
          (this.state.source_hash_failures[sourceId] || 0) + 1
        candidate = retry.next
        deferCompletion = !candidate && retry.anchor_fallback
      } finally {
        this.state.hash_duration_ms += Date.now() - started
        this.state.queued = 0
        this.currentHash = null
      }
    }
    if (!deferCompletion) this.completeHashWork(work)
  }

  async verifyCandidateAnchors(runId) {
    while (true) {
      this.checkpoint()
      const anchors = await this.vault.registry.unverifiedAnchorBatch(runId)
      if (!anchors.length) return
      for (const anchor of anchors) {
        this.checkpoint()
        let completeWork = false
        const expected = stageSnapshot(anchor)
        this.currentHash = {
          path: anchor.path,
          size: anchor.size,
          bytes: 0
        }
        try {
          const result = await this.vault.hashFile(anchor.path, {
            onProgress: (bytes) => {
              if (this.currentHash &&
                  this.currentHash.path === anchor.path) {
                this.currentHash.bytes = bytes
              }
            }
          })
          const current = await fs.promises.lstat(anchor.path)
          const unchanged = result.size === current.size &&
            sameSnapshot(expected, current)
          if (unchanged) {
            await this.vault.registry.markAnchorChecked(
              runId, anchor, result.hash)
            completeWork = true
          } else {
            const retry =
              await this.vault.registry.markAnchorVerificationFailed(
                runId, anchor)
            this.state.unstable_hashes += 1
            this.recordExclusion(
              null, anchor.path, null, "changed_during_scan")
            completeWork = !retry.retry_available
          }
        } catch (error) {
          const retry =
            await this.vault.registry.markAnchorVerificationFailed(
              runId, anchor)
          if (error && error.code === "EVAULTCANCELLED") throw error
          if (!this.recordExclusion(error, anchor.path)) throw error
          completeWork = !retry.retry_available
        } finally {
          if (completeWork) this.completeHashWork(anchor)
          this.currentHash = null
        }
      }
    }
  }
}

const stageSnapshot = (entry) => ({
  size: entry.size,
  mtime: entry.mtime,
  ctime: entry.ctime,
  dev: entry.dev,
  ino: entry.ino
})

const anchorEntry = (storeId, filePath, hash, stat) => ({
  store_id: storeId,
  hash_name: hash,
  path: filePath,
  size: stat.size,
  mtime: stat.mtimeMs,
  ctime: stat.ctimeMs,
  dev: stat.dev,
  ino: stat.ino,
  nlink: stat.nlink,
  mode: stat.mode,
  uid: stat.uid,
  gid: stat.gid
})

module.exports = Sweeper
