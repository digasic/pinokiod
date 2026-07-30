const { parentPort, workerData } = require("worker_threads")
const RegistryCore = require("./registry_core")

const registry = new RegistryCore(workerData.root)
let queue = Promise.resolve()

const serializeError = (error) => ({
  message: error && error.message ? error.message : String(error),
  code: error && error.code ? error.code : null,
  stack: error && error.stack ? error.stack : null
})

parentPort.on("message", ({ id, method, args }) => {
  queue = queue.then(async () => {
    if (!method || typeof registry[method] !== "function") {
      const error = new Error(`Unknown registry command: ${method}`)
      error.code = "EVAULTCOMMAND"
      throw error
    }
    return registry[method](...(Array.isArray(args) ? args : []))
  }).then(
    (result) => parentPort.postMessage({ id, result }),
    (error) => parentPort.postMessage({ id, error: serializeError(error) })
  )
})
