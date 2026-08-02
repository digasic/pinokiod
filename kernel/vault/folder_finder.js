const fs = require("fs")
const path = require("path")
const { sameSnapshot } = require("./snapshot")
const {
  cancelledError,
  exclusionReason,
  isPathError
} = require("./operation_errors")

const comparablePath = (value) => process.platform === "win32"
  ? path.resolve(value).toLowerCase()
  : path.resolve(value)

const isPathWithin = (root, target) => {
  const relative = path.relative(
    comparablePath(root),
    comparablePath(target)
  )
  return relative === "" || (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  )
}

class FolderFinder {
  constructor(vault) {
    this.vault = vault
    this.state = this.idleState()
    this.currentHash = null
    this.cancelRequested = false
    this.runId = null
    this.exclusions = new Map()
  }

  idleState() {
    return {
      active: false,
      phase: "idle",
      root: null,
      threshold: null,
      dirs: 0,
      files: 0,
      candidates: 0,
      candidates_known: false,
      hashed: 0,
      processed: 0,
      hash_bytes: 0,
      verified_files: 0,
      verified_bytes: 0,
      current_folder: null,
      last_activity: null,
      result_count: 0,
      result_files: 0,
      result_bytes: 0,
      exclusions: [],
      partial: false,
      started: null,
      duration_ms: null,
      error: null
    }
  }

  queue(selectedRoot, threshold, baselinePartial) {
    this.state = Object.assign(this.idleState(), {
      phase: "queued",
      root: path.resolve(selectedRoot),
      threshold,
      partial: !!baselinePartial,
      started: Date.now(),
      last_activity: Date.now()
    })
  }

  cancel() {
    if (!this.state.active) return false
    this.cancelRequested = true
    return true
  }

  checkpoint() {
    if (this.cancelRequested) {
      throw cancelledError("Folder search cancelled.")
    }
  }

  recordExclusion(error, filePath, reason = null) {
    if (!reason && !isPathError(error)) return false
    const target = path.resolve(filePath)
    this.exclusions.set(target, {
      path: target,
      reason: reason || exclusionReason(error),
      created_at: Date.now()
    })
    this.state.partial = true
    this.state.exclusions = this.exclusionList().slice(0, 100)
    return true
  }

  exclusionList() {
    return [...this.exclusions.values()]
  }

  async referenceIsCurrent(reference) {
    try {
      const stat = await fs.promises.lstat(reference.path)
      if (stat.isFile() &&
          !stat.isSymbolicLink() &&
          sameSnapshot(reference, stat)) return true
      this.recordExclusion(
        null, reference.path, "source_changed_since_scan")
      return false
    } catch (error) {
      if (this.recordExclusion(
        error, reference.path, "source_changed_since_scan"
      )) return false
      throw error
    }
  }

  async hasVerifiedReference(candidate, expectedHash) {
    while (true) {
      const known = await this.vault.registry.folderDiscoveryReferences(
        this.runId, candidate, expectedHash)
      if (!known.length) break
      for (const reference of known) {
        this.checkpoint()
        if (await this.referenceIsCurrent(reference)) return true
        await this.vault.registry.markFolderDiscoveryReferenceHashFailed(
          this.runId, reference.path)
      }
    }

    while (true) {
      this.checkpoint()
      const references = await this.vault.registry
        .folderDiscoveryReferenceHashBatch(this.runId, candidate)
      if (!references.length) return false
      for (const reference of references) {
        this.checkpoint()
        if (!(await this.referenceIsCurrent(reference))) {
          await this.vault.registry
            .markFolderDiscoveryReferenceHashFailed(
              this.runId, reference.path)
          continue
        }
        this.currentHash = {
          path: reference.path,
          size: reference.size,
          bytes: 0
        }
        try {
          const checked = await this.vault.scanner.hashStable(reference, {
            onProgress: (bytes) => {
              if (this.currentHash &&
                  this.currentHash.path === reference.path) {
                this.currentHash.bytes = bytes
                this.state.last_activity = Date.now()
              }
            }
          })
          if (!checked.stable) {
            await this.vault.registry
              .markFolderDiscoveryReferenceHashFailed(
                this.runId, reference.path)
            this.recordExclusion(
              null, reference.path, "source_changed_since_scan")
            continue
          }
          await this.vault.registry.setFolderDiscoveryReferenceHash(
            this.runId, reference.path, checked.result.hash)
          if (checked.result.hash === expectedHash) return true
        } catch (error) {
          await this.vault.registry
            .markFolderDiscoveryReferenceHashFailed(
              this.runId, reference.path).catch(() => {})
          if (error && error.code === "EVAULTCANCELLED") throw error
          if (!this.recordExclusion(error, reference.path)) throw error
        } finally {
          this.currentHash = null
        }
      }
    }
  }

