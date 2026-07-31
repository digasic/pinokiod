const { after, beforeEach, describe, test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { threadId } = require("node:worker_threads")
const Database = require("better-sqlite3")
const Vault = require("../kernel/vault")

const homes = []

const makeHome = async () => {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pinokio-vault-engine-"))
  homes.push(home)
  await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
  return home
}

const makeVault = async () => {
  const home = await makeHome()
  const kernel = { homedir: home, platform: process.platform }
  const vault = new Vault(kernel)
  kernel.vault = vault
  await vault.init()
  vault.sizeThreshold = 1
  return { home, kernel, vault }
}

const write = async (filePath, contents) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, contents)
  return filePath
}

const duplicatePair = async (home, name = "model.bin") => {
  const contents = crypto.randomBytes(4096)
  const first = await write(
    path.join(home, "api", "first", name), contents)
  const second = await write(
    path.join(home, "api", "second", name), contents)
  return { contents, first, second }
}

const close = async (vault) => {
  if (vault.worker) await vault.worker.terminate().catch(() => {})
  if (vault.registry) await vault.registry.close()
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

  test("startup only reads the enable flag and defers all Vault storage", async () => {
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

  test("SQLite is owned by a dedicated worker", async () => {
    const { vault } = await makeVault()

    assert.ok(vault.registry.worker)
    assert.notEqual(vault.registry.worker.threadId, threadId)
    assert.equal(vault.registry.database, undefined)
    assert.equal(await vault.registry.countFiles(), 0)

    await close(vault)
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

  test("locations and anchor stores persist in global config, not only SQLite", async () => {
    const base = await makeHome()
    const home = path.join(base, "pinokio")
    let external = path.join(base, "Documents")
    await fs.promises.mkdir(path.join(home, "api"), { recursive: true })
    await fs.promises.mkdir(external)
    external = await fs.promises.realpath(external)
    const values = {}
    const store = {
      root: path.join(base, ".pinokio"),
      get: (key) => values[key],
      set: (key, value) => {
        values[key] = JSON.parse(JSON.stringify(value))
      }
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
    assert.deepEqual(values.vault.locations, [external])
    assert.equal(values.vault.anchor_stores.length, 1)
    assert.deepEqual(await first.registry.externalSources(), [])
    assert.equal(fs.existsSync(first.blobRoot), false)
    await close(first)

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
    assert.equal(
      (await fs.promises.readdir(second.root)).every((name) =>
        name.startsWith("registry.sqlite3")),
      true
    )
    await close(second)
  })

  test("an existing central anchor tree moves intact to the home-filesystem store", async () => {
    const home = await makeHome()
    const contents = crypto.randomBytes(4096)
    const hash = crypto.createHash("sha256").update(contents).digest("hex")
    const legacyAnchor = await write(
      path.join(home, "vault", "sha256", hash.slice(0, 2), hash),
      contents
    )
    const visible = path.join(home, "api", "app", "model.bin")
    await fs.promises.mkdir(path.dirname(visible), { recursive: true })
    await fs.promises.link(legacyAnchor, visible)
    const before = await fs.promises.stat(legacyAnchor)
    const kernel = { homedir: home, platform: process.platform }
    const vault = new Vault(kernel)
    kernel.vault = vault

    await vault.init()

    const migrated = vault.storePathFor(hash)
    assert.equal(fs.existsSync(legacyAnchor), false)
    assert.equal((await fs.promises.stat(migrated)).ino, before.ino)
    assert.equal(
      (await fs.promises.readdir(vault.root)).every((name) =>
        name.startsWith("registry.sqlite3")),
      true
    )
    vault.sizeThreshold = contents.length * 2
    await vault.sweeper.scan()
    assert.equal((await vault.registry.getFile(visible)).status, "linked")
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
    assert.equal(result.bytes_saved, pair.contents.length)

    const firstStat = await fs.promises.stat(pair.first)
    const secondStat = await fs.promises.stat(pair.second)
    const current = await vault.registry.getFile(duplicate.path)
    assert.equal(firstStat.ino, secondStat.ino)
    assert.equal(current.status, "linked")
    assert.equal(
      fs.existsSync(vault.storePathFor(duplicate.hash)),
      true
    )
    const marker = JSON.parse(await fs.promises.readFile(
      path.resolve(path.dirname(vault.blobRoot), "store.json"),
      "utf8"
    ))
    assert.equal(marker.id, vault.defaultAnchorStore().id)
    assert.equal(marker.version, 1)
    await close(vault)
  })

  test("revealing a file is scoped to a current registered path", async () => {
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

    const outside = await vault.perform("reveal", {
      scope_id: first.source_id,
      path: pair.second
    })
    assert.match(outside.error, /outside the current location/i)
    assert.notEqual(first.source_id, second.source_id)
    assert.deepEqual(launched, [pair.first])

    const untracked = await vault.perform("reveal", {
      path: path.join(home, "api", "first", "missing.bin")
    })
    assert.match(untracked.error, /no longer tracked/i)
    assert.deepEqual(launched, [pair.first])

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

    assert.equal(result.status, "unavailable")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    assert.deepEqual(await fs.promises.readFile(duplicate.path), pair.contents)
    const rows = await vault.registry.files({ hash: duplicate.hash })
    assert.equal(rows.every((row) =>
      row.status === "unavailable" &&
      row.unavailable_reason === "hardlinks"), true)
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
    await fs.promises.writeFile(anchor, crypto.randomBytes(pair.contents.length))
    const before = await fs.promises.stat(duplicate.path)

    const result = await vault.perform("deduplicate", {
      path: duplicate.path
    })

    assert.equal(result.status, "stale")
    assert.equal((await fs.promises.stat(duplicate.path)).ino, before.ino)
    assert.deepEqual(
      await fs.promises.readFile(duplicate.path),
      pair.contents
    )
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
      firstPair.contents.length * 2
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

  test("Before, After, Can save, and current savings change coherently", async () => {
    const { home, vault } = await makeVault()
    const pair = await duplicatePair(home)
    await vault.sweeper.scan()
    let status = await vault.status()

    assert.equal(status.bytes_without_sharing, pair.contents.length * 2)
    assert.equal(status.saved_by_sharing, 0)
    assert.equal(status.bytes_on_disk, pair.contents.length * 2)
    assert.equal(status.pending_bytes, pair.contents.length)

    const duplicate = [...await vault.registry.files({
      statuses: ["duplicate"]
    })][0]
    await vault.perform("deduplicate", { path: duplicate.path })
    status = await vault.status()
    assert.equal(status.saved_by_sharing, pair.contents.length)
    assert.equal(status.bytes_on_disk, pair.contents.length)
    assert.equal(status.pending_bytes, 0)

    await vault.perform("separate_files", { paths: [duplicate.path] })
    status = await vault.status()
    assert.equal(status.saved_by_sharing, 0)
    assert.equal(status.bytes_on_disk, pair.contents.length * 2)
    assert.equal(status.pending_bytes, pair.contents.length)
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
    assert.deepEqual(await fs.promises.readFile(duplicate.path), pair.contents)
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
})
