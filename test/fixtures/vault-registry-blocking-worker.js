const Database = require("better-sqlite3")

const database = new Database(":memory:")
database.exec(`
  CREATE TABLE numbers(value INTEGER NOT NULL);
  WITH RECURSIVE values_to_add(value) AS (
    VALUES(1)
    UNION ALL
    SELECT value + 1 FROM values_to_add WHERE value < 10000
  )
  INSERT INTO numbers SELECT value FROM values_to_add;
`)

const reply = (message, callback = null) => {
  if (!process.connected) return
  process.send(message, callback || undefined)
}

process.on("message", ({ id, method }) => {
  if (method === "load") {
    reply({ id, result: { existed: false } })
    return
  }
  if (method === "close") {
    database.close()
    reply({ id, result: null })
    return
  }
  if (method === "block") {
    reply({ id, result: { started: true } }, () => {
      setImmediate(() => {
        database.prepare(`
          SELECT COUNT(*) AS count
          FROM numbers first, numbers second, numbers third
        `).get()
      })
    })
    return
  }
  reply({ id, error: { message: `Unknown command: ${method}` } })
})
