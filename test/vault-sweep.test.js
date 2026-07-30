const { after, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Vault = require("../kernel/vault")
const RegistryCore = require("../kernel/vault/registry_core")

const homes = []
const vaults = []

const sha256 = (contents) => crypto.createHash("sha256")
  .update(contents).digest("hex")

const write = async (filePath, contents) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, contents)
  return filePath
}

const makeVault = async (threshold = 1) => {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pinokio-vault-scan-"))
  homes.push(home)
  await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
  const kernel = { homedir: home, platform: process.platform }
  const vault = new Vault(kernel)
  kernel.vault = vault
  await vault.init()
  vault.sizeThreshold = threshold
  vaults.push(vault)
  return { home, vault }
}

const close = async (vault) => {
  if (vault.worker) await vault.worker.terminate().catch(() => {})
  if (vault.registry) await vault.registry.close()
}

after(async () => {
  for (const vault of vaults) await close(vault)
  for (const home of homes) {
    await fs.promises.rm(home, { recursive: true, force: true })
      .catch(() => {})
  }
})

describe("Save Space scans", () => {
  test("a scan reads files without creating anchors or hardlinks", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    const second = await write(
      path.join(home, "api", "two", "model.bin"), contents)
    const before = await Promise.all(
      [first, second].map((filePath) => fs.promises.stat(filePath)))

    const result = await vault.sweeper.scan()

    assert.equal(result.incomplete, false)
    assert.equal(await vault.registry.countFiles(), 2)
    assert.equal(await vault.registry.countFiles(["duplicate"]), 1)
    assert.deepEqual(
      await Promise.all([first, second].map(async (filePath) => {
        const stat = await fs.promises.stat(filePath)
        return { ino: stat.ino, nlink: stat.nlink }
      })),
      before.map((stat) => ({ ino: stat.ino, nlink: stat.nlink }))
    )
    assert.deepEqual(await fs.promises.readdir(vault.blobRoot), [])
  })

  test("hash-looking cache paths and metadata never replace byte hashing", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const expected = sha256(contents)
    const misleading = "0".repeat(64)
    const cacheFile = await write(path.join(
      home, "api", "cache", "HF_HOME", "hub", "models--owner--model",
      "blobs", misleading
    ), contents)
    const ordinary = await write(
      path.join(home, "api", "app", "model.bin"), contents)
    let hashes = 0
    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (...args) => {
      hashes += 1
      return hashFile(...args)
    }

    await vault.sweeper.scan()

    assert.equal(hashes, 2)
    assert.equal((await vault.registry.getFile(cacheFile)).hash, expected)
    assert.equal((await vault.registry.getFile(ordinary)).hash, expected)
    assert.notEqual(expected, misleading)
  })

  test("unchanged byte hashes are cached and one inode gets one hash job", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    const second = await write(
      path.join(home, "api", "two", "model.bin"), contents)
    let hashes = 0
    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (...args) => {
      hashes += 1
      return hashFile(...args)
    }

    await vault.sweeper.scan()
    assert.equal(hashes, 2)
    hashes = 0
    await vault.sweeper.scan()
    assert.equal(hashes, 0)

    await fs.promises.writeFile(second, crypto.randomBytes(contents.length))
    await vault.sweeper.scan()
    assert.equal(hashes, 1)
    assert.equal(await vault.registry.countFiles(["duplicate"]), 0)

    const linked = path.join(home, "api", "three", "model.bin")
    await fs.promises.mkdir(path.dirname(linked), { recursive: true })
    await fs.promises.link(first, linked)
    await fs.promises.unlink(second)
    await vault.registry.clearFiles()
    hashes = 0
    await vault.sweeper.scan()
    assert.equal(hashes, 1)
    assert.equal((await vault.registry.getFile(first)).status, "linked")
    assert.equal((await vault.registry.getFile(linked)).status, "linked")
  })

  test("All files excludes empty files and retains more than one page", async () => {
    const { home, vault } = await makeVault(0)
    const root = path.join(home, "api", "many")
    const paths = []
    for (let index = 1; index <= 520; index++) {
      paths.push(await write(
        path.join(root, `${String(index).padStart(3, "0")}.bin`),
        Buffer.alloc(index, index % 251)
      ))
    }
    const empty = await write(path.join(root, "empty.bin"), Buffer.alloc(0))

    await vault.sweeper.scan()
    const firstPage = await vault.status(null, {
      view: "all", page: 0, page_size: 500
    })
    const secondPage = await vault.status(null, {
      view: "all",
      page: 1,
      page_size: 500,
      cursor: firstPage.inventory.next_cursor
    })

    assert.equal(await vault.registry.countFiles(), paths.length)
    assert.equal(await vault.registry.getFile(empty), null)
    assert.equal(firstPage.inventory.total, paths.length)
    assert.equal(firstPage.items.length, 500)
    assert.ok(firstPage.inventory.next_cursor)
    assert.equal(firstPage.inventory.has_next, true)
    assert.equal(secondPage.items.length, 20)
    assert.equal(secondPage.inventory.has_next, false)
    assert.equal(new Set(firstPage.items.map((item) => item.path)
      .concat(secondPage.items.map((item) => item.path))).size, paths.length)
  })

  test("All files sends only matching size groups to hash work", async () => {
    const { home, vault } = await makeVault(0)
    const root = path.join(home, "api", "windows")
    for (let index = 1; index <= 300; index++) {
      await write(
        path.join(root, `unique-${String(index).padStart(3, "0")}.bin`),
        Buffer.alloc(index, index % 251)
      )
    }
    const repeated = crypto.randomBytes(2048)
    for (let index = 0; index < 3; index++) {
      await write(path.join(root, `repeated-${index}.bin`), repeated)
    }

    const workCalls = []
    const hashWorkBatch = vault.registry.hashWorkBatch.bind(vault.registry)
    vault.registry.hashWorkBatch = async (runId, cursor, limit) => {
      const rows = await hashWorkBatch(runId, cursor, limit)
      workCalls.push({ cursor, rows: rows.length })
      assert.ok(rows.length <= 128)
      return rows
    }
    let hashes = 0
    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (...args) => {
      hashes += 1
      return hashFile(...args)
    }

    await vault.sweeper.scan()

    assert.equal(hashes, 3)
    assert.deepEqual(workCalls.map((call) => call.rows), [3, 0])
    assert.equal(workCalls[0].cursor, null)
    for (const call of workCalls.slice(1)) {
      assert.ok(call.cursor)
      assert.equal(typeof call.cursor.path, "string")
    }
  })

  test("hash work excludes unhashed unique-size rows", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-registry-"))
    homes.push(root)
    const registry = new RegistryCore(root)
    await registry.load()
    try {
      const runId = registry.beginScan()
      const rows = []
      for (let index = 0; index < 10000; index++) {
        rows.push({
          path: path.join(root, "files", `cached-${index}.bin`),
          size: index + 1,
          mtime: 1,
          ctime: 1,
          dev: 1,
          ino: index + 1,
          nlink: 1,
          mode: 0o100644,
          uid: 501,
          gid: 20
        })
      }
      rows.push({
        path: path.join(root, "files", "uncached.bin"),
        size: 10000,
        mtime: 1,
        ctime: 1,
        dev: 1,
        ino: 20000,
        nlink: 1,
        mode: 0o100644,
        uid: 501,
        gid: 20
      })
      assert.equal(registry.stageFiles(runId, rows).changes, rows.length)

      const plan = registry.database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT *
        FROM scan_files
        WHERE run_id = ?
          AND hash IS NULL
          AND hash_attempted = 0
          AND hash_needed = 1
        ORDER BY size, dev, ino, path
        LIMIT 128
      `).all(runId)
      assert.match(
        plan.map((row) => row.detail).join("\n"),
        /scan_files_hash_work_idx/
      )

      const batch = registry.hashWorkBatch(runId)
      assert.equal(batch.length, 2)
      assert.deepEqual(
        new Set(batch.map((row) => row.path)),
        new Set([
          path.join(root, "files", "cached-9999.bin"),
          path.join(root, "files", "uncached.bin")
        ])
      )
    } finally {
      registry.close()
    }
  })

  test("active progress uses cached scan data without waiting for SQLite", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const lastScan = await vault.scanForScope(null)
    const scanFor = vault.registry.scanFor
    let registryRead = false
    vault.registry.scanFor = async () => {
      registryRead = true
      throw new Error("progress must not query SQLite")
    }

    let progress
    try {
      progress = await vault.progressStatus()
    } finally {
      vault.registry.scanFor = scanFor
    }

    assert.equal(registryRead, false)
    assert.equal(progress.last_scan.ts, lastScan.ts)
  })

  test("scan staging is temporary and publication rebuilds summaries", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-registry-"))
    homes.push(root)
    const registry = new RegistryCore(root)
    await registry.load()
    try {
      assert.equal(
        registry.database.pragma("journal_mode", { simple: true }),
        "delete"
      )
      assert.equal(registry.database.prepare(`
        SELECT COUNT(*) AS count
        FROM main.sqlite_master
        WHERE type = 'table' AND name GLOB 'scan_*'
      `).get().count, 0)
      assert.equal(registry.database.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_temp_master
        WHERE type = 'table' AND name GLOB 'scan_*'
      `).get().count, 4)

      const runId = registry.beginScan()
      const entries = []
      for (let index = 1; index <= 1000; index++) {
        entries.push({
          path: path.join(root, "files", `${index}.bin`),
          size: index,
          mtime: 1,
          ctime: 1,
          dev: 1,
          ino: index,
          nlink: 1,
          mode: 0o100644,
          uid: 501,
          gid: 20,
          source_id: "source"
        })
      }
      registry.stageFiles(runId, entries)
      registry.publishScan(runId, ["source"], {
        scope_id: "",
        files: entries.length,
        bytes_total: entries.reduce((sum, entry) => sum + entry.size, 0),
        candidates: entries.length
      }, 1, true)

      assert.deepEqual(registry.database.prepare(`
        SELECT status, file_count
        FROM file_summaries
      `).all(), [{ status: "reference", file_count: entries.length }])
      assert.equal(registry.database.prepare(`
        SELECT COUNT(*) AS count FROM inode_summaries
      `).get().count, 0)
      assert.equal(registry.database.prepare(`
        SELECT COUNT(*) AS count FROM files
      `).get().count, entries.length)

      const samplePath = entries[0].path
      registry.database.prepare(`
        UPDATE files SET updated_at = 123 WHERE path = ?
      `).run(samplePath)
      const secondRunId = registry.beginScan()
      registry.stageFiles(secondRunId, entries)
      registry.publishScan(secondRunId, ["source"], {
        scope_id: "",
        files: entries.length,
        bytes_total: entries.reduce((sum, entry) => sum + entry.size, 0),
        candidates: entries.length
      }, 1, true)
      assert.equal(registry.database.prepare(`
        SELECT updated_at FROM files WHERE path = ?
      `).get(samplePath).updated_at, 123)
    } finally {
      registry.close()
    }
  })

  test("a cached inode hash is reused inside a bounded hash batch", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-inode-cache-"))
    homes.push(root)
    const registry = new RegistryCore(root)
    await registry.load()
    try {
      const first = path.join(root, "files", "first.bin")
      const second = path.join(root, "files", "second.bin")
      const hash = "a".repeat(64)
      const snapshot = {
        size: 100,
        mtime: 1,
        ctime: 1,
        dev: 1,
        ino: 2,
        nlink: 2,
        mode: 0o100644,
        uid: 501,
        gid: 20,
        source_id: "source"
      }
      registry.upsertFile({
        path: first,
        hash,
        ...snapshot,
        status: "linked"
      })
      const runId = registry.beginScan()
      assert.equal(registry.stageFiles(runId, [
        { path: first, ...snapshot },
        { path: second, ...snapshot }
      ]).changes, 2)

      const batch = registry.hashWorkBatch(runId)
      assert.equal(batch.length, 1)
      assert.equal(batch[0].path, second)
      assert.equal(batch[0].reusable_hash, hash)
      assert.equal(
        registry.setStageInodeHash(runId, 1, 2, hash).changes,
        1
      )
      assert.equal(registry.database.prepare(`
        SELECT COUNT(*) AS count
        FROM scan_files
        WHERE run_id = ? AND hash = ?
      `).get(runId, hash).count, 2)
      assert.equal(registry.database.prepare(`
        SELECT COUNT(*) AS count
        FROM scan_files
        WHERE run_id = ? AND status = 'linked'
      `).get(runId).count, 2)
    } finally {
      registry.close()
    }
  })

  test("location pages merge bounded source streams in size order", async () => {
    const { home, vault } = await makeVault(0)
    const sizes = [10, 30, 50, 20, 40, 60]
    for (const [index, size] of sizes.entries()) {
      const app = index < 3 ? "one" : "two"
      await write(
        path.join(home, "api", app, `${index}.bin`),
        Buffer.alloc(size, index + 1)
      )
    }

    await vault.sweeper.scan()
    const firstPage = await vault.status(null, {
      view: "all",
      location_id: "apps",
      size_sort: "desc",
      page_size: 3
    })
    const secondPage = await vault.status(null, {
      view: "all",
      location_id: "apps",
      size_sort: "desc",
      page_size: 3,
      page: 1,
      cursor: firstPage.inventory.next_cursor
    })

    assert.equal(firstPage.inventory.total, 6)
    assert.deepEqual(firstPage.items.map((item) => item.size), [60, 50, 40])
    assert.deepEqual(secondPage.items.map((item) => item.size), [30, 20, 10])
    assert.equal(secondPage.inventory.has_next, false)
  })

  test("completed scans remove deleted and newly out-of-threshold paths", async () => {
    const { home, vault } = await makeVault(0)
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    const second = await write(
      path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    assert.equal((await vault.perform("detach", {
      path: duplicate.path
    })).status, "not-found")
    await fs.promises.unlink(duplicate.path)

    vault.sizeThreshold = contents.length * 2
    await vault.sweeper.scan()

    assert.equal(await vault.registry.getFile(duplicate.path), null)
    assert.equal(await vault.registry.getFile(
      duplicate.path === first ? second : first), null)
  })

  test("a global scan removes rows for an app that no longer exists", async () => {
    const { home, vault } = await makeVault()
    const appRoot = path.join(home, "api", "removed-app")
    const filePath = await write(
      path.join(appRoot, "model.bin"), crypto.randomBytes(4096))
    await vault.sweeper.scan()
    assert.ok(await vault.registry.getFile(filePath))

    await fs.promises.rm(appRoot, { recursive: true })
    await vault.sweeper.scan()

    assert.equal(await vault.registry.getFile(filePath), null)
  })

  test("failed and cancelled scans preserve the previous generation", async () => {
    const { home, vault } = await makeVault()
    const original = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), original)
    await write(path.join(home, "api", "two", "model.bin"), original)
    await vault.sweeper.scan()
    const previousScan = await vault.registry.scanFor()
    const previousPaths = [...await vault.registry.files()].map((row) => row.path)

    const added = crypto.randomBytes(5000)
    const failing = await write(
      path.join(home, "api", "three", "new.bin"), added)
    await write(path.join(home, "api", "four", "new.bin"), added)
    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath, options) => {
      if (filePath === failing) {
        const error = new Error("unreadable")
        error.code = "EACCES"
        throw error
      }
      return hashFile(filePath, options)
    }
    const incomplete = await vault.sweeper.scan()
    assert.equal(incomplete.incomplete, true)
    assert.equal((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      previousPaths
    )

    vault.hashFile = hashFile
    let release
    let entered
    const enteredHash = new Promise((resolve) => { entered = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    vault.hashFile = async (...args) => {
      entered()
      await gate
      return hashFile(...args)
    }
    const pending = vault.sweeper.scan()
    await enteredHash
    vault.sweeper.cancel()
    release()
    const cancelled = await pending
    assert.equal(cancelled.cancelled, true)
    assert.equal((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      previousPaths
    )
  })

  test("an unavailable configured root cannot publish a partial global scan", async () => {
    const { vault } = await makeVault()
    const external = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-unavailable-"))
    homes.push(external)
    const contents = crypto.randomBytes(4096)
    await write(path.join(external, "one.bin"), contents)
    await write(path.join(external, "two.bin"), contents)
    await vault.addExternalSource(external)
    await vault.sweeper.scan()
    const previousScan = await vault.registry.scanFor()
    const previousPaths = [...await vault.registry.files()].map((row) => row.path)

    await fs.promises.rm(external, { recursive: true })
    await assert.rejects(
      vault.sweeper.scan(),
      /configured scan location is unavailable/i
    )

    assert.equal((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      previousPaths
    )
  })

  test("a root disappearing after source refresh fails without publishing", async () => {
    const { vault } = await makeVault()
    const external = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-disappearing-"))
    homes.push(external)
    await write(path.join(external, "model.bin"), crypto.randomBytes(4096))
    await vault.addExternalSource(external)
    await vault.sweeper.scan()
    const previousScan = await vault.registry.scanFor()
    const previousPaths = [...await vault.registry.files()].map((row) => row.path)
    const refreshSources = vault.refreshSources.bind(vault)
    vault.refreshSources = async () => {
      const sources = await refreshSources()
      await fs.promises.rm(external, { recursive: true })
      return sources
    }

    await assert.rejects(vault.sweeper.scan(), (error) =>
      error && (error.code === "ENOENT" || error.code === "ENOTDIR"))

    assert.equal((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      previousPaths
    )
  })

  test("a missing database is rebuilt by a normal scan, including managed links below the threshold", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    const managedPath = duplicate.path

    await close(vault)
    await fs.promises.unlink(path.join(home, "vault", "registry.sqlite3"))
    const replacement = new Vault({ homedir: home, platform: process.platform })
    await replacement.init()
    replacement.sizeThreshold = contents.length * 2
    vaults.push(replacement)
    assert.equal(await replacement.registry.countFiles(), 0)

    await replacement.sweeper.scan()

    const rebuilt = await replacement.registry.getFile(managedPath)
    assert.ok(rebuilt)
    assert.equal(rebuilt.status, "linked")
    assert.equal(rebuilt.hash, sha256(contents))
  })

  test("managed links remain tracked below the threshold if their anchor was removed externally", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    await fs.promises.unlink(vault.storePathFor(duplicate.hash))
    vault.sizeThreshold = contents.length * 2

    await vault.sweeper.scan()

    assert.equal(await vault.registry.countFiles(["linked"]), 2)
    assert.equal((await vault.registry.getFile(duplicate.path)).status, "linked")
    assert.equal((await vault.registry.getContent(duplicate.hash)).anchor_present, 0)
  })

  test("metadata-incompatible copies are visible but not counted as actionable", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX permission metadata is required")
      return
    }
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    const second = await write(
      path.join(home, "api", "two", "model.bin"), contents)
    await fs.promises.chmod(first, 0o600)
    await fs.promises.chmod(second, 0o644)

    await vault.sweeper.scan()
    const unavailable = [...await vault.registry.files({
      statuses: ["unavailable"]
    })]
    const status = await vault.status(null, { view: "duplicates" })

    assert.equal(unavailable.length, 1)
    assert.equal(unavailable[0].unavailable_reason, "metadata")
    assert.equal(status.inventory.counts.duplicates, 1)
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)

    const before = await fs.promises.stat(unavailable[0].path)
    assert.equal((await vault.perform("detach", {
      path: unavailable[0].path
    })).status, "not-found")
    assert.equal(
      (await fs.promises.stat(unavailable[0].path)).ino,
      before.ino
    )
    assert.equal(
      (await vault.registry.getFile(unavailable[0].path)).status,
      "unavailable"
    )
  })

  test("metadata-incompatible copies stay unavailable beside existing hardlinks", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX permission metadata is required")
      return
    }
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    const second = path.join(home, "api", "two", "model.bin")
    await fs.promises.mkdir(path.dirname(second), { recursive: true })
    await fs.promises.link(first, second)
    const incompatible = await write(
      path.join(home, "api", "three", "model.bin"), contents)
    await fs.promises.chmod(first, 0o600)
    await fs.promises.chmod(incompatible, 0o644)

    await vault.sweeper.scan()
    const status = await vault.status(null, { view: "duplicates" })

    assert.equal((await vault.registry.getFile(incompatible)).status, "unavailable")
    assert.equal(
      (await vault.registry.getFile(incompatible)).unavailable_reason,
      "metadata"
    )
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)
  })

  test("the largest compatible metadata group remains actionable", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX permission metadata is required")
      return
    }
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const incompatible = await write(
      path.join(home, "api", "a", "model.bin"), contents)
    const compatibleOne = await write(
      path.join(home, "api", "b", "model.bin"), contents)
    const compatibleTwo = await write(
      path.join(home, "api", "c", "model.bin"), contents)
    await fs.promises.chmod(incompatible, 0o600)
    await fs.promises.chmod(compatibleOne, 0o644)
    await fs.promises.chmod(compatibleTwo, 0o644)

    await vault.sweeper.scan()

    assert.equal((await vault.registry.getFile(incompatible)).status, "unavailable")
    assert.equal((await vault.registry.getFile(compatibleOne)).status, "reference")
    assert.equal((await vault.registry.getFile(compatibleTwo)).status, "duplicate")
    assert.equal((await vault.perform("deduplicate", {
      path: compatibleTwo
    })).status, "converted")
  })

  test("a filesystem without hardlinks reports matches as unavailable", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    vault.mode = "copy"

    await vault.sweeper.scan()
    const status = await vault.status(null, { view: "duplicates" })

    assert.equal(await vault.registry.countFiles(["unavailable"]), 2)
    assert.equal(status.inventory.counts.duplicates, 2)
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)
    assert.equal(status.items.every((item) =>
      item.shareable === false &&
      item.unavailable_reason === "hardlinks"), true)
  })

  test("a lone file matching an anchor on another volume is unavailable", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    for (const entry of [...await vault.registry.files({
      hash: duplicate.hash
    })]) {
      await fs.promises.unlink(entry.path)
    }
    const independent = await write(
      path.join(home, "api", "three", "model.bin"), contents)
    const publishScan = vault.registry.publishScan.bind(vault.registry)
    vault.registry.publishScan = (
      runId, sourceIds, metadata, storeDev, canLink
    ) => publishScan(runId, sourceIds, metadata, storeDev + 1, canLink)

    await vault.sweeper.scan()

    assert.equal((await vault.registry.getFile(independent)).status, "unavailable")
    assert.equal(
      (await vault.registry.getFile(independent)).unavailable_reason,
      "different_disk"
    )
  })

  test("a hash-looking anchor name never authorizes cleanup without byte verification", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const claimedHash = sha256(contents)
    const anchorPath = vault.storePathFor(claimedHash)
    await write(anchorPath, crypto.randomBytes(4096))
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)

    const result = await vault.sweeper.scan()
    const status = await vault.status()

    assert.equal(result.incomplete, false)
    assert.equal((await vault.registry.getContent(claimedHash)).anchor_present, 0)
    assert.equal(status.inventory.counts.reclaimable, 0)
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)
    assert.equal([...await vault.registry.files({
      statuses: ["unavailable"]
    })].length, 2)
    assert.equal((await vault.perform("reclaim", {
      hash: claimedHash
    })).status, "not-found")
    assert.equal(fs.existsSync(anchorPath), true)
  })

  test("anchor verification participates in scan cancellation", async () => {
    const { vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const hash = sha256(contents)
    const anchorPath = await write(vault.storePathFor(hash), contents)
    let release
    let entered
    const enteredHash = new Promise((resolve) => { entered = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (...args) => {
      if (args[0] === anchorPath) {
        entered()
        await gate
      }
      return hashFile(...args)
    }

    const pending = vault.sweeper.scan()
    await enteredHash
    assert.equal(vault.sweeper.currentHash.path, anchorPath)
    vault.sweeper.cancel()
    release()

    assert.equal((await pending).cancelled, true)
  })

  test("nested external roots are walked once and internal symlinks are skipped", async (t) => {
    const { home, vault } = await makeVault(0)
    const external = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-external-"))
    homes.push(external)
    const nested = path.join(external, "nested")
    const externalFile = await write(
      path.join(nested, "model.bin"), crypto.randomBytes(4096))
    const symlink = path.join(home, "api", "linked-external")
    try {
      await fs.promises.symlink(
        external, symlink, process.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }
    await vault.addExternalSource(external)
    await vault.addExternalSource(nested)

    const result = await vault.sweeper.scan()
    const canonicalFile = await fs.promises.realpath(externalFile)

    assert.equal(result.files, 1)
    assert.ok(await vault.registry.getFile(canonicalFile))
    assert.equal(
      [...await vault.registry.files()].some((row) =>
        row.path.startsWith(symlink + path.sep)),
      false
    )
  })
})
