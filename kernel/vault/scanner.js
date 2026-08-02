const fs = require("fs")
const path = require("path")
const { walkBatches, statMany } = require("./walker")
const { sameSnapshot } = require("./snapshot")
const {
  DIR_CONCURRENCY,
  STAT_CONCURRENCY,
  SHA256_RE
} = require("./constants")

class Scanner {
  constructor(vault) {
    this.vault = vault
    this.statConcurrency = vault.statConcurrency || STAT_CONCURRENCY
    this.dirConcurrency = vault.dirConcurrency || DIR_CONCURRENCY
  }

  async walk(root, options = {}) {
    const checkpoint = typeof options.checkpoint === "function"
      ? options.checkpoint
      : () => {}
    const onError = typeof options.onError === "function"
      ? options.onError
      : () => false
    const onBatch = typeof options.onBatch === "function"
      ? options.onBatch
      : async () => {}
    for await (const directoryResults of walkBatches(root, {
      concurrency: this.dirConcurrency,
      skipDirectory: options.skipDirectory,
      strictErrors: true,
      strictRoot: true,
      onError
    })) {
      checkpoint()
      const filePaths = directoryResults.flatMap((group) =>
        group.files.map((file) => file.path))
      const stats = await statMany(filePaths, this.statConcurrency, null, {
        followSymlinks: false,
        strictErrors: true,
        onError
      })
      const files = []
      for (let index = 0; index < filePaths.length; index++) {
        checkpoint()
        const stat = stats[index]
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) continue
        files.push({ path: filePaths[index], stat })
      }
      await onBatch({
        files,
        directories: directoryResults.filter((group) =>
          group.firstChunk).length,
        currentDirectory: directoryResults
          .map((group) => group && group.dir)
          .filter(Boolean)
          .at(-1) || null
      })
    }
  }

  async hashStable(entry, options = {}) {
    const result = await this.vault.hashFile(entry.path, {
      onProgress: options.onProgress
    })
    const current = await fs.promises.lstat(entry.path)
    const stable = current.isFile() &&
      !current.isSymbolicLink() &&
      result.size === current.size &&
      sameSnapshot(entry, current)
    return { result, current, stable }
  }

  async walkAnchors(stores, options = {}) {
    const checkpoint = typeof options.checkpoint === "function"
      ? options.checkpoint
      : () => {}
    const onError = typeof options.onError === "function"
      ? options.onError
      : () => false
    const onEntries = typeof options.onEntries === "function"
      ? options.onEntries
      : async () => {}
    for (const store of stores) {
      const blobRoot = path.resolve(store.root, "sha256")
      let stat
      try {
        stat = await fs.promises.lstat(blobRoot)
      } catch (error) {
        if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
          continue
        }
        if (onError(error, blobRoot)) continue
        throw error
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue
      try {
        await this.vault.validateAnchorStore(store, stat.dev)
      } catch (error) {
        if (onError(error, blobRoot, "anchor_store")) continue
        throw error
      }
      await this.walk(blobRoot, {
        checkpoint,
        onError,
        onBatch: async ({ files }) => {
          const entries = []
          for (const file of files) {
            const hash = path.basename(file.path)
            if (!SHA256_RE.test(hash) ||
                path.basename(path.dirname(file.path)) !== hash.slice(0, 2)) {
              continue
            }
            entries.push({
              store_id: store.id,
              hash_name: hash,
              path: file.path,
              size: file.stat.size,
              mtime: file.stat.mtimeMs,
              ctime: file.stat.ctimeMs,
              dev: file.stat.dev,
              ino: file.stat.ino,
              nlink: file.stat.nlink,
              mode: file.stat.mode,
              uid: file.stat.uid,
              gid: file.stat.gid
            })
          }
          if (entries.length) await onEntries(entries)
        }
      })
    }
  }
}

module.exports = Scanner
