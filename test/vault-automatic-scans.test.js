const { after, beforeEach, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
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
    platform: options.platform || "darwin",
    api,
    automaticWatcher: options.automaticWatcher || {
      subscribe: async () => ({ unsubscribe: async () => {} })
    }
  }
  const vault = new Vault(kernel)
  kernel.vault = vault
  if (options.deferStorage) {
    vault.ready = vault.init({ deferStorage: true })
    await vault.ready
  } else {
    await vault.init()
  }
  const globalScanReady = options.globalScanReady !== undefined
    ? !!options.globalScanReady
    : true
  vault.globalScanReady = async () => globalScanReady
  vault.automaticScans.globalScanReady = globalScanReady
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
  await vault.automaticScans.stopWatcher().catch(() => {})
  if (vault.worker) await vault.worker.terminate().catch(() => {})
  if (vault.registry) await vault.registry.close()
}

const collect = (vault, app, paths) => {
  const collected = new Set((paths || []).map((filePath) =>
    path.resolve(filePath)))
  vault.automaticScans.changedPaths.set(app, collected)
  return collected
}

const makeAutomatic = (vault = {}) => {
  vault.kernel = Object.assign({ platform: "darwin" }, vault.kernel)
  return new AutomaticScans(vault)
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

  test("reading automatic result state does not create Vault storage", async () => {
    const home = await makeHome()
    const vault = await makeVault(home, {
      deferStorage: true,
      globalScanReady: false
    })

    const status = await vault.automaticScanStatus()
    assert.equal(status.global_scan_ready, false)
    assert.deepEqual(status.rows, [])
    assert.equal(vault.initialized, false)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
    await close(vault)
  })

  test("missing readiness state keeps automatic checks locked", async () => {
    const automatic = makeAutomatic({ enabled: true })

    await automatic.refreshGlobalScanReady()

    assert.equal(automatic.globalScanReady, false)
    assert.deepEqual(automatic.snapshot().rows, [])
  })

  test("only verified-match results are public while a check runs", () => {
    const automatic = makeAutomatic({ enabled: true })
    automatic.globalScanReady = true
    automatic.entries.set("new-app", {
      app: "new-app",
      state: "checking",
      updated_at: 2,
      previous: null,
      hidden: false
    })
    const previous = {
      app: "known-app",
      state: "result",
      signature: "a".repeat(64),
      updated_at: 1,
      previous: null,
      hidden: false
    }
    automatic.entries.set("known-app", {
      app: "known-app",
      state: "checking",
      updated_at: 3,
      previous,
      hidden: false
    })

    assert.deepEqual(automatic.snapshot().rows, [{
      app: "known-app",
      state: "result",
      signature: "a".repeat(64)
    }])
  })

  test("republishing the same result keeps its public identity", async () => {
    const automatic = makeAutomatic({
      enabled: true,
      registry: {
        setAutomaticAppScanState: async () => ({ updated_at: 2 })
      }
    })
    automatic.globalScanReady = true
    automatic.hydrated = true
    automatic.log = () => {}
    const signature = "a".repeat(64)
    automatic.entries.set("demo", {
      app: "demo",
      state: "result",
      signature,
      updated_at: 1,
      previous: null,
      hidden: false
    })

    await automatic.publishResultNow("demo", {
      signature,
      verified_files: 1
    })

    assert.deepEqual(automatic.snapshot().rows, [{
      app: "demo",
      state: "result",
      signature
    }])
  })

  test("automatic checks wait two seconds after an app stops", () => {
    assert.equal(AutomaticScans.STOP_SETTLE_MS, 2000)
  })

  test("one API watcher collects only paths changed while an app runs", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "watched-app")
    const scriptPath = path.join(appRoot, "start.js")
    const changedPath = path.join(appRoot, "model.bin")
    await fs.promises.mkdir(appRoot)
    let callback = null
    let subscriptions = 0
    const vault = await makeVault(home, {
      deferStorage: true,
      automaticWatcher: {
        subscribe: async (root, listener) => {
          assert.equal(root, path.join(home, "api"))
          subscriptions += 1
          callback = listener
          return { unsubscribe: async () => {} }
        }
      }
    })

    assert.equal(await vault.automaticScans.startWatcher(), true)
    assert.equal(await vault.automaticScans.startWatcher(), false)
    assert.equal(subscriptions, 1)
    callback(null, [{ type: "update", path: changedPath }])
    assert.equal(vault.automaticScans.changedPaths.size, 0)

    vault.automaticScans.handleStarted(scriptPath)
    callback(null, [
      { type: "update", path: changedPath },
      { type: "update", path: path.join(home, "api", "other", "x.bin") }
    ])
    assert.deepEqual([...vault.automaticScans.changedPaths.get(
      "watched-app")], [changedPath])
    assert.equal(vault.registry, null)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
    await close(vault)
  })

  test("disposing automatic checks releases the watcher and pending work", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "disposed-app")
    const scriptPath = path.join(appRoot, "start.js")
    const changedPath = path.join(appRoot, "model.bin")
    await fs.promises.mkdir(appRoot)
    let callback = null
    let subscriptions = 0
    let unsubscriptions = 0
    let streamClosures = 0
    let lateSnapshots = 0
    const vault = await makeVault(home, {
      deferStorage: true,
      automaticWatcher: {
        subscribe: async (_root, listener) => {
          subscriptions += 1
          callback = listener
          return {
            unsubscribe: async () => { unsubscriptions += 1 }
          }
        }
      }
    })

    assert.equal(await vault.automaticScans.startWatcher(), true)
    vault.automaticScans.handleStarted(scriptPath)
    callback(null, [{ type: "update", path: changedPath }])
    vault.automaticScans.scheduleStoppedApp("disposed-app", 60_000)
    vault.automaticScans.subscribe(() => {}, () => { streamClosures += 1 })
    assert.equal(vault.automaticScans.pendingStops.size, 1)

    await vault.automaticScans.dispose()
    callback(null, [{ type: "update", path: changedPath }])
    vault.automaticScans.subscribe(
      () => { lateSnapshots += 1 },
      () => { streamClosures += 1 }
    )

    assert.equal(subscriptions, 1)
    assert.equal(unsubscriptions, 1)
    assert.equal(streamClosures, 2)
    assert.equal(lateSnapshots, 0)
    assert.equal(await vault.automaticScans.startWatcher(), false)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
    assert.equal(vault.automaticScans.observedApps.size, 0)
    assert.equal(vault.automaticScans.changedPaths.size, 0)
    await close(vault)
  })

  test("disposal waits for an in-flight lifecycle callback", async () => {
    const home = await makeHome()
    const vault = await makeVault(home, { deferStorage: true })
    let release
    let disposed = false
    vault.automaticScans.handleStoppedNow = () => new Promise((resolve) => {
      release = resolve
    })

    const stopping = vault.automaticScans.handleStopped(
      path.join(home, "api", "demo", "start.js"))
    const disposing = vault.automaticScans.dispose().then(() => {
      disposed = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(disposed, false)
    release()
    await Promise.all([stopping, disposing])
    assert.equal(disposed, true)
    await close(vault)
  })

  test("disposal stops a drain waiting for readiness", async () => {
    let release
    let waiting = false
    let appRootChecks = 0
    let checksStarted = 0
    const automatic = makeAutomatic({
      enabled: true,
      registry: {},
      runExclusive: async () => { checksStarted += 1 }
    })
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      paths: []
    })
    automatic.refreshGlobalScanReady = async () => {
      waiting = true
      await new Promise((resolve) => { release = resolve })
      automatic.globalScanReady = true
    }
    automatic.appRootIsAvailable = async () => {
      appRootChecks += 1
      return true
    }

    automatic.schedule()
    await waitFor(() => waiting, "readiness pause")
    let disposed = false
    const disposing = automatic.dispose().then(() => { disposed = true })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(disposed, false)
    release()
    await disposing
    assert.equal(appRootChecks, 0)
    assert.equal(checksStarted, 0)
  })

  test("disposal stops a drain waiting for the app root", async () => {
    let release
    let waiting = false
    let checksStarted = 0
    const automatic = makeAutomatic({
      enabled: true,
      registry: {},
      runExclusive: async () => { checksStarted += 1 }
    })
    automatic.entries.set("demo", {
      app: "demo",
      state: "checking",
      paths: []
    })
    automatic.globalScanReady = true
    automatic.refreshGlobalScanReady = async () => {}
    automatic.appRootIsAvailable = async () => {
      waiting = true
      return new Promise((resolve) => { release = () => resolve(true) })
    }

    automatic.schedule()
    await waitFor(() => waiting, "app-root pause")
    const disposing = automatic.dispose()
    release()
    await disposing

    assert.equal(checksStarted, 0)
  })

  test("Linux starts no watcher and ignores automatic lifecycle work", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "linux-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    let subscriptions = 0
    const vault = await makeVault(home, {
      deferStorage: true,
      platform: "linux",
      automaticWatcher: {
        subscribe: async () => {
          subscriptions += 1
          return { unsubscribe: async () => {} }
        }
      }
    })

    assert.equal(await vault.automaticScans.startWatcher(), false)
    vault.automaticScans.handleStarted(scriptPath)
    assert.equal(vault.automaticScans.recordChangedPath(
      path.join(appRoot, "model.bin")), false)
    await vault.automaticScans.handleStopped(scriptPath)
    assert.equal(subscriptions, 0)
    assert.equal(vault.automaticScans.observedApps.size, 0)
    assert.equal(vault.automaticScans.changedPaths.size, 0)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
    assert.match((await vault.perform("automatic_set_mode", {
      app: "linux-app",
      mode: "automatic"
    })).error, /unavailable/i)
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
      globalScanReady: async () => true,
      automaticScanStatus: async () => ({ rows: [] })
    }
    const automatic = makeAutomatic(vault)
    let settledApp = null
    automatic.appRootIsAvailable = async () => true
    automatic.scheduleStoppedApp = (app) => { settledApp = app }

    const started = automatic.handleStarted("/pinokio/api/demo/start.js")
    automatic.changedPaths.set("demo", new Set([
      "/pinokio/api/demo/model.bin"
    ]))
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
    vault.automaticScans.recordChangedPath(path.join(firstRoot, "model.bin"))
    vault.automaticScans.recordChangedPath(path.join(secondRoot, "model.bin"))
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
    vault.automaticScans.recordChangedPath(path.join(appRoot, "model.bin"))
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
    vault.automaticScans.recordChangedPath(path.join(appRoot, "model.bin"))
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
    vault.automaticScans.recordChangedPath(path.join(appRoot, "model.bin"))
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

  test("a deleted app with no collected paths loses automatic state", async () => {
    const home = await makeHome()
    const app = "deleted-without-paths"
    const appRoot = path.join(home, "api", app)
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    const vault = await makeVault(home)
    const signature = "a".repeat(64)
    await vault.registry.setAutomaticAppScanMode(app, "automatic")
    await vault.registry.setAutomaticAppScanState(
      app, "result", { signature })
    await vault.automaticScans.hydrate()

    vault.automaticScans.handleStarted(scriptPath)
    assert.equal(vault.automaticScans.recordChangedPath(appRoot), false)
    await fs.promises.rm(appRoot, { recursive: true })
    await vault.automaticScans.handleStopped(scriptPath)

    assert.equal(vault.automaticScans.pendingStops.size, 0)
    assert.equal(vault.automaticScans.entries.has(app), false)
    assert.equal(vault.automaticScans.settings.has(app), false)
    assert.deepEqual(await vault.registry.automaticAppScanStates(), [])
    assert.deepEqual(await vault.registry.automaticAppScanSettings(), [])
    await close(vault)
  })

  test("an existing version-3 registry gains verification storage safely", async () => {
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
    assert.equal(!!registry.database.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'hash_cache'
    `).get(), true)
    const hashCacheIndexes = registry.database.prepare(
      "PRAGMA index_list(hash_cache)"
    ).all().map((row) => row.name)
    assert.ok(hashCacheIndexes.includes("hash_cache_updated_idx"))
    assert.deepEqual(registry.automaticAppScanStates(), [{
      app: "legacy-pause",
      state: "paused",
      signature: null,
      updated_at: 2
    }])
    registry.close()
  })

  test("the reusable hash cache evicts entries beyond its fixed bound", async () => {
    const home = await makeHome()
    const root = path.join(home, "vault")
    const registry = new RegistryCore(root)
    await registry.load()
    const hash = "a".repeat(64)
    registry.database.exec(`
      WITH RECURSIVE cached(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM cached WHERE value < 100001
      )
      INSERT INTO hash_cache(
        path, hash, size, mtime, ctime, dev, ino, updated_at
      )
      SELECT
        '/cached/' || printf('%06d', value),
        '${hash}', 1, 1, 1, 1, value, value
      FROM cached
    `)
    const latest = path.join(home, "latest.bin")

    const result = registry.rememberHashCache([{
      path: latest,
      hash,
      size: 1,
      mtime: 1,
      ctime: 1,
      dev: 1,
      ino: 100002
    }])

    assert.equal(result.pruned, 2)
    assert.equal(registry.database.prepare(
      "SELECT COUNT(*) AS count FROM hash_cache"
    ).get().count, 100000)
    assert.equal(registry.database.prepare(
      "SELECT 1 FROM hash_cache WHERE path = ?"
    ).get("/cached/000001"), undefined)
    assert.equal(!!registry.database.prepare(
      "SELECT 1 FROM hash_cache WHERE path = ?"
    ).get(latest), true)
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
      const hash = "a".repeat(64)
      const before = registry.automaticPrecheckResult("demo", [{
        path: "C:\\App\\Z.bin",
        hash
      }]).signature
      registry.abortAutomaticPrecheck("demo")
      insert.run("demo", "C:\\App\\z.bin", 1)
      insert.run("demo", "C:\\App\\a.bin", 2)
      assert.equal(registry.automaticPrecheckResult("demo", [{
        path: "C:\\App\\z.bin",
        hash
      }]).signature, before)
    } finally {
      registry.close()
      Object.defineProperty(process, "platform", platform)
    }
  })

  test("the final app-process stop verifies only changed candidates", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "demo")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "unchanged.bin"), "aaaa")
    const api = {
      running: { worker: true },
      running_paths: { worker: path.join(appRoot, "worker.js") },
      ondata() {}
    }
    const vault = await makeVault(home, { api, deferStorage: true })
    vault.automaticScans.candidateThreshold = async () => 1
    vault.automaticScans.stopSettleMs = 10
    vault.refreshAnchorStores = async () => {
      throw new Error("The automatic check must not inspect anchor stores.")
    }
    vault.refreshSources = async () => {
      throw new Error("The automatic check must not refresh scan locations.")
    }
    const hashedPaths = []
    const originalHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath, options) => {
      hashedPaths.push(filePath)
      return originalHashFile(filePath, options)
    }
    vault.scanner.walk = async () => {
      throw new Error("The automatic check must not walk the app.")
    }

    vault.automaticScans.handleStarted(scriptPath)
    vault.automaticScans.handleStarted(api.running_paths.worker)
    vault.automaticScans.recordChangedPath(path.join(appRoot, "first.bin"))
    vault.automaticScans.recordChangedPath(path.join(appRoot, "second.bin"))
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
    assert.deepEqual(hashedPaths.sort(), [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ].sort())
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
    const acknowledged = await restored.perform("automatic_acknowledge", {
      app: "demo",
      signature: restoredStatus.rows[0].signature
    })
    assert.deepEqual(acknowledged, { acknowledged: true, app: "demo" })
    assert.equal(restored.initialized, false)
    assert.deepEqual((await restored.automaticScanStatus()).rows, [])
    await close(restored)
  })

  test("equal-size files with different contents do not publish a result", async () => {
    const home = await makeHome()
    const app = "different-content-app"
    const appRoot = path.join(home, "api", app)
    const first = path.join(appRoot, "first.bin")
    const second = path.join(appRoot, "second.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(first, "aaaa")
    await fs.promises.writeFile(second, "bbbb")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1
    const hashedPaths = []
    const verifiedPaths = []
    const originalHashFile = vault.hashFile.bind(vault)
    const originalVerify = vault.automaticScans.verifiedAutomaticHash.bind(
      vault.automaticScans)
    vault.hashFile = async (filePath, options) => {
      hashedPaths.push(filePath)
      return originalHashFile(filePath, options)
    }
    vault.automaticScans.verifiedAutomaticHash = async (...args) => {
      verifiedPaths.push(args[1].path)
      return originalVerify(...args)
    }

    vault.automaticScans.queueApp(app, [first, second])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has(app))

    assert.deepEqual(hashedPaths.sort(), [first, second].sort())
    assert.deepEqual(verifiedPaths.sort(), [first, second].sort())
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("hash worker cancellation interrupts a read without poisoning the worker", async () => {
    const home = await makeHome()
    const large = path.join(home, "large.bin")
    const small = path.join(home, "small.bin")
    await fs.promises.writeFile(large, "x")
    await fs.promises.truncate(large, 32 * 1024 * 1024)
    await fs.promises.writeFile(small, "still-works")
    const vault = await makeVault(home)
    const controller = new AbortController()

    const pending = vault.hashFile(large, { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending,
      (error) => error && error.code === "EVAULTCANCELLED")

    const result = await vault.hashFile(small)
    assert.equal(result.hash, crypto.createHash("sha256")
      .update("still-works").digest("hex"))
    await close(vault)
  })

  test("automatic cancellation aborts the active hash and keeps completed hashes", async () => {
    const home = await makeHome()
    const app = "cancelled-hash-app"
    const appRoot = path.join(home, "api", app)
    const candidate = path.join(appRoot, "candidate.bin")
    const peer = path.join(home, "peer.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-content")
    await fs.promises.writeFile(peer, "same-content")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    vault.automaticScans.candidateThreshold = async () => 1
    const peerStat = await fs.promises.lstat(peer)
    await vault.registry.upsertFile({
      path: peer,
      hash: null,
      size: peerStat.size,
      mtime: peerStat.mtimeMs,
      ctime: peerStat.ctimeMs,
      dev: peerStat.dev,
      ino: peerStat.ino,
      mode: peerStat.mode,
      uid: peerStat.uid,
      gid: peerStat.gid,
      source_id: "app:peer",
      app: "peer",
      status: "reference",
      unavailable_reason: null,
      updated_at: Date.now()
    })
    const originalHashFile = vault.hashFile.bind(vault)
    let peerBegan
    const peerBeganPromise = new Promise((resolve) => { peerBegan = resolve })
    let receivedSignal = false
    vault.hashFile = async (filePath, options = {}) => {
      if (path.resolve(filePath) !== path.resolve(peer)) {
        return originalHashFile(filePath, options)
      }
      receivedSignal = !!options.signal
      peerBegan()
      return new Promise((_resolve, reject) => {
        const cancel = () => {
          const error = new Error("Hashing cancelled.")
          error.code = "EVAULTCANCELLED"
          reject(error)
        }
        if (options.signal.aborted) cancel()
        else options.signal.addEventListener("abort", cancel, { once: true })
      })
    }

    vault.automaticScans.queueApp(app, [candidate])
    await peerBeganPromise
    assert.equal(vault.automaticScans.cancelActive(app, "app-started"), true)
    await waitFor(() => !vault.automaticScans.active)
    assert.equal(receivedSignal, true)

    const candidateStat = await fs.promises.lstat(candidate)
    await vault.registry.beginAutomaticPrecheck(app)
    await vault.registry.stageAutomaticPrecheckFiles(app, [{
      path: candidate,
      size: candidateStat.size,
      mtime: candidateStat.mtimeMs,
      ctime: candidateStat.ctimeMs,
      dev: candidateStat.dev,
      ino: candidateStat.ino,
      nlink: candidateStat.nlink,
      mode: candidateStat.mode,
      uid: candidateStat.uid,
      gid: candidateStat.gid
    }])
    const cached = (await vault.registry.automaticPrecheckEntries(app))
      .entries.find((entry) => entry.kind === "changed")
    assert.equal(cached.hash, crypto.createHash("sha256")
      .update("same-content").digest("hex"))
    await vault.registry.abortAutomaticPrecheck(app)
    await close(vault)
  })

  test("automatic hashes survive restart and seed later scans", async () => {
    const home = await makeHome()
    const app = "cached-hash-app"
    const appRoot = path.join(home, "api", app)
    const first = path.join(appRoot, "first.bin")
    const second = path.join(appRoot, "second.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(first, "same")
    await fs.promises.writeFile(second, "same")

    const initial = await makeVault(home)
    initial.automaticScans.candidateThreshold = async () => 1
    initial.automaticScans.queueApp(app, [first, second])
    await waitFor(() => !initial.automaticScans.active &&
      initial.automaticScans.entries.get(app)?.state === "result")
    await close(initial)

    const restored = await makeVault(home)
    restored.automaticScans.candidateThreshold = async () => 1
    await restored.automaticScanStatus()
    await restored.registry.setAutomaticAppScanState(app, null)
    restored.automaticScans.entries.delete(app)
    restored.hashFile = async () => {
      throw new Error("A valid cached hash must be reused.")
    }

    restored.automaticScans.queueApp(app, [first, second])
    await waitFor(() => !restored.automaticScans.active &&
      restored.automaticScans.entries.get(app)?.state === "result")

    assert.equal((await restored.perform("scan", {
      scope_id: `app:${app}`,
      candidate_size: 0
    })).started, true)
    await waitFor(() => !restored.scanPromise &&
      !restored.scanCompletionPromise, "cached app scan")
    assert.ok(await restored.registry.scanFor(`app:${app}`))
    await close(restored)
  })

  test("a cached hash is ignored after an equal-size content change", async () => {
    const home = await makeHome()
    const app = "changed-cache-app"
    const appRoot = path.join(home, "api", app)
    const first = path.join(appRoot, "first.bin")
    const second = path.join(appRoot, "second.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(first, "same")
    await fs.promises.writeFile(second, "same")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1

    vault.automaticScans.queueApp(app, [first, second])
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get(app)?.state === "result")
    await vault.registry.setAutomaticAppScanState(app, null)
    vault.automaticScans.entries.delete(app)
    await fs.promises.writeFile(second, "diff")
    const hashedPaths = []
    const originalHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath, options) => {
      hashedPaths.push(filePath)
      return originalHashFile(filePath, options)
    }

    vault.automaticScans.queueApp(app, [first, second])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has(app))

    assert.deepEqual(hashedPaths, [second])
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("changed paths beneath symbolic-link ancestors are not inspected", async () => {
    const home = await makeHome()
    const app = "linked-path-app"
    const appRoot = path.join(home, "api", app)
    const outsideRoot = path.join(home, "outside")
    const directPath = path.join(appRoot, "direct.bin")
    const outsidePath = path.join(outsideRoot, "outside.bin")
    const linkPath = path.join(appRoot, "linked")
    const linkedPath = path.join(linkPath, "outside.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.mkdir(outsideRoot)
    await fs.promises.writeFile(directPath, "same")
    await fs.promises.writeFile(outsidePath, "same")
    await fs.promises.symlink(
      outsideRoot,
      linkPath,
      process.platform === "win32" ? "junction" : "dir"
    )
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1
    const inspected = []
    const originalStat = vault.automaticScans.statChangedPaths.bind(
      vault.automaticScans)
    vault.automaticScans.statChangedPaths = (paths, options, onSettled) => {
      inspected.push(...paths)
      return originalStat(paths, options, onSettled)
    }

    vault.automaticScans.queueApp(app, [directPath, linkedPath])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has(app), "linked path precheck")

    assert.deepEqual(inspected, [directPath])
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
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
    vault.automaticScans.statChangedPaths = async () => {
      await fs.promises.rm(appRoot, { recursive: true })
      return [null]
    }

    vault.automaticScans.queueApp(app, [path.join(appRoot, "model.bin")])
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
    const broadcasts = []
    const unsubscribe = vault.automaticScans.subscribe((snapshot) => {
      broadcasts.push(snapshot)
    })

    vault.automaticScans.queueApp("threshold-app", [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("threshold-app"))

    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal(broadcasts.some((snapshot) => snapshot.completion), false)
    assert.equal("completion" in vault.automaticScans.snapshot(), false)
    let restoredSnapshot = null
    const unsubscribeRestored = vault.automaticScans.subscribe((snapshot) => {
      restoredSnapshot = snapshot
    })
    assert.equal("completion" in restoredSnapshot, false)
    unsubscribeRestored()
    unsubscribe()
    assert.equal(await vault.registry.scanFor("app:threshold-app"), null)
    await close(vault)
  })

  test("missing published peers cannot produce a verified result", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "sqlite-peer-app")
    const candidate = path.join(appRoot, "candidate.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-size")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    assert.equal(vault.initialized, false)
    vault.automaticScans.candidateThreshold = async () => 1
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

    vault.automaticScans.queueApp("sqlite-peer-app", [candidate])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("sqlite-peer-app"))

    assert.equal(fs.existsSync(missingPeer), false)
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("stable published hashes are reused without rereading contents", async () => {
    const home = await makeHome()
    const app = "published-hash-app"
    const appRoot = path.join(home, "api", app)
    const candidate = path.join(appRoot, "candidate.bin")
    const peer = path.join(home, "published-peer.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-content")
    await fs.promises.writeFile(peer, "same-content")
    const vault = await makeVault(home, { deferStorage: true })
    await vault.ensureRegistryInitialized()
    vault.automaticScans.candidateThreshold = async () => 1
    const candidateStat = await fs.promises.lstat(candidate)
    const peerStat = await fs.promises.lstat(peer)
    const hash = crypto.createHash("sha256")
      .update("same-content").digest("hex")
    const published = (filePath, stat, sourceId, sourceApp) => ({
      path: filePath,
      hash,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid,
      source_id: sourceId,
      app: sourceApp,
      status: "reference",
      unavailable_reason: null,
      updated_at: Date.now()
    })
    await vault.registry.upsertFile(published(
      candidate, candidateStat, `app:${app}`, app))
    await vault.registry.upsertFile(published(
      peer, peerStat, "app:peer", "peer"))
    const hashedPaths = []
    const originalHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath, options) => {
      hashedPaths.push(filePath)
      return originalHashFile(filePath, options)
    }

    vault.automaticScans.queueApp(app, [candidate])
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get(app)?.state === "result")

    assert.deepEqual(hashedPaths, [])
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
    vault.automaticScans.candidateThreshold = async () => 1
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

    vault.automaticScans.queueApp("no-peer-app", [candidate])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("no-peer-app"))

    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("a current verified store record can be a verified peer", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "store-peer-app")
    const candidate = path.join(appRoot, "candidate.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(candidate, "same-size")
    const anchorPath = path.join(home, "anchor.bin")
    await fs.promises.writeFile(anchorPath, "same-size")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1
    const stat = await fs.promises.lstat(candidate)
    const anchorStat = await fs.promises.lstat(anchorPath)
    const hash = crypto.createHash("sha256").update("same-size").digest("hex")
    await vault.registry.upsertContent({
      hash,
      size: stat.size,
      first_seen: Date.now(),
      verified_at: Date.now(),
      anchor_present: true
    })
    await vault.registry.upsertAnchor({
      store_id: "verified-store",
      hash,
      path: anchorPath,
      verified_at: Date.now(),
      dev: anchorStat.dev,
      ino: anchorStat.ino,
      size: anchorStat.size,
      mtime: anchorStat.mtimeMs,
      ctime: anchorStat.ctimeMs,
      nlink: anchorStat.nlink,
      mode: anchorStat.mode,
      uid: anchorStat.uid,
      gid: anchorStat.gid
    })

    vault.automaticScans.queueApp("store-peer-app", [candidate])
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("store-peer-app")?.state === "result")

    assert.equal(vault.automaticScans.snapshot().rows[0].state, "result")
    await close(vault)
  })

  test("acknowledgement is remembered until the verified-match set changes", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "acknowledged-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "aaaa")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1

    const acknowledgedPaths = [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ]
    vault.automaticScans.queueApp("acknowledged-app", acknowledgedPaths)
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("acknowledged-app")?.state === "result")
    const signature = vault.automaticScans.snapshot().rows[0].signature
    await vault.perform("automatic_acknowledge", {
      app: "acknowledged-app",
      signature
    })
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])

    vault.automaticScans.queueApp("acknowledged-app", acknowledgedPaths)
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("acknowledged-app")?.state === "result")
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])

    await fs.promises.writeFile(path.join(appRoot, "third.bin"), "aaaa")
    const previousSignature = vault.automaticScans.entries.get(
      "acknowledged-app").signature
    vault.automaticScans.queueApp("acknowledged-app", acknowledgedPaths.concat(
      path.join(appRoot, "third.bin")))
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("acknowledged-app")?.state === "result" &&
      vault.automaticScans.entries.get("acknowledged-app")?.signature !==
        previousSignature)
    assert.equal(vault.automaticScans.snapshot().rows[0].state, "result")
    await close(vault)
  })

  test("an empty replacement clears the result and its acknowledgement", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "empty-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "aaaa")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1

    const emptyPaths = [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ]
    vault.automaticScans.queueApp("empty-app", emptyPaths)
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("empty-app")?.state === "result")
    await vault.perform("automatic_acknowledge", {
      app: "empty-app",
      signature: vault.automaticScans.snapshot().rows[0].signature
    })
    await fs.promises.unlink(path.join(appRoot, "second.bin"))
    vault.automaticScans.queueApp("empty-app", [emptyPaths[0]])
    await waitFor(() => !vault.automaticScans.active &&
      !vault.automaticScans.entries.has("empty-app"))

    const setting = (await vault.registry.automaticAppScanSettings())
      .find((row) => row.app === "empty-app")
    assert.equal(setting.acknowledged_signature, null)
    await close(vault)
  })

  test("an app restart cancels an active check and restores the prior result", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "restart-app")
    const scriptPath = path.join(appRoot, "start.js")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "aaaa")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1
    const restartPaths = [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ]
    vault.automaticScans.queueApp("restart-app", restartPaths)
    await waitFor(() => !vault.automaticScans.active &&
      vault.automaticScans.entries.get("restart-app")?.state === "result")
    const previous = vault.automaticScans.entries.get("restart-app")

    let release
    let began
    const beganPromise = new Promise((resolve) => { began = resolve })
    const originalStat = vault.automaticScans.statChangedPaths.bind(
      vault.automaticScans)
    vault.automaticScans.statChangedPaths = async (paths, options) => {
      began()
      await new Promise((resolve) => { release = resolve })
      return originalStat(paths, options)
    }
    vault.automaticScans.queueApp("restart-app", restartPaths)
    await beganPromise
    vault.automaticScans.handleStarted(scriptPath)
    release()
    await waitFor(() => !vault.automaticScans.active)
    vault.automaticScans.statChangedPaths = originalStat

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
    const automatic = makeAutomatic({
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
      verified_files: 1
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
    const automatic = makeAutomatic({
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
      verified_files: 1
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

  test("a fatal precheck error restores the prior verified-match result", async () => {
    const automatic = makeAutomatic({ enabled: true })
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

  test("a stale result action cannot acknowledge its replacement", async () => {
    const acknowledgements = []
    const automatic = makeAutomatic({
      enabled: true,
      registry: {
        setAutomaticAppScanState: async () => ({ updated_at: 2 }),
        setAutomaticAppScanAcknowledgement: async (_app, signature) => {
          acknowledgements.push(signature)
          return { acknowledged_signature: signature, updated_at: 3 }
        }
      }
    })
    automatic.globalScanReady = true
    automatic.hydrated = true
    automatic.log = () => {}
    const previous = {
      app: "demo",
      state: "result",
      signature: "a".repeat(64),
      updated_at: 1,
      previous: null,
      hidden: false
    }
    automatic.entries.set("demo", previous)
    const previousSignature = automatic.snapshot().rows[0].signature
    await automatic.publishResultNow("demo", {
      signature: "b".repeat(64),
      verified_files: 1
    })

    assert.deepEqual(await automatic.acknowledge("demo", previousSignature), {
      stale: true,
      app: "demo"
    })
    assert.equal(automatic.snapshot().rows[0].state, "result")
    assert.deepEqual(acknowledgements, [])
  })

  test("prechecks observe cancellation while metadata paths settle", async () => {
    const home = await makeHome()
    const app = "settled-cancellation-app"
    const appRoot = path.join(home, "api", app)
    const changedPath = path.join(appRoot, "model.bin")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(changedPath, "model")
    const vault = await makeVault(home)
    const active = {
      app,
      paths: [changedPath],
      cancelled: false,
      reason: null
    }
    vault.automaticScans.active = active
    vault.automaticScans.statChangedPaths = async (
      _paths, _options, onSettled) => {
      assert.equal(typeof onSettled, "function")
      active.cancelled = true
      active.reason = "manual"
      onSettled(0, null)
      assert.fail("cancelled metadata work continued")
    }

    await assert.rejects(
      vault.automaticScans.runPrecheck(active),
      (error) => error && error.code === "EVAULTCANCELLED")
    assert.equal((await vault.registry.automaticPrecheckResult(app)).files, 0)
    vault.automaticScans.active = null
    await close(vault)
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
    vault.automaticScans.candidateThreshold = async () => 1
    let release
    let began
    const beganPromise = new Promise((resolve) => { began = resolve })
    const originalStat = vault.automaticScans.statChangedPaths.bind(
      vault.automaticScans)
    vault.automaticScans.statChangedPaths = async (
      paths, options, onSettled) => {
      began()
      await new Promise((resolve) => { release = resolve })
      return originalStat(paths, options, onSettled)
    }

    vault.automaticScans.queueApp("priority-app", [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ])
    await beganPromise
    const manual = vault.perform("scan", {
      scope_id: "app:priority-app",
      candidate_size: 0
    })
    await waitFor(() => vault.automaticScans.active?.cancelled === true,
      "user work to preempt the automatic check")
    vault.automaticScans.statChangedPaths = originalStat
    release()

    assert.equal((await manual).started, true)
    await waitFor(() => !vault.scanPromise && !vault.scanCompletionPromise,
      "manual scan")
    assert.ok(await vault.registry.scanFor("app:priority-app"))
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    await close(vault)
  })

  test("a completed manual app scan clears the verified-match result", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "manual-app")
    await fs.promises.mkdir(appRoot)
    await fs.promises.writeFile(path.join(appRoot, "first.bin"), "aaaa")
    await fs.promises.writeFile(path.join(appRoot, "second.bin"), "aaaa")
    const vault = await makeVault(home)
    vault.automaticScans.candidateThreshold = async () => 1
    vault.automaticScans.queueApp("manual-app", [
      path.join(appRoot, "first.bin"),
      path.join(appRoot, "second.bin")
    ])
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
    const automatic = makeAutomatic(vault)
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

  test("a file action clears only results for affected apps", async () => {
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
    const automatic = makeAutomatic(vault)
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

  test("a temporary Manual switch does not lose a running app's paths", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "mode-switch-app")
    const scriptPath = path.join(appRoot, "start.js")
    const changedPath = path.join(appRoot, "model.bin")
    await fs.promises.mkdir(appRoot)
    const api = {
      running: { app: true },
      running_paths: { app: scriptPath },
      ondata() {}
    }
    const vault = await makeVault(home, { api })

    vault.automaticScans.handleStarted(scriptPath)
    vault.automaticScans.recordChangedPath(changedPath)
    await vault.perform("automatic_set_mode", {
      app: "mode-switch-app",
      mode: "manual"
    })
    assert.deepEqual([...vault.automaticScans.changedPaths.get(
      "mode-switch-app")], [changedPath])
    await vault.perform("automatic_set_mode", {
      app: "mode-switch-app",
      mode: "automatic"
    })
    assert.deepEqual([...vault.automaticScans.changedPaths.get(
      "mode-switch-app")], [changedPath])

    await close(vault)
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
    assert.deepEqual(await first.perform("automatic_set_mode", {
      app: "manual-mode-app",
      mode: "manual"
    }), { app: "manual-mode-app", mode: "manual" })
    await close(first)

    const restored = await makeVault(home, { deferStorage: true })
    assert.equal((await restored.automaticScanStatus()).settings[0].mode,
      "manual")
    restored.automaticScans.handleStarted(scriptPath)
    restored.automaticScans.recordChangedPath(
      path.join(appRoot, "model.bin"))
    await restored.automaticScans.handleStopped(scriptPath)
    assert.equal(restored.automaticScans.pendingStops.size, 0)
    assert.equal(restored.automaticScans.changedPaths.size, 0)
    assert.deepEqual(restored.automaticScans.snapshot().rows, [])
    await close(restored)
  })

  test("persisted state for a deleted app is removed during hydration", async () => {
    const home = await makeHome()
    const appRoot = path.join(home, "api", "deleted-app")
    await fs.promises.mkdir(appRoot)
    const first = await makeVault(home)
    await first.registry.setAutomaticAppScanMode("deleted-app", "manual")
    await close(first)
    await fs.promises.rm(appRoot, { recursive: true })

    const restored = await makeVault(home, { deferStorage: true })
    assert.deepEqual((await restored.automaticScanStatus()).rows, [])
    assert.deepEqual(await restored.registry.automaticAppScanStates(), [])
    assert.deepEqual(await restored.registry.automaticAppScanSettings(), [])
    await close(restored)
  })

  test("automatic precheck registry reads are paged without duplicates", async () => {
    const home = await makeHome()
    const vault = await makeVault(home)
    const app = "paged-app"
    const entries = []
    for (let index = 0; index < 5; index++) {
      const filePath = path.join(home, "api", app, `${index}.bin`)
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, Buffer.alloc(index + 1, index))
      const stat = await fs.promises.lstat(filePath)
      entries.push({
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
    }
    await vault.registry.beginAutomaticPrecheck(app)
    await vault.registry.stageAutomaticPrecheckFiles(app, entries)

    const paths = []
    let cursor = null
    do {
      const page = await vault.registry.automaticPrecheckEntries(
        app, cursor, 2)
      assert.ok(page.entries.length <= 2)
      paths.push(...page.entries.map((entry) => entry.path))
      cursor = page.next_cursor
    } while (cursor)

    assert.equal(paths.length, entries.length)
    assert.equal(new Set(paths).size, entries.length)
    await vault.registry.abortAutomaticPrecheck(app)
    await close(vault)
  })

  test("Kernel restart waits for the complete previous Vault to dispose", async () => {
    const calls = []
    const fakeKernel = {
      vault: {
        ready: Promise.resolve().then(() => { calls.push("ready") }),
        dispose: async () => { calls.push("dispose") }
      }
    }

    assert.equal(
      await Kernel.prototype.disposeVault.call(fakeKernel),
      true)
    assert.deepEqual(calls, ["ready", "dispose"])
  })

  test("Vault disposal closes its registry process", async () => {
    const home = await makeHome()
    const vault = await makeVault(home)
    const registryPid = vault.registry.worker.pid

    await vault.dispose()

    assert.equal(vault.registry, null)
    assert.equal(vault.worker, null)
    assert.throws(() => process.kill(registryPid, 0), { code: "ESRCH" })
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
