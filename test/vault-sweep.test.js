const { test, describe, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const Vault = require('../kernel/vault')
const { walkBatches } = require('../kernel/vault/walker')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const writeFile = async (p, content) => {
  await fs.promises.mkdir(path.dirname(p), { recursive: true })
  await fs.promises.writeFile(p, content)
  return p
}

describe('vault manual scan (phase 3)', () => {
  let homes = []
  const makeEnv = async () => {
    const home = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-scan-'))
    homes.push(home)
    await fs.promises.mkdir(path.resolve(home, 'api'), { recursive: true })
    const kernel = {
      homedir: home,
      platform: process.platform,
      path: (...args) => path.resolve(home, ...args)
    }
    const vault = new Vault(kernel)
    await vault.init()
    vault.sizeThreshold = 1024
    kernel.vault = vault
    return { home, vault, kernel }
  }
  after(async () => {
    for (const h of homes) {
      await fs.promises.rm(h, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('directory traversal yields bounded entry chunks without skipping nested files', async () => {
    const root = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-walk-'))
    homes.push(root)
    const expected = []
    for (let index = 0; index < 7; index++) {
      expected.push(await writeFile(path.resolve(root, `dir-${index % 2}`, `file-${index}.bin`), String(index)))
    }
    const found = []
    let dirs = 0
    for await (const batch of walkBatches(root, { concurrency: 2, entryBatchSize: 2 })) {
      for (const group of batch) {
        if (group.entries) assert.ok(group.entries.length <= 2)
        if (group.firstChunk) dirs += 1
        found.push(...group.files.map((file) => file.path))
      }
    }
    assert.deepStrictEqual(found.sort(), expected.sort())
    assert.strictEqual(dirs, 3)
  })

  test('directory traversal resolves unknown entry types before deciding whether to recurse', async () => {
    const root = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-walk-unknown-'))
    homes.push(root)
    const expected = await writeFile(path.resolve(root, 'nested', 'file.bin'), 'data')
    const realOpendir = fs.promises.opendir
    fs.promises.opendir = async (dir, options) => {
      const handle = await realOpendir(dir, options)
      if (path.resolve(dir) !== root) return handle
      return {
        read: async () => {
          const entry = await handle.read()
          if (!entry || entry.name !== 'nested') return entry
          return {
            name: entry.name,
            isDirectory: () => false,
            isFile: () => false,
            isSymbolicLink: () => false
          }
        },
        close: () => handle.close()
      }
    }
    const found = []
    try {
      for await (const batch of walkBatches(root, { concurrency: 2, entryBatchSize: 2 })) {
        found.push(...batch.flatMap((group) => group.files.map((file) => file.path)))
      }
    } finally {
      fs.promises.opendir = realOpendir
    }
    assert.deepStrictEqual(found, [expected])
  })

  test('directory traversal follows only an explicitly configured symlink root', async (t) => {
    const realRoot = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-walk-real-'))
    const linkRoot = path.resolve(os.tmpdir(), `pinokio-walk-link-${crypto.randomUUID()}`)
    homes.push(realRoot, linkRoot)
    await writeFile(path.resolve(realRoot, 'nested', 'file.bin'), 'data')
    try {
      await fs.promises.symlink(realRoot, linkRoot, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }
    const found = []
    for await (const batch of walkBatches(linkRoot)) {
      found.push(...batch.flatMap((group) => group.files.map((file) => file.path)))
    }
    assert.deepStrictEqual(found, [path.resolve(linkRoot, 'nested', 'file.bin')])
  })

  test('scan discovers, hashes, adopts — and records folder totals', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'models', 'm.safetensors'), content)
    await writeFile(path.resolve(home, 'api', 'appA', 'small.txt'), 'tiny')
    const result = await vault.sweeper.scan()
    assert.strictEqual((await fs.promises.stat(file)).nlink, 2)
    assert.ok(vault.registry.blobs.has(sha256(content)))
    assert.ok(result.bytes_total >= content.length + 4, 'folder total includes small files')
    assert.ok(vault.registry.lastScan && vault.registry.lastScan.bytes_total === result.bytes_total)
    assert.ok(vault.registry.lastScan.duration_ms >= 0, 'scan duration is measured')
    assert.ok(vault.registry.lastScan.count_duration_ms >= 0, 'count duration is measured')
    assert.ok(vault.registry.lastScan.walk_duration_ms >= 0, 'walk duration is measured')
    assert.ok(vault.registry.lastScan.hash_duration_ms >= 0, 'hash duration is measured')
    assert.strictEqual(vault.registry.lastScan.hash_total, 1, 'hash work has a determinate total after walking')
    assert.strictEqual(vault.sweeper.state.total_files, 2, 'scan progress uses an exact pre-count')
  })

  test('scans NEVER convert: every byte-identical copy is pending, even in HF caches', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const b = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    const hfBlob = await writeFile(
      path.resolve(home, 'api', 'appC', 'cache', 'HF_HOME', 'hub', 'models--org--m', 'blobs', hash), content)
    await vault.sweeper.scan()

    const nlinks = [a, b, hfBlob].map((p) => fs.statSync(p).nlink)
    assert.strictEqual(nlinks.filter((n) => n === 2).length, 1, 'exactly one copy adopted')
    assert.strictEqual(vault.registry.duplicates.size, 2, 'other two are pending, not converted')
    const events = await vault.registry.readEvents()
    assert.strictEqual(events.filter((e) => e.kind === 'convert').length, 0, 'no conversion without a click')
    assert.ok(events.some((e) => e.kind === 'found'))

    let converted = 0
    for (const scopeId of new Set([...vault.registry.duplicates.values()].map((entry) => entry.source_id))) {
      const summary = await vault.perform('deduplicate', { scope_id: scopeId })
      converted += summary.converted
    }
    assert.strictEqual(converted, 2)
    assert.strictEqual((await fs.promises.stat(a)).ino, (await fs.promises.stat(b)).ino)

    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.lastScan.hashed, 0,
      'Vault-authored inode and ctime changes refresh the exact scan snapshots')
  })

  test('no name heuristics: files inside venv-like folders are found', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const inVenv = await writeFile(
      path.resolve(home, 'api', 'appA', 'coreml_venv', 'lib', 'site-packages', 'lib.dylib'), content)
    await vault.sweeper.scan()
    assert.strictEqual((await fs.promises.stat(inVenv)).nlink, 2, 'adopted despite venv-ish path')
  })

  test('a direct Hugging Face blob that shrinks below the threshold is untracked', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(
      path.resolve(home, 'api', 'appA', 'cache', 'models--org--model', 'blobs', hash), content)
    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.links.has(file), true)

    await fs.promises.truncate(file, 512)
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.links.has(file), false)
    assert.strictEqual(vault.registry.scanIndex.has(file), false)
    assert.strictEqual(vault.registry.blobs.has(hash), false)
    assert.strictEqual((await fs.promises.stat(file)).size, 512)
  })

  test('symlinked dirs and files are skipped; cycles cannot hang the walk', async () => {
    const { home, vault } = await makeEnv()
    const real = await writeFile(path.resolve(home, 'api', 'appA', 'models', 'real.bin'), crypto.randomBytes(4096))
    await fs.promises.symlink(path.resolve(home, 'api', 'appA'), path.resolve(home, 'api', 'appA', 'loop'))
    await vault.sweeper.scan()
    assert.strictEqual((await fs.promises.stat(real)).nlink, 2)
  })

  test('a file replaced by a symlink during inspection is never followed', async (t) => {
    const { home, vault } = await makeEnv()
    const outsideRoot = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-scan-race-outside-'))
    homes.push(outsideRoot)
    const outside = await writeFile(path.resolve(outsideRoot, 'outside.bin'), crypto.randomBytes(4096))
    const outsideHash = sha256(await fs.promises.readFile(outside))
    const candidate = await writeFile(path.resolve(home, 'api', 'appA', 'candidate.bin'), crypto.randomBytes(4096))
    const realLstat = fs.promises.lstat
    let replaced = false
    fs.promises.lstat = async (target, options) => {
      if (!replaced && path.resolve(target) === candidate) {
        replaced = true
        await fs.promises.unlink(candidate)
        try {
          await fs.promises.symlink(outside, candidate, 'file')
        } catch (error) {
          if (error.code === 'EPERM' || error.code === 'EACCES') {
            await fs.promises.copyFile(outside, candidate)
            t.skip(`file symlinks unavailable: ${error.message}`)
          } else {
            throw error
          }
        }
      }
      return realLstat(target, options)
    }
    try {
      await vault.sweeper.scan()
    } finally {
      fs.promises.lstat = realLstat
    }
    if (!replaced || !(await realLstat(candidate)).isSymbolicLink()) return

    assert.strictEqual(vault.registry.scanIndex.has(candidate), false)
    assert.strictEqual(vault.registry.blobs.has(outsideHash), false)
    assert.strictEqual((await fs.promises.stat(outside)).nlink, 1)
  })

  test('top-level linked imports are scanned as external sources while nested links stay skipped', async (t) => {
    const { home, vault } = await makeEnv()
    const external = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-external-'))
    const nested = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-external-nested-'))
    homes.push(external, nested)
    const content = crypto.randomBytes(4096)
    const local = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const imported = await writeFile(path.resolve(external, 'models', 'm.bin'), content)
    const nestedFile = await writeFile(path.resolve(nested, 'should-not-scan.bin'), crypto.randomBytes(4096))
    try {
      await fs.promises.symlink(external, path.resolve(home, 'api', 'linked-models'), process.platform === 'win32' ? 'junction' : 'dir')
      await fs.promises.symlink(nested, path.resolve(external, 'nested-link'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }

    await vault.sweeper.scan()
    const source = vault.sources().find((item) => item.kind === 'external' && item.label === 'linked-models')
    const canonicalImported = path.resolve(await fs.promises.realpath(external), 'models', 'm.bin')
    const canonicalNestedFile = path.resolve(await fs.promises.realpath(nested), 'should-not-scan.bin')
    assert.ok(source, 'linked import becomes an external source')
    assert.strictEqual(source.parent_id, 'external')
    assert.ok(vault.registry.scanIndex.has(canonicalImported), 'external root was scanned')
    assert.strictEqual(vault.registry.scanIndex.has(canonicalNestedFile), false, 'nested directory link was not followed')
    assert.strictEqual(vault.registry.duplicates.get(canonicalImported).source_id, source.id)
    assert.strictEqual((await fs.promises.stat(local)).nlink, 2)

    const status = await vault.status()
    assert.ok(status.sources.some((item) => item.id === source.id && item.kind === 'external'))
    assert.strictEqual(status.duplicates.find((item) => item.path === canonicalImported).source_id, source.id)
    assert.strictEqual(status.last_scan.home_bytes_total, content.length, 'Pinokio metric excludes external files')
    assert.strictEqual(status.last_scan.source_bytes[source.id], content.length, 'external totals remain attributable')
  })

  test('adding an external source creates one persistent import without starting a scan', async () => {
    const { home, vault } = await makeEnv()
    const external = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-added-external-'))
    homes.push(external)
    const content = crypto.randomBytes(4096)
    const imported = await writeFile(path.resolve(external, 'models', 'added.bin'), content)

    const added = await vault.addExternalSource(external)
    assert.strictEqual(added.created, true)
    assert.strictEqual(added.source.kind, 'external')
    assert.strictEqual(added.source.parent_id, 'external')
    assert.strictEqual(vault.registry.scanIndex.size, 0, 'adding a source never scans it')
    assert.strictEqual((await fs.promises.lstat(added.source.mount_path)).isSymbolicLink(), true)
    assert.strictEqual(path.dirname(added.source.mount_path), path.resolve(home, 'vault', 'sources'))
    assert.deepStrictEqual(await fs.promises.readdir(path.resolve(home, 'api')), [],
      'a scan-only external source never enters global app discovery')

    const repeated = await vault.addExternalSource(external)
    assert.strictEqual(repeated.created, false, 'the same physical folder is not imported twice')
    assert.strictEqual(vault.sources().filter((source) => source.kind === 'external').length, 1)

    await vault.sweeper.scan()
    const canonicalImported = path.resolve(await fs.promises.realpath(imported))
    assert.ok(vault.registry.scanIndex.has(canonicalImported))

    await fs.promises.unlink(added.source.mount_path)
    await vault.sweeper.scan()
    const status = await vault.status()
    assert.strictEqual(vault.registry.links.has(canonicalImported), false)
    assert.strictEqual(vault.registry.duplicates.has(canonicalImported), false)
    assert.strictEqual(vault.registry.scanIndex.has(canonicalImported), false)
    assert.strictEqual(status.sources.some((source) => source.kind === 'external'), false)
    assert.strictEqual(status.duplicates.some((item) => item.path === canonicalImported), false)
  })

  test('nested external sources are walked once and attributed to the deepest source', async () => {
    const { vault } = await makeEnv()
    const parent = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-external-parent-'))
    const child = path.resolve(parent, 'child')
    homes.push(parent)
    const content = crypto.randomBytes(4096)
    await writeFile(path.resolve(child, 'model.bin'), content)
    const parentSource = (await vault.addExternalSource(parent)).source
    const childSource = (await vault.addExternalSource(child)).source

    const roots = vault.scanRoots()
    assert.strictEqual(roots.some((root) => root.source_id === parentSource.id), true)
    assert.strictEqual(roots.some((root) => root.source_id === childSource.id), false)
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.lastScan.files, 1)
    assert.strictEqual(vault.registry.lastScan.bytes_total, content.length)
    assert.strictEqual(vault.registry.lastScan.source_bytes[childSource.id], content.length)
  })

  test('a transient source-enumeration error preserves the last complete source map', async () => {
    const { home, vault } = await makeEnv()
    await fs.promises.mkdir(path.resolve(home, 'api', 'appA'), { recursive: true })
    await vault.refreshSources()
    const before = vault.sources().map((source) => source.id)
    const apiRoot = path.resolve(home, 'api')
    const realReaddir = fs.promises.readdir
    fs.promises.readdir = async (target, options) => {
      if (path.resolve(target) === apiRoot) {
        const error = new Error('transient read failure')
        error.code = 'EIO'
        throw error
      }
      return realReaddir(target, options)
    }
    try {
      await assert.rejects(vault.refreshSources(), (error) => error.code === 'EIO')
    } finally {
      fs.promises.readdir = realReaddir
    }

    assert.deepStrictEqual(vault.sources().map((source) => source.id), before)
    assert.ok(vault.sources().some((source) => source.kind === 'app' && source.app === 'appA'))
  })

  test('a transient external-source metadata error fails the scan without publishing an incomplete result', async () => {
    const { vault } = await makeEnv()
    const external = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-external-metadata-'))
    homes.push(external)
    await writeFile(path.resolve(external, 'model.bin'), crypto.randomBytes(4096))
    await vault.addExternalSource(external)
    await vault.sweeper.scan()
    const beforeScan = JSON.parse(JSON.stringify(vault.registry.lastScan))
    const beforeSources = vault.sources().map((source) => source.id)
    const canonicalExternal = await fs.promises.realpath(external)
    const realStat = fs.promises.stat
    let externalStats = 0
    fs.promises.stat = async (target, options) => {
      if (path.resolve(String(target)) === path.resolve(canonicalExternal) && ++externalStats === 2) {
        const error = new Error('temporary external metadata failure')
        error.code = 'EIO'
        throw error
      }
      return realStat(target, options)
    }
    try {
      await assert.rejects(vault.sweeper.scan(), (error) => error && error.code === 'EIO')
    } finally {
      fs.promises.stat = realStat
    }

    assert.deepStrictEqual(vault.registry.lastScan, beforeScan)
    assert.deepStrictEqual(vault.sources().map((source) => source.id), beforeSources)
    assert.strictEqual(vault.sweeper.state.phase, 'failed')
  })

  test('an access-denied subtree is skipped without erasing its records or exact scan totals', async () => {
    const { home, vault } = await makeEnv()
    const deniedDir = path.resolve(home, 'api', 'appA', 'private')
    const deniedFile = await writeFile(path.resolve(deniedDir, 'model.bin'), crypto.randomBytes(4096))
    await vault.sweeper.scan()
    const beforeScan = JSON.parse(JSON.stringify(vault.registry.lastScan))
    assert.strictEqual(vault.registry.links.has(deniedFile), true)

    const accessibleFile = await writeFile(
      path.resolve(home, 'api', 'appB', 'model.bin'),
      crypto.randomBytes(4096)
    )
    const realLstat = fs.promises.lstat
    fs.promises.lstat = async (target, options) => {
      if (path.resolve(String(target)) === deniedDir) {
        const error = new Error('permission denied')
        error.code = 'EACCES'
        throw error
      }
      return realLstat(target, options)
    }
    try {
      const result = await vault.sweeper.scan()
      assert.strictEqual(result.incomplete, true)
    } finally {
      fs.promises.lstat = realLstat
    }

    assert.strictEqual(vault.sweeper.state.phase, 'incomplete')
    assert.strictEqual(vault.sweeper.state.inaccessible, 1)
    assert.deepStrictEqual(vault.sweeper.state.inaccessible_paths, [deniedDir])
    assert.deepStrictEqual(vault.registry.lastScan, beforeScan, 'partial counters never replace exact totals')
    assert.strictEqual(vault.registry.links.has(deniedFile), true, 'prior record under denied subtree survives')
    assert.strictEqual(vault.registry.links.has(accessibleFile), true, 'accessible paths are still scanned')

    await vault.sweeper.scan()
    assert.strictEqual(vault.sweeper.state.phase, 'complete')
    assert.strictEqual(vault.sweeper.state.inaccessible, 0)
    assert.strictEqual(vault.registry.lastScan.files, 2)
  })

  test('a failed source refresh rolls back only the import it just created', async () => {
    const { vault } = await makeEnv()
    const external = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-add-rollback-'))
    homes.push(external)
    const importRoot = vault.sourceRoot
    const realReaddir = fs.promises.readdir
    let importReads = 0
    fs.promises.readdir = async (target, options) => {
      if (path.resolve(target) === importRoot && ++importReads === 1) {
        const error = new Error('transient read failure')
        error.code = 'EIO'
        throw error
      }
      return realReaddir(target, options)
    }
    try {
      await assert.rejects(vault.addExternalSource(external), (error) => error.code === 'EIO')
    } finally {
      fs.promises.readdir = realReaddir
    }

    assert.deepStrictEqual(await fs.promises.readdir(importRoot), [])
    assert.strictEqual(vault.sources().some((source) => source.kind === 'external'), false)
  })

  test('excluded paths are respected: no adoption, no pending, no re-listing', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const b = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    vault.registry.excluded.set(b, { ts: Date.now() })
    await vault.sweeper.scan()
    assert.strictEqual((await fs.promises.stat(a)).nlink, 2)
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
    assert.strictEqual(vault.registry.duplicates.has(b), false)
  })

  test('steady-state rescan performs zero content hashes', async () => {
    const { home, vault } = await makeEnv()
    await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), crypto.randomBytes(4096))
    await vault.sweeper.scan()
    const priorFiles = vault.registry.lastScan.files
    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.lastScan.hashed, 0)
    assert.strictEqual(vault.sweeper.state.total_files, priorFiles, 'every scan uses a fresh exact file count')
  })

  test('a completed scan refreshes dead names and orphan state', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    await vault.adopt(file, hash, { app: 'appA' })
    await fs.promises.unlink(file)

    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.links.has(file), false)
    assert.strictEqual(vault.registry.blobs.get(hash).orphan, true)
  })

  test('scan-derived state is persisted once at the end of a scan', async () => {
    const { home, vault } = await makeEnv()
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      writeFile(path.resolve(home, 'api', 'appA', `model-${index}.bin`), crypto.randomBytes(4096))))
    const realFlush = vault.registry.flush.bind(vault.registry)
    let flushes = 0
    vault.registry.flush = async (...args) => {
      flushes += 1
      return realFlush(...args)
    }
    vault.registry.schedulePersist()

    await vault.sweeper.scan()

    assert.strictEqual(flushes, 1)
  })

  test('a first scan counts the exact file total before processing begins', async () => {
    const { home, vault } = await makeEnv()
    const dir = path.resolve(home, 'api', 'appA')
    await Promise.all(Array.from({ length: 600 }, (_, index) =>
      writeFile(path.resolve(dir, `small-${index}.txt`), 'x')))

    const sweeper = vault.sweeper
    const realWalk = sweeper.walk.bind(sweeper)
    let beforeWalk = null
    sweeper.walk = async (...args) => {
      beforeWalk = {
        phase: sweeper.state.phase,
        total: sweeper.state.total_files,
        counted: sweeper.state.counted_files
      }
      return realWalk(...args)
    }
    try {
      await sweeper.scan()
    } finally {
      sweeper.walk = realWalk
    }

    assert.deepStrictEqual(beforeWalk, { phase: 'discovering', total: 600, counted: 600 })
    assert.strictEqual(sweeper.state.files, 600)
  })

  test('a changed tree receives a new exact progress total', async () => {
    const { home, vault } = await makeEnv()
    const dir = path.resolve(home, 'api', 'appA')
    await writeFile(path.resolve(dir, 'first.txt'), 'x')
    await vault.sweeper.scan()
    await writeFile(path.resolve(dir, 'second.txt'), 'x')

    await vault.sweeper.scan()

    assert.strictEqual(vault.sweeper.state.files, 2)
    assert.strictEqual(vault.sweeper.state.total_files, 2)
  })

  test('a stale previous scan count is never reused as the current exact progress total', async () => {
    const { home, vault } = await makeEnv()
    await writeFile(path.resolve(home, 'api', 'appA', 'first.txt'), 'x')
    vault.registry.lastScan = {
      files: 100,
      duration_ms: 1000,
      walk_duration_ms: 800
    }

    await vault.sweeper.scan()

    assert.strictEqual(vault.sweeper.state.files, 1)
    assert.strictEqual(vault.sweeper.state.total_files, 1)
  })

  test('a rescan exposes its previous exact count as an approximate counting baseline', async () => {
    const { home, vault } = await makeEnv()
    await writeFile(path.resolve(home, 'api', 'appA', 'first.txt'), 'x')
    vault.registry.lastScan = {
      files: 100,
      duration_ms: 1000,
      count_duration_ms: 300,
      walk_duration_ms: 600,
      hash_wait_duration_ms: 100
    }
    const sweeper = vault.sweeper
    const realCount = sweeper.countFiles.bind(sweeper)
    let inspect
    sweeper.countFiles = async (...args) => {
      inspect = {
        estimate: sweeper.state.count_estimate_files,
        countWeight: sweeper.state.estimated_count_weight,
        walkWeight: sweeper.state.estimated_walk_weight
      }
      return realCount(...args)
    }
    try {
      await sweeper.scan()
    } finally {
      sweeper.countFiles = realCount
    }

    assert.deepStrictEqual(inspect, { estimate: 100, countWeight: 0.3, walkWeight: 0.6 })
    assert.strictEqual(sweeper.state.total_files, 1, 'the completed current count remains exact')
  })

  test('a transient metadata failure fails the scan without replacing its last complete result', async () => {
    const { home, vault } = await makeEnv()
    await writeFile(path.resolve(home, 'api', 'appA', 'first.txt'), 'x')
    await vault.sweeper.scan()
    const before = JSON.parse(JSON.stringify(vault.registry.lastScan))
    const unreadable = await writeFile(path.resolve(home, 'api', 'appA', 'second.txt'), 'x')
    const realLstat = fs.promises.lstat
    fs.promises.lstat = async (target, options) => {
      if (path.resolve(String(target)) === unreadable) {
        const error = new Error('temporary metadata failure')
        error.code = 'EIO'
        throw error
      }
      return realLstat(target, options)
    }
    try {
      await assert.rejects(vault.sweeper.scan(), (error) => error && error.code === 'EIO')
    } finally {
      fs.promises.lstat = realLstat
    }

    assert.deepStrictEqual(vault.registry.lastScan, before)
    assert.strictEqual(vault.sweeper.state.active, false)
    assert.strictEqual(vault.sweeper.state.phase, 'failed')
  })

  test('a verification failure does not publish a completed scan timestamp', async () => {
    const { home, vault } = await makeEnv()
    await writeFile(path.resolve(home, 'api', 'appA', 'first.txt'), 'x')
    await vault.sweeper.scan()
    const before = JSON.parse(JSON.stringify(vault.registry.lastScan))
    const realVerify = vault.verify.bind(vault)
    vault.verify = async () => {
      const error = new Error('temporary verification failure')
      error.code = 'EIO'
      throw error
    }
    try {
      await assert.rejects(vault.sweeper.scan(), (error) => error && error.code === 'EIO')
    } finally {
      vault.verify = realVerify
    }

    assert.deepStrictEqual(vault.registry.lastScan, before)
    assert.strictEqual(vault.sweeper.state.phase, 'failed')
  })

  test('file metadata inspection uses bounded concurrency without changing results', async () => {
    const { home, vault } = await makeEnv()
    const dir = path.resolve(home, 'api', 'bulk')
    await Promise.all(Array.from({ length: 48 }, (_, index) =>
      writeFile(path.resolve(dir, `dir-${index}`, 'small.txt'), 'x')))
    const realLstat = fs.promises.lstat
    let active = 0
    let maximum = 0
    fs.promises.lstat = async (target) => {
      if (String(target).startsWith(dir + path.sep)) {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 3))
        try {
          return await realLstat(target)
        } finally {
          active -= 1
        }
      }
      return realLstat(target)
    }
    try {
      await vault.sweeper.scan()
    } finally {
      fs.promises.lstat = realLstat
    }
    assert.ok(maximum > 1, `expected concurrent metadata reads, saw ${maximum}`)
    assert.ok(maximum <= vault.statConcurrency, `metadata concurrency exceeded its bound: ${maximum}`)
    assert.strictEqual(vault.registry.lastScan.files >= 48, true)
  })

  test('content hashing applies backpressure to keep the pending queue bounded', async () => {
    const { home, vault } = await makeEnv()
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      writeFile(path.resolve(home, 'api', 'appA', `model-${index}.bin`), crypto.randomBytes(4096))))
    vault.sweeper.hashQueueLimit = 2
    const realHashFile = vault.hashFile.bind(vault)
    let maximumQueued = 0
    vault.hashFile = async (...args) => {
      maximumQueued = Math.max(maximumQueued, vault.sweeper.state.queued)
      await new Promise((resolve) => setTimeout(resolve, 3))
      return realHashFile(...args)
    }

    try {
      await vault.sweeper.scan()
    } finally {
      vault.hashFile = realHashFile
    }

    assert.ok(maximumQueued <= 2, `hash queue exceeded its bound: ${maximumQueued}`)
    assert.strictEqual(vault.registry.lastScan.hashed, 8)
  })

  test('multiple names for one inode share one exact hash job', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const b = path.resolve(home, 'api', 'appB', 'model.bin')
    await fs.promises.mkdir(path.dirname(b), { recursive: true })
    await fs.promises.link(a, b)

    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.lastScan.hashed, 1, 'physical content was hashed once')
    assert.strictEqual(vault.registry.lastScan.inode_reuses, 1, 'second name reused the inode hash job')
    assert.strictEqual(vault.registry.duplicates.size, 0, 'existing hard links are already shared')
    assert.strictEqual(vault.registry.links.get(a).hash, sha256(content))
    assert.strictEqual(vault.registry.links.get(b).hash, sha256(content))
  })

  test('an inode discovered after its hash job completes reuses the completed digest', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const b = path.resolve(home, 'api', 'appB', 'model.bin')
    await fs.promises.mkdir(path.dirname(b), { recursive: true })
    await fs.promises.link(a, b)
    const realConsiderStat = vault.sweeper.considerStat.bind(vault.sweeper)
    let candidates = 0
    vault.sweeper.considerStat = async (...args) => {
      const result = await realConsiderStat(...args)
      candidates += 1
      if (candidates === 1) await vault.sweeper.settle()
      return result
    }

    try {
      await vault.sweeper.scan()
    } finally {
      vault.sweeper.considerStat = realConsiderStat
    }

    assert.strictEqual(vault.registry.lastScan.hashed, 1)
    assert.strictEqual(vault.registry.lastScan.inode_reuses, 1)
    assert.strictEqual(vault.registry.links.get(a).hash, sha256(content))
    assert.strictEqual(vault.registry.links.get(b).hash, sha256(content))
  })

  test('a file changed during hashing never publishes the stale digest', async () => {
    const { home, vault } = await makeEnv()
    const original = crypto.randomBytes(4096)
    const oldHash = sha256(original)
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'changing.bin'), original)
    const realHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (target) => {
      const result = await realHashFile(target)
      await fs.promises.writeFile(target, crypto.randomBytes(original.length))
      const future = new Date(Date.now() + 2000)
      await fs.promises.utimes(target, future, future)
      return result
    }

    try {
      await vault.sweeper.scan()
    } finally {
      vault.hashFile = realHashFile
    }

    assert.strictEqual(vault.registry.lastScan.unstable_hashes, 1)
    assert.strictEqual(vault.registry.blobs.has(oldHash), false, 'stale digest was discarded')
    assert.strictEqual(vault.registry.scanIndex.has(file), false, 'unstable path remains unclassified')
    assert.strictEqual((await fs.promises.stat(file)).nlink, 1, 'unstable file was not adopted')
  })

  test('a file read failure is counted without aborting the scan', async () => {
    const { home, vault } = await makeEnv()
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'unreadable.bin'), crypto.randomBytes(4096))
    const realHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async () => {
      const error = new Error('temporary read failure')
      error.code = 'EIO'
      throw error
    }

    try {
      await vault.sweeper.scan()
    } finally {
      vault.hashFile = realHashFile
    }

    assert.strictEqual(vault.registry.lastScan.hash_total, 1)
    assert.strictEqual(vault.registry.lastScan.hashed, 0)
    assert.strictEqual(vault.registry.lastScan.hash_failures, 1)
    assert.strictEqual(vault.registry.scanIndex.has(file), false)
  })

  test('conversion tmp files are never candidates', async () => {
    const { home, vault } = await makeEnv()
    const stray = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin.pinokio-dedup-tmp'), crypto.randomBytes(4096))
    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.scanIndex.has(stray), false)
    assert.strictEqual((await fs.promises.stat(stray)).nlink, 1)
  })

  test('hf --local-dir metadata provides hashes without content reads', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const dir = path.resolve(home, 'api', 'appA', 'ckpt')
    const file = await writeFile(path.resolve(dir, 'model.safetensors'), content)
    const future = (Date.now() + 60000) / 1000
    await writeFile(
      path.resolve(dir, '.cache', 'huggingface', 'model.safetensors.metadata'),
      `commit123\n"${hash}"\n${future}\n`)
    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.lastScan.hashed, 0, 'hash harvested, not computed')
    assert.strictEqual((await fs.promises.stat(file)).nlink, 2)
    assert.ok(vault.registry.blobs.has(hash))
  })

  test('hf --local-dir metadata older than the file always falls back to content hashing', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const staleHash = hash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
    const dir = path.resolve(home, 'api', 'appA', 'ckpt')
    const file = await writeFile(path.resolve(dir, 'model.safetensors'), content)
    const fileStat = await fs.promises.stat(file)
    const staleTimestamp = (fileStat.mtimeMs - 500) / 1000
    await writeFile(
      path.resolve(dir, '.cache', 'huggingface', 'model.safetensors.metadata'),
      `commit123\n"${staleHash}"\n${staleTimestamp}\n`
    )

    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.lastScan.hashed, 1)
    assert.ok(vault.registry.blobs.has(hash))
    assert.strictEqual(vault.registry.blobs.has(staleHash), false)
  })

  test('linked hf metadata is never followed for hash-free classification', {
    skip: process.platform === 'win32'
  }, async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const actualHash = sha256(content)
    const forgedHash = actualHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
    const dir = path.resolve(home, 'api', 'appA', 'ckpt')
    await writeFile(path.resolve(dir, 'model.safetensors'), content)
    const outside = await writeFile(path.resolve(home, 'forged.metadata'),
      `commit123\n"${forgedHash}"\n${(Date.now() + 60000) / 1000}\n`)
    const metadata = path.resolve(dir, '.cache', 'huggingface', 'model.safetensors.metadata')
    await fs.promises.mkdir(path.dirname(metadata), { recursive: true })
    await fs.promises.symlink(outside, metadata)

    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.lastScan.hashed, 1)
    assert.strictEqual(vault.registry.blobs.has(actualHash), true)
    assert.strictEqual(vault.registry.blobs.has(forgedHash), false)
  })

  test('hash-free metadata outside an external source cannot classify its files', async () => {
    const { vault } = await makeEnv()
    const parent = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-metadata-scope-'))
    homes.push(parent)
    const external = path.resolve(parent, 'external')
    const content = crypto.randomBytes(4096)
    const actualHash = sha256(content)
    const forgedHash = actualHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
    const file = await writeFile(path.resolve(external, 'model.bin'), content)
    await writeFile(
      path.resolve(parent, '.cache', 'huggingface', 'external', 'model.bin.metadata'),
      `commit123\n"${forgedHash}"\n${(Date.now() + 60000) / 1000}\n`
    )
    await vault.addExternalSource(external)
    const canonicalFile = path.resolve(await fs.promises.realpath(file))

    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.scanIndex.get(canonicalFile).hash, actualHash)
    assert.strictEqual(vault.registry.blobs.has(actualHash), true)
    assert.strictEqual(vault.registry.blobs.has(forgedHash), false)
  })

  test('a changed pending path transitions to exactly one new classification', async () => {
    const { home, vault } = await makeEnv()
    const original = Buffer.alloc(4096, 1)
    const changed = Buffer.alloc(4096, 2)
    await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), original)
    await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), original)
    await vault.sweeper.scan()
    const pending = [...vault.registry.duplicates.keys()][0]

    await fs.promises.writeFile(pending, changed)
    const future = new Date(Date.now() + 2000)
    await fs.promises.utimes(pending, future, future)
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.duplicates.has(pending), false)
    assert.strictEqual(vault.registry.links.get(pending).hash, sha256(changed))
    assert.strictEqual(vault.registry.scanIndex.get(pending).hash, sha256(changed))
  })

  test('a changed pending path updates to a different existing content group', async () => {
    const { home, vault } = await makeEnv()
    const first = Buffer.alloc(4096, 3)
    const second = Buffer.alloc(4096, 4)
    await writeFile(path.resolve(home, 'api', 'appA', 'a.bin'), first)
    await writeFile(path.resolve(home, 'api', 'appB', 'a.bin'), first)
    await writeFile(path.resolve(home, 'api', 'appC', 'b.bin'), second)
    await vault.sweeper.scan()
    const pending = [...vault.registry.duplicates.keys()][0]

    await fs.promises.writeFile(pending, second)
    const future = new Date(Date.now() + 2000)
    await fs.promises.utimes(pending, future, future)
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.links.has(pending), false)
    assert.strictEqual(vault.registry.duplicates.get(pending).hash, sha256(second))
    assert.strictEqual(vault.registry.scanIndex.get(pending).hash, sha256(second))
  })

  test('files below the threshold and deleted files leave no derived scan state', async () => {
    const { home, vault } = await makeEnv()
    const content = Buffer.alloc(4096, 5)
    await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.sweeper.scan()
    const pending = [...vault.registry.duplicates.keys()][0]
    const linked = [...vault.registry.links.keys()].find((filePath) => filePath !== pending)

    await fs.promises.writeFile(pending, Buffer.alloc(128, 6))
    await fs.promises.unlink(linked)
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.duplicates.has(pending), false)
    assert.strictEqual(vault.registry.scanIndex.has(pending), false)
    assert.strictEqual(vault.registry.links.has(linked), false)
    assert.strictEqual(vault.registry.scanIndex.has(linked), false)
  })

  test('HF hash-free ingestion falls back to the generic walker for every other entry', async () => {
    const { home, vault } = await makeEnv()
    const blobDir = path.resolve(home, 'api', 'appA', 'cache', 'models--org--model', 'blobs')
    const ordinary = await writeFile(path.resolve(blobDir, 'model.bin'), Buffer.alloc(4096, 7))
    const nested = await writeFile(path.resolve(blobDir, 'nested', 'model.bin'), Buffer.alloc(4096, 8))

    await vault.sweeper.scan()

    assert.ok(vault.registry.scanIndex.has(ordinary))
    assert.ok(vault.registry.scanIndex.has(nested))
    assert.strictEqual(vault.registry.lastScan.candidates, 2)
    assert.strictEqual(vault.registry.lastScan.hashed, 2)
  })

  test('copy-mode content remains tracked without becoming its own duplicate', async () => {
    const { home, vault } = await makeEnv()
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), Buffer.alloc(4096, 9))
    const realLink = fs.promises.link
    fs.promises.link = async (source, target) => {
      if (target.startsWith(vault.blobRoot)) {
        const error = new Error('unsupported')
        error.code = 'EXDEV'
        throw error
      }
      return realLink(source, target)
    }
    try {
      await vault.sweeper.scan()
      await vault.sweeper.scan()
    } finally {
      fs.promises.link = realLink
    }

    assert.strictEqual(vault.registry.links.get(file).mode, 'copy')
    assert.strictEqual(vault.registry.duplicates.has(file), false)
  })

  test('changing one copy-mode file preserves other copies in the original content group', async () => {
    const { home, vault } = await makeEnv()
    const original = Buffer.alloc(4096, 9)
    const changed = Buffer.alloc(4096, 10)
    const first = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), original)
    const second = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), original)
    const originalHash = sha256(original)
    const changedHash = sha256(changed)
    const realLink = fs.promises.link
    fs.promises.link = async (source, target) => {
      if (target.startsWith(vault.blobRoot)) {
        const error = new Error('unsupported')
        error.code = 'EXDEV'
        throw error
      }
      return realLink(source, target)
    }
    try {
      await vault.sweeper.scan()
      await fs.promises.writeFile(first, changed)
      await vault.sweeper.scan()
    } finally {
      fs.promises.link = realLink
    }

    assert.strictEqual(vault.registry.links.get(first).hash, changedHash)
    assert.strictEqual(vault.registry.links.get(second).hash, originalHash)
    assert.strictEqual(vault.registry.links.get(second).mode, 'copy')
    assert.strictEqual(vault.registry.blobs.has(originalHash), true)
  })

  test('changing a shared inode preserves an unchanged copy-mode name of the old content', async () => {
    const { home, vault } = await makeEnv()
    const original = Buffer.alloc(4096, 11)
    const changed = Buffer.alloc(4096, 12)
    const originalHash = sha256(original)
    const shared = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), original)
    const copied = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), original)
    await vault.adopt(shared, originalHash, { app: 'appA' })
    const copiedStat = await fs.promises.lstat(copied)
    vault.registry.addLink(copied, {
      hash: originalHash,
      app: 'appB',
      dev: copiedStat.dev,
      ino: copiedStat.ino,
      mode: 'copy'
    })
    vault.registry.scanIndex.set(copied, {
      hash: originalHash,
      size: copiedStat.size,
      dev: copiedStat.dev,
      ino: copiedStat.ino,
      mtime: copiedStat.mtimeMs,
      ctime: copiedStat.ctimeMs,
      source_id: null
    })

    await fs.promises.writeFile(shared, changed)
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.links.get(copied).hash, originalHash)
    assert.strictEqual(vault.registry.links.get(copied).mode, 'copy')
    assert.strictEqual(vault.registry.blobs.has(originalHash), true)
    assert.strictEqual(vault.registry.links.get(shared).hash, sha256(changed))
  })

  test('a copy-mode-only content record cannot prevent later local adoption', async () => {
    const { home, vault } = await makeEnv()
    const content = Buffer.alloc(4096, 10)
    const hash = sha256(content)
    vault.registry.addBlob(hash, { size: content.length })
    const first = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const second = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)

    await vault.sweeper.scan()

    assert.strictEqual(fs.existsSync(vault.storePathFor(hash)), true)
    const linked = [first, second].filter((filePath) => vault.registry.links.has(filePath))
    const pending = [first, second].filter((filePath) => vault.registry.duplicates.has(filePath))
    assert.strictEqual(linked.length, 1)
    assert.strictEqual(pending.length, 1)
    assert.strictEqual(vault.registry.links.get(linked[0]).mode, 'link')
    assert.strictEqual(vault.registry.duplicates.get(pending[0]).hash, hash)
  })

  test('a repaired linked inode without a trustworthy snapshot is hashed once', async () => {
    const { home, vault } = await makeEnv()
    const original = Buffer.alloc(4096, 10)
    const changed = Buffer.alloc(4096, 11)
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), original)
    await vault.sweeper.scan()
    const oldHash = sha256(original)

    await fs.promises.writeFile(file, changed)
    await vault.rebuild()
    assert.strictEqual(vault.registry.scanIndex.has(file), false, 'Repair leaves changed content unverified')
    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.lastScan.hashed, 1)
    assert.strictEqual(vault.registry.blobs.has(oldHash), false)
    assert.ok(vault.registry.blobs.has(sha256(changed)))
    assert.strictEqual(vault.registry.scanIndex.get(file).hash, sha256(changed))
  })

  test('scan-cache identity includes the filesystem device', async () => {
    const { home, vault } = await makeEnv()
    const file = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), Buffer.alloc(4096, 12))
    await vault.sweeper.scan()
    vault.registry.scanIndex.get(file).dev = `other:${vault.registry.scanIndex.get(file).dev}`

    await vault.sweeper.scan()

    assert.strictEqual(vault.registry.lastScan.hashed, 1)
  })

  test('an unrelated unresolved action does not block app conversion', async () => {
    const { home, vault, kernel } = await makeEnv()
    const content = Buffer.alloc(4096, 13)
    await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.sweeper.scan()
    const pending = [...vault.registry.duplicates.values()][0]
    kernel.api = { running: { 'custom-action-id': true } }

    const result = await vault.perform('deduplicate', { scope_id: pending.source_id })

    assert.strictEqual(result.converted, 1)
  })

  test('a custom running id blocks only the app that owns its script path', async () => {
    const { home, vault, kernel } = await makeEnv()
    const content = Buffer.alloc(4096, 14)
    await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.sweeper.scan()
    const pending = [...vault.registry.duplicates.values()][0]
    const source = vault.sources().find((item) => item.id === pending.source_id)
    kernel.api = {
      running: { 'custom-action-id': true },
      running_paths: { 'custom-action-id': path.resolve(source.root, 'start.js') }
    }

    const result = await vault.perform('deduplicate', { scope_id: pending.source_id })

    assert.match(result.error, /running script/i)
    assert.strictEqual(vault.registry.duplicates.size, 1)
  })

  test('in-place mutation propagates to all names; scan detects divergence and evicts', async () => {
    const { home, vault } = await makeEnv()
    const original = crypto.randomBytes(4096)
    const oldHash = sha256(original)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), original)
    await vault.adopt(a, oldHash, { app: 'appA' })
    const b = path.resolve(home, 'api', 'appB', 'm.bin')
    await writeFile(b, original)
    await vault.convert(b, oldHash, { app: 'appB' })
    await vault.sweeper.scan()

    const mutated = crypto.randomBytes(4096)
    await fs.promises.writeFile(b, mutated)
    assert.deepStrictEqual(await fs.promises.readFile(a), mutated, 'in-place writes propagate to every name')

    await vault.sweeper.scan()
    assert.strictEqual(vault.registry.blobs.has(oldHash), false, 'stale blob evicted')
    assert.strictEqual(fs.existsSync(vault.storePathFor(oldHash)), false)
    assert.ok(vault.registry.blobs.has(sha256(mutated)))
    const events = await vault.registry.readEvents()
    assert.ok(events.some((e) => e.kind === 'diverged' && e.hash === oldHash))
  })

  test('scan of a 10k-entry folder at steady state finishes fast with zero reads', async () => {
    const { home, vault } = await makeEnv()
    const dir = path.resolve(home, 'api', 'bigapp', 'stuff')
    await fs.promises.mkdir(dir, { recursive: true })
    const tiny = Buffer.from('x')
    await Promise.all(Array.from({ length: 10000 }, (_, i) =>
      fs.promises.writeFile(path.resolve(dir, `f${i}.txt`), tiny)))
    await vault.sweeper.scan()
    const started = Date.now()
    await vault.sweeper.scan()
    const elapsed = Date.now() - started
    assert.ok(elapsed < 2000, `steady-state rescan took ${elapsed}ms`)
    assert.strictEqual(vault.registry.lastScan.hashed, 0)
  })

  test('locked conversions stay pending and can be retried', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const a = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    await vault.adopt(a, hash, { app: 'appA' })
    const b = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await vault.refreshSources()
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')
    const pendingStat = await fs.promises.stat(b)
    vault.registry.duplicates.set(b, {
      hash, size: content.length, app: 'appB', source_id: appB.id,
      dev: pendingStat.dev, ino: pendingStat.ino,
      mtime: pendingStat.mtimeMs, ctime: pendingStat.ctimeMs
    })

    const realConvert = vault.convert.bind(vault)
    let calls = 0
    vault.convert = async (...args) => {
      calls += 1
      if (calls === 1) return { status: 'locked' }
      return realConvert(...args)
    }
    const first = await vault.perform('deduplicate', { scope_id: appB.id })
    assert.strictEqual(first.locked, 1)
    assert.ok(vault.registry.duplicates.has(b), 'still pending after lock')
    const second = await vault.perform('deduplicate', { scope_id: appB.id })
    vault.convert = realConvert
    assert.strictEqual(second.converted, 1)
    assert.strictEqual((await fs.promises.stat(b)).ino, (await fs.promises.stat(a)).ino)
  })
})
