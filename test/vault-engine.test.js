const { after, beforeEach, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Database = require("better-sqlite3")
const Util = require("../kernel/util")
const Vault = require("../kernel/vault")
const Registry = require("../kernel/vault/registry")
const {
  CANDIDATE_SIZE_OPTIONS,
  MINIMUM_CANDIDATE_SIZE,
  SIZE_THRESHOLD
} = require("../kernel/vault/constants")

const candidateBase = process.platform === "win32" ? 1024 : 1000

const homes = []

const makeHome = async () => {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pinokio-vault-engine-"))
  homes.push(home)
  await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
  return home
}

const makeOutside = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pinokio-vault-find-"))
  homes.push(directory)
  return directory
}

const makeVault = async ({ candidateSize = CANDIDATE_SIZE_OPTIONS[0] } = {}) => {
  const home = await makeHome()
  const kernel = { homedir: home, platform: process.platform }
  const vault = new Vault(kernel)
  kernel.vault = vault
  await vault.init()
  vault.sizeThreshold = 1
  if (candidateSize !== null) {
    await vault.perform("set_candidate_size", {
      candidate_size: candidateSize
    })
  }
  return { home, kernel, vault }
}

const write = async (filePath, contents) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, contents)
  return filePath
}

const writeCandidate = async (
  filePath,
  contents,
  size = MINIMUM_CANDIDATE_SIZE
) => {
  await write(filePath, contents)
  await fs.promises.truncate(filePath, size)
  return filePath
}

const assertCandidateContents = async (filePath, contents, size) => {
  const expected = Buffer.alloc(size)
  contents.copy(expected)
  assert.deepEqual(await fs.promises.readFile(filePath), expected)
}

const duplicatePair = async (home, name = "model.bin") => {
  const contents = crypto.randomBytes(4096)
  const first = await writeCandidate(
    path.join(home, "api", "first", name), contents)
  const second = await writeCandidate(
    path.join(home, "api", "second", name), contents)
  return { contents, first, second, size: MINIMUM_CANDIDATE_SIZE }
}

const close = async (vault) => {
  if (vault.worker) await vault.worker.terminate().catch(() => {})
  if (vault.registry) await vault.registry.close()
}

const waitForEngine = async (condition) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for the Disk Saver engine.")
}

