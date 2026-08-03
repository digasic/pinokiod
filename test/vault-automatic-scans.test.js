const { after, beforeEach, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Kernel = require("../kernel")
const Vault = require("../kernel/vault")
const AutomaticScans = require("../kernel/vault/automatic_scans")
const { SIZE_THRESHOLD } = require("../kernel/vault/constants")

const homes = []

const makeHome = async () => {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pinokio-vault-automatic-"))
  homes.push(home)
  await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
  return home
}

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for the automatic app scan.")
}

const close = async (vault) => {
  if (vault.worker) await vault.worker.terminate().catch(() => {})
  if (vault.registry) await vault.registry.close()
}

describe("automatic app scans", () => {
  beforeEach(() => {
    delete process.env.PINOKIO_VAULT
  })

  after(async () => {
    for (const home of homes) {
      await fs.promises.rm(home, {
        recursive: true,
        force: true
      }).catch(() => {})
    }
  })

  test("reading the shared notice state does not create Vault storage", async () => {
    const home = await makeHome()
    const vault = new Vault({
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    })
    await vault.init({ deferStorage: true })

    assert.deepEqual((await vault.automaticScanStatus()).rows, [])
    assert.equal(vault.initialized, false)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
  })

  test("disabled Vault does not begin settling after an app stops", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "disabled-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot, { recursive: true })
    await fs.promises.writeFile(
      path.join(home, "ENVIRONMENT"), "PINOKIO_VAULT=false\n")
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready

    vault.automaticScans.handleStarted(scriptPath)
    await vault.automaticScans.handleStopped(scriptPath)

    assert.equal(vault.enabled, false)
    assert.equal(vault.automaticScans.observedApps.size, 0)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
    await close(vault)
  })

  test("lifecycle events wait for the enable flag without being lost", async () => {
    let resolveReady
    const vault = {
      enabled: false,
      ready: new Promise((resolve) => { resolveReady = resolve }),
      kernel: {
        homedir: "/pinokio",
        api: { running_paths: {} }
      },
      sources: () => [],
      automaticScanStatus: async () => ({ rows: [] })
    }
    const automatic = new AutomaticScans(vault)
    let settledApp = null
    automatic.scheduleStoppedApp = (app) => { settledApp = app }

    const started = automatic.handleStarted("/pinokio/api/demo/start.js")
    const stopped = automatic.handleStopped("/pinokio/api/demo/start.js")
    vault.enabled = true
    resolveReady({ enabled: true })
    await Promise.all([started, stopped])

    assert.equal(settledApp, "demo")
  })

  test("the last managed process stop scans one app and persists its notice", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "demo")
    const scriptPath = path.join(appRoot, "start.js")
    const duplicate = crypto.randomBytes(4096)
    await fs.promises.mkdir(appRoot, { recursive: true })
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), duplicate)
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), duplicate)

    const socketPackets = []
    const api = {
      running: { other: true },
      running_paths: { other: path.join(appRoot, "worker.js") },
      ondata(packet) { socketPackets.push(packet) }
    }
    const kernel = { homedir: home, platform: process.platform, api }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
    vault.automaticScans.sizeThreshold = 1
    vault.automaticScans.stopSettleMs = 10

    vault.automaticScans.handleStarted(scriptPath)
    vault.automaticScans.handleStarted(api.running_paths.other)
    await vault.automaticScans.handleStopped(scriptPath)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)

    delete api.running.other
    delete api.running_paths.other
    await vault.automaticScans.handleStopped(path.join(appRoot, "worker.js"))
    assert.equal(vault.automaticScans.entries.has("demo"), false)
    await waitFor(() => {
      const row = vault.automaticScans.entries.get("demo")
      return !vault.scanPromise && row && row.state === "result"
    })

    const row = vault.automaticScans.entries.get("demo")
    assert.equal(row.app, "demo")
    assert.ok(row.savings > 0)
    assert.equal((await vault.registry.scanFor("app:demo")).scope_id,
      "app:demo")
    assert.deepEqual(socketPackets, [])
    await vault.automaticScans.handleStopped(scriptPath)
    assert.equal(vault.scanPromise, null)
    await close(vault)

    const restoredKernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const restored = new Vault(restoredKernel)
    restoredKernel.vault = restored
    restored.ready = restored.init({ deferStorage: true })
    await restored.ready
    const restoredStatus = await restored.automaticScanStatus()
    assert.equal(restoredStatus.rows.length, 1)
    assert.equal(restoredStatus.rows[0].state, "result")

    restored.automaticScans.manualDepth = 1
    restored.automaticScans.scheduleStoppedApp("demo", 50)
    assert.equal(restored.automaticScans.pendingStops.has("demo"), true)
    let reviewRefreshes = 0
    restored.refreshSources = async () => { reviewRefreshes += 1 }
    const reviewed = await restored.perform(
      "automatic_review", { app: "demo" })
    const reviewedUrl = new URL(reviewed.href, "http://localhost")
    assert.equal(reviewedUrl.pathname, "/v/demo")
    assert.deepEqual(JSON.parse(reviewedUrl.searchParams.get(
      "pinokio_home_select")), { selector: "#save-space-tab" })
    assert.equal(reviewRefreshes, 0)
    assert.equal(restored.automaticScans.pendingStops.has("demo"), true)
    assert.deepEqual((await restored.automaticScanStatus()).rows, [])
    await waitFor(() => {
      const next = restored.automaticScans.entries.get("demo")
      return next && next.state === "checking"
    })
    assert.deepEqual(await restored.registry.automaticAppScanStates(), [])
    await close(restored)
  })

  test("a manual app rescan clears an existing automatic result", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "manual-app")
    const contents = crypto.randomBytes(4096)
    await fs.promises.mkdir(appRoot, { recursive: true })
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), contents)
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), contents)
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()
    const scopeId = "app:manual-app"

    assert.equal((await vault.perform("scan", {
      scope_id: scopeId,
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await vault.automaticScans.publishResult("manual-app", scopeId)
    assert.equal(vault.automaticScans.entries.get("manual-app").state,
      "result")

    assert.equal((await vault.perform("scan", {
      scope_id: scopeId,
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)

    assert.deepEqual((await vault.automaticScanStatus()).rows, [])
    assert.deepEqual(await vault.registry.automaticAppScanStates(), [])
    await close(vault)
  })

  test("a peer rescan removes a result made stale by reclassification", async () => {
    const home = await makeHome()
    const referenceRoot = path.join(home, "api", "reference-app")
    const resultRoot = path.join(home, "api", "result-app")
    const contents = crypto.randomBytes(4096)
    const reference = path.join(referenceRoot, "model.bin")
    const duplicate = path.join(resultRoot, "model.bin")
    await fs.promises.mkdir(referenceRoot, { recursive: true })
    await fs.promises.mkdir(resultRoot, { recursive: true })
    await fs.promises.writeFile(reference, contents)
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()

    assert.equal((await vault.perform("scan", {
      scope_id: "app:reference-app",
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await fs.promises.writeFile(duplicate, contents)
    assert.equal((await vault.perform("scan", {
      scope_id: "app:result-app",
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await vault.automaticScans.publishResult(
      "result-app", "app:result-app")
    assert.equal(vault.automaticScans.entries.get("result-app").savings,
      contents.length)

    await fs.promises.rm(reference)
    assert.equal((await vault.perform("scan", {
      scope_id: "app:reference-app",
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)

    assert.equal((await vault.registry.getFile(duplicate)).status, "reference")
    assert.deepEqual((await vault.automaticScanStatus()).rows, [])
    assert.deepEqual(await vault.registry.automaticAppScanStates(), [])
    await close(vault)
  })

  test("a file action clears affected app results and preserves unrelated results", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "action-app")
    const otherRoot = path.join(home, "api", "other-app")
    const peerRoot = path.join(home, "api", "peer-app")
    const contents = crypto.randomBytes(4096)
    const otherContents = crypto.randomBytes(5000)
    await fs.promises.mkdir(appRoot, { recursive: true })
    await fs.promises.mkdir(otherRoot, { recursive: true })
    await fs.promises.mkdir(peerRoot, { recursive: true })
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), contents)
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), contents)
    await fs.promises.writeFile(
      path.join(otherRoot, "first.bin"), otherContents)
    await fs.promises.writeFile(
      path.join(otherRoot, "second.bin"), otherContents)
    await fs.promises.writeFile(path.join(peerRoot, "first.bin"), contents)
    await fs.promises.writeFile(path.join(peerRoot, "second.bin"), contents)
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()
    const scopeId = "app:action-app"

    assert.equal((await vault.perform("scan", {
      scope_id: scopeId,
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await vault.automaticScans.publishResult("action-app", scopeId)
    assert.equal(vault.automaticScans.entries.get("action-app").state,
      "result")
    assert.equal((await vault.perform("scan", {
      scope_id: "app:other-app",
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await vault.automaticScans.publishResult("other-app", "app:other-app")
    assert.equal((await vault.perform("scan", {
      scope_id: "app:peer-app",
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await vault.automaticScans.publishResult("peer-app", "app:peer-app")
    vault.automaticScans.manualDepth = 1
    vault.automaticScans.queueApp("action-app")
    assert.equal(vault.automaticScans.entries.get("action-app").state,
      "checking")
    assert.equal(vault.automaticScans.entries.get("action-app").previous.state,
      "result")

    const result = await vault.perform("deduplicate", { scope_id: scopeId })
    assert.equal(result.converted, 1)
    assert.equal(vault.automaticScans.entries.get("action-app").state,
      "checking")
    assert.equal(vault.automaticScans.entries.get("action-app").previous,
      null)
    assert.deepEqual((await vault.automaticScanStatus()).rows
      .filter((row) => row.state === "result")
      .map((row) => row.app), ["other-app"])
    assert.deepEqual((await vault.registry.automaticAppScanStates()).map(
      (row) => row.app), ["other-app"])
    await close(vault)
  })

  test("bulk file actions resolve affected apps in bounded batches", async () => {
    const vault = new Vault({
      homedir: "/pinokio",
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    })
    const paths = Array.from({ length: 250 }, (_value, index) =>
      `/pinokio/api/demo/${String(index).padStart(3, "0")}.bin`)
    const lookupSizes = []
    let clearedApps = []
    vault.scopeSourceIds = () => ["app:demo"]
    vault.registry = {
      fileBatch: async (_status, _sourceIds, cursor, limit) => paths
        .filter((filePath) => filePath > cursor)
        .slice(0, limit)
        .map((filePath) => ({ path: filePath })),
      appsForHashes: async (hashes) => {
        lookupSizes.push(hashes.length)
        return ["demo"]
      }
    }
    vault.convert = async (filePath) => ({
      status: "converted",
      hash: path.basename(filePath),
      bytes_saved: 1
    })
    vault.recordDeduplicationSummary = async () => {}
    vault.automaticScans.clearAutomaticState = async (apps) => {
      clearedApps = apps
    }

    const result = await vault.runFileAction(
      { files_completed: 0 },
      (progress, changedHashes) => vault.deduplicateScope("app:demo", {
        progress,
        changedHashes
      })
    )

    assert.equal(result.converted, 250)
    assert.deepEqual(lookupSizes, [100, 100, 50])
    assert.deepEqual(clearedApps, ["demo"])
  })

  test("an already-linked correction records its content as changed", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "already-app")
    const contents = crypto.randomBytes(4096)
    await fs.promises.mkdir(appRoot, { recursive: true })
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), contents)
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), contents)
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()
    const scopeId = "app:already-app"

    assert.equal((await vault.perform("scan", {
      scope_id: scopeId,
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    assert.equal((await vault.perform(
      "deduplicate", { scope_id: scopeId })).converted, 1)
    const linked = (await vault.registry.files({
      sourceIds: [scopeId],
      statuses: ["linked"]
    }))[0]
    assert.ok(linked)
    await vault.registry.upsertFile(Object.assign({}, linked, {
      status: "duplicate"
    }))

    const changedHashes = new Set()
    const corrected = await vault.deduplicateFile(
      linked.path, changedHashes)
    assert.equal(corrected.status, "already")
    assert.deepEqual([...changedHashes], [linked.hash])
    assert.equal((await vault.registry.getFile(linked.path)).status, "linked")
    await close(vault)
  })

  test("scan cancellation can be restricted to its automatic owner", () => {
    const vault = new Vault({
      homedir: path.join(os.tmpdir(), "pinokio-vault-owner-test"),
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    })
    let cancelled = false
    vault.scanPromise = Promise.resolve()
    vault.scanOwner = "manual"
    vault.sweeper = {
      state: { active: true },
      currentHash: null,
      cancel() {
        cancelled = true
        return true
      }
    }

    assert.deepEqual(vault.cancelScan({ owner: "automatic" }), {
      cancel_requested: false
    })
    assert.equal(cancelled, false)
    assert.equal(vault.cancelScan().cancel_requested, true)
    assert.equal(cancelled, true)
  })

  test("notification bookkeeping cannot turn a completed scan back to queued", async () => {
    const vault = new Vault({
      homedir: path.join(os.tmpdir(), "pinokio-vault-complete-status"),
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    })
    vault.enabled = true
    vault.sweeper = {
      state: { active: false, phase: "idle", scope_id: null },
      currentHash: null,
      idleState() {
        return { active: false, phase: "idle", scope_id: null }
      },
      async scan(scopeId) {
        this.state = { active: false, phase: "complete", scope_id: scopeId }
        return { outcome: "complete" }
      }
    }
    let release
    let bookkeepingStarted = false
    vault.automaticScans.scanFinished = async () => {
      bookkeepingStarted = true
      await new Promise((resolve) => { release = resolve })
    }

    assert.equal(vault.startScan("app:demo", 0).started, true)
    await waitFor(() => bookkeepingStarted)

    assert.equal(vault.scanPromise, null)
    assert.equal(vault.scanStatus().phase, "complete")
    assert.equal(vault.scanStatus().pending, false)
    release()
  })

  test("a non-work action does not preempt automatic scanning", async () => {
    const vault = new Vault({
      homedir: path.join(os.tmpdir(), "pinokio-vault-passive-action"),
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    })
    vault.enabled = true
    vault.initialized = true
    let preemptions = 0
    vault.automaticScans.beforeUserWork = async () => { preemptions += 1 }

    assert.deepEqual(await vault.perform("not-an-action"), {
      error: "unknown action"
    })
    assert.equal(preemptions, 0)
  })

  test("automatic scans use their fixed threshold", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "threshold-app")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()
    vault.sizeThreshold = 0
    let activeThreshold = null
    const scan = vault.sweeper.scan.bind(vault.sweeper)
    vault.sweeper.scan = async (...args) => {
      activeThreshold = vault.sizeThreshold
      return scan(...args)
    }

    vault.automaticScans.queueApp("threshold-app")
    await waitFor(() => activeThreshold !== null &&
      !vault.scanPromise && !vault.scanCompletionPromise)

    assert.equal(activeThreshold, SIZE_THRESHOLD)
    assert.equal(vault.sizeThreshold, 0)
    await close(vault)
  })

  test("result publication failure clears checking state", async () => {
    const automatic = new AutomaticScans({
      enabled: true,
      kernel: {
        homedir: "/pinokio",
        api: { running_paths: {} }
      }
    })
    automatic.active = { app: "demo" }
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      savings: 0,
      updated_at: 1,
      previous: null
    })
    let broadcasts = 0
    let schedules = 0
    automatic.broadcast = () => { broadcasts += 1 }
    automatic.schedule = () => { schedules += 1 }
    automatic.publishResult = async () => {
      throw new Error("publication failed")
    }

    await assert.rejects(() => automatic.scanFinished({
      owner: "automatic",
      app: "demo",
      scopeId: "app:demo",
      result: { outcome: "complete" }
    }), /publication failed/)

    assert.equal(automatic.active, null)
    assert.equal(automatic.entries.has("demo"), false)
    assert.equal(broadcasts, 1)
    assert.equal(schedules, 1)
  })

  test("an app availability failure clears the checking notification", async () => {
    const vault = {
      enabled: true,
      initialized: true,
      kernel: { homedir: "/pinokio", api: { running_paths: {} } }
    }
    const automatic = new AutomaticScans(vault)
    automatic.appRootIsAvailable = async () => {
      throw new Error("availability failed")
    }
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.schedule = () => {}
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      savings: 0,
      updated_at: 2,
      previous: {
        app: "demo",
        state: "result",
        savings: 4096,
        updated_at: 1,
        previous: null
      }
    })

    await assert.rejects(() => automatic.drain(), /availability failed/)

    assert.deepEqual(automatic.snapshot().rows, [{
      app: "demo",
      state: "result",
      savings: 4096
    }])
  })

  test("a failed Pause does not cancel the automatic scan", async () => {
    let cancellations = 0
    const automatic = new AutomaticScans({
      enabled: true,
      kernel: { homedir: "/pinokio", api: { running_paths: {} } },
      registry: {
        setAutomaticAppScanState: async () => {
          throw new Error("database failed")
        }
      },
      cancelScan: () => { cancellations += 1 }
    })
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.active = { app: "demo" }
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      savings: 0,
      updated_at: 1,
      previous: null
    })

    await assert.rejects(() => automatic.pause("demo"), /database failed/)

    assert.equal(cancellations, 0)
    assert.equal(automatic.entries.get("demo").state, "checking")
    assert.equal(automatic.cancelReasons.has("demo"), false)
  })

  test("a failed Resume preserves the persisted Pause", async () => {
    let persistenceCalls = 0
    const automatic = new AutomaticScans({
      enabled: true,
      kernel: { homedir: "/pinokio", api: { running_paths: {} } },
      refreshSources: async () => { throw new Error("refresh failed") },
      registry: {
        setAutomaticAppScanState: async () => { persistenceCalls += 1 }
      }
    })
    automatic.hydrated = true
    automatic.entries.set("demo", {
      app: "demo",
      state: "paused",
      savings: 0,
      updated_at: 1,
      previous: null
    })

    await assert.rejects(() => automatic.resume("demo"), /refresh failed/)

    assert.equal(persistenceCalls, 0)
    assert.equal(automatic.entries.get("demo").state, "paused")
  })

  test("Pause during the availability check prevents the queued scan", async () => {
    let releaseCheck
    let checkStarted = false
    let scans = 0
    const automatic = new AutomaticScans({
      enabled: true,
      initialized: true,
      kernel: { homedir: "/pinokio", api: { running_paths: {} } },
      registry: {
        setAutomaticAppScanState: async () => ({ updated_at: 2 })
      },
      cancelScan: () => {},
      startScan: () => {
        scans += 1
        return { started: true }
      }
    })
    automatic.appRootIsAvailable = () => new Promise((resolve) => {
      checkStarted = true
      releaseCheck = resolve
    })
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.schedule = () => {}
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      savings: 0,
      updated_at: 1,
      previous: null
    })

    const draining = automatic.drain()
    await waitFor(() => checkStarted)
    assert.equal((await automatic.pause("demo")).paused, true)
    releaseCheck(true)
    await draining

    assert.equal(scans, 0)
    assert.equal(automatic.entries.get("demo").state, "paused")
  })

  test("the sweeper performs the only source refresh for an automatic scan", async () => {
    const home = await makeHome()
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()
    const appRoot = path.join(home, "api", "installed-later")
    await fs.promises.mkdir(appRoot, { recursive: true })
    await fs.promises.writeFile(path.join(appRoot, "model.bin"), "model")
    const refreshSources = vault.refreshSources.bind(vault)
    let refreshes = 0
    vault.refreshSources = async () => {
      refreshes += 1
      return refreshSources()
    }
    vault.automaticScans.sizeThreshold = 1

    vault.automaticScans.queueApp("installed-later")
    await waitFor(() => !vault.automaticScans.entries.has("installed-later") &&
      !vault.scanPromise && !vault.scanCompletionPromise)

    assert.equal(refreshes, 1)
    await close(vault)
  })

  test("the invisible stop settle is per app and a restart cancels only that app", async () => {
    assert.equal(AutomaticScans.STOP_SETTLE_MS, 3000)
    const home = await makeHome()
    const firstRoot = path.join(home, "api", "first-app")
    const secondRoot = path.join(home, "api", "second-app")
    const firstScript = path.join(firstRoot, "install.js")
    const secondScript = path.join(secondRoot, "install.js")
    await fs.promises.mkdir(firstRoot, { recursive: true })
    await fs.promises.mkdir(secondRoot, { recursive: true })

    const api = { running: {}, running_paths: {}, ondata() {} }
    const kernel = { homedir: home, platform: process.platform, api }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
    vault.automaticScans.stopSettleMs = 20
    vault.automaticScans.manualDepth = 1

    vault.automaticScans.handleStarted(firstScript)
    vault.automaticScans.handleStarted(secondScript)
    await vault.automaticScans.handleStopped(firstScript)
    await vault.automaticScans.handleStopped(secondScript)

    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal(vault.automaticScans.pendingStops.has("first-app"), true)
    assert.equal(vault.automaticScans.pendingStops.has("second-app"), true)

    vault.automaticScans.handleStarted(
      path.join(firstRoot, "start.js"))
    assert.equal(vault.automaticScans.pendingStops.has("first-app"), false)
    assert.equal(vault.automaticScans.pendingStops.has("second-app"), true)

    await waitFor(() => {
      const row = vault.automaticScans.entries.get("second-app")
      return row && row.state === "checking"
    })
    assert.equal(vault.automaticScans.entries.has("first-app"), false)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
    await close(vault)
  })

  test("an app deleted during settling never shows Checking", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "deleted-during-settle")
    const scriptPath = path.join(appRoot, "install.js")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const api = { running: {}, running_paths: {}, ondata() {} }
    const kernel = { homedir: home, platform: process.platform, api }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
    vault.automaticScans.stopSettleMs = 10
    vault.automaticScans.manualDepth = 1
    const snapshots = []
    const unsubscribe = vault.automaticScans.subscribe((snapshot) => {
      snapshots.push(snapshot.rows.map((row) => row.state))
    })

    vault.automaticScans.handleStarted(scriptPath)
    await vault.automaticScans.handleStopped(scriptPath)
    await fs.promises.rm(appRoot, { recursive: true, force: true })
    await waitFor(() => vault.automaticScans.pendingStops.size === 0)

    assert.equal(snapshots.some((states) => states.includes("checking")), false)
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal(vault.initialized, false)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
    unsubscribe()
    await close(vault)
  })

  test("an unmatched failed launch cannot block the next completed run", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "retry-app")
    const failedScript = path.join(appRoot, "install.js")
    const nextScript = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot, { recursive: true })

    const api = { running: {}, running_paths: {}, ondata() {} }
    const kernel = { homedir: home, platform: process.platform, api }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
    vault.automaticScans.stopSettleMs = 10
    vault.automaticScans.manualDepth = 1

    api.running.failed = true
    api.running_paths.failed = failedScript
    vault.automaticScans.handleStarted(failedScript)
    delete api.running.failed
    delete api.running_paths.failed

    api.running.next = true
    api.running_paths.next = nextScript
    vault.automaticScans.handleStarted(nextScript)
    delete api.running.next
    delete api.running_paths.next
    await vault.automaticScans.handleStopped(nextScript)

    await waitFor(() => {
      const row = vault.automaticScans.entries.get("retry-app")
      return row && row.state === "checking"
    })
    assert.equal(vault.automaticScans.observedApps.has("retry-app"), false)
    await close(vault)
  })

  test("a restart during the Pause-state lookup does not begin settling", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "lookup-race-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
    let releaseLookup
    vault.automaticScanStatus = () => new Promise((resolve) => {
      releaseLookup = resolve
    })

    vault.automaticScans.handleStarted(scriptPath)
    const stopped = vault.automaticScans.handleStopped(scriptPath)
    await waitFor(() => typeof releaseLookup === "function")
    vault.automaticScans.handleStarted(scriptPath)
    releaseLookup(vault.automaticScans.snapshot())
    await stopped

    assert.equal(vault.automaticScans.pendingStops.size, 0)
    await close(vault)
  })

  test("a completed manual scan clears covered automatic work without a notice", async () => {
    const vault = {
      enabled: true,
      initialized: false,
      scanSource(scopeId) {
        if (!scopeId || !scopeId.startsWith("app:")) return null
        return { kind: "app", app: scopeId.slice(4) }
      }
    }
    const automatic = new AutomaticScans(vault)
    let timerFired = false
    const pending = () => ({
      timer: setTimeout(() => { timerFired = true }, 20)
    })
    automatic.pendingStops.set("first-app", pending())
    automatic.pendingStops.set("second-app", pending())

    await automatic.scanFinished({
      owner: "manual",
      scopeId: "app:first-app",
      result: { outcome: "complete" }
    })
    assert.equal(automatic.pendingStops.has("first-app"), false)
    assert.equal(automatic.pendingStops.has("second-app"), true)

    await automatic.scanFinished({
      owner: "manual",
      scopeId: null,
      result: { outcome: "complete" }
    })
    assert.equal(automatic.pendingStops.size, 0)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(timerFired, false)
  })

  test("Pause persists and Resume restarts only that stopped app", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "paused-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const api = { running: {}, running_paths: {}, ondata() {} }
    const kernel = { homedir: home, platform: process.platform, api }
    const vault = new Vault(kernel)
    kernel.vault = vault
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
    vault.automaticScans.sizeThreshold = 1
    vault.automaticScans.stopSettleMs = 10

    vault.automaticScans.manualDepth = 1
    vault.automaticScans.handleStarted(scriptPath)
    await vault.automaticScans.handleStopped(scriptPath)
    assert.equal(vault.automaticScans.entries.has("paused-app"), false)
    await waitFor(() => vault.automaticScans.entries.has("paused-app"))
    assert.equal(vault.automaticScans.entries.get("paused-app").state,
      "checking")
    assert.equal(vault.scanPromise, null)

    assert.equal((await vault.perform(
      "automatic_pause", { app: "paused-app" })).paused, true)
    vault.automaticScans.afterUserWork()
    assert.equal(vault.automaticScans.entries.get("paused-app").state,
      "paused")
    assert.equal((await vault.registry.automaticAppScanStates())[0].state,
      "paused")

    vault.automaticScans.handleStarted(scriptPath)
    await vault.automaticScans.handleStopped(scriptPath)
    assert.equal(vault.automaticScans.pendingStops.has("paused-app"), false)

    assert.equal((await vault.perform(
      "automatic_resume", { app: "paused-app" })).resumed, true)
    await waitFor(() => !vault.scanPromise &&
      !vault.automaticScans.entries.has("paused-app"))
    assert.deepEqual(await vault.registry.automaticAppScanStates(), [])
    await close(vault)
  })

  test("a persisted Pause prevents settling before state is hydrated", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "restored-pause-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const firstKernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const first = new Vault(firstKernel)
    firstKernel.vault = first
    await first.init()
    await first.registry.setAutomaticAppScanState(
      "restored-pause-app", "paused", 0)
    await close(first)

    const restoredKernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const restored = new Vault(restoredKernel)
    restoredKernel.vault = restored
    restored.ready = restored.init({ deferStorage: true })
    await restored.ready
    assert.equal(restored.automaticScans.hydrated, false)

    restored.automaticScans.handleStarted(scriptPath)
    await restored.automaticScans.handleStopped(scriptPath)

    assert.equal(restored.automaticScans.hydrated, true)
    assert.equal(restored.automaticScans.pendingStops.size, 0)
    assert.equal(restored.automaticScans.entries.get(
      "restored-pause-app").state, "paused")
    await close(restored)
  })

  test("persisted state for a deleted app is discarded during hydration", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "deleted-app")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const kernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const first = new Vault(kernel)
    kernel.vault = first
    await first.init()
    await first.registry.setAutomaticAppScanState(
      "deleted-app", "result", 4096)
    await close(first)
    await fs.promises.rm(appRoot, { recursive: true, force: true })

    const restoredKernel = {
      homedir: home,
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    }
    const restored = new Vault(restoredKernel)
    restoredKernel.vault = restored
    restored.ready = restored.init({ deferStorage: true })
    await restored.ready

    assert.deepEqual((await restored.automaticScanStatus()).rows, [])
    assert.deepEqual(await restored.registry.automaticAppScanStates(), [])
    await close(restored)
  })

  test("a manual scan preempts an automatic scan and keeps its normal owner", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "priority-app")
    await fs.promises.mkdir(appRoot, { recursive: true })
    const api = { running: {}, running_paths: {}, ondata() {} }
    const kernel = { homedir: home, platform: process.platform, api }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()

    const pendingScans = []
    vault.sweeper = {
      state: { active: false, phase: "idle" },
      currentHash: null,
      idleState() {
        return { active: false, phase: "idle" }
      },
      scan(scopeId) {
        this.state = { active: true, phase: "discovering", scope_id: scopeId }
        return new Promise((resolve) => {
          pendingScans.push((outcome) => {
            this.state = {
              active: false,
              phase: outcome,
              scope_id: scopeId
            }
            resolve({ outcome, cancelled: outcome === "cancelled" })
          })
        })
      },
      cancel() {
        const finish = pendingScans.shift()
        if (finish) finish("cancelled")
        return !!finish
      }
    }

    vault.automaticScans.queueApp("priority-app")
    await waitFor(() => vault.scanOwner === "automatic")
    const manual = await vault.perform("scan", {
      scope_id: "app:priority-app",
      candidate_size: 0
    })
    assert.equal(manual.started, true)
    assert.equal(vault.scanOwner, "manual")
    assert.equal(vault.automaticScans.entries.get("priority-app").state,
      "checking")

    const finishManual = pendingScans.shift()
    assert.ok(finishManual)
    finishManual("complete")
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise)
    await close(vault)
  })

  test("existing lifecycle results are unchanged while Vault observes them", () => {
    const calls = []
    const fakeKernel = {
      readyState: {
        markStarted: () => ({ state: "running" }),
        markStopped: () => ({ state: "stopped" }),
        getAppIdForLaunchPath: () => "demo"
      },
      launchRequirements: null,
      hasLaunchRequirementRuntime:
        Kernel.prototype.hasLaunchRequirementRuntime,
      vault: {
        automaticScans: {
          handleStarted: (launchPath) => calls.push(["start", launchPath]),
          handleStopped: (launchPath) => calls.push(["stop", launchPath])
        }
      }
    }
    const launchPath = "/pinokio/api/demo/start.js"

    assert.deepEqual(
      Kernel.prototype.markAppLaunchStarted.call(fakeKernel, launchPath),
      { state: "running" })
    assert.deepEqual(
      Kernel.prototype.markAppLaunchStopped.call(
        fakeKernel, launchPath, { internal_completion: true }),
      { state: "stopped" })
    assert.deepEqual(calls, [
      ["start", launchPath],
      ["stop", launchPath]
    ])
  })
})
