(() => {
  const status = document.querySelector("[data-app-vault-mode]")
  if (!status) return

  const app = status.dataset.app || ""
  const tab = status.closest("#save-space-tab")
  const label = status.querySelector("[data-app-vault-mode-label]")
  const origin = window.location.origin
  let parentStateVersion = 0
  let fallbackTimer = null

  const normalizeSnapshot = (snapshot) => ({
    global_scan_ready: !!(snapshot && snapshot.global_scan_ready === true),
    settings: snapshot && Array.isArray(snapshot.settings)
      ? snapshot.settings.filter((setting) =>
        setting && typeof setting.app === "string" && setting.app).map((setting) => ({
          app: setting.app,
          mode: setting.mode === "manual" ? "manual" : "automatic"
        }))
      : []
  })
  let latestSnapshot = normalizeSnapshot({
    global_scan_ready: status.dataset.ready === "true",
    settings: [{ app, mode: status.dataset.mode }]
  })

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
    latestSnapshot = normalizeSnapshot(snapshot)
    const setting = latestSnapshot.settings.find((item) =>
      item.app === app)
    setState(setting && setting.mode, latestSnapshot.global_scan_ready)
  }
  const vaultFrame = () =>
    document.querySelector('iframe[name="app-vault"]')
  const sendSnapshot = (targetWindow) => {
    if (!targetWindow) return
    try {
      targetWindow.postMessage({
        e: "vault-automatic-scan-state",
        snapshot: latestSnapshot
      }, origin)
    } catch (_) {}
  }
  const relaySnapshot = () => {
    const frame = vaultFrame()
    if (frame) sendSnapshot(frame.contentWindow)
  }
  const mergeMode = (mode) => {
    const settings = latestSnapshot.settings.filter((setting) =>
      setting.app !== app)
    settings.push({
      app,
      mode: mode === "manual" ? "manual" : "automatic"
    })
    applySnapshot({
      global_scan_ready: latestSnapshot.global_scan_ready,
      settings
    })
  }
  const loadState = async () => {
    if (!app) return
    const requestedAtParentVersion = parentStateVersion
    try {
      const response = await fetch("/info/vault/automatic-scans", {
        credentials: "same-origin",
        cache: "no-store"
      })
      if (!response.ok) return
      const snapshot = await response.json()
      if (window.parent !== window &&
          parentStateVersion !== requestedAtParentVersion) return
      applySnapshot(snapshot)
      relaySnapshot()
    } catch (_) {}
  }

  setState(status.dataset.mode, status.dataset.ready === "true")
  if (!app) return

  window.addEventListener("message", (event) => {
    if (!event || event.origin !== origin ||
        !event.data || typeof event.data !== "object") return
    if (event.data.e === "vault-automatic-scan-state" &&
        window.parent !== window && event.source === window.parent) {
      parentStateVersion += 1
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      applySnapshot(event.data.snapshot)
      relaySnapshot()
      return
    }
    const frame = vaultFrame()
    if (!frame || frame.contentWindow !== event.source) return
    if (event.data.e === "vault-automatic-scan-state-request") {
      sendSnapshot(event.source)
      return
    }
    if (event.data.e === "vault-automatic-mode-changed" &&
        event.data.app === app) {
      mergeMode(event.data.mode)
      if (window.parent !== window) {
        try {
          window.parent.postMessage({
            e: "vault-automatic-mode-changed",
            app,
            mode: status.dataset.mode
          }, origin)
        } catch (_) {}
      }
    }
  })

  if (window.parent !== window) {
    try {
      window.parent.postMessage({
        e: "vault-automatic-scan-state-request"
      }, origin)
    } catch (_) {}
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null
      loadState()
    }, 500)
  } else {
    loadState()
  }
})()
