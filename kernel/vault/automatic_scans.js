const fs = require("fs")
const path = require("path")
const {
  SIZE_THRESHOLD,
  isCandidateFileSize
} = require("./constants")
const {
  cancelledError,
  isPathError
} = require("./operation_errors")

const COMPLETE_PHASES = new Set(["complete", "completed_with_exclusions"])
const STOP_SETTLE_MS = 3000
const PROGRESS_INTERVAL_MS = 5000
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

class AutomaticScans {
  constructor(vault) {
    this.vault = vault
    this.entries = new Map()
    this.settings = new Map()
    this.hydrated = false
    this.hydrationPromise = null
    this.active = null
    this.manualDepth = 0
    this.observedApps = new Set()
    this.pendingStops = new Map()
    this.stopSettleMs = STOP_SETTLE_MS
    this.sizeThreshold = SIZE_THRESHOLD
    this.drainQueued = false
    this.waitingFor = null
    this.listeners = new Set()
    this.appTransitions = new Map()
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

  noticeId(entry) {
    if (!entry) return null
    const signature = entry.state === "result" &&
      typeof entry.signature === "string"
      ? entry.signature
      : ""
    return `${entry.state}:${Number(entry.updated_at) || 0}:${signature}`
  }

  noticeMatches(entry, noticeId) {
    if (noticeId === undefined || noticeId === null) return true
    return typeof noticeId === "string" && noticeId === this.noticeId(entry)
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
      notice_id: this.noticeId(entry)
    }
  }

