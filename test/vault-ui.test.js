const { test, describe, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
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
  const files = ['views/vault.ejs', 'public/vault.css', 'public/vault.js']
  return (await Promise.all(files.map((file) => fs.promises.readFile(path.resolve(root, file), 'utf8')))).join('\n')
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
    const forbidden = /hard.?link|junction|symlink|inode|\bblob\b|\bstore\b|\bdedupe\b/i
    const vaultPage = await vaultPageSource()
    const copyBlock = vaultPage.match(/const COPY = \{[\s\S]*?\n\}/)
    assert.ok(copyBlock, 'vault.ejs must keep user copy in a COPY object')
    for (const m of copyBlock[0].matchAll(/:\s*"([^"]*)"/g)) {
      assert.ok(!forbidden.test(m[1]), `forbidden term in vault page copy: "${m[1]}"`)
    }
    const outsideCopy = vaultPage.replace(copyBlock[0], '')
    assert.doesNotMatch(outsideCopy, /Add external folder|Vault files|folder picker could not be opened|Vault status request failed|Search in \$\{/)
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
    assert.match(vaultPage, /already_shared:\s*"Already shared"/)
    assert.match(vaultPage, /on_disk_help:\s*"File managers may count shared files more than once\./)
    assert.match(vaultPage, /saved_by_vault:\s*"Saved by Vault"/)
    assert.match(vaultPage, /repair_index:\s*"Repair Vault index"/)
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
    assert.match(vaultPage, /\.vault-overview \{[\s\S]*?padding:\s*7px var\(--vault-inline\)/)
    assert.match(vaultPage, /\.vault-metric \{[\s\S]*?border:\s*0;[\s\S]*?border-left:\s*1px solid var\(--task-border\)/)
    assert.match(vaultPage, /button\.vault-metric \{[\s\S]*?font:\s*inherit/)
    assert.match(vaultPage, /id='btn-add-source'/)
    assert.match(vaultPage, /<script src="\/Socket\.js"><\/script>/)
    assert.match(vaultPage, /action:\s*"add_source"/)
    assert.match(vaultPage, /identical_contents_at:\s*"Identical contents at"/)
    assert.doesNotMatch(vaultPage, /Matching locations/)
    assert.match(vaultPage, /scan_waiting:\s*"Waiting for scan results"/)
    assert.match(vaultPage, /view === "all" && !scanning \? `<button class="vault-button" type="button" id="btn-empty-scan"/)
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
