const fs = require('fs')
const path = require('path')
const fastq = require('fastq')
const { walkBatches, statMany } = require('./walker')
const { fileSnapshot, sameSnapshot, sameContentState } = require('./snapshot')
const { SHA256_RE, TMP_SUFFIX, DIR_CONCURRENCY, STAT_CONCURRENCY, HASH_QUEUE_LIMIT } = require('./constants')

const isMissingError = (error) => !!(error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
const isAccessError = (error) => !!(error && (error.code === "EACCES" || error.code === "EPERM"))
const isPathWithin = (root, target) => {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
}
const readFileNoFollow = async (filePath) => {
  const before = await fs.promises.lstat(filePath)
  if (!before.isFile()) return null
  const handle = await fs.promises.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return null
    return await handle.readFile("utf8")
  } finally {
    await handle.close()
  }
}

// Manual scan engine (spec/requirements/shared-model-store.md).
// Scans run ONLY when the user asks — there are no automatic triggers.
// The walk is generic: every regular file counts toward folder totals, and
// every file >= the size threshold is a candidate. No name heuristics.
// A scan never creates a Vault hardlink or replaces a source path. New content
// is recorded as an independent copy; a managed store name is created only
// after the user explicitly asks to deduplicate a matching file.

class Sweeper {
  constructor(vault) {
    this.vault = vault
    this.kernel = vault.kernel
    this.state = this.idleState()
    this.currentHash = null
    this.hashQueue = fastq.promise(this, this._hashJob, 1)
    this.statConcurrency = vault.statConcurrency || STAT_CONCURRENCY
    this.dirConcurrency = vault.dirConcurrency || DIR_CONCURRENCY
    this.hashQueueLimit = vault.hashQueueLimit || HASH_QUEUE_LIMIT
    this.hashCapacityWaiters = []
    this.metadataBaseCache = new Map()
    this.hashJobsByIno = new Map()
    this.completedHashesByIno = new Map()
    this.inaccessiblePaths = new Set()
  }
  idleState() {
    return {
      active: false, phase: "idle", dirs: 0, files: 0, bytes_total: 0,
      counted_dirs: 0, counted_files: 0, total_files: null,
      home_bytes_total: 0, source_bytes: {}, source_files: {}, source_hash_failures: {}, scope_id: null,
      candidates: 0, hashed: 0, hash_total: 0, hash_bytes: 0, queued: 0,
      inode_reuses: 0, unstable_hashes: 0, hash_failures: 0,
      inaccessible: 0, inaccessible_paths: [],
      started: null, duration_ms: null,
      count_duration_ms: null, walk_duration_ms: null, hash_wait_duration_ms: null,
      hash_duration_ms: 0
    }
  }
  // A global scan covers Pinokio plus explicit imports. A scoped scan covers
  // exactly one physical source (used by an app's Save space page).
  async scan(scopeId = null) {
    if (this.state.active) return { already_running: true }
    this.state = Object.assign(this.idleState(), {
      active: true, phase: "counting", started: Date.now(), scope_id: scopeId
    })
    this.metadataBaseCache.clear()
    this.hashJobsByIno.clear()
    this.completedHashesByIno.clear()
    this.inaccessiblePaths.clear()
    this.vault.registry.beginBatch()
    let completed = false
    let incomplete = false
    try {
      await this.vault.refreshSources()
      if (!scopeId) this.vault.reconcileConfiguredSources()
      const scanRoots = this.vault.scanRoots(scopeId)
      if (!scanRoots.length) throw new Error("That scan location is no longer available.")
      const countStarted = Date.now()
      for (const source of scanRoots) await this.countFiles(source.root)
      this.state.count_duration_ms = Date.now() - countStarted
      this.state.total_files = this.state.counted_files
      this.state.phase = "discovering"
      const walkStarted = Date.now()
      for (const source of scanRoots) {
        if (!Object.prototype.hasOwnProperty.call(this.state.source_bytes, source.source_id)) {
          this.state.source_bytes[source.source_id] = 0
        }
        await this.walk(source.root, source.source_id === "pinokio" ? null : source.source_id)
      }
      this.state.walk_duration_ms = Date.now() - walkStarted
      this.state.phase = "analyzing"
      const hashWaitStarted = Date.now()
      await this.settle()
      this.state.hash_wait_duration_ms = Date.now() - hashWaitStarted
      const scanMeta = {
        dirs: this.state.dirs,
        files: this.state.files,
        bytes_total: this.state.bytes_total,
        home_bytes_total: this.state.home_bytes_total,
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
        count_duration_ms: this.state.count_duration_ms,
        walk_duration_ms: this.state.walk_duration_ms,
        hash_wait_duration_ms: this.state.hash_wait_duration_ms,
        hash_duration_ms: this.state.hash_duration_ms
      }
      // Refresh dead-name and orphan state from filesystem identity after
      // every completed discovery pass, as required by the Vault contract.
      this.state.phase = "verifying"
      await this.vault.verify({
        includePath: scopeId
          ? (filePath) => isPathWithin(scanRoots[0].root, filePath)
          : undefined,
        reconcile: !scopeId,
        verifyBlobs: !scopeId,
        preservePath: (filePath) => this.isInaccessible(filePath),
        onAccessError: (error, filePath) => this.recordInaccessible(error, filePath),
        repairStores: false
      })
      this.state.duration_ms = Date.now() - this.state.started
      incomplete = this.state.inaccessible > 0
      if (!incomplete) {
        scanMeta.ts = Date.now()
        scanMeta.duration_ms = this.state.duration_ms
        this.vault.registry.setLastScan(scanMeta, scopeId)
        if (!scopeId) {
          for (const source of this.vault.sources()) {
            if (source.kind !== "app" || !source.available) continue
            const sourceId = source.id
            const bytes = scanMeta.source_bytes[sourceId] || 0
            this.vault.registry.setLastScan({
              ts: scanMeta.ts,
              duration_ms: scanMeta.duration_ms,
              count_duration_ms: scanMeta.count_duration_ms,
              walk_duration_ms: scanMeta.walk_duration_ms,
              hash_wait_duration_ms: scanMeta.hash_wait_duration_ms,
              files: scanMeta.source_files[sourceId] || 0,
              bytes_total: bytes,
              home_bytes_total: 0,
              hash_failures: scanMeta.source_hash_failures[sourceId] || 0,
              source_bytes: { [sourceId]: bytes },
              source_files: { [sourceId]: scanMeta.source_files[sourceId] || 0 },
              source_hash_failures: {
                [sourceId]: scanMeta.source_hash_failures[sourceId] || 0
              }
            }, sourceId)
          }
        }
      }
      completed = true
    } finally {
      // A failed walk must not leave background hash work or per-scan inode
      // state alive when the next manual scan starts.
      await this.settle().catch(() => {})
      await this.vault.registry.eventPromise
      this.hashJobsByIno.clear()
      this.completedHashesByIno.clear()
      this.state.active = false
      this.state.phase = completed ? (incomplete ? "incomplete" : "complete") : "failed"
      await this.vault.registry.endBatch({ flush: true })
    }
    return {
      dirs: this.state.dirs, files: this.state.files,
      bytes_total: this.state.bytes_total, candidates: this.state.candidates,
      incomplete, inaccessible: this.state.inaccessible,
      inaccessible_paths: this.state.inaccessible_paths.slice()
    }
  }
  recordInaccessible(error, filePath) {
    if (!isAccessError(error)) return false
    const target = path.resolve(filePath)
    if ([...this.inaccessiblePaths].some((existing) => isPathWithin(existing, target))) return true
    for (const existing of [...this.inaccessiblePaths]) {
      if (isPathWithin(target, existing)) this.inaccessiblePaths.delete(existing)
    }
    this.inaccessiblePaths.add(target)
    this.state.inaccessible = this.inaccessiblePaths.size
    this.state.inaccessible_paths = [...this.inaccessiblePaths].slice(0, 20)
    return true
  }
  isInaccessible(filePath) {
    return [...this.inaccessiblePaths].some((target) => isPathWithin(target, filePath))
  }
  async countFiles(root) {
    const vaultRoot = this.vault.root
    for await (const directoryResults of walkBatches(root, {
      concurrency: this.dirConcurrency,
      skipDirectory: (full) => full === vaultRoot,
      strictErrors: true,
      onError: (error, filePath) => this.recordInaccessible(error, filePath)
    })) {
      this.state.counted_dirs += directoryResults.filter((group) => group.firstChunk).length
      this.state.counted_files += directoryResults.reduce((sum, group) => sum +
        group.files.filter((file) => !file.path.endsWith(TMP_SUFFIX)).length, 0)
    }
  }
  async settle() {
    await this.hashQueue.drained()
  }
  async walk(root, preferredSourceId = null) {
    const vaultRoot = this.vault.root
    for await (const directoryResults of walkBatches(root, {
      concurrency: this.dirConcurrency,
      skipDirectory: (full) => full === vaultRoot,
      strictErrors: true,
      onError: (error, filePath) => this.recordInaccessible(error, filePath)
    })) {
      this.state.dirs += directoryResults.filter((group) => group.firstChunk).length
      const files = []
      const hfDirectories = []
      for (const { dir, entries, files: directoryFiles } of directoryResults) {
        if (!entries) continue
        const isHfBlobDirectory = path.basename(dir) === "blobs" &&
          /^(models|datasets|spaces)--/.test(path.basename(path.dirname(dir)))
        const hashEntries = []
        for (const file of directoryFiles) {
          // A 64-hex HF blob name is a hash-free input. Everything else still
          // follows the generic candidate path.
          if (isHfBlobDirectory && file.entry.isFile() && SHA256_RE.test(file.entry.name)) {
            hashEntries.push(file.entry)
          }
          else files.push(file.path)
        }
        if (hashEntries.length) hfDirectories.push({ dir, entries: hashEntries })
      }
      // One metadata pool is shared by all files in this directory batch, so
      // trees made of many small directories still use the bounded workers.
      await this.considerFiles(files, preferredSourceId)
      for (const { dir, entries } of hfDirectories) {
        await this.ingestHfBlobs(dir, entries, preferredSourceId)
      }
    }
  }
  async considerFiles(filePaths, preferredSourceId = null) {
    const stats = await statMany(filePaths, this.statConcurrency, null, {
      followSymlinks: false,
      strictErrors: true,
      onError: (error, filePath) => this.recordInaccessible(error, filePath)
    })
    // Preserve deterministic classification order while parallelizing only
    // the expensive filesystem metadata reads.
    for (let index = 0; index < filePaths.length; index++) {
      if (stats[index] && stats[index].isFile()) {
        await this.considerStat(filePaths[index], stats[index], preferredSourceId)
      }
    }
  }
  countFile(sourceId) {
    this.state.files += 1
    this.state.source_files[sourceId] = (this.state.source_files[sourceId] || 0) + 1
    if (this.state.total_files !== null && this.state.files > this.state.total_files) {
      this.state.total_files = this.state.files
    }
  }
  async considerStat(filePath, st, preferredSourceId = null) {
    if (filePath.endsWith(TMP_SUFFIX)) return
    const registry = this.vault.registry
    const source = this.vault.sourceForPath(filePath, preferredSourceId)
    const sourceId = source ? source.id : null
    const appName = source && source.kind === "app" ? source.app : null
    const sourceKey = sourceId || preferredSourceId || "pinokio"
    this.countFile(sourceKey)
    this.state.bytes_total += st.size
    this.state.source_bytes[sourceKey] = (this.state.source_bytes[sourceKey] || 0) + st.size
    if (!preferredSourceId) this.state.home_bytes_total += st.size
    if (registry.excluded.has(filePath)) {
      registry.untrack(filePath)
      return
    }
    if (st.size < this.vault.sizeThreshold) {
      await this.untrackBelowThreshold(filePath, st, { app: appName, source_id: sourceId })
      return
    }
    this.state.candidates += 1
    // Known and unchanged: nothing to do.
    const inoHash = registry.byIno.get(registry.inoKey(st.dev, st.ino))
    if (inoHash && st.nlink > 1) {
      const cached = registry.scanIndex.get(filePath)
      const unchanged = cached && cached.hash === inoHash && sameSnapshot(cached, st)
      if (unchanged) {
        const registered = registry.links.get(filePath)
        const mode = registered && registered.mode === "copy" ? "copy" : "link"
        registry.addLink(filePath, { hash: inoHash, app: appName, source_id: sourceId, dev: st.dev, ino: st.ino, mode })
        return
      }
    }
    const cached = registry.scanIndex.get(filePath)
    if (cached && cached.hash && sameSnapshot(cached, st)) {
      await this.classify(filePath, st, cached.hash, sourceId)
      return
    }
    const harvested = await this.harvestLocalDirEtag(
      filePath,
      st,
      source && source.root ? source.root : this.kernel.homedir
    )
    if (harvested) {
      await this.classify(filePath, st, harvested, sourceId)
      return
    }
    // Only coalesce an inode which the filesystem itself reports as having
    // multiple names. This avoids trusting placeholder inode values on
    // filesystems which do not expose usable identity metadata.
    const reusableInode = st.nlink > 1 && st.ino !== undefined && st.ino !== 0
    const inodeKey = reusableInode ? registry.inoKey(st.dev, st.ino) : null
    const existingJob = inodeKey ? this.hashJobsByIno.get(inodeKey) : null
    const name = { filePath, source_id: sourceId, expected: fileSnapshot(st) }
    if (existingJob) {
      existingJob.names.push(name)
      this.state.inode_reuses += 1
      return
    }
    const completed = inodeKey ? this.completedHashesByIno.get(inodeKey) : null
    if (completed && sameContentState(completed.expected, st)) {
      this.state.inode_reuses += 1
      await this.classify(filePath, st, completed.hash, sourceId)
      return
    }
    if (completed) this.completedHashesByIno.delete(inodeKey)
    const job = { inodeKey, names: [name] }
    if (inodeKey) this.hashJobsByIno.set(inodeKey, job)
    this.state.hash_total += 1
    this.state.queued += 1
    this.hashQueue.push(job).catch(() => {})
    if (this.state.queued >= this.hashQueueLimit) {
      await new Promise((resolve) => this.hashCapacityWaiters.push(resolve))
    }
  }
  invalidateLinkedInode(hash, dev, ino) {
    const registry = this.vault.registry
    for (const [filePath, entry] of [...registry.links]) {
      if (entry.hash === hash && entry.mode === "link" && entry.dev === dev && entry.ino === ino) {
        registry.untrack(filePath)
      }
    }
    const hasCopies = [...registry.links.values()].some((entry) =>
      entry.hash === hash && entry.mode === "copy")
    if (hasCopies) {
      const blob = registry.blobs.get(hash)
      if (blob) {
        blob.orphan = false
        blob.verified_at = null
        registry.schedulePersist()
      }
    } else {
      registry.removeBlob(hash)
    }
  }
  async untrackBelowThreshold(filePath, st, meta = {}) {
    const registry = this.vault.registry
    const linked = registry.links.get(filePath)
    if (linked && linked.mode === "link") {
      let storeStat = null
      try {
        storeStat = await this.vault.storeStatIfPresent(this.vault.storePathFor(linked.hash))
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
      if (storeStat && storeStat.dev === st.dev && storeStat.ino === st.ino) {
        const cached = registry.scanIndex.get(filePath)
        try {
          await fs.promises.unlink(this.vault.storePathFor(linked.hash))
        } catch (error) {
          if (!error || error.code !== "ENOENT") return
        }
        this.invalidateLinkedInode(linked.hash, st.dev, st.ino)
        if (cached && !sameSnapshot(cached, st)) {
          await this.vault.recordEvent({
            kind: "diverged", hash: linked.hash, path: filePath,
            app: meta.app || linked.app || null,
            source_id: meta.source_id || linked.source_id || null,
            size: st.size
          })
        }
      }
    }
    registry.untrack(filePath)
  }
  async _hashJob(job) {
    const primary = job.names[0]
    const started = Date.now()
    const currentHash = {
      path: primary.filePath,
      size: Math.max(0, Number(primary.expected.size) || 0),
      bytes: 0
    }
    this.currentHash = currentHash
    try {
      const { hash, size } = await this.vault.hashFile(primary.filePath, {
        onProgress: (bytes) => {
          if (this.currentHash === currentHash) {
            currentHash.bytes = Math.min(currentHash.size, Math.max(0, Number(bytes) || 0))
          }
        }
      })
      this.state.hashed += 1
      this.state.hash_bytes += size || 0
      const primaryStat = await fs.promises.lstat(primary.filePath)
      // Never publish a digest if the path changed while its bytes were read.
      // The next manual scan can retry a continuously-mutating file safely.
      if (size !== primaryStat.size || !sameSnapshot(primary.expected, primaryStat)) {
        this.state.unstable_hashes += 1
        return
      }
      let index = 0
      while (index < job.names.length) {
        const name = job.names[index++]
        let st
        try {
          st = name === primary ? primaryStat : await fs.promises.lstat(name.filePath)
        } catch (e) {
          continue
        }
        // Same (device, inode) is physical identity, not a content guess.
        // Size and mtime also prevent applying a completed digest after an
        // in-place content change.
        if (!sameContentState(fileSnapshot(primaryStat), st)) continue
        await this.classify(name.filePath, st, hash, name.source_id)
      }
      if (job.inodeKey) {
        const current = await fs.promises.lstat(primary.filePath)
        if (sameContentState(fileSnapshot(primaryStat), current)) {
          this.completedHashesByIno.set(job.inodeKey, {
            hash,
            expected: fileSnapshot(current)
          })
        }
      }
    } catch (e) {
      if (!this.recordInaccessible(e, primary.filePath)) {
        this.state.hash_failures += 1
        const sourceId = primary.source_id || "pinokio"
        this.state.source_hash_failures[sourceId] =
          (this.state.source_hash_failures[sourceId] || 0) + 1
      }
    } finally {
      this.state.hash_duration_ms += Date.now() - started
      if (job.inodeKey && this.hashJobsByIno.get(job.inodeKey) === job) {
        this.hashJobsByIno.delete(job.inodeKey)
      }
      if (this.currentHash === currentHash) this.currentHash = null
      this.state.queued = Math.max(0, this.state.queued - 1)
      if (this.state.queued < this.hashQueueLimit) {
        for (const resolve of this.hashCapacityWaiters.splice(0)) resolve()
      }
    }
  }
  // Hash known: record the first physical copy without adding a filesystem
  // name. Other byte-identical inodes are pending until the user approves
  // deduplication.
  async classify(filePath, st, hash, preferredSourceId = null) {
    const registry = this.vault.registry
    try {
      const current = await fs.promises.lstat(filePath)
      if (!sameContentState(fileSnapshot(st), current)) {
        registry.untrack(filePath)
        this.state.unstable_hashes += 1
        return
      }
      st = current
    } catch (error) {
      if (!isMissingError(error)) throw error
      registry.untrack(filePath)
      return
    }
    const source = this.vault.sourceForPath(filePath, preferredSourceId)
    const sourceId = source ? source.id : null
    const appName = source && source.kind === "app" ? source.app : null
    // Divergence: this inode was registered under a different hash — the
    // shared content was written in place. Evict the stale blob.
    const priorHash = registry.byIno.get(registry.inoKey(st.dev, st.ino))
    if (priorHash && priorHash !== hash) {
      const stalePath = this.vault.storePathFor(priorHash)
      let removedStaleStore = false
      try {
        const staleStat = await this.vault.storeStatIfPresent(stalePath)
        if (staleStat && staleStat.isFile() && staleStat.dev === st.dev && staleStat.ino === st.ino) {
          await fs.promises.unlink(stalePath)
          removedStaleStore = true
        }
      } catch (error) {
        if (!isMissingError(error)) throw error
      }
      if (removedStaleStore) this.invalidateLinkedInode(priorHash, st.dev, st.ino)
      else registry.untrack(filePath)
      this.vault.recordEvent({ kind: "diverged", hash: priorHash, path: filePath, app: appName, source_id: sourceId, size: st.size })
      if (removedStaleStore) {
        // Removing the stale store name changes ctime on this inode. Refresh
        // the trusted snapshot before classification, but reject any content change.
        const current = await fs.promises.lstat(filePath)
        if (!sameContentState(fileSnapshot(st), current)) {
          registry.untrack(filePath)
          this.state.unstable_hashes += 1
          return
        }
        st = current
      }
    }
    const storePath = this.vault.storePathFor(hash)
    let storeStat = null
    try {
      storeStat = await this.vault.storeStatIfPresent(storePath)
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
    const registered = registry.links.get(filePath)
    if (registered && registered.mode === "copy" &&
        registered.hash === hash && registered.dev === st.dev && registered.ino === st.ino) {
      registry.addLink(filePath, {
        hash, app: appName, source_id: sourceId, dev: st.dev, ino: st.ino, mode: "copy"
      })
      this.updateScanIndex(filePath, st, hash, sourceId)
      return
    }
    if (storeStat && storeStat.dev === st.dev && storeStat.ino === st.ino) {
      registry.addLink(filePath, { hash, app: appName, source_id: sourceId, dev: st.dev, ino: st.ino, mode: "link" })
      this.updateScanIndex(filePath, st, hash, sourceId)
      return
    }
    if (!storeStat && registered && registered.mode === "link" &&
        registered.hash === hash && registered.dev === st.dev && registered.ino === st.ino) {
      registry.addLink(filePath, {
        hash, app: appName, source_id: sourceId, dev: st.dev, ino: st.ino,
        mode: "link", batch_id: registered.batch_id || null
      })
      this.updateScanIndex(filePath, st, hash, sourceId)
      return
    }
    if (!storeStat && (priorHash === hash || !registry.blobs.has(hash))) {
      registry.addBlob(hash, { size: st.size })
      registry.addLink(filePath, {
        hash, app: appName, source_id: sourceId, dev: st.dev, ino: st.ino, mode: "copy"
      })
      this.updateScanIndex(filePath, st, hash, sourceId)
      return
    }
    const scanEntry = {
      size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs,
      dev: st.dev, ino: st.ino, hash: hash || null, source_id: sourceId
    }
    const previous = registry.setDuplicate(filePath, {
      hash, size: st.size, app: appName, source_id: sourceId, discovered: Date.now(),
      dev: st.dev, ino: st.ino, mtime: st.mtimeMs, ctime: st.ctimeMs
    }, scanEntry)
    if (!previous || previous.hash !== hash) {
      this.vault.recordEvent({ kind: "found", hash, path: filePath, app: appName, source_id: sourceId, size: st.size })
    }
  }
  updateScanIndex(filePath, st, hash, sourceId = null) {
    this.vault.registry.setScanEntry(filePath, {
      size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs,
      dev: st.dev, ino: st.ino, hash: hash || null, source_id: sourceId
    })
  }
  async ingestHfBlobs(dir, entries, preferredSourceId = null) {
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      const name = entry.name
      const full = path.resolve(dir, name)
      let st
      try {
        st = await fs.promises.lstat(full)
      } catch (e) {
        if (!isMissingError(e) && !this.recordInaccessible(e, full)) throw e
        continue
      }
      if (!st.isFile()) continue
      const source = this.vault.sourceForPath(full, preferredSourceId)
      const sourceId = source ? source.id : null
      const appName = source && source.kind === "app" ? source.app : null
      const sourceKey = sourceId || preferredSourceId || "pinokio"
      this.countFile(sourceKey)
      this.state.bytes_total += st.size
      this.state.source_bytes[sourceKey] = (this.state.source_bytes[sourceKey] || 0) + st.size
      if (!preferredSourceId) this.state.home_bytes_total += st.size
      if (!SHA256_RE.test(name)) continue
      if (st.size < this.vault.sizeThreshold) {
        await this.untrackBelowThreshold(full, st, { app: appName, source_id: sourceId })
        continue
      }
      if (this.vault.registry.excluded.has(full)) continue
      this.state.candidates += 1
      await this.classify(full, st, name, preferredSourceId)
    }
  }
  // hf CLI --local-dir metadata: etag is the sha256 for LFS files; freshness
  // via the recorded timestamp against mtime (huggingface_hub's own rule).
  async harvestLocalDirEtag(filePath, st, sourceRoot) {
    try {
      const start = path.dirname(filePath)
      let dir = start
      // Metadata outside the configured source is not authoritative for a
      // scanned file, even when the source happens to be nested below it.
      const stop = path.resolve(sourceRoot || this.kernel.homedir)
      const visited = []
      let base = null
      for (let depth = 0; depth < 12; depth++) {
        if (this.metadataBaseCache.has(dir)) {
          base = this.metadataBaseCache.get(dir)
          break
        }
        visited.push(dir)
        const metaRoot = path.resolve(dir, ".cache", "huggingface")
        let exists = false
        try {
          exists = (await fs.promises.lstat(metaRoot)).isDirectory()
        } catch (e) {}
        if (exists) {
          base = dir
          break
        }
        if (dir === stop || path.dirname(dir) === dir) break
        dir = path.dirname(dir)
      }
      for (const visitedDir of visited) this.metadataBaseCache.set(visitedDir, base)
      if (!base) return null
      const relative = path.relative(base, filePath)
      const metaRoot = path.resolve(base, ".cache", "huggingface")
      const metaRootStat = await fs.promises.lstat(metaRoot)
      if (!metaRootStat.isDirectory()) return null
      const metaPath = path.resolve(metaRoot, relative + ".metadata")
      let raw
      try {
        raw = await readFileNoFollow(metaPath)
      } catch (e) {
        return null
      }
      if (raw === null) return null
      const lines = raw.split("\n")
      const etag = String(lines[1] || "").replace(/"/g, "").trim().toLowerCase()
      const ts = parseFloat(lines[2] || "0") * 1000
      if (SHA256_RE.test(etag) && ts >= st.mtimeMs) return etag
    } catch (e) {}
    return null
  }
}

module.exports = Sweeper