  snapshot() {
    return {
      enabled: !!this.vault.enabled,
      rows: [...this.entries.values()]
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

  modeFor(app) {
    const setting = this.settings.get(app)
    return setting && setting.mode === "manual" ? "manual" : "automatic"
  }

  broadcast() {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (_) {}
    }
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {}
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  async hydrate() {
    if (this.hydrated || !this.vault.registry) return this.snapshot()
    if (!this.hydrationPromise) {
      this.hydrationPromise = Promise.all([
        this.vault.registry.automaticAppScanStates(),
        this.vault.registry.automaticAppScanSettings()
      ]).then(async ([rows, settings]) => {
        const stale = []
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
        await Promise.all([...new Set(stale)].map((app) =>
          this.vault.registry.removeAutomaticAppScanApp(app)))
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

  queueApp(app) {
    if (this.modeFor(app) === "manual") {
      this.log("queue-skipped", { app, reason: "manual" })
      return false
    }
    const current = this.entries.get(app)
    if (current && current.state === "paused") {
      this.log("queue-skipped", { app, reason: "paused" })
      return false
    }
    const previous = current && current.state === "result"
      ? Object.assign({}, current)
      : current && current.previous
        ? current.previous
        : null
    this.entries.set(app, {
      app,
      state: "checking",
      updated_at: Date.now(),
      previous,
      hidden: false
    })
    this.log("queued", { app })
    this.broadcast()
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
    return this.pendingStops.get(app) === pending &&
      !this.observedApps.has(app) && !this.appIsRunning(app)
  }

  scheduleStoppedApp(app, delay = this.stopSettleMs) {
    this.cancelPendingStop(app, "rescheduled")
    const pending = { timer: null }
    pending.timer = setTimeout(() => {
      pending.timer = null
      this.prepareStoppedApp(app, pending).catch((error) => {
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
    if (this.vault.ready) await this.vault.ready
    if (this.pendingStops.get(app) !== pending) return
    if (!this.vault.enabled) {
      this.pendingStops.delete(app)
      this.log("check-skipped", { app, reason: "vault-disabled" })
      return
    }
    if (!this.pendingStopIsCurrent(app, pending)) {
      this.cancelPendingStop(app, "app-restarted")
      return
    }
    if (!await this.appRootIsAvailable(app)) {
      await this.removeUnavailableApp(app)
      this.log("check-skipped", { app, reason: "app-source-unavailable" })
      return
    }
    this.log("preparing", { app })
    await this.vault.ensureRegistryInitialized()
    if (this.pendingStops.get(app) !== pending) return
    await this.hydrate()
    await this.withAppTransition(app, async () => {
      if (this.pendingStops.get(app) !== pending) return
      if (this.modeFor(app) === "manual") {
        this.pendingStops.delete(app)
        this.log("check-skipped", { app, reason: "manual" })
        return
      }
      if (!this.pendingStopIsCurrent(app, pending)) {
        this.cancelPendingStop(app, "app-restarted")
        return
      }
      if (!await this.appRootIsAvailable(app)) {
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
      this.broadcast()
    }
  }

  async handleStopped(launchPath) {
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
    const stoppedAt = Date.now()
    if (this.vault.ready) await this.vault.ready
    if (!this.vault.enabled) {
      this.log("check-skipped", { app, reason: "vault-disabled" })
      return
    }
    if (!this.hydrated && typeof this.vault.automaticScanStatus === "function") {
      await this.vault.automaticScanStatus()
    }
    if (this.modeFor(app) === "manual") {
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
    if (this.drainQueued) return
    this.drainQueued = true
    queueMicrotask(() => {
      this.drainQueued = false
      this.drain().catch((error) => {
        this.log("error", {
          stage: "queue",
          message: error && error.message ? error.message : String(error)
        })
        console.warn("Automatic Disk Saver check failed:",
          error && error.message ? error.message : error)
      })
    })
  }

  cancelActive(app, reason) {
    if (!this.active || this.active.app !== app || this.active.cancelled) {
      return false
    }
    this.active.cancelled = true
    this.active.reason = reason
    this.log("check-cancel-requested", { app, reason })
    return true
  }

  checkpoint(active) {
    if (!active || active.cancelled || this.active !== active) {
      throw cancelledError("Automatic check cancelled.")
    }
  }

  async runPrecheck(active) {
    const app = active.app
    const root = path.resolve(this.vault.kernel.homedir, "api", app)
    if (!await this.appRootIsAvailable(app)) {
      const error = new Error("That app is no longer available.")
      error.code = "ENOENT"
      throw error
    }
    const startedAt = Date.now()
    const counts = {
      dirs: 0,
      files: 0,
      bytes: 0,
      candidates: 0,
      path_errors: 0
    }
    let lastProgressAt = startedAt
    await this.vault.registry.beginAutomaticPrecheck(app)
    this.log("check-started", {
      app,
      root,
      threshold_bytes: this.sizeThreshold,
      policy: "metadata-only"
    })
    try {
      await this.vault.scanner.walk(root, {
        checkpoint: () => this.checkpoint(active),
        onError: (error, filePath) => {
          if (!isPathError(error)) return false
          if (path.resolve(filePath) === root) return false
          counts.path_errors += 1
          this.log("path-skipped", {
            app,
            path: filePath,
            code: error.code,
            message: error.message
          })
          return true
        },
        onBatch: async ({ files, directories, currentDirectory }) => {
          this.checkpoint(active)
          counts.dirs += directories
          counts.files += files.length
          counts.bytes += files.reduce((total, file) =>
            total + Math.max(0, Number(file.stat.size) || 0), 0)
          const candidates = files.filter((file) =>
            isCandidateFileSize(file.stat.size, this.sizeThreshold))
            .map((file) => ({
              path: path.resolve(file.path),
              size: file.stat.size,
              dev: file.stat.dev,
              ino: file.stat.ino
            }))
          counts.candidates += candidates.length
          if (candidates.length) {
            await this.vault.registry.stageAutomaticPrecheckFiles(
              app, candidates)
          }
          this.checkpoint(active)
          const now = Date.now()
          if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            lastProgressAt = now
            this.log("check-progress", Object.assign({
              app,
              elapsed_ms: now - startedAt,
              current_directory: currentDirectory
            }, counts))
          }
        }
      })
      this.checkpoint(active)
      if (!await this.appRootIsAvailable(app)) {
        const error = new Error("That app is no longer available.")
        error.code = "ENOENT"
        throw error
      }
      const result = await this.vault.registry.automaticPrecheckResult(app)
      this.checkpoint(active)
      return Object.assign({}, counts, {
        signature: result.signature,
        possible_files: Math.max(0, Number(result.files) || 0),
        duration_ms: Date.now() - startedAt
      })
    } finally {
      await this.vault.registry.abortAutomaticPrecheck(app)
    }
  }

  async drain() {
    if (!this.vault.enabled || !this.vault.registry || this.active) return
    if (this.manualDepth > 0 || this.currentBusyPromise() ||
        this.vault.fileActionProgress) {
      this.waitForBusyWork()
      return
    }
    const entry = [...this.entries.values()].find((item) =>
      item.state === "checking")
    if (!entry) return
    let appAvailable
    try {
      appAvailable = await this.appRootIsAvailable(entry.app)
    } catch (error) {
      if (this.entries.get(entry.app) === entry) {
        this.restorePrevious(entry.app)
        this.broadcast()
      }
      this.schedule()
      throw error
    }
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
        this.broadcast()
      }
      this.schedule()
      return
    }
    const active = {
      app: entry.app,
      cancelled: false,
      reason: null,
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
          duration_ms: result && result.duration_ms,
          dirs: result && result.dirs,
          files: result && result.files,
          bytes: result && result.bytes,
          candidates: result && result.candidates,
          possible_files: result && result.possible_files,
          path_errors: result && result.path_errors,
          error: error && error.message
        })
        const entry = this.entries.get(app)
        if (reason === "paused" || reason === "manual-mode" ||
            reason === "app-source-unavailable" ||
            (entry && entry.state === "paused")) return
        if (reason === "manual") {
          if (entry && entry.state === "checking") entry.updated_at = Date.now()
          return
        }
        if (reason === "app-started") {
          this.restorePrevious(app)
          return
        }
        if (error) {
          if (isMissing(error)) {
            await this.vault.registry.removeAutomaticAppScanApp(app)
            this.settings.delete(app)
            this.entries.delete(app)
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
          if (reason === "manual") {
            entry.updated_at = Date.now()
          } else if (reason === "app-started") {
            this.restorePrevious(app)
          }
          return
        }
        if (this.active === active) this.active = null
      })
    } finally {
      if (this.active === active) this.active = null
      this.broadcast()
      this.schedule()
    }
  }

  async beforeUserWork() {
    this.manualDepth += 1
    if (!this.active) return
    const active = this.active
    this.cancelActive(active.app, "manual")
    if (active.promise) await active.promise.catch(() => {})
  }

  afterUserWork() {
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
    const possibleFiles = Math.max(0, Number(result.possible_files) || 0)
    if (possibleFiles > 0 && result.signature) {
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
      this.log("possible-matches", {
        app,
        possible_files: possibleFiles,
        acknowledged: acknowledged === result.signature
      })
      return
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
    this.log("no-possible-matches", { app })
  }

  async clearAutomaticState(apps, reason, options = {}) {
    await this.hydrate()
    const states = new Set(options.states || ["result"])
    let changed = false
    for (const app of new Set((apps || []).filter(Boolean))) {
      const cleared = await this.withAppTransition(app, async () => {
        if (options.cancelPending) this.cancelPendingStop(app, reason)
        const clearAcknowledgement = options.clearAcknowledgement && !!(
          this.settings.get(app) || {}).acknowledged_signature
        const entry = this.entries.get(app)
        if (!entry || entry.state === "paused") {
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
    for (const entry of this.entries.values()) {
      if (entry.state !== "paused") pending.add(entry.app)
    }
    if (!scopeId) return [...pending]
    const source = this.vault.scanSource(scopeId)
    if (!source || source.kind !== "app") return []
    return pending.has(source.app) ? [source.app] : []
  }

  async scanFinished({ scopeId, result, error }) {
    const complete = !error && result && COMPLETE_PHASES.has(result.outcome)
    try {
      if (complete) {
        await this.hydrate()
        const covered = this.coveredApps(scopeId)
        await this.clearAutomaticState(
          covered,
          "manual-scan-completed",
          { cancelPending: true, states: ["checking", "result"] }
        )
      }
    } finally {
      this.schedule()
    }
  }

  async persistMode(app, mode, showPausedNotice = false) {
    const current = this.settings.get(app) || {}
    const persisted = await this.vault.registry.setAutomaticAppScanMode(
      app, mode, showPausedNotice)
    this.settings.set(app, {
      mode,
      acknowledged_signature: current.acknowledged_signature || null,
      updated_at: persisted.updated_at || Date.now()
    })
    return persisted
  }

  async removeUnavailableApp(app) {
    this.cancelPendingStop(app, "app-source-unavailable")
    this.cancelActive(app, "app-source-unavailable")
    if (this.vault.registry) {
      await this.vault.registry.removeAutomaticAppScanApp(app)
    }
    this.settings.delete(app)
    this.entries.delete(app)
    this.broadcast()
  }

  async setMode(app, mode) {
    return this.withAppTransition(app, () => this.setModeNow(app, mode))
  }

  async setModeNow(app, mode) {
    await this.hydrate()
    if (mode !== "automatic" && mode !== "manual") {
      return { error: "Choose Automatic or Manual." }
    }
    if (!await this.appRootIsAvailable(app)) {
      await this.removeUnavailableApp(app)
      return { error: "That app is no longer available." }
    }
    if (mode === "automatic") {
      await this.persistMode(app, mode)
      const entry = this.entries.get(app)
      if (entry && entry.state === "paused") this.entries.delete(app)
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
    this.cancelPendingStop(app, "manual-mode")
    const entry = this.entries.get(app)
    if (entry && entry.state === "checking") {
      this.cancelActive(app, "manual-mode")
      this.restorePrevious(app)
    } else if (entry && entry.state === "paused") {
      this.entries.delete(app)
    }
    this.log("mode-changed", { app, mode })
    this.broadcast()
    return { app, mode }
  }

  async pause(app, noticeId = null) {
    return this.withAppTransition(app, async () => {
      await this.hydrate()
      const entry = this.entries.get(app)
      if (!this.noticeMatches(entry, noticeId)) return { stale: true, app }
      if (!entry || entry.state !== "checking") {
        return { error: "That app is not being checked." }
      }
      const persisted = await this.persistMode(app, "manual", true)
      this.entries.set(app, {
        app,
        state: "paused",
        updated_at: persisted.updated_at || Date.now(),
        previous: null,
        hidden: false
      })
      this.cancelActive(app, "paused")
      this.log("paused", { app })
      this.broadcast()
      return { paused: true, app, mode: "manual" }
    })
  }

  async resume(app, noticeId = null) {
    return this.withAppTransition(app, async () => {
      await this.hydrate()
      const entry = this.entries.get(app)
      if (!this.noticeMatches(entry, noticeId)) return { stale: true, app }
      if (this.modeFor(app) !== "manual") {
        return { error: "Automatic checking is not paused for that app." }
      }
      const result = await this.setModeNow(app, "automatic")
      if (result.error) return result
      this.log("resumed", { app })
      return { resumed: true, app, mode: "automatic" }
    })
  }

  appHref(app) {
    return `/v/${encodeURIComponent(app)}?pinokio_home_select=${
      encodeURIComponent(JSON.stringify({ selector: "#save-space-tab" }))
    }`
  }

  async settingsLink(app) {
    if (await this.appRootIsAvailable(app)) {
      return { app, href: this.appHref(app) }
    }
    return this.withAppTransition(app, async () => {
      if (await this.appRootIsAvailable(app)) {
        return { app, href: this.appHref(app) }
      }
      await this.removeUnavailableApp(app)
      return { error: "That app is no longer available." }
    })
  }

  async acknowledgeResult(app, entry, options = {}) {
    const signature = entry && entry.signature
    if (options.clearState) {
      if (signature) {
        const persisted = await this.vault.registry.setAutomaticAppScanState(
          app, null, { acknowledged_signature: signature })
        this.cacheAcknowledgement(app, signature, persisted.updated_at)
      } else {
        await this.vault.registry.setAutomaticAppScanState(app, null)
      }
    } else if (signature) {
      await this.setAcknowledgement(app, signature)
    }
    return signature || null
  }

  async dismiss(app, noticeId = null) {
    return this.withAppTransition(app, async () => {
      await this.hydrate()
      const entry = this.entries.get(app)
      if (!this.noticeMatches(entry, noticeId)) return { stale: true, app }
      if (!entry) return { dismissed: true, app }
      if (entry.state === "checking") {
        entry.hidden = true
      } else if (entry.state === "paused") {
        await this.vault.registry.setAutomaticAppScanState(app, null)
        this.entries.delete(app)
      } else if (entry.state === "result") {
        await this.acknowledgeResult(app, entry)
        entry.hidden = true
      }
      this.log("dismissed", { app, state: entry.state })
      this.broadcast()
      return { dismissed: true, app }
    })
  }

  async review(app, noticeId = null) {
    return this.withAppTransition(app, async () => {
      await this.hydrate()
      const entry = this.entries.get(app)
      if (!this.noticeMatches(entry, noticeId)) return { stale: true, app }
      if (!entry || entry.state !== "result") {
        return { error: "That possible-match notice is no longer available." }
      }
      if (!await this.appRootIsAvailable(app)) {
        await this.removeUnavailableApp(app)
        return { error: "That app is no longer available." }
      }
      await this.acknowledgeResult(app, entry, { clearState: true })
      this.entries.delete(app)
      this.broadcast()
      this.log("reviewed", { app })
      return { reviewed: true, app, href: this.appHref(app) }
    })
  }
}

AutomaticScans.STOP_SETTLE_MS = STOP_SETTLE_MS

module.exports = AutomaticScans
