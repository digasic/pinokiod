const path = require("path")
const {
  cancelledError,
  exclusionReason,
  isPathError
} = require("./operation_errors")

const PREVIEW_GROUP_LIMIT = 20

class Sweeper {
  constructor(vault) {
    this.vault = vault
    this.state = this.idleState()
    this.currentHash = null
    this.cancelRequested = false
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
    if (this.cancelRequested) throw cancelledError("Scan cancelled.")
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
    let runId = null
    let outcome = "failed"
    let fatalError = null
    let affectedApps = []
    try {
      runId = await registry.beginScan(scopeId)
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
      if (!scopeId) {
        await this.stageAnchors(runId, anchorStores)
        this.checkpoint()
      }

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
      if (scopeId) {
        await this.stageScopedAnchors(runId, anchorStores)
        this.checkpoint()
        const comparisons = await registry.stageComparisonFiles(
          runId, this.publicationSourceIds(scopeId))
        this.applyHashWork(comparisons && comparisons.work)
        await this.verifyComparisonFiles(runId)
      }

      this.state.phase = "hashing"
      const hashStarted = Date.now()
      await this.hashCandidates(runId)
      await registry.stageExclusions(runId, this.exclusionList())
      await this.verifyCandidateAnchors(runId)
      await registry.stageExclusions(runId, this.exclusionList())
      this.state.hash_wait_duration_ms = Date.now() - hashStarted
      this.checkpoint()

      outcome = this.exclusions.size
        ? "completed_with_exclusions"
        : "complete"
      this.state.phase = "publishing"
      this.state.duration_ms = Date.now() - this.state.started
      const stores = anchorStores
        .filter((store) =>
          store.available && Number.isFinite(store.dev))
        .map((store) => ({
          store_id: store.id,
          dev: store.dev,
          can_link: store.mode !== "copy",
          root: store.root
        }))
      const metadata = this.scanMetadata(scopeId, outcome)
      if (!scopeId) {
        metadata.linkable_devices = [...new Set(stores
          .filter((store) => store.can_link)
          .map((store) => store.dev))].sort((left, right) => left - right)
      }
      const publication = await registry.publishScan(
        runId,
        this.publicationSourceIds(scopeId),
        metadata,
        stores
      )
      affectedApps = publication && Array.isArray(publication.affected_apps)
        ? publication.affected_apps
        : []
    } catch (error) {
      if (runId !== null) await registry.abortScan(runId).catch(() => {})
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
      exclusions: this.exclusionList(),
      affected_apps: affectedApps
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
    await this.vault.scanner.walkAnchors(stores, {
      checkpoint: () => this.checkpoint(),
      onError: (error, filePath, reason = null) =>
        this.recordExclusion(error, filePath, null, reason),
      onEntries: async (anchors) => {
        const staged = await this.vault.registry.stageAnchors(
          runId, anchors)
        this.applyHashWork(staged && staged.work)
      }
    })
  }

  async stageScopedAnchors(runId, stores = []) {
    const storeIds = stores.map((store) => store.id).filter(Boolean)
    let cursor = null
    while (true) {
      this.checkpoint()
      const anchors = await this.vault.registry.scopedAnchorBatch(
        runId, storeIds, cursor)
      if (!anchors.length) return
      const observations = await this.vault.scanner.validateSnapshots(anchors)
      const checked = anchors.flatMap((anchor, index) =>
        observations[index] && observations[index].valid
          ? [Object.assign({}, anchor, {
              hash_name: anchor.hash,
              nlink: observations[index].nlink
            })]
          : [])
      const staged = await this.vault.registry.stageAnchors(runId, checked)
      this.applyHashWork(staged && staged.work)
      const last = anchors[anchors.length - 1]
      cursor = { store_id: last.store_id, hash: last.hash }
    }
  }

  async verifyComparisonFiles(runId) {
    while (true) {
      this.checkpoint()
      const entries = await this.vault.registry.comparisonFileBatch(runId)
      if (!entries.length) {
        const work = await this.vault.registry.stagedHashWork(runId)
        this.applyHashWork(work)
        return
      }
      const observations = await this.vault.scanner.validateSnapshots(entries)
      await this.vault.registry.resolveComparisonFiles(runId, observations)
    }
  }

  async walk(root, runId, preferredSourceId = null) {
    await this.vault.scanner.walk(root, {
      checkpoint: () => this.checkpoint(),
      skipDirectory: (full) => this.vault.isStorageRoot(full),
      onError: (error, filePath) =>
        this.recordExclusion(error, filePath, preferredSourceId),
      onBatch: async ({ files, directories }) => {
        this.state.dirs += directories
        const entries = files.map((file) =>
          this.considerStat(file.path, file.stat, preferredSourceId))
          .filter(Boolean)
        const staged = await this.vault.registry.stageFiles(
          runId, entries, this.vault.sizeThreshold)
        this.state.candidates += Number(staged && staged.changes) || 0
        this.applyPreview(staged && staged.preview)
        this.applyHashWork(staged && staged.work)
      }
    })
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
      const completed = []
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
        await this.hashCandidateRoutes(runId, candidate, completed)
      }
      if (completed.length) {
        this.checkpoint()
        const updated = await this.vault.registry.setStageHashes(
          runId,
          completed.map((entry) => ({
            path: entry.path,
            hash: entry.hash
          }))
        )
        this.applyPreview(updated.preview)
      }
    }
  }

  async hashCandidateRoutes(runId, work, completed = null) {
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
        const verified = await this.vault.scanner.hashStable(candidate, {
          onProgress: (bytes) => {
            if (this.currentHash &&
                this.currentHash.path === candidate.path) {
              this.currentHash.bytes = bytes
            }
          }
        })
        if (!verified.stable) {
          if (!candidate.comparison_only) this.state.unstable_hashes += 1
          const retry = await this.vault.registry.markStageHashFailed(
            runId, candidate)
          if (!candidate.comparison_only) {
            this.recordExclusion(
              null,
              candidate.path,
              candidate.source_id,
              "changed_during_scan",
              candidate
            )
          }
          candidate = retry.next
          deferCompletion = !candidate && retry.anchor_fallback
          continue
        }
        const staged = completed &&
          !(candidate.nlink > 1 && candidate.ino !== 0)
          ? null
          : candidate.nlink > 1 && candidate.ino !== 0
            ? await this.vault.registry.setStageInodeHash(
              runId, candidate.dev, candidate.ino, verified.result.hash)
            : await this.vault.registry.setStageHash(
              runId, candidate.path, verified.result.hash)
        if (!staged) {
          completed.push({
            path: candidate.path,
            hash: verified.result.hash
          })
        }
        this.state.hashed += 1
        this.state.hash_bytes += verified.result.size
        if (staged) {
          this.state.inode_reuses += Math.max(0, staged.changes - 1)
          this.applyPreview(staged.preview)
        }
        candidate = null
        deferCompletion = false
      } catch (error) {
        if (error && error.code === "EVAULTCANCELLED") throw error
        const retry = await this.vault.registry.markStageHashFailed(
          runId, candidate)
        if (!candidate.comparison_only && !this.recordExclusion(
          error, candidate.path, candidate.source_id, null, candidate
        )) throw error
        if (!candidate.comparison_only) {
          this.state.hash_failures += 1
          const sourceId = candidate.source_id || "pinokio"
          this.state.source_hash_failures[sourceId] =
            (this.state.source_hash_failures[sourceId] || 0) + 1
        }
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
        this.currentHash = {
          path: anchor.path,
          size: anchor.size,
          bytes: 0
        }
        try {
          const verified = await this.vault.scanner.hashStable(anchor, {
            onProgress: (bytes) => {
              if (this.currentHash &&
                  this.currentHash.path === anchor.path) {
                this.currentHash.bytes = bytes
              }
            }
          })
          if (verified.stable) {
            await this.vault.registry.markAnchorChecked(
              runId, anchor, verified.result.hash)
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
          if (error && error.code === "EVAULTCANCELLED") throw error
          const retry =
            await this.vault.registry.markAnchorVerificationFailed(
              runId, anchor)
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

module.exports = Sweeper
