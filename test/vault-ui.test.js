const { test, describe, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const ejs = require('ejs')
const { JSDOM } = require('jsdom')
const Vault = require('../kernel/vault')
const { CANDIDATE_SIZE_OPTIONS } = require('../kernel/vault/constants')

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

const statusFixture = (data, requestUrl) => {
  const url = new URL(String(requestUrl || '/info/dedup'), 'http://localhost')
  if (!data || !data.enabled || data.inventory ||
      url.pathname !== '/info/dedup' || url.searchParams.get('progress') === '1') {
    return data
  }
  const sources = Array.isArray(data.sources) ? data.sources : []
  const sourceMap = new Map(sources.map((source) => [source.id, source]))
  const sourceIdsFor = (item) => item.source_ids ||
    (item.source_id ? [item.source_id] : [])
  const visitSources = (ids, visit) => {
    const seen = new Set()
    for (let id of ids) {
      while (id && !seen.has(id)) {
        visit(id)
        seen.add(id)
        id = sourceMap.get(id) && sourceMap.get(id).parent_id
      }
    }
  }
  const counts = {
    all: 0, duplicates: 0, shared: 0, tracked: 0,
    independent: 0, reclaimable: 0, activity: 0
  }
  const sourceCounts = { all: {}, duplicates: {}, independent: {} }
  const shareableBySource = {}
  let shareableDuplicates = 0
  const duplicateLocations = new Set()
  const records = (data.items || []).map((item) => {
    const kind = item.activity_type
      ? 'activity'
      : item.orphan ? 'reclaimable' : 'file'
    const record = {
      item,
      kind,
      status: item.status || null,
      source_ids: sourceIdsFor(item)
    }
    if (kind === 'activity') counts.activity += 1
    else if (kind === 'reclaimable') counts.reclaimable += 1
    else {
      counts.all += 1
      counts[item.status] += 1
      visitSources(record.source_ids, (id) => {
        sourceCounts.all[id] = (sourceCounts.all[id] || 0) + 1
        if (item.status === 'duplicate') {
          sourceCounts.duplicates[id] = (sourceCounts.duplicates[id] || 0) + 1
        } else if (item.status === 'independent') {
          sourceCounts.independent[id] = (sourceCounts.independent[id] || 0) + 1
        }
      })
    }
    if (item.status === 'duplicate' && item.shareable !== false) {
      shareableDuplicates += 1
      visitSources(record.source_ids, (id) => {
        shareableBySource[id] = (shareableBySource[id] || 0) + 1
      })
      record.source_ids.forEach((id) => duplicateLocations.add(id))
    }
    return record
  })
  const view = url.searchParams.get('view') || 'all'
  const statusFilter = url.searchParams.get('status_filter') || 'all'
  const locationId = url.searchParams.get('location_id')
  const query = String(url.searchParams.get('q') || '').trim().toLowerCase()
  const inLocation = (sourceId) => {
    if (!locationId) return true
    const seen = new Set()
    while (sourceId && !seen.has(sourceId)) {
      if (sourceId === locationId) return true
      seen.add(sourceId)
      sourceId = sourceMap.get(sourceId) && sourceMap.get(sourceId).parent_id
    }
    return false
  }
  const selected = records.filter((record) => {
    if (view === 'all') {
      if (!record.status) return false
      if (statusFilter !== 'all' && record.status !== statusFilter) return false
    } else if (view === 'duplicates' && record.status !== 'duplicate') return false
    else if (view === 'shared' && record.status !== 'shared') return false
    else if (view === 'tracked' && record.status !== 'tracked') return false
    else if (view === 'independent' && record.status !== 'independent') return false
    else if (view === 'reclaimable' && record.kind !== 'reclaimable') return false
    else if (view === 'activity' && record.kind !== 'activity') return false
    if (locationId && !record.source_ids.some(inLocation)) return false
    if (!query) return true
    return JSON.stringify(record.item).toLowerCase().includes(query)
  })
  const sizeSort = url.searchParams.get('size_sort')
  if (sizeSort === 'asc' || sizeSort === 'desc') {
    selected.sort((left, right) => {
      const difference = (Number(left.item.size) || 0) - (Number(right.item.size) || 0)
      return sizeSort === 'asc' ? difference : -difference
    })
  }
  const pageSize = Math.max(1, Math.min(500, Number(url.searchParams.get('page_size')) || 500))
  const pages = Math.max(1, Math.ceil(selected.length / pageSize))
  const page = Math.max(0, Math.min(Number(url.searchParams.get('page')) || 0, pages - 1))
  const start = page * pageSize
  const end = Math.min(start + pageSize, selected.length)
  const pageRecords = selected.slice(start, end)
  const currentLocations = new Set(selected
    .flatMap((record) => record.source_ids))
  const currentShareableBytes = selected
    .filter((record) => record.status === 'duplicate' && record.item.shareable)
    .reduce((sum, record) => sum + (Number(record.item.size) || 0), 0)
  return Object.assign({}, data, {
    items: pageRecords.map((record) => record.item),
    inventory: {
      view,
      counts,
      source_counts: sourceCounts,
      shareable_by_source: shareableBySource,
      shareable_duplicates: shareableDuplicates,
      duplicate_locations: duplicateLocations.size,
      current: {
        count: selected.length,
        locations: currentLocations.size,
        shareable_bytes: currentShareableBytes
      },
      page,
      page_size: pageSize,
      start,
      end,
      total: selected.length,
      pages
    }
  })
}

const runVaultScript = async (dom) => {
  const publicRoot = path.resolve(__dirname, '..', 'server', 'public')
  const scripts = await Promise.all(['storage-size.js', 'vault.js']
    .map((file) => fs.promises.readFile(path.resolve(publicRoot, file), 'utf8')))
  const fetch = dom.window.fetch
  dom.window.fetch = async (...args) => {
    const response = await fetch(...args)
    if (!response || typeof response.json !== 'function') return response
    return Object.assign({}, response, {
      json: async () => statusFixture(await response.json(), args[0])
    })
  }
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

  test('scan requests accept only supported minimum file sizes', async () => {
    const { vault } = await makeEnv()
    let startedWith = null
    vault.startScan = (scopeId, sizeThreshold) => {
      startedWith = { scopeId, sizeThreshold }
      return { started: true }
    }

    const accepted = await vault.perform('scan', {
      candidate_size: CANDIDATE_SIZE_OPTIONS[0]
    })
    assert.deepStrictEqual(accepted, { started: true })
    assert.deepStrictEqual(startedWith, {
      scopeId: null,
      sizeThreshold: CANDIDATE_SIZE_OPTIONS[0]
    })

    startedWith = null
    const rejected = await vault.perform('scan', { candidate_size: 1 })
    assert.deepStrictEqual(rejected, { error: 'Choose a valid minimum file size.' })
    assert.strictEqual(startedWith, null)
  })

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
    const status = await vault.status(null, { view: 'activity' })
    const batch = status.items.find((item) => item.activity_type === 'batch')
    assert.deepStrictEqual(batch, {
      batch_id: 'batch-retained.bin',
      files: 1,
      bytes: 4096,
      ts: null,
      activity_type: 'batch'
    })

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

    const status = await vault.status(null, { view: 'activity' })
    const oldEvent = status.items.find((event) => event.kind === 'convert' && event.batch_id === 'batch-reconverted.bin')
    const newEvent = status.items.find((event) => event.kind === 'convert' && event.batch_id === 'batch-new')
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

  })

  test('deduplicate on a kept-separate file converts only that file', async () => {
    const { home, vault } = await makeEnv()
    const { content, hash, a, b } = await makeSharedPair(home, vault, 'one-file.bin')
    assert.strictEqual((await vault.detach(b)).status, 'detached')
    const other = await writeFile(path.resolve(home, 'api', 'appB', 'other.bin'), content)
    vault.registry.duplicates.set(other, {
      hash, size: content.length, app: 'appB', source_id: 'app:appB'
    })

    const result = await vault.perform('deduplicate', { path: b })

    assert.strictEqual(result.status, 'converted')
    assert.strictEqual(result.bytes_saved, content.length)
    assert.strictEqual(vault.registry.excluded.has(b), false)
    assert.strictEqual((await fs.promises.stat(b)).ino, (await fs.promises.stat(a)).ino)
    assert.strictEqual((await fs.promises.stat(other)).nlink, 1)
    assert.strictEqual(vault.registry.duplicates.has(other), true)
  })

  test('deduplicate on a kept-separate file never overwrites a writer replacement', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault, 'one-file-race.bin')
    assert.strictEqual((await vault.detach(b)).status, 'detached')
    const replacement = crypto.randomBytes(4096)
    const realHashFile = vault.hashFile.bind(vault)
    vault.hashFile = async (filePath) => {
      const result = await realHashFile(filePath)
      const writerPath = `${filePath}.writer-replacement`
      await fs.promises.writeFile(writerPath, replacement)
      await fs.promises.rename(writerPath, filePath)
      return result
    }

    let result
    try {
      result = await vault.perform('deduplicate', { path: b })
    } finally {
      vault.hashFile = realHashFile
    }

    assert.strictEqual(result.status, 'stale')
    assert.strictEqual(vault.registry.excluded.has(b), true)
    assert.deepStrictEqual(await fs.promises.readFile(b), replacement)
    assert.strictEqual((await fs.promises.stat(b)).nlink, 1)
  })

  test('deduplicate leaves a kept-separate file alone when no identical file remains', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault, 'one-file-no-match.bin')
    assert.strictEqual((await vault.detach(b)).status, 'detached')
    const replacement = crypto.randomBytes(4096)
    await fs.promises.writeFile(b, replacement)
    const before = await fs.promises.stat(b)

    const result = await vault.perform('deduplicate', { path: b })

    const after = await fs.promises.stat(b)
    assert.strictEqual(result.status, 'no-match')
    assert.strictEqual(vault.registry.excluded.has(b), true)
    assert.deepStrictEqual(await fs.promises.readFile(b), replacement)
    assert.strictEqual(after.ino, before.ino)
    assert.strictEqual(after.nlink, 1)
  })

  test('contextual Deduplicate all converts only duplicate descendants of the selected location', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const appBFile = await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), content)
    const appCFile = await writeFile(path.resolve(home, 'api', 'appC', 'model.bin'), content)
    const outsideFile = await writeFile(path.resolve(home, 'models', 'model.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    await vault.refreshSources()
    const sourceFor = (filePath) => vault.sourceForPath(filePath)
    for (const filePath of [appBFile, appCFile, outsideFile]) {
      const source = sourceFor(filePath)
      vault.registry.duplicates.set(filePath, await duplicateEntry(filePath, {
        hash, size: content.length, app: source.app || null, source_id: source.id
      }))
    }

    const result = await vault.perform('deduplicate', {
      selection: 'duplicates',
      scope_id: 'apps'
    })

    assert.strictEqual(result.converted, 2)
    assert.strictEqual(result.bytes_saved, content.length * 2)
    assert.strictEqual((await fs.promises.stat(appBFile)).ino, (await fs.promises.stat(original)).ino)
    assert.strictEqual((await fs.promises.stat(appCFile)).ino, (await fs.promises.stat(original)).ino)
    assert.strictEqual((await fs.promises.stat(outsideFile)).nlink, 1)
    assert.ok(vault.registry.duplicates.has(outsideFile))
    const events = (await vault.registry.readEvents())
      .filter((event) => event.kind === 'convert' && [appBFile, appCFile].includes(event.path))
    assert.strictEqual(new Set(events.map((event) => event.batch_id)).size, 1)

    const globalResult = await vault.perform('deduplicate', {
      selection: 'duplicates',
      scope_id: null
    })
    assert.strictEqual(globalResult.converted, 1)
    assert.strictEqual((await fs.promises.stat(outsideFile)).ino, (await fs.promises.stat(original)).ino)
  })

  test('contextual Deduplicate all rechecks kept-separate files and leaves other locations alone', async () => {
    const { home, vault } = await makeEnv()
    const { content, a, b } = await makeSharedPair(home, vault, 'kept-bulk.bin')
    assert.strictEqual((await vault.detach(b)).status, 'detached')
    const unmatched = await writeFile(path.resolve(home, 'api', 'appB', 'unmatched.bin'), crypto.randomBytes(4096))
    const otherLocation = await writeFile(path.resolve(home, 'api', 'appC', 'kept-bulk.bin'), content)
    await vault.refreshSources()
    const appB = vault.sourceForPath(b)
    const appC = vault.sourceForPath(otherLocation)
    vault.registry.exclude(unmatched, { ts: Date.now(), source_id: appB.id, size: content.length })
    vault.registry.exclude(otherLocation, { ts: Date.now(), source_id: appC.id, size: content.length })
    const unmatchedBefore = await fs.promises.stat(unmatched)

    const result = await vault.perform('deduplicate', {
      selection: 'kept-separate',
      scope_id: appB.id
    })

    assert.strictEqual(result.converted, 1)
    assert.strictEqual(result.unmatched, 1)
    assert.strictEqual((await fs.promises.stat(b)).ino, (await fs.promises.stat(a)).ino)
    assert.strictEqual((await fs.promises.stat(unmatched)).ino, unmatchedBefore.ino)
    assert.ok(vault.registry.excluded.has(unmatched))
    assert.ok(vault.registry.excluded.has(otherLocation))
    assert.strictEqual((await fs.promises.stat(otherLocation)).nlink, 1)
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

  test('make separate progress is exposed by backend status while the copy runs', async () => {
    const { home, vault } = await makeEnv()
    const { b } = await makeSharedPair(home, vault, 'separate-progress.bin')
    const copyOut = vault.copyOut.bind(vault)
    let reportStarted
    let releaseCopy
    const started = new Promise((resolve) => { reportStarted = resolve })
    const gate = new Promise((resolve) => { releaseCopy = resolve })
    vault.copyOut = async (...args) => {
      reportStarted()
      await gate
      return copyOut(...args)
    }

    const pending = vault.perform('detach', { path: b })
    await started
    const active = vault.progressStatus().file_action
    releaseCopy()
    assert.deepStrictEqual(active, {
      kind: 'make-separate',
      path: b
    })
    const result = await pending

    assert.strictEqual(result.status, 'detached')
    assert.strictEqual(vault.progressStatus().file_action, null)
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
    assert.strictEqual(status.bytes_on_disk, content.length * 2)
    assert.strictEqual(status.bytes_without_sharing, content.length * 2)
    assert.ok(status.last_scan && status.last_scan.files > 0)
    const independent = status.items.find((item) => item.status === 'independent')
    const tracked = status.items.find((item) => item.status === 'tracked')
    assert.strictEqual(status.inventory.counts.independent, 1)
    assert.strictEqual(independent.size, content.length)
    assert.ok(tracked.locations.some((item) => item.app === 'appA'))
    assert.ok(status.scan && status.scan.active === false)

    await fs.promises.rm(path.resolve(home, 'api', 'appB'), { recursive: true })
    await vault.refreshSources()
    const afterSourceRemoval = await vault.status(null, { view: 'independent' })
    assert.strictEqual(afterSourceRemoval.inventory.counts.independent, 1,
      'user-owned exclusions survive source removal')
    assert.strictEqual(afterSourceRemoval.items[0].size, content.length)
  })

  test('large dashboard inventories return exact counts with bounded server pages', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    await writeFile(path.resolve(home, 'api', 'appA', 'one.bin'), content)
    await writeFile(path.resolve(home, 'api', 'appB', 'two.bin'), content)
    await writeFile(path.resolve(home, 'api', 'appC', 'three.bin'), content)
    await vault.sweeper.scan()
    const baseline = await vault.status()

    const first = await vault.status(null, {
      view: 'duplicates',
      page: 0,
      page_size: 1
    })
    const second = await vault.status(null, {
      view: 'duplicates',
      page: 1,
      page_size: 1
    })
    const beyondLast = await vault.status(null, {
      view: 'duplicates',
      page: 999,
      page_size: 1
    })

    assert.strictEqual(first.inventory.counts.duplicates, 2)
    assert.strictEqual(first.inventory.total, 2)
    assert.strictEqual(first.inventory.pages, 2)
    assert.strictEqual(first.items.length, 1)
    assert.strictEqual(second.items.length, 1)
    assert.notStrictEqual(first.items[0].path, second.items[0].path)
    assert.strictEqual(beyondLast.inventory.page, 1)
    assert.strictEqual(beyondLast.items.length, 1)
    assert.strictEqual(beyondLast.items[0].path, second.items[0].path)
    assert.strictEqual(first.bytes_on_disk, baseline.bytes_on_disk)
    assert.strictEqual(first.bytes_without_sharing, baseline.bytes_without_sharing)
    assert.strictEqual(first.saved_by_sharing, baseline.saved_by_sharing)
    assert.strictEqual(first.pending_bytes, baseline.pending_bytes)
    assert.doesNotThrow(() => JSON.stringify(first))
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

  test('global storage metrics include scanned files below the candidate threshold', async () => {
    const { home, vault } = await makeEnv()
    const { content } = await makeSharedPair(home, vault)
    const small = crypto.randomBytes(512)
    await writeFile(path.resolve(home, 'api', 'appA', 'config.json'), small)
    await vault.sweeper.scan()

    const status = await vault.status()
    assert.strictEqual(status.last_scan.bytes_total, (content.length * 2) + small.length)
    assert.strictEqual(status.bytes_on_disk, content.length + small.length)
    assert.strictEqual(status.bytes_without_sharing, (content.length * 2) + small.length)
    assert.strictEqual(status.saved_by_sharing, content.length)
  })

  test('global storage metrics do not disappear when every scanned file is below the candidate threshold', async () => {
    const { home, vault } = await makeEnv()
    const first = crypto.randomBytes(511)
    const second = crypto.randomBytes(257)
    await writeFile(path.resolve(home, 'api', 'appA', 'config.json'), first)
    await writeFile(path.resolve(home, 'api', 'appB', 'notes.txt'), second)
    await vault.sweeper.scan()

    const status = await vault.status()
    const total = first.length + second.length
    assert.strictEqual(status.last_scan.bytes_total, total)
    assert.strictEqual(status.bytes_on_disk, total)
    assert.strictEqual(status.bytes_without_sharing, total)
    assert.strictEqual(status.saved_by_sharing, 0)
  })

  test('global storage metrics include below-threshold files from external locations', async (t) => {
    const { home, vault } = await makeEnv()
    const external = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-ui-size-external-'))
    homes.push(external)
    const local = crypto.randomBytes(401)
    const imported = crypto.randomBytes(607)
    await writeFile(path.resolve(home, 'api', 'appA', 'local.json'), local)
    await writeFile(path.resolve(external, 'external.json'), imported)
    try {
      await vault.addExternalSource(external)
    } catch (error) {
      t.skip(`directory links unavailable: ${error.message}`)
      return
    }
    await vault.sweeper.scan()

    const status = await vault.status()
    const total = local.length + imported.length
    assert.strictEqual(status.last_scan.home_bytes_total, local.length)
    assert.strictEqual(status.last_scan.bytes_total, total)
    assert.strictEqual(status.bytes_on_disk, total)
    assert.strictEqual(status.bytes_without_sharing, total)
    assert.strictEqual(status.saved_by_sharing, 0)
  })

  test('global storage metrics add unused managed files without double-counting scanned files', async () => {
    const { home, vault } = await makeEnv()
    const managed = crypto.randomBytes(4096)
    const small = crypto.randomBytes(379)
    const managedPath = await writeFile(path.resolve(home, 'api', 'appA', 'unused.bin'), managed)
    await vault.adopt(managedPath, sha256(managed), { app: 'appA' })
    await fs.promises.unlink(managedPath)
    await writeFile(path.resolve(home, 'api', 'appA', 'settings.json'), small)
    await vault.sweeper.scan()

    const status = await vault.status()
    assert.strictEqual(status.last_scan.bytes_total, small.length)
    assert.strictEqual(status.reclaimable, managed.length)
    assert.strictEqual(status.bytes_on_disk, managed.length + small.length)
    assert.strictEqual(status.bytes_without_sharing, managed.length + small.length)
    assert.strictEqual(status.saved_by_sharing, 0)
  })

  test('app status exposes only that app while retaining its matching locations', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const appAFile = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const appBFile = await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), content)
    await vault.sweeper.scan()
    const appB = vault.sources().find((source) => source.kind === 'app' && source.app === 'appB')

    const status = await vault.status(appB.id, { view: 'duplicates' })

    assert.strictEqual(status.scope_id, appB.id)
    assert.deepStrictEqual(status.sources.map((source) => source.id), [appB.id])
    assert.strictEqual(status.sources[0].parent_id, null)
    assert.deepStrictEqual(status.items.map((item) => item.path), [appBFile])
    assert.strictEqual(status.items[0].match.path, appAFile)
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
    const appAFile = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), shared)
    await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), shared)
    await writeFile(path.resolve(home, 'api', 'appC', 'model.bin'), shared)
    await writeFile(path.resolve(home, 'api', 'appA', 'config.bin'), small)
    await vault.sweeper.scan()
    const sources = Object.fromEntries(vault.sources()
      .filter((source) => source.kind === 'app')
      .map((source) => [source.app, source]))

    const appBResult = await vault.perform('deduplicate', { scope_id: sources.appB.id })
    const appCResult = await vault.perform('deduplicate', { scope_id: sources.appC.id })
    assert.strictEqual(appBResult.converted, 1)
    assert.strictEqual(appCResult.converted, 1)

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

    const status = await vault.status(null, { view: 'activity' })
    const conversion = status.items.find((event) => event.kind === 'convert')
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

    const status = await vault.status(null, { view: 'activity' })
    const event = status.items.find((item) => item.kind === 'found')
    assert.strictEqual(event.source_label, 'appA')
    assert.strictEqual(event.relative_path, 'models/m.bin')
  })

  test('activity exposes the complete retained bounded event window', async () => {
    const { vault } = await makeEnv()
    for (let index = 0; index < 110; index += 1) {
      await vault.registry.appendEvent({ kind: 'found', index })
    }

    const status = await vault.status(null, { view: 'activity' })
    assert.strictEqual(status.items.length, 110)
    assert.strictEqual(status.items[0].index, 109)
    assert.strictEqual(status.items[109].index, 0)
  })

  test('reclaimAll frees every orphan and nothing else', async () => {
    const { home, vault } = await makeEnv()
    const keep = crypto.randomBytes(4096)
    const drop = crypto.randomBytes(4096)
    vault.sizeThreshold = 1
    const keptFile = await writeFile(path.resolve(home, 'api', 'appA', 'keep.bin'), keep)
    const droppedFile = await writeFile(path.resolve(home, 'api', 'appA', 'drop.bin'), drop)
    await vault.adopt(keptFile, sha256(keep), { app: 'appA' })
    await vault.adopt(droppedFile, sha256(drop), { app: 'appA' })
    await fs.promises.unlink(droppedFile)
    await vault.rebuild()
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
    vault.sizeThreshold = 1
    const firstFile = await writeFile(path.resolve(home, 'api', 'appA', 'first.bin'), first)
    const secondFile = await writeFile(path.resolve(home, 'api', 'appA', 'second.bin'), second)
    await vault.adopt(firstFile, firstHash, { app: 'appA' })
    await vault.adopt(secondFile, secondHash, { app: 'appA' })
    await fs.promises.unlink(firstFile)
    await fs.promises.unlink(secondFile)
    await vault.rebuild()
    const realReclaim = vault.reclaim.bind(vault)
    let calls = 0
    let reclaimedHash
    let failedHash
    vault.reclaim = async (hash, ...args) => {
      calls += 1
      if (calls === 2) {
        failedHash = hash
        const error = new Error('transient unlink failure')
        error.code = 'EIO'
        throw error
      }
      reclaimedHash = hash
      return realReclaim(hash, ...args)
    }
    try {
      await assert.rejects(vault.reclaimAll(), (error) => error.code === 'EIO')
    } finally {
      vault.reclaim = realReclaim
    }

    assert.deepStrictEqual(new Set([reclaimedHash, failedHash]), new Set([firstHash, secondHash]))
    assert.strictEqual(fs.existsSync(vault.storePathFor(reclaimedHash)), false)
    assert.strictEqual(vault.registry.blobs.has(reclaimedHash), false)
    assert.strictEqual(fs.existsSync(vault.storePathFor(failedHash)), true)
    assert.strictEqual(vault.registry.blobs.has(failedHash), true)
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

  test('scan remains active while in-memory reconciliation runs without a second verify pass', async () => {
    const { vault } = await makeEnv()
    const realReconcile = vault.sweeper.reconcileScannedRecords.bind(vault.sweeper)
    let entered
    let release
    let verifyCalls = 0
    const reconcileEntered = new Promise((resolve) => { entered = resolve })
    const reconcileRelease = new Promise((resolve) => { release = resolve })
    vault.verify = async () => { verifyCalls += 1 }
    vault.sweeper.reconcileScannedRecords = async (...args) => {
      entered()
      await reconcileRelease
      return realReconcile(...args)
    }
    assert.strictEqual(vault.startScan().started, true)
    const scan = vault.scanPromise
    try {
      await reconcileEntered
      const status = vault.progressStatus().scan
      assert.strictEqual(status.active, true)
      assert.strictEqual(status.phase, 'reconciling')
    } finally {
      release()
      await scan
      vault.sweeper.reconcileScannedRecords = realReconcile
    }
    assert.strictEqual(verifyCalls, 0)
  })

  test('scan progress renders each phase with its real determinate state', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const workspace = await ejs.renderFile(
      path.resolve(views, 'partials', 'vault_workspace.ejs'),
      { appMode: false }
    )
    const baseStatus = {
      enabled: true,
      mode: 'link',
      last_scan: null,
      bytes_on_disk: 0,
      bytes_without_sharing: 0,
      saved_by_sharing: 0,
      lifetime_bytes_saved: 0,
      pending_bytes: 0,
      reclaimable: 0,
      file_action: null,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'pinokio', kind: 'pinokio', label: 'Pinokio', root: '/pinokio',
        display_path: '/pinokio', parent_id: null, available: true, shareable: true
      }],
      items: []
    }
    const cases = [
      {
        scan: {
          active: true, pending: false, phase: 'counting', scope_id: null,
          counted_dirs: 4, counted_files: 10, queued: 0
        },
        label: 'Counting files',
        value: null
      },
      {
        scan: {
          active: true, pending: false, phase: 'discovering', scope_id: null,
          dirs: 2, files: 2, total_files: 8, bytes_total: 2000, queued: 0
        },
        label: 'Scanning your configured locations',
        value: '25'
      },
      {
        scan: {
          active: true, pending: false, phase: 'analyzing', scope_id: null,
          dirs: 4, files: 8, total_files: 8, bytes_total: 8000,
          hash_total: 4, queued: 3,
          current_file: 'model.bin', current_file_bytes: 500, current_file_size: 1000
        },
        label: 'Analyzing files',
        value: '37.5'
      },
      {
        scan: {
          active: true, pending: false, phase: 'reconciling', scope_id: null,
          dirs: 4, files: 8, total_files: 8, bytes_total: 8000,
          hash_total: 4, queued: 0
        },
        label: 'Finishing scan',
        value: null
      }
    ]

    for (const item of cases) {
      const dom = new JSDOM(
        `<body data-platform="darwin" data-vault-mode="global">${workspace}</body>`,
        { url: 'http://localhost/vault', runScripts: 'dangerously' }
      )
      dom.window.fetch = async () => ({
        ok: true,
        json: async () => Object.assign({}, baseStatus, { scan: item.scan })
      })
      try {
        await runVaultScript(dom)
        await new Promise((resolve) => setTimeout(resolve, 25))

        const state = dom.window.document.getElementById('vault-scan-state')
        const track = state.querySelector('[role="progressbar"]')
        const percent = state.querySelector('.vault-scan-percent')
        assert.strictEqual(state.querySelector('strong').textContent, item.label)
        assert.strictEqual(track.getAttribute('aria-valuenow'), item.value)
        assert.strictEqual(percent.hidden, item.value === null)
        if (item.value !== null) {
          assert.strictEqual(percent.textContent, `${item.value}%`)
          assert.match(track.getAttribute('aria-valuetext'), new RegExp(`^${item.value} percent\\.`))
        }
        if (item.scan.phase === 'analyzing') {
          assert.match(state.querySelector('.vault-scan-detail').textContent,
            /analyzing model\.bin \(500 B of 1 KB\)/)
        }
      } finally {
        dom.window.close()
      }
    }
  })

  test('an older status response cannot replace newer scan progress', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const publicRoot = path.resolve(__dirname, '..', 'server', 'public')
    const workspace = await ejs.renderFile(
      path.resolve(views, 'partials', 'vault_workspace.ejs'),
      { appMode: false }
    )
    const baseStatus = {
      enabled: true,
      mode: 'link',
      last_scan: null,
      bytes_on_disk: 0,
      bytes_without_sharing: 0,
      saved_by_sharing: 0,
      lifetime_bytes_saved: 0,
      pending_bytes: 0,
      reclaimable: 0,
      file_action: null,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'pinokio', kind: 'pinokio', label: 'Pinokio', root: '/pinokio',
        display_path: '/pinokio', parent_id: null, available: true, shareable: true
      }],
      items: []
    }
    const scan = (queued, currentFile) => ({
      active: true, pending: false, phase: 'analyzing', scope_id: null,
      dirs: 4, files: 8, total_files: 8, bytes_total: 8000,
      hash_total: 937, queued, current_file: currentFile,
      current_file_bytes: 0, current_file_size: 1000,
      started: 123
    })
    const response = (data) => ({
      ok: true,
      json: async () => statusFixture(data, '/info/dedup')
    })
    let requestCount = 0
    let resolveOlder
    const olderResponse = new Promise((resolve) => { resolveOlder = resolve })
    const dom = new JSDOM(
      `<body data-platform="darwin" data-vault-mode="global">${workspace}</body>`,
      { url: 'http://localhost/vault', runScripts: 'dangerously' }
    )
    dom.window.fetch = async () => {
      requestCount += 1
      if (requestCount === 1) {
        return response(Object.assign({}, baseStatus, {
          scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null }
        }))
      }
      if (requestCount === 2) return olderResponse
      return response(Object.assign({}, baseStatus, { scan: scan(115, 'newer.bin') }))
    }
    try {
      const formatter = await fs.promises.readFile(path.resolve(publicRoot, 'storage-size.js'), 'utf8')
      const source = await fs.promises.readFile(path.resolve(publicRoot, 'vault.js'), 'utf8')
      dom.window.eval(formatter)
      dom.window.eval(source.replace(/\nrefresh\(\)\s*$/, '\nwindow.__testVaultRefresh = refresh\nrefresh()'))
      await new Promise((resolve) => setTimeout(resolve, 25))

      const olderRefresh = dom.window.__testVaultRefresh()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const newerRefresh = dom.window.__testVaultRefresh()
      await newerRefresh
      assert.strictEqual(dom.window.document.querySelector('.vault-scan-percent').textContent, '87.7%')
      assert.match(dom.window.document.querySelector('.vault-scan-detail').textContent, /822 of 937 files analyzed/)

      resolveOlder(response(Object.assign({}, baseStatus, { scan: scan(204, 'older.bin') })))
      await olderRefresh
      assert.strictEqual(dom.window.document.querySelector('.vault-scan-percent').textContent, '87.7%')
      assert.match(dom.window.document.querySelector('.vault-scan-detail').textContent, /822 of 937 files analyzed/)
      assert.doesNotMatch(dom.window.document.querySelector('.vault-scan-detail').textContent, /older\.bin/)
    } finally {
      dom.window.close()
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
    const small = crypto.randomBytes(383)
    const hash = sha256(content)
    const first = await writeFile(path.resolve(home, 'api', 'appA', 'm.bin'), content)
    const second = await writeFile(path.resolve(home, 'api', 'appB', 'm.bin'), content)
    await writeFile(path.resolve(home, 'api', 'appA', 'config.json'), small)
    const firstStat = await fs.promises.stat(first)
    const secondStat = await fs.promises.stat(second)
    vault.registry.addBlob(hash, { size: content.length })
    vault.registry.addLink(first, { hash, app: 'appA', dev: firstStat.dev, ino: firstStat.ino, mode: 'copy' })
    vault.registry.addLink(second, { hash, app: 'appB', dev: secondStat.dev, ino: secondStat.ino, mode: 'copy' })
    vault.registry.setLastScan({
      ts: Date.now(),
      files: 3,
      bytes_total: (content.length * 2) + small.length,
      home_bytes_total: (content.length * 2) + small.length
    })

    const status = await vault.status()
    assert.strictEqual(status.bytes_on_disk, (content.length * 2) + small.length)
    assert.strictEqual(status.bytes_without_sharing, (content.length * 2) + small.length)
    assert.strictEqual(status.saved_by_sharing, 0)
  })

  test('repair is advanced, metrics distinguish detected and explicit savings, and refresh retries', async () => {
    const vaultPage = await vaultPageSource()
    assert.match(vaultPage, /disk_space_saved:\s*"of disk space saved"/)
    assert.match(vaultPage, /before_help:\s*"Estimated size of every scanned location if each app stored its own copy\. File Explorer may count deduplicated files differently\."/)
    assert.match(vaultPage, /nothing_more_to_save:\s*"Nothing else to save"/)
    assert.match(vaultPage, /more_can_be_saved:\s*"\{size\} more can be saved"/)
    assert.match(vaultPage, /Number\(data\.saved_by_sharing\)/)
    assert.match(vaultPage, /Number\(data\.bytes_without_sharing\)/)
    assert.match(vaultPage, /Number\(data\.bytes_on_disk\)/)
    assert.match(vaultPage, /Number\(data\.pending_bytes\)/)
    assert.match(vaultPage, /id="btn-review-metric"/)
    assert.match(vaultPage, /\.vault-button\.primary \{[\s\S]*?background:\s*var\(--task-accent-contrast\)[\s\S]*?color:\s*#101828/)
    assert.match(vaultPage, /id="btn-review-result"/)
    assert.match(vaultPage, /class='vault-button' id='btn-scan'/)
    assert.match(vaultPage, /id='vault-candidate-size'/)
    assert.match(vaultPage, /candidate_size:\s*candidateSize\(\)/)
    assert.match(vaultPage, /localStorage\.setItem\(candidateSizeKey/)
    assert.match(vaultPage, /id='vault-storage-details'/)
    assert.match(vaultPage, /Number\(data\.lifetime_bytes_saved\)/)
    assert.match(vaultPage, /Math\.max\(0, sharedNow - freedBytes\)/)
    assert.match(vaultPage, /repair_index:\s*"Repair index"/)
    assert.match(vaultPage, /repair_required:\s*"The saved index could not be loaded\./)
    assert.match(vaultPage, /repair_progress:\s*"\{folders\} folders · \{files\} files · \{records\} records checked"/)
    assert.match(vaultPage, /post\(\{ action:\s*"repair" \}\)/)
    assert.match(vaultPage, /action:\s*"cancel_repair"/)
    assert.match(vaultPage, /data-cancel-repair/)
    assert.match(vaultPage, /state\.data\.repair = progress\.repair/)
    assert.match(vaultPage, /activeRepairAction\(progress\.repair\)/)
    assert.match(vaultPage, /activeScan \|\| repairing \|\| repairRequired/)
    assert.match(vaultPage, /data\.repair\.active \|\| data\.repair\.phase === "queued"/)
    assert.doesNotMatch(vaultPage, /deduplication records are being verified/)
    assert.match(vaultPage, /<details class='vault-advanced'/)
    assert.doesNotMatch(vaultPage, /id='btn-rebuild'/)
    const refreshBlock = vaultPage.match(/const refresh = async \(forceFull = false\) => \{[\s\S]*?\n\}/)
    assert.ok(refreshBlock)
    assert.match(refreshBlock[0], /finally/)
    assert.doesNotMatch(vaultPage, /priorScanning/)
    assert.match(vaultPage, /const deduplicateFeedback = \(result\) =>/)
    assert.match(vaultPage, /\(result\.locked \|\| 0\) \+ \(result\.incompatible \|\| 0\) \+ \(result\.unavailable \|\| 0\) \+ \(result\.failed \|\| 0\)/)
    assert.match(refreshBlock[0], /delay == null \? null : setTimeout/)
    assert.match(vaultPage, /if \(!response\.ok\)/)
    assert.match(vaultPage, /item\.unavailable_reason === "different_disk" \? COPY\.different_disk : COPY\.sharing_unavailable/)
    assert.match(vaultPage, /role='status' aria-live='polite'/)
    assert.doesNotMatch(vaultPage, /const activeItems =/)
    assert.doesNotMatch(vaultPage, /pagedInventory|pagedStatus|legacyStatus/)
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
    assert.doesNotMatch(vaultPage, /\.vault-sharing-switch/)
    assert.match(vaultPage, /\.vault-text-button:disabled \{[\s\S]*?cursor:\s*progress;[\s\S]*?opacity:\s*\.55;/)
    assert.match(vaultPage, /\.vault-status-cell > \.vault-text-button \{[\s\S]*?min-height:\s*24px;/)
    assert.match(vaultPage, /\.vault-status-cell > \.vault-text-button,[\s\S]*?\.vault-row-action \.vault-text-button \{[\s\S]*?border:\s*1px solid var\(--task-border\);[\s\S]*?border-radius:\s*5px;[\s\S]*?background:\s*color-mix/)
    assert.match(vaultPage, /\.vault-status-cell > \.vault-text-button:hover:not\(:disabled\),[\s\S]*?border-color:\s*var\(--task-border-strong\);/)
    assert.match(vaultPage, /body\.dark \.vault-status-cell > \.vault-text-button,[\s\S]*?border-color:\s*color-mix\(in srgb, var\(--task-text\) 24%, transparent\);[\s\S]*?background:\s*color-mix\(in srgb, var\(--task-text\) 7%, var\(--task-panel\)\);/)
    assert.match(vaultPage, /@media \(pointer: coarse\) \{[\s\S]*?\.vault-status-cell > \.vault-text-button,[\s\S]*?min-height:\s*44px;/)
    assert.match(vaultPage, /make_separate:\s*"Make separate"/)
    assert.doesNotMatch(vaultPage, /review_again:\s*"Review again"/)
    assert.match(vaultPage, /id='btn-add-source'/)
    assert.match(vaultPage, /<script src="\/Socket\.js"><\/script>/)
    assert.match(vaultPage, /action:\s*"add_source"/)
    assert.match(vaultPage, /action:\s*"remove_source"/)
    assert.match(vaultPage, /remove_external_folder:\s*"Remove from Locations"/)
    assert.match(vaultPage, /identical_contents_at:\s*"Identical contents at"/)
    assert.doesNotMatch(vaultPage, /Matching locations/)
    assert.match(vaultPage, /scan_waiting:\s*"Waiting for scan results"/)
    assert.match(vaultPage, /view === "all" && !activeScan \? `<button class="vault-button" type="button" id="btn-empty-scan"/)
    assert.match(vaultPage, /class="vault-progress-track"/)
    assert.match(vaultPage, /role="progressbar"/)
    assert.match(vaultPage, /id='vault-action-state' role='status' aria-live='polite'/)
    assert.match(vaultPage, /\.vault-action-state\.show,[\s\S]*?display:\s*flex/)
    assert.match(vaultPage, /pinokio:vault:reviewed-scan/)
    assert.match(vaultPage, /completed \|\| incomplete \|\| \(!state\.scanResult && unreviewed\)/)
    assert.match(vaultPage, /item\.activity_type === "batch"/)
    assert.match(vaultPage, /data-undo="\$\{attr\(item\.batch_id\)\}"/)
    assert.match(vaultPage, /data-undo="\$\{attr\(event\.batch_id\)\}"/)
    assert.match(vaultPage, /last_scan && data\.last_scan\.hash_failures/)
    assert.match(vaultPage, /scan_not_analyzed:\s*"could not be analyzed"/)
    assert.match(vaultPage, /\.vault-progress-bar\.determinate \{[\s\S]*?transform:\s*scaleX/)
    assert.match(vaultPage, /\.vault-progress-bar\.indeterminate \{[\s\S]*?animation:\s*vault-progress-discovery/)
    assert.match(vaultPage, /if \(!scanState\.querySelector\("\.vault-progress-track"\)\)/)
    assert.doesNotMatch(vaultPage, /scanState\.innerHTML = `<i[^\n]*\$\{progress\}/)
    assert.match(vaultPage, /body\.vault-page \.task-container \{[\s\S]*?overflow:\s*hidden/)
    assert.match(vaultPage, /\.vault-explorer \{[\s\S]*?flex:\s*1 1 auto[\s\S]*?overflow:\s*hidden/)
    assert.match(vaultPage, /\.vault-rail \{[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/)
    assert.match(vaultPage, /\.vault-pane \{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
    assert.doesNotMatch(vaultPage, /vault-pane-head/)
    assert.match(vaultPage, /const toolbarSummary = \(\) =>/)
    assert.match(vaultPage, /id="vault-toolbar-summary"/)
    assert.match(vaultPage, /\.vault-table-wrap \{[\s\S]*?overflow:\s*auto[\s\S]*?overscroll-behavior:\s*contain/)
    assert.match(vaultPage, /@media \(pointer:\s*coarse\) \{[\s\S]*?--vault-control-height:\s*44px/)
    assert.match(vaultPage, /aria-expanded=/)
    assert.match(vaultPage, /#vault-locations \{[\s\S]*?flex-direction:\s*column[\s\S]*?justify-content:\s*flex-start[\s\S]*?gap:\s*0/)
    assert.match(vaultPage, /\.vault-rail-section \{[\s\S]*?padding:\s*12px 0/)
    assert.match(vaultPage, /\.vault-nav-row \{[\s\S]*?border-radius:\s*0/)
    assert.match(vaultPage, /\.vault-source-line\.selected \{ background:\s*var\(--vault-selected\); \}/)
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
    const vaultStyles = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'public', 'vault.css'), 'utf8')
    assert.match(vaultStyles, /\.vault-embed-main \.vault-shell \{[\s\S]*?height:\s*100%;[\s\S]*?\}/)
    const compactStart = vaultStyles.indexOf('@media (max-width: 820px)')
    const compactEnd = vaultStyles.indexOf('@media (pointer: coarse)', compactStart)
    assert.ok(compactStart >= 0 && compactEnd > compactStart)
    const compactStyles = vaultStyles.slice(compactStart, compactEnd)
    assert.match(compactStyles, /\.vault-embed-main \{ overflow-y: auto; \}/)
    assert.match(compactStyles, /\.vault-embed-main \.vault-shell \{ height: auto; \}/)
    const vaultScript = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
    assert.match(vaultScript, /el\("vault-explorer"\)\.style\.display = ""/)

    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    assert.match(html, /data-vault-mode="app"/)
    assert.match(html, /data-vault-scope="app:appB"/)
    assert.match(html, /data-platform="darwin"/)
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
    assert.match(infoRoute, /vault\.status\(scopeId,\s*\{/)
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
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
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
          items: []
        })
      }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.deepStrictEqual(requests, [
      '/info/dedup?scope_id=app%3AappB&view=all&location_id=app%3AappB&page=0&page_size=500'
    ])
    assert.match(dom.window.document.getElementById('btn-scan').textContent, /Scan this app/)
    const candidateSize = dom.window.document.getElementById('vault-candidate-size')
    assert.deepStrictEqual([...candidateSize.options].map((option) => option.textContent),
      ['All files', '1 MB+', '10 MB+', '50 MB+', '100 MB+', '500 MB+', '1 GB+'])
    assert.strictEqual(candidateSize.value, '100000000')
    candidateSize.value = '0'
    candidateSize.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    assert.strictEqual(dom.window.localStorage.getItem('pinokio:vault:candidate-size'), '0')
    assert.match(dom.window.document.getElementById('vault-pane-footer').textContent,
      /All non-empty files appear here/)
    candidateSize.value = '50000000'
    candidateSize.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    assert.strictEqual(dom.window.localStorage.getItem('pinokio:vault:candidate-size'), '50000000')
    assert.match(dom.window.document.getElementById('vault-pane-footer').textContent,
      /Only files 50 MB and larger/)
    assert.strictEqual(dom.window.document.querySelector('[data-source="app:appB"]').getAttribute('aria-current'), 'page')
    assert.strictEqual(dom.window.document.getElementById('btn-add-source'), null)
    assert.strictEqual(dom.window.document.getElementById('btn-repair'), null)
    dom.window.close()
  })

  test('app Save space header shows proportional effective disk usage', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
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
        items: []
      })
    })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.strictEqual(dom.window.document.querySelector('.vault-summary-value').textContent, '4.51 GB saved for this app')
    assert.deepStrictEqual(
      [...dom.window.document.querySelectorAll('.vault-compare-label')].map((node) => node.firstChild.textContent.trim()),
      ['Before', 'After']
    )
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-compare-value')].map((node) => node.textContent), ['7.09 GB', '2.58 GB'])
    assert.match(dom.window.document.querySelector('.vault-compare-fill.after').getAttribute('style'), /--vault-after-ratio:36\.36%/)
    assert.strictEqual(dom.window.document.getElementById('vault-after-help').textContent,
      'For deduplicated files, disk usage is divided evenly among every location using them.')
    const styles = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.css'), 'utf8')
    const tooltip = styles.match(/\.vault-compare-tooltip \{[\s\S]*?\n\}/)
    assert.ok(tooltip)
    assert.match(tooltip[0], /left:\s*0;/)
    assert.match(tooltip[0], /width:\s*min\(220px, calc\(100vw - var\(--vault-inline\) - var\(--vault-inline\)\)\);/)
    assert.match(tooltip[0], /transform:\s*translateY\(-2px\);/)
    assert.doesNotMatch(tooltip[0], /translateX/)
    assert.match(dom.window.document.querySelector('.vault-summary-side').textContent, /Nothing else to save/)
    dom.window.close()
  })

  test('file sizes follow the host file explorer convention', async () => {
    const dom = new JSDOM('<body data-platform="darwin"></body>', { runScripts: 'dangerously' })
    const formatter = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'public', 'storage-size.js'), 'utf8')
    dom.window.eval(formatter)
    const screenshotFolderBytes = 2_002_022_055_452
    assert.strictEqual(dom.window.PinokioFormatStorageSize(7.05e9), '7.05 GB')
    assert.strictEqual(dom.window.PinokioFormatStorageSize(5.3e9), '5.3 GB')
    assert.strictEqual(dom.window.PinokioFormatStorageSize(1024 ** 3), '1.07 GB')
    assert.strictEqual(dom.window.PinokioFormatStorageSize(screenshotFolderBytes), '2 TB')
    dom.window.document.body.dataset.platform = 'win32'
    assert.strictEqual(dom.window.PinokioFormatStorageSize(1024 ** 3), '1 GB')
    assert.strictEqual(dom.window.PinokioFormatStorageSize(screenshotFolderBytes), '1.82 TB')

    const appView = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'views', 'app.ejs'), 'utf8')
    assert.match(appView, /<script src="\/storage-size\.js"><\/script>/)
    assert.match(appView, /PinokioFormatStorageSize\(res\.du\)/)
    const vaultView = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'views', 'vault.ejs'), 'utf8')
    const vaultAppView = await fs.promises.readFile(
      path.resolve(__dirname, '..', 'server', 'views', 'vault_app.ejs'), 'utf8')
    assert.match(vaultView, /data-platform="<%=platform%>"/)
    assert.match(vaultAppView, /data-platform="<%=platform%>"/)
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
        items: [{ hash: 'c'.repeat(64), size: 2048, orphan: true, nlink: 1, names: [] }]
      })
    })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.strictEqual(dom.window.document.querySelector('.vault-summary-value').textContent, '256.95 GB of disk space saved')
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-compare-label')].map((node) => node.firstChild.textContent.trim()), ['Before', 'After'])
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-compare-value')].map((node) => node.textContent), ['661.75 GB', '404.8 GB'])
    assert.match(dom.window.document.querySelector('.vault-compare-fill.after').getAttribute('style'), /--vault-after-ratio:61\.17%/)
    assert.strictEqual(dom.window.document.getElementById('vault-before-help').textContent,
      'Estimated size of every scanned location if each app stored its own copy. File Explorer may count deduplicated files differently.')
    assert.strictEqual(dom.window.document.querySelector('.vault-compare-info').getAttribute('tabindex'), '0')
    assert.match(dom.window.document.querySelector('.vault-summary-side').textContent, /13\.31 GB more can be saved/)
    assert.strictEqual(dom.window.document.getElementById('btn-review-metric').textContent, 'Review files')
    assert.strictEqual(dom.window.document.getElementById('btn-review-metric').classList.contains('primary'), true)
    assert.strictEqual(dom.window.document.getElementById('btn-scan').classList.contains('primary'), false)
    assert.match(dom.window.document.getElementById('vault-storage-details').textContent, /Pinokio folder\s*166\.22 GB/)
    assert.match(dom.window.document.getElementById('vault-storage-details').textContent, /Kept deduplicated\s*256\.95 GB/)
    // lifetime (241) exceeds live sharing (239.3) here, so the clamp keeps
    // the pre-existing figure at zero instead of going negative.
    assert.match(dom.window.document.getElementById('vault-storage-details').textContent, /Already shared before Save space\s*0 B/)
    const cleanupNotice = dom.window.document.getElementById('vault-cleanup-notice')
    assert.strictEqual(cleanupNotice.classList.contains('show'), true)
    assert.match(cleanupNotice.textContent, /ready to clean up/)
    assert.match(cleanupNotice.textContent, /1 private link left/)
    dom.window.document.getElementById('btn-review-cleanup').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(dom.window.document.querySelector('[data-view="reclaimable"]').classList.contains('selected'), true)
    assert.strictEqual(cleanupNotice.classList.contains('show'), false)
    dom.window.document.querySelector('[data-view="all"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const viewDescriptions = {
      all: 'Every scanned file and its current deduplication status.',
      duplicates: 'Identical files waiting to be deduplicated or kept separate.',
      shared: 'Files that share disk storage across multiple locations.',
      tracked: 'Files with no duplicate action required.',
      independent: 'Duplicate files that remain as separate copies.',
      reclaimable: 'Private links no longer used by any linked file.',
      activity: 'A history of scans and changes made by Save space.'
    }
    for (const [view, description] of Object.entries(viewDescriptions)) {
      dom.window.document.querySelector(`[data-view="${view}"]`).click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      const explanation = dom.window.document.querySelector('.vault-toolbar-description')
      assert.strictEqual(explanation.textContent, description)
      assert.strictEqual(explanation.parentElement.id, 'vault-toolbar')
    }
    dom.window.document.querySelector('[data-view="all"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const allDescription = dom.window.document.querySelector('.vault-toolbar-description')
    assert.strictEqual(allDescription.previousElementSibling.classList.contains('vault-display-mode'), true)
    assert.strictEqual(allDescription.nextElementSibling.id, 'vault-toolbar-summary')
    const unusedView = dom.window.document.querySelector('[data-view="reclaimable"]')
    assert.strictEqual(unusedView.querySelector('.vault-nav-name').textContent, 'Unused files')
    unusedView.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(dom.window.document.getElementById('btn-reclaim-all').textContent, 'Clean up all')
    assert.strictEqual(dom.window.document.querySelector('[data-reclaim]').textContent, 'Clean up')
    assert.match(dom.window.document.getElementById('vault-pane-footer').textContent,
      /Cleaning them up frees disk space/)
    dom.window.close()
  })

  test('global savings remain visible when scan metadata is missing', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const workspace = await ejs.renderFile(path.resolve(views, 'partials', 'vault_workspace.ejs'), { appMode: false })
    const dom = new JSDOM(`<body data-platform="darwin" data-vault-mode="global">${workspace}</body>`, {
      url: 'http://localhost/vault', runScripts: 'dangerously'
    })
    dom.window.fetch = async () => ({
      ok: true,
      json: async () => ({
        enabled: true,
        mode: 'link',
        scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
        last_scan: null,
        bytes_on_disk: 7e9,
        bytes_without_sharing: 10e9,
        saved_by_sharing: 3e9,
        lifetime_bytes_saved: 3e9,
        pending_bytes: 1e9,
        reclaimable: 0,
        file_action: null,
        activity_error: null,
        cloud_sync_warning: null,
        sources: [{
          id: 'pinokio', kind: 'pinokio', label: 'Pinokio', root: '/pinokio',
          display_path: '/pinokio', parent_id: null, available: true, shareable: true
        }],
        items: []
      })
    })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.strictEqual(dom.window.document.querySelector('.vault-summary-value').textContent,
      '3 GB of disk space saved')
    assert.deepStrictEqual(
      [...dom.window.document.querySelectorAll('.vault-compare-value')].map((node) => node.textContent),
      ['10 GB', '7 GB'])
    assert.match(dom.window.document.querySelector('.vault-summary-side').textContent,
      /1 GB more can be saved.*Not scanned yet/)
    assert.strictEqual(dom.window.document.getElementById('vault-cleanup-notice').classList.contains('show'), false)
    dom.window.close()
  })

  test('separate explains each safe refusal instead of showing a generic failure', async () => {
    const source = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
    assert.match(source, /const detachFeedback = \(result\) =>/)
    assert.match(source, /locked:\s*COPY\.separate_locked/)
    assert.match(source, /stale:\s*COPY\.separate_changed/)
    assert.match(source, /conflict:\s*COPY\.separate_conflict/)
    assert.match(source, /"not-found":\s*COPY\.separate_not_found/)
    assert.match(source, /runAction\(\{ action: "detach", path: filePath \}, detachFeedback\)/)
  })

  test('inventory puts explicit sharing actions in the status column', async () => {
    const source = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'public', 'vault.js'), 'utf8')
    assert.match(source, /all:\s*"All files"/)
    assert.match(source, /tracked:\s*"No action needed"/)
    assert.match(source, /fa-regular fa-circle-check/)
    assert.doesNotMatch(source, /"All tracked files"|"Search tracked files"|"Nothing tracked yet"|"View all tracked files"/)
    assert.match(source, /const duplicateAction = \(item\) => \{[\s\S]*?COPY\.keep_separate/)
    assert.match(source, /item\.status === "shared"[\s\S]*?COPY\.make_separate[\s\S]*?data-detach[\s\S]*?data-detach-kind="make"[\s\S]*?COPY\.make_separate/)
    assert.match(source, /item\.status === "independent"[\s\S]*?COPY\.deduplicate[\s\S]*?data-deduplicate-file[\s\S]*?COPY\.deduplicate/)
    assert.doesNotMatch(source, /data-reshare|COPY\.review_again/)
    assert.doesNotMatch(source, /role="switch"/)
    assert.match(source, /class="vault-status-cell"/)
    assert.doesNotMatch(source, /separate:\s*"Separate"/)
    assert.doesNotMatch(source, /include_in_scans:\s*"Include in scans"/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.status\]/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.matches, COPY\.can_save, ""\]/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.can_free, ""\]/)
    assert.match(source, /headers = \[COPY\.name, COPY\.size, COPY\.last_scanned, ""\]/)
    assert.match(source, /reclaimable:\s*"Unused files"/)
    assert.match(source, /reclaim:\s*"Clean up"/)
    assert.match(source, /reclaim_all:\s*"Clean up all"/)
    assert.match(source, /data-sort-size/)
    assert.match(source, /data-display-mode="folders"/)
    assert.match(source, /data-display-mode="files"/)
    assert.match(source, /headers = \[COPY\.name, COPY\.location_column, COPY\.size, COPY\.status\]/)
    assert.match(source, /aria-sort="\$\{state\.sizeSort === "desc" \? "descending" : state\.sizeSort === "asc" \? "ascending" : "none"\}"/)
  })

  test('Deduplicate shows determinate progress in the dedicated operation strip', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 2048 },
      tracked_bytes: 2048,
      effective_bytes: 2048,
      shared_bytes: 0,
      pending_bytes: 2048,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      items: [
        {
          path: '/pinokio/api/appB/one.bin', relative_path: 'one.bin',
          source_id: 'app:appB', source_label: 'appB', size: 1024,
          status: 'duplicate', shareable: true,
          match: { path: '/pinokio/api/appA/one.bin' }
        },
        {
          path: '/pinokio/api/appB/two.bin', relative_path: 'two.bin',
          source_id: 'app:appB', source_label: 'appB', size: 1024,
          status: 'duplicate', shareable: true,
          match: { path: '/pinokio/api/appA/two.bin' }
        }
      ]
    }
    let finishAction
    let holdProgress = false
    let releaseLateProgress
    const actionResponse = new Promise((resolve) => {
      finishAction = () => resolve({
        ok: true,
        json: async () => ({ converted: 2, bytes_saved: 2048 })
      })
    })
    dom.window.fetch = async (url, options = {}) => {
      if (options.method === 'POST') return actionResponse
      if (String(url).includes('progress=1')) {
        if (holdProgress) {
          return {
            ok: true,
            json: () => new Promise((resolve) => {
              releaseLateProgress = () => resolve({
                enabled: true,
                scan: status.scan,
                last_scan: status.last_scan,
                file_action: {
                  kind: 'deduplicate', scope_id: 'app:appB', selection: 'duplicates',
                  files_total: 2, files_completed: 1
                }
              })
            })
          }
        }
        return {
          ok: true,
          json: async () => ({
            enabled: true,
            scan: status.scan,
            last_scan: status.last_scan,
            file_action: {
              kind: 'deduplicate', scope_id: 'app:appB', selection: 'duplicates',
              files_total: 2, files_completed: 1
            }
          })
        }
      }
      return { ok: true, json: async () => status }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    try {
      dom.window.document.querySelector('[data-deduplicate-scope="app:appB"]').click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      const running = [...dom.window.document.querySelectorAll('[data-deduplicate-scope="app:appB"]')]
      assert.strictEqual(running.length, 1)
      for (const button of running) {
        assert.strictEqual(button.disabled, true)
        assert.strictEqual(button.getAttribute('aria-busy'), 'true')
        assert.strictEqual(button.querySelector('[role="progressbar"]'), null)
        assert.strictEqual(button.textContent, 'Deduplicate 2 files')
      }
      const operation = dom.window.document.getElementById('vault-action-state')
      assert.strictEqual(operation.classList.contains('show'), true)
      assert.strictEqual(operation.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '1')
      assert.strictEqual(operation.textContent, 'Deduplicating files1 of 2 files')
      const progressBar = operation.querySelector('[role="progressbar"]')
      dom.window.document.getElementById('vault-search').dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      assert.strictEqual(operation.querySelector('[role="progressbar"]'), progressBar)

      holdProgress = true
      await new Promise((resolve) => setTimeout(resolve, 275))
      assert.ok(releaseLateProgress)
      finishAction()
      await new Promise((resolve) => setTimeout(resolve, 25))
      const finished = [...dom.window.document.querySelectorAll('[data-deduplicate-scope="app:appB"]')]
      assert.strictEqual(finished.length, 1)
      assert.ok(finished.every((button) => !button.disabled && button.textContent === 'Deduplicate 2 files'))
      assert.strictEqual(operation.classList.contains('show'), false)
      assert.strictEqual(operation.innerHTML, '')
      releaseLateProgress()
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.ok(finished.every((button) => !button.disabled))
      assert.strictEqual(operation.classList.contains('show'), false)
    } finally {
      finishAction()
      if (releaseLateProgress) releaseLateProgress()
      await new Promise((resolve) => setTimeout(resolve, 25))
      dom.window.close()
    }
  })

  test('a running file action is restored after reloading the page', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
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
          last_scan: { ts: Date.now(), bytes_total: 2048 },
          tracked_bytes: 2048,
          effective_bytes: 2048,
          shared_bytes: 0,
          pending_bytes: 2048,
          file_action: {
            kind: 'deduplicate',
            scope_id: 'app:appB',
            selection: 'duplicates',
            files_total: 2,
            files_completed: 1
          },
          activity_error: null,
          cloud_sync_warning: null,
          sources: [{
            id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
            display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
          }],
          items: []
        })
      }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const operation = dom.window.document.getElementById('vault-action-state')
    assert.strictEqual(requests[0],
      '/info/dedup?scope_id=app%3AappB&view=all&location_id=app%3AappB&page=0&page_size=500')
    assert.strictEqual(operation.classList.contains('show'), true)
    assert.strictEqual(operation.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '1')
    assert.strictEqual(operation.textContent, 'Deduplicating files1 of 2 files')
    assert.notStrictEqual(dom.window.__vaultRefresh, null)
    dom.window.close()
  })

  test('Deduplicate all is contextual to Duplicates and Kept separate and reuses determinate progress', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const actions = []
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 4096 },
      tracked_bytes: 4096,
      effective_bytes: 4096,
      shared_bytes: 0,
      pending_bytes: 2048,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      items: [
        ...['one.bin', 'two.bin'].map((name) => ({
        path: `/pinokio/api/appB/${name}`, relative_path: name,
        source_id: 'app:appB', source_label: 'appB', size: 1024,
        status: 'duplicate', shareable: true,
        match: { path: `/pinokio/api/appA/${name}` }
        })),
        ...['kept-one.bin', 'kept-two.bin'].map((name) => ({
          path: `/pinokio/api/appB/${name}`, relative_path: name,
          source_id: 'app:appB', source_label: 'appB', size: 1024,
          status: 'independent'
        }))
      ]
    }
    let finishKept
    const keptResponse = new Promise((resolve) => {
      finishKept = () => resolve({
        ok: true,
        json: async () => ({ converted: 2, bytes_saved: 2048, unmatched: 0 })
      })
    })
    dom.window.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        const action = JSON.parse(options.body)
        actions.push(action)
        if (action.selection === 'kept-separate') return keptResponse
        return { ok: true, json: async () => ({ converted: 2, bytes_saved: 2048 }) }
      }
      if (String(url).includes('progress=1')) {
        return {
          ok: true,
          json: async () => ({
            enabled: true,
            scan: status.scan,
            last_scan: status.last_scan,
            file_action: {
              kind: 'deduplicate', scope_id: 'app:appB',
              selection: actions.length ? actions[actions.length - 1].selection : 'duplicates',
              files_total: 2, files_completed: 1
            }
          })
        }
      }
      return { ok: true, json: async () => status }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    try {
      assert.strictEqual(dom.window.document.querySelector('[data-deduplicate-all]'), null)
      assert.strictEqual(dom.window.document.getElementById('btn-review-metric').classList.contains('primary'), true)
      dom.window.document.querySelector('[data-view="duplicates"]').click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      let bulk = dom.window.document.querySelector('[data-deduplicate-all="duplicates"]')
      assert.strictEqual(bulk.textContent, 'Deduplicate 2 files')
      assert.strictEqual(bulk.classList.contains('primary'), true)
      assert.strictEqual(bulk.dataset.deduplicateContext, 'app:appB')
      assert.strictEqual(bulk.getAttribute('aria-label'), 'Deduplicate 2 files')
      assert.strictEqual(dom.window.document.getElementById('btn-review-metric'), null)
      const search = dom.window.document.getElementById('vault-search')
      search.value = 'one.bin'
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      assert.strictEqual(bulk.getAttribute('aria-label'), 'Deduplicate 2 files',
        'search never silently narrows the bulk action')
      bulk.click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.deepStrictEqual(actions[0], {
        action: 'deduplicate',
        selection: 'duplicates',
        scope_id: 'app:appB'
      })

      dom.window.document.querySelector('[data-view="shared"]').click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.strictEqual(dom.window.document.querySelector('[data-deduplicate-all]'), null)
      assert.strictEqual(dom.window.document.getElementById('btn-review-metric').classList.contains('primary'), true)
      dom.window.document.querySelector('[data-view="independent"]').click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      bulk = dom.window.document.querySelector('[data-deduplicate-all="kept-separate"]')
      assert.strictEqual(bulk.textContent, 'Deduplicate 2 files')
      assert.strictEqual(bulk.getAttribute('aria-label'), 'Deduplicate 2 files')
      assert.strictEqual(bulk.classList.contains('primary'), true)
      assert.strictEqual(dom.window.document.getElementById('btn-review-metric').classList.contains('primary'), false)
      bulk.click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      const operation = dom.window.document.getElementById('vault-action-state')
      assert.strictEqual(bulk.disabled, true)
      assert.strictEqual(bulk.getAttribute('aria-busy'), 'true')
      assert.strictEqual(operation.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '1')
      assert.strictEqual(operation.textContent, 'Deduplicating files1 of 2 files')
      assert.deepStrictEqual(actions[1], {
        action: 'deduplicate',
        selection: 'kept-separate',
        scope_id: 'app:appB'
      })
      finishKept()
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.strictEqual(operation.classList.contains('show'), false)
    } finally {
      finishKept()
      await new Promise((resolve) => setTimeout(resolve, 25))
      dom.window.close()
    }
  })

  test('No action needed is a counted, filtered, paginated file view', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, {
      url: 'http://localhost/vault/app/appB',
      runScripts: 'dangerously'
    })
    const trackedItems = Array.from({ length: 501 }, (_, index) => {
      const name = `tracked-${String(index).padStart(4, '0')}.bin`
      const location = {
        path: `/pinokio/api/appB/${name}`,
        relative_path: name,
        source_id: 'app:appB',
        source_label: 'appB',
        mode: 'link'
      }
      return {
        path: location.path,
        relative_path: name,
        source_id: 'app:appB',
        source_label: 'appB',
        size: 1024 + index,
        status: 'tracked',
        locations: [location]
      }
    })
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 1024 * 502 },
      tracked_bytes: 1024 * 502,
      effective_bytes: 1024 * 502,
      shared_bytes: 0,
      pending_bytes: 1024,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      items: [...trackedItems, {
        path: '/pinokio/api/appB/duplicate.bin',
        relative_path: 'duplicate.bin',
        source_id: 'app:appB',
        source_label: 'appB',
        size: 1024,
        status: 'duplicate',
        shareable: true,
        match: { path: '/pinokio/api/appA/duplicate.bin' }
      }]
    }
    dom.window.fetch = async () => ({ ok: true, json: async () => status })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const trackedView = dom.window.document.querySelector('[data-view="tracked"]')
    assert.strictEqual(trackedView.querySelector('.vault-nav-name').textContent, 'No action needed')
    assert.strictEqual(trackedView.querySelector('.vault-nav-count').textContent, '501')
    trackedView.click()
    await new Promise((resolve) => setTimeout(resolve, 25))

    const rows = () => [...dom.window.document.querySelectorAll('.vault-table .vault-file-row')]
    assert.strictEqual(rows().length, 500)
    assert.strictEqual(dom.window.document.getElementById('vault-search').placeholder,
      'Search files with no action needed')
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent, '1–500 of 501')
    assert.doesNotMatch(dom.window.document.getElementById('vault-table-wrap').textContent, /duplicate\.bin/)

    dom.window.document.querySelector('[data-page="next"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(rows().length, 1)
    assert.strictEqual(rows()[0].querySelector('.vault-file-name').textContent, 'tracked-0500.bin')
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent, '501–501 of 501')
    dom.window.close()
  })

  test('Activity is paginated without repeating a batch undo action', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, {
      url: 'http://localhost/vault/app/appB',
      runScripts: 'dangerously'
    })
    const events = Array.from({ length: 501 }, (_, index) => ({
      kind: 'convert',
      path: `/pinokio/api/appB/event-${String(index).padStart(4, '0')}.bin`,
      relative_path: `event-${String(index).padStart(4, '0')}.bin`,
      source_id: 'app:appB',
      source_label: 'appB',
      batch_id: 'batch-large',
      undoable: index !== 0,
      bytes_saved: 1024 + index,
      ts: Date.now() - index
    }))
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 1024 * 501 },
      tracked_bytes: 0,
      effective_bytes: 0,
      shared_bytes: 0,
      pending_bytes: 0,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      items: events.map((event, index) => Object.assign({}, event, {
        activity_type: 'event',
        show_undo: index === 1
      })).concat({
        batch_id: 'batch-compacted',
        files: 2,
        bytes: 4096,
        ts: events[events.length - 1].ts - 1,
        source_ids: ['app:appB'],
        activity_type: 'batch'
      })
    }
    dom.window.fetch = async () => ({ ok: true, json: async () => status })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const activityView = dom.window.document.querySelector('[data-view="activity"]')
    assert.strictEqual(activityView.querySelector('.vault-nav-count').textContent, '502')
    activityView.click()
    await new Promise((resolve) => setTimeout(resolve, 25))

    const rows = () => [...dom.window.document.querySelectorAll('.vault-table.activity .vault-file-row')]
    assert.strictEqual(rows().length, 500)
    assert.strictEqual(dom.window.document.querySelectorAll('[data-undo="batch-large"]').length, 1)
    assert.strictEqual(dom.window.document.querySelectorAll('[data-undo="batch-compacted"]').length, 0)
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent, '1–500 of 502')

    dom.window.document.querySelector('[data-page="next"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(rows().length, 2)
    assert.strictEqual(dom.window.document.querySelectorAll('[data-undo="batch-large"]').length, 0)
    assert.strictEqual(dom.window.document.querySelectorAll('[data-undo="batch-compacted"]').length, 1)
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent, '501–502 of 502')
    dom.window.close()
  })

  test('large file lists render bounded pages without narrowing Deduplicate all', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, {
      url: 'http://localhost/vault/app/appB',
      runScripts: 'dangerously'
    })
    const actions = []
    const duplicates = Array.from({ length: 501 }, (_, index) => {
      const name = `file-${String(index).padStart(4, '0')}.bin`
      return {
        path: `/pinokio/api/appB/${name}`,
        relative_path: name,
        source_id: 'app:appB',
        source_label: 'appB',
        size: 1024 + index,
        shareable: true,
        match: { path: `/pinokio/api/appA/${name}` }
      }
    })
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 1024 * 501 },
      tracked_bytes: 1024 * 501,
      effective_bytes: 1024 * 501,
      shared_bytes: 0,
      pending_bytes: duplicates.reduce((sum, item) => sum + item.size, 0),
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
        display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
      }],
      items: duplicates.map((item) => Object.assign({ status: 'duplicate' }, item))
    }
    dom.window.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        actions.push(JSON.parse(options.body))
        return { ok: true, json: async () => ({ converted: 501, bytes_saved: status.pending_bytes }) }
      }
      return { ok: true, json: async () => status }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    dom.window.document.querySelector('[data-view="duplicates"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const rows = () => [...dom.window.document.querySelectorAll('.vault-table.matches .vault-file-row')]
    let bulk = dom.window.document.querySelector('[data-deduplicate-all="duplicates"]')
    assert.strictEqual(rows().length, 500)
    assert.strictEqual(bulk.textContent, 'Deduplicate 501 files')
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent, '1–500 of 501')
    assert.strictEqual(dom.window.document.querySelector('[data-page="previous"]').disabled, true)
    assert.strictEqual(dom.window.document.querySelector('[data-page="next"]').disabled, false)

    dom.window.document.querySelector('[data-page="next"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(rows().length, 1)
    assert.strictEqual(rows()[0].querySelector('.vault-file-name').textContent, 'file-0500.bin')
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent, '501–501 of 501')
    assert.strictEqual(dom.window.document.querySelector('[data-page="previous"]').disabled, false)
    assert.strictEqual(dom.window.document.querySelector('[data-page="next"]').disabled, true)

    bulk = dom.window.document.querySelector('[data-deduplicate-all="duplicates"]')
    assert.strictEqual(bulk.textContent, 'Deduplicate 501 files')
    bulk.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepStrictEqual(actions[0], {
      action: 'deduplicate',
      selection: 'duplicates',
      scope_id: 'app:appB'
    })

    const search = dom.window.document.getElementById('vault-search')
    search.value = 'file-0001.bin'
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.strictEqual(rows().length, 1)
    assert.strictEqual(rows()[0].querySelector('.vault-file-name').textContent, 'file-0001.bin')
    assert.strictEqual(dom.window.document.querySelector('.vault-pagination'), null)
    dom.window.close()
  })

  test('server-paged inventories fetch only the selected dashboard page', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, {
      url: 'http://localhost/vault/app/appB',
      runScripts: 'dangerously'
    })
    const requests = []
    const status = (view = 'all', page = 0) => {
      const duplicateView = view === 'duplicates'
      const total = duplicateView ? 200000 : 200100
      const start = page * 500
      const count = Math.min(500, Math.max(0, total - start))
      const items = Array.from({ length: count }, (_, index) => {
        const number = start + index
        const name = `${duplicateView ? 'duplicate' : 'file'}-${number}.bin`
        return {
          path: `/pinokio/api/appB/${name}`,
          relative_path: name,
          source_id: 'app:appB',
          source_label: 'appB',
          size: 1024 + number,
          status: duplicateView ? 'duplicate' : 'tracked',
          shareable: duplicateView,
          match: duplicateView ? { path: `/pinokio/api/appA/${name}` } : null
        }
      })
      return {
        enabled: true,
        mode: 'link',
        scan: { active: false, pending: false, queued: 0, phase: 'complete', scope_id: null },
        last_scan: { ts: 1, bytes_total: 1024 * 200100, hash_failures: 0 },
        tracked_bytes: 1024 * 200100,
        effective_bytes: 1024 * 100,
        shared_bytes: 0,
        pending_bytes: 1024 * 200000,
        activity_error: null,
        cloud_sync_warning: null,
        sources: [{
          id: 'app:appB', kind: 'app', label: 'appB', root: '/pinokio/api/appB',
          display_path: '/pinokio/api/appB', parent_id: null, available: true, shareable: true
        }],
        items,
        inventory: {
          view,
          counts: {
            all: 200100, duplicates: 200000, shared: 0,
            tracked: 100, independent: 0, reclaimable: 0, activity: 0
          },
          source_counts: {
            all: { 'app:appB': 200100 },
            duplicates: { 'app:appB': 200000 },
            independent: {}
          },
          shareable_by_source: { 'app:appB': 200000 },
          shareable_duplicates: 200000,
          duplicate_locations: 1,
          current: {
            count: total,
            locations: 1,
            shareable_bytes: duplicateView ? 1024 * 200000 : 0
          },
          page,
          page_size: 500,
          start,
          end: start + count,
          total,
          pages: Math.ceil(total / 500)
        }
      }
    }
    dom.window.fetch = async (url) => {
      requests.push(String(url))
      const parsed = new URL(String(url), 'http://localhost')
      return {
        ok: true,
        json: async () => status(
          parsed.searchParams.get('view') || 'all',
          Number(parsed.searchParams.get('page')) || 0
        )
      }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const duplicates = dom.window.document.querySelector('[data-view="duplicates"]')
    assert.strictEqual(duplicates.querySelector('.vault-nav-count').textContent, '200000')
    duplicates.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.match(requests.at(-1), /view=duplicates/)
    assert.match(requests.at(-1), /page=0/)
    assert.strictEqual(dom.window.document.querySelectorAll('.vault-table.matches .vault-file-row').length, 500)
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent,
      '1–500 of 200000')

    dom.window.document.querySelector('[data-page="next"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.match(requests.at(-1), /page=1/)
    assert.strictEqual(dom.window.document.querySelector('.vault-page-range').textContent,
      '501–1000 of 200000')
    dom.window.close()
  })

  test('app inventory uses explicit sharing actions without ambiguous switches', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const actions = []
    let finishSeparate
    const separateResponse = new Promise((resolve) => {
      finishSeparate = () => resolve({ ok: true, json: async () => ({ status: 'detached' }) })
    })
    let finishDeduplicate
    const deduplicateResponse = new Promise((resolve) => {
      finishDeduplicate = () => resolve({ ok: true, json: async () => ({ status: 'converted', bytes_saved: 1024 }) })
    })
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
      items: [{
        path: '/pinokio/api/appB/shared.bin',
        relative_path: 'shared.bin',
        source_id: 'app:appB',
        source_label: 'appB',
        size: 1024,
        status: 'shared',
        locations: [
          { path: '/pinokio/api/appB/shared.bin', relative_path: 'shared.bin', source_id: 'app:appB', source_label: 'appB', mode: 'link' },
          { path: '/pinokio/api/appA/shared.bin', relative_path: 'shared.bin', source_id: 'app:appA', source_label: 'appA', mode: 'link' }
        ]
      }, {
        path: '/pinokio/api/appB/duplicate.bin', relative_path: 'duplicate.bin',
        source_id: 'app:appB', source_label: 'appB', size: 1024,
        status: 'duplicate', shareable: true,
        match: { path: '/pinokio/api/appA/duplicate.bin' }
      }, {
        path: '/pinokio/api/appB/own.bin', relative_path: 'own.bin',
        source_id: 'app:appB', source_label: 'appB', size: 1024,
        status: 'independent'
      }]
    }
    dom.window.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        const action = JSON.parse(options.body)
        actions.push(action)
        if (action.path && action.path.endsWith('/shared.bin')) return separateResponse
        if (action.path && action.path.endsWith('/own.bin')) return deduplicateResponse
        return {
          ok: true,
          json: async () => action.path.endsWith('/duplicate.bin')
            ? { status: 'ignored' }
            : { status: 'detached' }
        }
      }
      return { ok: true, json: async () => status }
    }
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-table.inventory .vault-columns span')]
      .map((node) => node.textContent), ['Name', 'Size', 'Deduplication status'])
    assert.strictEqual(dom.window.document.querySelector('.vault-table.inventory .vault-space'), null)
    assert.strictEqual(dom.window.document.querySelector('.vault-table.inventory .vault-row-action'), null)
    const makeSeparate = dom.window.document.querySelector('[data-detach="/pinokio/api/appB/shared.bin"]')
    const keepSeparate = dom.window.document.querySelector('[data-detach="/pinokio/api/appB/duplicate.bin"]')
    assert.strictEqual(dom.window.document.querySelector('.vault-sharing-switch'), null)
    assert.strictEqual(makeSeparate.textContent, 'Make separate')
    assert.strictEqual(makeSeparate.getAttribute('aria-label'), 'Make separate: shared.bin')
    assert.strictEqual(makeSeparate.dataset.detachKind, 'make')
    const deduplicate = dom.window.document.querySelector('[data-deduplicate-file="/pinokio/api/appB/own.bin"]')
    assert.strictEqual(dom.window.document.querySelector('[data-reshare]'), null)
    assert.strictEqual(deduplicate.textContent, 'Deduplicate')
    assert.strictEqual(deduplicate.getAttribute('aria-label'), 'Deduplicate: own.bin')
    assert.strictEqual(keepSeparate.textContent, 'Keep separate')
    assert.strictEqual(keepSeparate.getAttribute('aria-label'), 'Keep separate: duplicate.bin')
    assert.strictEqual(keepSeparate.dataset.detachKind, 'keep')
    for (const button of [makeSeparate, deduplicate, keepSeparate]) {
      assert.ok(button.getAttribute('aria-label').includes(button.textContent))
    }
    assert.match(deduplicate.closest('.vault-status-cell').textContent, /Kept separate/)

    makeSeparate.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const separateProgress = dom.window.document.getElementById('vault-action-state')
    assert.strictEqual(makeSeparate.disabled, true)
    assert.strictEqual(makeSeparate.getAttribute('aria-busy'), 'true')
    assert.strictEqual(separateProgress.classList.contains('show'), true)
    assert.strictEqual(separateProgress.textContent, 'Making file separateshared.bin')
    assert.ok(separateProgress.querySelector('.vault-progress-bar').classList.contains('indeterminate'))
    assert.strictEqual(separateProgress.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow'), false)
    finishSeparate()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(separateProgress.classList.contains('show'), false)
    const currentDeduplicate = dom.window.document.querySelector('[data-deduplicate-file="/pinokio/api/appB/own.bin"]')
    currentDeduplicate.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(currentDeduplicate.disabled, true)
    assert.strictEqual(currentDeduplicate.getAttribute('aria-busy'), 'true')
    assert.strictEqual(separateProgress.classList.contains('show'), true)
    assert.strictEqual(separateProgress.textContent, 'Deduplicating fileown.bin')
    assert.ok(separateProgress.querySelector('.vault-progress-bar').classList.contains('indeterminate'))
    finishDeduplicate()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(separateProgress.classList.contains('show'), false)
    dom.window.document.querySelector('[data-detach="/pinokio/api/appB/duplicate.bin"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepStrictEqual(actions, [
      { action: 'detach', path: '/pinokio/api/appB/shared.bin' },
      { action: 'deduplicate', path: '/pinokio/api/appB/own.bin' },
      { action: 'detach', path: '/pinokio/api/appB/duplicate.bin' }
    ])
    dom.window.close()
  })

  test('Deduplicated defaults to a globally size-sorted Files mode and can return to Folders', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'app:appB'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/appB', runScripts: 'dangerously' })
    const sharedItem = (size, name) => ({
      path: `/pinokio/api/appB/${name}`,
      relative_path: name,
      source_id: 'app:appB',
      source_label: 'appB',
      size,
      status: 'shared',
      locations: [
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
      items: [
        sharedItem(1024, 'a-small/a-small.bin'),
        sharedItem(4096, 'z-large/z-large.bin')
      ]
    }
    dom.window.fetch = async () => ({ ok: true, json: async () => status })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    dom.window.document.querySelector('[data-view="shared"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
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
      .map((node) => node.textContent), ['Name', 'Location', 'Size', 'Deduplication status'])
    assert.deepStrictEqual(names(), ['z-large.bin', 'a-small.bin'])
    assert.deepStrictEqual(directories(), [])
    assert.match(locations()[0], /appB \/ z-large\/z-large\.bin/)
    assert.match(locations()[1], /appB \/ a-small\/a-small\.bin/)
    assert.strictEqual(sort().getAttribute('aria-label'), 'Sort by size, smallest first')
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'descending')
    assert.strictEqual(dom.window.document.getElementById('vault-pane-footer').textContent,
      '2 deduplicated files · sorted largest first')

    sort().click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepStrictEqual(names(), ['a-small.bin', 'z-large.bin'])
    assert.strictEqual(sort().getAttribute('aria-label'), 'Sort by size, largest first')
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'ascending')
    assert.strictEqual(dom.window.document.getElementById('vault-pane-footer').textContent,
      '2 deduplicated files · sorted smallest first')

    sort().click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepStrictEqual(names(), ['z-large.bin', 'a-small.bin'])
    assert.strictEqual(sort().getAttribute('aria-label'), 'Sort by size, smallest first')
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'descending')

    mode('folders').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(mode('folders').getAttribute('aria-pressed'), 'true')
    assert.strictEqual(mode('files').getAttribute('aria-pressed'), 'false')
    assert.deepStrictEqual([...dom.window.document.querySelectorAll('.vault-columns > span')]
      .map((node) => node.textContent), ['Name', 'Size', 'Deduplication status'])
    assert.deepStrictEqual(directories(), ['a-small', 'z-large'])
    assert.strictEqual(sort(), null)

    mode('files').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepStrictEqual(names(), ['z-large.bin', 'a-small.bin'])
    assert.strictEqual(sort().parentElement.getAttribute('aria-sort'), 'descending')
    dom.window.close()
  })

  test('external file rows and expanded matches show the full target path', async () => {
    const views = path.resolve(__dirname, '..', 'server', 'views')
    const html = await ejs.renderFile(path.resolve(views, 'vault_app.ejs'), {
      theme: 'light', platform: 'darwin', agent: 'electron', scope_id: 'external:api'
    })
    const dom = new JSDOM(html, { url: 'http://localhost/vault/app/external%3Aapi', runScripts: 'dangerously' })
    const targetRoot = '/Volumes/Models/api'
    const relativePath = 'ideogram/app/comfy_models/model.safetensors'
    const externalPath = `${targetRoot}/${relativePath}`
    const status = {
      enabled: true,
      mode: 'link',
      scan: { active: false, pending: false, queued: 0, phase: 'idle', scope_id: null },
      last_scan: { ts: Date.now(), bytes_total: 4096 },
      tracked_bytes: 4096,
      effective_bytes: 2048,
      shared_bytes: 4096,
      pending_bytes: 0,
      activity_error: null,
      cloud_sync_warning: null,
      sources: [{
        id: 'external:api', kind: 'external', label: 'api', root: targetRoot,
        display_path: '/pinokio/vault/sources/api', target_path: targetRoot,
        parent_id: null, available: true, shareable: true
      }],
      items: [{
        path: externalPath,
        relative_path: relativePath,
        source_id: 'external:api',
        source_label: 'api',
        size: 4096,
        status: 'shared',
        locations: [
          {
            path: externalPath, relative_path: relativePath,
            source_id: 'external:api', source_label: 'api', mode: 'link'
          },
          {
            path: `/pinokio/api/appA/${relativePath}`, relative_path: relativePath,
            source_id: 'app:appA', source_label: 'appA', mode: 'link'
          }
        ]
      }]
    }
    dom.window.fetch = async () => ({ ok: true, json: async () => status })
    await runVaultScript(dom)
    await new Promise((resolve) => setTimeout(resolve, 25))

    dom.window.document.querySelector('[data-view="shared"]').click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.strictEqual(
      dom.window.document.querySelector('.vault-flat-location').textContent,
      externalPath
    )
    dom.window.document.querySelector('[data-expand-file]').click()
    assert.deepStrictEqual(
      [...dom.window.document.querySelectorAll('.vault-location-detail span')]
        .map((node) => node.textContent),
      [externalPath, `appA / ${relativePath}`]
    )
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
    assert.match(route, /res\.render\("vault", \{ theme: this\.theme, platform: this\.kernel\.platform, agent: req\.agent \}\)/)
    assert.match(route, /res\.render\("vault_app", \{[\s\S]*?platform: this\.kernel\.platform/)
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

  test('dashboard actions delegate to the engine and unscoped deduplication requires an explicit selection', async () => {
    const { home, vault } = await makeEnv()
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const pending = await writeFile(path.resolve(home, 'api', 'appB', 'model.bin'), content)
    await vault.adopt(original, hash, { app: 'appA' })
    vault.registry.duplicates.set(pending, { hash, size: content.length, app: 'appB' })

    const result = await vault.perform('deduplicate', {})
    const malformed = await vault.perform('deduplicate', {
      selection: 'duplicates',
      scope_id: 42
    })

    assert.match(result.error, /location/i)
    assert.match(malformed.error, /valid location/i)
    assert.strictEqual((await fs.promises.stat(pending)).nlink, 1)
    const serverSource = await fs.promises.readFile(path.resolve(__dirname, '..', 'server', 'index.js'), 'utf8')
    const actionRoute = serverSource.slice(serverSource.indexOf('this.app.post("/vault/action"'), serverSource.indexOf('this.app.get("/info/scripts"'))
    assert.match(actionRoute, /vault\.perform\(body\.action, body\)/)
    assert.doesNotMatch(actionRoute, /convertPending|runExclusive/)
  })

  test('a stale external source id cannot authorize files outside its current target', async () => {
    const { home, vault } = await makeEnv()
    const firstTarget = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-scope-old-'))
    const secondTarget = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-scope-new-'))
    homes.push(firstTarget, secondTarget)
    const content = crypto.randomBytes(4096)
    const hash = sha256(content)
    const original = await writeFile(path.resolve(home, 'api', 'appA', 'model.bin'), content)
    const outside = await writeFile(path.resolve(firstTarget, 'model.bin'), content)
    const externalSource = (await vault.addExternalSource(firstTarget)).source
    const originalSource = vault.sources().find((source) => source.kind === 'app' && source.app === 'appA')
    await vault.adopt(original, hash, { app: 'appA', source_id: originalSource.id })
    const outsideStat = await fs.promises.stat(outside)
    vault.registry.duplicates.set(outside, {
      hash, size: content.length, source_id: externalSource.id,
      dev: outsideStat.dev, ino: outsideStat.ino,
      mtime: outsideStat.mtimeMs, ctime: outsideStat.ctimeMs
    })
    await vault.writeExternalSourcePaths([secondTarget])
    await vault.refreshSources()

    const result = await vault.perform('deduplicate', { scope_id: externalSource.id })

    assert.match(result.error, /no longer available/i)
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

  test('status separates app, Pinokio folder, and external source metadata', async () => {
    const { home, vault } = await makeEnv()
    const externalParent = await fs.promises.mkdtemp(path.resolve(os.tmpdir(), 'pinokio-ui-external-'))
    const external = path.resolve(externalParent, 'linked-models')
    homes.push(externalParent)
    await fs.promises.mkdir(external)
    await vault.addExternalSource(external)
    await fs.promises.mkdir(path.resolve(home, 'api', 'local-app'), { recursive: true })
    await fs.promises.mkdir(path.resolve(home, 'cache'), { recursive: true })
    await vault.refreshSources()
    const status = await vault.status()
    const byKind = new Map(status.sources.map((source) => [source.id, source]))
    assert.ok([...byKind.values()].some((source) => source.kind === 'app' && source.label === 'local-app' && source.parent_id === 'apps'))
    assert.ok([...byKind.values()].some((source) => source.kind === 'folder' && source.label === 'cache' && source.parent_id === 'pinokio'))
    assert.ok([...byKind.values()].some((source) =>
      source.kind === 'external' && source.label === 'linked-models' &&
      source.parent_id === 'external' && source.removable === true))
  })
})
