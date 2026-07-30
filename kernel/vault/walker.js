const fs = require('fs')
const path = require('path')
const { ENTRY_BATCH_SIZE } = require('./constants')

const isMissingError = (error) => !!(error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
const isHandledError = (options, error, target) => !!(
  options.onError && options.onError(error, target)
)

// One traversal primitive for scans. It owns only directory
// discovery and symlink policy; callers decide how files are classified.
async function * walkBatches(root, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 1)
  const entryBatchSize = Math.max(1, Number(options.entryBatchSize) || ENTRY_BATCH_SIZE)
  const statConcurrency = Math.max(1, Number(options.statConcurrency) || 32)
  const skipDirectory = options.skipDirectory || (() => false)
  const strictErrors = !!options.strictErrors
  const strictRoot = !!options.strictRoot
  const pending = [{ dir: path.resolve(root), isRoot: true }]
  const active = []
  try {
    while (pending.length || active.length) {
      while (active.length < concurrency && pending.length) {
        const { dir, isRoot } = pending.pop()
        try {
          const st = await fs.promises.lstat(dir)
          if (!st.isDirectory()) {
            if (strictRoot && isRoot) {
              const error = new Error(`Scan location is not a directory: ${dir}`)
              error.code = "ENOTDIR"
              throw error
            }
            yield [{ dir, entries: null, files: [], discoveredDirs: 0, discoveredFiles: 0, firstChunk: true }]
            continue
          }
          active.push({
            dir,
            handle: await fs.promises.opendir(dir),
            firstChunk: true,
            isRoot
          })
        } catch (error) {
          const missingRoot = strictRoot && isRoot && isMissingError(error)
          const handled = !missingRoot &&
            isHandledError(options, error, dir)
          if (missingRoot ||
              (strictErrors && !isMissingError(error) &&
                !handled)) throw error
          yield [{ dir, entries: null, files: [], discoveredDirs: 0, discoveredFiles: 0, firstChunk: true }]
        }
      }
      if (!active.length) continue
      const batch = await Promise.all(active.map(async (task) => {
        const entries = []
        let done = false
        try {
          while (entries.length < entryBatchSize) {
            const entry = await task.handle.read()
            if (!entry) {
              done = true
              break
            }
            entries.push(entry)
          }
        } catch (error) {
          const missingRoot = strictRoot && task.isRoot &&
            isMissingError(error)
          const handled = !missingRoot &&
            isHandledError(options, error, task.dir)
          if (missingRoot ||
              (strictErrors && !isMissingError(error) &&
                !handled)) throw error
          done = true
        }
        return {
          task, dir: task.dir, entries, done, firstChunk: task.firstChunk,
          files: [], discoveredDirs: 0, discoveredFiles: 0
        }
      }))
      const unknown = []
      for (const group of batch) {
        group.task.firstChunk = false
        for (const entry of group.entries) {
          if (entry.isSymbolicLink()) continue
          const full = path.resolve(group.dir, entry.name)
          if (entry.isDirectory()) {
            if (skipDirectory(full)) continue
            pending.push({ dir: full, isRoot: false })
            group.discoveredDirs += 1
          } else if (entry.isFile()) {
            group.files.push({ path: full, entry })
            group.discoveredFiles += 1
          } else {
            unknown.push({ group, entry, full })
          }
        }
      }
      if (unknown.length) {
        const stats = await statMany(
          unknown.map((item) => item.full),
          statConcurrency,
          null,
          { followSymlinks: false, strictErrors, onError: options.onError }
        )
        for (let index = 0; index < unknown.length; index++) {
          const item = unknown[index]
          const st = stats[index]
          if (!st || st.isSymbolicLink()) continue
          if (st.isDirectory()) {
            if (skipDirectory(item.full)) continue
            pending.push({ dir: item.full, isRoot: false })
            item.group.discoveredDirs += 1
          } else if (st.isFile()) {
            item.group.files.push({ path: item.full, entry: item.entry })
            item.group.discoveredFiles += 1
          }
        }
      }
      yield batch.map(({ task, done, ...group }) => group)
      for (let index = active.length - 1; index >= 0; index--) {
        if (!batch[index].done) continue
        await active[index].handle.close().catch(() => {})
        active.splice(index, 1)
      }
    }
  } finally {
    await Promise.all(active.map((task) => task.handle.close().catch(() => {})))
  }
}

const statMany = async (paths, concurrency = 32, onSettled = null, options = {}) => {
  const results = new Array(paths.length)
  const readMetadata = options.followSymlinks === false ? fs.promises.lstat : fs.promises.stat
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++
      try {
        results[index] = await readMetadata(paths[index])
      } catch (error) {
        const handled = isHandledError(options, error, paths[index])
        if (options.strictErrors && !isMissingError(error) &&
            !handled) throw error
        results[index] = null
      } finally {
        if (onSettled) onSettled(index, results[index])
      }
    }
  })
  await Promise.all(workers)
  return results
}

module.exports = { walkBatches, statMany }
