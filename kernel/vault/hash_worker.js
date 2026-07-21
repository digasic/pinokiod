const { parentPort } = require('worker_threads')
const crypto = require('crypto')
const fs = require('fs')

// Large model files otherwise generate a very high number of 64 KiB stream
// events. This changes only the read granularity; every byte still feeds the
// same sha256 digest, one file at a time.
const HASH_READ_SIZE = 1024 * 1024

parentPort.on('message', ({ id, filePath }) => {
  const hash = crypto.createHash('sha256')
  let size = 0
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  const stream = fs.createReadStream(filePath, { flags, highWaterMark: HASH_READ_SIZE })
  stream.on('data', (chunk) => {
    size += chunk.length
    hash.update(chunk)
  })
  stream.on('error', (error) => {
    parentPort.postMessage({ id, error: error.message })
  })
  stream.on('end', () => {
    parentPort.postMessage({ id, hash: hash.digest('hex'), size })
  })
})
