const { after, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Vault = require("../kernel/vault")
const RegistryCore = require("../kernel/vault/registry_core")
const { statMany } = require("../kernel/vault/walker")

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
  const values = {}
  const store = {
    root: path.join(home, ".pinokio"),
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = JSON.parse(JSON.stringify(value))
    }
  }
  const kernel = { homedir: home, platform: process.platform, store }
  const vault = new Vault(kernel)
  kernel.vault = vault
  await vault.init()
  vault.sizeThreshold = threshold
  vaults.push(vault)
  return { home, vault, store }
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
  test("a path disappearing during metadata reads is reported", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-missing-"))
    homes.push(root)
    const missing = path.join(root, "missing.bin")
    const errors = []

    const stats = await statMany([missing], 1, null, {
      followSymlinks: false,
      strictErrors: true,
      onError: (error, filePath) => {
        errors.push({ code: error.code, path: filePath })
        return true
      }
    })

    assert.deepEqual(stats, [null])
    assert.deepEqual(errors, [{ code: "ENOENT", path: missing }])
  })

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

    assert.equal(result.partial, false)
    assert.equal(await vault.registry.countFiles(), 2)
    assert.equal(await vault.registry.countFiles(["duplicate"]), 1)
    assert.deepEqual(
      await Promise.all([first, second].map(async (filePath) => {
        const stat = await fs.promises.stat(filePath)
        return { ino: stat.ino, nlink: stat.nlink }
      })),
      before.map((stat) => ({ ino: stat.ino, nlink: stat.nlink }))
    )
    assert.equal(fs.existsSync(vault.blobRoot), false)
  })

  test("an app scan classifies against linked files in other apps", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const knownOnly = crypto.randomBytes(5000)
    const first = await write(
      path.join(home, "api", "old-one", "model.bin"), contents)
    const second = path.join(home, "api", "old-two", "model.bin")
    await fs.promises.mkdir(path.dirname(second), { recursive: true })
    await fs.promises.link(first, second)
    const knownFirst = await write(
      path.join(home, "api", "old-one", "known-only.bin"), knownOnly)
    const knownSecond = path.join(
      home, "api", "old-two", "known-only.bin")
    await fs.promises.link(knownFirst, knownSecond)
    await vault.sweeper.scan()
    assert.equal((await vault.registry.getFile(first)).status, "linked")
    assert.equal((await vault.registry.getFile(second)).status, "linked")
    assert.equal((await vault.registry.getFile(knownFirst)).status, "linked")
    assert.equal((await vault.registry.getFile(knownSecond)).status, "linked")

    const newRoot = path.join(home, "api", "new-app")
    const duplicate = await write(
      path.join(newRoot, "model.bin"), contents)
    await write(
      path.join(newRoot, "same-size.bin"),
      crypto.randomBytes(contents.length))
    const knownDuplicate = await write(
      path.join(newRoot, "known-only.bin"), knownOnly)
    await vault.refreshSources()
    const source = vault.sources().find((entry) => entry.root === newRoot)
    assert.ok(source)

    await vault.sweeper.scan(source.id)

    assert.equal((await vault.registry.getFile(duplicate)).status, "duplicate")
    assert.equal((await vault.registry.getFile(knownDuplicate)).status,
      "duplicate")
    assert.equal((await vault.registry.getFile(first)).status, "linked")
    assert.equal((await vault.registry.getFile(second)).status, "linked")
    const status = await vault.status(source.id, {
      view: "activity",
      page_size: 1
    })
    assert.equal(status.pending_bytes, contents.length + knownOnly.length)
    assert.equal(fs.existsSync(vault.blobRoot), false)
  })

  test("an app scan hashes an unhashed peer and preserves its reference", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const existing = await write(
      path.join(home, "api", "zeta", "model.bin"), contents)
    await vault.refreshSources()
    const existingSource = vault.sources().find((entry) =>
      entry.root === path.dirname(existing))
    assert.ok(existingSource)

    await vault.sweeper.scan(existingSource.id)
    assert.equal((await vault.registry.getFile(existing)).hash, null)
    assert.equal((await vault.registry.getFile(existing)).status, "reference")

    const added = await write(
      path.join(home, "api", "alpha", "model.bin"), contents)
    await vault.refreshSources()
    const addedSource = vault.sources().find((entry) =>
      entry.root === path.dirname(added))
    assert.ok(addedSource)

    await vault.sweeper.scan(addedSource.id)

    const existingRow = await vault.registry.getFile(existing)
    const addedRow = await vault.registry.getFile(added)
    assert.equal(existingRow.hash, sha256(contents))
    assert.equal(existingRow.status, "reference")
    assert.equal(addedRow.hash, existingRow.hash)
    assert.equal(addedRow.status, "duplicate")
    const status = await vault.status(addedSource.id, {
      view: "activity",
      page_size: 1
    })
    assert.equal(status.pending_bytes, contents.length)

    await fs.promises.rm(existing)
    await vault.sweeper.scan(existingSource.id)
    assert.equal((await vault.registry.getFile(existing)), null)
    assert.equal((await vault.registry.getFile(added)).status, "reference")
  })

  test("an app scan rejects a changed comparison snapshot", async () => {
    const { home, vault } = await makeVault()
    const original = crypto.randomBytes(4096)
    const existing = await write(
      path.join(home, "api", "zeta", "model.bin"), original)
    await vault.refreshSources()
    const existingSource = vault.sources().find((entry) =>
      entry.root === path.dirname(existing))
    await vault.sweeper.scan(existingSource.id)

    const temporary = await write(
      path.join(home, "api", "alpha", "model.bin"), original)
    await vault.refreshSources()
    const temporarySource = vault.sources().find((entry) =>
      entry.root === path.dirname(temporary))
    await vault.sweeper.scan(temporarySource.id)
    await fs.promises.rm(temporary)
    await vault.sweeper.scan(temporarySource.id)

    const replacement = crypto.randomBytes(original.length)
    await fs.promises.writeFile(existing, replacement)
    const added = await write(
      path.join(home, "api", "beta", "model.bin"), original)
    await vault.refreshSources()
    const addedSource = vault.sources().find((entry) =>
      entry.root === path.dirname(added))

    await vault.sweeper.scan(addedSource.id)

    assert.notDeepEqual(await fs.promises.readFile(existing), original)
    assert.equal((await vault.registry.getFile(added)).status, "reference")
    const status = await vault.status(addedSource.id, {
      view: "activity",
      page_size: 1
    })
    assert.equal(status.pending_bytes, 0)
  })

  test("a scoped scan does not publish an unrelated comparison hash", async () => {
    const { home, vault } = await makeVault()
    const existing = await write(
      path.join(home, "api", "zeta", "model.bin"),
      crypto.randomBytes(4096))
    await vault.refreshSources()
    const existingSource = vault.sources().find((entry) =>
      entry.root === path.dirname(existing))
    await vault.sweeper.scan(existingSource.id)
    assert.equal((await vault.registry.getFile(existing)).hash, null)

    const added = await write(
      path.join(home, "api", "beta", "model.bin"),
      crypto.randomBytes(4096))
    await vault.refreshSources()
    const addedSource = vault.sources().find((entry) =>
      entry.root === path.dirname(added))

    await vault.sweeper.scan(addedSource.id)

    assert.ok((await vault.registry.getFile(added)).hash)
    assert.equal((await vault.registry.getFile(existing)).hash, null)
    assert.equal((await vault.registry.getFile(existing)).status, "reference")
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
    assert.equal(vault.sweeper.state.hash_work_files, 2)
    hashes = 0
    await vault.sweeper.scan()
    assert.equal(hashes, 0)
    assert.equal(vault.sweeper.state.hash_work_files, 0)

    await fs.promises.writeFile(second, crypto.randomBytes(contents.length))
    await vault.sweeper.scan()
    assert.equal(hashes, 1)
    assert.equal(vault.sweeper.state.hash_work_files, 1)
    assert.equal(await vault.registry.countFiles(["duplicate"]), 0)

    const linked = path.join(home, "api", "three", "model.bin")
    await fs.promises.mkdir(path.dirname(linked), { recursive: true })
    await fs.promises.link(first, linked)
    await fs.promises.unlink(second)
    await vault.registry.clearFiles()
    hashes = 0
    await vault.sweeper.scan()
    assert.equal(hashes, 1)
    assert.equal(vault.sweeper.state.hash_work_files, 1)
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

  test("hashing exposes determinate byte progress", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    const hashFile = vault.hashFile.bind(vault)
    let release
    let entered
    let blocked = false
    const enteredHash = new Promise((resolve) => { entered = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    vault.hashFile = async (filePath, options = {}) => {
      if (!blocked) {
        blocked = true
        if (options.onProgress) options.onProgress(1024)
        entered()
        await gate
      }
      return hashFile(filePath, options)
    }

    const pending = vault.sweeper.scan()
    await enteredHash
    const progress = vault.scanStatus()

    try {
      assert.equal(progress.phase, "hashing")
      assert.equal(progress.hash_work_files, 2)
      assert.equal(progress.hash_work_bytes, contents.length * 2)
      assert.equal(progress.hash_files_completed, 0)
      assert.equal(progress.hash_bytes_completed, 0)
      assert.equal(progress.current_file_bytes, 1024)
      assert.equal(progress.current_file_size, contents.length)
    } finally {
      release()
    }
    await pending
    assert.equal(vault.scanStatus().hash_files_completed, 2)
    assert.equal(
      vault.scanStatus().hash_bytes_completed,
      contents.length * 2
    )
  })

  test("an anchor sharing a scanned inode is not counted as a second read", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    const anchor = vault.storePathFor(duplicate.hash)
    const stat = await fs.promises.stat(anchor)
    await fs.promises.utimes(
      anchor,
      new Date(stat.atimeMs),
      new Date(stat.mtimeMs + 1000)
    )
    let reads = 0
    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (...args) => {
      reads += 1
      return hashFile(...args)
    }

    await vault.sweeper.scan()

    assert.equal(reads, 1)
    assert.equal(vault.sweeper.state.hash_work_files, 1)
    assert.equal(vault.sweeper.state.hash_files_completed, 1)
    assert.equal(vault.sweeper.state.hash_work_bytes, contents.length)
    assert.equal(
      vault.sweeper.state.hash_bytes_completed,
      contents.length
    )
    assert.equal((await vault.registry.getFile(first)).hash, duplicate.hash)
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
      `).get().count, 6)
      const comparisonPlan = registry.database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT *
        FROM scan_files INDEXED BY scan_files_comparison_pending_idx
        WHERE run_id = ?
          AND comparison_only = 1
          AND comparison_verified = 0
        ORDER BY path
        LIMIT 128
      `).all("plan").map((row) => row.detail).join(" ")
      assert.match(comparisonPlan, /scan_files_comparison_pending_idx/)

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
      }, [{ store_id: "store", dev: 1, can_link: true, root }])

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
      }, [{ store_id: "store", dev: 1, can_link: true, root }])
      assert.equal(registry.database.prepare(`
        SELECT updated_at FROM files WHERE path = ?
      `).get(samplePath).updated_at, 123)
    } finally {
      registry.close()
    }
  })

  test("a cached inode hash removes that inode from hash work", async () => {
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
      assert.equal(batch.length, 0)
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

  test("path exclusions publish verified work and cancellation preserves it", async () => {
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
    const partial = await vault.sweeper.scan()
    const partialScan = await vault.registry.scanFor()
    const partialPaths = [...await vault.registry.files()]
      .map((row) => row.path)
    assert.equal(partial.partial, true)
    assert.equal(partial.outcome, "completed_with_exclusions")
    assert.notEqual(partialScan.ts, previousScan.ts)
    assert.equal(partialScan.partial, true)
    assert.deepEqual(partialPaths, previousPaths.concat(
      path.join(home, "api", "four", "new.bin")
    ).sort())

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
    assert.equal((await vault.registry.scanFor()).ts, partialScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      partialPaths
    )
  })

  test("cancellation immediately before publication discards the draft", async () => {
    const { home, vault } = await makeVault()
    const original = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), original)
    await write(path.join(home, "api", "two", "model.bin"), original)
    await vault.sweeper.scan()
    const previousScan = await vault.registry.scanFor()
    const previousPaths = [...await vault.registry.files()]
      .map((row) => row.path)

    await write(
      path.join(home, "api", "three", "new.bin"),
      crypto.randomBytes(5000)
    )
    const stageExclusions = vault.registry.stageExclusions.bind(vault.registry)
    const publishScan = vault.registry.publishScan.bind(vault.registry)
    let exclusionStages = 0
    let published = false
    vault.registry.stageExclusions = async (...args) => {
      const result = await stageExclusions(...args)
      exclusionStages += 1
      if (exclusionStages === 3) vault.sweeper.cancel()
      return result
    }
    vault.registry.publishScan = async (...args) => {
      published = true
      return publishScan(...args)
    }

    const result = await vault.sweeper.scan()
    vault.registry.stageExclusions = stageExclusions
    vault.registry.publishScan = publishScan

    assert.equal(result.cancelled, true)
    assert.equal(published, false)
    assert.equal((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      previousPaths
    )
  })

  test("a denied subtree stays stale while covered deletions publish", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX directory permissions are required")
      return
    }
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const deniedRoot = path.join(home, "api", "denied")
    const denied = await write(path.join(deniedRoot, "model.bin"), contents)
    const healthy = await write(
      path.join(home, "api", "healthy", "model.bin"), contents)
    const removed = await write(
      path.join(home, "api", "removed", "model.bin"), contents)
    await vault.sweeper.scan()
    await fs.promises.unlink(removed)
    await fs.promises.chmod(deniedRoot, 0o000)

    try {
      const result = await vault.sweeper.scan()
      if (!result.partial) {
        t.skip("The test process can read mode-000 directories")
        return
      }

      assert.equal(result.outcome, "completed_with_exclusions")
      assert.equal(result.exclusions.some((entry) =>
        entry.path === deniedRoot &&
        entry.reason === "permission_denied"), true)
      assert.equal(await vault.registry.getFile(removed), null)
      assert.equal(
        (await vault.registry.getFile(denied)).unavailable_reason,
        "stale"
      )
      assert.equal((await vault.registry.getFile(healthy)).status, "reference")

      const status = await vault.status(null, { view: "all" })
      assert.equal(status.last_scan.partial, true)
      assert.equal(status.last_scan.exclusions[0].path, deniedRoot)
      assert.equal(status.last_scan.files, 1)
      assert.equal(status.last_scan.bytes_total, contents.length)
      assert.equal(status.inventory.counts.all, 1)
      assert.equal(status.inventory.shareable_duplicates, 0)
      assert.equal(status.pending_bytes, 0)
      assert.deepEqual(status.items.map((item) => item.path), [healthy])
      assert.equal((await vault.perform("deduplicate", {
        path: denied
      })).status, "not-found")
    } finally {
      await fs.promises.chmod(deniedRoot, 0o700).catch(() => {})
    }

    const recovered = await vault.sweeper.scan()
    assert.equal(recovered.partial, false)
    assert.notEqual((await vault.registry.getFile(denied)).unavailable_reason,
      "stale")
    assert.equal(await vault.registry.countFiles(["duplicate"]), 1)
  })

  test("a file that changes while hashing is excluded without losing peers", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const changing = await write(
      path.join(home, "api", "changing", "model.bin"), contents)
    const stable = await write(
      path.join(home, "api", "stable", "model.bin"), contents)
    const hashFile = vault.hashFile.bind(vault)
    let changed = false
    vault.hashFile = async (filePath, options) => {
      const result = await hashFile(filePath, options)
      if (filePath === changing && !changed) {
        changed = true
        await fs.promises.writeFile(filePath, contents)
      }
      return result
    }

    const result = await vault.sweeper.scan()

    assert.equal(result.outcome, "completed_with_exclusions")
    assert.equal(result.exclusions.some((entry) =>
      entry.path === changing &&
      entry.reason === "changed_during_scan"), true)
    assert.equal(await vault.registry.getFile(changing), null)
    assert.equal((await vault.registry.getFile(stable)).status, "reference")
    const status = await vault.status()
    assert.equal(status.last_scan.files, 1)
    assert.equal(status.last_scan.bytes_total, contents.length)
  })

  test("a publication failure preserves the previous generation", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const previousScan = await vault.registry.scanFor()
    const previousPaths = [...await vault.registry.files()]
      .map((row) => row.path)
    await write(
      path.join(home, "api", "three", "new.bin"),
      crypto.randomBytes(5000)
    )
    const publishScan = vault.registry.publishScan
    vault.registry.publishScan = async () => {
      const error = new Error("database unavailable")
      error.code = "EVAULTDB"
      throw error
    }

    await assert.rejects(vault.sweeper.scan(), /database unavailable/)

    vault.registry.publishScan = publishScan
    assert.equal((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.deepEqual(
      [...await vault.registry.files()].map((row) => row.path),
      previousPaths
    )
  })

  test("an unreadable store anchor is excluded without discarding the scan", async () => {
    const { home, vault } = await makeVault()
    await write(
      path.join(home, "api", "model.bin"),
      crypto.randomBytes(4096)
    )
    await vault.sweeper.scan()
    const previousScan = await vault.registry.scanFor()

    const contents = crypto.randomBytes(5000)
    const hash = sha256(contents)
    const store = vault.defaultAnchorStore()
    await vault.ensureAnchorStore(store, (await fs.promises.stat(home)).dev)
    const anchor = await write(vault.storePathFor(hash), contents)
    const stat = await fs.promises.stat(anchor)
    const now = Date.now()
    await vault.registry.upsertContent({
      hash,
      size: stat.size,
      first_seen: now,
      verified_at: now
    })
    await vault.registry.upsertAnchor({
      store_id: store.id,
      hash,
      path: anchor,
      verified_at: now,
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      nlink: stat.nlink,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid
    })
    await fs.promises.utimes(
      anchor,
      new Date(stat.atimeMs),
      new Date(stat.mtimeMs + 1000)
    )

    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath, options) => {
      if (filePath === anchor) {
        const error = new Error("store anchor unavailable")
        error.code = "EACCES"
        throw error
      }
      return hashFile(filePath, options)
    }

    const result = await vault.sweeper.scan()

    vault.hashFile = hashFile
    assert.equal(result.outcome, "completed_with_exclusions")
    assert.equal(result.exclusions.some((entry) =>
      entry.path === anchor &&
      entry.reason === "permission_denied"), true)
    assert.notEqual((await vault.registry.scanFor()).ts, previousScan.ts)
    assert.equal(await vault.registry.getContent(hash), null)
    assert.equal(await vault.registry.getAnchor(store.id, hash), null)
    assert.equal(await fs.promises.readFile(anchor).then(
      (value) => value.equals(contents)), true)

    await vault.sweeper.scan()
    assert.ok(await vault.registry.getAnchor(store.id, hash))
  })

  test("a failed hardlink path retries another path to the same inode", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const first = await write(
      path.join(home, "api", "one", "model.bin"), contents)
    const second = path.join(home, "api", "two", "model.bin")
    await fs.promises.mkdir(path.dirname(second), { recursive: true })
    await fs.promises.link(first, second)

    const hashFile = vault.hashFile.bind(vault)
    const hashPaths = []
    vault.hashFile = async (filePath, options) => {
      hashPaths.push(filePath)
      if (filePath === first) {
        const error = new Error("first hardlink path unavailable")
        error.code = "EACCES"
        throw error
      }
      return hashFile(filePath, options)
    }

    const result = await vault.sweeper.scan()
    vault.hashFile = hashFile

    assert.equal(result.outcome, "completed_with_exclusions")
    assert.deepEqual(hashPaths, [first, second])
    assert.equal(vault.sweeper.state.hash_work_files, 1)
    assert.equal(vault.sweeper.state.hash_files_completed, 1)
    assert.equal(vault.sweeper.state.hash_total, 2)
    assert.equal(await vault.registry.getFile(first), null)
    assert.equal((await vault.registry.getFile(second)).hash, sha256(contents))
  })

  test("an anchor fallback does not change the discovered hash workload", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    await vault.sweeper.scan()
    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    const anchor = vault.storePathFor(duplicate.hash)
    const anchorStat = await fs.promises.stat(anchor)
    await fs.promises.utimes(
      anchor,
      new Date(anchorStat.atimeMs),
      new Date(anchorStat.mtimeMs + 1000)
    )
    const anchorIdentity = await fs.promises.stat(anchor)
    const failingPaths = new Set([...await vault.registry.files({
      dev: anchorIdentity.dev,
      ino: anchorIdentity.ino
    })].map((entry) => entry.path))

    const hashFile = vault.hashFile.bind(vault)
    const hashPaths = []
    let enterAnchor
    let releaseAnchor
    const anchorEntered = new Promise((resolve) => { enterAnchor = resolve })
    const anchorGate = new Promise((resolve) => { releaseAnchor = resolve })
    vault.hashFile = async (filePath, options) => {
      hashPaths.push(filePath)
      if (failingPaths.has(filePath)) {
        const error = new Error("linked path unavailable")
        error.code = "EACCES"
        throw error
      }
      if (filePath === anchor) {
        enterAnchor()
        await anchorGate
      }
      return hashFile(filePath, options)
    }

    const pending = vault.sweeper.scan()
    const reachedAnchor = await Promise.race([
      anchorEntered.then(() => true),
      pending.then(() => false)
    ])
    assert.equal(reachedAnchor, true, JSON.stringify({
      anchor,
      failingPaths: [...failingPaths],
      hashPaths
    }))
    try {
      const progress = vault.scanStatus()
      assert.equal(progress.hash_work_files, 1)
      assert.equal(progress.hash_files_completed, 0)
      assert.equal(progress.hash_work_bytes, contents.length)
      assert.equal(progress.hash_bytes_completed, 0)
    } finally {
      releaseAnchor()
    }
    const result = await pending
    vault.hashFile = hashFile

    assert.equal(
      [...failingPaths].every((filePath) => hashPaths.includes(filePath)),
      true,
      hashPaths.join("\n")
    )
    assert.equal(result.outcome, "completed_with_exclusions")
    assert.equal(vault.sweeper.state.hash_work_files, 1)
    assert.equal(vault.sweeper.state.hash_files_completed, 1)
    assert.equal(vault.sweeper.state.hash_work_bytes, contents.length)
    assert.equal(
      vault.sweeper.state.hash_bytes_completed,
      contents.length
    )
  })

  test("active scan previews are bounded, provisional, and contain no actions", async () => {
    const { home, vault } = await makeVault()
    let expectedBytes = 0
    for (let index = 0; index < 25; index++) {
      const contents = Buffer.alloc(4096 + index, index + 1)
      expectedBytes += contents.length
      await write(
        path.join(home, "api", `group-${index}`, "one.bin"),
        contents
      )
      await write(
        path.join(home, "api", `group-${index}`, "two.bin"),
        contents
      )
    }
    let release
    let entered
    const enteredPublish = new Promise((resolve) => { entered = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    const publishScan = vault.registry.publishScan.bind(vault.registry)
    vault.registry.publishScan = async (...args) => {
      entered()
      await gate
      return publishScan(...args)
    }

    const pending = vault.sweeper.scan()
    await enteredPublish
    const progress = await vault.progressStatus()
    const preview = progress.scan.preview
    assert.equal(progress.scan.active, true)
    assert.equal(preview.provisional, true)
    assert.equal(preview.duplicate_files, 25)
    assert.equal(preview.bytes, expectedBytes)
    assert.equal(preview.groups.length, 20)
    assert.equal(vault.sweeper.previewGroups.size, 20)
    assert.equal(progress.scan.hash_work_files, 50)
    assert.equal(progress.scan.hash_files_completed, 50)
    assert.equal(progress.scan.hash_work_bytes, expectedBytes * 2)
    assert.equal(progress.scan.hash_bytes_completed, expectedBytes * 2)
    assert.equal(preview.groups.every((group) =>
      typeof group.representative_path === "string" &&
      group.representative_path.endsWith("one.bin")), true)
    assert.equal(Object.hasOwn(preview, "actions"), false)
    assert.equal(await vault.registry.countFiles(), 0)

    release()
    await pending
    assert.equal(vault.scanStatus().preview.groups.length, 0)
    assert.equal(await vault.registry.countFiles(), 50)
  })

  test("app results inherit only exclusions inside that app", async () => {
    const { home, vault } = await makeVault()
    const firstRoot = path.join(home, "api", "first")
    const secondRoot = path.join(home, "api", "second")
    const contents = crypto.randomBytes(4096)
    const excluded = await write(
      path.join(firstRoot, "one.bin"), contents)
    await write(path.join(firstRoot, "two.bin"), contents)
    await write(path.join(secondRoot, "one.bin"), contents)
    await write(path.join(secondRoot, "two.bin"), contents)
    await vault.refreshSources()
    const firstSource = vault.sources().find((source) =>
      source.root === firstRoot)
    const secondSource = vault.sources().find((source) =>
      source.root === secondRoot)
    assert.ok(firstSource)
    assert.ok(secondSource)

    const hashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath, options) => {
      if (filePath === excluded) {
        const error = new Error("file unavailable")
        error.code = "EACCES"
        throw error
      }
      return hashFile(filePath, options)
    }

    const result = await vault.sweeper.scan()
    vault.hashFile = hashFile
    assert.equal(result.partial, true)

    const firstScan = await vault.scanForScope(firstSource.id)
    const secondScan = await vault.scanForScope(secondSource.id)
    assert.equal(firstScan.partial, true)
    assert.equal(firstScan.exclusions.length, 1)
    assert.equal(firstScan.exclusions[0].path, excluded)
    assert.equal(secondScan.partial, false)
    assert.equal(secondScan.outcome, "complete")
    assert.deepEqual(secondScan.exclusions, [])
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
    const { home, vault, store } = await makeVault()
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
    const replacement = new Vault({
      homedir: home,
      platform: process.platform,
      store
    })
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
    const blocked = await vault.status(null, { view: "unavailable" })
    const filtered = await vault.status(null, {
      view: "all",
      status_filter: "unavailable"
    })

    assert.equal(unavailable.length, 1)
    assert.equal(unavailable[0].unavailable_reason, "metadata")
    assert.equal(status.inventory.counts.duplicates, 0)
    assert.equal(status.inventory.counts.unavailable, 1)
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)
    assert.equal(status.items.length, 0)
    assert.equal(blocked.items.length, 1)
    assert.equal(blocked.items[0].status, "unavailable")
    assert.equal(blocked.items[0].unavailable_reason, "metadata")
    assert.equal(filtered.items.length, 1)
    assert.equal(filtered.items[0].status, "unavailable")

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
    const blocked = await vault.status(null, { view: "unavailable" })

    assert.equal((await vault.registry.getFile(incompatible)).status, "unavailable")
    assert.equal(
      (await vault.registry.getFile(incompatible)).unavailable_reason,
      "metadata"
    )
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)
    assert.equal(status.inventory.counts.duplicates, 0)
    assert.equal(status.inventory.counts.unavailable, 1)
    assert.equal(status.items.length, 0)
    assert.equal(blocked.items.length, 1)
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
    const grouped = await vault.status(null, {
      view: "duplicates",
      display_mode: "files"
    })
    const hash = (await vault.registry.getFile(compatibleTwo)).hash
    const children = await vault.duplicateGroupChildren(null, hash)
    assert.equal(grouped.items.length, 1)
    assert.equal(grouped.items[0].total_count, 2)
    assert.equal(grouped.items[0].eligible_count, 1)
    assert.equal(children.total, 2)
    assert.equal(children.items.some((item) =>
      item.registry_status === "unavailable"), false)
    assert.equal((await vault.perform("deduplicate", {
      path: compatibleTwo
    })).status, "converted")
  })

  test("a filesystem without hardlinks reports matches as unavailable", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)
    vault.defaultAnchorStore().mode = "copy"

    await vault.sweeper.scan()
    const status = await vault.status(null, { view: "duplicates" })
    const blocked = await vault.status(null, { view: "unavailable" })

    assert.equal(await vault.registry.countFiles(["unavailable"]), 2)
    assert.equal(status.inventory.counts.duplicates, 0)
    assert.equal(status.inventory.counts.unavailable, 2)
    assert.equal(status.inventory.shareable_duplicates, 0)
    assert.equal(status.pending_bytes, 0)
    assert.equal(status.items.length, 0)
    assert.equal(blocked.items.length, 2)
    assert.equal(blocked.items.every((item) =>
      item.shareable === false &&
      item.unavailable_reason === "hardlinks"), true)
  })

  test("copies are independent across filesystems but actionable within each filesystem", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-devices-"))
    homes.push(root)
    const registry = new RegistryCore(root)
    await registry.load()
    const hash = "a".repeat(64)
    registry.upsertContent({
      hash,
      size: 4096,
      first_seen: Date.now(),
      verified_at: Date.now()
    })
    const add = (filePath, dev, ino) => registry.upsertFile({
      path: filePath,
      hash,
      size: 4096,
      mtime: 1,
      ctime: 1,
      dev,
      ino,
      mode: 0o100644,
      uid: 501,
      gid: 20,
      source_id: "external",
      status: "reference"
    })
    add(path.join(root, "drive-a", "one.bin"), 101, 1)
    add(path.join(root, "drive-b", "one.bin"), 202, 2)
    add(path.join(root, "drive-b", "two.bin"), 202, 3)

    registry.reclassifyHash(hash, [
      { store_id: "store-a", dev: 101, can_link: true },
      { store_id: "store-b", dev: 202, can_link: true }
    ])

    assert.equal(
      registry.getFile(path.join(root, "drive-a", "one.bin")).status,
      "reference"
    )
    assert.deepEqual(
      [
        registry.getFile(path.join(root, "drive-b", "one.bin")).status,
        registry.getFile(path.join(root, "drive-b", "two.bin")).status
      ].sort(),
      ["duplicate", "reference"]
    )
    const grouped = registry.duplicateGroupPage({
      unrestricted: true,
      authorizedUnrestricted: true,
      pageSize: 500
    })
    assert.equal(grouped.rows.length, 1)
    assert.equal(grouped.rows[0].hash, hash)
    assert.equal(grouped.rows[0].total_count, 3)
    assert.equal(grouped.rows[0].eligible_count, 1)
    assert.equal(grouped.rows[0].can_save, 4096)
    const children = registry.duplicateGroupChildren({
      hash,
      unrestricted: true,
      activeUnrestricted: true,
      pageSize: 500
    })
    assert.equal(children.total, 3)
    assert.equal(children.rows.filter((row) => row.selectable).length, 1)
    const selection = registry.duplicateGroupSelection({
      hash,
      unrestricted: true
    })
    assert.equal(selection.paths.length, 1)
    assert.equal(selection.exceeded, false)

    registry.upsertAnchor({
      store_id: "store-a",
      hash,
      path: path.join(root, "store-a", hash),
      verified_at: Date.now(),
      dev: 101,
      ino: 10,
      size: 4096,
      mtime: 1,
      ctime: 1,
      nlink: 1,
      mode: 0o100644,
      uid: 501,
      gid: 20
    })
    registry.upsertAnchor({
      store_id: "store-b",
      hash,
      path: path.join(root, "store-b", hash),
      verified_at: Date.now(),
      dev: 202,
      ino: 20,
      size: 4096,
      mtime: 1,
      ctime: 1,
      nlink: 1,
      mode: 0o100644,
      uid: 501,
      gid: 20
    })
    assert.deepEqual(
      registry.anchorsForHash(hash).map((anchor) => anchor.store_id),
      ["store-a", "store-b"]
    )
    assert.deepEqual(
      registry.reclaimableBatch({ store_id: "", hash: "" }, 10)
        .map((anchor) => anchor.store_id),
      ["store-a", "store-b"]
    )
    registry.close()
  })

  test("a hash-looking anchor name never authorizes cleanup without byte verification", async () => {
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const claimedHash = sha256(contents)
    await vault.ensureAnchorStore(
      vault.defaultAnchorStore(),
      (await fs.promises.stat(home)).dev
    )
    const anchorPath = vault.storePathFor(claimedHash)
    await write(anchorPath, crypto.randomBytes(4096))
    await write(path.join(home, "api", "one", "model.bin"), contents)
    await write(path.join(home, "api", "two", "model.bin"), contents)

    const result = await vault.sweeper.scan()
    const status = await vault.status()

    assert.equal(result.partial, false)
    assert.deepEqual(await vault.registry.anchorsForHash(claimedHash), [])
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
    const { home, vault } = await makeVault()
    const contents = crypto.randomBytes(4096)
    const hash = sha256(contents)
    await vault.ensureAnchorStore(
      vault.defaultAnchorStore(),
      (await fs.promises.stat(home)).dev
    )
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

  test("an external ancestor is walked once while Pinokio keeps its own attribution", async () => {
    const base = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pinokio-vault-ancestor-"))
    homes.push(base)
    const home = path.join(base, "pinokio")
    await fs.promises.mkdir(path.join(home, "api", "app"), {
      recursive: true
    })
    const pinokioFile = await write(
      path.join(home, "api", "app", "model.bin"),
      crypto.randomBytes(4096)
    )
    const externalFile = await write(
      path.join(base, "Documents", "archive.bin"),
      crypto.randomBytes(4096)
    )
    const kernel = { homedir: home, platform: process.platform }
    const vault = new Vault(kernel)
    kernel.vault = vault
    await vault.init()
    vault.sizeThreshold = 0
    vaults.push(vault)

    const added = await vault.addExternalSource(base)
    assert.equal(added.created, true)
    assert.deepEqual(vault.scanRoots(), [{
      root: added.source.root,
      source_id: added.source.id
    }])

    await vault.sweeper.scan()

    assert.equal(
      (await vault.registry.getFile(
        await fs.promises.realpath(pinokioFile))).source_id,
      `app:${encodeURIComponent("app")}`
    )
    assert.equal(
      (await vault.registry.getFile(
        await fs.promises.realpath(externalFile))).source_id,
      added.source.id
    )
    const registryRoot = await fs.promises.realpath(vault.root)
    assert.equal(
      [...await vault.registry.files()].some((row) =>
        row.path.startsWith(`${registryRoot}${path.sep}`)),
      false
    )
  })
})
