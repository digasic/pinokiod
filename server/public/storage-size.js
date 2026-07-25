(function (root) {
  const units = ["B", "KB", "MB", "GB", "TB"]

  root.PinokioFormatStorageSize = (value) => {
    const bytes = Number(value)
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
    const platform = root.document && root.document.body &&
      root.document.body.dataset.platform
    const base = platform === "win32" ? 1024 : 1000
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(base)))
    const scaled = bytes / Math.pow(base, index)
    return `${Number(scaled.toFixed(index ? 2 : 0))} ${units[index]}`
  }
})(window)
