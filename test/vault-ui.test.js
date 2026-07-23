const { test, describe, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const ejs = require('ejs')
const { JSDOM } = require('jsdom')
const Vault = require('../kernel/vault')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const writeFile = async (p, content) => {
  await fs.promises.mkdir(path.dirname(p), { recursive: true })
  await fs.promises.writeFile(p, content)
  return p
}

const duplicateEntry = async (filePath, entry) => {
  const st = await fs.promises.stat(filePath)
  return Object.assign({}, entry, {
    dev: st.dev,
    ino: st.ino,
    mtime: st.mtimeMs,
    ctime: st.ctimeMs
  })
}

const vaultPageSource = async () => {
  const root = path.resolve(__dirname, '..', 'server')
  const files = ['views/vault.ejs', 'views/partials/vault_workspace.ejs', 'public/vault.css', 'public/storage-size.js', 'public/vault.js']
  return (await Promise.all(files.map((file) => fs.promises.readFile(path.resolve(root, file), 'utf8')))).join('\n')
}

const runVaultScript = async (dom) => {
  const publicRoot = path.resolve(__dirname, '..', 'server', 'public')
  const scripts = await Promise.all(['storage-size.js', 'vault.js']
    .map((file) => fs.promises.readFile(path.resolve(publicRoot, file), 'utf8')))
  dom.window.eval(scripts.join('\n'))
}

describe('vault dashboard backend (phase 4)', () => {
  let homes = []
  const makeEnv = async () => {
    const home = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-ui-'))
    homes.push(home)
    await fs.promises.mkdir(path.resolve(home, 'api'), { recursive: true })
    const kernel = { homedir: home, platform: process.platform, path: (...a) => path.resolve(home, ...a) }
    const vault = new Vault(kernel)
    await vault.init()
    vault.sizeThreshold = 1024
    return { home, vault }
  }
  after(async () => {
    for (const h of homes) await fs.promises.rm(h, { recursive: true, force: true }).catch(() => {})
  })

  const makeSharedPair = async (home, vault, name = 'm.bin') => {
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(home, 'api', 'appA', name), content)
    await vault.adopt(a, hash, { app: 'appA' })
    const b = await writeFile(path.resolve(home, 'api', 'appB', name), content)
    const conv = await vault.convert(b, hash, { app: 'appB', batch_id: `batch-${name}` })
    assert.strictEqual(conv.status, 'converted')
    return { content, hash, a, b }
  }

  test('item 15: undo of a conversion batch restores independent files', async () => {
    const { home, vault } = await makeEnv()
    const { content, a, b } = await makeSharedPair(home, vault)
    const savedBefore = vault.registry.totals.lifetime_bytes_saved

    const result = await vault.undoBatch('batch-m.bin')
    assert.strictEqual(result.undone, 1)
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1, 'independent file again')
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    assert.strictEqual((await fs.promises.stat(a)).nlink, 2, 'other names untouched')
    assert.strictEqual(vault.registry.totals.lifetime_bytes_saved, savedBefore - content.length)
    assert.ok(vault.registry.duplicates.has(b), 'undone file is pending again')
    const events = await vault.registry.readEvents()
    assert.ok(events.some((e) => e.kind === 'undo' && e.batch_id === 'batch-m.bin'))
  })

  test('undo remains available after its activity event is compacted away', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault, 'retained.bin')
    vault.registry.maxEvents = 2
    vault.registry.compactEvery = 1

    for (let index = 0; index < 3; index += 1) {
      await vault.registry.appendEvent({ kind: 'scan', marker: index })
    }

    const compactedEvents = await vault.registry.readEvents()
    assert.strictEqual(compactedEvents.some((event) => event.batch_id === 'batch-retained.bin'), false)
    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.links.get(b).batch_id, 'batch-retained.bin')
    const status = await vault.status()
    assert.deepStrictEqual(status.undo_batches, [{
      batch_id: 'batch-retained.bin', files: 1, bytes: 4096, ts: null
    }])

    const result = await vault.undoBatch('batch-retained.bin')
    assert.strictEqual(result.undone, 1)
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
  })

  test('a replaced file never inherits an old compacted undo batch', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault, 'replaced.bin')
    const oldBatch = 'batch-replaced.bin'
    const savedBefore = vault.registry.totals.lifetime_bytes_saved
    vault.registry.maxEvents = 2
    vault.registry.compactEvery = 1

    for (let index = 0; index < 3; index += 1) {
      await vault.registry.appendEvent({ kind: 'scan', marker: index })
    }
    assert.strictEqual((await vault.registry.readEvents())
      .some((event) => event.batch_id === oldBatch), false)

    const replacement = crypto.randomBytes(4096)
    const replacementPath = await writeFile(`${b}.replacement`, replacement)
    await fs.promises.rename(replacementPath, b)
    await vault.sweeper.scan()

    const replacementStat = await fs.promises.stat(b)
    const replacementEntry = vault.registry.links.get(b)
    assert.strictEqual(replacementEntry.hash, sha256(replacement))
    assert.strictEqual(replacementEntry.batch_id, undefined)

    const result = await vault.undoBatch(oldBatch)
    assert.deepStrictEqual(result, { undone: 0, bytes: 0, failed: 0 })
    assert.deepStrictEqual(await fs.promises.readFile(b), replacement)
    assert.strictEqual((await fs.promises.stat(b)).ino, replacementStat.ino)
    assert.strictEqual(vault.registry.totals.lifetime_bytes_saved, savedBefore)
  })

  test('an old activity batch cannot undo a newer conversion of the same path', async () => {
    const { home, vault } = await makeEnv()
    const { hash, b } = await makeSharedPair(home, vault, 'reconverted.bin')
    assert.strictEqual((await vault.undoBatch('batch-reconverted.bin')).undone, 1)
    assert.strictEqual((await vault.convert(b, hash, { app: 'appB', batch_id: 'batch-new' })).status, 'converted')

    const oldUndo = await vault.undoBatch('batch-reconverted.bin')
    assert.strictEqual(oldUndo.undone, 0)
    assert.strictEqual(vault.registry.links.get(b).batch_id, 'batch-new')
    assert.ok((await fs.promises.stat(b)).nlink > 1)

    const status = await vault.status()
    const oldEvent = status.events.find((event) => event.kind === 'convert' && event.batch_id === 'batch-reconverted.bin')
    const newEvent = status.events.find((event) => event.kind === 'convert' && event.batch_id === 'batch-new')
    assert.strictEqual(oldEvent.undoable, false)
    assert.strictEqual(newEvent.undoable, true)
  })

  test('detach makes one name independent and pins it against future scans', async () => {
    const { home, vault } = await makeEnv()
    const { content, a, b } = await makeSharedPair(home, vault)

    const result = await vault.detach(b)
    assert.strictEqual(result.status, 'detached')
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    assert.strictEqual((await fs.promises.stat(a)).nlink, 2)
    assert.ok(vault.registry.excluded.has(b))
    assert.strictEqual(vault.registry.excluded.get(b).size, content.length)
    assert.strictEqual(vault.registry.scanIndex.has(b), false)
    assert.strictEqual(fs.existsSync(b + '.pinokio-dedup-tmp'), false)

    // A scan neither re-adopts nor re-lists the pinned path.
    await vault.sweeper.scan()
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
    assert.strictEqual(vault.registry.duplicates.has(b), false)

    // Re-share un-pins; the next scan lists it as pending again (no auto-convert).
    const reshared = await vault.reshare(b)
    assert.strictEqual(reshared.status, 'resharable')
    await vault.sweeper.scan()
    assert.ok(vault.registry.duplicates.has(b))
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
  })

  test('a committed file action reports a persistence warning instead of a false failure', async () => {
    const { home, vault } = await makeEnv()
    const { content, b } = await makeSharedPair(home, vault, 'persist-warning.bin')
    const before = await fs.promises.stat(b)
    const realFlush = vault.registry.flush.bind(vault.registry)
    vault.registry.persistDelay = 60000
    vault.registry.flush = async () => {
      const error = new Error('temporary snapshot write failure')
      error.code = 'EIO'
      throw error
    }

    let result
    try {
      result = await vault.perform('detach', { path: b })
    } finally {
      vault.registry.flush = realFlush
    }

    const after = await fs.promises.stat(b)
    assert.strictEqual(result.status, 'detached')
    assert.strictEqual(result.persistence_warning, true)
    assert.notStrictEqual(after.ino, before.ino)
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    assert.ok(vault.registry.excluded.has(b))
    await vault.registry.flush()
  })

  test('detach and undo preserve an unrelated temporary-name collision', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault)
    const tmp = b + Vault.TMP_SUFFIX
    await fs.promises.writeFile(tmp, 'user data')

    const detached = await vault.detach(b)
    const undone = await vault.undoBatch('batch-m.bin')

    assert.strictEqual(detached.status, 'conflict')
    assert.strictEqual(undone.undone, 0)
    assert.strictEqual(undone.failed, 1)
    assert.strictEqual(await fs.promises.readFile(tmp, 'utf8'), 'user data')
    assert.ok(vault.registry.links.has(b))
  })

  test('detach never overwrites a file replaced while its independent copy is being made', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault)
    const replacement = Buffer.from('newer-writer-content')
    const realCopyFile = fs.promises.copyFile
    fs.promises.copyFile = async (source, target, flags) => {
      const result = await realCopyFile(source, target, flags)
      if (source === b) {
        const writerPath = b + '.writer-replacement'
        await fs.promises.writeFile(writerPath, replacement)
        await fs.promises.rename(writerPath, b)
      }
      return result
    }
    let result
    try {
      result = await vault.detach(b)
    } finally {
      fs.promises.copyFile = realCopyFile
    }

    assert.strictEqual(result.status, 'stale')
    assert.deepStrictEqual(await fs.promises.readFile(b), replacement)
    assert.strictEqual(fs.existsSync(b + Vault.TMP_SUFFIX), false)
    assert.strictEqual(vault.registry.excluded.has(b), false)
  })

  test('detach preserves a temporary path replaced before rename', async () => {
    const { home, vault } = await makeEnv()
    const { content, b } = await makeSharedPair(home, vault)
    const tmp = b + Vault.TMP_SUFFIX
    const savedCopy = tmp + '.saved-copy'
    const realLstat = fs.promises.lstat
    let tmpReads = 0
    fs.promises.lstat = async (target, options) => {
      if (path.resolve(String(target)) === tmp) {
        tmpReads += 1
        if (tmpReads === 2) {
          await fs.promises.rename(tmp, savedCopy)
          await fs.promises.writeFile(tmp, 'unrelated')
        }
      }
      return realLstat(target, options)
    }
    let result
    try {
      result = await vault.detach(b)
    } finally {
      fs.promises.lstat = realLstat
    }

    assert.strictEqual(result.status, 'stale')
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    assert.strictEqual(await fs.promises.readFile(tmp, 'utf8'), 'unrelated')
    assert.strictEqual(vault.registry.excluded.has(b), false)
  })

  test('detach and undo stop when the owning app starts during the copy', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault)
    const realCopyFile = fs.promises.copyFile
    const startApp = async (...args) => {
      const result = await realCopyFile(...args)
      vault.kernel.api = {
        running: { started: true },
        running_paths: { started: path.resolve(home, 'api', 'appB', 'start.js') }
      }
      return result
    }
    fs.promises.copyFile = startApp
    let detached
    try {
      detached = await vault.detach(b)
      vault.kernel.api = null
      const undone = await vault.undoBatch('batch-m.bin')
      assert.strictEqual(undone.undone, 0)
      assert.strictEqual(undone.failed, 1)
    } finally {
      fs.promises.copyFile = realCopyFile
    }

    assert.strictEqual(detached.status, 'locked')
    assert.ok((await fs.promises.stat(b)).nlink > 1)
    assert.strictEqual(fs.existsSync(b + Vault.TMP_SUFFIX), false)
  })

  test('detach does not register a writer replacement that wins after the atomic rename', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault)
    const replacement = Buffer.from('newer-writer-content')
    const realRename = fs.promises.rename
    fs.promises.rename = async (source, target) => {
      const result = await realRename(source, target)
      if (source === b + Vault.TMP_SUFFIX && target === b) {
        const writerPath = b + '.writer-replacement'
        await fs.promises.writeFile(writerPath, replacement)
        await realRename(writerPath, b)
      }
      return result
    }
    let result
    try {
      result = await vault.detach(b)
    } finally {
      fs.promises.rename = realRename
    }

    assert.strictEqual(result.status, 'stale')
    assert.deepStrictEqual(await fs.promises.readFile(b), replacement)
    assert.strictEqual(vault.registry.excluded.has(b), false)
    assert.strictEqual(fs.existsSync(b + Vault.TMP_SUFFIX), false)
  })

  test('detach stays registered when metadata fails after the atomic replacement', async () => {
    const { home, vault } = await makeEnv()
    const { content, b } = await makeSharedPair(home, vault)
    const realRename = fs.promises.rename
    const realLstat = fs.promises.lstat
    let committed = false
    let failedRead = false
    fs.promises.rename = async (source, target) => {
      const result = await realRename(source, target)
      if (source === b + Vault.TMP_SUFFIX && target === b) committed = true
      return result
    }
    fs.promises.lstat = async (target, options) => {
      if (committed && !failedRead && path.resolve(String(target)) === b) {
        failedRead = true
        const error = new Error('temporary post-rename metadata failure')
        error.code = 'EIO'
        throw error
      }
      return realLstat(target, options)
    }
    let result
    try {
      result = await vault.detach(b)
    } finally {
      fs.promises.rename = realRename
      fs.promises.lstat = realLstat
    }

    assert.strictEqual(failedRead, true)
    assert.strictEqual(result.status, 'detached')
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
    assert.strictEqual(vault.registry.links.has(b), false)
    assert.strictEqual(vault.registry.excluded.get(b).size, content.length)
  })

  test('undo never overwrites a file replaced while bytes are being copied out', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault)
    const replacement = Buffer.from('newer-writer-content')
    const realCopyFile = fs.promises.copyFile
    fs.promises.copyFile = async (source, target, flags) => {
      const result = await realCopyFile(source, target, flags)
      if (target === b + Vault.TMP_SUFFIX) {
        const writerPath = b + '.writer-replacement'
        await fs.promises.writeFile(writerPath, replacement)
        await fs.promises.rename(writerPath, b)
      }
      return result
    }
    let result
    try {
      result = await vault.undoBatch('batch-m.bin')
    } finally {
      fs.promises.copyFile = realCopyFile
    }

    assert.strictEqual(result.undone, 0)
    assert.strictEqual(result.failed, 1)
    assert.deepStrictEqual(await fs.promises.readFile(b), replacement)
    assert.strictEqual(fs.existsSync(b + Vault.TMP_SUFFIX), false)
  })

  test('detach and undo use the current owning app even with a stale broad source id', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault)
    vault.registry.links.get(b).source_id = 'pinokio'
    vault.kernel.api = {
      running: { custom: true },
      running_paths: { custom: path.resolve(home, 'api', 'appB', 'start.js') }
    }

    assert.strictEqual((await vault.detach(b)).status, 'locked')
    const undone = await vault.undoBatch('batch-m.bin')
    assert.strictEqual(undone.undone, 0)
    assert.strictEqual(undone.failed, 1)
    assert.ok((await fs.promises.stat(b)).nlink > 1)
  })

  test('detach and undo never follow a parent-directory link outside the source', {
    skip: process.platform === 'win32'
  }, async () => {
    const { home, vault } = await makeEnv()
    const { content, b } = await makeSharedPair(home, vault, 'nested/m.bin')
    const outsideParent = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-detach-outside-'))
    homes.push(outsideParent)
    const moved = path.resolve(outsideParent, 'moved')
    const nested = path.dirname(b)
    await fs.promises.rename(nested, moved)
    await fs.promises.symlink(moved, nested)
    const before = await fs.promises.stat(b)

    assert.strictEqual((await vault.detach(b)).status, 'stale')
    const undone = await vault.undoBatch('batch-nested/m.bin')

    assert.strictEqual(undone.undone, 0)
    assert.strictEqual(undone.failed, 1)
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    const after = await fs.promises.stat(b)
    assert.strictEqual(after.dev, before.dev)
    assert.strictEqual(after.ino, before.ino)
    assert.strictEqual(vault.registry.excluded.has(b), false)
  })

  test('detach on a pending duplicate just ignores it', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(a, hash, { app: 'appA' })
    const b = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    vault.registry.duplicates.set(b, { hash, size: content.length, app: 'appB' })

    const result = await vault.detach(b)
    assert.strictEqual(result.status, 'ignored')
    assert.strictEqual(vault.registry.duplicates.has(b), false)
    assert.ok(vault.registry.excluded.has(b))
    assert.strictEqual(vault.registry.excluded.get(b).size, content.length)
    assert.ok((await vault.registry.readEvents()).some((event) => event.kind === 'skip' && event.path === b))
  })

  test('detach pins a copy-mode file without copying it again', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    vault.mode = 'copy'
    assert.strictEqual((await vault.adopt(file, hash, { app: 'appA' })).status, 'copy-mode')
    const before = await fs.promises.stat(file)
    const realCopyFile = fs.promises.copyFile
    fs.promises.copyFile = async () => {
      throw new Error('copyFile must not be called for copy-mode files')
    }
    let result
    try {
      result = await vault.detach(file)
    } finally {
      fs.promises.copyFile = realCopyFile
    }

    const after = await fs.promises.stat(file)
    assert.strictEqual(result.status, 'ignored')
    assert.strictEqual(after.dev, before.dev)
    assert.strictEqual(after.ino, before.ino)
    assert.deepStrictEqual(await fs.promises.readFile(file), content)
    assert.strictEqual(vault.registry.excluded.get(file).size, content.length)
    assert.ok((await vault.registry.readEvents()).some((event) => event.kind === 'skip' && event.path === file))
  })

  test('status(): disk figures, scan metadata, excluded list', async () => {
    const { home, vault } = await makeEnv()
    const { content, hash } = await makeSharedPair(home, vault)
    await vault.detach(path.resolve(home, 'api', 'appB', 'm.bin'))
    await vault.sweeper.scan()
    const status = await vault.status()
    assert.strictEqual(status.enabled, true)
    assert.strictEqual(status.bytes_on_disk, content.length)
    assert.ok(status.last_scan && status.last_scan.files > 0)
    assert.strictEqual(status.excluded.length, 1)
    assert.strictEqual(status.excluded[0].size, content.length)
    assert.strictEqual(status.blobs.length, 1)
    assert.deepStrictEqual(status.blobs[0].apps, ['appA'])
    assert.ok(status.scan && status.scan.active === false)

    await fs.promises.rm(path.resolve(home, 'api', 'appB'), { recursive: true })
    await vault.refreshSources()
    const afterSourceRemoval = await vault.status()
    assert.strictEqual(afterSourceRemoval.excluded.length, 1, 'user-owned exclusions survive source removal')
    assert.strictEqual(afterSourceRemoval.excluded[0].size, content.length)
  })

  test('tracked storage metrics include physical pending duplicates', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.sweeper.scan()

    const status = await vault.status()
    assert.strictEqual(status.pending_bytes, content.length)
    assert.strictEqual(status.bytes_on_disk, content.length * 2)
    assert.strictEqual(status.bytes_without_sharing, content.length * 2)
    assert.strictEqual(status.saved_by_sharing, 0)
  })

  test('app status exposes only that app while retaining its matching locations', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const appAFile = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const appBFile = await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), content)
    await vault.sweeper.scan()
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')

    const status = await vault.status(appB.id)

    assert.strictEqual(status.scope_id, appB.id)
    assert.deepStrictEqual(status.sources.map((source) => source.id), [appB.id])
    assert.strictEqual(status.sources[0].parent_id, null)
    assert.deepStrictEqual(status.duplicates.map((item) => item.path), [appBFile])
    assert.strictEqual(status.blobs.length, 1)
    assert.deepStrictEqual(new Set(status.blobs[0].names.map((name) => name.path)),
      new Set([appAFile]))
    assert.strictEqual(status.pending_bytes, content.length)
    assert.strictEqual(status.tracked_bytes, content.length)
    assert.strictEqual(status.effective_bytes, content.length)
    assert.strictEqual(status.shared_bytes, 0)
    assert.ok(status.last_scan && status.last_scan.files === 1)

    const converted = await vault.perform('deduplicate', { scope_id: appB.id })
    assert.strictEqual(converted.converted, 1)
    const sharedStatus = await vault.status(appB.id)
    assert.strictEqual(sharedStatus.shared_bytes, content.length)
    assert.strictEqual(sharedStatus.effective_bytes, content.length / 2)
  })

  test('app effective usage divides shared files across locations and fully counts other files', async () => {
    const { home, vault } = await makeEnv()
    const shared = crypto.randomBytes(4096)
    const small = crypto.randomBytes(512)
    const hash = sha256(shared)
    const appAFile = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), shared)
    const appBFile = await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), shared)
    const appCFile = await writeFile(path.resolve(home, 'api', 'appC', 'model.bin'), shared)
    await writeFile(path.resolve(home, 'api', 'appA', 'config.bin'), small)
    await vault.sweeper.scan()
    const sources = Object.fromEntries(vault.sources()
      .filter((source) => source.kind === 'app')
      .map((source) => [source.app, source]))

    assert.strictEqual((await vault.convert(appBFile, hash, {
      app: 'appB', source_id: sources.appB.id
    })).status, 'converted')
    assert.strictEqual((await vault.convert(appCFile, hash, {
      app: 'appC', source_id: sources.appC.id
    })).status, 'converted')

    const status = await vault.status(sources.appA.id)
    assert.strictEqual(status.last_scan.bytes_total, shared.length + small.length)
    assert.strictEqual(status.tracked_bytes, shared.length)
    assert.strictEqual(status.effective_bytes, small.length + (shared.length / 3))
    assert.strictEqual((await fs.promises.stat(appAFile)).nlink, 4, 'three locations plus the hidden store name')
  })

  test('activity exposes source-relative paths instead of bare filenames', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const first = await writeFile(path.resolve(home, 'api', 'appA', 'models', 'm.bin'), content)
    const second = await writeFile(path.resolve(home, 'api', 'appB', 'models', 'm.bin'), content)
    await vault.refreshSources()
    const appA = vault.sources().find((source) => source.kind === 'app' && source.app === 'appA')
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    await vault.adopt(first, hash, { app: 'appA', source_id: appA.id })
    await vault.convert(second, hash, { app: 'appB', source_id: appB.id, batch_id: 'activity-path' })

    const status = await vault.status()
    const conversion = status.events.find((event) => event.kind === 'convert')
    assert.strictEqual(conversion.source_label, 'appB')
    assert.strictEqual(conversion.relative_path, 'models/m.bin')

    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /event\.relative_path \|\| event\.path/)
    assert.doesNotMatch(vaultPage, /event\.path \? basename\(event\.path\)/)
  })

  test('activity keeps its source-relative context after a source disappears', async () => {
    const { home, vault } = await makeEnv()
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'models', 'm.bin'), crypto.randomBytes(4096))
    await vault.refreshSources()
    const source = vault.sources().find((item) => item.kind === 'app' && item.app === 'appA')
    await vault.recordEvent({ kind: 'found', path: file, source_id: source.id, size: 4096 })
    await fs.promises.rm(path.resolve(home, 'api', 'appA'), { recursive: true, force: true })
    await vault.refreshSources()

    const status = await vault.status()
    const event = status.events.find((item) => item.kind === 'found')
    assert.strictEqual(event.source_label, 'appA')
    assert.strictEqual(event.relative_path, 'models/m.bin')
  })

  test('activity exposes the complete retained bounded event window', async () => {
    const { vault } = await makeEnv()
    for (let index = 0; index < 110; index += 1) {
      await vault.registry.appendEvent({ kind: 'found', index })
    }

    const status = await vault.status()
    assert.strictEqual(status.events.length, 110)
    assert.strictEqual(status.events[0].index, 109)
    assert.strictEqual(status.events[109].index, 0)
  })

  test('reclaimAll frees every orphan and nothing else', async () => {
    const { home, vault } = await makeEnv()
    const keep = crypto.randomBytes(4096)
    const drop = crypto.randomBytes(4096)
    const keptFile = await writeFile(path.resolve(home, 'api', 'appA', 'keep.bin'), keep)
    const droppedFile = await writeFile(path.resolve(home, 'api', 'appA', 'drop.bin'), drop)
    await vault.adopt(keptFile, sha256(keep), { app: 'appA' })
    await vault.adopt(droppedFile, sha256(drop), { app: 'appA' })
    await fs.promises.unlink(droppedFile)
    await vault.verify()
    const result = await vault.reclaimAll()
    assert.strictEqual(result.reclaimed, 1)
    assert.strictEqual(result.bytes_freed, drop.length)
    assert.ok(vault.registry.blobs.has(sha256(keep)))
    assert.strictEqual(vault.registry.blobs.has(sha256(drop)), false)
  })

  test('reclaimAll records earlier deletions if a later reclaim fails', async () => {
    const { home, vault } = await makeEnv()
    const first = crypto.randomBytes(4096)
    const second = crypto.randomBytes(4096)
    const firstHash = sha256(first)
    const secondHash = sha256(second)
    const firstFile = await writeFile(path.resolve(home, 'api', 'appA', 'first.bin'), first)
    const secondFile = await writeFile(path.resolve(home, 'api', 'appA', 'second.bin'), second)
    await vault.adopt(firstFile, firstHash, { app: 'appA' })
    await vault.adopt(secondFile, secondHash, { app: 'appA' })
    await fs.promises.unlink(firstFile)
    await fs.promises.unlink(secondFile)
    await vault.verify()
    const realReclaim = vault.reclaim.bind(vault)
    let calls = 0
    vault.reclaim = async (...args) => {
      calls += 1
      if (calls === 2) {
        const error = new Error('transient unlink failure')
        error.code = 'EIO'
        throw error
      }
      return realReclaim(...args)
    }
    try {
      await assert.rejects(vault.reclaimAll(), (error) => error.code === 'EIO')
    } finally {
      vault.reclaim = realReclaim
    }

    assert.strictEqual(fs.existsSync(vault.storePathFor(firstHash)), false)
    assert.strictEqual(vault.registry.blobs.has(firstHash), false)
    assert.strictEqual(fs.existsSync(vault.storePathFor(secondHash)), true)
    assert.strictEqual(vault.registry.blobs.has(secondHash), true)
  })

  test('status fails closed on a non-missing store metadata error', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(file, hash, { app: 'appA' })
    const storePath = vault.storePathFor(hash)
    const realStat = fs.promises.lstat
    fs.promises.lstat = async (target, options) => {
      if (path.resolve(target) === storePath) {
        const error = new Error('transient metadata failure')
        error.code = 'EIO'
        throw error
      }
      return realStat(target, options)
    }
    try {
      await assert.rejects(vault.status(), (error) => error.code === 'EIO')
    } finally {
      fs.promises.lstat = realStat
    }

    assert.strictEqual(vault.registry.blobs.has(hash), true)
    assert.strictEqual(vault.registry.links.has(file), true)
  })

  test('queued and failed scans remain visible to progress polling', async () => {
    const { vault } = await makeEnv()
    let release
    const blocker = vault.runExclusive(() => new Promise((resolve) => { release = resolve }))
    await new Promise((resolve) => setImmediate(resolve))
    assert.strictEqual(vault.startScan().started, true)
    const queuedScan = vault.scanPromise
    const queuedStatus = vault.scanStatus()
    assert.strictEqual(queuedStatus.pending, true)
    assert.strictEqual(queuedStatus.active, false)
    assert.strictEqual(queuedStatus.phase, 'queued')
    assert.strictEqual(queuedStatus.files, 0)
    release()
    await blocker
    await queuedScan
    assert.strictEqual(vault.scanStatus().pending, false)

    const realScan = vault.sweeper.scan.bind(vault.sweeper)
    vault.sweeper.scan = async () => {
      throw new Error('scan read failed')
    }
    assert.strictEqual(vault.startScan().started, true)
    const failedScan = vault.scanPromise
    await assert.rejects(failedScan, /scan read failed/)
    vault.sweeper.scan = realScan
    assert.strictEqual(vault.scanStatus().pending, false)
    assert.strictEqual(vault.scanStatus().error, 'scan read failed')

    const source = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
    assert.match(source, /scan\.pending \|\| scan\.active/)
    assert.match(source, /\|\| state\.scanRequested\) delay = 1500/)
  })

  test('partial scans remain visible with their inaccessible paths and do not masquerade as complete', async () => {
    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /scan_incomplete:\s*"Scan incomplete"/)
    assert.match(vaultPage, /data\.scan\.phase === "incomplete"/)
    assert.match(vaultPage, /id="btn-scan-problems" aria-expanded=/)
    assert.match(vaultPage, /id="vault-result-paths"/)
    assert.match(vaultPage, /paths\.hidden = !state\.scanProblemsOpen/)
    assert.match(vaultPage, /info\.inaccessiblePaths\.map\(\(filePath\) =>/)
    assert.match(vaultPage, /class="vault-result-path"/)
    assert.match(vaultPage, /\.vault-result\.incomplete \{[\s\S]*?flex:\s*0 0 auto/)
    assert.match(vaultPage, /\.vault-result-path span \{[\s\S]*?overflow-wrap:\s*anywhere/)
    assert.match(vaultPage, /\.vault-result-paths \{[\s\S]*?max-height:\s*144px[\s\S]*?overflow-y:\s*auto/)
    assert.doesNotMatch(vaultPage, /inaccessiblePaths\.map\(esc\)\.join\(" · "\)/)
  })

  test('progress remains active and below completion while scan verification runs', async () => {
    const { vault } = await makeEnv()
    const realVerify = vault.verify.bind(vault)
    let entered
    let release
    const verifyEntered = new Promise((resolve) => { entered = resolve })
    const verifyRelease = new Promise((resolve) => { release = resolve })
    vault.verify = async () => {
      entered()
      await verifyRelease
      return realVerify()
    }
    assert.strictEqual(vault.startScan().started, true)
    const scan = vault.scanPromise
    try {
      await verifyEntered
      const status = vault.progressStatus().scan
      assert.strictEqual(status.active, true)
      assert.strictEqual(status.phase, 'verifying')
      const source = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
      assert.match(source, /verifying\s*\?\s*0\.99/)
    } finally {
      release()
      await scan
      vault.verify = realVerify
    }
  })

  test('item 16: vocabulary lint — vault page copy avoids forbidden terms', async () => {
    const forbidden = /hard.?link|junction|symlink|inode|\bblob\b|\bstore\b|\bdedupe\b|\bvault\b/i
    const vaultPage = await vaultPageSource()
    const copyBlock = vaultPage.match(/const COPY = \{[\s\S]*?\n\}/)
    assert.ok(copyBlock, 'vault.ejs must keep user copy in a COPY object')
    for (const m of copyBlock[0].matchAll(/:\s*"([^"]*)"/g)) {
      assert.ok(!forbidden.test(m[1]), `forbidden term in vault page copy: "${m[1]}"`)
    }
    const outsideCopy = vaultPage.replace(copyBlock[0], '')
    assert.doesNotMatch(outsideCopy, /Add external folder|folder picker could not be opened|Couldn’t load Save space status|Search in \$\{/)
  })

  test('duplicate matches show complete filesystem paths without ellipsis', async () => {
    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /class="vault-match-path">\$\{esc\(match\.path\)\}/)
    const style = vaultPage.match(/\.vault-match-path \{[\s\S]*?\n\}/)
    assert.ok(style, 'match path must have dedicated wrapping styles')
    assert.match(style[0], /overflow-wrap:\s*anywhere/)
    assert.match(style[0], /white-space:\s*normal/)
    assert.doesNotMatch(style[0], /text-overflow:\s*ellipsis/)
  })

  test('copy-mode tracking never claims physical sharing savings', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const first = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const second = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    const firstStat = await fs.promises.stat(first)
    const secondStat = await fs.promises.stat(second)
    vault.registry.addBlob(hash, { size: content.length })
    vault.registry.addLink(first, { hash, app: 'appA', dev: firstStat.dev, ino: firstStat.ino, mode: 'copy' })
    vault.registry.addLink(second, { hash, app: 'appB', dev: secondStat.dev, ino: secondStat.ino, mode: 'copy' })

    const status = await vault.status()
    assert.strictEqual(status.bytes_on_disk, content.length * 2)
    assert.strictEqual(status.saved_by_sharing, 0)
  })

  test('repair is advanced, metrics distinguish detected and explicit savings, and refresh retries', async () => {
    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /disk_space_saved:\s*"of disk space saved"/)
    assert.match(vaultPage, /before_help:\s*"Estimated space if every app stored its own copy\."/)
    assert.match(vaultPage, /nothing_more_to_save:\s*"Nothing else to save"/)
    assert.match(vaultPage, /more_can_be_saved:\s*"\{size\} more can be saved"/)
    assert.match(vaultPage, /fmt\(data\.saved_by_sharing\)/)
    assert.match(vaultPage, /Number\(data\.bytes_without_sharing\)/)
    assert.match(vaultPage, /Number\(data\.bytes_on_disk\)/)
    assert.match(vaultPage, /Number\(data\.pending_bytes\)/)
    assert.match(vaultPage, /id="btn-review-metric"/)
    assert.match(vaultPage, /id='vault-storage-details'/)
    assert.match(vaultPage, /fmt\(data\.lifetime_bytes_saved\)/)
    assert.match(vaultPage, /repair_index:\s*"Repair index"/)
    assert.match(vaultPage, /<details class='vault-advanced'/)
    assert.doesNotMatch(vaultPage, /id='btn-rebuild'/)
    const refreshBlock = vaultPage.match(/const refresh = async \(\) => \{[\s\S]*?\n\}/)
    assert.ok(refreshBlock)
    assert.match(refreshBlock[0], /finally/)
    assert.doesNotMatch(vaultPage, /priorScanning/)
    assert.match(vaultPage, /const deduplicateFeedback = \(result\) =>/)
    assert.match(vaultPage, /\(result\.locked \|\| 0\) \+ \(result\.incompatible \|\| 0\) \+ \(result\.unavailable \|\| 0\) \+ \(result\.failed \|\| 0\)/)
    assert.match(refreshBlock[0], /delay == null \? null : setTimeout/)
    assert.match(vaultPage, /if \(!response\.ok\)/)
    assert.match(vaultPage, /item\.unavailable_reason === "different_disk" \? COPY\.different_disk : COPY\.sharing_unavailable/)
    assert.match(vaultPage, /role='status' aria-live='polite'/)
    assert.match(vaultPage, /if \(state\.view === "activity"\) return activityItems\(\)/)
    assert.match(vaultPage, /if \(state\.view === "reclaimable"\) return state\.data\.blobs\.filter/)
    assert.match(vaultPage, /hashTotal - \(scan\.queued \|\| 0\)/)
    assert.doesNotMatch(vaultPage, /item\.saved/)
  })

  test('vault uses compact desktop density without truncating duplicate matches', async () => {
    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /--vault-control-height:\s*28px/)
    assert.match(vaultPage, /--vault-row-height:\s*44px/)
    assert.match(vaultPage, /--vault-tree-row:\s*26px/)
    assert.match(vaultPage, /--vault-tree-path-row:\s*34px/)
    assert.match(vaultPage, /\.vault-shell \*,?[\s\S]*?box-sizing:\s*border-box/)
    assert.match(vaultPage, /grid-template-columns:\s*248px minmax\(0, 1fr\)/)
    assert.match(vaultPage, /\.vault-toolbar \{[\s\S]*?min-height:\s*44px/)
    assert.match(vaultPage, /\.vault-match-path \{[\s\S]*?overflow-wrap:\s*anywhere/)
    assert.doesNotMatch(vaultPage, /<header class='task-shell-header'>/)
    assert.doesNotMatch(vaultPage, /id='vault-(?:title|subtitle)'/)
    assert.match(vaultPage, /body\[data-vault-mode="global"\] \.vault-overview,[\s\S]*?min-height:\s*104px/)
    assert.match(vaultPage, /\.vault-metrics\.summary \{[\s\S]*?grid-template-columns:\s*minmax\(430px, 620px\) minmax\(230px, 1fr\)/)
    assert.match(vaultPage, /\.vault-compare-row \{[\s\S]*?grid-template-columns:\s*54px minmax\(180px, 1fr\) 68px/)
    assert.match(vaultPage, /\.vault-compare-fill\.after \{[\s\S]*?width:\s*var\(--vault-after-ratio\)/)
    assert.match(vaultPage, /class="vault-compare-info" tabindex="0" aria-describedby="\$\{helpId\}"/)
    assert.match(vaultPage, /class="vault-compare-tooltip" id="\$\{helpId\}" role="tooltip"/)
    assert.match(vaultPage, /\.vault-compare-info:hover \.vault-compare-tooltip,[\s\S]*?\.vault-compare-info:focus \.vault-compare-tooltip \{[\s\S]*?visibility:\s*visible/)
    assert.doesNotMatch(vaultPage, /\.vault-metric \{/)
    assert.match(vaultPage, /\.vault-table\.inventory \.vault-columns,[\s\S]*?grid-template-columns:\s*minmax\(260px, 1\.7fr\) minmax\(72px, \.4fr\) minmax\(240px, 1fr\)/)
    assert.match(vaultPage, /\.vault-table\.activity \.vault-columns,[\s\S]*?grid-template-columns:[^;]+;/)
    assert.match(vaultPage, /\.vault-table\.flat \.vault-columns,[\s\S]*?grid-template-columns:[^;]+;/)
    assert.match(vaultPage, /\.vault-display-mode \{[\s\S]*?height:\s*30px/)
    assert.match(vaultPage, /\.vault-flat-location \{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal/)
    assert.match(vaultPage, /\.vault-sharing-switch::before \{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*18px;/)
    assert.match(vaultPage, /\.vault-sharing-switch\.on \.vault-sharing-thumb \{[\s\S]*?transform:\s*translateX\(14px\)/)
    assert.match(vaultPage, /\.vault-sharing-switch:focus-visible/)
    assert.match(vaultPage, /id='btn-add-source'/)
    assert.match(vaultPage, /<script src="\/Socket\.js"><\/script>/)
    assert.match(vaultPage, /action:\s*"add_source"/)
    assert.match(vaultPage, /identical_contents_at:\s*"Identical contents at"/)
    assert.doesNotMatch(vaultPage, /Matching locations/)
    assert.match(vaultPage, /scan_waiting:\s*"Waiting for scan results"/)
    assert.match(vaultPage, /view === "all" && !activeScan \? `<button class="vault-button" type="button" id="btn-empty-scan"/)
    assert.match(vaultPage, /class="vault-progress-track"/)
    assert.match(vaultPage, /role="progressbar"/)
    assert.match(vaultPage, /const counting = scanPhase === "counting"/)
    assert.match(vaultPage, /const hashTotal = scan\.hash_total/)
    assert.match(vaultPage, /const totalFiles = Number\.isFinite\(scan\.total_files\)/)
    assert.match(vaultPage, /scan_counting_help:\s*"The first scan cannot know its total until this pass finishes"/)
    assert.match(vaultPage, /scan_count_estimate_help:\s*"Estimated from the exact file total and timing of the last completed scan"/)
    assert.match(vaultPage, /const countEstimate = Number\.isFinite\(scan\.count_estimate_files\)/)
    assert.match(vaultPage, /const countRatio = countEstimate === null/)
    assert.match(vaultPage, /counting\s*\? countRatio \* countWeight/)
    assert.match(vaultPage, /pinokio:vault:reviewed-scan/)
    assert.match(vaultPage, /completed \|\| incomplete \|\| \(!state\.scanResult && unreviewed\)/)
    assert.match(vaultPage, /state\.data\.undo_batches/)
    assert.match(vaultPage, /data-undo="\$\{attr\(batch\.batch_id\)\}"/)
    assert.match(vaultPage, /last_scan && data\.last_scan\.hash_failures/)
    assert.match(vaultPage, /scan_not_analyzed:\s*"could not be analyzed"/)
    assert.match(vaultPage, /percent = `~\$\{progressValue\}%`/)
    assert.match(vaultPage, /COPY\.scan_checked\.replace\("\{done\}", hashDone\)\.replace\("\{total\}", hashTotal\)/)
    assert.match(vaultPage, /\.vault-progress-bar\.determinate \{[\s\S]*?transform:\s*scaleX/)
    assert.match(vaultPage, /\.vault-progress-bar\.indeterminate \{[\s\S]*?animation:\s*vault-progress-discovery/)
    assert.match(vaultPage, /COPY\.scan_files_checked\.replace\("\{done\}", scan\.files \|\| 0\)\.replace\("\{total\}", totalFiles\)/)
    assert.match(vaultPage, /if \(!scanState\.querySelector\("\.vault-progress-track"\)\)/)
    assert.doesNotMatch(vaultPage, /scanState\.innerHTML = `<i[^\n]*\$\{progress\}/)
    assert.match(vaultPage, /body\.vault-page \.task-container \{[\s\S]*?overflow:\s*hidden/)
    assert.match(vaultPage, /\.vault-explorer \{[\s\S]*?flex:\s*1 1 auto[\s\S]*?overflow:\s*hidden/)
    assert.match(vaultPage, /\.vault-rail \{[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/)
    assert.match(vaultPage, /\.vault-pane \{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
    assert.doesNotMatch(vaultPage, /vault-pane-head/)
    assert.match(vaultPage, /const toolbarSummary = \(visibleItems\) =>/)
    assert.match(vaultPage, /id="vault-toolbar-summary"/)
    assert.match(vaultPage, /\.vault-table-wrap \{[\s\S]*?overflow:\s*auto[\s\S]*?overscroll-behavior:\s*contain/)
    assert.match(vaultPage, /@media \(pointer:\s*coarse\) \{[\s\S]*?--vault-control-height:\s*44px/)
    assert.match(vaultPage, /aria-expanded=/)
    assert.match(vaultPage, /#vault-locations \{[\s\S]*?flex-direction:\s*column[\s\S]*?justify-content:\s*flex-start[\s\S]*?gap:\s*0/)
    assert.match(vaultPage, /\.vault-source-line\.depth-2 \{ padding-left:\s*24px; \}/)
    assert.match(vaultPage, /vault-source-line depth-\$\{Math\.min\(depth, 2\)\} \$\{pathText \? "has-path" : ""\}/)
  })

  test('vault template keeps behavior and styling in dedicated assets', async () => {
    const template = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'views', 'vault.ejs'), 'utf8')
    assert.match(template, /<link href="\/vault\.css" rel="stylesheet"\/>/)
    assert.match(template, /<script src="\/vault\.js"><\/script>/)
    assert.doesNotMatch(template, /<style>/)
    assert.doesNotMatch(template, /<script>\s*const COPY/)
  })

  test('app Save space reuses the Vault workspace in the retained app frame', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const [appTemplate, globalTemplate, embeddedTemplate] = await Promise.all([
      fs.promises.readFile(path.resolve(views, 'app.ejs'), 'utf8'),
      fs.promises.readFile(path.resolve(views, 'vault.ejs'), 'utf8'),
      fs.promises.readFile(path.resolve(views, 'vault_app.ejs'), 'utf8')
    ])
    assert.match(appTemplate, /id='save-space-tab'[\s\S]*?target="app-vault"[\s\S]*?class="btn header-item frame-link"/)
    assert.match(appTemplate, /class="btn header-item frame-link"[^>]*data-tab-link-popover="false"/)
    assert.ok(appTemplate.indexOf("id='save-space-tab'") < appTemplate.indexOf('class="app-autolaunch"'))
    assert.match(globalTemplate, /include\('partials\/vault_workspace', \{ appMode: false \}\)/)
    assert.match(embeddedTemplate, /include\('partials\/vault_workspace', \{ appMode: true \}\)/)

    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', agent: 'electron', scope_id: 'app:appB'
    })
    assert.match(html, /data-vault-mode="app"/)
    assert.match(html, /data-vault-scope="app:appB"/)
    assert.match(html, /id='btn-scan'/)
    assert.match(html, /id='vault-explorer'/)
    assert.doesNotMatch(html, /id='btn-add-source'/)
    assert.doesNotMatch(html, /id='btn-repair'/)
    assert.doesNotMatch(html, /src="\/Socket\.js"/)

    const serverSource = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'index.js'), 'utf8')
    const routeStart = serverSource.indexOf('this.app.get("/vault/app/:name"')
    const routeEnd = serverSource.indexOf('this.app.post("/vault/action"', routeStart)
    const route = serverSource.slice(routeStart, routeEnd)
    assert.ok(routeStart >= 0 && routeEnd > routeStart)
    assert.match(route, /isSameOriginRequest/)
    assert.match(route, /item\.kind === "app" && item\.app === req\.params\.name && item\.available/)
    assert.match(route, /res\.render\("vault_app"/)
    const infoRoute = serverSource.slice(
      serverSource.indexOf('this.app.get("/info/dedup"'),
      serverSource.indexOf('this.app.get("/vault"')
    )
    assert.match(infoRoute, /req\.query\.scope_id/)
    assert.match(infoRoute, /vault\.status\(scopeId\)/)
    assert.match(infoRoute, /vault\.progressStatus\(scopeId\)/)
  })

  test('fixed Save space navigation opts out of dynamic tab actions', async () => {
    const script = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'tab-link-popover.js'), 'utf8')
    const dom = new JSDOM(`
      <div class="appcanvas"><aside><div class="menu-container">
        <a id="save-space" class="frame-link" href="/vault/app/example" data-tab-link-popover="false">Save space</a>
        <a id="dynamic-tab" class="frame-link" href="http://localhost:8000">Web UI</a>
      </div></aside></div>
    `, { url: 'http://localhost/app/example', runScripts: 'dangerously' })
    dom.window.eval(script)
    dom.window.setupTabLinkHover()

    assert.strictEqual(dom.window.document.querySelector('#save-space .tab-link-popover-trigger'), null)
    assert.ok(dom.window.document.querySelector('#dynamic-tab .tab-link-popover-trigger'))
    dom.window.close()
  })

  test('app Vault workspace loads scoped data without global-only controls', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const requests = []
    dom.window.fetch = async (url) => {
      requests.push(String(url))
      return {
        ok: true,
        json: async () => ({
          enabled: true,
          mode: 'link',
          scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
          last_scan: null,
          tracked_bytes: 0,
          effective_bytes: null,
          shared_bytes: 0,
          pending_bytes: 0,
          activity_error: null,
          cloud_sync_warning: null,
          sources: [{
            id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
            display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
          }],
          blobs: [], duplicates: [], excluded: [], events: [], undo_batches: []
        })
      }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.deepStrictEqual(requests, ['/info/dedup?scope_id=app%3AappB'])
    assert.match(dom.window.document.getElementById('btn-scan').textContent, /Scan this app/)
    assert.strictEqual(dom.window.document.querySelector('[data-source="app:appB"]').getAttribute('aria-current'), 'page')
    assert.strictEqual(dom.window.document.getElementById('btn-add-source'), null)
    assert.strictEqual(dom.window.document.getElementById('btn-repair'), null)
    dom.window.close()
  })

  test('app Save space header shows proportional effective disk usage', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const gb = 1024 ** 3
    dom.window.fetch = async () => ({
      ok: true,
      json: async () => ({
        enabled: true,
        mode: 'link',
        scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
        last_scan: { ts: Date.now(), bytes_total: 6.6 * gb },
        tracked_bytes: 6.5 * gb,
        effective_bytes: 2.4 * gb,
        shared_bytes: 4.3 * gb,
        pending_bytes: 0,
        activity_error: null,
        cloud_sync_warning: null,
        sources: [{
          id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
          display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
        }],
        blobs: [], duplicates: [], excluded: [], events: [], undo_batches: []
      })
    })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.strictEqual(dom.window.document.querySelector('.vault-summary-value').textContent, '4.51 GB saved for this app')
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-compare-value')].map((node) => node.textContent), ['7.09 GB', '2.58 GB'])
    assert.match(dom.window.document.querySelector('.vault-compare-fill.after').getAttribute('style'), /--vault-after-ratio:36\.36%/)
    assert.strictEqual(dom.window.document.getElementById('vault-after-help').textContent,
      'Shared files are divided evenly among every location using them.')
    assert.match(await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.css'), 'utf8'),
      /body\[data-vault-mode="app"\] \.vault-compare-tooltip \{[\s\S]*?left:\s*0;[\s\S]*?transform:\s*translateY\(-2px\)/)
    assert.match(dom.window.document.querySelector('.vault-summary-side').textContent, /Nothing else to save/)
    dom.window.close()
  })

  test('app header and Save space share decimal storage units', async () => {
    const dom = new JSDOM('', { runScripts: 'dangerously' })
    const formatter = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'public', 'storage-size.js'), 'utf8')
    dom.window.eval(formatter)
    assert.strictEqual(dom.window.PinokioFormatStorageSize(7.05e9), '7.05 GB')
    assert.strictEqual(dom.window.PinokioFormatStorageSize(5.3e9), '5.3 GB')

    const appView = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'views', 'app.ejs'), 'utf8')
    assert.match(appView, /<script src="\/storage-size\.js"><\/script>/)
    assert.match(appView, /PinokioFormatStorageSize\(res\.du\)/)
    dom.window.close()
  })

  test('global Save space header explains current savings and keeps pending savings actionable', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const workspace = await ejs.renderFile(path.resolve(views, 'partials', 'vault_workspace.ejs'), { appMode: false })
    const dom = new JSDOM(`<body data-vault-mode="global">${workspace}</body>`, {
      url: 'http://localhost/vault', runScripts: 'dangerously'
    })
    const gb = 1024 ** 3
    dom.window.fetch = async () => ({
      ok: true,
      json: async () => ({
        enabled: true,
        mode: 'link',
        scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
        last_scan: { ts: Date.now(), bytes_total: 154.8 * gb, home_bytes_total: 154.8 * gb },
        bytes_on_disk: 377 * gb,
        bytes_without_sharing: 616.3 * gb,
        saved_by_sharing: 239.3 * gb,
        lifetime_bytes_saved: 241 * gb,
        pending_bytes: 12.4 * gb,
        reclaimable: 2048,
        activity_error: null,
        cloud_sync_warning: null,
        sources: [{
          id: 'pinokio', kind: 'pinokio', label: 'Pinokio', root: '/pinokio',
          display_path: '/pinokio', parent_id: null, available: true, shareable: true
        }],
        blobs: [{ hash: 'c'.repeat(64), size: 2048, orphan: true, nlink: 1, names: [] }],
        duplicates: [], excluded: [], events: [], undo_batches: []
      })
    })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.strictEqual(dom.window.document.querySelector('.vault-summary-value').textContent, '256.95 GB of disk space saved')
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-compare-label')].map((node) => node.firstChild.textContent.trim()), ['Before', 'After'])
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-compare-value')].map((node) => node.textContent), ['661.75 GB', '404.8 GB'])
    assert.match(dom.window.document.querySelector('.vault-compare-fill.after').getAttribute('style'), /--vault-after-ratio:61\.17%/)
    assert.strictEqual(dom.window.document.getElementById('vault-before-help').textContent, 'Estimated space if every app stored its own copy.')
    assert.strictEqual(dom.window.document.querySelector('.vault-compare-info').getAttribute('tabindex'), '0')
    assert.match(dom.window.document.querySelector('.vault-summary-side').textContent, /13\.31 GB more can be saved/)
    assert.strictEqual(dom.window.document.getElementById('btn-review-metric').textContent, 'Review files')
    assert.match(dom.window.document.getElementById('vault-storage-details').textContent, /Pinokio folder\s*166\.22 GB/)
    assert.match(dom.window.document.getElementById('vault-storage-details').textContent, /Saved by your actions\s*258\.77 GB/)
    const unusedView = dom.window.document.querySelector('[data-view="reclaimable"]')
    assert.strictEqual(unusedView.querySelector('.vault-nav-name').textContent, 'Unused files')
    unusedView.click()
    assert.strictEqual(dom.window.document.getElementById('btn-reclaim-all').textContent, 'Delete all')
    assert.strictEqual(dom.window.document.querySelector('[data-reclaim]').textContent, 'Delete')
    assert.match(dom.window.document.getElementById('vault-pane-footer').textContent, /Deleting them frees disk space/)
    dom.window.close()
  })

  test('separate explains each safe refusal instead of showing a generic failure', async () => {
    const source = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
    assert.match(source, /const detachFeedback = \(result\) =>/)
    assert.match(source, /locked:\s*COPY\.separate_locked/)
    assert.match(source, /stale:\s*COPY\.separate_changed/)
    assert.match(source, /conflict:\s*COPY\.separate_conflict/)
    assert.match(source, /"not-found":\s*COPY\.separate_not_found/)
    assert.match(source, /runAction\(\{ action: "detach", path: target\.dataset\.detach \}, detachFeedback\)/)
  })

  test('inventory puts sharing switches in status and keeps duplicate Skip inline', async () => {
    const source = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
    assert.match(source, /const duplicateAction = \(item\) => \{[\s\S]*?COPY\.skip/)
    assert.match(source, /item\.status === "shared"[\s\S]*?role="switch" aria-checked="true"[\s\S]*?data-detach/)
    assert.match(source, /item\.status === "independent"[\s\S]*?role="switch" aria-checked="false"[\s\S]*?data-reshare/)
    assert.match(source, /class="vault-status-cell"/)
    assert.doesNotMatch(source, /separate:\s*"Separate"/)
    assert.doesNotMatch(source, /include_in_scans:\s*"Include in scans"/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.status\]/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.matches, COPY\.can_save, ""\]/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.can_free, ""\]/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.last_scanned, ""\]/)
    assert.match(source, /reclaimable:\s*"Unused files"/)
    assert.match(source, /reclaim:\s*"Delete"/)
    assert.match(source, /reclaim_all:\s*"Delete all"/)
    assert.match(source, /data-sort-size/)
    assert.match(source, /data-display-mode="folders"/)
    assert.match(source, /data-display-mode="files"/)
    assert.match(source, /headers = \[COPY\.name, COPY\.location_column, COPY\.size, COPY\.status\]/)
    assert.match(source, /aria-sort="\$\{state\.sizeSort === "desc" \? "descending" : state\.sizeSort === "asc" \? "ascending" : "none"\}"/)
  })

  test('app inventory renders real sharing switches without empty columns', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const actions = []
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 2048 },
      tracked_bytes: 2048,
      effective_bytes: 1536,
      shared_bytes: 1024,
      pending_bytes: 0,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      blobs: [{
        hash: 'a'.repeat(64), size: 1024, orphan: false, nlink: 3,
        names: [
          { path: '/pinokio/api/appB/shared.bin', relative_path: 'shared.bin', source_id: 'app:appB', source_label: 'appB', mode: 'link' },
          { path: '/pinokio/api/appA/shared.bin', relative_path: 'shared.bin', source_id: 'app:appA', source_label: 'appA', mode: 'link' }
        ]
      }],
      duplicates: [],
      excluded: [{
        path: '/pinokio/api/appB/own.bin', relative_path: 'own.bin',
        source_id: 'app:appB', source_label: 'appB', size: 1024
      }],
      events: [], undo_batches: []
    }
    dom.window.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        const action = JSON.parse(options.body)
        actions.push(action)
        return { ok: true, json: async () => action.action === 'reshare' ? { status: 'resharable' } : { status: 'detached' } }
      }
      return { ok: true, json: async () => status }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-table.inventory .vault-columns span')]
      .map((node) => node.textContent), ['Name', 'Size', 'Sharing status'])
    assert.strictEqual(dom.window.document.querySelector('.vault-table.inventory .vault-space'), null)
    assert.strictEqual(dom.window.document.querySelector('.vault-table.inventory .vault-row-action'), null)
    const on = dom.window.document.querySelector('.vault-sharing-switch[aria-checked="true"]')
    const off = dom.window.document.querySelector('.vault-sharing-switch[aria-checked="false"]')
    assert.ok(on && on.classList.contains('on'))
    assert.ok(off && !off.classList.contains('on'))
    assert.strictEqual(on.getAttribute('role'), 'switch')
    assert.strictEqual(on.getAttribute('aria-label'), 'Allow shared.bin to share storage')
    assert.strictEqual(off.getAttribute('aria-label'), 'Allow own.bin to share storage')
    assert.match(off.closest('.vault-status-cell').textContent, /Kept separate/)

    on.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    dom.window.document.querySelector('.vault-sharing-switch[aria-checked="false"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepStrictEqual(actions, [
      { action: 'detach', path: '/pinokio/api/appB/shared.bin' },
      { action: 'reshare', path: '/pinokio/api/appB/own.bin' }
    ])
    dom.window.close()
  })

  test('Shared defaults to a globally size-sorted Files mode and can return to Folders', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const sharedBlob = (hash, size, name) => ({
      hash, size, orphan: false, nlink: 3,
      names: [
        { path: `/pinokio/api/appB/${name}`, relative_path: name, source_id: 'app:appB', source_label: 'appB', mode: 'link' },
        { path: `/pinokio/api/appA/${name}`, relative_path: name, source_id: 'app:appA', source_label: 'appA', mode: 'link' }
      ]
    })
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 5120 },
      tracked_bytes: 5120,
      effective_bytes: 2560,
      shared_bytes: 5120,
      pending_bytes: 0,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      blobs: [
        sharedBlob('a'.repeat(64), 1024, 'a-small/a-small.bin'),
        sharedBlob('b'.repeat(64), 4096, 'z-large/z-large.bin')
      ],
      duplicates: [], excluded: [], events: [], undo_batches: []
    }
    dom.window.fetch = async () => ({ ok: true, json: async () => status })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    dom.window.document.querySelector('[data-view="shared"]').click()
    const names = () => [...dom.window.document.querySelectorAll('.vault-file-row:not(.directory) .vault-file-name')]
      .map((node) => node.textContent)
    const directories = () => [...dom.window.document.querySelectorAll('.vault-file-row.directory .vault-file-name')]
      .map((node) => node.textContent)
    const locations = () => [...dom.window.document.querySelectorAll('.vault-flat-location')]
      .map((node) => node.textContent)
    const sort = () => dom.window.document.querySelector('[data-sort-size]')
    const mode = (name) => dom.window.document.querySelector(`[data-display-mode="${name}"]`)
    assert.strictEqual(mode('files').getAttribute('aria-pressed'), 'true')
    assert.strictEqual(mode('folders').getAttribute('aria-pressed'), 'false')
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-columns > span')]
      .map((node) => node.textContent), ['Name', 'Location', 'Size', 'Sharing status'])
    assert.deepStrictEqual(names(), ['z-large.bin', 'a-small.bin'])
    assert.deepStrictEqual(directories(), [])
    assert.match(locations()[0], /appB \/ z-large\/z-large\.bin/)
    assert.match(locations()[1], /appB \/ a-small\/a-small\.bin/)
    assert.strictEqual(sort().getAttribute('aria-label'), 'Sort by size, smallest first')
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'descending')
    assert.strictEqual(dom.window.document.getElementById('vault-pane-footer').textContent,
      '2 shared files · sorted largest first')

    sort().click()
    assert.deepStrictEqual(names(), ['a-small.bin', 'z-large.bin'])
    assert.strictEqual(sort().getAttribute('aria-label'), 'Sort by size, largest first')
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'ascending')
    assert.strictEqual(dom.window.document.getElementById('vault-pane-footer').textContent,
      '2 shared files · sorted smallest first')

    sort().click()
    assert.deepStrictEqual(names(), ['z-large.bin', 'a-small.bin'])
    assert.strictEqual(sort().getAttribute('aria-label'), 'Sort by size, smallest first')
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'descending')

    mode('folders').click()
    assert.strictEqual(mode('folders').getAttribute('aria-pressed'), 'true')
    assert.strictEqual(mode('files').getAttribute('aria-pressed'), 'false')
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-columns > span')]
      .map((node) => node.textContent), ['Name', 'Size', 'Sharing status'])
    assert.deepStrictEqual(directories(), ['a-small', 'z-large'])
    assert.strictEqual(sort(), null)

    mode('files').click()
    assert.deepStrictEqual(names(), ['z-large.bin', 'a-small.bin'])
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'descending')
    dom.window.close()
  })

  test('vault route provisions the dev requirements needed by its folder picker', async () => {
    const serverSource = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'index.js'), 'utf8')
    const routeStart = serverSource.indexOf('this.app.get("/vault"')
    const routeEnd = serverSource.indexOf('this.app.post("/vault/action"', routeStart)
    assert.ok(routeStart >= 0 && routeEnd > routeStart, 'vault route must be present')
    const route = serverSource.slice(routeStart, routeEnd)
    assert.match(route, /this\.kernel\.bin\.check\(/)
    assert.match(route, /this\.kernel\.bin\.preset\("dev"\)/)
    assert.match(route, /requirements_pending \|\| install_required/)
    assert.match(route, /\/setup\/dev\?callback=\$\{encodeURIComponent\(req\.originalUrl\)\}/)
    assert.ok(route.indexOf('res.redirect') < route.indexOf('res.render("vault"'), 'requirements redirect must happen before rendering Vault')
  })

  test('disabled Vault routes return no data and the sidebar entry can be hidden', async () => {
    const serverSource = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'index.js'), 'utf8')
    const kernelSource = await fs.promises.readFile(path.resolve(__dirname, '..', 'kernel', 'index.js'), 'utf8')
    const sidebar = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'views', 'partials', 'main_sidebar.ejs'), 'utf8')
    const infoRoute = serverSource.slice(serverSource.indexOf('this.app.get("/info/dedup"'), serverSource.indexOf('this.app.get("/vault"'))
    const pageRoute = serverSource.slice(serverSource.indexOf('this.app.get("/vault"'), serverSource.indexOf('this.app.post("/vault/action"'))
    const actionRoute = serverSource.slice(serverSource.indexOf('this.app.post("/vault/action"'), serverSource.indexOf('this.app.get("/info/scripts"'))
    assert.match(infoRoute, /res\.sendStatus\(404\)/)
    assert.match(pageRoute, /res\.sendStatus\(404\)/)
    assert.match(actionRoute, /res\.sendStatus\(404\)/)
    assert.match(infoRoute, /isSameOriginRequest/)
    assert.match(actionRoute, /isSameOriginRequest/)
    assert.match(sidebar, /vaultEnabled/)
    assert.match(sidebar, /fa-solid fa-hard-drive[^\n]*<div class='caption'>Save space<\/div>/)
    assert.doesNotMatch(sidebar, /<div class='caption'>Vault<\/div>/)
    assert.ok(sidebar.indexOf("<div class='caption'>Save space</div>") < sidebar.indexOf("<div class='caption'>Checkpoints</div>"))
    assert.doesNotMatch(kernelSource, /catch\(\(err\) => \{\s*this\.vault\.enabled = false/)
  })

  test('dashboard actions delegate to the engine and deduplication requires a scope', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const pending = await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    vault.registry.duplicates.set(pending, { hash, size: content.length, app: 'appB' })

    const result = await vault.perform('deduplicate', {})

    assert.match(result.error, /location/i)
    assert.strictEqual((await fs.promises.stat(pending)).nlink, 1)
    const serverSource = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'index.js'), 'utf8')
    const actionRoute = serverSource.slice(serverSource.indexOf('this.app.post("/vault/action"'), serverSource.indexOf('this.app.get("/info/scripts"'))
    assert.match(actionRoute, /vault\.perform\(body\.action, body\)/)
    assert.doesNotMatch(actionRoute, /convertPending|runExclusive/)
  })

  test('a stale external source id cannot authorize files outside its current target', async (t) => {
    const { home, vault } = await makeEnv()
    const firstTarget = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-scope-old-'))
    const secondTarget = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-scope-new-'))
    homes.push(firstTarget, secondTarget)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const outside = await writeFile(path.resolve(firstTarget, 'model.bin'), content)
    const mount = path.resolve(home, 'api', 'external-models')
    try {
      await fs.promises.symlink(firstTarget, mount, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }
    await vault.refreshSources()
    const originalSource = vault.sources().find((source) => source.kind === 'app' && source.app === 'appA')
    const externalSource = vault.sources().find((source) => source.kind === 'external' && source.label === 'external-models')
    await vault.adopt(original, hash, { app: 'appA', source_id: originalSource.id })
    const outsideStat = await fs.promises.stat(outside)
    vault.registry.duplicates.set(outside, {
      hash, size: content.length, source_id: externalSource.id,
      dev: outsideStat.dev, ino: outsideStat.ino,
      mtime: outsideStat.mtimeMs, ctime: outsideStat.ctimeMs
    })
    await fs.promises.unlink(mount)
    await fs.promises.symlink(secondTarget, mount, process.platform === 'win32' ? 'junction' : 'dir')

    const result = await vault.perform('deduplicate', { scope_id: externalSource.id })

    assert.strictEqual(result.converted, 0)
    assert.strictEqual((await fs.promises.stat(outside)).nlink, 1)
    assert.ok(vault.registry.duplicates.has(outside))
  })

  test('deduplication rejects a lexically in-scope path that now resolves outside its app', async (t) => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const appDirectory = path.resolve(home, 'api', 'appB', 'models')
    const pending = await writeFile(path.resolve(appDirectory, 'model.bin'), content)
    await vault.sweeper.scan()
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    assert.ok(vault.registry.duplicates.has(pending))

    const relocated = path.resolve(home, 'relocated-models')
    await fs.promises.rename(appDirectory, relocated)
    try {
      await fs.promises.symlink(relocated, appDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }

    const result = await vault.deduplicateScope(appB.id, { batch_id: 'canonical-boundary' })
    assert.strictEqual(result.converted, 0)
    assert.strictEqual(result.stale, 1)
    assert.strictEqual((await fs.promises.stat(pending)).nlink, 1)
    assert.notStrictEqual((await fs.promises.stat(pending)).ino, (await fs.promises.stat(original)).ino)
    assert.ok(vault.registry.duplicates.has(pending))
  })

  test('known cloud-synced homes get a dismissible dashboard warning', async () => {
    const kernel = {
      homedir: path.resolve(path.sep, 'Users', 'person', 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'pinokio'),
      platform: process.platform,
      path: (...parts) => path.resolve(path.sep, ...parts)
    }
    const vault = new Vault(kernel)
    assert.strictEqual(vault.cloudSyncProvider(), 'iCloud Drive')
    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /cloud_sync_warning/)
    assert.match(vaultPage, /btn-dismiss-cloud/)
    assert.match(vaultPage, /localStorage\.setItem/)
  })

  test('deduplicate batches share a batch id and are undoable as one', async () => {
    const { home, vault } = await makeEnv()
    const c1 = crypto.randomBytes(4096)
    const c2 = crypto.randomBytes(4096)
    const a1 = await writeFile(path.resolve(home, 'api', 'appA', 'm1.bin'), c1)
    const a2 = await writeFile(path.resolve(home, 'api', 'appA', 'm2.bin'), c2)
    await vault.adopt(a1, sha256(c1), { app: 'appA' })
    await vault.adopt(a2, sha256(c2), { app: 'appA' })
    const b1 = await writeFile(path.resolve(home, 'api', 'appB', 'm1.bin'), c1)
    const b2 = await writeFile(path.resolve(home, 'api', 'appB', 'm2.bin'), c2)
    await vault.refreshSources()
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    vault.registry.duplicates.set(b1, await duplicateEntry(b1, { hash: sha256(c1), size: c1.length, app: 'appB', source_id: appB.id }))
    vault.registry.duplicates.set(b2, await duplicateEntry(b2, { hash: sha256(c2), size: c2.length, app: 'appB', source_id: appB.id }))

    const summary = await vault.deduplicateScope(appB.id, { batch_id: 'batch-x' })
    assert.strictEqual(summary.converted, 2)
    assert.strictEqual(summary.bytes_saved, c1.length + c2.length)

    const undo = await vault.undoBatch('batch-x')
    assert.strictEqual(undo.undone, 2)
    assert.strictEqual((await fs.promises.stat(b1)).nlink, 1)
    assert.strictEqual((await fs.promises.stat(b2)).nlink, 1)
  })

  test('source-scoped batches never include another non-app location', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const appCopy = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    const cacheCopy = await writeFile(path.resolve(home, 'cache', 'models', 'm.bin'), content)
    await vault.refreshSources()
    const appA = vault.sources().find((item) => item.kind === 'app' && item.app === 'appA')
    const appB = vault.sources().find((item) => item.kind === 'app' && item.app === 'appB')
    const cache = vault.sources().find((item) => item.kind === 'folder' && item.label === 'cache')
    await vault.adopt(original, hash, { app: 'appA', source_id: appA.id })
    vault.registry.duplicates.set(appCopy, await duplicateEntry(appCopy, { hash, size: content.length, app: 'appB', source_id: appB.id }))
    vault.registry.duplicates.set(cacheCopy, await duplicateEntry(cacheCopy, { hash, size: content.length, app: null, source_id: cache.id }))

    const result = await vault.deduplicateScope(appB.id, { batch_id: 'scope-app-b' })
    assert.strictEqual(result.converted, 1)
    assert.strictEqual((await fs.promises.stat(appCopy)).ino, (await fs.promises.stat(original)).ino)
    assert.strictEqual((await fs.promises.stat(cacheCopy)).nlink, 1)
    assert.ok(vault.registry.duplicates.has(cacheCopy), 'other non-app scope remains pending')
  })

  test('unavailable conversions remain pending for review', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const pending = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    await vault.refreshSources()
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    vault.registry.duplicates.set(pending, await duplicateEntry(pending, { hash, size: content.length, app: 'appB', source_id: appB.id }))
    const realConvert = vault.convert.bind(vault)
    vault.convert = async () => ({ status: 'unavailable' })
    const result = await vault.deduplicateScope(appB.id)
    vault.convert = realConvert
    assert.strictEqual(result.unavailable, 1)
    assert.ok(vault.registry.duplicates.has(pending))
    assert.strictEqual(vault.registry.links.has(pending), false)
  })

  test('deduplication rechecks a running app immediately before replacement', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const pending = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.refreshSources()
    const appA = vault.sources().find((source) => source.kind === 'app' && source.app === 'appA')
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    await vault.adopt(original, hash, { app: 'appA', source_id: appA.id })
    const pendingEntry = await duplicateEntry(pending, {
      hash, size: content.length, app: 'appB', source_id: appB.id
    })
    vault.registry.setDuplicate(pending, pendingEntry)
    vault.registry.scanIndex.set(pending, Object.assign({}, pendingEntry))
    const realVerify = vault.verifyStoreContent.bind(vault)
    vault.verifyStoreContent = async (...args) => {
      const result = await realVerify(...args)
      vault.kernel.api = {
        running: { started_during_validation: true },
        running_paths: { started_during_validation: path.resolve(home, 'api', 'appB', 'start.js') }
      }
      return result
    }
    let result
    try {
      result = await vault.deduplicateScope(appB.id)
    } finally {
      vault.verifyStoreContent = realVerify
    }

    assert.strictEqual(result.locked, 1)
    assert.strictEqual((await fs.promises.stat(pending)).nlink, 1)
    assert.strictEqual(vault.registry.duplicates.has(pending), true)
    assert.strictEqual(vault.registry.links.has(pending), false)
  })

  test('status separates app, Pinokio folder, and external source metadata', async (t) => {
    const { home, vault } = await makeEnv()
    const external = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-ui-external-'))
    homes.push(external)
    try {
      await fs.promises.symlink(external, path.resolve(home, 'api', 'linked-models'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }
    await fs.promises.mkdir(path.resolve(home, 'api', 'local-app'), { recursive: true })
    await fs.promises.mkdir(path.resolve(home, 'cache'), { recursive: true })
    await vault.refreshSources()
    const status = await vault.status()
    const byKind = new Map(status.sources.map((source) => [source.id, source]))
    assert.ok([...byKind.values()].some((source) => source.kind === 'app' && source.label === 'local-app' && source.parent_id === 'apps'))
    assert.ok([...byKind.values()].some((source) => source.kind === 'folder' && source.label === 'cache' && source.parent_id === 'pinokio'))
    assert.ok([...byKind.values()].some((source) => source.kind === 'external' && source.label === 'linked-models' && source.parent_id === 'external'))
  })
})