  async verifyCandidateAnchors(candidate, expectedHash) {
    while (true) {
      this.checkpoint()
      const anchors = await this.vault.registry.folderDiscoveryAnchors(
        this.runId, candidate, expectedHash)
      if (!anchors.length) return false
      for (const anchor of anchors) {
        this.checkpoint()
        let valid = false
        try {
          const stat = await fs.promises.lstat(anchor.path)
          valid = stat.isFile() && !stat.isSymbolicLink() &&
            sameSnapshot(anchor, stat)
          if (!valid) {
            this.recordExclusion(
              null, anchor.path, "source_changed_since_scan")
          }
        } catch (error) {
          if (!this.recordExclusion(
            error, anchor.path, "source_changed_since_scan"
          )) throw error
        }
        await this.vault.registry.markFolderDiscoveryAnchorChecked(
          this.runId, anchor.store_id, anchor.hash, valid)
        if (valid) return true
      }
    }
  }

  async search(selectedRoot, options = {}) {
    this.cancelRequested = false
    this.exclusions.clear()
    const threshold = Math.max(0, Number(options.threshold) || 0)
    const baselinePartial = !!options.partial
    this.state = Object.assign(this.idleState(), {
      active: true,
      phase: "discovering",
      root: path.resolve(selectedRoot),
      threshold,
      partial: baselinePartial,
      started: Date.now(),
      last_activity: Date.now()
    })
    let candidateStatusAt = 0
    let verifiedStatusAt = 0
    let outcome = "failed"
    let fatalError = null
    try {
      const canonicalRoot = path.resolve(
        await fs.promises.realpath(selectedRoot))
      const rootStat = await fs.promises.lstat(canonicalRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        const error = new Error("Choose a folder, not a file.")
        error.code = "ENOTDIR"
        throw error
      }
      this.state.root = canonicalRoot

      await this.vault.refreshSources()
      const excludedRoots = this.vault.folderDiscoveryExcludedRoots()
      if (excludedRoots.some((root) => isPathWithin(root, canonicalRoot))) {
        const error = new Error("This folder is already in Locations.")
        error.code = "EVAULTALREADYSCANNED"
        throw error
      }

      const allowedDevices = this.vault.anchorStores()
        .filter((store) =>
          store.available &&
          store.mode !== "copy" &&
          Number.isFinite(store.dev))
        .map((store) => store.dev)
      if (!allowedDevices.includes(rootStat.dev) &&
          await this.vault.probe(canonicalRoot) === "link") {
        allowedDevices.push(rootStat.dev)
      }
      const started = await this.vault.registry.beginFolderDiscovery(
        canonicalRoot,
        threshold,
        this.vault.scopeSourceIds(),
        allowedDevices
      )
      this.runId = started.id
      this.checkpoint()

      await this.vault.scanner.walk(canonicalRoot, {
        checkpoint: () => this.checkpoint(),
        skipDirectory: (directory) => excludedRoots.some((root) =>
          isPathWithin(root, directory)),
        onError: (error, filePath) =>
          comparablePath(filePath) === comparablePath(canonicalRoot)
            ? false
            : this.recordExclusion(error, filePath),
        onBatch: async ({ files, directories, currentDirectory }) => {
          this.checkpoint()
          if (currentDirectory) this.state.current_folder = currentDirectory
          this.state.dirs += directories
          this.state.files += files.length
          const entries = files
            .filter(({ stat }) => stat.size > 0 && stat.size >= threshold)
            .map(({ path: filePath, stat }) => ({
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
            }))
          await this.vault.registry.stageFolderDiscoveryFiles(
            this.runId, entries)
          this.state.last_activity = Date.now()
          if (this.state.last_activity - candidateStatusAt >= 500) {
            const liveWork = await this.vault.registry
              .folderDiscoveryWorkSummary(this.runId)
            this.state.candidates = liveWork.files
            this.state.candidates_known = true
            candidateStatusAt = this.state.last_activity
          }
        }
      })

      const work = await this.vault.registry.folderDiscoveryWorkSummary(
        this.runId)
      this.state.candidates = work.files
      this.state.candidates_known = true
      this.state.phase = "hashing"
      while (true) {
        this.checkpoint()
        const batch = await this.vault.registry
          .folderDiscoveryHashBatch(this.runId)
        if (!batch.length) break
        for (const candidate of batch) {
          this.checkpoint()
          this.currentHash = {
            path: candidate.path,
            size: candidate.size,
            bytes: 0
          }
          try {
            const checked = await this.vault.scanner.hashStable(candidate, {
              onProgress: (bytes) => {
                if (this.currentHash &&
                    this.currentHash.path === candidate.path) {
                  this.currentHash.bytes = bytes
                  this.state.last_activity = Date.now()
                }
              }
            })
            if (!checked.stable) {
              await this.vault.registry.markFolderDiscoveryHashFailed(
                this.runId, candidate)
              this.recordExclusion(
                null, candidate.path, "changed_during_search")
              continue
            }
            await this.vault.registry.setFolderDiscoveryHash(
              this.runId, candidate, checked.result.hash)
            this.state.hashed += 1
            this.state.hash_bytes += checked.result.size
            this.state.last_activity = Date.now()

            await this.hasVerifiedReference(candidate, checked.result.hash)
            await this.verifyCandidateAnchors(
              candidate, checked.result.hash)
            if (Date.now() - verifiedStatusAt >= 500) {
              const verified = await this.vault.registry
                .folderDiscoveryVerifiedSummary(this.runId)
              this.state.verified_files = verified.files
              this.state.verified_bytes = verified.bytes
              verifiedStatusAt = Date.now()
            }
          } catch (error) {
            await this.vault.registry.markFolderDiscoveryHashFailed(
              this.runId, candidate).catch(() => {})
            if (error && error.code === "EVAULTCANCELLED") throw error
            if (!this.recordExclusion(error, candidate.path)) throw error
          } finally {
            this.currentHash = null
            this.state.processed += 1
            this.state.last_activity = Date.now()
          }
        }
        const verified = await this.vault.registry
          .folderDiscoveryVerifiedSummary(this.runId)
        this.state.verified_files = verified.files
        this.state.verified_bytes = verified.bytes
      }

      this.state.phase = "preparing_results"
      const verified = await this.vault.registry
        .finalizeFolderDiscoveryMatches(this.runId)
      this.state.verified_files = verified.files
      this.state.verified_bytes = verified.bytes
      const prepared = await this.vault.registry
        .prepareFolderDiscoveryResults(this.runId, canonicalRoot)
      this.state.result_count = prepared.recommendations
      this.state.result_files = verified.files
      this.state.result_bytes = verified.bytes
      outcome = this.state.partial || this.exclusions.size
        ? "completed_with_exclusions"
        : "complete"
    } catch (error) {
      if (this.runId) {
        await this.vault.registry.abortFolderDiscovery(this.runId)
          .catch(() => {})
        this.runId = null
      }
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
      this.state.error = fatalError
        ? fatalError.message || String(fatalError)
        : null
    }

    if (fatalError) throw fatalError
    return {
      outcome,
      partial: outcome === "completed_with_exclusions",
      cancelled: outcome === "cancelled",
      result_count: this.state.result_count,
      result_files: this.state.result_files,
      result_bytes: this.state.result_bytes,
      exclusions: this.exclusionList()
    }
  }
}

module.exports = FolderFinder
