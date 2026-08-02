const PATH_ERROR_CODES = new Set([
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "EIO",
  "EISDIR",
  "ELOOP",
  "ENODATA",
  "ENOENT",
  "ENOTDIR",
  "ENXIO",
  "EPERM",
  "EROFS",
  "ESTALE",
  "ETIMEDOUT",
  "EWOULDBLOCK"
])

const isPathError = (error) => !!(
  error && PATH_ERROR_CODES.has(error.code))

const exclusionReason = (error) => {
  if (!error) return "unreadable"
  if (error.code === "EACCES" || error.code === "EPERM") {
    return "permission_denied"
  }
  if (error.code === "ENOENT" || error.code === "ENOTDIR") {
    return "disappeared"
  }
  if (["EAGAIN", "ENODATA", "ETIMEDOUT", "EWOULDBLOCK"]
    .includes(error.code)) return "not_resident"
  return "unreadable"
}

const cancelledError = (message) => {
  const error = new Error(message)
  error.code = "EVAULTCANCELLED"
  return error
}

module.exports = { cancelledError, exclusionReason, isPathError }
