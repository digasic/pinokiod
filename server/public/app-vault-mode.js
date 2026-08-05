(() => {
  const status = document.querySelector("[data-app-vault-mode]")
  if (!status) return

  const app = status.dataset.app || ""
  const tab = status.closest("#save-space-tab")
  const label = status.querySelector("[data-app-vault-mode-label]")
  const setMode = (value) => {
    const mode = value === "manual" ? "manual" : "automatic"
    status.dataset.mode = mode
    status.hidden = false
    if (label) label.textContent = mode === "automatic" ? "Auto" : "Manual"
    if (tab) {
      tab.setAttribute("aria-label",
        `Disk Saver — ${mode === "automatic" ? "Automatic" : "Manual"} checking`)
    }
  }
  const applySnapshot = (snapshot) => {
    const settings = snapshot && Array.isArray(snapshot.settings)
      ? snapshot.settings
      : []
    const setting = settings.find((item) => item && item.app === app)
    setMode(setting && setting.mode)
  }

  setMode(status.dataset.mode)
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
