(function (root) {
  const base = 1000
  const units = ["B", "KB", "MB", "GB", "TB"]

  root.PinokioFormatStorageSize = (value) => {
    const bytes = Number(value)
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(base)))
    const scaled = bytes / Math.pow(base, index)
    return `${Number(scaled.toFixed(index ? 2 : 0))} ${units[index]}`
  }
})(window)