describe("Save Space engine", () => {
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

  test("file reveals reuse the shared file explorer launcher", async () => {
    const kernel = { homedir: os.tmpdir(), platform: process.platform }
    const vault = new Vault(kernel)
    const originalOpenfs = Util.openfs
    const calls = []
    Util.openfs = (...args) => {
      calls.push(args)
    }

    try {
      const filePath = path.join(os.tmpdir(), "model with spaces.bin")
      await vault.fileManagerLauncher(filePath)
      assert.deepEqual(calls, [[
        filePath,
        { action: "view" },
        kernel
      ]])
    } finally {
      Util.openfs = originalOpenfs
    }
  })

  test("startup only reads the enable flag and defers Disk Saver storage", async () => {
    const home = await makeHome()
    const vault = new Vault({ homedir: home, platform: process.platform })

    assert.deepEqual(await vault.init({ deferStorage: true }), {
      enabled: true
    })
    assert.equal(vault.initialized, false)
    assert.equal(vault.registry, null)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)

    await vault.ensureInitialized()
    assert.equal(vault.initialized, true)
    assert.equal(fs.existsSync(path.join(home, "vault", "registry.sqlite3")),
      true)
    await close(vault)
  })

  test("the environment kill switch creates no storage and rejects actions", async () => {
    const home = await makeHome()
    await fs.promises.writeFile(
      path.join(home, "ENVIRONMENT"), "PINOKIO_VAULT=false\n")
    const vault = new Vault({ homedir: home, platform: process.platform })

    assert.deepEqual(await vault.init(), { enabled: false })
    assert.match((await vault.perform("scan")).error, /disabled/i)
    assert.equal(fs.existsSync(path.join(home, "vault")), false)
  })

  test("SQLite is owned by a dedicated process", async () => {
    const { vault } = await makeVault()

    assert.ok(vault.registry.worker)
    assert.ok(Number.isInteger(vault.registry.worker.pid))
    assert.notEqual(vault.registry.worker.pid, process.pid)
    assert.equal(vault.registry.database, undefined)
    assert.equal(await vault.registry.countFiles(), 0)

    await close(vault)
  })

  test("a blocked native registry query can be killed and reopened", async () => {
    const root = await makeOutside()
    const registry = new Registry(root, {
      workerPath: path.resolve(
        __dirname, "fixtures", "vault-registry-blocking-worker.js")
    })
    await registry.load()
    const originalPid = registry.worker.pid
    assert.deepEqual(await registry.call("block"), { started: true })
    await new Promise((resolve) => setTimeout(resolve, 25))

    const cancelled = new Error("Scan cancelled.")
    cancelled.code = "EVAULTCANCELLED"
    const started = Date.now()
    await registry.restart(cancelled)

    assert.ok(Date.now() - started < 2000)
    assert.notEqual(registry.worker.pid, originalPid)
    assert.deepEqual(await registry.call("load"), { existed: false })
    await registry.close()
  })

  test("ordinary pages reuse sources until Save Space is opened again", async () => {
    const { home, vault } = await makeVault()
    const laterApp = path.join(home, "api", "later")
    await fs.promises.mkdir(laterApp)

    let status = await vault.status()
    assert.equal(status.sources.some((source) =>
      source.root === laterApp), false)

    await vault.openWorkspace()
    status = await vault.status()
    assert.equal(status.sources.some((source) =>
      source.root === laterApp), true)

    await close(vault)
  })

  test("global readiness accepts only successful publication outcomes", async () => {
    const { vault } = await makeVault()
    const scan = (outcome) => ({ ts: 1, outcome })

    assert.equal(vault.globalScanIsReady(scan("complete")), true)
    assert.equal(vault.globalScanIsReady(
      scan("completed_with_exclusions")), true)
    assert.equal(vault.globalScanIsReady(scan("cancelled")), false)
    assert.equal(vault.globalScanIsReady(scan("failed")), false)
    assert.equal(vault.globalScanIsReady(null), false)

    await close(vault)
  })

  test("global and app minimum sizes persist and drive their own scans", async () => {
    const { home, vault } = await makeVault()
    const app = "minimum-size-app"
    const appRoot = path.join(home, "api", app)
    const appScope = `app:${app}`
    const globalMinimum = CANDIDATE_SIZE_OPTIONS[2]
    const appMinimum = CANDIDATE_SIZE_OPTIONS[1]
    await fs.promises.mkdir(appRoot)
    await vault.openWorkspace()

    assert.equal((await vault.perform("set_candidate_size", {
      candidate_size: globalMinimum
    })).candidate_min_bytes, globalMinimum)
    assert.equal((await vault.perform("set_candidate_size", {
      scope_id: appScope,
      candidate_size: appMinimum
    })).candidate_min_bytes, appMinimum)
    assert.equal((await vault.status()).candidate_min_bytes, globalMinimum)
    assert.equal((await vault.status(appScope)).candidate_min_bytes, appMinimum)

    const starts = []
    vault.globalScanReady = async () => true
    vault.startScan = (scopeId, threshold) => {
      starts.push({ scope_id: scopeId, threshold })
      return { started: true }
    }
    assert.deepEqual(await vault.perform("scan", {
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    }), { started: true })
    assert.deepEqual(await vault.perform("scan", {
      scope_id: appScope,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    }), { started: true })
    assert.deepEqual(starts, [
      { scope_id: null, threshold: globalMinimum },
      { scope_id: appScope, threshold: appMinimum }
    ])
    let folderThreshold = null
    vault.startFolderDiscovery = (folderPath, threshold) => {
      folderThreshold = threshold
      return { started: true }
    }
    assert.deepEqual(await vault.perform("find_folders", {
      path: home,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    }), { started: true })
    assert.equal(folderThreshold, globalMinimum)
    assert.equal((await vault.status()).candidate_min_bytes, globalMinimum)
    assert.equal((await vault.status(appScope)).candidate_min_bytes, appMinimum)
    assert.equal((await vault.automaticScans.candidatePolicy(app)).threshold,
      appMinimum)

    await close(vault)
    const reopened = new Vault({ homedir: home, platform: process.platform })
    await reopened.init()
    assert.equal((await reopened.status()).candidate_min_bytes, globalMinimum)
    assert.equal((await reopened.status(appScope)).candidate_min_bytes,
      appMinimum)
    await close(reopened)
  })

  test("reading a default minimum size does not persist it", async () => {
    const { vault } = await makeVault({ candidateSize: null })

    assert.equal(await vault.registry.scanSetting(), null)
    assert.equal((await vault.status()).candidate_min_bytes, SIZE_THRESHOLD)
    assert.equal(await vault.registry.scanSetting(), null)

    await close(vault)
  })

  test("minimum size settings reject coerced values", async () => {
    const { vault } = await makeVault({ candidateSize: null })

    for (const candidateSize of [
      null,
      "",
      String(CANDIDATE_SIZE_OPTIONS[1])
    ]) {
      assert.match((await vault.perform("set_candidate_size", {
        candidate_size: candidateSize
      })).error, /valid minimum file size/i)
    }
    assert.equal(await vault.registry.scanSetting(), null)

    await close(vault)
  })

  test("minimum size settings reject values below 10 MB", async () => {
    const { vault } = await makeVault({ candidateSize: null })

    for (const candidateSize of [0, candidateBase ** 2]) {
      assert.match((await vault.perform("set_candidate_size", {
        candidate_size: candidateSize
      })).error, /valid minimum file size/i)
    }
    assert.equal(CANDIDATE_SIZE_OPTIONS[0],
      MINIMUM_CANDIDATE_SIZE)
    assert.deepEqual(CANDIDATE_SIZE_OPTIONS, [
      10, 50, 100, 500, 1000
    ].map((value) => value * candidateBase ** 2))
    assert.equal(await vault.registry.scanSetting(), null)

    await close(vault)
  })

  test("legacy minimum size settings fall back to 100 MB", async () => {
    const { vault } = await makeVault({ candidateSize: null })
    await vault.registry.setScanSetting(null, candidateBase ** 2)

    assert.equal((await vault.status()).candidate_min_bytes, SIZE_THRESHOLD)

    await close(vault)
  })

  test("minimum size settings reject malformed scopes", async () => {
    const { vault } = await makeVault({ candidateSize: null })

    const result = await vault.perform("set_candidate_size", {
      scope_id: 123,
      candidate_size: CANDIDATE_SIZE_OPTIONS[1]
    })

    assert.match(result.error, /valid scan scope/i)
    assert.equal(await vault.registry.scanSetting(), null)

    await close(vault)
  })

  test("scan history does not become a minimum size setting", async () => {
    const home = await makeHome()
    const vault = new Vault({ homedir: home, platform: process.platform })
    await vault.init()
    await vault.perform("set_candidate_size", {
      candidate_size: CANDIDATE_SIZE_OPTIONS[2]
    })
    assert.equal((await vault.perform("scan")).started, true)
    await waitForEngine(() => !vault.scanPromise &&
      !vault.scanCompletionPromise)
    await close(vault)

    const database = new Database(path.join(home, "vault", "registry.sqlite3"))
    database.exec("DROP TABLE minimum_size_settings")
    database.close()

    const reopened = new Vault({ homedir: home, platform: process.platform })
    await reopened.init()
    assert.equal((await reopened.status()).candidate_min_bytes,
      SIZE_THRESHOLD)
    assert.equal(await reopened.registry.scanSetting(), null)
    await close(reopened)
  })

  test("the folder tree resolves a group of locations to its members", async () => {
    const { home, vault } = await makeVault()
    await writeCandidate(
      path.join(home, "api", "alpha", "models", "one.bin"),
      crypto.randomBytes(4096))
    await writeCandidate(
      path.join(home, "api", "beta", "models", "two.bin"),
      crypto.randomBytes(4096))
    await vault.openWorkspace()
    assert.equal((await vault.perform("scan")).started, true)
    await waitForEngine(() => !vault.scanPromise &&
      !vault.scanCompletionPromise)

    // "Apps" owns no files itself; it stands for the apps beneath it.
    const group = await vault.treeEntries(null, { location_id: "apps" })
    assert.deepEqual(group.items.map((entry) => entry.kind), ["location", "location"])
    assert.deepEqual(
      group.items.map((entry) => entry.location_id).sort(),
      ["app:alpha", "app:beta"])
    assert.ok(group.items.every((entry) => entry.size > 0))

    // One location resolves to its own contents instead of a list of one.
    const single = await vault.treeEntries(null, { location_id: "app:alpha" })
    assert.deepEqual(single.items.map((entry) => entry.label), ["models"])
    assert.equal(single.items[0].kind, "directory")
    await close(vault)
  })

  test("a scoped folder tree cannot be pointed at another location", async () => {
    const { home, vault } = await makeVault()
    await writeCandidate(
      path.join(home, "api", "mine", "models", "mine.bin"),
      crypto.randomBytes(4096))
    await writeCandidate(
      path.join(home, "api", "theirs", "models", "theirs.bin"),
      crypto.randomBytes(4096))
    await vault.openWorkspace()
    assert.equal((await vault.perform("scan")).started, true)
    await waitForEngine(() => !vault.scanPromise &&
      !vault.scanCompletionPromise)

    const escaped = await vault.treeEntries("app:mine", {
      location_id: "app:theirs"
    })
    // Naming another location from a scoped page must not read it.
    assert.notEqual(escaped.source_id, "app:theirs")
    const paths = JSON.stringify(escaped.items)
    assert.ok(!paths.includes("theirs"))
    await close(vault)
  })

  test("a folder level pages folders and files as one order", async () => {
    const { home, vault } = await makeVault()
    const root = path.join(home, "api", "paged")
    // Two folders and two loose files, with sizes that interleave.
    await writeCandidate(path.join(root, "big", "a.bin"),
      crypto.randomBytes(4096), MINIMUM_CANDIDATE_SIZE * 4)
    await writeCandidate(path.join(root, "small", "b.bin"),
      crypto.randomBytes(4096), MINIMUM_CANDIDATE_SIZE)
    await writeCandidate(path.join(root, "middle.bin"),
      crypto.randomBytes(4096), MINIMUM_CANDIDATE_SIZE * 2)
    await writeCandidate(path.join(root, "tiny.bin"),
      crypto.randomBytes(4096), MINIMUM_CANDIDATE_SIZE)
    await vault.openWorkspace()
    assert.equal((await vault.perform("scan")).started, true)
    await waitForEngine(() => !vault.scanPromise &&
      !vault.scanCompletionPromise)

    const whole = await vault.treeEntries(null, {
      location_id: "app:paged",
      size_sort: "desc"
    })
    const order = whole.items.map((entry) => entry.label ||
      entry.relative_path)
    // A loose file sorts by its size, not below every folder.
    assert.equal(order[0], "big")
    assert.ok(order.indexOf("middle.bin") < order.indexOf("small"))

    // The same order survives being read one row at a time.
    const paged = []
    let cursor = null
    let offset = 0
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await vault.treeEntries(null, {
        location_id: "app:paged",
        size_sort: "desc",
        page_size: 1,
        cursor,
        directory_offset: offset
      })
      paged.push(...page.items.map((entry) => entry.label ||
        entry.relative_path))
      if (!page.has_next || !page.items.length) break
      cursor = page.next_cursor
      offset = page.next_directory_offset
    }
    assert.deepEqual(paged, order)
    await close(vault)
  })

  test("the saved global minimum is reused by unscoped policy reads", async () => {
    const { vault } = await makeVault({ candidateSize: null })
    const selected = CANDIDATE_SIZE_OPTIONS[2]

    assert.equal((await vault.status()).global_candidate_min_bytes,
      SIZE_THRESHOLD)
    await vault.perform("set_candidate_size", {
      candidate_size: selected
    })
    assert.deepEqual(await vault.perform("scan"), { started: true })
    await waitForEngine(() => !vault.scanPromise &&
      !vault.scanCompletionPromise)

    assert.equal((await vault.status()).global_candidate_min_bytes, selected)
    assert.equal(await vault.automaticScans.candidateThreshold(), selected)
    const scan = await vault.registry.scanFor()
    const expectedDevices = vault.anchorStores()
      .filter((store) => store.available && Number.isFinite(store.dev) &&
        store.mode !== "copy")
      .map((store) => store.dev)
      .sort((left, right) => left - right)
    assert.deepEqual(scan.linkable_devices, expectedDevices)

    await close(vault)
  })

  test("cancel scan recycles a registry call that is no longer returning", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    let entered
    let rejectStage
    const stageEntered = new Promise((resolve) => { entered = resolve })
    const registry = vault.registry
    const restart = registry.restart.bind(registry)
    registry.setStageHashes = async () => new Promise((resolve, reject) => {
      rejectStage = reject
      entered()
    })
    registry.restart = async (error) => {
      rejectStage(error)
      return restart(error)
    }

    assert.deepEqual(vault.startScan(), { started: true })
    await stageEntered
    assert.deepEqual(vault.cancelScan(), { cancel_requested: true })
    await waitForEngine(() =>
      !vault.scanPromise &&
      !vault.scanCompletionPromise &&
      !vault.registryRestartPromise)

    assert.equal(vault.scanStatus().phase, "cancelled")
    assert.equal(await vault.registry.countFiles(), 0)
    await close(vault)
  })

  test("cancelling a pending scan start leaves the engine reusable", async () => {
    const { vault } = await makeVault()
    const registry = vault.registry
    const beginScan = registry.beginScan.bind(registry)
    const restart = registry.restart.bind(registry)
    let entered
    let rejectBegin
    const beginEntered = new Promise((resolve) => { entered = resolve })
    registry.beginScan = () => new Promise((_resolve, reject) => {
      rejectBegin = reject
      entered()
    })
    registry.restart = async (error) => {
      rejectBegin(error)
      return restart(error)
    }

    assert.deepEqual(vault.startScan(), { started: true })
    await beginEntered
    assert.deepEqual(vault.cancelScan(), { cancel_requested: true })
    await waitForEngine(() =>
      !vault.scanPromise &&
      !vault.scanCompletionPromise &&
      !vault.registryRestartPromise)

    assert.equal(vault.scanStatus().active, false)
    assert.equal(vault.scanStatus().phase, "cancelled")
    registry.beginScan = beginScan
    registry.restart = restart
    assert.deepEqual(vault.startScan(), { started: true })
    await waitForEngine(() => !vault.scanPromise)
    assert.equal(vault.scanStatus().phase, "complete")
    await close(vault)
  })

  test("cancelling active hashing preserves the cancelled outcome", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    let entered
    const hashEntered = new Promise((resolve) => { entered = resolve })
    vault.scanner.hashStable = () => new Promise((_resolve, reject) => {
      const worker = { terminate: async () => {} }
      vault.worker = worker
      vault.workerJobs.set("test", {
        worker,
        cleanup() {},
        reject
      })
      entered()
    })

    assert.deepEqual(vault.startScan(), { started: true })
    await hashEntered
    assert.deepEqual(vault.cancelScan(), { cancel_requested: true })
    await waitForEngine(() =>
      !vault.scanPromise &&
      !vault.scanCompletionPromise &&
      !vault.registryRestartPromise)

    assert.equal(vault.scanStatus().phase, "cancelled")
    assert.equal(vault.scanError, null)
    assert.equal(await vault.registry.countFiles(), 0)
    await close(vault)
  })

  test("publication finishes atomically instead of accepting cancellation", async () => {
    const { vault } = await makeVault()
    const publishScan = vault.registry.publishScan.bind(vault.registry)
    let entered
    let release
    const publishEntered = new Promise((resolve) => { entered = resolve })
    const publishGate = new Promise((resolve) => { release = resolve })
    vault.registry.publishScan = async (...args) => {
      entered()
      await publishGate
      return publishScan(...args)
    }

    assert.deepEqual(vault.startScan(), { started: true })
    await publishEntered
    const registryPid = vault.registry.worker.pid
    assert.deepEqual(vault.cancelScan(), { cancel_requested: false })
    assert.equal(vault.registryRestartPromise, null)
    assert.equal(vault.registry.worker.pid, registryPid)
    release()
    await waitForEngine(() =>
      !vault.scanPromise && !vault.scanCompletionPromise)

    assert.equal(vault.scanStatus().phase, "complete")
    assert.equal(vault.registry.worker.pid, registryPid)
    await close(vault)
  })

  test("app scans stay locked until the first global scan is published", async () => {
    const { home, vault } = await makeVault()
    await write(path.join(home, "api", "demo", "model.bin"), "demo")
    await vault.openWorkspace()
    const source = vault.sources().find((item) =>
      item.kind === "app" && item.app === "demo")

    assert.equal(await vault.globalScanReady(), false)
    assert.equal((await vault.status(source.id)).global_scan_ready, false)
    assert.deepEqual(await vault.perform("scan", {
      scope_id: source.id,
      candidate_size: 0
    }), {
      error: "Run an initial scan before scanning individual apps.",
      code: "global_scan_required"
    })

    assert.deepEqual(await vault.perform("automatic_set_mode", {
      app: "demo",
      mode: "automatic"
    }), { app: "demo", mode: "automatic" })
    const launchPath = path.join(home, "api", "demo", "start.js")
    const modelPath = path.join(home, "api", "demo", "model.bin")
    vault.automaticScans.handleStarted(launchPath)
    vault.automaticScans.recordChangedPath(modelPath)
    await vault.automaticScans.handleStopped(launchPath)
    assert.equal(vault.automaticScans.pendingStops.size, 0)
    assert.equal(vault.automaticScans.changedPaths.has("demo"), false)
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])

    vault.automaticScans.changedPaths.set("demo", new Set([modelPath]))
    assert.equal((await vault.perform("scan", {
      candidate_size: 0
    })).started, true)
    await waitForEngine(() =>
      !vault.scanPromise && !vault.scanCompletionPromise)

    assert.equal(await vault.globalScanReady(), true)
    assert.equal(vault.automaticScans.changedPaths.has("demo"), false)
    assert.equal(vault.automaticScans.active, null)
    assert.equal(vault.automaticScans.entries.has("demo"), false)
    await vault.automaticScans.scanFinished({
      scopeId: null,
      result: { outcome: "cancelled" },
      error: null
    })
    assert.equal(await vault.globalScanReady(), true)
    await vault.automaticScans.scanFinished({
      scopeId: null,
      result: null,
      error: new Error("scan failed")
    })
    assert.equal(await vault.globalScanReady(), true)
    assert.equal(vault.automaticScans.active, null)
    assert.deepEqual(vault.automaticScans.snapshot().rows, [])
    assert.equal((await vault.perform("scan", {
      scope_id: source.id,
      candidate_size: 0
    })).started, true)
    await waitForEngine(() =>
      !vault.scanPromise && !vault.scanCompletionPromise)
    await close(vault)
  })

  test("locations and anchor stores persist in the Disk Saver config", async () => {
    const base = await makeHome()
    const home = path.join(base, "pinokio")
    let external = path.join(base, "Documents")
    await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
    await fs.promises.mkdir(external)
    external = await fs.promises.realpath(external)
    const store = {
      root: path.join(base, ".pinokio"),
      get: () => { throw new Error("Global config must not be read.") },
      set: () => { throw new Error("Global config must not be written.") }
    }
    const firstKernel = {
      homedir: home,
      platform: process.platform,
      store
    }
    const first = new Vault(firstKernel)
    firstKernel.vault = first
    await first.init()
    const added = await first.addExternalSource(external)

    assert.equal(added.created, true)
    const saved = JSON.parse(await fs.promises.readFile(
      path.join(home, "vault", "config.json"), "utf8"))
    assert.deepEqual(saved.locations, [external])
    assert.equal(saved.anchor_stores.length, 1)
    assert.equal(saved.anchor_stores[0].version, 1)
    assert.equal(fs.existsSync(first.blobRoot), false)
    await close(first)
    await fs.promises.unlink(path.join(home, "vault", "registry.sqlite3"))

    const secondKernel = {
      homedir: home,
      platform: process.platform,
      store
    }
    const second = new Vault(secondKernel)
    secondKernel.vault = second
    await second.init()
    assert.equal(second.sources().some((source) =>
      source.kind === "external" && source.root === external), true)
    assert.equal(second.anchorStores().length, 1)
    assert.equal(await second.registry.countFiles(), 0)
    assert.equal(
      (await fs.promises.readdir(second.root)).every((name) =>
        name === "config.json" || name.startsWith("registry.sqlite3")),
      true
    )
    await close(second)
  })

  test("removing a location revokes it before registry cleanup", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "app", "model.bin"), contents)
    const filePath = await write(
      path.join(outside, "models", "model.bin"),
      contents
    )
    const canonicalFilePath = await fs.promises.realpath(filePath)
    const added = await vault.addExternalSource(outside)
    await vault.sweeper.scan()
    const externalRow = await vault.registry.getFile(canonicalFilePath)
    assert.ok(externalRow && externalRow.hash)

    const removeState = vault.registry.removeExternalSourceState
    vault.registry.removeExternalSourceState = async () => {
      throw new Error("Synthetic registry cleanup failure")
    }
    await assert.rejects(vault.perform("remove_source", {
      source_id: added.source.id
    }), /Synthetic registry cleanup failure/)
    vault.registry.removeExternalSourceState = removeState

    assert.deepEqual(vault.configuredLocations(), [])
    assert.equal(vault.sources().some((source) =>
      source.id === added.source.id), false)
    assert.equal(vault.sourceForPath(
      canonicalFilePath, added.source.id), null)
    assert.match((await vault.perform("scan", {
      scope_id: added.source.id
    })).error, /no longer available/i)
    assert.ok(await vault.registry.getFile(canonicalFilePath))
    const status = await vault.status()
    assert.equal(status.inventory.counts.all, 1)
    assert.equal(status.items.some((item) =>
      item.path === canonicalFilePath), false)
    assert.equal(status.items.some((item) =>
      (item.locations || []).some((location) =>
        location.path === canonicalFilePath)), false)
    const searched = await vault.status(null, { query: "model.bin" })
    assert.equal(searched.inventory.current.count, 1)
    assert.equal(searched.items.some((item) =>
      item.path === canonicalFilePath), false)
    const children = await vault.duplicateGroupChildren(
      null, externalRow.hash)
    assert.equal(children.items.some((item) =>
      item.path === canonicalFilePath), false)
    const selection = await vault.duplicateGroupSelection(
      null, externalRow.hash)
    assert.equal(selection.paths.includes(canonicalFilePath), false)
    await close(vault)

    const restarted = new Vault({
      homedir: home,
      platform: process.platform
    })
    await restarted.init()
    assert.ok(await restarted.registry.getFile(canonicalFilePath))
    const restartedStatus = await restarted.status()
    assert.equal(restartedStatus.inventory.counts.all, 1)
    assert.equal(restartedStatus.items.some((item) =>
      item.path === canonicalFilePath), false)
    await close(restarted)
  })

  test("an anchor root on another device is unavailable when opened", async () => {
    const { vault } = await makeVault()
    const store = vault.anchorStores()[0]
    await fs.promises.mkdir(
      path.join(store.root, "sha256"), { recursive: true })
    const originalLstat = fs.promises.lstat
    fs.promises.lstat = async (filePath, ...args) => {
      const stat = await originalLstat(filePath, ...args)
      if (path.resolve(filePath) !== path.resolve(store.root)) return stat
      return new Proxy(stat, {
        get(target, property) {
          if (property === "dev") return Number(target.dev) + 1
          const value = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        }
      })
    }
    try {
      await vault.refreshAnchorStores()
    } finally {
      fs.promises.lstat = originalLstat
    }

    const refreshed = vault.anchorStores().find((candidate) =>
      candidate.id === store.id)
    assert.equal(refreshed.available, false)
    assert.equal(refreshed.dev, null)
    assert.equal(refreshed.error, "different_device")
    assert.equal(vault.anchorStoreForDevice(store.dev), null)
    await close(vault)
  })

  test("Find folders verifies outside copies without publishing or changing files", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(4096)
    const pinokioFile = await writeCandidate(
      path.join(home, "api", "app", "model.bin"), contents)
    const direct = await writeCandidate(
      path.join(outside, "other-app", "model.bin"), contents)
    const nested = await writeCandidate(
      path.join(outside, "other-app", "models", "model.bin"),
      contents
    )
    const before = await Promise.all([
      fs.promises.stat(pinokioFile),
      fs.promises.stat(direct),
      fs.promises.stat(nested)
    ])

    await vault.sweeper.scan()
    assert.equal((await vault.registry.getFile(pinokioFile)).hash, null)
    const publishedFiles = await vault.registry.countFiles()
    const configBefore = vault.readConfig()
    const refreshAnchorStores = vault.refreshAnchorStores.bind(vault)
    let anchorRefreshes = 0
    vault.refreshAnchorStores = async (...args) => {
      anchorRefreshes += 1
      return refreshAnchorStores(...args)
    }
    const workSummary = vault.registry.folderDiscoveryWorkSummary
      .bind(vault.registry)
    let workSummaries = 0
    vault.registry.folderDiscoveryWorkSummary = async (...args) => {
      workSummaries += 1
      return workSummary(...args)
    }

    const started = await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })
    assert.equal(started.started, true)
    await vault.folderDiscoveryPromise
    vault.refreshAnchorStores = refreshAnchorStores

    const discovery = vault.folderDiscoveryStatus()
    assert.equal(discovery.phase, "complete", discovery.error)
    assert.equal(discovery.result_count, 1)
    assert.equal(discovery.result_files, 2)
    assert.equal(discovery.result_bytes, MINIMUM_CANDIDATE_SIZE * 2)
    assert.equal(discovery.candidates_known, true)
    assert.equal(discovery.processed, discovery.candidates)
    assert.equal(discovery.verified_files, 2)
    assert.equal(discovery.verified_bytes, MINIMUM_CANDIDATE_SIZE * 2)
    const results = await vault.folderDiscoveryResults()
    assert.equal(results.total, 1)
    assert.equal(results.root.folder,
      await fs.promises.realpath(outside))
    assert.equal(results.items[0].folder,
      path.join(await fs.promises.realpath(outside), "other-app"))
    assert.equal(results.items[0].file_count, 2)
    assert.equal(results.items[0].bytes, MINIMUM_CANDIDATE_SIZE * 2)
    assert.equal(results.items[0].eligible_file_count, 2)
    const recommendations = await vault.registry
      .folderDiscoveryRecommendations(vault.folderFinder.runId)
    assert.deepEqual(recommendations.items.map((entry) => entry.folder),
      [results.items[0].folder])
    assert.equal(Object.hasOwn(results.items[0], "tree"), false)
    const children = await vault.folderDiscoveryChildren(
      results.items[0].folder)
    assert.equal(children.items[0].folder,
      path.join(results.items[0].folder, "models"))
    assert.equal(await vault.registry.countFiles(), publishedFiles)
    assert.equal(vault.configuredLocations().length, 0)
    assert.deepEqual(vault.readConfig(), configBefore)
    assert.equal(anchorRefreshes, 0)
    assert.ok(workSummaries >= 2)

    const after = await Promise.all([
      fs.promises.stat(pinokioFile),
      fs.promises.stat(direct),
      fs.promises.stat(nested)
    ])
    assert.deepEqual(after.map((stat) => [stat.dev, stat.ino, stat.nlink]),
      before.map((stat) => [stat.dev, stat.ino, stat.nlink]))

    const added = await vault.perform("add_source", {
      path: results.items[0].folder
    })
    assert.equal(added.created, true)
    assert.equal(await vault.registry.getFile(direct), null)
    await close(vault)
  })

  test("Find folders returns navigable clusters and adds an exact non-overlapping batch", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const first = crypto.randomBytes(4096)
    const second = crypto.randomBytes(6144)
    const unrelated = crypto.randomBytes(7168)
    await writeCandidate(path.join(home, "api", "first", "model.bin"), first)
    await writeCandidate(path.join(home, "api", "second", "model.bin"), second)
    const unrelatedPath = await writeCandidate(
      path.join(home, "api", "unrelated-a", "model.bin"), unrelated)
    await writeCandidate(
      path.join(home, "api", "unrelated-b", "model.bin"), unrelated)
    const comfy = path.join(outside, ".comfycraft")
    const release = path.join(outside, "pinokio_2026_0627")
    await writeCandidate(path.join(comfy, "kits", "ace", "model.bin"), first)
    await writeCandidate(path.join(comfy, "kits", "hello", "model.bin"), second)
    await write(path.join(comfy, "logs", "history.bin"),
      crypto.randomBytes(2048))
    await writeCandidate(path.join(release, "api", "first", "model.bin"), first)
    await writeCandidate(path.join(release, "api", "second", "model.bin"), second)

    await vault.sweeper.scan()
    const unrelatedHash = (await vault.registry.getFile(unrelatedPath)).hash
    assert.ok(unrelatedHash)
    assert.equal((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await vault.folderDiscoveryPromise

    const results = await vault.folderDiscoveryResults()
    const canonicalOutside = await fs.promises.realpath(outside)
    const canonicalComfy = path.join(canonicalOutside, ".comfycraft")
    const canonicalRelease = path.join(
      canonicalOutside, "pinokio_2026_0627")
    assert.equal(results.total, 2)
    const comfyResult = results.items.find((result) =>
      result.folder === canonicalComfy)
    const releaseResult = results.items.find((result) =>
      result.folder === canonicalRelease)
    assert.ok(comfyResult)
    assert.ok(releaseResult)
    const recommendations = await vault.registry
      .folderDiscoveryRecommendations(vault.folderFinder.runId)
    assert.deepEqual(recommendations.items.map((entry) => entry.folder),
      [canonicalOutside])
    assert.equal(results.root.recommended, true)
    assert.equal(results.root.selected, false)
    assert.equal(results.root.selected_inside, 0)
    assert.equal(results.selection.selected_count, 0)
    const comfyChildren = await vault.folderDiscoveryChildren(
      comfyResult.folder)
    assert.equal(comfyChildren.items[0].folder,
      path.join(canonicalComfy, "kits"))
    const kitChildren = await vault.folderDiscoveryChildren(
      comfyChildren.items[0].folder)
    assert.equal(kitChildren.items.length, 2)
    assert.equal(comfyResult.eligible_file_count, 2)
    assert.equal(comfyResult.file_count, 2)

    const selected = [
      path.join(canonicalComfy, "kits"),
      path.join(canonicalRelease, "api")
    ]
    const discovery = vault.folderDiscoveryStatus()
    await vault.perform("update_folder_discovery_selection", {
      root: discovery.root,
      started: discovery.started,
      path: selected[0],
      selected: true
    })
    const staged = await vault.perform("update_folder_discovery_selection", {
      root: discovery.root,
      started: discovery.started,
      path: selected[1],
      selected: true
    })
    assert.equal(staged.selected_count, 2)
    const selectedResults = await vault.folderDiscoveryResults()
    assert.equal(selectedResults.root.selected, false)
    assert.equal(selectedResults.root.selected_inside, 2)
    assert.equal(vault.configuredLocations().length, 0)
    let configWrites = 0
    const writeConfig = vault.writeConfig.bind(vault)
    vault.writeConfig = (config) => {
      configWrites += 1
      return writeConfig(config)
    }
    let classifiedHashes = []
    const publishSelection = vault.registry.publishFolderDiscoverySelection
      .bind(vault.registry)
    vault.registry.publishFolderDiscoverySelection = async (...args) => {
      classifiedHashes = args[3].map((entry) => entry.hash)
      return publishSelection(...args)
    }
    const added = await vault.perform("add_folder_discovery_sources", {
      root: discovery.root,
      started: discovery.started
    })
    assert.equal(added.created_count, 2)
    assert.equal(added.published_files, 4)
    assert.equal(configWrites, 1)
    assert.equal(classifiedHashes.includes(unrelatedHash), false)
    assert.deepEqual(vault.configuredLocations().sort(), selected.sort())
    assert.equal(vault.folderFinder.runId, null)
    assert.equal((await vault.folderDiscoveryResults()).total, 0)
    for (const filePath of [
      path.join(canonicalComfy, "kits", "ace", "model.bin"),
      path.join(canonicalRelease, "api", "second", "model.bin")
    ]) {
      const published = await vault.registry.getFile(filePath)
      assert.ok(published.hash)
      assert.ok(["reference", "duplicate"].includes(published.status))
    }
    await close(vault)
  })

  test("Find folders detects outside-only groups and publishes them without rescanning", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(8192)
    await write(path.join(home, "api", "baseline", "unique.bin"),
      crypto.randomBytes(contents.length))
    const first = await writeCandidate(
      path.join(outside, "first-app", "model.bin"), contents)
    const second = await writeCandidate(
      path.join(outside, "second-app", "model.bin"), contents)

    await vault.sweeper.scan()
    assert.equal((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await vault.folderDiscoveryPromise

    const discovery = vault.folderDiscoveryStatus()
    const results = await vault.folderDiscoveryResults()
    assert.equal(discovery.result_files, 2)
    assert.equal(discovery.result_bytes, MINIMUM_CANDIDATE_SIZE * 2)
    assert.equal(results.selection.selected_count, 0)
    await vault.perform("update_folder_discovery_selection", {
      root: discovery.root,
      started: discovery.started,
      path: results.root.folder,
      selected: true
    })
    const staged = (await vault.folderDiscoveryResults()).selection
    assert.equal(staged.selected_count, 1)
    assert.equal(staged.selected_files, 2)
    assert.equal(staged.potential_savings, MINIMUM_CANDIDATE_SIZE)

    vault.hashFile = async () => {
      throw new Error("Adding staged results must not hash files again.")
    }
    const added = await vault.perform("add_folder_discovery_sources", {
      root: discovery.root,
      started: discovery.started
    })
    assert.equal(added.published_files, 2)
    assert.equal(vault.folderFinder.runId, null)
    const firstRow = await vault.registry.getFile(
      await fs.promises.realpath(first))
    const secondRow = await vault.registry.getFile(
      await fs.promises.realpath(second))
    assert.ok(firstRow, JSON.stringify(await vault.registry.files()))
    assert.ok(secondRow, JSON.stringify(await vault.registry.files()))
    assert.equal(firstRow.status, "reference")
    assert.equal(secondRow.status, "duplicate")
    const status = await vault.status()
    assert.equal(status.bytes_without_sharing, contents.length)
    assert.equal(status.logical_bytes,
      MINIMUM_CANDIDATE_SIZE * 2 + contents.length)
    assert.equal(status.pending_bytes, MINIMUM_CANDIDATE_SIZE)
    await close(vault)
  })

  test("Find folders uses a valid anchor even when no published path remains", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    assert.equal((await vault.perform("deduplicate", {
      path: duplicate.path
    })).status, "converted")
    await fs.promises.unlink(pair.first)
    await fs.promises.unlink(pair.second)
    await vault.sweeper.scan()
    assert.equal((await vault.registry.files()).length, 0)

    await writeCandidate(
      path.join(outside, "models", "model.bin"), pair.contents, pair.size)
    assert.equal((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await vault.folderDiscoveryPromise

    const discovery = vault.folderDiscoveryStatus()
    assert.equal(discovery.phase, "complete", discovery.error)
    assert.equal(discovery.result_files, 1)
    assert.equal(discovery.result_bytes, pair.size)
    const results = await vault.folderDiscoveryResults()
    assert.equal(results.total, 1)
    assert.equal(results.selection.selected_count, 0)
    await vault.perform("update_folder_discovery_selection", {
      root: discovery.root,
      started: discovery.started,
      path: results.items[0].folder,
      selected: true
    })
    const selected = (await vault.folderDiscoveryResults()).selection
    assert.equal(selected.selected_files, 1)
    assert.equal(selected.potential_savings, pair.size)
    await close(vault)
  })

  test("a failed discovery publication keeps the selected configuration", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(4096)
    await writeCandidate(path.join(home, "api", "app", "model.bin"), contents)
    const outsideFile = await writeCandidate(
      path.join(outside, "models", "model.bin"), contents)
    const canonicalOutsideFile = await fs.promises.realpath(outsideFile)
    await vault.sweeper.scan()
    await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })
    await vault.folderDiscoveryPromise
    const discovery = vault.folderDiscoveryStatus()
    const results = await vault.folderDiscoveryResults()
    await vault.perform("update_folder_discovery_selection", {
      root: discovery.root,
      started: discovery.started,
      path: results.items[0].folder,
      selected: true
    })
    const configBefore = vault.readConfig()
    const publish = vault.registry.publishFolderDiscoverySelection
    vault.registry.publishFolderDiscoverySelection = async () => {
      throw new Error("Synthetic publication failure")
    }
    await assert.rejects(vault.perform("add_folder_discovery_sources", {
      root: discovery.root,
      started: discovery.started
    }), /Synthetic publication failure/)
    vault.registry.publishFolderDiscoverySelection = publish

    const configured = vault.readConfig()
    assert.deepEqual(configured.anchor_stores, configBefore.anchor_stores)
    assert.deepEqual(configured.locations, [
      await fs.promises.realpath(path.dirname(outsideFile))
    ])
    assert.equal(await vault.registry.getFile(canonicalOutsideFile), null)
    assert.ok(vault.folderFinder.runId)
    const retried = await vault.perform("add_folder_discovery_sources", {
      root: discovery.root,
      started: discovery.started
    })
    assert.equal(retried.created_count, 0)
    assert.equal(retried.published_files, 1)
    assert.ok(await vault.registry.getFile(canonicalOutsideFile))
    await close(vault)
  })

  test("Find folders pages every cluster and recommendation without serializing descendants", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(64)
    await writeCandidate(
      path.join(home, "api", "context", "model.bin"), contents)
    for (let index = 0; index < 501; index++) {
      await writeCandidate(path.join(
        outside,
        `app-${String(index).padStart(3, "0")}`,
        "models",
        "model.bin"
      ), contents)
    }
    await vault.sweeper.scan()
    const resultHash = crypto.createHash("sha256")
      .update(contents)
      .update(Buffer.alloc(MINIMUM_CANDIDATE_SIZE - contents.length))
      .digest("hex")
    vault.hashFile = async (filePath) => ({
      hash: resultHash,
      size: (await fs.promises.stat(filePath)).size
    })
    const prepareResults = vault.registry.prepareFolderDiscoveryResults
      .bind(vault.registry)
    vault.registry.prepareFolderDiscoveryResults = async (runId, root) => {
      const stat = await fs.promises.stat(root)
      // Force recommendations below the root without creating a huge file.
      const staged = await vault.registry.stageFolderDiscoveryFiles(runId, [{
        path: path.join(root, "unrelated.bin"),
        size: MINIMUM_CANDIDATE_SIZE * 1000,
        mtime: stat.mtimeMs,
        ctime: stat.ctimeMs,
        dev: stat.dev,
        ino: 0,
        nlink: 1,
        mode: stat.mode,
        uid: stat.uid,
        gid: stat.gid
      }])
      assert.equal(staged.changes, 1)
      return prepareResults(runId, root)
    }
    assert.equal((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await vault.folderDiscoveryPromise

    const first = await vault.folderDiscoveryResults(0)
    const second = await vault.folderDiscoveryResults(1)
    const firstRecommendations = await vault.registry
      .folderDiscoveryRecommendations(vault.folderFinder.runId, 0, 500)
    const secondRecommendations = await vault.registry
      .folderDiscoveryRecommendations(vault.folderFinder.runId, 1, 500)
    assert.equal(first.total, 501)
    assert.equal(first.items.length, 500)
    assert.equal(second.items.length, 1)
    assert.equal(Object.hasOwn(first, "recommendations"), false)
    assert.equal(firstRecommendations.total, 501)
    assert.equal(firstRecommendations.items.length, 500)
    assert.equal(secondRecommendations.items.length, 1)
    assert.equal(Object.hasOwn(first.items[0], "tree"), false)
    const children = await vault.folderDiscoveryChildren(
      first.items[0].folder)
    assert.equal(children.items.length, 1)
    assert.equal(children.items[0].name, "models")

    assert.equal(first.selection.selected_count, 0)
    await close(vault)
  })

  test("Find folders splits a broad cluster when either scope dimension is disproportionate", async () => {
    const discover = async (extraSizes) => {
      const { home, vault } = await makeVault()
      const outside = await makeOutside()
      const first = crypto.randomBytes(1000)
      const second = crypto.randomBytes(1000)
      await writeCandidate(
        path.join(home, "api", "first", "model.bin"), first)
      await writeCandidate(
        path.join(home, "api", "second", "model.bin"), second)
      await writeCandidate(
        path.join(outside, "group", "a", "model.bin"), first)
      await writeCandidate(
        path.join(outside, "group", "b", "model.bin"), second)
      for (let index = 0; index < extraSizes.length; index++) {
        const size = Math.max(
          MINIMUM_CANDIDATE_SIZE,
          MINIMUM_CANDIDATE_SIZE * extraSizes[index] / 1000
        )
        await writeCandidate(
          path.join(outside, "group", `extra-${index}.bin`),
          crypto.randomBytes(extraSizes[index]),
          size
        )
      }
      await vault.sweeper.scan()
      await vault.perform("find_folders", {
        path: outside,
        candidate_size: CANDIDATE_SIZE_OPTIONS[0]
      })
      await vault.folderDiscoveryPromise
      const folders = (await vault.registry.folderDiscoveryRecommendations(
        vault.folderFinder.runId)).items.map((entry) => entry.folder)
      await close(vault)
      return { outside: await fs.promises.realpath(outside), folders }
    }

    const byteSkew = await discover([5000])
    assert.deepEqual(byteSkew.folders.sort(), ["a", "b"].map((name) =>
      path.join(byteSkew.outside, "group", name)).sort())
    const countSkew = await discover([1, 2, 3])
    assert.deepEqual(countSkew.folders.sort(), ["a", "b"].map((name) =>
      path.join(countSkew.outside, "group", name)).sort())
    const balanced = await discover([1])
    assert.deepEqual(balanced.folders,
      [path.join(balanced.outside, "group")])
  })

  test("Find folders uses a selected supported threshold and waits for active scans", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const selectedThreshold = CANDIDATE_SIZE_OPTIONS[1]
    const contents = crypto.randomBytes(selectedThreshold + 4096)
    await write(path.join(home, "api", "app", "model.bin"), contents)
    await write(path.join(outside, "models", "model.bin"), contents)
    await write(path.join(outside, "models", "below-threshold.bin"),
      crypto.randomBytes(512))
    vault.sizeThreshold = 0
    await vault.sweeper.scan()
    await vault.perform("set_candidate_size", {
      candidate_size: selectedThreshold
    })

    const stageDiscoveryFiles = vault.registry.stageFolderDiscoveryFiles
      .bind(vault.registry)
    const stagedSizes = []
    vault.registry.stageFolderDiscoveryFiles = async (runId, entries) => {
      stagedSizes.push(...entries.map((entry) => entry.size))
      return stageDiscoveryFiles(runId, entries)
    }

    vault.scanPromise = new Promise(() => {})
    assert.match((await vault.perform("find_folders", {
      path: outside,
      candidate_size: selectedThreshold
    })).error, /current scan/i)
    vault.scanPromise = null

    const started = await vault.perform("find_folders", {
      path: outside,
      candidate_size: selectedThreshold
    })
    assert.equal(started.threshold, selectedThreshold)
    await vault.folderDiscoveryPromise
    assert.equal(vault.folderDiscoveryStatus().threshold, selectedThreshold)
    assert.equal(vault.folderDiscoveryStatus().result_count, 1)
    assert.ok(stagedSizes.length > 0)
    assert.ok(stagedSizes.every((size) => size >= selectedThreshold))
    await close(vault)
  })

  test("Find folders requires a new global scan for a lower threshold", async () => {
    const { vault } = await makeVault()
    const outside = await makeOutside()
    const indexedThreshold = CANDIDATE_SIZE_OPTIONS[1]
    vault.sizeThreshold = indexedThreshold
    await vault.sweeper.scan()

    const result = await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })
    assert.match(result.error, /global scan.*minimum file size/i)
    assert.equal(vault.folderDiscoveryPromise, null)
    await close(vault)
  })

  test("Find folders ignores request thresholds and uses the saved setting", async () => {
    const { vault } = await makeVault()
    const outside = await makeOutside()
    const thresholds = []
    vault.startFolderDiscovery = (folderPath, threshold) => {
      thresholds.push(threshold)
      return { started: true }
    }

    assert.deepEqual(await vault.perform("find_folders", {
      path: outside,
      candidate_size: 123
    }), { started: true })
    assert.deepEqual(thresholds, [CANDIDATE_SIZE_OPTIONS[0]])
    assert.equal((await vault.status()).candidate_min_bytes,
      CANDIDATE_SIZE_OPTIONS[0])
    await close(vault)
  })

  test("Find folders does not infer a missing indexed threshold", async () => {
    const { vault } = await makeVault()
    const outside = await makeOutside()
    vault.scanForScope = async () => ({
      ts: Date.now(),
      outcome: "complete"
    })

    assert.match((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).error, /new global scan/i)
    assert.equal(vault.folderDiscoveryPromise, null)
    await close(vault)
  })

  test("Find folders treats a failure to open the selected root as fatal", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "app", "model.bin"), contents)
    await write(path.join(outside, "models", "model.bin"), contents)
    await vault.sweeper.scan()

    const canonicalRoot = await fs.promises.realpath(outside)
    const openDirectory = fs.promises.opendir
    fs.promises.opendir = async (directory, ...args) => {
      if (path.resolve(directory) === canonicalRoot) {
        const error = new Error("The selected root cannot be opened.")
        error.code = "EACCES"
        throw error
      }
      return openDirectory.call(fs.promises, directory, ...args)
    }
    try {
      assert.equal((await vault.perform("find_folders", {
        path: outside,
        candidate_size: CANDIDATE_SIZE_OPTIONS[0]
      })).started, true)
      await vault.folderDiscoveryPromise
    } finally {
      fs.promises.opendir = openDirectory
    }

    assert.equal(vault.folderDiscoveryStatus().phase, "failed")
    assert.match(vault.folderDiscoveryStatus().error, /cannot be opened/i)
    assert.equal(vault.folderFinder.runId, null)
    await close(vault)
  })

  test("Find folders continues past a stale known-reference batch", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(4096)
    const stale = []
    for (let index = 0; index < 32; index++) {
      stale.push(await writeCandidate(
        path.join(home, "api", "app", `a${String(index).padStart(2, "0")}.bin`),
        contents
      ))
    }
    await writeCandidate(
      path.join(home, "api", "app", "z-valid.bin"), contents)
    await writeCandidate(
      path.join(outside, "models", "model.bin"), contents)
    await vault.sweeper.scan()

    for (let index = 0; index < stale.length; index++) {
      await fs.promises.writeFile(
        stale[index], Buffer.alloc(contents.length, index + 1))
      const changed = new Date(Date.now() + 10000 + index)
      await fs.promises.utimes(stale[index], changed, changed)
    }

    assert.equal((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await vault.folderDiscoveryPromise

    assert.equal(vault.folderDiscoveryStatus().phase,
      "completed_with_exclusions")
    assert.equal(vault.folderDiscoveryStatus().result_count, 1)
    const results = await vault.folderDiscoveryResults()
    assert.equal(results.items[0].file_count, 1)
    const discovery = vault.folderDiscoveryStatus()
    assert.equal(results.selection.selected_count, 0)
    await vault.perform("update_folder_discovery_selection", {
      root: discovery.root,
      started: discovery.started,
      path: results.items[0].folder,
      selected: true
    })

    let releasePublish
    let publishStarted
    const publishing = new Promise((resolve) => { publishStarted = resolve })
    const publishGate = new Promise((resolve) => { releasePublish = resolve })
    const publishSelection = vault.registry.publishFolderDiscoverySelection
      .bind(vault.registry)
    vault.registry.publishFolderDiscoverySelection = async (...args) => {
      publishStarted()
      await publishGate
      return publishSelection(...args)
    }
    const adding = vault.perform("add_folder_discovery_sources", {
      root: discovery.root,
      started: discovery.started
    })
    await publishing
    assert.match((await vault.clearFolderDiscovery()).error,
      /finish being added/i)
    assert.match((await vault.startFolderDiscovery(
      outside, CANDIDATE_SIZE_OPTIONS[0])).error,
      /finish being added/i)
    releasePublish()
    assert.equal((await adding).created_count, 1)
    assert.equal(vault.folderFinder.runId, null)
    await close(vault)
  })

  test("Find folders requires a published global scan and rejects covered roots", async () => {
    const { home, vault } = await makeVault()
    assert.match((await vault.perform("find_folders", {
      path: home,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).error, /global scan/i)

    await write(path.join(home, "api", "app", "model.bin"),
      crypto.randomBytes(4096))
    await vault.sweeper.scan()
    assert.equal((await vault.perform("find_folders", {
      path: home,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await vault.folderDiscoveryPromise
    assert.equal(vault.folderDiscoveryStatus().phase, "failed")
    assert.match(vault.folderDiscoveryStatus().error,
      /already in Locations/i)
    assert.equal(vault.folderFinder.runId, null)
    await close(vault)
  })

  test("Find folders cancellation discards its temporary staging", async () => {
    const { home, vault } = await makeVault()
    const outside = await makeOutside()
    const contents = crypto.randomBytes(4096)
    await writeCandidate(
      path.join(home, "api", "app", "model.bin"), contents)
    await writeCandidate(
      path.join(outside, "models", "model.bin"), contents)
    await vault.sweeper.scan()
    const publishedFiles = await vault.registry.countFiles()
    vault.hashFile = async () => {
      await waitForEngine(() => vault.folderFinder.cancelRequested)
      const error = new Error("Folder search cancelled.")
      error.code = "EVAULTCANCELLED"
      throw error
    }

    assert.equal((await vault.perform("find_folders", {
      path: outside,
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })).started, true)
    await waitForEngine(() => !!vault.folderFinder.currentHash)
    assert.equal((await vault.perform(
      "cancel_find_folders")).cancel_requested, true)
    await vault.folderDiscoveryPromise

    assert.equal(vault.folderDiscoveryStatus().phase, "cancelled")
    assert.equal(vault.folderFinder.runId, null)
    assert.equal((await vault.folderDiscoveryResults()).total, 0)
    assert.equal(await vault.registry.countFiles(), publishedFiles)
    await close(vault)
  })

  test("a missing Disk Saver config resets the registry but preserves anchors", async () => {
    const { home, kernel, vault } = await makeVault()
    const outside = await makeOutside()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    assert.equal(await vault.globalScanReady(), true)
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    await vault.addExternalSource(outside)
    const anchorPath = vault.storePathFor(duplicate.hash)
    assert.equal(fs.existsSync(anchorPath), true)
    await close(vault)

    await fs.promises.unlink(path.join(home, "vault", "config.json"))
    const replacement = new Vault({
      homedir: home,
      platform: process.platform,
      store: kernel.store
    })
    await replacement.init()
    replacement.sizeThreshold = pair.size * 2

    assert.deepEqual(replacement.configuredLocations(), [])
    assert.equal(await replacement.globalScanReady(), false)
    assert.equal(await replacement.registry.countFiles(), 0)
    assert.equal(fs.existsSync(anchorPath), true)
    await replacement.sweeper.scan()
    assert.equal(
      (await replacement.registry.getFile(duplicate.path)).status,
      "linked"
    )
    await close(replacement)
  })

  test("deduplication refuses legacy scan results below 10 MB", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const pair = {
      first: await write(path.join(home, "api", "first", "small.bin"),
        contents),
      second: await write(path.join(home, "api", "second", "small.bin"),
        contents)
    }
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const result = await vault.perform("deduplicate", {
      path: duplicate.path
    })

    assert.equal(result.status, "unavailable")
    assert.equal(result.unavailable_reason, "below_minimum_size")
    const [first, second] = await Promise.all([
      fs.promises.stat(pair.first),
      fs.promises.stat(pair.second)
    ])
    assert.notEqual(first.ino, second.ino)
    await close(vault)
  })

  test("explicit deduplication creates the first anchor and changes one path atomically", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)

    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    assert.ok(duplicate)
    assert.equal((await fs.promises.stat(pair.first)).nlink, 1)
    assert.equal((await fs.promises.stat(pair.second)).nlink, 1)
    assert.equal(fs.existsSync(vault.blobRoot), false)

    const result = await vault.perform("deduplicate", {
      path: duplicate.path
    })
    assert.equal(result.status, "converted")
    assert.equal(result.bytes_saved, pair.size)

    const firstStat = await fs.promises.stat(pair.first)
    const secondStat = await fs.promises.stat(pair.second)
    const current = await vault.registry.getFile(duplicate.path)
    assert.equal(firstStat.ino, secondStat.ino)
    assert.equal(current.status, "linked")
    assert.equal(
      fs.existsSync(vault.storePathFor(duplicate.hash)),
      true
    )
    assert.deepEqual(
      await fs.promises.readdir(path.dirname(vault.blobRoot)),
      ["sha256"]
    )
    await close(vault)
  })

  test("revealing works for any tracked path, whatever the scope", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home, 'model "quoted".bin')
    await vault.sweeper.scan()

    const first = await vault.registry.getFile(pair.first)
    const second = await vault.registry.getFile(pair.second)
    const launched = []
    vault.fileManagerLauncher = async (filePath) => {
      launched.push(filePath)
    }

    assert.deepEqual(await vault.perform("reveal", {
      scope_id: first.source_id,
      path: pair.first
    }), { revealed: true })
    assert.deepEqual(launched, [pair.first])

    assert.notEqual(first.source_id, second.source_id)
    assert.deepEqual(await vault.perform("reveal", {
      scope_id: first.source_id,
      path: pair.second
    }), { revealed: true })
    assert.deepEqual(launched, [pair.first, pair.second])

    const untracked = await vault.perform("reveal", {
      path: path.join(home, "api", "first", "missing.bin")
    })
    assert.match(untracked.error, /no longer tracked/i)
    assert.deepEqual(launched, [pair.first, pair.second])

    await close(vault)
  })

  test("bulk Deduplicate changes only the selected duplicate paths", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home, "first.bin")
    await duplicatePair(home, "second.bin")
    await duplicatePair(home, "unselected.bin")
    await vault.sweeper.scan()

    const pending = [...await vault.registry.files({
      statuses: ["duplicate"]
    })]
    assert.equal(pending.length, 3)
    const selected = pending.slice(0, 2)
    const unselected = pending[2]

    const result = await vault.perform("deduplicate_files", {
      paths: selected.map((entry) => entry.path)
    })

    assert.equal(result.converted, 2)
    assert.equal(result.failed, 0)
    assert.equal(result.results.length, 2)
    for (const entry of selected) {
      assert.equal(
        (await vault.registry.getFile(entry.path)).status,
        "linked"
      )
    }
    assert.equal(
      (await vault.registry.getFile(unselected.path)).status,
      "duplicate"
    )
    const tooMany = await vault.perform("deduplicate_files", {
      paths: Array.from({ length: 501 }, (_, index) =>
        path.join(home, `file-${index}.bin`))
    })
    assert.match(tooMany.error, /valid duplicate files/)
    await close(vault)
  })

  test("Duplicate Files pages content groups and lazily resolves exact paths", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "first", "original.bin"), contents)
    const copy = await write(
      path.join(home, "api", "second", "copy.bin"), contents)
    await write(path.join(home, "api", "third", "another-name.bin"), contents)
    const otherContents = crypto.randomBytes(2048)
    await write(path.join(home, "api", "fourth", "other.bin"), otherContents)
    await write(path.join(home, "api", "fifth", "other.bin"), otherContents)
    await vault.sweeper.scan()

    const pending = await vault.registry.files({
      statuses: ["duplicate"]
    })
    assert.equal(pending.length, 3)
    const hash = (await vault.registry.getFile(copy)).hash
    const scopedDuplicate = pending.find((entry) => entry.hash === hash)
    const grouped = await vault.status(null, {
      view: "duplicates",
      display_mode: "files",
      size_sort: "desc",
      page_size: 500
    })

    assert.equal(grouped.inventory.current.count, 3)
    assert.equal(
      grouped.inventory.current.deduplicate_bytes,
      (contents.length * 2) + otherContents.length
    )
    assert.equal(grouped.inventory.total, 2)
    assert.equal(grouped.items.length, 2)
    const contentGroup = grouped.items.find((entry) => entry.hash === hash)
    assert.equal(contentGroup.kind, "duplicate_group")
    assert.equal(contentGroup.total_count, 3)
    assert.equal(contentGroup.eligible_count, 2)
    assert.equal(contentGroup.can_save, contents.length * 2)
    const firstGroupPage = await vault.status(null, {
      view: "duplicates",
      display_mode: "files",
      size_sort: "desc",
      page_size: 1
    })
    const secondGroupPage = await vault.status(null, {
      view: "duplicates",
      display_mode: "files",
      size_sort: "desc",
      page_size: 1,
      cursor: firstGroupPage.inventory.next_cursor,
      page: 1
    })
    assert.ok(firstGroupPage.inventory.next_cursor)
    assert.notEqual(
      firstGroupPage.items[0].hash,
      secondGroupPage.items[0].hash
    )
    const firstPageSelection = await vault.duplicateGroupPageSelection(null, {
      size_sort: "desc",
      page_size: 1
    })
    assert.equal(firstPageSelection.exceeded, false)
    assert.equal(
      firstPageSelection.items.length,
      firstGroupPage.items[0].eligible_count
    )
    assert.equal(firstPageSelection.items.every((entry) =>
      entry.hash === firstGroupPage.items[0].hash), true)
    const searched = await vault.status(null, {
      view: "duplicates",
      display_mode: "files",
      query: "copy.bin",
      page_size: 500
    })
    assert.equal(searched.inventory.current.count, 1)
    assert.equal(searched.inventory.current.shareable_bytes, contents.length)
    assert.equal(
      searched.inventory.current.deduplicate_bytes,
      (contents.length * 2) + otherContents.length
    )
    assert.equal(searched.inventory.total, 1)
    assert.equal(searched.items[0].path, copy)
    assert.equal(searched.items[0].total_count, 3)
    assert.equal(searched.items[0].eligible_count, 1)

    const children = await vault.duplicateGroupChildren(null, hash)
    assert.equal(children.total, 3)
    assert.equal(children.items.length, 3)
    assert.equal(children.items.filter((entry) => entry.selectable).length, 2)
    assert.equal(children.items.some((entry) =>
      entry.registry_status === "reference"), true)
    const firstChildPage = await vault.duplicateGroupChildren(null, hash, {
      page_size: 1
    })
    const secondChildPage = await vault.duplicateGroupChildren(null, hash, {
      page_size: 1,
      cursor: firstChildPage.next_cursor
    })
    assert.ok(firstChildPage.next_cursor)
    assert.notEqual(
      firstChildPage.items[0].path,
      secondChildPage.items[0].path
    )

    const scoped = await vault.status(null, {
      view: "duplicates",
      display_mode: "files",
      location_id: scopedDuplicate.source_id,
      page_size: 500
    })
    assert.equal(scoped.items[0].total_count, 3)
    assert.equal(scoped.items[0].eligible_count, 1)
    const scopedChildren = await vault.duplicateGroupChildren(null, hash, {
      location_id: scopedDuplicate.source_id
    })
    assert.equal(scopedChildren.items.length, 3)
    assert.equal(scopedChildren.items.filter((entry) =>
      entry.selectable).length, 1)
    const selection = await vault.duplicateGroupSelection(null, hash, {
      location_id: scopedDuplicate.source_id
    })
    assert.deepEqual(selection.paths, [scopedDuplicate.path])
    assert.equal(selection.exceeded, false)
    const scopedPageSelection = await vault.duplicateGroupPageSelection(null, {
      location_id: scopedDuplicate.source_id
    })
    assert.deepEqual(
      scopedPageSelection.items.map((entry) => entry.path),
      [scopedDuplicate.path]
    )

    const appGrouped = await vault.status(scopedDuplicate.source_id, {
      view: "duplicates",
      display_mode: "files",
      page_size: 500
    })
    assert.equal(appGrouped.items.length, 1)
    assert.equal(appGrouped.items[0].total_count, 1)
    assert.equal(appGrouped.items[0].eligible_count, 1)
    const appChildren = await vault.duplicateGroupChildren(
      scopedDuplicate.source_id,
      hash
    )
    assert.deepEqual(
      appChildren.items.map((entry) => entry.path),
      [scopedDuplicate.path]
    )
    const appSelection = await vault.duplicateGroupSelection(
      scopedDuplicate.source_id,
      hash
    )
    assert.deepEqual(appSelection.paths, [scopedDuplicate.path])
    const appPageSelection = await vault.duplicateGroupPageSelection(
      scopedDuplicate.source_id
    )
    assert.deepEqual(
      appPageSelection.items.map((entry) => entry.path),
      [scopedDuplicate.path]
    )

    await close(vault)
  })

  test("an unsupported filesystem leaves files unchanged and becomes unavailable", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const before = await fs.promises.stat(duplicate.path)
    vault.probe = async () => "copy"

    const result = await vault.perform("deduplicate", {
      path: duplicate.path
    })

    assert.deepEqual(result, {
      status: "unavailable",
      unavailable_reason: "hardlinks"
    })
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    const rows = await vault.registry.files({ hash: duplicate.hash })
    assert.equal(rows.every((row) =>
      row.status === "unavailable" &&
      row.unavailable_reason === "hardlinks"), true)
    await close(vault)
  })

  test("a destination write denial becomes unavailable without changing the file", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const before = await fs.promises.stat(duplicate.path)
    const link = fs.promises.link
    fs.promises.link = async (source, destination) => {
      if (destination === `${duplicate.path}.pinokio-dedup-tmp`) {
        const error = new Error("The destination cannot be modified.")
        error.code = "EACCES"
        throw error
      }
      return link.call(fs.promises, source, destination)
    }

    let result
    try {
      result = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      fs.promises.link = link
    }

    assert.deepEqual(result, {
      status: "unavailable",
      unavailable_reason: "permission_denied"
    })
    const summary = vault.deduplicationSummary()
    vault.addDeduplicationResult(summary, result)
    assert.deepEqual(summary.unavailable_by_reason, {
      permission_denied: 1
    })
    const row = await vault.registry.getFile(duplicate.path)
    assert.equal(row.status, "unavailable")
    assert.equal(row.unavailable_reason, "permission_denied")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    const status = await vault.status(null, { view: "duplicates" })
    const unavailable = await vault.status(null, { view: "unavailable" })
    assert.equal(status.inventory.counts.duplicates, 0)
    assert.equal(status.inventory.counts.unavailable, 1)
    assert.equal(unavailable.items[0].unavailable_reason,
      "permission_denied")

    await vault.sweeper.scan()
    const rescanned = await vault.registry.getFile(duplicate.path)
    assert.equal(rescanned.status, "unavailable")
    assert.equal(rescanned.unavailable_reason, "permission_denied")

    fs.promises.link = async (source, destination) => {
      if (destination === `${duplicate.path}.pinokio-dedup-tmp`) {
        const error = new Error("The destination still cannot be modified.")
        error.code = "EACCES"
        throw error
      }
      return link.call(fs.promises, source, destination)
    }
    let stillDenied
    try {
      stillDenied = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      fs.promises.link = link
    }
    assert.deepEqual(stillDenied, {
      status: "unavailable",
      unavailable_reason: "permission_denied"
    })

    const retried = await vault.perform("deduplicate", {
      path: duplicate.path
    })
    assert.equal(retried.status, "converted")
    assert.equal(
      (await vault.registry.getFile(duplicate.path)).status,
      "linked"
    )
    await close(vault)
  })

  test("an unavailable store is recorded even when reclassification cannot read it", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const targetStat = await fs.promises.stat(duplicate.path)
    const store = vault.anchorStoreForDevice(targetStat.dev)
    const storePath = vault.storePathFor(duplicate.hash, store.id)
    const storeStatIfPresent = vault.storeStatIfPresent
    vault.storeStatIfPresent = async (filePath, ...args) => {
      if (filePath === storePath) {
        const error = new Error("The anchor store cannot be read.")
        error.code = "EACCES"
        throw error
      }
      return storeStatIfPresent.call(vault, filePath, ...args)
    }

    let result
    try {
      result = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      vault.storeStatIfPresent = storeStatIfPresent
    }

    assert.deepEqual(result, {
      status: "unavailable",
      unavailable_reason: "permission_denied"
    })
    const row = await vault.registry.getFile(duplicate.path)
    assert.equal(row.status, "unavailable")
    assert.equal(row.unavailable_reason, "permission_denied")
    await close(vault)
  })

  test("a scan reclassifies an action-time hardlink failure", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const link = fs.promises.link
    fs.promises.link = async (source, destination) => {
      if (destination === `${duplicate.path}.pinokio-dedup-tmp`) {
        const error = new Error("Hardlinks are unavailable here.")
        error.code = "ENOTSUP"
        throw error
      }
      return link.call(fs.promises, source, destination)
    }

    let result
    try {
      result = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      fs.promises.link = link
    }

    assert.deepEqual(result, {
      status: "unavailable",
      unavailable_reason: "hardlinks"
    })
    await vault.sweeper.scan()
    const rescanned = await vault.registry.getFile(duplicate.path)
    assert.equal(rescanned.status, "duplicate")
    assert.equal(rescanned.unavailable_reason, null)
    assert.equal((await vault.perform("deduplicate", {
      path: duplicate.path
    })).status, "converted")
    await close(vault)
  })

  test("an action-time metadata mismatch becomes unavailable", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const before = await fs.promises.stat(duplicate.path)
    const ensureAnchorForHash = vault.ensureAnchorForHash
    vault.ensureAnchorForHash = async (...args) => {
      const prepared = await ensureAnchorForHash.apply(vault, args)
      if (prepared.status === "ready") {
        const anchorPath = vault.storePathFor(
          duplicate.hash, prepared.store_id)
        const anchor = await fs.promises.stat(anchorPath)
        await fs.promises.chmod(
          anchorPath,
          (anchor.mode & 0o7777) ^ 0o100
        )
      }
      return prepared
    }

    let result
    try {
      result = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      vault.ensureAnchorForHash = ensureAnchorForHash
    }

    assert.deepEqual(result, {
      status: "unavailable",
      unavailable_reason: "metadata"
    })
    const row = await vault.registry.getFile(duplicate.path)
    assert.equal(row.status, "unavailable")
    assert.equal(row.unavailable_reason, "metadata")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    await close(vault)
  })

  test("an action-time store device mismatch becomes unavailable", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const before = await fs.promises.stat(duplicate.path)
    const ensureAnchorForHash = vault.ensureAnchorForHash
    const storeStatIfPresent = vault.storeStatIfPresent
    let preparedStoreId = null
    vault.ensureAnchorForHash = async (...args) => {
      const prepared = await ensureAnchorForHash.apply(vault, args)
      if (prepared.status === "ready") preparedStoreId = prepared.store_id
      return prepared
    }
    vault.storeStatIfPresent = async (...args) => {
      const stat = await storeStatIfPresent.apply(vault, args)
      const storePath = preparedStoreId && vault.storePathFor(
        duplicate.hash, preparedStoreId)
      return stat && storePath && args[0] === storePath
        ? Object.assign({}, stat, { dev: stat.dev + 1 })
        : stat
    }

    let result
    try {
      result = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      vault.ensureAnchorForHash = ensureAnchorForHash
      vault.storeStatIfPresent = storeStatIfPresent
    }

    assert.deepEqual(result, {
      status: "unavailable",
      unavailable_reason: "different_disk"
    })
    const row = await vault.registry.getFile(duplicate.path)
    assert.equal(row.status, "unavailable")
    assert.equal(row.unavailable_reason, "different_disk")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    await close(vault)
  })

  test("a destination replacement lock remains retryable", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const before = await fs.promises.stat(duplicate.path)
    const rename = fs.promises.rename
    fs.promises.rename = async (source, destination) => {
      if (source === `${duplicate.path}.pinokio-dedup-tmp` &&
          destination === duplicate.path) {
        const error = new Error("The destination is in use.")
        error.code = "EACCES"
        throw error
      }
      return rename.call(fs.promises, source, destination)
    }

    let result
    try {
      result = await vault.perform("deduplicate", {
        path: duplicate.path
      })
    } finally {
      fs.promises.rename = rename
    }

    assert.deepEqual(result, { status: "locked" })
    assert.equal(
      (await vault.registry.getFile(duplicate.path)).status,
      "duplicate"
    )
    assert.equal(fs.existsSync(
      `${duplicate.path}.pinokio-dedup-tmp`), false)
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    await close(vault)
  })

  test("a replaced anchor never authorizes deduplication", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    await vault.perform("separate_files", { paths: [duplicate.path] })
    assert.equal(
      (await vault.registry.getFile(duplicate.path)).status,
      "duplicate"
    )
    const anchor = vault.storePathFor(duplicate.hash)
    await fs.promises.unlink(anchor)
    await writeCandidate(anchor, crypto.randomBytes(pair.contents.length),
      pair.size)
    const before = await fs.promises.stat(duplicate.path)

    const result = await vault.perform("deduplicate", {
      path: duplicate.path
    })

    assert.equal(result.status, "stale")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    await close(vault)
  })

  test("an Activity write failure does not turn a completed file action into a failure", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    vault.registry.addEvent = () => {
      throw new Error("activity unavailable")
    }

    const result = await vault.perform("deduplicate", {
      path: duplicate.path
    })

    assert.equal(result.status, "converted")
    assert.equal(result.activity_warning, true)
    assert.equal((await vault.registry.getFile(duplicate.path)).status, "linked")
    await close(vault)
  })

  test("bulk Make separate accepts every selected deduplicated path", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home, "first.bin")
    await duplicatePair(home, "second.bin")
    await vault.sweeper.scan()

    const pending = [...await vault.registry.files({
      statuses: ["duplicate"]
    })]
    for (const entry of pending) {
      assert.equal((await vault.perform("deduplicate", {
        path: entry.path
      })).status, "converted")
    }

    const shared = await vault.status(null, {
      view: "shared",
      page_size: 500
    })
    assert.equal(shared.items.length, 4)

    const selected = shared.items.slice(0, 2)
    const result = await vault.perform("separate_files", {
      paths: selected.map((item) => item.path)
    })
    assert.equal(result.separated, 2)
    assert.equal(result.failed, 0)
    for (const entry of selected) {
      assert.equal((await vault.registry.getFile(entry.path)).status, "duplicate")
      assert.equal((await fs.promises.stat(entry.path)).nlink, 1)
    }
    await close(vault)
  })

  test("Make separate all streams every file matching the current query", async () => {
    const { home, vault } = await makeVault()
    const firstPair = await duplicatePair(home, "first.bin")
    const secondPair = await duplicatePair(home, "second.bin")
    await vault.sweeper.scan()
    assert.equal(
      (await vault.perform("deduplicate")).converted,
      2
    )

    const matching = await vault.status(null, {
      view: "shared",
      query: "first.bin",
      page_size: 500
    })
    assert.equal(matching.inventory.current.separate_count, 2)
    assert.equal(
      matching.inventory.current.separate_bytes,
      firstPair.size * 2
    )

    const result = await vault.perform("separate_all", {
      view: "shared",
      status_filter: "all",
      query: "first.bin"
    })
    assert.equal(result.separated, 2)
    assert.equal(result.failed, 0)
    assert.equal(result.cancelled, false)
    assert.equal((await fs.promises.stat(firstPair.first)).nlink, 1)
    assert.equal((await fs.promises.stat(firstPair.second)).nlink, 1)
    assert.ok((await fs.promises.stat(secondPair.first)).nlink > 1)
    assert.ok((await fs.promises.stat(secondPair.second)).nlink > 1)
    await close(vault)
  })

  test("Make separate all cancellation stops before the next file", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home, "first.bin")
    await duplicatePair(home, "second.bin")
    await vault.sweeper.scan()
    assert.equal(
      (await vault.perform("deduplicate")).converted,
      2
    )

    const separate = vault.separate.bind(vault)
    let attempts = 0
    vault.separate = async (...args) => {
      const result = await separate(...args)
      attempts += 1
      if (attempts === 1) {
        assert.equal(
          (await vault.perform("cancel_file_action")).cancel_requested,
          true
        )
      }
      return result
    }

    const result = await vault.perform("separate_all", {
      view: "shared",
      status_filter: "all",
      query: ""
    })
    assert.equal(result.cancelled, true)
    assert.equal(result.separated, 1)
    assert.equal(result.failed, 0)
    assert.equal(
      await vault.registry.countFiles(["linked"]),
      3
    )
    await close(vault)
  })

  test("compatibility and segmented summary measurements change coherently", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    let status = await vault.status()

    assert.equal(status.bytes_without_sharing, pair.size * 2)
    assert.equal(status.logical_bytes, pair.size * 2)
    assert.equal(status.saved_by_sharing, 0)
    assert.equal(status.bytes_on_disk, pair.size * 2)
    assert.equal(status.pending_bytes, pair.size)
    assert.equal(Object.hasOwn(status, "shared_logical_bytes"), false)
    let appStatus = await vault.status("app:first")
    assert.equal(appStatus.shared_logical_bytes, 0)

    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    status = await vault.status()
    assert.equal(status.saved_by_sharing, pair.size)
    assert.equal(status.logical_bytes, pair.size * 2)
    assert.equal(status.bytes_on_disk, pair.size)
    assert.equal(status.pending_bytes, 0)
    appStatus = await vault.status("app:first", {
      view: "duplicates",
      query: "does-not-match"
    })
    assert.equal(appStatus.shared_logical_bytes, pair.size)

    await vault.perform("separate_files", { paths: [duplicate.path] })
    status = await vault.status()
    assert.equal(status.saved_by_sharing, 0)
    assert.equal(status.bytes_on_disk, pair.size * 2)
    assert.equal(status.pending_bytes, pair.size)
    await close(vault)
  })

  test("Activity stores one row per batch and remains independently bounded", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home, "a.bin")
    await duplicatePair(home, "b.bin")
    await vault.sweeper.scan()

    const result = await vault.perform("deduplicate", {
      scope_id: "pinokio"
    })
    assert.equal(result.converted, 2)
    let activity = await vault.status(null, {
      view: "activity",
      page_size: 500
    })
    const operation = activity.items.find((item) =>
      item.kind === "convert")
    assert.equal(operation.activity_type, "batch")
    assert.equal(operation.files, 2)

    await vault.registry.setMaxEvents(2)
    await vault.registry.addEvent({
      kind: "detach", path: path.join(home, "one")
    })
    await vault.registry.addEvent({
      kind: "detach", path: path.join(home, "two")
    })
    await vault.registry.addEvent({
      kind: "detach", path: path.join(home, "three")
    })
    activity = await vault.status(null, {
      view: "activity",
      page_size: 500
    })
    assert.equal(activity.items.some((item) =>
      item.kind === "convert"), false)
    assert.equal(await vault.registry.countFiles(["linked"]), 4)
    await close(vault)
  })

  test("Make separate immediately returns a file to normal duplicate state", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    const before = await fs.promises.stat(duplicate.path)

    assert.equal((await vault.perform("detach", {
      path: duplicate.path
    })).status, "not-found")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    assert.equal((await vault.registry.getFile(duplicate.path)).status, "duplicate")

    await vault.perform("deduplicate", { path: duplicate.path })
    const linked = await fs.promises.stat(duplicate.path)
    assert.equal((await vault.perform("detach", {
      path: duplicate.path
    })).status, "detached")
    assert.notEqual((await fs.promises.stat(duplicate.path)).ino, linked.ino)
    assert.equal((await vault.registry.getFile(duplicate.path)).status, "duplicate")
    await assertCandidateContents(duplicate.path, pair.contents, pair.size)
    assert.equal((await vault.perform("review_again", {
      path: duplicate.path
    })).error, "unknown action")
    await close(vault)
  })

  test("Make separate works for pre-existing hardlinks", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(path.join(home, "api", "a", "model.bin"),
      contents)
    const second = path.join(home, "api", "b", "model.bin")
    await fs.promises.mkdir(path.dirname(second), { recursive: true })
    await fs.promises.link(first, second)

    await vault.sweeper.scan()
    assert.equal((await vault.registry.getFile(second)).status, "linked")

    const status = await vault.status(null, {
      view: "shared",
      page_size: 500
    })
    assert.equal(status.items.length, 2)
    const result = await vault.perform("separate_files", {
      paths: [second]
    })
    assert.equal(result.separated, 1)
    assert.equal(result.failed, 0)
    assert.notEqual((await fs.promises.stat(first)).ino,
      (await fs.promises.stat(second)).ino)
    await close(vault)
  })

  test("shared location counts include only paths on the same inode", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(path.join(home, "api", "a", "model.bin"),
      contents)
    const second = path.join(home, "api", "b", "model.bin")
    await fs.promises.mkdir(path.dirname(second), { recursive: true })
    await fs.promises.link(first, second)
    await write(path.join(home, "api", "c", "model.bin"), contents)

    await vault.sweeper.scan()
    const status = await vault.status(null, {
      view: "shared",
      page_size: 500
    })

    assert.equal(status.items.length, 2)
    assert.equal(status.items.every((item) =>
      item.location_count === 2 && item.locations.length === 2), true)
    await close(vault)
  })

  test("Clean up deletes only the unchanged, single-link registered anchor", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    const hash = duplicate.hash
    const storePath = vault.storePathFor(hash)

    for (const entry of [...await vault.registry.files({ hash })]) {
      await fs.promises.unlink(entry.path)
    }
    await vault.sweeper.scan()
    assert.equal((await fs.promises.stat(storePath)).nlink, 1)
    assert.equal((await vault.perform("reclaim", { hash })).status,
      "reclaimed")
    assert.equal(fs.existsSync(storePath), false)
    await close(vault)
  })

  test("Make separate frees the anchor once nothing links to it", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    const hash = duplicate.hash
    const storePath = vault.storePathFor(hash)
    const linked = [...await vault.registry.files({ statuses: ["linked"] })]
    assert.equal(linked.length, 2)

    assert.equal((await vault.perform("detach", {
      path: linked[0].path
    })).status, "detached")
    assert.equal(fs.existsSync(storePath), true)
    assert.equal((await fs.promises.stat(storePath)).nlink, 2)
    assert.equal((await vault.registry.anchorsForHash(hash)).length, 1)

    assert.equal((await vault.perform("detach", {
      path: linked[1].path
    })).status, "detached")
    assert.equal(fs.existsSync(storePath), false)
    assert.equal((await vault.registry.anchorsForHash(hash)).length, 0)

    for (const entry of linked) {
      await assertCandidateContents(entry.path, pair.contents, pair.size)
    }
    const activity = await vault.status(null, {
      view: "activity",
      page_size: 500
    })
    assert.equal(activity.items.some((item) => item.kind === "reclaim"), true)
    await close(vault)
  })

  test("freeing the anchor leaves the registry ready to deduplicate again", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    for (const row of [...await vault.registry.files({
      statuses: ["linked"]
    })]) {
      assert.equal((await vault.perform("detach", {
        path: row.path
      })).status, "detached")
    }

    const rows = [...await vault.registry.files({})]
    assert.equal(rows.filter((row) => row.status === "reference").length, 1)
    assert.equal(rows.filter((row) => row.status === "duplicate").length, 1)
    const target = rows.find((row) => row.status === "duplicate")
    assert.equal((await vault.perform("deduplicate", {
      path: target.path
    })).status, "converted")
    await close(vault)
  })

  test("bulk Make separate frees only the anchors nothing links to", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home, "kept.bin")
    const trio = crypto.randomBytes(4096)
    for (const name of ["one", "two", "three"]) {
      await writeCandidate(path.join(home, "api", name, "freed.bin"), trio)
    }
    await vault.sweeper.scan()
    const result = await vault.perform("deduplicate_files", {
      paths: [...await vault.registry.files({
        statuses: ["duplicate"]
      })].map((item) => item.path)
    })
    assert.equal(result.converted, 3)

    const linked = [...await vault.registry.files({ statuses: ["linked"] })]
    const freedHash = linked.find((item) =>
      path.basename(item.path) === "freed.bin").hash
    const keptHash = linked.find((item) =>
      path.basename(item.path) === "kept.bin").hash
    const freedStore = vault.storePathFor(freedHash)
    const keptStore = vault.storePathFor(keptHash)

    const separated = await vault.perform("separate_files", {
      paths: linked
        .filter((item) => path.basename(item.path) === "freed.bin")
        .map((item) => item.path)
        .concat(linked.find((item) =>
          path.basename(item.path) === "kept.bin").path)
    })
    assert.equal(separated.separated, 4)

    assert.equal(fs.existsSync(freedStore), false)
    assert.equal((await vault.registry.anchorsForHash(freedHash)).length, 0)
    assert.equal(fs.existsSync(keptStore), true)
    assert.equal((await vault.registry.anchorsForHash(keptHash)).length, 1)
    await close(vault)
  })

  test("Expanding a file lists every location for its own identity", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    for (const name of ["one", "two", "three"]) {
      await writeCandidate(path.join(home, "api", name, "shared.bin"), contents)
    }
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]

    const byHash = await vault.fileLocations(null, duplicate.path)
    assert.equal(byHash.total, 3)
    assert.equal(byHash.items.length, 3)
    assert.equal(byHash.items.some((entry) =>
      entry.path === duplicate.path), true)

    await vault.perform("deduplicate", { path: duplicate.path })
    const byInode = await vault.fileLocations(null, duplicate.path)
    assert.equal(byInode.total, 2)
    assert.equal(byInode.items.length, 2)
    const untouched = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    assert.equal(byInode.items.some((entry) =>
      entry.path === untouched.path), false)
    await close(vault)
  })

  test("an app workspace lists every location but acts only on its own", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    for (const app of ["one", "two", "three"]) {
      await writeCandidate(path.join(home, "api", app, "shared.bin"), contents)
    }
    await vault.sweeper.scan()

    const scope = "app:two"
    const status = await vault.status(scope, { view: "all", page_size: 100 })
    assert.equal(status.items.length, 1)
    const row = status.items[0]
    assert.equal(row.location_count, 3)

    const locations = await vault.fileLocations(scope, row.path)
    assert.equal(locations.total, 3)
    assert.equal(locations.items.length, 3)
    assert.equal(new Set(locations.items.map((item) =>
      item.source_id)).size, 3)
    await close(vault)
  })

  test("invalid scoped actions cannot expand into a global mutation", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home)
    await vault.sweeper.scan()

    const result = await vault.perform("deduplicate", {
      scope_id: "missing"
    })
    assert.match(result.error, /location/i)
    const separate = await vault.perform("separate_all", {
      scope_id: "missing",
      view: "shared"
    })
    assert.match(separate.error, /location/i)
    assert.equal(await vault.registry.countFiles(["duplicate"]), 1)
    await close(vault)
  })

  test("virtual location groups are valid bounded batch scopes", async () => {
    const { home, vault } = await makeVault()
    await duplicatePair(home, "app.bin")
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "models", "one.bin"), contents)
    await write(path.join(home, "models", "two.bin"), contents)
    await vault.sweeper.scan()

    const result = await vault.perform("deduplicate", {
      scope_id: "apps"
    })

    assert.equal(result.converted, 1)
    const activity = await vault.status(null, {
      view: "activity",
      page_size: 500
    })
    assert.equal(activity.items.some((item) =>
      item.kind === "convert"), true)
    const folderDuplicates = (await vault.registry.files({
      statuses: ["duplicate"]
    })).filter((row) => row.source_id.startsWith("folder:"))
    assert.equal(folderDuplicates.length, 1)
    await close(vault)
  })

  test("an older SQLite schema is rejected without migration or replacement", async () => {
    const home = await makeHome()
    const root = path.join(home, "vault")
    await fs.promises.mkdir(root)
    await fs.promises.writeFile(path.join(root, "config.json"), JSON.stringify({
      locations: [],
      anchor_stores: []
    }))
    const databasePath = path.join(root, "registry.sqlite3")
    const database = new Database(databasePath)
    database.pragma("application_id = 0x5641554c")
    database.pragma("user_version = 1")
    database.exec("CREATE TABLE old_registry (value TEXT)")
    database.prepare("INSERT INTO old_registry(value) VALUES (?)")
      .run("keep")
    database.close()

    const vault = new Vault({ homedir: home, platform: process.platform })
    await assert.rejects(vault.init(), (error) =>
      error && error.code === "EVAULTSCHEMA")

    const unchanged = new Database(databasePath, { readonly: true })
    assert.equal(unchanged.prepare(
      "SELECT value FROM old_registry").get().value, "keep")
    assert.equal(unchanged.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'files'
    `).get(), undefined)
    unchanged.close()
  })

  test("an invalid Disk Saver config is rejected without replacement", async () => {
    const home = await makeHome()
    const root = path.join(home, "vault")
    const configPath = path.join(root, "config.json")
    const databasePath = path.join(root, "registry.sqlite3")
    await fs.promises.mkdir(root)
    await fs.promises.writeFile(configPath, "{ invalid\n")
    await fs.promises.writeFile(databasePath, "keep")

    const vault = new Vault({ homedir: home, platform: process.platform })
    await assert.rejects(vault.init(), (error) =>
      error && error.code === "EVAULTCONFIG")

    assert.equal(await fs.promises.readFile(configPath, "utf8"), "{ invalid\n")
    assert.equal(await fs.promises.readFile(databasePath, "utf8"), "keep")
  })
})
