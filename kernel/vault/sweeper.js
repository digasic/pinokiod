const fs = require("fs")
const path = require("path")
const { walkBatches, statMany } = require("./walker")
const { fileSnapshot, sameSnapshot } = require("./snapshot")
const {
  DIR_CONCURRENCY,
  STAT_CONCURRENCY,
  SHA256_RE
} = require("./constants")

const isAccessError = (error) => !!(error &&
  (error.code === "EACCES" || error.code === "EPERM"))

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
    this.inaccessiblePaths = new Set()
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
      queued: 0,
      inode_reuses: 0,
      unstable_hashes: 0,
      hash_failures: 0,
      inaccessible: 0,
      inaccessible_paths: [],
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
    this.inaccessiblePaths.clear()
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

      await this.stageAnchors(runId)
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

      this.state.phase = "hashing"
      const hashStarted = Date.now()
      await this.hashCandidates(runId)
      await this.verifyCandidateAnchors(runId)
      this.state.hash_wait_duration_ms = Date.now() - hashStarted

      const incomplete = this.state.inaccessible > 0 ||
        this.state.hash_failures > 0 ||
        this.state.unstable_hashes > 0
      if (incomplete) {
        outcome = "incomplete"
        await registry.abortScan(runId)
      } else {
        this.state.phase = "publishing"
        this.state.duration_ms = Date.now() - this.state.started
        const metadata = this.scanMetadata(scopeId)
        const storeStat = await fs.promises.stat(this.vault.root)
        await registry.publishScan(
          runId,
          this.publicationSourceIds(scopeId),
          metadata,
          storeStat.dev,
          this.vault.mode === "link"
        )
        outcome = "complete"
      }
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
    }

    if (fatalError) throw fatalError
    return {
      dirs: this.state.dirs,
      files: this.state.files,
      bytes_total: this.state.bytes_total,
      candidates: this.state.candidates,
      incomplete: outcome === "incomplete",
      cancelled: outcome === "cancelled",
      inaccessible: this.state.inaccessible,
      inaccessible_paths: this.state.inaccessible_paths.slice()
    }
  }

  scanMetadata(scopeId) {
    return {
      scope_id: scopeId || "",
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

  recordInaccessible(error, filePath) {
    if (!isAccessError(error)) return false
    const target = path.resolve(filePath)
    this.inaccessiblePaths.add(target)
    this.state.inaccessible = this.inaccessiblePaths.size
    this.state.inaccessible_paths = [...this.inaccessiblePaths].slice(0, 20)
    return true
  }

  async stageAnchors(runId) {
    const blobRoot = this.vault.blobRoot
    let stat
    try {
      stat = await fs.promises.lstat(blobRoot)
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return
      throw error
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return

    for await (const directoryResults of walkBatches(blobRoot, {
      concurrency: this.dirConcurrency,
      strictErrors: true,
      onError: (error, filePath) => this.recordInaccessible(error, filePath)
    })) {
      this.checkpoint()
      const files = directoryResults.flatMap((group) =>
        group.files.map((file) => file.path))
      const stats = await statMany(files, this.statConcurrency, null, {
        followSymlinks: false,
        strictErrors: true,
        onError: (error, filePath) => this.recordInaccessible(error, filePath)
      })
      const anchors = []
      for (let index = 0; index < files.length; index++) {
        const filePath = files[index]
        const fileStat = stats[index]
        const hash = path.basename(filePath)
        if (!fileStat || !fileStat.isFile() || !SHA256_RE.test(hash)) continue
        if (path.basename(path.dirname(filePath)) !== hash.slice(0, 2)) continue
        anchors.push(anchorEntry(filePath, hash, fileStat))
      }
      await this.vault.registry.stageAnchors(runId, anchors)
    }
  }

  async walk(root, runId, preferredSourceId = null) {
    for await (const directoryResults of walkBatches(root, {
      concurrency: this.dirConcurrency,
      skipDirectory: (full) => full === this.vault.root,
      strictErrors: true,
      strictRoot: true,
      onError: (error, filePath) => this.recordInaccessible(error, filePath)
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
      onError: (error, filePath) => this.recordInaccessible(error, filePath)
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
          continue
        }
        if (!candidate.hash_needed || !candidate.inode_representative) {
          continue
        }
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
            await this.vault.registry.markStageHashFailed(
              runId, candidate.path)
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
        } catch (error) {
          await this.vault.registry.markStageHashFailed(
            runId, candidate.path)
          if (error && error.code === "EVAULTCANCELLED") throw error
          if (!this.recordInaccessible(error, candidate.path)) {
            this.state.hash_failures += 1
            const sourceId = candidate.source_id || "pinokio"
            this.state.source_hash_failures[sourceId] =
              (this.state.source_hash_failures[sourceId] || 0) + 1
          }
        } finally {
          this.state.hash_duration_ms += Date.now() - started
          this.state.queued = 0
          this.currentHash = null
        }
      }
    }
  }

  async verifyCandidateAnchors(runId) {
    await this.vault.registry.verifyAnchorsFromLinkedFiles(runId)
    while (true) {
      this.checkpoint()
      const anchors = await this.vault.registry.unverifiedAnchorBatch(runId)
      if (!anchors.length) return
      for (const anchor of anchors) {
        this.checkpoint()
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
          if (unchanged && result.hash === anchor.hash_name) {
            await this.vault.registry.markAnchorVerified(
              runId, anchor.hash_name, result.hash)
          } else {
            await this.vault.registry.markAnchorVerificationFailed(
              runId, anchor.hash_name)
            if (!unchanged) this.state.unstable_hashes += 1
          }
        } catch (error) {
          await this.vault.registry.markAnchorVerificationFailed(
            runId, anchor.hash_name)
          if (error && error.code === "EVAULTCANCELLED") throw error
          if (!this.recordInaccessible(error, anchor.path)) {
            this.state.hash_failures += 1
          }
        } finally {
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

const anchorEntry = (filePath, hash, stat) => ({
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
