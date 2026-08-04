const fs = require("fs")
const path = require("path")
const { SIZE_THRESHOLD } = require("./constants")

const COMPLETE_PHASES = new Set(["complete", "completed_with_exclusions"])
const STOP_SETTLE_MS = 3000
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
    this.cancelReasons = new Map()
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
    const record = {
      time: new Date().toISOString(),
      event
    }
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null && value !== "") {
        record[key] = value
      }
    }
    console.log(`[Vault Automatic Scan] ${JSON.stringify(record)}`)
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
    return typeof noticeId === "string" &&
      noticeId === this.noticeId(entry)
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
      savings: entry.state === "result"
        ? Math.max(0, Number(entry.savings) || 0)
        : 0,
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
        .map(([app, setting]) => ({
          app,
          mode: setting.mode
        }))
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
          if (!this.sourceForApp(setting.app)) {
            stale.push(setting.app)
            continue
          }
          this.settings.set(setting.app, {
            mode: setting.mode === "manual" ? "manual" : "automatic",
            acknowledged_signature:
              setting.acknowledged_signature || null,
            updated_at: Number(setting.updated_at) || 0
          })
        }
        for (const row of rows || []) {
          if (!row || !row.app || this.entries.has(row.app)) continue
          if (!this.sourceForApp(row.app)) {
            stale.push(row.app)
            continue
          }
          this.entries.set(row.app, {
            app: row.app,
            state: row.state,
            savings: Math.max(0, Number(row.savings) || 0),
            updated_at: Number(row.updated_at) || 0,
            previous: null,
            hidden: row.state === "result" && !!(
              this.settings.get(row.app) || {}).acknowledged_signature
          })
        }
        await Promise.all([...new Set(stale)].map((app) =>
          this.vault.registry.removeAutomaticAppScanApp(app)))
        this.hydrated = true
        this.log("state-restored", {
          rows: this.entries.size,
          settings: this.settings.size
        })
      })
        .finally(() => {
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
      savings: 0,
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
      !this.observedApps.has(app) &&
      !this.appIsRunning(app)
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
        console.warn("Automatic Disk Saver scan failed:",
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
      this.log("scan-skipped", { app, reason: "vault-disabled" })
      return
    }
    if (!this.pendingStopIsCurrent(app, pending)) {
      this.cancelPendingStop(app, "app-restarted")
      return
    }
    if (!await this.appRootIsAvailable(app)) {
      this.pendingStops.delete(app)
      this.log("scan-skipped", { app, reason: "app-source-unavailable" })
      return
    }
    if (this.pendingStops.get(app) !== pending) return
    this.log("preparing", { app })
    await this.vault.ensureInitialized()
    if (this.pendingStops.get(app) !== pending) return
    await this.hydrate()
    await this.withAppTransition(app, async () => {
      if (this.pendingStops.get(app) !== pending) return
      if (this.modeFor(app) === "manual") {
        this.pendingStops.delete(app)
        this.log("scan-skipped", { app, reason: "manual" })
        return
      }
      if (!this.pendingStopIsCurrent(app, pending)) {
        this.cancelPendingStop(app, "app-restarted")
        return
      }
      if (!await this.appRootIsAvailable(app)) {
        this.pendingStops.delete(app)
        this.log("scan-skipped", { app, reason: "app-source-unavailable" })
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
    if (this.active && this.active.app === app) {
      this.cancelReasons.set(app, "app-started")
      this.log("scan-cancel-requested", {
        app,
        reason: "app-started"
      })
      this.vault.cancelScan({ owner: "automatic", app })
      return
    }
    const entry = this.entries.get(app)
    if (entry && entry.state === "checking") {
      this.restorePrevious(app)
      this.log("queued-scan-cleared", { app, reason: "app-started" })
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
      this.log("scan-skipped", { app, reason: "vault-disabled" })
      return
    }
    let entry = this.entries.get(app)
    if (!entry && !this.hydrated &&
        typeof this.vault.automaticScanStatus === "function") {
      await this.vault.automaticScanStatus()
      entry = this.entries.get(app)
    }
    if (this.modeFor(app) === "manual") {
      this.log("scan-skipped", { app, reason: "manual" })
      return
    }
    if (this.observedApps.has(app) || this.appIsRunning(app)) {
      this.log("scan-skipped", { app, reason: "app-still-running" })
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
        console.warn("Automatic Disk Saver scan failed:",
          error && error.message ? error.message : error)
      })
    })
  }

  async drain() {
    if (!this.vault.enabled || !this.vault.initialized || this.active) return
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
      this.log("scan-skipped", {
        app: entry.app,
        reason: !appAvailable ? "app-source-unavailable" : "app-restarted"
      })
      this.restorePrevious(entry.app)
      this.broadcast()
      this.schedule()
      return
    }
    this.active = { app: entry.app }
    const scopeId = `app:${encodeURIComponent(entry.app)}`
    this.log("scan-starting", {
      app: entry.app,
      scope_id: scopeId,
      threshold_bytes: this.sizeThreshold
    })
    const started = this.vault.startScan(
      scopeId,
      this.sizeThreshold,
      { owner: "automatic", app: entry.app }
    )
    if (!started.started) {
      this.log("scan-deferred", {
        app: entry.app,
        reason: started.disabled ? "vault-disabled" : "vault-busy"
      })
      this.active = null
      this.waitForBusyWork()
    } else {
      this.log("scan-started", { app: entry.app, scope_id: scopeId })
    }
  }

  async beforeUserWork() {
    this.manualDepth += 1
    if (!this.active || this.vault.scanOwner !== "automatic") return
    const app = this.active.app
    this.cancelReasons.set(app, "manual")
    this.log("scan-cancel-requested", { app, reason: "manual-vault-work" })
    const pending = this.vault.scanPromise
    this.vault.cancelScan({ owner: "automatic", app })
    if (pending) await pending.catch(() => {})
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

  async resultForScope(scopeId) {
    return this.vault.registry.automaticAppResultSignature(
      this.vault.scopeSourceIds(scopeId))
  }

  async publishResult(app, scopeId) {
    return this.withAppTransition(app, () =>
      this.publishResultNow(app, scopeId))
  }

  async publishResultNow(app, scopeId) {
    const result = await this.resultForScope(scopeId)
    const savings = Math.max(0, Number(result.savings) || 0)
    if (savings > 0 && result.signature) {
      const acknowledged = (this.settings.get(app) || {})
        .acknowledged_signature
      let persisted
      if (acknowledged && acknowledged !== result.signature) {
        persisted = await this.vault.registry.setAutomaticAppScanState(
          app, "result", savings, { acknowledged_signature: null })
        this.cacheAcknowledgement(app, null, persisted.updated_at)
      } else {
        persisted = await this.vault.registry.setAutomaticAppScanState(
          app, "result", savings)
      }
      this.entries.set(app, {
        app,
        state: "result",
        savings,
        signature: result.signature,
        updated_at: persisted.updated_at || Date.now(),
        previous: null,
        hidden: acknowledged === result.signature
      })
      this.log("result", {
        app,
        savings_bytes: savings,
        acknowledged: acknowledged === result.signature
      })
    } else {
      const acknowledged = (this.settings.get(app) || {})
        .acknowledged_signature
      if (acknowledged) {
        const persisted = await this.vault.registry.setAutomaticAppScanState(
          app, null, 0, { acknowledged_signature: null })
        this.cacheAcknowledgement(app, null, persisted.updated_at)
      } else {
        await this.vault.registry.setAutomaticAppScanState(app, null)
      }
      this.entries.delete(app)
      this.log("no-savings", { app })
    }
  }

  async reconcileResult(app) {
    const entry = this.entries.get(app)
    const current = entry && entry.state === "result"
    const previous = entry && entry.state === "checking" &&
      entry.previous && entry.previous.state === "result"
    if (!current && !previous) return false
    const source = this.sourceForApp(app)
    let result = { signature: null, savings: 0 }
    if (source) {
      result = await this.resultForScope(source.id)
    }
    const savings = Math.max(0, Number(result.savings) || 0)
    const target = current ? entry : entry.previous
    if (savings > 0 && result.signature) {
      const acknowledged = (this.settings.get(app) || {})
        .acknowledged_signature
      const hidden = acknowledged === result.signature
      if (target.savings === savings &&
          target.signature === result.signature &&
          !!target.hidden === hidden) {
        if (acknowledged && acknowledged !== result.signature) {
          await this.setAcknowledgement(app, null)
        }
        return false
      }
      let persisted
      if (acknowledged && acknowledged !== result.signature) {
        persisted = await this.vault.registry.setAutomaticAppScanState(
          app, "result", savings, { acknowledged_signature: null })
        this.cacheAcknowledgement(app, null, persisted.updated_at)
      } else {
        persisted = await this.vault.registry.setAutomaticAppScanState(
          app, "result", savings)
      }
      target.savings = savings
      target.signature = result.signature
      target.hidden = hidden
      target.updated_at = persisted.updated_at || Date.now()
    } else {
      const acknowledged = (this.settings.get(app) || {})
        .acknowledged_signature
      if (acknowledged) {
        const persisted = await this.vault.registry.setAutomaticAppScanState(
          app, null, 0, { acknowledged_signature: null })
        this.cacheAcknowledgement(app, null, persisted.updated_at)
      } else {
        await this.vault.registry.setAutomaticAppScanState(app, null)
      }
      if (current) {
        this.entries.delete(app)
      } else {
        entry.previous = null
      }
    }
    this.log("result-reconciled", { app, savings_bytes: savings })
    return true
  }

  async reconcileResults(apps, excludedApps = []) {
    await this.hydrate()
    const excluded = new Set(excludedApps)
    let changed = false
    for (const app of new Set((apps || []).filter(Boolean))) {
      if (excluded.has(app)) continue
      if (await this.withAppTransition(app, () =>
        this.reconcileResult(app))) changed = true
    }
    if (changed) this.broadcast()
    return changed
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
          entry.state === "checking" &&
          entry.previous && entry.previous.state === "result"
        if (!clearCurrent && !clearPrevious) {
          if (clearAcknowledgement) await this.setAcknowledgement(app, null)
          return false
        }
        if (clearAcknowledgement) {
          const persisted = await this.vault.registry.setAutomaticAppScanState(
            app, null, 0, { acknowledged_signature: null })
          this.cacheAcknowledgement(app, null, persisted.updated_at)
        } else {
          await this.vault.registry.setAutomaticAppScanState(app, null)
        }
        if (clearCurrent) {
          this.entries.delete(app)
        } else {
          entry.previous = null
        }
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
    if (!scopeId) {
      return [...pending]
    }
    const source = this.vault.scanSource(scopeId)
    if (!source || source.kind !== "app") return []
    return pending.has(source.app) ? [source.app] : []
  }

  async scanFinished({ owner, app, scopeId, result, error }) {
    const complete = !error && result &&
      COMPLETE_PHASES.has(result.outcome)
    if (owner === "automatic") {
      let affectedApps = []
      try {
        await this.withAppTransition(app, async () => {
          if (this.active && this.active.app === app) this.active = null
          const reason = this.cancelReasons.get(app)
          this.cancelReasons.delete(app)
          this.log("scan-finished", {
            app,
            scope_id: scopeId,
            outcome: result && result.outcome,
            cancel_reason: reason,
            error: error && error.message ? error.message : error
          })
          try {
            const entry = this.entries.get(app)
            if (reason === "paused" || reason === "manual-mode" ||
                (entry && entry.state === "paused")) {
              // Pause has already persisted and published its state.
            } else if (reason === "manual") {
              if (entry && entry.state === "checking") {
                entry.updated_at = Date.now()
              }
            } else if (reason === "app-source-unavailable") {
              // removeUnavailableApp already removed this scan's state.
            } else if (reason === "app-started") {
              this.restorePrevious(app)
            } else if (complete) {
              await this.publishResultNow(app, scopeId)
              affectedApps = result.affected_apps || []
            } else {
              this.restorePrevious(app)
            }
          } catch (error) {
            this.restorePrevious(app)
            throw error
          }
        })
        if (affectedApps.length) {
          await this.reconcileResults(
            affectedApps, [app]
          ).catch((error) => {
            console.warn("Automatic Disk Saver result reconciliation failed:",
              error && error.message ? error.message : error)
          })
        }
      } finally {
        this.broadcast()
        this.schedule()
      }
      return
    }
    try {
      if (owner === "manual" && complete) {
        await this.hydrate()
        const covered = this.coveredApps(scopeId)
        await this.clearAutomaticState(
          covered,
          "manual-scan-completed",
          { cancelPending: true, states: ["checking", "result"] }
        )
        await this.reconcileResults(
          result.affected_apps, covered
        ).catch((error) => {
          console.warn("Automatic Disk Saver result reconciliation failed:",
            error && error.message ? error.message : error)
        })
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
    if (this.active && this.active.app === app) {
      this.cancelReasons.set(app, "app-source-unavailable")
      this.log("scan-cancel-requested", {
        app,
        reason: "app-source-unavailable"
      })
      this.vault.cancelScan({ owner: "automatic", app })
    }
    await this.vault.registry.removeAutomaticAppScanApp(app)
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
    if (!this.sourceForApp(app) || !await this.appRootIsAvailable(app)) {
      await this.removeUnavailableApp(app)
      return { error: "That app is no longer available." }
    }
    if (mode === "automatic") {
      await this.vault.refreshSources()
      await this.persistMode(app, mode)
      const entry = this.entries.get(app)
      if (entry && entry.state === "paused") this.entries.delete(app)
      if (this.sourceForApp(app) && !this.appIsRunning(app)) {
        this.log("mode-changed", { app, mode })
        this.queueApp(app)
      } else {
        this.log("mode-changed", { app, mode, scan: "waiting-for-stop" })
        this.broadcast()
      }
      return { app, mode }
    }

    await this.persistMode(app, mode)
    this.cancelPendingStop(app, "manual-mode")
    const entry = this.entries.get(app)
    if (entry && entry.state === "checking") {
      if (this.active && this.active.app === app) {
        this.cancelReasons.set(app, "manual-mode")
        this.log("scan-cancel-requested", { app, reason: "manual-mode" })
        this.vault.cancelScan({ owner: "automatic", app })
      }
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
      if (!this.noticeMatches(entry, noticeId)) {
        return { stale: true, app }
      }
      if (!entry || entry.state !== "checking") {
        return { error: "That app is not being checked." }
      }
      const persisted = await this.persistMode(app, "manual", true)
      this.entries.set(app, {
        app,
        state: "paused",
        savings: 0,
        updated_at: persisted.updated_at || Date.now(),
        previous: null,
        hidden: false
      })
      this.cancelReasons.set(app, "paused")
      if (this.active && this.active.app === app) {
        this.log("scan-cancel-requested", { app, reason: "paused" })
        this.vault.cancelScan({ owner: "automatic", app })
      } else {
        this.cancelReasons.delete(app)
      }
      this.log("paused", { app })
      this.broadcast()
      return { paused: true, app, mode: "manual" }
    })
  }

  async resume(app, noticeId = null) {
    return this.withAppTransition(app, async () => {
      await this.hydrate()
      const entry = this.entries.get(app)
      if (!this.noticeMatches(entry, noticeId)) {
        return { stale: true, app }
      }
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
    if (this.sourceForApp(app) && await this.appRootIsAvailable(app)) {
      return { app, href: this.appHref(app) }
    }
    return this.withAppTransition(app, async () => {
      if (this.sourceForApp(app) && await this.appRootIsAvailable(app)) {
        return { app, href: this.appHref(app) }
      }
      await this.removeUnavailableApp(app)
      return { error: "That app is no longer available." }
    })
  }

  async acknowledgeResult(app, entry, options = {}) {
    let signature = entry && entry.signature
    if (!signature) {
      const source = this.sourceForApp(app)
      if (source) {
        signature = (await this.resultForScope(source.id)).signature
      }
    }
    if (options.clearState) {
      if (signature) {
        const persisted = await this.vault.registry.setAutomaticAppScanState(
          app, null, 0, { acknowledged_signature: signature })
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
      if (!this.noticeMatches(entry, noticeId)) {
        return { stale: true, app }
      }
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
      if (!this.noticeMatches(entry, noticeId)) {
        return { stale: true, app }
      }
      if (!entry || entry.state !== "result") {
        return { error: "That Disk Saver result is no longer available." }
      }
      if (!await this.appRootIsAvailable(app)) {
        await this.removeUnavailableApp(app)
        return { error: "That app is no longer available." }
      }
      await this.acknowledgeResult(app, entry, { clearState: true })
      this.entries.delete(app)
      this.broadcast()
      this.log("reviewed", { app })
      return {
        reviewed: true,
        app,
        href: this.appHref(app)
      }
    })
  }
}

AutomaticScans.STOP_SETTLE_MS = STOP_SETTLE_MS

module.exports = AutomaticScans
