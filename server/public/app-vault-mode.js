(() => {
  const status = document.querySelector("[data-app-vault-mode]")
  if (!status) return

  const app = status.dataset.app || ""
  const tab = status.closest("#save-space-tab")
  const label = status.querySelector("[data-app-vault-mode-label]")
  const setState = (value, ready) => {
    const mode = value === "manual" ? "manual" : "automatic"
    const globalScanReady = ready === true
    status.dataset.mode = mode
    status.dataset.ready = String(globalScanReady)
    status.hidden = false
    if (label) {
      label.textContent = globalScanReady
        ? (mode === "automatic" ? "Auto" : "Manual")
        : "Set up"
    }
    if (tab) {
      tab.setAttribute("aria-label",
        globalScanReady
          ? `Disk Saver — ${mode === "automatic" ? "Automatic" : "Manual"} checking`
          : "Disk Saver — Set up required")
    }
  }
  const applySnapshot = (snapshot) => {
    const settings = snapshot && Array.isArray(snapshot.settings)
      ? snapshot.settings
      : []
    const setting = settings.find((item) => item && item.app === app)
    setState(setting && setting.mode,
      snapshot && snapshot.global_scan_ready === true)
  }

  setState(status.dataset.mode, status.dataset.ready === "true")
  if (!app || typeof window.EventSource !== "function") return

  const source = new window.EventSource(
    "/info/vault/automatic-scans/events")
  source.onmessage = (event) => {
    try {
      applySnapshot(JSON.parse(event.data))
    } catch (_) {}
  }
  window.addEventListener("beforeunload", () => source.close(), { once: true })
})()
