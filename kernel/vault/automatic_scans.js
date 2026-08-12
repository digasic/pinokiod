const fs = require("fs")
const path = require("path")
const {
  SIZE_THRESHOLD,
  isCandidateFileSize,
  SHA256_RE,
  ENTRY_BATCH_SIZE
} = require("./constants")
const { statMany } = require("./walker")
const { fileSnapshot, sameSnapshot } = require("./snapshot")
const {
  cancelledError,
  isPathError
} = require("./operation_errors")

const COMPLETE_PHASES = new Set(["complete", "completed_with_exclusions"])
const STOP_SETTLE_MS = 2000
const isMissing = (error) => !!(error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR"))

const inside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

const pathKey = (value) => {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

class AutomaticScans {
  constructor(vault) {
    this.vault = vault
    const platform = vault && vault.kernel && vault.kernel.platform
      ? vault.kernel.platform
      : process.platform
    this.supported = platform === "darwin" || platform === "win32"
    this.watcher = vault && vault.kernel && vault.kernel.automaticWatcher
      ? vault.kernel.automaticWatcher
      : null
    this.watcherAttempted = false
    this.watcherSubscription = null
    this.entries = new Map()
    this.settings = new Map()
    this.hydrated = false
    this.hydrationPromise = null
    this.active = null
    this.manualDepth = 0
    this.observedApps = new Set()
    this.changedPaths = new Map()
    this.pendingStops = new Map()
    this.lifecycleWork = new Set()
    this.stopSettleMs = STOP_SETTLE_MS
    this.drainQueued = false
    this.drainRequested = false
    this.waitingFor = null
    this.listeners = new Set()
    this.appTransitions = new Map()
    this.globalScanReady = false
    this.disposed = false
  }

  async startWatcher() {
    if (this.disposed || !this.supported || this.watcherAttempted ||
        !this.vault.enabled) {
      return false
    }
    this.watcherAttempted = true
    const root = path.resolve(this.vault.kernel.homedir, "api")
    try {
      const watcher = this.watcher || require("@parcel/watcher")
      this.watcherSubscription = await watcher.subscribe(
        root,
        (error, events) => this.handleWatcherEvents(error, events)
      )
      this.log("watcher-started", { root })
      return true
    } catch (error) {
      this.log("watcher-error", {
        stage: "subscribe",
        message: error && error.message ? error.message : String(error)
      })
      return false
    }
  }

  async stopWatcher() {
    const subscription = this.watcherSubscription
    this.watcherSubscription = null
    if (!subscription || typeof subscription.unsubscribe !== "function") {
      return
    }
    await subscription.unsubscribe()
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    const pendingWork = []
    for (const pending of this.pendingStops.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      if (pending.promise) pendingWork.push(pending.promise)
    }
    this.pendingStops.clear()
    if (this.active) this.cancelActive(this.active.app, "manual-mode")
    let watcherError = null
    try {
      await this.stopWatcher()
    } catch (error) {
      watcherError = error
    }
    await Promise.allSettled([
      ...this.lifecycleWork,
      ...pendingWork
    ])
    if (this.active && this.active.promise) {
      await this.active.promise.catch(() => {})
    }
    if (this.hydrationPromise) {
      await this.hydrationPromise.catch(() => {})
    }
    const transitions = [...this.appTransitions.values()]
    if (transitions.length) {
      await Promise.allSettled(transitions)
    }
    const listeners = [...this.listeners]
    this.listeners.clear()
    for (const subscription of listeners) {
      if (typeof subscription.dispose !== "function") continue
      try {
        subscription.dispose()
      } catch (_) {}
    }
    this.observedApps.clear()
    this.changedPaths.clear()
    if (watcherError) throw watcherError
  }

  handleWatcherEvents(error, events = []) {
    if (this.disposed) return
    if (error) {
      this.log("watcher-error", {
        stage: "events",
        message: error && error.message ? error.message : String(error)
      })
      return
    }
    const watcherEvents = Array.isArray(events) ? events : []
    if (!watcherEvents.some((event) => event && event.type === "delete")) {
      for (const event of watcherEvents) {
        if (event && ["create", "update"].includes(event.type)) {
          this.recordChangedPath(event.path)
        }
      }
      return
    }
    const batches = new Map()
    for (let index = 0; index < watcherEvents.length; index++) {
      const event = watcherEvents[index]
      if (!event || !["create", "update", "delete"].includes(event.type)) {
        continue
      }
      const target = this.changedPathTarget(
        event.path, event.type === "delete")
      if (!target) continue
      let batch = batches.get(target.app)
      if (!batch) {
        batch = {
          root: target.root,
          updates: new Map(),
          deletes: new Map()
        }
        batches.set(target.app, batch)
      }
      const key = pathKey(target.path)
      if (event.type === "delete") batch.deletes.set(key, index)
      else batch.updates.set(key, { index, path: target.path })
    }
    for (const [app, batch] of batches) {
      this.applyChangedPathBatch(app, batch)
    }
  }

  changedPathTarget(filePath, allowRoot = false) {
    if (this.disposed || !this.supported ||
        typeof filePath !== "string" || !filePath) {
      return null
    }
    const app = this.appForLaunchPath(filePath)
    if (!app || !this.observedApps.has(app)) return null
    const root = path.resolve(this.vault.kernel.homedir, "api", app)
    const resolved = path.resolve(filePath)
    if ((!allowRoot && resolved === root) || !inside(root, resolved)) return null
    return { app, root, path: resolved }
  }

  recordChangedPath(filePath) {
    const target = this.changedPathTarget(filePath)
    if (!target) return false
    const { app, path: resolved } = target
    let paths = this.changedPaths.get(app)
    if (!paths) {
      paths = new Set()
      this.changedPaths.set(app, paths)
    }
    paths.add(resolved)
    return true
  }

  lastDeleteIndex(root, filePath, deletes) {
    const rootKey = pathKey(root)
    let current = path.resolve(filePath)
    let latest = -1
    while (true) {
      const key = pathKey(current)
      const index = deletes.get(key)
      if (index !== undefined && index > latest) latest = index
      if (key === rootKey) return latest
      current = path.dirname(current)
    }
  }

  applyChangedPathBatch(app, { root, updates, deletes }) {
    const paths = this.changedPaths.get(app)
    if (!deletes.size) {
      const collected = paths || new Set()
      for (const update of updates.values()) collected.add(update.path)
      if (collected.size) this.changedPaths.set(app, collected)
      return
    }
    const retained = new Set()
    if (paths) {
      for (const candidate of paths) {
        const key = pathKey(candidate)
        const update = updates.get(key)
        if (this.lastDeleteIndex(root, candidate, deletes) >
            (update ? update.index : -1) || retained.has(key)) {
          paths.delete(candidate)
        } else {
          retained.add(key)
        }
      }
    }
    let collected = paths
    for (const [key, update] of updates) {
      if (update.index <= this.lastDeleteIndex(root, update.path, deletes) ||
          retained.has(key)) continue
      if (!collected) collected = new Set()
      collected.add(update.path)
      retained.add(key)
    }
    if (collected && collected.size) this.changedPaths.set(app, collected)
    else this.changedPaths.delete(app)
  }

  discardChangedPaths(app) {
    this.changedPaths.delete(app)
  }

  consumeChangedPaths(app, paths) {
    const collected = this.changedPaths.get(app)
    if (!collected) return
    for (const filePath of paths || []) {
      collected.delete(path.resolve(filePath))
    }
    if (!collected.size) this.discardChangedPaths(app)
  }

  async candidateThreshold() {
    const cached = this.vault.lastScanCache &&
      typeof this.vault.lastScanCache.get === "function"
      ? this.vault.lastScanCache.get("")
      : null
    const scan = cached || (this.vault.registry
      ? await this.vault.registry.scanFor()
      : null)
    const threshold = scan ? Number(scan.candidate_min_bytes) : NaN
    return Number.isFinite(threshold) && threshold >= 0
      ? threshold
      : SIZE_THRESHOLD
  }

  statChangedPaths(paths, options, onSettled = null) {
    return statMany(paths, this.vault.statConcurrency, onSettled, options)
  }

  async changedPathsWithSafeParents(paths, root, options, onSettled = null) {
    const resolvedRoot = path.resolve(root)
    const parents = []
    const levels = []
    for (const filePath of paths) {
      const resolved = path.resolve(filePath)
      const relative = path.relative(resolvedRoot, resolved)
      if (!relative || !inside(resolvedRoot, resolved)) {
        parents.push(null)
        continue
      }
      const parts = relative.split(path.sep)
      let parent = resolvedRoot
      for (let depth = 0; depth < parts.length - 1; depth++) {
        const child = path.resolve(parent, parts[depth])
        if (!levels[depth]) levels[depth] = new Map()
        levels[depth].set(child, parent)
        parent = child
      }
      parents.push(parent)
    }

    const safe = new Map([[resolvedRoot, true]])
    for (const level of levels) {
      const directories = []
      for (const [directory, parent] of level) {
        if (safe.get(parent) === true) directories.push(directory)
        else safe.set(directory, false)
      }
      const stats = await statMany(
        directories,
        this.vault.statConcurrency,
        onSettled,
        Object.assign({}, options, { followSymlinks: false })
      )
      for (let index = 0; index < directories.length; index++) {
        const directory = directories[index]
        const stat = stats[index]
        const valid = !!stat && stat.isDirectory() && !stat.isSymbolicLink()
        safe.set(directory, valid)
        if (valid || !stat) continue
        const error = new Error(stat.isSymbolicLink()
          ? "Changed path has a symbolic-link ancestor."
          : "Changed path has a non-directory ancestor.")
        error.code = stat.isSymbolicLink() ? "ELOOP" : "ENOTDIR"
        const handled = options.onError && options.onError(error, directory)
        if (options.strictErrors && !handled) throw error
      }
    }
    return paths.filter((_filePath, index) =>
      parents[index] && safe.get(parents[index]) === true)
  }

  log(event, details = {}) {
    const record = { time: new Date().toISOString(), event }
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null && value !== "") {
        record[key] = value
      }
    }
    console.log(`[Vault Automatic Check] ${JSON.stringify(record)}`)
  }

  appForLaunchPath(launchPath) {
    if (typeof launchPath !== "string" || !launchPath) return null
    const apiRoot = path.resolve(this.vault.kernel.homedir, "api")
    const relative = path.relative(apiRoot, path.resolve(launchPath))
    if (!relative || relative === ".." ||
        relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null
    }
    const app = relative.split(path.sep)[0]
    return app && app !== "." ? app : null
  }

  async appRootIsAvailable(app) {
    const apiRoot = path.resolve(this.vault.kernel.homedir, "api")
    const root = path.resolve(apiRoot, app)
    const relative = path.relative(apiRoot, root)
    if (!relative || relative === ".." ||
        relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        relative.split(path.sep).length !== 1) return false
    try {
      const stat = await fs.promises.lstat(root)
      return stat.isDirectory() && !stat.isSymbolicLink()
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  sourceForApp(app) {
    return this.vault.sources().find((source) =>
      source.kind === "app" && source.app === app && source.available !== false)
  }

  appIsRunning(app) {
    const source = this.sourceForApp(app)
    if (source) return this.vault.sourceAppIsRunning(source)
    const api = this.vault.kernel && this.vault.kernel.api
    const root = path.resolve(this.vault.kernel.homedir, "api", app)
    return !!(api && api.running_paths &&
      Object.values(api.running_paths).some((launchPath) =>
        typeof launchPath === "string" && inside(root, launchPath)))
  }

  async withAppTransition(app, operation) {
    const previous = this.appTransitions.get(app) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.appTransitions.set(app, current)
    try {
      return await current
    } finally {
      if (this.appTransitions.get(app) === current) {
        this.appTransitions.delete(app)
      }
    }
  }

  publicEntry(entry) {
    return {
      app: entry.app,
      state: entry.state,
      signature: entry.signature
    }
  }

  publicResult(entry) {
    if (!entry) return null
    if (entry.state === "result") return entry
    return entry.state === "checking" && entry.previous &&
      entry.previous.state === "result"
      ? entry.previous
      : null
  }

  snapshot() {
    return {
      enabled: !!this.vault.enabled,
      global_scan_ready: this.globalScanReady,
      rows: (this.globalScanReady ? [...this.entries.values()] : [])
        .map((entry) => this.publicResult(entry))
        .filter(Boolean)
        .filter((entry) => !entry.hidden)
        .sort((left, right) =>
          (Number(left.updated_at) || 0) -
            (Number(right.updated_at) || 0) ||
          left.app.localeCompare(right.app))
        .map((entry) => this.publicEntry(entry)),
      settings: [...this.settings.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([app, setting]) => ({ app, mode: setting.mode }))
    }
  }

  async refreshGlobalScanReady() {
    if (this.disposed) return false
    const ready = typeof this.vault.globalScanReady === "function" &&
      !!await this.vault.globalScanReady()
    if (this.disposed) return false
    const changed = ready !== this.globalScanReady
    this.globalScanReady = ready
    return changed
  }

  modeFor(app) {
    const setting = this.settings.get(app)
    return setting && setting.mode === "manual" ? "manual" : "automatic"
  }

  broadcast() {
    if (this.disposed) return
    const snapshot = this.snapshot()
    for (const subscription of this.listeners) {
      try {
        subscription.listener(snapshot)
      } catch (_) {}
    }
  }

  subscribe(listener, dispose = null) {
    if (typeof listener !== "function") return () => {}
    if (this.disposed) {
      if (typeof dispose === "function") {
        try {
          dispose()
        } catch (_) {}
      }
      return () => {}
    }
    const subscription = { listener, dispose }
    this.listeners.add(subscription)
    listener(this.snapshot())
    return () => this.listeners.delete(subscription)
  }

  async hydrate() {
    if (this.disposed || !this.supported) return this.snapshot()
    if (this.hydrated || !this.vault.registry) return this.snapshot()
    if (!this.hydrationPromise) {
      this.hydrationPromise = Promise.all([
        this.vault.registry.automaticAppScanStates(),
        this.vault.registry.automaticAppScanSettings()
      ]).then(async ([rows, settings]) => {
        const stale = []
        const obsoleteStates = []
        for (const setting of settings || []) {
          if (!setting || !setting.app) continue
          if (!this.sourceForApp(setting.app) &&
              !await this.appRootIsAvailable(setting.app)) {
            stale.push(setting.app)
            continue
          }
          this.settings.set(setting.app, {
            mode: setting.mode === "manual" ? "manual" : "automatic",
            acknowledged_signature: setting.acknowledged_signature || null,
            updated_at: Number(setting.updated_at) || 0
          })
        }
        for (const row of rows || []) {
          if (!row || !row.app || this.entries.has(row.app)) continue
          if (row.state !== "result") {
            obsoleteStates.push(row.app)
            continue
          }
          if (!this.sourceForApp(row.app) &&
              !await this.appRootIsAvailable(row.app)) {
            stale.push(row.app)
            continue
          }
          const acknowledged = (this.settings.get(row.app) || {})
            .acknowledged_signature
          this.entries.set(row.app, {
            app: row.app,
            state: row.state,
            signature: row.signature || null,
            updated_at: Number(row.updated_at) || 0,
            previous: null,
            hidden: row.state === "result" &&
              !!row.signature && acknowledged === row.signature
          })
        }
        const staleApps = new Set(stale)
        await Promise.all([
          ...[...staleApps].map((app) =>
            this.vault.registry.removeAutomaticAppScanApp(app)),
          ...[...new Set(obsoleteStates)]
            .filter((app) => !staleApps.has(app))
            .map((app) =>
              this.vault.registry.setAutomaticAppScanState(app, null))
        ])
        this.hydrated = true
        this.log("state-restored", {
          rows: this.entries.size,
          settings: this.settings.size
        })
      }).finally(() => {
        this.hydrationPromise = null
      })
    }
    await this.hydrationPromise
    return this.snapshot()
  }

  restorePrevious(app) {
    const entry = this.entries.get(app)
    if (entry && entry.previous && entry.previous.state === "result") {
      this.entries.set(app, Object.assign({}, entry.previous, {
        previous: null
      }))
    } else {
      this.entries.delete(app)
    }
  }

  queueApp(app, paths = this.changedPaths.get(app)) {
    if (this.disposed || !this.supported) return false
    if (!this.globalScanReady) {
      this.log("queue-skipped", { app, reason: "global-scan-required" })
      return false
    }
    if (this.modeFor(app) === "manual") {
      this.log("queue-skipped", { app, reason: "manual" })
      return false
    }
    const changed = [...new Set(paths || [])]
    if (!changed.length) {
      this.log("queue-skipped", { app, reason: "no-changed-paths" })
      return false
    }
    const current = this.entries.get(app)
    const previous = current && current.state === "result"
      ? Object.assign({}, current)
      : current && current.previous
        ? current.previous
        : null
    this.entries.set(app, {
      app,
      state: "checking",
      paths: changed,
      updated_at: Date.now(),
      previous,
      hidden: false
    })
    this.log("queued", { app })
    this.schedule()
    return true
  }

  cancelPendingStop(app, reason) {
    const pending = this.pendingStops.get(app)
    if (!pending) return false
    this.pendingStops.delete(app)
    if (pending.timer) clearTimeout(pending.timer)
    this.log("settle-cancelled", { app, reason })
    return true
  }

  pendingStopIsCurrent(app, pending) {
    return !this.disposed && this.pendingStops.get(app) === pending &&
      !this.observedApps.has(app) && !this.appIsRunning(app)
  }

  scheduleStoppedApp(app, delay = this.stopSettleMs) {
    if (this.disposed || !this.supported) return
    this.cancelPendingStop(app, "rescheduled")
    const pending = { timer: null, promise: null }
    pending.timer = setTimeout(() => {
      pending.timer = null
      pending.promise = this.prepareStoppedApp(app, pending)
      pending.promise.catch((error) => {
        if (this.pendingStops.get(app) === pending) {
          this.pendingStops.delete(app)
        }
        this.log("error", {
          app,
          stage: "settling",
          message: error && error.message ? error.message : String(error)
        })
        console.warn("Automatic Disk Saver check failed:",
          error && error.message ? error.message : error)
      })
    }, delay)
    if (typeof pending.timer.unref === "function") pending.timer.unref()
    this.pendingStops.set(app, pending)
    this.log("settling", { app, delay_ms: delay })
  }

  async prepareStoppedApp(app, pending) {
    if (!this.pendingStopIsCurrent(app, pending)) {
      this.cancelPendingStop(app, "app-restarted")
      return
    }
    if (!this.changedPaths.get(app)?.size) {
      this.pendingStops.delete(app)
      this.log("check-skipped", { app, reason: "no-changed-paths" })
      return
    }
    if (this.vault.ready) await this.vault.ready
    if (this.pendingStops.get(app) !== pending) return
    if (!this.vault.enabled) {
      this.pendingStops.delete(app)
      this.discardChangedPaths(app)
      this.log("check-skipped", { app, reason: "vault-disabled" })
      return
    }
    if (!this.pendingStopIsCurrent(app, pending)) {
      this.cancelPendingStop(app, "app-restarted")
      return
    }
    const available = await this.appRootIsAvailable(app)
    if (this.pendingStops.get(app) !== pending) return
    if (!available) {
      await this.removeUnavailableApp(app)
      this.log("check-skipped", { app, reason: "app-source-unavailable" })
      return
    }
    if (this.pendingStops.get(app) !== pending) return
    this.log("preparing", { app })
    await this.vault.ensureRegistryInitialized()
    if (this.pendingStops.get(app) !== pending) return
    await this.refreshGlobalScanReady()
    if (!this.globalScanReady) {
      this.pendingStops.delete(app)
      this.discardChangedPaths(app)
      this.log("check-skipped", { app, reason: "global-scan-required" })
      return
    }
    await this.hydrate()
    await this.withAppTransition(app, async () => {
      if (this.pendingStops.get(app) !== pending) return
      if (this.modeFor(app) === "manual") {
        this.pendingStops.delete(app)
        this.discardChangedPaths(app)
        this.log("check-skipped", { app, reason: "manual" })
        return
      }
      if (!this.pendingStopIsCurrent(app, pending)) {
        this.cancelPendingStop(app, "app-restarted")
        return
      }
      const available = await this.appRootIsAvailable(app)
      if (this.pendingStops.get(app) !== pending) return
      if (!available) {
        await this.removeUnavailableApp(app)
        this.log("check-skipped", { app, reason: "app-source-unavailable" })
        return
      }
      if (this.pendingStops.get(app) !== pending) return
      this.pendingStops.delete(app)
      this.log("settled", { app })
      this.queueApp(app)
    })
  }

  handleStarted(launchPath) {
    if (this.disposed || !this.supported) return
    if (!this.vault.enabled) {
      return this.vault.ready && this.vault.ready.then(() => {
        if (this.vault.enabled) return this.handleStarted(launchPath)
      })
    }
    const app = this.appForLaunchPath(launchPath)
    if (!app) return
    this.observedApps.add(app)
    this.log("app-started", { app })
    this.cancelPendingStop(app, "app-started")
    if (this.cancelActive(app, "app-started")) return
    const entry = this.entries.get(app)
    if (entry && entry.state === "checking") {
      this.restorePrevious(app)
      this.log("queued-check-cleared", { app, reason: "app-started" })
    }
  }

  handleStopped(launchPath) {
    const work = this.handleStoppedNow(launchPath)
    this.lifecycleWork.add(work)
    work.then(
      () => this.lifecycleWork.delete(work),
      () => this.lifecycleWork.delete(work)
    )
    return work
  }

  async handleStoppedNow(launchPath) {
    if (this.disposed || !this.supported) return
    if (!this.vault.enabled) {
      if (this.vault.ready) await this.vault.ready
      if (this.vault.enabled) return this.handleStopped(launchPath)
      return
    }
    const app = this.appForLaunchPath(launchPath)
    if (!app) return
    if (!this.observedApps.has(app)) {
      this.log("app-stop-ignored", { app, reason: "no-tracked-start" })
      return
    }
    if (this.appIsRunning(app)) {
      this.log("app-stopped", { app, app_still_running: true })
      return
    }
    this.observedApps.delete(app)
    this.log("app-stopped", { app })
    const available = await this.appRootIsAvailable(app)
    if (this.disposed) return
    if (!available) {
      await this.removeUnavailableApp(app)
      this.log("check-skipped", { app, reason: "app-source-unavailable" })
      return
    }
    if (!this.changedPaths.get(app)?.size) {
      this.log("check-skipped", { app, reason: "no-changed-paths" })
      return
    }
    const stoppedAt = Date.now()
    if (this.vault.ready) await this.vault.ready
    if (this.disposed) return
    if (!this.vault.enabled) {
      this.discardChangedPaths(app)
      this.log("check-skipped", { app, reason: "vault-disabled" })
      return
    }
    if (!this.hydrated && typeof this.vault.automaticScanStatus === "function") {
      await this.vault.automaticScanStatus()
      if (this.disposed) return
    }
    await this.refreshGlobalScanReady()
    if (this.disposed) return
    if (!this.globalScanReady) {
      this.discardChangedPaths(app)
      this.log("check-skipped", { app, reason: "global-scan-required" })
      return
    }
    if (this.modeFor(app) === "manual") {
      this.discardChangedPaths(app)
      this.log("check-skipped", { app, reason: "manual" })
      return
    }
    if (this.observedApps.has(app) || this.appIsRunning(app)) {
      this.log("check-skipped", { app, reason: "app-still-running" })
      return
    }
    const delay = Math.max(0, this.stopSettleMs - (Date.now() - stoppedAt))
    this.scheduleStoppedApp(app, delay)
  }

  currentBusyPromise() {
    return this.vault.scanPromise ||
      this.vault.scanCompletionPromise ||
      this.vault.folderDiscoveryPromise ||
      this.vault.folderDiscoveryCommitPromise ||
      null
  }

  waitForBusyWork() {
    const pending = this.currentBusyPromise()
    if (!pending || pending === this.waitingFor) return
    this.waitingFor = pending
    pending.finally(() => {
      if (this.waitingFor === pending) this.waitingFor = null
      this.schedule()
    }).catch(() => {})
  }

  schedule() {
    if (this.disposed) return
    if (this.drainQueued) {
      this.drainRequested = true
      return
    }
    this.drainQueued = true
    queueMicrotask(() => {
      const pending = (async () => {
        do {
          this.drainRequested = false
          await this.drain()
        } while (!this.disposed && this.drainRequested)
      })()
      this.lifecycleWork.add(pending)
      pending.then(
        () => {
          this.lifecycleWork.delete(pending)
          this.drainQueued = false
          if (this.drainRequested) this.schedule()
        },
        (error) => {
          this.lifecycleWork.delete(pending)
          this.drainQueued = false
          this.log("error", {
            stage: "queue",
            message: error && error.message ? error.message : String(error)
          })
          console.warn("Automatic Disk Saver check failed:",
            error && error.message ? error.message : error)
          if (this.drainRequested) this.schedule()
        }
      )
    })
  }

  cancelActive(app, reason) {
    if (!this.active || this.active.app !== app || this.active.cancelled) {
      return false
    }
    this.active.cancelled = true
    this.active.reason = reason
    if (this.active.controller) this.active.controller.abort()
    this.log("check-cancel-requested", { app, reason })
    return true
  }

  checkpoint(active) {
    if (!active || active.cancelled || this.active !== active) {
      throw cancelledError("Automatic check cancelled.")
    }
  }

  automaticHashKey(entry) {
    return [
      this.automaticIdentityKey(entry),
      entry.size,
      entry.mtime,
      entry.ctime
    ].join("\0")
  }

  automaticIdentityKey(entry) {
    return entry.ino !== 0
      ? `inode:${entry.dev}:${entry.ino}`
      : `path:${pathKey(entry.path)}`
  }

  logVerificationSkip(app, entry, reason, counts, error = null) {
    if (error) counts.path_errors += 1
    else counts.unstable_hashes += 1
    this.log("verification-skipped", {
      app,
      path: entry.path,
      kind: entry.kind,
      reason,
      code: error && error.code,
      message: error && error.message
    })
  }

  async currentAutomaticEntry(active, entry, counts) {
    this.checkpoint(active)
    let current
    try {
      current = await fs.promises.lstat(entry.path)
    } catch (error) {
      if (!isPathError(error)) throw error
      if (entry.kind === "changed" && isMissing(error)) {
        counts.path_errors += 1
        return null
      }
      this.logVerificationSkip(active.app, entry, "unreadable", counts, error)
      return null
    }
    this.checkpoint(active)
    if (!current.isFile() || current.isSymbolicLink() ||
        current.dev !== entry.dev || current.size !== entry.size) {
      this.logVerificationSkip(
        active.app, entry, "snapshot-changed", counts)
      return null
    }
    return {
      stat: current,
      entry: Object.assign({}, entry, fileSnapshot(current))
    }
  }

  async verifiedAutomaticHash(
    active, entry, memory, verifiedHashes, counts, prepared = null
  ) {
    const checked = prepared || await this.currentAutomaticEntry(
      active, entry, counts)
    if (!checked) return null
    const current = checked.stat
    const currentEntry = checked.entry
    const key = this.automaticHashKey(currentEntry)
    const cachedSnapshot = {
      size: entry.cached_size,
      mtime: entry.cached_mtime,
      ctime: entry.cached_ctime,
      dev: entry.cached_dev,
      ino: entry.cached_ino
    }
    const reusable = memory.get(key) ||
      (sameSnapshot(entry, current) && SHA256_RE.test(entry.hash || "")
        ? entry.hash
        : null) ||
      (sameSnapshot(cachedSnapshot, current) &&
        SHA256_RE.test(entry.cached_hash || "")
        ? entry.cached_hash
        : null)
    if (reusable) {
      counts.hash_reuses += 1
      memory.set(key, reusable)
      const verifiedEntry = Object.assign({}, currentEntry, {
        hash: reusable
      })
      verifiedHashes.set(pathKey(entry.path), verifiedEntry)
      return verifiedEntry
    }
    let verified
    try {
      verified = await this.vault.scanner.hashStable(currentEntry, {
        signal: active.controller && active.controller.signal
      })
    } catch (error) {
      if (error && error.code === "EVAULTCANCELLED") throw error
      if (!isPathError(error)) throw error
      counts.hash_failures += 1
      if (entry.kind === "changed" && isMissing(error)) {
        counts.path_errors += 1
        return null
      }
      this.logVerificationSkip(active.app, entry, "hash-failed", counts, error)
      return null
    }
    this.checkpoint(active)
    if (!verified.stable || !SHA256_RE.test(verified.result.hash || "")) {
      this.logVerificationSkip(
        active.app, entry, "changed-during-hash", counts)
      return null
    }
    counts.hashed += 1
    counts.hash_bytes += Math.max(0, Number(verified.result.size) || 0)
    memory.set(key, verified.result.hash)
    const verifiedEntry = Object.assign({}, currentEntry, {
      hash: verified.result.hash
    })
    verifiedHashes.set(pathKey(entry.path), verifiedEntry)
    return verifiedEntry
  }

  async runPrecheck(active) {
    const app = active.app
    const root = path.resolve(this.vault.kernel.homedir, "api", app)
    const startedAt = Date.now()
    active.startedAt = startedAt
    const markStage = (stage, entry = null) => {
      active.stage = stage
      active.stagePath = entry && entry.path ? entry.path : null
      active.stageKind = entry && entry.kind ? entry.kind : null
    }
    markStage("app-root-check")
    if (!await this.appRootIsAvailable(app)) {
      const error = new Error("That app is no longer available.")
      error.code = "ENOENT"
      throw error
    }
    const counts = {
      files: 0,
      bytes: 0,
      candidates: 0,
      registry_pages: 0,
      candidate_checks: 0,
      peer_checks: 0,
      path_errors: 0,
      hashed: 0,
      hash_bytes: 0,
      hash_reuses: 0,
      hash_failures: 0,
      unstable_hashes: 0
    }
    markStage("threshold-read")
    const threshold = await this.candidateThreshold()
    const paths = [...new Set(active.paths || [])].filter((filePath) =>
      typeof filePath === "string" && inside(root, filePath))
    const verifiedHashes = new Map()
    this.log("check-started", {
      app,
      root,
      threshold_bytes: threshold,
      changed_paths: paths.length,
      policy: "metadata-prefilter-sha256"
    })
    markStage("staging-reset")
    await this.vault.registry.beginAutomaticPrecheck(app)
    try {
      this.checkpoint(active)
      const metadataOptions = {
        followSymlinks: false,
        strictErrors: true,
        onError: (error, filePath) => {
          if (!isPathError(error)) return false
          counts.path_errors += 1
          if (isMissing(error)) return true
          this.log("path-skipped", {
            app,
            path: filePath,
            code: error.code,
            message: error.message
          })
          return true
        }
      }
      markStage("changed-parent-metadata")
      const safePaths = await this.changedPathsWithSafeParents(
        paths, root, metadataOptions, () => this.checkpoint(active))
      this.checkpoint(active)
      markStage("changed-path-metadata")
      const safeStats = await this.statChangedPaths(
        safePaths, metadataOptions, () => this.checkpoint(active))
      const statsByPath = new Map(safePaths.map((filePath, index) =>
        [filePath, safeStats[index]]))
      this.checkpoint(active)
      const candidates = []
      for (let index = 0; index < paths.length; index++) {
        this.checkpoint(active)
        const stat = statsByPath.get(paths[index])
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) continue
        counts.files += 1
        counts.bytes += Math.max(0, Number(stat.size) || 0)
        if (!isCandidateFileSize(stat.size, threshold)) continue
        candidates.push({
          path: paths[index],
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
      }
      if (candidates.length) {
        markStage("staging-write")
        await this.vault.registry.stageAutomaticPrecheckFiles(app, candidates)
      }
      this.checkpoint(active)
      markStage("app-root-recheck")
      if (!await this.appRootIsAvailable(app)) {
        const error = new Error("That app is no longer available.")
        error.code = "ENOENT"
        throw error
      }
      this.log("verification-started", {
        app,
        files: counts.files,
        bytes: counts.bytes,
        threshold_candidates: candidates.length,
        duration_ms: Date.now() - startedAt
      })
      let proof = null
      let group = null
      const acceptProof = (candidate, peer, hash) => {
        proof = { path: candidate.path, hash }
        this.log("first-proof-exit", {
          app,
          candidate_path: candidate.path,
          peer_path: peer.path,
          peer_kind: peer.kind,
          size: candidate.size,
          duration_ms: Date.now() - startedAt,
          registry_pages: counts.registry_pages,
          candidate_checks: counts.candidate_checks,
          peer_checks: counts.peer_checks,
          hashed: counts.hashed,
          hash_bytes: counts.hash_bytes,
          hash_reuses: counts.hash_reuses
        })
      }
      const preparePeers = () => {
        if (!group || group.unmatched) return
        group.unmatched = new Map()
        for (const [hash, value] of group.candidatesByHash) {
          group.unmatched.set(hash, {
            identity: value.identities.values().next().value,
            candidate: value.candidate
          })
        }
      }
      const hashCandidates = async (peerIdentity = null) => {
        if (!group || group.candidatesHashed) return !!group
        const identities = new Set(group.candidates.map((candidate) =>
          this.automaticIdentityKey(candidate.entry)))
        if (identities.size < 2 &&
            (!peerIdentity || identities.has(peerIdentity))) {
          return false
        }
        group.candidatesHashed = true
        counts.candidates += group.candidates.length
        for (const candidate of group.candidates) {
          this.checkpoint(active)
          markStage("candidate-hash", candidate.entry)
          const verified = await this.verifiedAutomaticHash(
            active,
            candidate.entry,
            group.memory,
            verifiedHashes,
            counts,
            candidate
          )
          if (!verified) continue
          const hash = verified.hash
          let value = group.candidatesByHash.get(hash)
          if (!value) {
            value = { candidate: verified, identities: new Set() }
            group.candidatesByHash.set(hash, value)
          }
          value.identities.add(this.automaticIdentityKey(verified))
          if (value.identities.size > 1) {
            acceptProof(value.candidate, verified, hash)
            return true
          }
        }
        preparePeers()
        return true
      }
      const finishGroup = async () => {
        if (!group) return false
        await hashCandidates()
        if (proof) return true
        group = null
        return false
      }
      const complete = async () => {
        this.checkpoint(active)
        markStage("result-signature")
        const result = await this.vault.registry.automaticPrecheckResult(
          app, proof ? [proof] : [])
        this.checkpoint(active)
        return Object.assign({}, counts, {
          signature: result.signature,
          verified_files: Math.max(0, Number(result.files) || 0),
          duration_ms: Date.now() - startedAt
        })
      }
      let cursor = null
      do {
        markStage("candidate-query")
        counts.registry_pages += 1
        const page = await this.vault.registry.automaticPrecheckEntries(
          app, cursor, ENTRY_BATCH_SIZE)
        this.checkpoint(active)
        for (const entry of page.entries) {
          const key = `${entry.dev}\0${entry.size}`
          if (!group || group.key !== key) {
            if (await finishGroup()) return await complete()
            group = {
              key,
              candidates: [],
              candidatesHashed: false,
              candidatesByHash: new Map(),
              unmatched: null,
              memory: new Map()
            }
          }
          if (entry.kind === "changed") {
            this.checkpoint(active)
            markStage("candidate-metadata", entry)
            counts.candidate_checks += 1
            const candidate = await this.currentAutomaticEntry(
              active, entry, counts)
            if (candidate) group.candidates.push(candidate)
            continue
          }
          if (!group.candidatesHashed) await hashCandidates()
          if (proof) return await complete()
          if (group.candidatesHashed && !group.unmatched.size) continue
          markStage("peer-metadata", entry)
          counts.peer_checks += 1
          const peer = await this.currentAutomaticEntry(active, entry, counts)
          if (!peer) continue
          const identity = this.automaticIdentityKey(peer.entry)
          if (!await hashCandidates(identity)) continue
          if (proof) return await complete()
          if (!group.unmatched.size) continue
          if (![...group.unmatched.values()].some((wanted) =>
            wanted.identity !== identity)) continue
          this.checkpoint(active)
          markStage("peer-hash", entry)
          const verified = await this.verifiedAutomaticHash(
            active, entry, group.memory, verifiedHashes, counts, peer)
          const wanted = verified && group.unmatched.get(verified.hash)
          if (!wanted || wanted.identity === identity) {
            continue
          }
          acceptProof(wanted.candidate, verified, verified.hash)
          return await complete()
        }
        if (verifiedHashes.size >= ENTRY_BATCH_SIZE) {
          markStage("hash-cache-write")
          await this.vault.registry.rememberHashCache(
            [...verifiedHashes.values()])
          verifiedHashes.clear()
          this.checkpoint(active)
        }
        cursor = page.next_cursor
      } while (cursor)
      await finishGroup()
      return await complete()
    } finally {
      try {
        if (verifiedHashes.size) {
          try {
            await this.vault.registry.rememberHashCache(
              [...verifiedHashes.values()])
          } catch (error) {
            markStage("hash-cache-write")
            throw error
          }
        }
      } finally {
        try {
          await this.vault.registry.abortAutomaticPrecheck(app)
        } catch (error) {
          markStage("staging-cleanup")
          throw error
        }
      }
    }
  }

  async drain() {
    if (this.disposed || !this.vault.enabled ||
        !this.vault.registry || this.active) return
    const entry = [...this.entries.values()].find((item) =>
      item.state === "checking")
    if (!entry) return
    await this.refreshGlobalScanReady()
    if (this.disposed) return
    if (!this.globalScanReady) {
      if (this.entries.get(entry.app) === entry) {
        this.restorePrevious(entry.app)
        this.discardChangedPaths(entry.app)
        this.log("check-skipped", {
          app: entry.app,
          reason: "global-scan-required"
        })
      }
      this.schedule()
      return
    }
    if (this.manualDepth > 0 || this.currentBusyPromise() ||
        this.vault.fileActionProgress) {
      this.waitForBusyWork()
      return
    }
    let appAvailable
    try {
      appAvailable = await this.appRootIsAvailable(entry.app)
    } catch (error) {
      if (this.disposed) return
      if (this.entries.get(entry.app) === entry) {
        this.restorePrevious(entry.app)
      }
      this.schedule()
      throw error
    }
    if (this.disposed) return
    if (this.entries.get(entry.app) !== entry) {
      this.schedule()
      return
    }
    if (this.manualDepth > 0 || this.currentBusyPromise()) {
      this.waitForBusyWork()
      return
    }
    if (!appAvailable || this.appIsRunning(entry.app)) {
      this.log("check-skipped", {
        app: entry.app,
        reason: !appAvailable ? "app-source-unavailable" : "app-restarted"
      })
      if (!appAvailable) {
        await this.removeUnavailableApp(entry.app)
      } else {
        this.restorePrevious(entry.app)
      }
      this.schedule()
      return
    }
    const active = {
      app: entry.app,
      paths: [...new Set(entry.paths || [])],
      cancelled: false,
      reason: null,
      controller: new AbortController(),
      promise: null
    }
    this.active = active
    active.promise = this.vault.runExclusive(async () => {
      let result = null
      let error = null
      try {
        result = await this.runPrecheck(active)
      } catch (failure) {
        error = failure
      }
      return this.precheckFinished(active, result, error)
    })
    active.promise.catch((error) => {
      this.log("error", {
        app: active.app,
        stage: "checking",
        message: error && error.message ? error.message : String(error)
      })
      console.warn("Automatic Disk Saver check failed:",
        error && error.message ? error.message : error)
    })
  }

  async precheckFinished(active, result, error) {
    const app = active.app
    try {
      await this.withAppTransition(app, async () => {
        let reason = active.reason
        this.log("check-finished", {
          app,
          outcome: error
            ? (error.code === "EVAULTCANCELLED" ? "cancelled" : "failed")
            : "complete",
          cancel_reason: reason,
          duration_ms: result
            ? result.duration_ms
            : error && active.startedAt
              ? Date.now() - active.startedAt
              : undefined,
          failure_stage: error && active.stage,
          failure_path: error && (error.path || active.stagePath),
          failure_kind: error && active.stageKind,
          error_code: error && error.code,
          error_syscall: error && error.syscall,
          files: result && result.files,
          bytes: result && result.bytes,
          candidates: result && result.candidates,
          registry_pages: result && result.registry_pages,
          candidate_checks: result && result.candidate_checks,
          peer_checks: result && result.peer_checks,
          verified_files: result && result.verified_files,
          hashed: result && result.hashed,
          hash_bytes: result && result.hash_bytes,
          hash_reuses: result && result.hash_reuses,
          hash_failures: result && result.hash_failures,
          unstable_hashes: result && result.unstable_hashes,
          path_errors: result && result.path_errors,
          error: error && error.message
        })
        const entry = this.entries.get(app)
        if (reason === "manual-mode" ||
            reason === "app-source-unavailable") return
        if (reason === "manual") return
        if (reason === "app-started") {
          this.restorePrevious(app)
          return
        }
        if (error) {
          if (isMissing(error)) {
            await this.vault.registry.removeAutomaticAppScanApp(app)
            this.settings.delete(app)
            this.entries.delete(app)
            this.discardChangedPaths(app)
          } else {
            this.restorePrevious(app)
          }
          return
        }
        const previousSetting = this.settings.has(app)
          ? Object.assign({}, this.settings.get(app))
          : null
        try {
          await this.publishResultNow(app, result)
        } catch (publicationError) {
          this.restorePrevious(app)
          throw publicationError
        }
        reason = active.reason
        if (reason) {
          await this.restorePublishedState(app, entry, previousSetting)
          this.entries.set(app, entry)
          this.log("publication-reverted", { app, reason })
          if (reason !== "manual") {
            this.restorePrevious(app)
          }
          return
        }
        this.consumeChangedPaths(app, active.paths)
        if (this.active === active) this.active = null
      })
    } finally {
      if (this.active === active) this.active = null
      this.broadcast()
      this.schedule()
    }
  }

  async beforeUserWork() {
    if (this.disposed || !this.supported) return
    this.manualDepth += 1
    if (!this.active) return
    const active = this.active
    this.cancelActive(active.app, "manual")
    if (active.promise) await active.promise.catch(() => {})
  }

  afterUserWork() {
    if (this.disposed || !this.supported) return
    this.manualDepth = Math.max(0, this.manualDepth - 1)
    this.schedule()
  }

  async setAcknowledgement(app, signature = null) {
    const current = this.settings.get(app)
    const acknowledged = current && current.acknowledged_signature
    if ((acknowledged || null) === signature) return
    if (!current && signature === null) return
    const persisted = await this.vault.registry
      .setAutomaticAppScanAcknowledgement(app, signature)
    this.cacheAcknowledgement(app, signature, persisted.updated_at)
  }

  cacheAcknowledgement(app, signature, updatedAt = Date.now()) {
    this.settings.set(app, {
      mode: this.modeFor(app),
      acknowledged_signature: signature,
      updated_at: updatedAt || Date.now()
    })
  }

  async restorePublishedState(app, checking, setting) {
    const previous = checking && checking.previous &&
      checking.previous.state === "result"
      ? checking.previous
      : null
    const options = previous ? { signature: previous.signature } : {}
    if (setting) {
      options.acknowledged_signature = setting.acknowledged_signature || null
    }
    const persisted = await this.vault.registry.setAutomaticAppScanState(
      app, previous ? "result" : null, options)
    if (setting) {
      this.settings.set(app, Object.assign({}, setting, {
        updated_at: persisted.updated_at || setting.updated_at
      }))
    }
  }

  async publishResultNow(app, result = {}) {
    const verifiedFiles = Math.max(0, Number(result.verified_files) || 0)
    if (verifiedFiles > 0 && result.signature) {
      const acknowledged = (this.settings.get(app) || {})
        .acknowledged_signature
      const options = { signature: result.signature }
      if (acknowledged && acknowledged !== result.signature) {
        options.acknowledged_signature = null
      }
      const persisted = await this.vault.registry.setAutomaticAppScanState(
        app, "result", options)
      if (Object.prototype.hasOwnProperty.call(
        options, "acknowledged_signature")) {
        this.cacheAcknowledgement(app, null, persisted.updated_at)
      }
      this.entries.set(app, {
        app,
        state: "result",
        signature: result.signature,
        updated_at: persisted.updated_at || Date.now(),
        previous: null,
        hidden: acknowledged === result.signature
      })
      this.log("verified-matches", {
        app,
        verified_files: verifiedFiles,
        acknowledged: acknowledged === result.signature
      })
      return "result"
    }
    const acknowledged = (this.settings.get(app) || {})
      .acknowledged_signature
    if (acknowledged) {
      const persisted = await this.vault.registry.setAutomaticAppScanState(
        app, null, { acknowledged_signature: null })
      this.cacheAcknowledgement(app, null, persisted.updated_at)
    } else {
      await this.vault.registry.setAutomaticAppScanState(app, null)
    }
    this.entries.delete(app)
    this.log("no-verified-matches", { app })
    return "empty"
  }

  async clearAutomaticState(apps, reason, options = {}) {
    if (this.disposed || !this.supported) return false
    await this.hydrate()
    if (this.disposed) return false
    const states = new Set(options.states || ["result"])
    let changed = false
    for (const app of new Set((apps || []).filter(Boolean))) {
      if (this.disposed) break
      const cleared = await this.withAppTransition(app, async () => {
        if (this.disposed) return false
        if (options.cancelPending) this.cancelPendingStop(app, reason)
        const clearAcknowledgement = options.clearAcknowledgement && !!(
          this.settings.get(app) || {}).acknowledged_signature
        const entry = this.entries.get(app)
        if (!entry) {
          if (clearAcknowledgement) await this.setAcknowledgement(app, null)
          return false
        }
        const clearCurrent = states.has(entry.state)
        const clearPrevious = states.has("result") &&
          entry.state === "checking" && entry.previous &&
          entry.previous.state === "result"
        if (!clearCurrent && !clearPrevious) {
          if (clearAcknowledgement) await this.setAcknowledgement(app, null)
          return false
        }
        if (clearAcknowledgement) {
          const persisted = await this.vault.registry.setAutomaticAppScanState(
            app, null, { acknowledged_signature: null })
          this.cacheAcknowledgement(app, null, persisted.updated_at)
        } else {
          await this.vault.registry.setAutomaticAppScanState(app, null)
        }
        if (clearCurrent) this.entries.delete(app)
        else entry.previous = null
        this.log("state-cleared", { app, reason })
        return true
      })
      if (cleared) changed = true
    }
    if (changed) this.broadcast()
    return changed
  }

  coveredApps(scopeId) {
    const pending = new Set(this.pendingStops.keys())
    for (const app of this.changedPaths.keys()) pending.add(app)
    for (const entry of this.entries.values()) pending.add(entry.app)
    if (!scopeId) return [...pending]
    const source = this.vault.scanSource(scopeId)
    if (!source || source.kind !== "app") return []
    return pending.has(source.app) ? [source.app] : []
  }

  async scanFinished({ scopeId, result, error }) {
    if (this.disposed || !this.supported) return
    const complete = !error && result && COMPLETE_PHASES.has(result.outcome)
    let readinessChanged = false
    try {
      if (complete) {
        await this.hydrate()
        if (this.disposed) return
        const covered = this.coveredApps(scopeId)
        for (const app of covered) this.discardChangedPaths(app)
        await this.clearAutomaticState(
          covered,
          "manual-scan-completed",
          { cancelPending: true, states: ["checking", "result"] }
        )
      }
      if (!scopeId) readinessChanged = await this.refreshGlobalScanReady()
    } finally {
      if (readinessChanged) this.broadcast()
      this.schedule()
    }
  }

  async persistMode(app, mode) {
    const current = this.settings.get(app) || {}
    const persisted = await this.vault.registry.setAutomaticAppScanMode(
      app, mode)
    this.settings.set(app, {
      mode,
      acknowledged_signature: current.acknowledged_signature || null,
      updated_at: persisted.updated_at || Date.now()
    })
    return persisted
  }

  async removeUnavailableApp(app) {
    if (this.disposed) return false
    this.cancelPendingStop(app, "app-source-unavailable")
    this.cancelActive(app, "app-source-unavailable")
    if (this.vault.registry) {
      await this.vault.registry.removeAutomaticAppScanApp(app)
    }
    this.settings.delete(app)
    this.entries.delete(app)
    this.discardChangedPaths(app)
    this.broadcast()
    return true
  }

  async setMode(app, mode) {
    if (this.disposed) {
      return { error: "Automatic checks are unavailable." }
    }
    return this.withAppTransition(app, () => this.setModeNow(app, mode))
  }

  async setModeNow(app, mode) {
    if (this.disposed) {
      return { error: "Automatic checks are unavailable." }
    }
    if (!this.supported) {
      return { error: "Automatic checks are unavailable on this platform." }
    }
    await this.hydrate()
    if (this.disposed) {
      return { error: "Automatic checks are unavailable." }
    }
    if (mode !== "automatic" && mode !== "manual") {
      return { error: "Choose Automatic or Manual." }
    }
    if (!await this.appRootIsAvailable(app)) {
      await this.removeUnavailableApp(app)
      return { error: "That app is no longer available." }
    }
    if (mode === "automatic") {
      await this.persistMode(app, mode)
      await this.refreshGlobalScanReady()
      if (!this.globalScanReady) {
        this.log("mode-changed", {
          app,
          mode,
          check: "global-scan-required"
        })
        this.broadcast()
        return { app, mode }
      }
      if (!this.appIsRunning(app)) {
        this.log("mode-changed", { app, mode })
        this.queueApp(app)
      } else {
        this.log("mode-changed", { app, mode, check: "waiting-for-stop" })
        this.broadcast()
      }
      return { app, mode }
    }

    await this.persistMode(app, mode)
    const running = this.appIsRunning(app)
    this.cancelPendingStop(app, "manual-mode")
    if (!running) this.discardChangedPaths(app)
    const entry = this.entries.get(app)
    if (entry && entry.state === "checking") {
      this.cancelActive(app, "manual-mode")
      this.restorePrevious(app)
    }
    this.log("mode-changed", { app, mode })
    this.broadcast()
    return { app, mode }
  }

  async acknowledge(app, signature) {
    if (this.disposed) {
      return { error: "That automatic duplicate result is no longer available." }
    }
    return this.withAppTransition(app, async () => {
      await this.hydrate()
      if (this.disposed) {
        return { error: "That automatic duplicate result is no longer available." }
      }
      const current = this.entries.get(app)
      const entry = this.publicResult(current)
      if (!entry) {
        return { error: "That automatic duplicate result is no longer available." }
      }
      if (typeof signature !== "string" || signature !== entry.signature) {
        return { stale: true, app }
      }
      if (!await this.appRootIsAvailable(app)) {
        await this.removeUnavailableApp(app)
        return { error: "That app is no longer available." }
      }
      const persisted = await this.vault.registry.setAutomaticAppScanState(
        app, null, { acknowledged_signature: signature })
      this.cacheAcknowledgement(app, signature, persisted.updated_at)
      if (current.state === "checking") current.previous = null
      else this.entries.delete(app)
      this.broadcast()
      this.log("acknowledged", { app })
      return { acknowledged: true, app }
    })
  }
}

AutomaticScans.STOP_SETTLE_MS = STOP_SETTLE_MS

module.exports = AutomaticScans
