const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const Vault = require('../kernel/vault')
const Registry = require('../kernel/vault/registry')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const makeHome = async () => {
  const home = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-vault-test-'))
  await fs.promises.mkdir(path.resolve(home, 'api'), { recursive: true })
  return home
}

const fakeKernel = (home) => ({
  homedir: home,
  platform: process.platform,
  path: (...args) => path.resolve(home, ...args)
})

const makeVault = async (home) => {
  const vault = new Vault(fakeKernel(home))
  await vault.init()
  return vault
}

const writeFile = async (p, content) => {
  await fs.promises.mkdir(path.dirname(p), { recursive: true })
  await fs.promises.writeFile(p, content)
  return p
}

describe('vault engine (phase 1)', () => {
  let homes = []
  const home = async () => {
    const h = await makeHome()
    homes.push(h)
    return h
  }
  after(async () => {
    for (const h of homes) {
      await fs.promises.rm(h, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('item 1: PINOKIO_VAULT=false creates nothing and disables all ops', async () => {
    const h = await home()
    await writeFile(path.resolve(h, 'ENVIRONMENT'), 'PINOKIO_VAULT=false\n')
    const vault = new Vault(fakeKernel(h))
    const result = await vault.init()
    assert.strictEqual(result.enabled, false)
    assert.strictEqual(fs.existsSync(path.resolve(h, 'vault')), false)
    const file = await writeFile(path.resolve(h, 'api', 'app', 'model.bin'), 'data')
    assert.strictEqual((await vault.adopt(file, sha256(Buffer.from('data')))).status, 'disabled')
    assert.strictEqual(fs.existsSync(path.resolve(h, 'vault')), false)
  })

  test('kill switch: process.env override wins', async () => {
    const h = await home()
    process.env.PINOKIO_VAULT = 'false'
    try {
      const vault = new Vault(fakeKernel(h))
      const result = await vault.init()
      assert.strictEqual(result.enabled, false)
    } finally {
      delete process.env.PINOKIO_VAULT
    }
  })

  test('kill switch blocks dashboard actions without creating mounts', async () => {
    const h = await home()
    const external = await home()
    await writeFile(path.resolve(h, 'ENVIRONMENT'), 'PINOKIO_VAULT=false\n')
    const vault = new Vault(fakeKernel(h))
    await vault.init()

    const result = await vault.perform('add_source', { path: external })

    assert.match(result.error, /disabled/i)
    assert.deepStrictEqual(await fs.promises.readdir(path.resolve(h, 'api')), [])
    assert.strictEqual(fs.existsSync(path.resolve(h, 'vault')), false)
  })

  test('deferred startup does not load or create Vault storage', async () => {
    const h = await home()
    const vault = new Vault(fakeKernel(h))

    assert.deepStrictEqual(await vault.init({ deferStorage: true }), { enabled: true })
    assert.strictEqual(vault.initialized, false)
    assert.strictEqual(vault.registry, null)
    assert.strictEqual(fs.existsSync(path.resolve(h, 'vault')), false)

    await vault.ensureInitialized()
    assert.strictEqual(vault.initialized, true)
    assert.ok(vault.registry)
  })

  test('explicit initialization restores the persisted index without verifying filesystem records', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'unused.bin'), content)
    await vault.adopt(file, hash, { app: 'appA' })
    await vault.registry.flush()
    await fs.promises.unlink(file)

    const fresh = new Vault(fakeKernel(h))
    await fresh.init()
    await fresh.ensureInitialized()

    assert.strictEqual(fs.existsSync(fresh.storePathFor(hash)), true)
    assert.strictEqual(fresh.registry.links.has(file), true)
    const kernelSource = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'kernel', 'index.js'),
      'utf8'
    )
    assert.match(kernelSource, /this\.vault\.init\(\{ deferStorage: true \}\)/)
    assert.doesNotMatch(kernelSource, /this\.vault\.init\(\{ existingOnly: true \}\)/)
    assert.doesNotMatch(kernelSource, /this\.vault\.verify\s*\(/)

    await fresh.rebuild()

    assert.strictEqual(fresh.registry.links.has(file), false)
    assert.strictEqual(fresh.registry.blobs.get(hash).orphan, true)
    assert.strictEqual((await fresh.status()).reclaimable, content.length)
  })

  test('repeated scans reuse one non-persisted presence marker per record', async () => {
    const h = await home()
    const registry = new Registry(path.resolve(h, 'vault'))
    const entry = { hash: 'a'.repeat(64) }

    for (let index = 0; index < 5; index += 1) {
      const token = registry.beginScanPresence()
      registry.markCurrentScan(entry)
      assert.strictEqual(registry.seenInScan(entry, token), true)
      registry.endScanPresence(token)
    }

    assert.strictEqual(Object.getOwnPropertySymbols(entry).length, 1)
    assert.strictEqual(JSON.stringify(entry), JSON.stringify({ hash: 'a'.repeat(64) }))
  })

  test('adopt: explicit store anchor shares the inode without copying bytes', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'models', 'm.safetensors'), content)
    const result = await vault.adopt(file, hash, { app: 'appA' })
    assert.strictEqual(result.status, 'adopted')
    const st = await fs.promises.stat(file)
    const storeStat = await fs.promises.stat(vault.storePathFor(hash))
    assert.strictEqual(st.ino, storeStat.ino)
    assert.strictEqual(st.nlink, 2)
    assert.ok(vault.registry.blobs.has(hash))
    assert.strictEqual(vault.registry.links.get(file).hash, hash)
  })

  test('adopt never assigns a stale hash when the source is replaced before linking', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const original = Buffer.alloc(4096, 1)
    const replacement = Buffer.alloc(4096, 2)
    const hash = sha256(original)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), original)
    const storePath = vault.storePathFor(hash)
    const realLink = fs.promises.link
    fs.promises.link = async (source, target) => {
      if (source === file && target === storePath) {
        const writerPath = file + '.writer-replacement'
        await fs.promises.writeFile(writerPath, replacement)
        await fs.promises.rename(writerPath, file)
      }
      return realLink(source, target)
    }
    let result
    try {
      result = await vault.adopt(file, hash, { app: 'appA' })
    } finally {
      fs.promises.link = realLink
    }

    assert.strictEqual(result.status, 'stale')
    assert.deepStrictEqual(await fs.promises.readFile(file), replacement)
    assert.strictEqual(fs.existsSync(storePath), false)
    assert.strictEqual(vault.registry.blobs.has(hash), false)
    assert.strictEqual(vault.registry.links.has(file), false)
  })

  test('item 5: convert links duplicate to blob, content intact, other copies untouched', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(8192)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const b = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(a, hash, { app: 'appA' })
    const result = await vault.convert(b, hash, { app: 'appB', batch_id: 'batch1' })
    assert.strictEqual(result.status, 'converted')
    const stA = await fs.promises.stat(a)
    const stB = await fs.promises.stat(b)
    assert.strictEqual(stA.ino, stB.ino)
    assert.strictEqual(stB.nlink, 3)
    assert.deepStrictEqual(await fs.promises.readFile(b), content)
    assert.strictEqual(vault.registry.totals.lifetime_bytes_saved, content.length)
    const events = await vault.registry.readEvents()
    assert.ok(events.some((e) => e.kind === 'convert' && e.batch_id === 'batch1'))
  })

  test('convert stays registered when metadata fails after the atomic replacement', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const duplicate = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const realRename = fs.promises.rename
    const realLstat = fs.promises.lstat
    let committed = false
    let failedRead = false
    fs.promises.rename = async (source, target) => {
      const result = await realRename(source, target)
      if (source === duplicate + Vault.TMP_SUFFIX && target === duplicate) committed = true
      return result
    }
    fs.promises.lstat = async (target, options) => {
      if (committed && !failedRead && path.resolve(String(target)) === duplicate) {
        failedRead = true
        const error = new Error('temporary post-rename metadata failure')
        error.code = 'EIO'
        throw error
      }
      return realLstat(target, options)
    }
    let result
    try {
      result = await vault.convert(duplicate, hash, { app: 'appB', batch_id: 'committed' })
    } finally {
      fs.promises.rename = realRename
      fs.promises.lstat = realLstat
    }

    assert.strictEqual(failedRead, true)
    assert.strictEqual(result.status, 'converted')
    const storeStat = await fs.promises.stat(vault.storePathFor(hash))
    const duplicateStat = await fs.promises.stat(duplicate)
    assert.strictEqual(duplicateStat.ino, storeStat.ino)
    assert.strictEqual(vault.registry.links.get(duplicate).batch_id, 'committed')
    assert.strictEqual(vault.registry.totals.lifetime_bytes_saved, content.length)
  })

  test('a failed activity append does not misreport a completed conversion', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const duplicate = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const realAppendFile = vault.registry.appendFile
    vault.registry.appendFile = async () => {
      const error = new Error('temporary activity write failure')
      error.code = 'EIO'
      throw error
    }
    let result
    try {
      result = await vault.convert(duplicate, hash, { app: 'appB', batch_id: 'activity-failed' })
    } finally {
      vault.registry.appendFile = realAppendFile
    }

    assert.strictEqual(result.status, 'converted')
    assert.ok(vault.registry.links.has(duplicate))
    assert.match(vault.registry.eventError, /temporary activity write failure/)
    assert.match((await vault.status()).activity_error, /temporary activity write failure/)
    await vault.registry.appendEvent({ kind: 'scan' })
    assert.strictEqual(vault.registry.eventError, null)
  })

  test('convert does not register a writer replacement that wins after the atomic rename', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const replacement = Buffer.from('newer-writer-content')
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const duplicate = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const realRename = fs.promises.rename
    fs.promises.rename = async (source, target) => {
      const result = await realRename(source, target)
      if (source === duplicate + Vault.TMP_SUFFIX && target === duplicate) {
        const writerPath = duplicate + '.writer-replacement'
        await fs.promises.writeFile(writerPath, replacement)
        await realRename(writerPath, duplicate)
      }
      return result
    }
    let result
    try {
      result = await vault.convert(duplicate, hash, { app: 'appB', batch_id: 'raced' })
    } finally {
      fs.promises.rename = realRename
    }

    assert.strictEqual(result.status, 'stale')
    assert.deepStrictEqual(await fs.promises.readFile(duplicate), replacement)
    assert.strictEqual(vault.registry.links.has(duplicate), false)
    assert.strictEqual(vault.registry.totals.lifetime_bytes_saved, 0)
  })

  test('convert refuses a final store metadata change', {
    skip: process.platform === 'win32'
  }, async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const duplicate = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const storePath = vault.storePathFor(hash)
    const originalMode = (await fs.promises.stat(storePath)).mode & 0o7777
    const changedMode = originalMode === 0o600 ? 0o640 : 0o600
    const realLstat = fs.promises.lstat
    let targetReads = 0
    fs.promises.lstat = async (target, options) => {
      if (path.resolve(String(target)) === duplicate) {
        targetReads += 1
        if (targetReads === 2) await fs.promises.chmod(storePath, changedMode)
      }
      return realLstat(target, options)
    }
    let result
    try {
      result = await vault.convert(duplicate, hash, { app: 'appB' })
    } finally {
      fs.promises.lstat = realLstat
    }
    assert.strictEqual(result.status, 'stale-blob')
    assert.strictEqual((await fs.promises.stat(duplicate)).nlink, 1)
    assert.deepStrictEqual(await fs.promises.readFile(duplicate), content)
    assert.strictEqual(fs.existsSync(duplicate + Vault.TMP_SUFFIX), false)
  })

  test('item 5: conversion resumes its own temporary link after a simulated crash', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const duplicate = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.refreshSources()
    await vault.adopt(a, hash, { app: 'appA' })
    const duplicateStat = await fs.promises.stat(duplicate)
    const source = vault.sources().find((item) => item.kind === 'app' && item.app === 'appB')
    vault.registry.setDuplicate(duplicate, {
      hash, size: content.length, app: 'appB', source_id: source.id,
      dev: duplicateStat.dev, ino: duplicateStat.ino,
      mtime: duplicateStat.mtimeMs, ctime: duplicateStat.ctimeMs
    })
    // This is the actual crash state: the target is still pending and the
    // temporary name already shares the stored file's identity.
    await fs.promises.link(vault.storePathFor(hash), duplicate + Vault.TMP_SUFFIX)
    assert.deepStrictEqual(await fs.promises.readFile(duplicate), content)
    assert.strictEqual((await vault.convert(duplicate, hash, {
      app: 'appB',
      source_id: source.id
    })).status, 'converted')
    assert.strictEqual(fs.existsSync(duplicate + Vault.TMP_SUFFIX), false)
    assert.deepStrictEqual(await fs.promises.readFile(duplicate), content)
    assert.ok(vault.registry.links.has(duplicate))
  })

  test('conversion never deletes an unrelated reserved-suffix file', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const duplicate = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const tmp = duplicate + Vault.TMP_SUFFIX
    await writeFile(tmp, 'user data')

    assert.strictEqual((await vault.convert(duplicate, hash)).status, 'conflict')
    assert.strictEqual(await fs.promises.readFile(tmp, 'utf8'), 'user data')
  })

  test('reclaim: refuses while in use, frees orphans', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(a, hash)
    assert.strictEqual((await vault.reclaim(hash)).status, 'in-use')
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    const pendingStat = await fs.promises.stat(pending)
    vault.registry.setDuplicate(pending, {
      hash, size: pendingStat.size, dev: pendingStat.dev, ino: pendingStat.ino,
      mtime: pendingStat.mtimeMs, ctime: pendingStat.ctimeMs
    })
    vault.registry.scanIndex.set(pending, {
      hash, size: pendingStat.size, dev: pendingStat.dev, ino: pendingStat.ino,
      mtime: pendingStat.mtimeMs, ctime: pendingStat.ctimeMs
    })
    await fs.promises.unlink(a)
    const result = await vault.reclaim(hash)
    assert.strictEqual(result.status, 'reclaimed')
    assert.strictEqual(result.bytes_freed, content.length)
    assert.strictEqual(fs.existsSync(vault.storePathFor(hash)), false)
    assert.strictEqual(vault.registry.blobs.has(hash), false)
    assert.strictEqual(vault.registry.duplicates.has(pending), false,
      'pending rows cannot reference a Vault copy that was reclaimed')
    assert.strictEqual(vault.registry.scanIndex.has(pending), false)
  })

  test('vault content identifiers cannot escape the managed file tree', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const sentinel = await writeFile(path.resolve(h, 'do-not-remove.txt'), 'safe')

    await assert.rejects(vault.reclaim('../../do-not-remove.txt'), /Invalid vault content identifier/)
    assert.strictEqual(await fs.promises.readFile(sentinel, 'utf8'), 'safe')
  })

  test('vault storage symlinks never redirect initialization or reclaim', {
    skip: process.platform === 'win32'
  }, async () => {
    const h = await home()
    const outside = await home()
    const redirectedRoot = path.resolve(outside, 'redirected-vault')
    await fs.promises.mkdir(redirectedRoot)
    await fs.promises.symlink(redirectedRoot, path.resolve(h, 'vault'))

    const redirected = new Vault(fakeKernel(h))
    await assert.rejects(redirected.init(), (error) => error && error.code === 'EVAULTPATH')
    assert.deepStrictEqual(await fs.promises.readdir(redirectedRoot), [])

    await fs.promises.unlink(path.resolve(h, 'vault'))
    const vault = await makeVault(h)
    const content = Buffer.from('preserve external bytes')
    const hash = sha256(content)
    const outsideShard = path.resolve(outside, 'outside-shard')
    const outsideBlob = await writeFile(path.resolve(outsideShard, hash), content)
    await fs.promises.symlink(outsideShard, path.resolve(vault.blobRoot, hash.slice(0, 2)))
    vault.registry.addBlob(hash, { size: content.length })

    await assert.rejects(vault.reclaim(hash), (error) => error && error.code === 'EVAULTPATH')
    assert.deepStrictEqual(await fs.promises.readFile(outsideBlob), content)
  })

  test('deduplication refuses a file changed after discovery, even at the same size', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const originalContent = Buffer.from('first version')
    const changedContent = Buffer.from('other version')
    assert.strictEqual(originalContent.length, changedContent.length)
    await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), originalContent)
    await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), originalContent)
    await vault.sweeper.scan()

    const [pendingPath] = vault.registry.duplicates.keys()
    assert.ok(pendingPath, 'scan found a pending duplicate')
    await fs.promises.writeFile(pendingPath, changedContent)
    const future = new Date(Date.now() + 2000)
    await fs.promises.utimes(pendingPath, future, future)

    const result = await vault.perform('deduplicate', {
      scope_id: vault.registry.duplicates.get(pendingPath).source_id
    })
    assert.strictEqual(result.stale, 1)
    assert.strictEqual(result.converted, 0)
    assert.ok(vault.registry.duplicates.has(pendingPath), 'changed file remains pending for a fresh scan')
    assert.deepStrictEqual(await fs.promises.readFile(pendingPath), changedContent)
  })

  test('deduplication rehashes a ctime-only snapshot mismatch before converting', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const content = crypto.randomBytes(4096)
    await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), content)
    await vault.sweeper.scan()

    const [pendingPath, pendingEntry] = [...vault.registry.duplicates][0]
    const indexed = vault.registry.scanIndex.get(pendingPath)
    vault.registry.scanIndex.set(pendingPath, Object.assign({}, indexed, {
      ctime: indexed.ctime - 1
    }))
    const realHashFile = vault.hashFile.bind(vault)
    let targetRehashes = 0
    vault.hashFile = async (filePath) => {
      if (path.resolve(filePath) === pendingPath) targetRehashes += 1
      return realHashFile(filePath)
    }

    let result
    try {
      result = await vault.perform('deduplicate', { scope_id: pendingEntry.source_id })
    } finally {
      vault.hashFile = realHashFile
    }

    assert.strictEqual(targetRehashes, 1)
    assert.strictEqual(result.converted, 1)
    assert.strictEqual(result.stale, 0)
    assert.strictEqual(vault.registry.duplicates.has(pendingPath), false)
    assert.deepStrictEqual(await fs.promises.readFile(pendingPath), content)
  })

  test('ctime recovery never converts different bytes with matching identity, size, and mtime', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const originalContent = Buffer.from('AAAA')
    const changedContent = Buffer.from('BBBB')
    await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), originalContent)
    await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), originalContent)
    await vault.sweeper.scan()

    const [pendingPath, pendingEntry] = [...vault.registry.duplicates][0]
    const indexed = vault.registry.scanIndex.get(pendingPath)
    await fs.promises.writeFile(pendingPath, changedContent)
    const current = await fs.promises.lstat(pendingPath)
    vault.registry.scanIndex.set(pendingPath, Object.assign({}, indexed, {
      dev: current.dev,
      ino: current.ino,
      size: current.size,
      mtime: current.mtimeMs,
      ctime: current.ctimeMs - 1
    }))

    const result = await vault.perform('deduplicate', { scope_id: pendingEntry.source_id })

    assert.strictEqual(result.converted, 0)
    assert.strictEqual(result.stale, 1)
    assert.strictEqual((await fs.promises.stat(pendingPath)).nlink, 1)
    assert.ok(vault.registry.duplicates.has(pendingPath))
    assert.deepStrictEqual(await fs.promises.readFile(pendingPath), changedContent)
  })

  test('ctime recovery never overwrites a file replaced during its verification hash', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const content = crypto.randomBytes(4096)
    const replacement = crypto.randomBytes(4096)
    await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), content)
    await vault.sweeper.scan()

    const [pendingPath, pendingEntry] = [...vault.registry.duplicates][0]
    const indexed = vault.registry.scanIndex.get(pendingPath)
    vault.registry.scanIndex.set(pendingPath, Object.assign({}, indexed, {
      ctime: indexed.ctime - 1
    }))
    const realHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath) => {
      const result = await realHashFile(filePath)
      if (path.resolve(filePath) === pendingPath) {
        const writerPath = `${pendingPath}.writer-replacement`
        await fs.promises.writeFile(writerPath, replacement)
        await fs.promises.rename(writerPath, pendingPath)
      }
      return result
    }

    let result
    try {
      result = await vault.perform('deduplicate', { scope_id: pendingEntry.source_id })
    } finally {
      vault.hashFile = realHashFile
    }

    assert.strictEqual(result.converted, 0)
    assert.strictEqual(result.stale, 1)
    assert.strictEqual((await fs.promises.stat(pendingPath)).nlink, 1)
    assert.ok(vault.registry.duplicates.has(pendingPath))
    assert.deepStrictEqual(await fs.promises.readFile(pendingPath), replacement)
  })

  test('deduplication revalidates canonical content before replacing a pending file', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const originalContent = Buffer.from('AAAA')
    const changedContent = Buffer.from('BBBB')
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), originalContent)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), originalContent)
    await vault.sweeper.scan()
    await fs.promises.writeFile(original, changedContent)

    const pendingEntry = vault.registry.duplicates.get(pending)
    const result = await vault.perform('deduplicate', { scope_id: pendingEntry.source_id })

    assert.strictEqual(result.converted, 0)
    assert.strictEqual(result.stale, 1)
    assert.deepStrictEqual(await fs.promises.readFile(pending), originalContent)
    assert.ok(vault.registry.duplicates.has(pending))
  })

  test('deduplication preserves executable and ownership metadata semantics', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const content = crypto.randomBytes(4096)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), content)
    if (process.platform !== 'win32') {
      await fs.promises.chmod(original, 0o755)
      await fs.promises.chmod(pending, 0o600)
    }
    await vault.sweeper.scan()
    const before = await fs.promises.stat(pending)
    const pendingEntry = vault.registry.duplicates.get(pending)
    const result = await vault.perform('deduplicate', { scope_id: pendingEntry.source_id })
    const after = await fs.promises.stat(pending)

    if (process.platform === 'win32') assert.ok(result.converted >= 0)
    else {
      assert.strictEqual(result.converted, 0)
      assert.strictEqual(result.incompatible, 1)
      assert.strictEqual(after.mode & 0o7777, before.mode & 0o7777)
      assert.strictEqual(after.ino, before.ino)
      assert.ok(vault.registry.duplicates.has(pending))
    }
  })

  test('deduplication requires a trustworthy scan snapshot', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), content)
    await vault.refreshSources()
    const appA = vault.sources().find((source) => source.kind === 'app' && source.app === 'appA')
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    await vault.adopt(original, hash, { app: 'appA', source_id: appA.id })
    const pendingStat = await fs.promises.stat(pending)
    vault.registry.duplicates.set(pending, {
      hash, size: content.length, app: 'appB', source_id: appB.id,
      dev: pendingStat.dev, ino: pendingStat.ino, mtime: pendingStat.mtimeMs
    })

    const result = await vault.perform('deduplicate', { scope_id: appB.id })

    assert.strictEqual(result.stale, 1)
    assert.strictEqual(result.converted, 0)
    assert.strictEqual((await fs.promises.stat(pending)).nlink, 1)
    assert.ok(vault.registry.duplicates.has(pending))
  })

  test('missing registry requires explicit Repair Index before rebuilding from disk', async () => {
    const h = await home()
    const vault = await makeVault(h)
    // Rebuild's ino-match walk only considers files >= SIZE_THRESHOLD, so
    // lower the threshold surrogate by using large-enough sparse-ish files.
    const big = Buffer.alloc(Vault.SIZE_THRESHOLD, 7)
    const hash = sha256(big)
    const a = await writeFile(path.resolve(h, 'api', 'appA', 'big.bin'), big)
    await vault.adopt(a, hash, { app: 'appA' })
    const orphanContent = Buffer.alloc(Vault.SIZE_THRESHOLD, 9)
    const orphanHash = sha256(orphanContent)
    const b = await writeFile(path.resolve(h, 'api', 'appB', 'big2.bin'), orphanContent)
    await vault.adopt(b, orphanHash, { app: 'appB' })
    await fs.promises.unlink(b)

    await fs.promises.unlink(path.resolve(vault.root, 'registry.json')).catch(() => {})
    await fs.promises.unlink(path.resolve(vault.root, 'events.ndjson')).catch(() => {})
    const fresh = new Vault(fakeKernel(h))
    await fresh.init()
    assert.strictEqual(fresh.repairStatus().required, true)
    assert.strictEqual((await fresh.status()).repair.required, true)
    assert.strictEqual(fresh.registry.blobs.size, 0)
    assert.match(fresh.startScan().error, /Repair Index/)
    assert.match((await fresh.perform('scan')).error, /Repair Index/)

    const started = await fresh.perform('repair')
    const repairPromise = fresh.repairPromise
    assert.strictEqual(started.started, true)
    await repairPromise

    assert.strictEqual(fresh.repairStatus().required, false)
    assert.strictEqual((await fresh.status()).repair.required, false)
    assert.ok(fresh.registry.blobs.has(hash))
    assert.ok(fresh.registry.blobs.has(orphanHash))
    assert.strictEqual(fresh.registry.blobs.get(orphanHash).orphan, true)
    assert.strictEqual(fresh.registry.blobs.get(hash).orphan, false)
    assert.strictEqual(fresh.registry.links.get(a).hash, hash)
    assert.strictEqual(fresh.registry.links.get(a).app, 'appA')
    assert.strictEqual(
      fresh.registry.links.has(fresh.storePathFor(hash)),
      false,
      'the internal vault name is never exposed as a tracked location'
    )
  })

  test('corrupt registry waits for explicit Repair Index instead of rebuilding at startup', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(a, hash)
    await vault.registry.flush()
    // Torn final line
    await fs.promises.appendFile(path.resolve(vault.root, 'events.ndjson'), '{"kind":"conv')
    const events = await vault.registry.readEvents()
    assert.ok(events.every((e) => typeof e === 'object'))
    // Corrupt snapshot
    await fs.promises.writeFile(path.resolve(vault.root, 'registry.json'), '{corrupted!!')
    const fresh = new Vault(fakeKernel(h))
    const result = await fresh.init()
    assert.strictEqual(result.enabled, true)
    assert.strictEqual(fresh.repairStatus().required, true)
    assert.strictEqual(fresh.registry.blobs.size, 0)

    await fresh.perform('repair')
    await fresh.repairPromise

    assert.strictEqual(fresh.repairStatus().required, false)
    assert.ok(fresh.registry.blobs.has(hash))
  })

  test('parseable non-object registry and event records are treated as corrupt cache data', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(file, hash)
    await vault.registry.flush()
    await fs.promises.writeFile(vault.registry.snapshotPath, 'null')
    await fs.promises.writeFile(vault.registry.eventsPath, 'null\n{"kind":"found"}\n')

    const fresh = new Vault(fakeKernel(h))
    const result = await fresh.init()
    const events = await fresh.registry.readEvents()

    assert.strictEqual(result.enabled, true)
    assert.strictEqual(fresh.repairStatus().required, true)
    assert.strictEqual(fresh.registry.blobs.has(hash), false)
    assert.deepStrictEqual(events.map((event) => event.kind), ['found'])
  })

  test('transient registry read errors never become an empty replacement registry', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), crypto.randomBytes(4096))
    await vault.adopt(file, sha256(await fs.promises.readFile(file)), { app: 'appA' })
    vault.registry.excluded.set(path.resolve(h, 'keep-independent.bin'), { ts: Date.now(), size: 123 })
    await vault.registry.flush()
    const registryPath = path.resolve(vault.root, 'registry.json')
    const before = await fs.promises.readFile(registryPath, 'utf8')
    const realReadFile = Registry.prototype.readFile
    let fresh
    Registry.prototype.readFile = async function (target, ...args) {
      if (path.resolve(String(target)) === registryPath) {
        const error = new Error('temporary read failure')
        error.code = 'EIO'
        throw error
      }
      return realReadFile.call(this, target, ...args)
    }
    try {
      fresh = new Vault(fakeKernel(h))
      await assert.rejects(fresh.init(), (error) => error && error.code === 'EIO')
    } finally {
      Registry.prototype.readFile = realReadFile
    }
    assert.strictEqual(await fs.promises.readFile(registryPath, 'utf8'), before)
    await fresh.ensureInitialized()
    assert.strictEqual(fresh.registry.excluded.has(path.resolve(h, 'keep-independent.bin')), true)
  })

  test('transient event-log read errors do not cache or compact an empty history', async () => {
    const h = await home()
    const vault = await makeVault(h)
    await vault.registry.appendEvent({ kind: 'found', marker: 'preserve-me' })
    vault.registry.eventsCache = null
    const realReadEventTail = vault.registry.readEventTail
    vault.registry.readEventTail = async () => {
      const error = new Error('temporary read failure')
      error.code = 'EIO'
      throw error
    }
    try {
      await assert.rejects(vault.registry.readEvents(), (error) => error && error.code === 'EIO')
    } finally {
      vault.registry.readEventTail = realReadEventTail
    }
    const events = await vault.registry.readEvents()
    assert.strictEqual(events.some((event) => event.marker === 'preserve-me'), true)
  })

  test('registry snapshot flushes serialize without racing the shared temp file', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(file, sha256(content), { app: 'appA' })

    await Promise.all([vault.registry.flush(), vault.registry.flush(), vault.registry.flush()])
    const snapshot = JSON.parse(await fs.promises.readFile(path.resolve(vault.root, 'registry.json'), 'utf8'))
    assert.ok(snapshot.blobs[sha256(content)])
    assert.strictEqual(fs.existsSync(path.resolve(vault.root, 'registry.json.tmp')), false)
  })

  test('large registry snapshots persist and reload through bounded JSON shards', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(file, hash, { app: 'appA' })
    vault.registry.snapshotShardThreshold = 1
    vault.registry.snapshotShardEntries = 1

    await vault.registry.flush()

    const manifest = JSON.parse(
      await fs.promises.readFile(vault.registry.snapshotPath, 'utf8'))
    assert.strictEqual(manifest.version, 2)
    assert.match(manifest.generation, /^registry-[0-9a-f]{24}$/)
    assert.ok(manifest.shards.blobs > 0)
    assert.ok(manifest.shards.links > 0)
    const reloaded = new Registry(vault.root)
    const loaded = await reloaded.load()
    assert.deepStrictEqual(loaded, { corrupt: false, existed: true })
    assert.strictEqual(reloaded.blobs.get(hash).size, content.length)
    assert.strictEqual(reloaded.links.get(file).hash, hash)
  })

  test('an incomplete sharded snapshot never replaces the last committed registry', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const firstHash = 'a'.repeat(64)
    const secondHash = 'b'.repeat(64)
    vault.registry.addBlob(firstHash, { size: 1 })
    await vault.registry.flush()
    vault.registry.addBlob(secondHash, { size: 2 })
    vault.registry.snapshotShardThreshold = 1
    const realAtomicWrite = vault.registry.atomicWrite.bind(vault.registry)
    vault.registry.atomicWrite = async (target, contents) => {
      if (path.resolve(target) === vault.registry.snapshotPath) {
        const error = new Error('manifest write failed')
        error.code = 'EIO'
        throw error
      }
      return realAtomicWrite(target, contents)
    }

    await assert.rejects(vault.registry.flush(), (error) => error && error.code === 'EIO')

    const reloaded = new Registry(vault.root)
    const loaded = await reloaded.load()
    assert.deepStrictEqual(loaded, { corrupt: false, existed: true })
    assert.strictEqual(reloaded.blobs.has(firstHash), true)
    assert.strictEqual(reloaded.blobs.has(secondHash), false)
    assert.deepStrictEqual(
      (await fs.promises.readdir(vault.root)).filter((name) => /^registry-[0-9a-f]{24}$/.test(name)),
      []
    )
  })

  test('a failed registry flush stays dirty and retries the in-memory state', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const hash = 'd'.repeat(64)
    const newerHash = 'e'.repeat(64)
    const realAtomicWrite = vault.registry.atomicWrite.bind(vault.registry)
    let writes = 0
    vault.registry.persistDelay = 5
    vault.registry.atomicWrite = async (...args) => {
      writes += 1
      if (writes === 1) {
        const error = new Error('temporary write failure')
        error.code = 'EIO'
        throw error
      }
      return realAtomicWrite(...args)
    }

    try {
      vault.registry.addBlob(hash, { size: 123 })
      await assert.rejects(vault.registry.flush(), (error) => error && error.code === 'EIO')
      assert.strictEqual(vault.registry.persistDirty, true)
      assert.ok(vault.registry.persistTimer, 'failed write scheduled a retry')
      vault.registry.addBlob(newerHash, { size: 456 })

      const deadline = Date.now() + 1000
      while ((writes < 2 || !fs.existsSync(vault.registry.snapshotPath)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.ok(writes >= 2, 'registry write was retried')
      assert.strictEqual(vault.registry.persistDirty, false)
      const snapshot = JSON.parse(await fs.promises.readFile(vault.registry.snapshotPath, 'utf8'))
      assert.strictEqual(snapshot.blobs[hash].size, 123)
      assert.strictEqual(snapshot.blobs[newerHash].size, 456)
    } finally {
      vault.registry.atomicWrite = realAtomicWrite
    }
  })

  test('registry writes preserve a temporary path replaced before rename', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.registry.addBlob('b'.repeat(64), { size: 1 })
    await vault.registry.flush()
    const before = await fs.promises.readFile(vault.registry.snapshotPath, 'utf8')
    const realLstat = fs.promises.lstat
    let tempPath = null
    let tempReads = 0
    fs.promises.lstat = async (target, options) => {
      const resolved = path.resolve(String(target))
      if (path.dirname(resolved) === vault.root && path.basename(resolved).startsWith('.registry.json.')) {
        tempPath = resolved
        tempReads += 1
        if (tempReads === 2) {
          await fs.promises.rename(resolved, `${resolved}.saved`)
          await fs.promises.writeFile(resolved, 'unrelated')
        }
      }
      return realLstat(target, options)
    }
    try {
      await assert.rejects(
        vault.registry.atomicWrite(vault.registry.snapshotPath, '{"replacement":true}\n'),
        (error) => error && error.code === 'EVAULTPATH'
      )
    } finally {
      fs.promises.lstat = realLstat
    }

    assert.strictEqual(await fs.promises.readFile(vault.registry.snapshotPath, 'utf8'), before)
    assert.strictEqual(await fs.promises.readFile(tempPath, 'utf8'), 'unrelated')
  })

  test('registry files cannot redirect writes through symlinks', {
    skip: process.platform === 'win32'
  }, async () => {
    const h = await home()
    const vault = await makeVault(h)
    const externalEvent = await writeFile(path.resolve(h, 'external-event.txt'), 'event sentinel')
    const externalSnapshot = await writeFile(path.resolve(h, 'external-snapshot.txt'), 'snapshot sentinel')
    await fs.promises.symlink(externalEvent, vault.registry.eventsPath)
    await fs.promises.symlink(externalSnapshot, vault.registry.snapshotPath)

    await assert.rejects(
      vault.registry.appendEvent({ kind: 'found' }),
      (error) => error && error.code === 'EVAULTPATH'
    )
    assert.match(vault.registry.eventError, /not safe/i)
    vault.registry.addBlob('a'.repeat(64), { size: 1 })
    await vault.registry.flush()

    assert.strictEqual(await fs.promises.readFile(externalEvent, 'utf8'), 'event sentinel')
    assert.strictEqual(await fs.promises.readFile(externalSnapshot, 'utf8'), 'snapshot sentinel')
    assert.strictEqual((await fs.promises.lstat(vault.registry.snapshotPath)).isFile(), true)
  })

  test('loading an exclusion removes its stale derived scan classification', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), crypto.randomBytes(4096))
    const st = await fs.promises.stat(file)
    vault.registry.scanIndex.set(file, {
      hash: sha256(await fs.promises.readFile(file)), size: st.size,
      dev: st.dev, ino: st.ino, mtime: st.mtimeMs, ctime: st.ctimeMs
    })
    vault.registry.excluded.set(file, { ts: Date.now(), size: st.size })
    await vault.registry.flush()

    const reloaded = await makeVault(h)
    assert.ok(reloaded.registry.excluded.has(file))
    assert.strictEqual(reloaded.registry.scanIndex.has(file), false)
  })

  test('event appends use one ordered writer', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const realAppendFile = vault.registry.appendFile
    let active = 0
    let maxActive = 0
    vault.registry.appendFile = async (...args) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      try {
        return await realAppendFile.call(vault.registry, ...args)
      } finally {
        active -= 1
      }
    }
    try {
      await Promise.all(Array.from({ length: 12 }, (_, index) => vault.registry.appendEvent({ kind: 'found', index })))
    } finally {
      vault.registry.appendFile = realAppendFile
    }
    assert.strictEqual(maxActive, 1)
    assert.deepStrictEqual((await vault.registry.readEvents()).map((event) => event.index), [...Array(12).keys()])
  })

  test('activity history compacts to a bounded recent window', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.registry.maxEvents = 5
    vault.registry.compactEvery = 2

    for (let index = 0; index < 9; index++) {
      await vault.registry.appendEvent({ kind: 'found', index })
    }

    let readWrites = 0
    const realAtomicWrite = vault.registry.atomicWrite
    vault.registry.atomicWrite = async (...args) => {
      readWrites += 1
      return realAtomicWrite.call(vault.registry, ...args)
    }
    const events = await vault.registry.readEvents()
    vault.registry.atomicWrite = realAtomicWrite
    assert.deepStrictEqual(events.map((event) => event.index), [4, 5, 6, 7, 8])
    assert.strictEqual(readWrites, 0)
    const persisted = (await fs.promises.readFile(vault.registry.eventsPath, 'utf8')).trim().split('\n')
    assert.ok(persisted.length >= vault.registry.maxEvents)
    assert.ok(persisted.length <= vault.registry.maxEvents + vault.registry.compactEvery)
  })

  test('activity reads only a bounded tail of an oversized history', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.registry.maxEvents = 2
    vault.registry.maxEventBytesPerEntry = 32
    const oversized = JSON.stringify({ kind: 'old', payload: 'x'.repeat(80 * 1024) })
    await fs.promises.writeFile(vault.registry.eventsPath,
      `${oversized}\n${JSON.stringify({ kind: 'found', index: 1 })}\n${JSON.stringify({ kind: 'found', index: 2 })}\n`)
    vault.registry.eventsCache = null

    const events = await vault.registry.readEvents()

    assert.deepStrictEqual(events.map((event) => event.index), [1, 2])
  })

  test('capability probing preserves a colliding path it did not create', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.volumeModes.clear()
    const realLink = fs.promises.link
    let collision = null
    fs.promises.link = async (source, target) => {
      collision = target
      await fs.promises.writeFile(target, 'unrelated', { flag: 'wx' })
      const error = new Error('occupied')
      error.code = 'EEXIST'
      throw error
    }
    try {
      await assert.rejects(vault.probe(h), (error) => error && error.code === 'EEXIST')
    } finally {
      fs.promises.link = realLink
    }

    assert.strictEqual(await fs.promises.readFile(collision, 'utf8'), 'unrelated')
    assert.strictEqual(vault.volumeModes.size, 0)
    assert.strictEqual(await vault.probe(h), 'link')
  })

  test('a transient capability probe failure is retryable and never cached as copy mode', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.volumeModes.clear()
    const realLink = fs.promises.link
    fs.promises.link = async () => {
      const error = new Error('temporary I/O failure')
      error.code = 'EIO'
      throw error
    }
    try {
      await assert.rejects(vault.probe(h), (error) => error && error.code === 'EIO')
    } finally {
      fs.promises.link = realLink
    }

    assert.strictEqual(vault.volumeModes.size, 0)
    assert.strictEqual(await vault.probe(h), 'link')
  })

  test('dashboard mutations are serialized in request order', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const order = []
    const first = vault.runExclusive(async () => {
      order.push('first:start')
      await new Promise((resolve) => setTimeout(resolve, 15))
      order.push('first:end')
    })
    const second = vault.runExclusive(async () => {
      order.push('second:start')
      order.push('second:end')
    })
    await Promise.all([first, second])
    assert.deepStrictEqual(order, ['first:start', 'first:end', 'second:start', 'second:end'])
  })

  test('each deduplicate request receives a collision-proof undo batch id', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const batches = []
    vault.deduplicateScope = async (scopeId, options) => {
      batches.push(options.batch_id)
      return { converted: 0 }
    }

    await Promise.all([
      vault.perform('deduplicate', { scope_id: 'app:a' }),
      vault.perform('deduplicate', { scope_id: 'app:a' })
    ])

    assert.strictEqual(new Set(batches).size, 2)
    assert.ok(batches.every((batch) => /^batch-[0-9a-f-]{36}$/.test(batch)))
  })

  test('deduplication reports transient file progress and clears it when complete', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const source = {
      id: 'app:appA',
      kind: 'app',
      app: 'appA',
      root: path.resolve(h, 'api', 'appA'),
      shareable: true
    }
    vault.refreshSources = async () => {}
    vault._sources = [source]
    vault.sourceForPath = () => source
    vault.sourceAppIsRunning = () => false
    vault.canonicalPathIsWithinSource = async () => true
    vault.ensureStoreForHash = async () => ({ status: 'ready' })
    vault.registry.duplicates = new Map([
      ['/models/one.bin', { hash: 'a'.repeat(64), dev: 1, ino: 1, mtime: 1, ctime: 1 }],
      ['/models/two.bin', { hash: 'b'.repeat(64), dev: 1, ino: 2, mtime: 1, ctime: 1 }]
    ])

    let calls = 0
    let releaseSecond
    let reportSecond
    const secondStarted = new Promise((resolve) => { reportSecond = resolve })
    const secondGate = new Promise((resolve) => { releaseSecond = resolve })
    vault.convert = async () => {
      calls += 1
      if (calls === 2) {
        reportSecond()
        await secondGate
      }
      return { status: 'converted', bytes_saved: 1 }
    }

    const pending = vault.perform('deduplicate', { scope_id: source.id })
    await secondStarted
    const active = vault.progressStatus().file_action
    const dashboard = await vault.status()
    releaseSecond()
    const result = await pending

    assert.deepStrictEqual(active, {
      kind: 'deduplicate',
      scope_id: source.id,
      selection: 'duplicates',
      files_total: 2,
      files_completed: 1
    })
    assert.deepStrictEqual(dashboard.file_action, active)
    assert.strictEqual(result.converted, 2)
    assert.strictEqual(vault.progressStatus().file_action, null)
  })

  test('Repair Index runs in the background, reports progress, and can be cancelled', async () => {
    const h = await home()
    const vault = await makeVault(h)
    let entered
    let release
    const repairEntered = new Promise((resolve) => { entered = resolve })
    const repairRelease = new Promise((resolve) => { release = resolve })
    vault.rebuild = async (_roots, options) => {
      await vault.repairCheckpoint(options.progress, {
        phase: 'filesystem',
        directories_checked: 3,
        files_checked: 12,
        records_checked: 4,
        current_location: path.resolve(h, 'api', 'appA')
      })
      entered()
      await repairRelease
      await vault.repairCheckpoint(options.progress)
    }

    const started = await vault.perform('repair')
    const repairPromise = vault.repairPromise
    await repairEntered

    assert.strictEqual(started.started, true)
    const active = vault.progressStatus()
    assert.strictEqual(active.file_action, null)
    assert.strictEqual(active.repair.phase, 'filesystem')
    assert.strictEqual(active.repair.directories_checked, 3)
    assert.strictEqual(active.repair.files_checked, 12)
    assert.strictEqual(active.repair.records_checked, 4)
    assert.match(vault.startScan().error, /repair/i)

    const cancelled = await vault.perform('cancel_repair')
    assert.strictEqual(cancelled.cancel_requested, true)
    release()
    await repairPromise

    assert.strictEqual(vault.progressStatus().file_action, null)
    assert.strictEqual(vault.repairStatus().phase, 'cancelled')
    assert.strictEqual(vault.repairStatus().active, false)
  })

  test('manual repair preserves verified copy-mode content groups', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    await vault.refreshSources()
    const source = vault.sources().find((item) => item.kind === 'app' && item.app === 'appA')
    vault.sizeThreshold = 1
    vault.mode = 'copy'
    assert.strictEqual((await vault.adopt(file, hash, {
      app: 'appA', source_id: source.id
    })).status, 'copy-mode')
    vault.registry.lastScan = { ts: 123, files: 1 }

    await vault.rebuild()

    assert.ok(vault.registry.blobs.has(hash))
    assert.strictEqual(vault.registry.links.get(file).mode, 'copy')
    assert.strictEqual(vault.registry.scanIndex.get(file).hash, hash)
    assert.deepStrictEqual(vault.registry.lastScan, { ts: 123, files: 1 })
    assert.deepStrictEqual(await fs.promises.readFile(file), content)
  })

  test('Repair Index rebuilds globally with reduced filesystem concurrency', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const firstContent = crypto.randomBytes(4096)
    const secondContent = crypto.randomBytes(4096)
    const firstHash = sha256(firstContent)
    const secondHash = sha256(secondContent)
    const first = await writeFile(path.resolve(h, 'api', 'appA', 'first.bin'), firstContent)
    const second = await writeFile(path.resolve(h, 'api', 'appB', 'second.bin'), secondContent)
    await vault.adopt(first, firstHash, { app: 'appA' })
    await vault.adopt(second, secondHash, { app: 'appB' })
    await fs.promises.unlink(first)
    const walkOptions = []
    const realWalk = vault.walkForInoMatch.bind(vault)
    vault.walkForInoMatch = (...args) => {
      walkOptions.push(args[4])
      return realWalk(...args)
    }
    const progress = Object.assign(vault.idleRepairState(), { kind: 'repair' })

    await vault.rebuild(undefined, { progress })

    assert.strictEqual(vault.registry.links.has(first), false)
    assert.strictEqual(vault.registry.links.get(second).hash, secondHash)
    assert.strictEqual(progress.roots_total, 1)
    assert.strictEqual(progress.roots_completed, 1)
    assert.ok(walkOptions.length > 0)
    assert.ok(walkOptions.every((options) =>
      options.dirConcurrency === 1 && options.statConcurrency === 4))
  })

  test('manual index repair preserves user decisions, history, and pending review state', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    const independent = await writeFile(path.resolve(h, 'cache', 'keep.bin'), crypto.randomBytes(2048))
    vault.sizeThreshold = 1
    await vault.adopt(original, hash, { app: 'appA', source_urls: ['https://example.test/model'] })
    const pendingStat = await fs.promises.stat(pending)
    const pendingEntry = {
      hash, size: content.length, app: 'appB', discovered: Date.now(),
      dev: pendingStat.dev, ino: pendingStat.ino,
      mtime: pendingStat.mtimeMs, ctime: pendingStat.ctimeMs
    }
    vault.registry.duplicates.set(pending, pendingEntry)
    vault.registry.scanIndex.set(pending, pendingEntry)
    vault.registry.excluded.set(independent, { ts: Date.now(), size: 2048 })
    vault.registry.totals.lifetime_bytes_saved = 12345
    vault.registry.lastScan = { ts: 111, dirs: 2, files: 3, bytes_total: 999 }

    await vault.rebuild()

    assert.ok(vault.registry.excluded.has(independent), 'keep-independent decision survives')
    assert.strictEqual(vault.registry.excluded.get(independent).size, 2048)
    assert.strictEqual(vault.registry.totals.lifetime_bytes_saved, 12345)
    assert.deepStrictEqual(vault.registry.lastScan, { ts: 111, dirs: 2, files: 3, bytes_total: 999 })
    assert.ok(vault.registry.duplicates.has(pending), 'pending review item survives when still valid')
    assert.deepStrictEqual(vault.registry.blobs.get(hash).source_urls, ['https://example.test/model'])
  })

  test('manual repair never transfers an undo batch to a different tracked inode', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const firstContent = crypto.randomBytes(4096)
    const secondContent = crypto.randomBytes(4096)
    const firstHash = sha256(firstContent)
    const secondHash = sha256(secondContent)
    const first = await writeFile(path.resolve(h, 'api', 'appA', 'first.bin'), firstContent)
    const target = await writeFile(path.resolve(h, 'api', 'appB', 'target.bin'), firstContent)
    const second = await writeFile(path.resolve(h, 'api', 'appC', 'second.bin'), secondContent)
    await vault.adopt(first, firstHash, { app: 'appA' })
    assert.strictEqual((await vault.convert(target, firstHash, {
      app: 'appB', batch_id: 'batch-old'
    })).status, 'converted')
    await vault.adopt(second, secondHash, { app: 'appC' })

    const replacementPath = `${target}.replacement`
    await fs.promises.link(vault.storePathFor(secondHash), replacementPath)
    await fs.promises.rename(replacementPath, target)
    const replacementStat = await fs.promises.stat(target)
    vault.registry.maxEvents = 2
    vault.registry.compactEvery = 1
    for (let index = 0; index < 3; index += 1) {
      await vault.registry.appendEvent({ kind: 'scan', marker: index })
    }

    await vault.rebuild()

    const repaired = vault.registry.links.get(target)
    assert.strictEqual(repaired.hash, secondHash)
    assert.strictEqual(repaired.batch_id, null)
    assert.deepStrictEqual(await vault.undoBatch('batch-old'), {
      undone: 0, bytes: 0, failed: 0
    })
    assert.strictEqual((await fs.promises.stat(target)).ino, replacementStat.ino)
    assert.deepStrictEqual(await fs.promises.readFile(target), secondContent)
  })

  test('manual repair never publishes a partial index after a transient filesystem error', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    await vault.adopt(file, hash, { app: 'appA' })
    await vault.registry.flush()
    const before = await fs.promises.readFile(vault.registry.snapshotPath, 'utf8')
    const realStat = fs.promises.lstat
    fs.promises.lstat = async (target, ...args) => {
      if (path.resolve(String(target)) === file) {
        const error = new Error('temporary metadata failure')
        error.code = 'EIO'
        throw error
      }
      return realStat(target, ...args)
    }
    try {
      await assert.rejects(vault.rebuild(), (error) => error && error.code === 'EIO')
    } finally {
      fs.promises.lstat = realStat
    }

    assert.ok(vault.registry.blobs.has(hash))
    assert.ok(vault.registry.links.has(file))
    assert.strictEqual(await fs.promises.readFile(vault.registry.snapshotPath, 'utf8'), before)
  })

  test('manual repair preserves pending review after a transient canonical-path error', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), content)
    await vault.sweeper.scan()
    const pending = [...vault.registry.duplicates.keys()][0]
    const original = [...vault.registry.links.keys()].find((filePath) => filePath !== vault.storePathFor(hash))
    assert.ok(vault.registry.blobs.has(hash))
    assert.ok(pending && vault.registry.duplicates.has(pending))
    assert.ok(original)
    const before = await fs.promises.readFile(vault.registry.snapshotPath, 'utf8')
    const realRealpath = fs.promises.realpath
    fs.promises.realpath = async (target, options) => {
      if (path.resolve(String(target)) === pending) {
        const error = new Error('temporary canonical-path failure')
        error.code = 'EIO'
        throw error
      }
      return realRealpath(target, options)
    }
    try {
      await assert.rejects(vault.rebuild(), (error) => error && error.code === 'EIO')
    } finally {
      fs.promises.realpath = realRealpath
    }

    assert.ok(vault.registry.links.has(original))
    assert.ok(vault.registry.duplicates.has(pending))
    assert.strictEqual(await fs.promises.readFile(vault.registry.snapshotPath, 'utf8'), before)
  })

  test('manual repair never reclassifies an excluded path as shared', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), content)
    await vault.adopt(file, hash, { app: 'appA' })
    vault.registry.exclude(file, { ts: Date.now(), size: content.length })

    await vault.rebuild()

    assert.ok(vault.registry.excluded.has(file))
    assert.strictEqual(vault.registry.links.has(file), false)
    assert.strictEqual(vault.registry.scanIndex.has(file), false)
  })

  test('manual repair drops a pending file that changed without changing size', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const originalContent = Buffer.from('first version')
    const changedContent = Buffer.from('other version')
    const hash = sha256(originalContent)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'model.bin'), originalContent)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'model.bin'), originalContent)
    await vault.adopt(original, hash, { app: 'appA' })
    const before = await fs.promises.stat(pending)
    const snapshot = {
      hash, size: before.size, dev: before.dev, ino: before.ino,
      mtime: before.mtimeMs, ctime: before.ctimeMs, source_id: null
    }
    vault.registry.duplicates.set(pending, snapshot)
    vault.registry.scanIndex.set(pending, snapshot)
    await fs.promises.writeFile(pending, changedContent)
    const future = new Date(Date.now() + 2000)
    await fs.promises.utimes(pending, future, future)

    await vault.rebuild()

    assert.strictEqual(vault.registry.duplicates.has(pending), false)
    assert.deepStrictEqual(await fs.promises.readFile(pending), changedContent)
  })

  test('manual repair drops pending conversions when the stored content is no longer verified', async () => {
    const h = await home()
    const vault = await makeVault(h)
    vault.sizeThreshold = 1
    const original = Buffer.alloc(4096, 21)
    const changed = Buffer.alloc(4096, 22)
    await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), original)
    await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), original)
    await vault.sweeper.scan()
    const pendingPath = [...vault.registry.duplicates.keys()][0]
    const linkedPath = [...vault.registry.links.keys()].find((filePath) => filePath !== pendingPath)

    await fs.promises.writeFile(linkedPath, changed)
    await vault.rebuild()

    assert.strictEqual(vault.registry.duplicates.has(pendingPath), false)
    assert.strictEqual(vault.registry.scanIndex.has(linkedPath), false)
    assert.deepStrictEqual(await fs.promises.readFile(pendingPath), original)
  })

  test('rebuild walks every directory without name heuristics and still skips symlinks', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const big = Buffer.alloc(Vault.SIZE_THRESHOLD, 3)
    const hash = sha256(big)
    const inEnv = await writeFile(path.resolve(h, 'api', 'appA', 'env', 'big.bin'), big)
    await vault.adopt(inEnv, hash, { app: 'appA' })
    await fs.promises.unlink(path.resolve(vault.root, 'registry.json')).catch(() => {})
    const fresh = await makeVault(h)
    await fresh.rebuild()
    assert.ok(fresh.registry.blobs.has(hash))
    assert.strictEqual(fresh.registry.links.has(inEnv), true, 'directory names never hide tracked files')
  })

  test('hash worker computes sha256 and is reused across a scan batch', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const first = crypto.randomBytes(1024 * 1024)
    const second = crypto.randomBytes(1024 * 1024)
    const firstFile = await writeFile(path.resolve(h, 'api', 'appA', 'x.bin'), first)
    const secondFile = await writeFile(path.resolve(h, 'api', 'appA', 'y.bin'), second)
    const progress = []
    const firstResult = await vault.hashFile(firstFile, {
      onProgress: (bytes) => progress.push(bytes)
    })
    const worker = vault.worker
    const secondResult = await vault.hashFile(secondFile)
    assert.strictEqual(firstResult.hash, sha256(first))
    assert.strictEqual(firstResult.size, first.length)
    assert.strictEqual(progress.at(-1), first.length)
    assert.strictEqual(secondResult.hash, sha256(second))
    assert.strictEqual(vault.worker, worker, 'worker startup is amortized across files')
  })

  test('a hash worker with no read progress is retired instead of hanging forever', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'stalled.bin'), 'data')
    let terminated = false
    const stalledWorker = {
      postMessage: () => {},
      terminate: async () => { terminated = true }
    }
    vault.worker = stalledWorker
    vault.hashInactivityMs = 20

    const keepAlive = setTimeout(() => {}, 1000)
    try {
      await assert.rejects(vault.hashFile(file), (error) => error.code === 'ETIMEDOUT')
    } finally {
      clearTimeout(keepAlive)
    }

    assert.strictEqual(terminated, true)
    assert.strictEqual(vault.worker, null)
    assert.strictEqual(vault.workerJobs.size, 0)
    vault.hashInactivityMs = 120 * 1000
    const recovered = await vault.hashFile(file)
    assert.strictEqual(recovered.hash, sha256(Buffer.from('data')))
  })

  test('hash progress keeps an active worker alive beyond the inactivity limit', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = Buffer.from('data')
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'slow.bin'), content)
    await vault.hashFile(file)
    const worker = vault.worker
    const realPostMessage = worker.postMessage.bind(worker)
    worker.postMessage = () => {}
    vault.hashInactivityMs = 100
    const progress = []
    const hashing = vault.hashFile(file, {
      onProgress: (bytes) => progress.push(bytes)
    })
    const id = vault.workerSeq
    worker.postMessage = realPostMessage

    for (const bytes of [1, 2, 3]) {
      await new Promise((resolve) => setTimeout(resolve, 60))
      worker.emit('message', { id, bytes_read: bytes })
    }
    worker.emit('message', { id, hash: sha256(content), size: content.length })

    assert.deepStrictEqual(await hashing, { hash: sha256(content), size: content.length })
    assert.deepStrictEqual(progress, [1, 2, 3, content.length])
    assert.strictEqual(vault.worker, worker)
  })

  test('unsupported conversion leaves the independent copy pending and unregistered', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const realLink = fs.promises.link
    fs.promises.link = async (source, target) => {
      if (target === pending + Vault.TMP_SUFFIX) {
        const error = new Error('different volume')
        error.code = 'EXDEV'
        throw error
      }
      return realLink(source, target)
    }
    try {
      const result = await vault.convert(pending, hash, { app: 'appB' })
      assert.strictEqual(result.status, 'unavailable')
    } finally {
      fs.promises.link = realLink
    }
    assert.strictEqual(vault.registry.links.has(pending), false)
    assert.deepStrictEqual(await fs.promises.readFile(pending), content)
  })

  test('a transient adoption permission error is retried instead of becoming copy mode', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const storePath = vault.storePathFor(hash)
    const realLink = fs.promises.link
    fs.promises.link = async (source, target) => {
      if (target === storePath) {
        const error = new Error('permission temporarily unavailable')
        error.code = 'EPERM'
        throw error
      }
      return realLink(source, target)
    }
    try {
      await assert.rejects(vault.adopt(file, hash, { app: 'appA' }), (error) => error.code === 'EPERM')
    } finally {
      fs.promises.link = realLink
    }
    assert.strictEqual(vault.registry.links.has(file), false)
    assert.strictEqual(vault.registry.blobs.has(hash), false)

    assert.strictEqual((await vault.adopt(file, hash, { app: 'appA' })).status, 'adopted')
  })

  test('permission errors during conversion are retryable locks, not unsupported disks', async () => {
    const h = await home()
    const vault = await makeVault(h)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(h, 'api', 'appA', 'm.bin'), content)
    const pending = await writeFile(path.resolve(h, 'api', 'appB', 'm.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    const realLink = fs.promises.link
    fs.promises.link = async (source, target) => {
      if (target === pending + Vault.TMP_SUFFIX) {
        const error = new Error('file is in use')
        error.code = 'EPERM'
        throw error
      }
      return realLink(source, target)
    }
    try {
      const result = await vault.convert(pending, hash, { app: 'appB' })
      assert.strictEqual(result.status, 'locked')
    } finally {
      fs.promises.link = realLink
    }
    assert.strictEqual(vault.registry.links.has(pending), false)
    assert.deepStrictEqual(await fs.promises.readFile(pending), content)
  })

  test('item 11: exFAT volume enters copy mode (macOS loopback; skipped elsewhere)', { skip: process.platform !== 'darwin' }, async (t) => {
    const h = await home()
    const vault = await makeVault(h)
    const dmg = path.resolve(h, 'exfat-test.dmg')
    let mountPoint = null
    try {
      execSync(`hdiutil create -size 16m -fs exFAT -volname VAULTPROBE "${dmg}"`, { stdio: 'pipe' })
      const out = execSync(`hdiutil attach "${dmg}" -nobrowse`, { encoding: 'utf8' })
      const m = out.match(/(\/Volumes\/\S+)\s*$/m)
      mountPoint = m && m[1]
    } catch (e) {
      t.skip('hdiutil exFAT loopback unavailable: ' + e.message)
      return
    }
    try {
      const mode = await vault.probe(mountPoint)
      assert.strictEqual(mode, 'copy')
    } finally {
      if (mountPoint) execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'pipe' })
    }
  })
})
