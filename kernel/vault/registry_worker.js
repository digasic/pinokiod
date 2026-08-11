const RegistryCore = require("./registry_core")

const registry = new RegistryCore(process.argv[2])
let queue = Promise.resolve()

const serializeError = (error) => ({
  message: error && error.message ? error.message : String(error),
  code: error && error.code ? error.code : null,
  stack: error && error.stack ? error.stack : null
})

const reply = (message) => {
  if (process.connected) process.send(message)
}

process.on("message", ({ id, method, args }) => {
  queue = queue.then(async () => {
    if (!method || typeof registry[method] !== "function") {
      const error = new Error(`Unknown registry command: ${method}`)
      error.code = "EVAULTCOMMAND"
      throw error
    }
    return registry[method](...(Array.isArray(args) ? args : []))
  }).then(
    (result) => reply({ id, result }),
    (error) => reply({ id, error: serializeError(error) })
  )
})

process.on("disconnect", () => {
  try {
    registry.close()
  } finally {
    process.exit(0)
  }
})
