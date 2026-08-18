const path = require("path")
const { fork } = require("child_process")

const waitForExit = (worker) => new Promise((resolve) => {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) {
    resolve()
    return
  }
  worker.once("exit", resolve)
})

class Registry {
  constructor(root, options = {}) {
    this.root = path.resolve(root)
    this.workerPath = path.resolve(
      options.workerPath || path.resolve(__dirname, "registry_worker.js"))
    this.worker = null
    this.sequence = 0
    this.pending = new Map()
    this.closed = false
  }

  async load() {
    if (this.worker) return this.call("load")
    this.closed = false
    const worker = fork(
      this.workerPath,
      [this.root],
      {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        serialization: "advanced"
      }
    )
    this.worker = worker
    worker.on("message", (message) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        const error = new Error(message.error.message)
        if (message.error.code) error.code = message.error.code
        if (message.error.stack) error.stack = message.error.stack
        pending.reject(error)
      } else {
        pending.resolve(message.result)
      }
    })
    worker.on("error", (error) => {
      if (this.worker === worker) this.fail(error)
    })
    worker.on("exit", (code) => {
      const active = this.worker === worker
      if (active) this.worker = null
      if (active && !this.closed) {
        this.fail(new Error(`Registry worker exited with code ${code}`))
      }
    })
    try {
      return await this.call("load")
    } catch (error) {
      this.closed = true
      if (this.worker === worker) this.worker = null
      worker.kill("SIGKILL")
      await waitForExit(worker)
      throw error
    }
  }

  fail(error) {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) request.reject(error)
  }

  call(method, ...args) {
    if (!this.worker) {
      return Promise.reject(new Error("Registry worker is not running."))
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker.send({ id, method, args }, (error) => {
          if (!error) return
          const pending = this.pending.get(id)
          if (!pending) return
          this.pending.delete(id)
          pending.reject(error)
        })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async restart(error = null) {
    const failure = error || new Error("Registry worker restarted.")
    const worker = this.worker
    if (!worker) return this.load()
    if (this.worker === worker) this.worker = null
    this.fail(failure)
    worker.kill("SIGKILL")
    await waitForExit(worker)
    this.closed = false
    return this.load()
  }

  async close() {
    if (!this.worker) return
    const worker = this.worker
    this.closed = true
    try {
      await this.call("close")
    } finally {
      if (this.worker === worker) this.worker = null
      worker.kill("SIGTERM")
      await waitForExit(worker)
    }
  }
}

for (const method of [
  "getFile",
  "upsertFile",
  "removeFile",
  "reclassifyHash",
  "getContent",
  "upsertContent",
  "removeContent",
  "getAnchor",
  "anchorsForHash",
  "upsertAnchor",
  "removeAnchor",
  "files",
  "updateInodeSnapshots",
  "removeExternalSourceState",
  "beginFolderDiscovery",
  "abortFolderDiscovery",
  "stageFolderDiscoveryFiles",
  "folderDiscoveryWorkSummary",
  "folderDiscoveryHashBatch",
  "setFolderDiscoveryHash",
  "markFolderDiscoveryHashFailed",
  "folderDiscoveryReferences",
  "folderDiscoveryReferenceHashBatch",
  "setFolderDiscoveryReferenceHash",
  "markFolderDiscoveryReferenceHashFailed",
  "folderDiscoveryAnchors",
  "markFolderDiscoveryAnchorChecked",
  "folderDiscoveryVerifiedSummary",
  "finalizeFolderDiscoveryMatches",
  "prepareFolderDiscoveryResults",
  "folderDiscoveryResults",
  "folderDiscoveryChildren",
  "folderDiscoveryRecommendations",
  "updateFolderDiscoverySelection",
  "folderDiscoverySelectionSummary",
  "folderDiscoverySelectionPaths",
  "folderDiscoverySelectedHashes",
  "publishFolderDiscoverySelection",
  "automaticAppScanStates",
  "automaticAppScanSettings",
  "setAutomaticAppScanMode",
  "setAutomaticAppScanAcknowledgement",
  "beginAutomaticPrecheck",
  "stageAutomaticPrecheckFiles",
  "automaticPrecheckEntries",
  "rememberHashCache",
  "automaticPrecheckResult",
  "abortAutomaticPrecheck",
  "removeAutomaticAppScanApp",
  "setAutomaticAppScanState",
  "scanFor",
  "scanSetting",
  "setScanSetting",
  "removeScan",
  "beginScan",
  "abortScan",
  "stageExclusions",
  "stageFiles",
  "scopedAnchorBatch",
  "stageComparisonFiles",
  "comparisonFileBatch",
  "resolveComparisonFiles",
  "stagedHashWork",
  "stageAnchors",
  "hashWorkBatch",
  "setStageHashes",
  "setStageHash",
  "setStageInodeHash",
  "markStageHashFailed",
  "unverifiedAnchorBatch",
  "markAnchorChecked",
  "markAnchorVerificationFailed",
  "publishScan",
  "addEvent",
  "setMaxEvents",
  "countFiles",
  "firstFileForInode",
  "anchorCandidate",
  "countActionFiles",
  "matchingFileSummary",
  "fileBatch",
  "hasFilesForHash",
  "appsForHashes",
  "reclaimableBatch",
  "duplicateGroupChildren",
  "fileLocationChildren",
  "duplicateGroupSelection",
  "duplicateGroupPageSelection",
  "statusSnapshot",
  "clearFiles"
]) {
  Registry.prototype[method] = function (...args) {
    return this.call(method, ...args)
  }
}

module.exports = Registry
