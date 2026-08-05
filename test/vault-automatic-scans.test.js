const { after, beforeEach, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Database = require("better-sqlite3")
const Kernel = require("../kernel")
const Vault = require("../kernel/vault")
const AutomaticScans = require("../kernel/vault/automatic_scans")
const RegistryCore = require("../kernel/vault/registry_core")
const { SIZE_THRESHOLD } = require("../kernel/vault/constants")

const homes = []

const makeHome = async () => {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pinokio-vault-automatic-"))
  homes.push(home)
  await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
  return home
}

const makeVault = async (home, options = {}) => {
  const api = options.api || {
    running: {},
    running_paths: {},
    ondata() {}
  }
  const kernel = {
    homedir: home,
    platform: process.platform,
    api
  }
  const vault = new Vault(kernel)
  kernel.vault = vault
  if (options.deferStorage) {
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
  } else {
    await vault.init()
  }
  return vault
}

const waitFor = async (condition, message = "automatic check") => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${message}.`)
}

const close = async (vault) => {
  for (const pending of vault.automaticScans.pendingStops.values()) {
    if (pending.timer) clearTimeout(pending.timer)
  }
  if (vault.automaticScans.active && vault.automaticScans.active.promise) {
    await vault.automaticScans.active.promise.catch(() => {})
  }
  if (vault.worker) await vault.worker.terminate().catch(() => {})
  if (vault.registry) await vault.registry.close()
}

describe("automatic app checks", () => {
  beforeEach(() => {
    delete process.env.PINOKIO_VAULT
  })

  after(async () => {
    for (const home of homes) {
      await fs.promises.rm(home, { recursive: true, force: true })
        .catch(() => {})
    }
  })

  test("reading notice state does not create Vault storage", async () => {
    const home = await makeHome()
    const vault = await makeVault(home, { deferStorage: true })

    assert.deepEqual((await vault.automaticScanStatus()).rows, [])
    assert.equal(vault.initialized, false)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
    await close(vault)
  })

  test("disabled Vault ignores app-stop events", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "disabled-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(
      path.join(home, "ENVIRONMENT"), "PINOKIO_VAULT=false\n")
    const vault = await makeVault(home, { deferStorage: true })

    vault.automaticScans.handleStarted(scriptPath)
    await vault.automaticScans.handleStopped(scriptPath)

    assert.equal(vault.enabled, false)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
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

  test("settling is isolated per app and a restart cancels only that app", async () => {
    const home = await makeHome()
    const firstRoot = path.join(home, "api", "first-app")
    const secondRoot = path.join(home, "api", "second-app")
    const firstScript = path.join(firstRoot, "install.js")
    const secondScript = path.join(secondRoot, "install.js")
    await fs.promises.mkdir(firstRoot)
    await fs.promises.mkdir(secondRoot)
    const vault = await makeVault(home, { deferStorage: true })
    vault.automaticScans.stopSettleMs = 20
    vault.automaticScans.manualDepth = 1

    vault.automaticScans.handleStarted(firstScript)
    vault.automaticScans.handleStarted(secondScript)
    await vault.automaticScans.handleStopped(firstScript)
    await vault.automaticScans.handleStopped(secondScript)

    assert.equal(vault.automaticScans.pendingStops.has("first-app"), true)
    assert.equal(vault.automaticScans.pendingStops.has("second-app"), true)

    vault.automaticScans.handleStarted(path.join(firstRoot, "start.js"))
    assert.equal(vault.automaticScans.pendingStops.has("first-app"), false)
    assert.equal(vault.automaticScans.pendingStops.has("second-app"), true)

    await waitFor(() =>
      vault.automaticScans.entries.get("second-app")?.state === "checking",
    "second app to finish settling")
    assert.equal(vault.automaticScans.entries.has("first-app"), false)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
    await close(vault)
  })

  test("an unmatched failed launch cannot block a later completed run", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "retry-app")
    const failedScript = path.join(appRoot, "install.js")
    const nextScript = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    const api = { running: {}, running_paths: {}, ondata() {} }
    const vault = await makeVault(home, { api, deferStorage: true })
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

    await waitFor(() =>
      vault.automaticScans.entries.get("retry-app")?.state === "checking",
    "later completed run")
    assert.equal(vault.automaticScans.observedApps.has("retry-app"), false)
    await close(vault)
  })

  test("a restart during initial state lookup does not begin settling", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "lookup-race-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    const vault = await makeVault(home, { deferStorage: true })
    let releaseLookup
    vault.automaticScanStatus = () => new Promise((resolve) => {
      releaseLookup = resolve
    })

    vault.automaticScans.handleStarted(scriptPath)
    const stopped = vault.automaticScans.handleStopped(scriptPath)
    await waitFor(() => typeof releaseLookup === "function", "state lookup")
    vault.automaticScans.handleStarted(scriptPath)
    releaseLookup(vault.automaticScans.snapshot())
    await stopped

    assert.equal(vault.automaticScans.pendingStops.size, 0)
    await close(vault)
  })

  test("deleting an app during settling removes its automatic state", async () => {
    const home = await makeHome()
    const app = "deleted-during-settle"
    const appRoot = path.join(home, "api", app)
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    const vault = await makeVault(home)
    const signature = "a".repeat(64)
    await vault.registry.setAutomaticAppScanMode(app, "automatic")
    await vault.registry.setAutomaticAppScanState(
      app, "result", { signature })
    await vault.automaticScans.hydrate()
    vault.automaticScans.stopSettleMs = 20

    vault.automaticScans.handleStarted(scriptPath)
    await vault.automaticScans.handleStopped(scriptPath)
    await fs.promises.rm(appRoot, { recursive: true })
    await waitFor(() => !vault.automaticScans.entries.has(app) &&
      !vault.automaticScans.settings.has(app),
      "deleted app cleanup")

    assert.equal(vault.automaticScans.pendingStops.size, 0)
    assert.equal(vault.automaticScans.entries.has(app), false)
    assert.equal(vault.automaticScans.settings.has(app), false)
    assert.deepEqual(await vault.registry.automaticAppScanStates(), [])
    assert.deepEqual(await vault.registry.automaticAppScanSettings(), [])
    await close(vault)
  })

  test("an existing version-3 registry gains precheck fields safely", async () => {
    const home = await makeHome()
    const root = path.join(home, "vault")
    await fs.promises.mkdir(root)
    const databasePath = path.join(root, "registry.sqlite3")
    const database = new Database(databasePath)
    database.pragma("application_id = 0x5641554c")
    database.pragma("user_version = 3")
    database.exec(`
      CREATE TABLE automatic_app_scans (
        app TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('paused', 'result')),
        savings INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO automatic_app_scans(app, state, savings, updated_at)
      VALUES ('legacy-result', 'result', 1234, 1);
      INSERT INTO automatic_app_scans(app, state, savings, updated_at)
      VALUES ('legacy-pause', 'paused', 0, 2);
    `)
    database.close()

    const registry = new RegistryCore(root)
    await registry.load()
    const columns = registry.database.prepare(
      "PRAGMA table_info(automatic_app_scans)"
    ).all().map((row) => row.name)

    assert.ok(columns.includes("signature"))
    assert.deepEqual(registry.automaticAppScanStates(), [{
      app: "legacy-pause",
      state: "paused",
      signature: null,
      updated_at: 2
    }])
    registry.close()
  })

  test("Windows path comparison folds non-ASCII case", async () => {
    const home = await makeHome()
    const root = path.join(home, "vault")
    const platform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32"
    })
    const registry = new RegistryCore(root)
    try {
      await registry.load()
      const key = registry.database.prepare(
        "SELECT pinokio_path_key(?) AS value")
      assert.equal(
        key.get("C:\\Äpp\\MODEL.BIN").value,
        key.get("c:\\äpp\\model.bin").value
      )
      const insert = registry.database.prepare(`
        INSERT INTO automatic_precheck_files(app, path, size, dev, ino)
        VALUES (?, ?, 100, 1, ?)
      `)
      insert.run("demo", "C:\\App\\Z.bin", 1)
      insert.run("demo", "C:\\App\\a.bin", 2)
      const before = registry.automaticPrecheckResult("demo").signature
      registry.abortAutomaticPrecheck("demo")
      insert.run("demo", "C:\\App\\z.bin", 1)
      insert.run("demo", "C:\\App\\a.bin", 2)
      assert.equal(registry.automaticPrecheckResult("demo").signature, before)
    } finally {
      registry.close()
      Object.defineProperty(process, "platform", platform)
    }
  })

  test("the final app-process stop runs only a metadata precheck", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "demo")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const api = {
      running: { worker: true },
      running_paths: { worker: path.join(appRoot, "worker.js") },
      ondata() {}
    }
    const vault = await makeVault(home, { api, deferStorage: true })
    vault.automaticScans.sizeThreshold = 1
    vault.automaticScans.stopSettleMs = 10
    vault.refreshAnchorStores = async () => {
      throw new Error("The automatic check must not inspect anchor stores.")
    }
    vault.refreshSources = async () => {
      throw new Error("The automatic check must not refresh scan locations.")
    }
    vault.hashFile = async () => {
      throw new Error("The automatic check must not hash files.")
    }

    vault.automaticScans.handleStarted(scriptPath)
    vault.automaticScans.handleStarted(api.running_paths.worker)
    await vault.automaticScans.handleStopped(scriptPath)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)

    delete api.running.worker
    delete api.running_paths.worker
    await vault.automaticScans.handleStopped(path.join(appRoot, "worker.js"))
    await waitFor(() => {
      const row = vault.automaticScans.entries.get("demo")
      return !vault.automaticScans.active && row && row.state === "result"
    })

    assert.deepEqual(vault.automaticScans.snapshot().rows.map((row) => ({
      app: row.app,
      state: row.state
    })), [{ app: "demo", state: "result" }])
    assert.equal(vault.scanPromise, null)
    assert.equal(vault.initialized, false)
    assert.equal(vault.sweeper, null)
    assert.equal(await vault.registry.scanFor("app:demo"), null)
    assert.deepEqual(await vault.registry.files({ sourceIds: ["app:demo"] }), [])
    await close(vault)

    const restored = await makeVault(home, { deferStorage: true })
    const restoredStatus = await restored.automaticScanStatus()
    assert.equal(restoredStatus.rows[0].state, "result")
    assert.equal(restored.initialized, false)
    assert.equal(restored.sweeper, null)
    const reviewed = await restored.perform("automatic_review", { app: "demo" })
    assert.equal(new URL(reviewed.href, "http://localhost").pathname, "/v/demo")
    assert.equal(restored.initialized, false)
    assert.deepEqual((await restored.automaticScanStatus()).rows, [])
    await close(restored)
  })

  test("an app removed during its active check loses automatic state", async () => {
    const home = await makeHome()
    const app = "deleted-during-check"
    const appRoot = path.join(home, "api", app)
    await fs.promises.mkdir(appRoot)
    const vault = await makeVault(home)
    const signature = "a".repeat(64)
    await vault.registry.setAutomaticAppScanMode(app, "automatic")
    await vault.registry.setAutomaticAppScanState(
      app, "result", { signature })
    await vault.automaticScans.hydrate()
    vault.scanner.walk = async () => {
      await fs.promises.rm(appRoot, { recursive: true })
    }

    vault.automaticScans.queueApp(app)
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has(app), "active app deletion")

    assert.equal(vault.automaticScans.settings.has(app), false)
    assert.deepEqual(await vault.registry.automaticAppScanStates(), [])
    assert.deepEqual(await vault.registry.automaticAppScanSettings(), [])
    await close(vault)
  })

  test("the fixed threshold excludes smaller files", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "threshold-app")
    await fs.promises.mkdir(appRoot)
    const below = SIZE_THRESHOLD - 1
    for (const name of ["first.bin", "second.bin"]) {
      const handle = await fs.promises.open(path.join(appRoot, name), "w")
      await handle.truncate(below)
      await handle.close()
    }
    const vault = await makeVault(home)

    vault.automaticScans.queueApp("threshold-app")
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("threshold-app"))

    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal(await vault.registry.scanFor("app:threshold-app"), null)
    await close(vault)
  })

  test("published file metadata can be a peer without reading the peer path", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "sqlite-peer-app")
    const candidate = path.join(appRoot, "candidate.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-size")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    assert.equal(vault.initialized, false)
    vault.automaticScans.sizeThreshold = 1
    const stat = await fs.promises.lstat(candidate)
    const missingPeer = path.join(home, "peer-does-not-exist.bin")
    await vault.registry.upsertFile({
      path: missingPeer,
      hash: null,
      size: stat.size,
      mtime: 1,
      ctime: 1,
      dev: stat.dev,
      ino: stat.ino + 1000,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid,
      source_id: "app:peer",
      app: "peer",
      status: "reference",
      unavailable_reason: null,
      updated_at: Date.now()
    })

    vault.automaticScans.queueApp("sqlite-peer-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("sqlite-peer-app")?.state === "result")

    assert.equal(fs.existsSync(missingPeer), false)
    assert.equal(vault.automaticScans.snapshot().rows[0].state, "result")
    await close(vault)
  })

  test("stale file rows and known identical inodes are not peers", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "no-peer-app")
    const candidate = path.join(appRoot, "candidate.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-size")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    assert.equal(vault.initialized, false)
    vault.automaticScans.sizeThreshold = 1
    const stat = await fs.promises.lstat(candidate)
    const base = {
      hash: null,
      size: stat.size,
      mtime: 1,
      ctime: 1,
      dev: stat.dev,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid,
      source_id: "app:peer",
      app: "peer",
      status: "reference",
      updated_at: Date.now()
    }
    await vault.registry.upsertFile(Object.assign({}, base, {
      path: path.join(home, "stale-peer.bin"),
      ino: stat.ino + 1,
      unavailable_reason: "stale"
    }))
    await vault.registry.upsertFile(Object.assign({}, base, {
      path: path.join(home, "same-inode-peer.bin"),
      ino: stat.ino,
      unavailable_reason: null
    }))

    vault.automaticScans.queueApp("no-peer-app")
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("no-peer-app"))

    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("a current verified store record can be a metadata peer", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "store-peer-app")
    const candidate = path.join(appRoot, "candidate.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-size")
    const vault = await makeVault(home)
    vault.automaticScans.sizeThreshold = 1
    const stat = await fs.promises.lstat(candidate)
    const hash = "1".repeat(64)
    await vault.registry.upsertContent({
      hash,
      size: stat.size,
      first_seen: Date.now(),
      verified_at: Date.now(),
      anchor_present: true
    })
    await vault.registry.upsertAnchor({
      store_id: "metadata-only-store",
      hash,
      path: path.join(home, "missing-anchor.bin"),
      verified_at: Date.now(),
      dev: stat.dev,
      ino: stat.ino + 1000,
      size: stat.size,
      mtime: 1,
      ctime: 1,
      nlink: 1,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid
    })

    vault.automaticScans.queueApp("store-peer-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("store-peer-app")?.state === "result")

    assert.equal(vault.automaticScans.snapshot().rows[0].state, "result")
    await close(vault)
  })

  test("dismissal is remembered until the possible-match set changes", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "dismissed-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const vault = await makeVault(home)
    vault.automaticScans.sizeThreshold = 1

    vault.automaticScans.queueApp("dismissed-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("dismissed-app")?.state === "result")
    await vault.perform("automatic_dismiss", { app: "dismissed-app" })
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])

    vault.automaticScans.queueApp("dismissed-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("dismissed-app")?.state === "result")
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])

    await fs.promises.writeFile(path.join(appRoot, "third.bin"), "cccc")
    const previousSignature = vault.automaticScans.entries.get(
      "dismissed-app").signature
    vault.automaticScans.queueApp("dismissed-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("dismissed-app")?.state === "result" &&
      vault.automaticScans.entries.get("dismissed-app")?.signature !==
        previousSignature)
    assert.equal(vault.automaticScans.snapshot().rows[0].state, "result")
    await close(vault)
  })

  test("an empty replacement clears the result and its acknowledgement", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "empty-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const vault = await makeVault(home)
    vault.automaticScans.sizeThreshold = 1

    vault.automaticScans.queueApp("empty-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("empty-app")?.state === "result")
    await vault.perform("automatic_dismiss", { app: "empty-app" })
    await fs.promises.unlink(path.join(appRoot, "second.bin"))
    vault.automaticScans.queueApp("empty-app")
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("empty-app"))

    const setting = (await vault.registry.automaticAppScanSettings())
      .find((row) => row.app === "empty-app")
    assert.equal(setting.acknowledged_signature, null)
    await close(vault)
  })

  test("an app restart cancels an active check and restores the prior notice", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "restart-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const vault = await makeVault(home)
    vault.automaticScans.sizeThreshold = 1
    vault.automaticScans.queueApp("restart-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("restart-app")?.state === "result")
    const previous = vault.automaticScans.entries.get("restart-app")

    let release
    let began
    const beganPromise = new Promise((resolve) => { began = resolve })
    const originalWalk = vault.scanner.walk.bind(vault.scanner)
    vault.scanner.walk = async (_root, options) => {
      began()
      await new Promise((resolve) => { release = resolve })
      options.checkpoint()
    }
    vault.automaticScans.queueApp("restart-app")
    await beganPromise
    vault.automaticScans.handleStarted(scriptPath)
    release()
    await waitFor(() => !vault.automaticScans.active)
    vault.scanner.walk = originalWalk

    const restored = vault.automaticScans.entries.get("restart-app")
    assert.equal(restored.state, "result")
    assert.equal(restored.signature, previous.signature)
    await close(vault)
  })

  test("an app restart during result publication restores persisted state", async () => {
    const previousSignature = "a".repeat(64)
    const replacementSignature = "b".repeat(64)
    let releaseWrite
    let writeStarted
    const writeStart = new Promise((resolve) => { writeStarted = resolve })
    const writeWait = new Promise((resolve) => { releaseWrite = resolve })
    const writes = []
    const automatic = new AutomaticScans({
      enabled: true,
      registry: {
        setAutomaticAppScanState: async (_app, state, options) => {
          writes.push({ state, options: Object.assign({}, options) })
          if (writes.length === 1) {
            writeStarted()
            await writeWait
          }
          return { updated_at: writes.length + 2 }
        }
      }
    })
    automatic.log = () => {}
    automatic.broadcast = () => {}
    automatic.schedule = () => {}
    automatic.settings.set("demo", {
      mode: "automatic",
      acknowledged_signature: previousSignature,
      updated_at: 1
    })
    const previous = {
      app: "demo",
      state: "result",
      signature: previousSignature,
      updated_at: 1,
      previous: null,
      hidden: true
    }
    const checking = {
      app: "demo",
      state: "checking",
      updated_at: 2,
      previous,
      hidden: false
    }
    const active = {
      app: "demo",
      cancelled: false,
      reason: null,
      promise: null
    }
    automatic.entries.set("demo", checking)
    automatic.active = active

    const finishing = automatic.precheckFinished(active, {
      signature: replacementSignature,
      possible_files: 1
    }, null)
    await writeStart
    assert.equal(automatic.cancelActive("demo", "app-started"), true)
    releaseWrite()
    await finishing

    assert.deepEqual(writes, [
      {
        state: "result",
        options: {
          signature: replacementSignature,
          acknowledged_signature: null
        }
      },
      {
        state: "result",
        options: {
          signature: previousSignature,
          acknowledged_signature: previousSignature
        }
      }
    ])
    assert.equal(automatic.entries.get("demo").signature, previousSignature)
    assert.equal(automatic.entries.get("demo").hidden, true)
    assert.equal(automatic.settings.get("demo").acknowledged_signature,
      previousSignature)
    assert.equal(automatic.active, null)
  })

  test("user work during result publication restarts the automatic check", async () => {
    let releaseWrite
    let writeStarted
    const writeStart = new Promise((resolve) => { writeStarted = resolve })
    const writeWait = new Promise((resolve) => { releaseWrite = resolve })
    const writes = []
    const automatic = new AutomaticScans({
      enabled: true,
      registry: {
        setAutomaticAppScanState: async (_app, state, options) => {
          writes.push({ state, options: Object.assign({}, options) })
          if (writes.length === 1) {
            writeStarted()
            await writeWait
          }
          return { updated_at: writes.length + 2 }
        }
      }
    })
    automatic.log = () => {}
    automatic.broadcast = () => {}
    automatic.schedule = () => {}
    const checking = {
      app: "demo",
      state: "checking",
      updated_at: 1,
      previous: null,
      hidden: false
    }
    const active = {
      app: "demo",
      cancelled: false,
      reason: null,
      promise: null
    }
    automatic.entries.set("demo", checking)
    automatic.active = active
    const finishing = automatic.precheckFinished(active, {
      signature: "b".repeat(64),
      possible_files: 1
    }, null)
    active.promise = finishing

    await writeStart
    const userWork = automatic.beforeUserWork()
    releaseWrite()
    await userWork

    assert.deepEqual(writes, [
      { state: "result", options: { signature: "b".repeat(64) } },
      { state: null, options: {} }
    ])
    assert.equal(automatic.entries.get("demo"), checking)
    assert.equal(automatic.entries.get("demo").state, "checking")
    assert.equal(automatic.manualDepth, 1)
    assert.equal(automatic.active, null)
    automatic.afterUserWork()
    assert.equal(automatic.manualDepth, 0)
  })

  test("a fatal precheck error restores the prior possible-match notice", async () => {
    const automatic = new AutomaticScans({ enabled: true })
    const previous = {
      app: "demo",
      state: "result",
      signature: "a".repeat(64),
      updated_at: 1,
      previous: null,
      hidden: false
    }
    const active = {
      app: "demo",
      cancelled: false,
      reason: null,
      promise: null
    }
    automatic.active = active
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      updated_at: 2,
      previous,
      hidden: false
    })
    automatic.log = () => {}
    automatic.broadcast = () => {}
    automatic.schedule = () => {}

    await automatic.precheckFinished(active, null, new Error("failed"))

    assert.equal(automatic.active, null)
    assert.equal(automatic.entries.get("demo").signature, previous.signature)
  })

  test("a failed Pause leaves the active check unchanged", async () => {
    const automatic = new AutomaticScans({
      enabled: true,
      registry: {
        setAutomaticAppScanMode: async () => {
          throw new Error("database failed")
        }
      }
    })
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.active = {
      app: "demo",
      cancelled: false,
      reason: null,
      promise: null
    }
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      updated_at: 1,
      previous: null,
      hidden: false
    })

    await assert.rejects(() => automatic.pause("demo"), /database failed/)

    assert.equal(automatic.active.cancelled, false)
    assert.equal(automatic.entries.get("demo").state, "checking")
  })

  test("a failed Resume preserves Manual mode and its paused notice", async () => {
    const automatic = new AutomaticScans({
      enabled: true,
      registry: {
        setAutomaticAppScanMode: async () => {
          throw new Error("database failed")
        }
      }
    })
    automatic.appRootIsAvailable = async () => true
    automatic.hydrated = true
    automatic.settings.set("demo", {
      mode: "manual",
      acknowledged_signature: null,
      updated_at: 1
    })
    automatic.entries.set("demo", {
      app: "demo",
      state: "paused",
      updated_at: 1,
      previous: null,
      hidden: false
    })

    await assert.rejects(() => automatic.resume("demo"), /database failed/)

    assert.equal(automatic.modeFor("demo"), "manual")
    assert.equal(automatic.entries.get("demo").state, "paused")
  })

  test("a stale checking action cannot dismiss its replacement result", async () => {
    const acknowledgements = []
    const automatic = new AutomaticScans({
      enabled: true,
      registry: {
        setAutomaticAppScanState: async () => ({ updated_at: 2 }),
        setAutomaticAppScanAcknowledgement: async (_app, signature) => {
          acknowledgements.push(signature)
          return { acknowledged_signature: signature, updated_at: 3 }
        }
      }
    })
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      updated_at: 1,
      previous: null,
      hidden: false
    })
    const checkingNotice = automatic.snapshot().rows[0].notice_id
    await automatic.publishResultNow("demo", {
      signature: "b".repeat(64),
      possible_files: 1
    })

    assert.deepEqual(await automatic.dismiss("demo", checkingNotice), {
      stale: true,
      app: "demo"
    })
    assert.equal(automatic.snapshot().rows[0].state, "result")
    assert.deepEqual(acknowledgements, [])
  })

  test("user-started work preempts an automatic check and keeps priority", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "priority-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    assert.equal(vault.initialized, false)
    vault.automaticScans.sizeThreshold = 1
    let release
    let began
    const beganPromise = new Promise((resolve) => { began = resolve })
    const originalWalk = vault.scanner.walk.bind(vault.scanner)
    vault.scanner.walk = async (_root, options) => {
      began()
      await new Promise((resolve) => { release = resolve })
      options.checkpoint()
    }

    vault.automaticScans.queueApp("priority-app")
    await beganPromise
    const manual = vault.perform("scan", {
      scope_id: "app:priority-app",
      candidate_size: 0
    })
    await waitFor(() => vault.automaticScans.active?.cancelled === true,
      "user work to preempt the automatic check")
    vault.scanner.walk = originalWalk
    release()

    assert.equal((await manual).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise,
      "manual scan")
    assert.ok(await vault.registry.scanFor("app:priority-app"))
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("Pause cancels checking, persists Manual mode, and Resume rechecks", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "paused-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    vault.automaticScans.sizeThreshold = 1
    let release
    let began
    const beganPromise = new Promise((resolve) => { began = resolve })
    const originalWalk = vault.scanner.walk.bind(vault.scanner)
    vault.scanner.walk = async (_root, options) => {
      began()
      await new Promise((resolve) => { release = resolve })
      options.checkpoint()
    }

    vault.automaticScans.queueApp("paused-app")
    await beganPromise
    assert.deepEqual(await vault.perform("automatic_pause", {
      app: "paused-app"
    }), { paused: true, app: "paused-app", mode: "manual" })
    release()
    await waitFor(() => !vault.automaticScans.active)
    assert.equal(vault.automaticScans.snapshot().rows[0].state, "paused")
    assert.equal(vault.automaticScans.modeFor("paused-app"), "manual")
    assert.equal(vault.initialized, false)

    await vault.perform("automatic_dismiss", { app: "paused-app" })
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal(vault.automaticScans.modeFor("paused-app"), "manual")

    vault.scanner.walk = originalWalk
    await vault.perform("automatic_resume", { app: "paused-app" })
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("paused-app")?.state === "result")
    assert.equal(vault.automaticScans.modeFor("paused-app"), "automatic")
    assert.equal(vault.initialized, false)
    await close(vault)
  })

  test("a completed manual app scan clears the possible-match notice", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "manual-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "bbbb")
    const vault = await makeVault(home)
    vault.automaticScans.sizeThreshold = 1
    vault.automaticScans.queueApp("manual-app")
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("manual-app")?.state === "result")

    assert.equal((await vault.perform("scan", {
      scope_id: "app:manual-app",
      candidate_size: 0
    })).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise,
      "manual scan")

    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.ok(await vault.registry.scanFor("app:manual-app"))
    await close(vault)
  })

  test("completed scans clear only their covered automatic work", async () => {
    const vault = {
      enabled: true,
      registry: {
        setAutomaticAppScanState: async () => ({ updated_at: 1 })
      },
      scanSource(scopeId) {
        if (!scopeId || !scopeId.startsWith("app:")) return null
        return { kind: "app", app: scopeId.slice(4) }
      }
    }
    const automatic = new AutomaticScans(vault)
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.broadcast = () => {}
    automatic.schedule = () => {}
    for (const app of ["first-app", "second-app"]) {
      automatic.entries.set(app, {
        app,
        state: "checking",
        updated_at: 1,
        previous: null,
        hidden: false
      })
      automatic.pendingStops.set(app, {
        timer: setTimeout(() => {}, 10000)
      })
    }

    await automatic.scanFinished({
      scopeId: "app:first-app",
      result: { outcome: "complete" }
    })
    assert.deepEqual([...automatic.entries.keys()], ["second-app"])
    assert.deepEqual([...automatic.pendingStops.keys()], ["second-app"])

    await automatic.scanFinished({
      scopeId: null,
      result: { outcome: "complete" }
    })
    assert.equal(automatic.entries.size, 0)
    assert.equal(automatic.pendingStops.size, 0)
  })

  test("a file action clears only notices for affected apps", async () => {
    const writes = []
    const vault = {
      enabled: true,
      registry: {
        appsForHashes: async (hashes) => {
          assert.deepEqual(hashes, ["changed-hash"])
          return ["action-app", "peer-app", "checking-app"]
        },
        setAutomaticAppScanState: async (app, state) => {
          writes.push({ app, state })
          return { updated_at: 1 }
        },
        setAutomaticAppScanAcknowledgement: async (_app, signature) => {
          writes.push({ app: "checking-app", acknowledgement: signature })
          return { updated_at: 1 }
        }
      },
      fileActionCancelRequested: false,
      fileActionProgress: null
    }
    const automatic = new AutomaticScans(vault)
    vault.automaticScans = automatic
    automatic.hydrated = true
    automatic.log = () => {}
    automatic.broadcast = () => {}
    for (const app of ["action-app", "peer-app", "other-app"]) {
      automatic.entries.set(app, {
        app,
        state: "result",
        signature: "a".repeat(64),
        updated_at: 1,
        previous: null,
        hidden: false
      })
    }
    automatic.entries.set("checking-app", {
      app: "checking-app",
      state: "checking",
      updated_at: 1,
      previous: null,
      hidden: false
    })
    automatic.settings.set("checking-app", {
      mode: "automatic",
      acknowledged_signature: "b".repeat(64),
      updated_at: 1
    })

    const result = await Vault.prototype.runFileAction.call(
      vault,
      { kind: "test" },
      async (_progress, changedHashes) => {
        changedHashes.add("changed-hash")
        return { complete: true }
      }
    )

    assert.deepEqual(result, { complete: true })
    assert.deepEqual(writes, [
      { app: "action-app", state: null },
      { app: "peer-app", state: null },
      { app: "checking-app", acknowledgement: null }
    ])
    assert.deepEqual([...automatic.entries.keys()], [
      "other-app", "checking-app"
    ])
    assert.equal(automatic.settings.get(
      "checking-app").acknowledged_signature, null)
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
    const vault = new Vault({
      homedir: "/pinokio",
      platform: process.platform,
      api: { running: {}, running_paths: {}, ondata() {} }
    })
    vault.convert = async () => ({
      status: "already",
      hash: "a".repeat(64)
    })
    const changedHashes = new Set()

    assert.equal((await vault.deduplicateFile(
      "/pinokio/api/demo/model.bin", changedHashes)).status, "already")
    assert.deepEqual([...changedHashes], ["a".repeat(64)])
  })

  test("Manual mode persists and prevents later automatic checks", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "manual-mode-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    const first = await makeVault(home)
    assert.deepEqual(await first.perform("automatic_set_mode", {
      app: "../outside",
      mode: "manual"
    }), { error: "That app is no longer available." })
    assert.deepEqual(await first.perform("automatic_settings", {
      app: "../outside"
    }), { error: "That app is no longer available." })
    assert.deepEqual(await first.perform("automatic_set_mode", {
      app: "manual-mode-app",
      mode: "manual"
    }), { app: "manual-mode-app", mode: "manual" })
    await close(first)

    const restored = await makeVault(home, { deferStorage: true })
    assert.equal((await restored.automaticScanStatus()).settings[0].mode,
      "manual")
    restored.automaticScans.handleStarted(scriptPath)
    await restored.automaticScans.handleStopped(scriptPath)
    assert.equal(restored.automaticScans.pendingStops.size, 0)
    assert.deepEqual(restored.automaticScans.snapshot().rows, [])
    await close(restored)
  })

  test("persisted state for a deleted app is removed during hydration", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "deleted-app")
    await fs.promises.mkdir(appRoot)
    const first = await makeVault(home)
    await first.registry.setAutomaticAppScanMode("deleted-app", "manual", true)
    await close(first)
    await fs.promises.rm(appRoot, { recursive: true })

    const restored = await makeVault(home, { deferStorage: true })
    assert.deepEqual((await restored.automaticScanStatus()).rows, [])
    assert.deepEqual(await restored.registry.automaticAppScanStates(), [])
    assert.deepEqual(await restored.registry.automaticAppScanSettings(), [])
    await close(restored)
  })

  test("Vault observation preserves existing lifecycle return values", () => {
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
