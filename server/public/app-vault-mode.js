(() => {
  const status = document.querySelector("[data-app-vault-mode]")
  if (!status) return

  const app = status.dataset.app || ""
  const tab = status.closest("#save-space-tab")
  const label = status.querySelector("[data-app-vault-mode-label]")
  const badge = tab && tab.querySelector("[data-app-vault-result-badge]")
  const origin = window.location.origin
  let parentStateVersion = 0
  let fallbackTimer = null

  const normalizeSnapshot = (snapshot) => ({
    global_scan_ready: !!(snapshot && snapshot.global_scan_ready === true),
    rows: snapshot && Array.isArray(snapshot.rows)
      ? snapshot.rows.filter((row) =>
        row && row.state === "result" &&
        typeof row.app === "string" && row.app &&
        typeof row.signature === "string" && row.signature).map((row) => ({
          app: row.app,
          state: "result",
          signature: row.signature
        }))
      : [],
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
    rows: status.dataset.resultSignature
      ? [{ app, state: "result", signature: status.dataset.resultSignature }]
      : [],
    settings: [{ app, mode: status.dataset.mode }]
  })

  const setState = (value, ready, resultSignature = "") => {
    const mode = value === "manual" ? "manual" : "automatic"
    const globalScanReady = ready === true
    const previousResultSignature = status.dataset.resultSignature || ""
    const nextResultSignature = globalScanReady &&
      typeof resultSignature === "string"
      ? resultSignature
      : ""
    status.dataset.mode = mode
    status.dataset.ready = String(globalScanReady)
    status.dataset.resultSignature = nextResultSignature
    status.hidden = false
    if (label) {
      label.textContent = globalScanReady
        ? (mode === "automatic" ? "Auto" : "Manual")
        : "Set up"
    }
    if (tab) {
      const hasResult = !!nextResultSignature
      if (!hasResult) {
        tab.classList.remove("app-vault-result-attention")
      } else if (nextResultSignature !== previousResultSignature) {
        tab.classList.remove("app-vault-result-attention")
        void tab.offsetWidth
        tab.classList.add("app-vault-result-attention")
      }
      if (badge) badge.hidden = !hasResult
      tab.setAttribute("aria-label",
        globalScanReady
          ? `Disk Saver — ${mode === "automatic" ? "Automatic" : "Manual"} checking${hasResult ? " — Duplicate files found" : ""}`
          : "Disk Saver — Set up required")
    }
  }
  const applySnapshot = (snapshot) => {
    latestSnapshot = normalizeSnapshot(snapshot)
    const setting = latestSnapshot.settings.find((item) =>
      item.app === app)
    const result = latestSnapshot.rows.find((item) => item.app === app)
    setState(setting && setting.mode, latestSnapshot.global_scan_ready,
      result && result.signature)
  }
  const vaultFrame = () =>
    document.querySelector('main.browserview iframe[name="app-vault"]:not(.hidden)') ||
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
      rows: latestSnapshot.rows,
      settings
    })
  }
  const automaticScanFocusKey =
    `pinokio:vault:auto-scan-focus:${encodeURIComponent(app)}`
  const requestAutomaticScanFocus = (signature) => {
    if (!signature) return
    try { sessionStorage.setItem(automaticScanFocusKey, signature) } catch (_) {}
    const frame = vaultFrame()
    if (!frame || !tab || frame.src !== tab.href) return
    try {
      frame.contentWindow.postMessage({
        e: "vault-automatic-scan-focus",
        app,
        signature
      }, origin)
    } catch (_) {}
  }
  const acknowledgeResult = async (signature) => {
    try {
      const response = await fetch("/vault/action", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "automatic_acknowledge",
          app,
          signature
        })
      })
      if (!response.ok) throw new Error(`Disk Saver action failed (${response.status}).`)
      const result = await response.json()
      if (result && result.error) throw new Error(result.error)
      if (result && result.stale) await loadState()
    } catch (error) {
      console.warn("[Disk Saver] Automatic result acknowledgement failed", error)
      await loadState()
    }
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

  if (tab) {
    tab.addEventListener("animationend", (event) => {
      if (event.animationName === "app-vault-result-attention") {
        tab.classList.remove("app-vault-result-attention")
      }
    })
    tab.addEventListener("click", (event) => {
      if (!event.isTrusted) return
      const signature = status.dataset.resultSignature || ""
      if (!signature) return
      requestAutomaticScanFocus(signature)
      applySnapshot({
        global_scan_ready: latestSnapshot.global_scan_ready,
        rows: latestSnapshot.rows.filter((row) => row.app !== app),
        settings: latestSnapshot.settings
      })
      acknowledgeResult(signature)
    })
  }

  setState(status.dataset.mode, status.dataset.ready === "true",
    status.dataset.resultSignature)
  if (!app) return

  window.addEventListener("message", (event) => {
    if (!event || event.origin !== origin ||
        !event.data || typeof event.data !== "object") return
    if (event.data.e === "vault-automatic-scan-state" &&
        window.parent !== window && event.source === window.parent) {
      const firstParentState = parentStateVersion === 0
      parentStateVersion += 1
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      const snapshot = normalizeSnapshot(event.data.snapshot)
      const result = snapshot.rows.find((item) => item.app === app)
      const currentSignature = status.dataset.resultSignature || ""
      const parentSignature = result ? result.signature : ""
      if (firstParentState && currentSignature && currentSignature !== parentSignature) {
        loadState()
        return
      }
      applySnapshot(snapshot)
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
