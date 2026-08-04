const path = require("path")
const { Worker } = require("worker_threads")

class Registry {
  constructor(root) {
    this.root = path.resolve(root)
    this.worker = null
    this.sequence = 0
    this.pending = new Map()
    this.closed = false
  }

  async load() {
    if (this.worker) return this.call("load")
    this.closed = false
    const worker = new Worker(
      path.resolve(__dirname, "registry_worker.js"),
      { workerData: { root: this.root } }
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
    worker.on("error", (error) => this.fail(error))
    worker.on("exit", (code) => {
      if (this.worker === worker) this.worker = null
      if (!this.closed) {
        this.fail(new Error(`Registry worker exited with code ${code}`))
      }
    })
    try {
      return await this.call("load")
    } catch (error) {
      this.closed = true
      if (this.worker === worker) this.worker = null
      await worker.terminate().catch(() => {})
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
        this.worker.postMessage({ id, method, args })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async close() {
    if (!this.worker) return
    const worker = this.worker
    this.closed = true
    try {
      await this.call("close")
    } finally {
      if (this.worker === worker) this.worker = null
      await worker.terminate()
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
  "automaticAppResultSignature",
  "removeAutomaticAppScanApp",
  "setAutomaticAppScanState",
  "scanFor",
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
