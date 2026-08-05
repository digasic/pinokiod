const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

const root = path.resolve(__dirname, "..")

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for the automatic check tray.")
}

test("the shared layout renders and reviews automatic possible-match notices", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "layout.ejs"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "layout.js"), "utf8")
  const html = ejs.render(template, {
    theme: "light",
    agent: "web",
    initialPath: "/home",
    defaultPath: "/home",
    sessionId: null,
    vaultEnabled: true
  })
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/"
  })
  const requests = []
  const eventSources = []
  dom.window.EventSource = class EventSource {
    constructor(url) {
      this.url = url
      eventSources.push(this)
    }
    close() {}
  }
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url === "/info/vault/automatic-scans") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enabled: true,
          global_scan_ready: true,
          rows: []
        })
      }
    }
    if (url === "/vault/action") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          reviewed: true,
          href: "/v/ComfyUI?pinokio_home_select=%7B%22selector%22%3A%22%23save-space-tab%22%7D"
        })
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  dom.window.eval(script)
  await waitFor(() => eventSources.length === 1)
  eventSources[0].onmessage({
    data: JSON.stringify({
      enabled: true,
      global_scan_ready: false,
      rows: [{
        app: "ComfyUI",
        state: "checking",
        notice_id: "checking:0:"
      }]
    })
  })
  assert.equal(dom.window.document.getElementById(
    "vault-auto-scan-tray").hidden, true)
  assert.equal(dom.window.document.querySelector(
    ".vault-auto-scan-row"), null)
  eventSources[0].onmessage({
    data: JSON.stringify({
      enabled: true,
      global_scan_ready: true,
      rows: [{
        app: "ComfyUI",
        state: "result",
        notice_id: "result:1:result-a"
      }]
    })
  })
  await waitFor(() => dom.window.document.querySelector(
    ".vault-auto-scan-row"))

  const tray = dom.window.document.getElementById("vault-auto-scan-tray")
  assert.equal(tray.hidden, false)
  assert.equal(tray.querySelector(
    ".vault-auto-scan-app").textContent, "ComfyUI")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-detail").textContent, "may have duplicate files")
  assert.equal(tray.querySelector(".vault-auto-scan-value"), null)
  assert.equal(tray.querySelector(
    ".vault-auto-scan-action").textContent, "Review")
  assert.ok(tray.querySelector(".vault-auto-scan-close"))
  assert.equal(eventSources[0].url,
    "/info/vault/automatic-scans/events")

  tray.querySelector(".vault-auto-scan-action").click()
  await waitFor(() => {
    const iframe = dom.window.document.querySelector(".layout-leaf iframe")
    return iframe && iframe.getAttribute("src") ===
      "/v/ComfyUI?pinokio_home_select=%7B%22selector%22%3A%22%23save-space-tab%22%7D"
  })
  assert.equal(tray.hidden, true)
  assert.equal(dom.window.sessionStorage.getItem(
    "pinokio:vault:auto-review:ComfyUI"), "1")
  const actionRequest = requests.find((request) =>
    request && request.url === "/vault/action")
  assert.deepEqual(JSON.parse(actionRequest.options.body), {
    action: "automatic_review",
    app: "ComfyUI",
    notice_id: "result:1:result-a"
  })
  assert.equal(requests.some((request) =>
    request && request.url === "/info/vault/automatic-scans"), false)
  assert.match(script, /window\.location\.assign\(/)
  assert.ok(script.indexOf("if (!openAutomaticReview(row.app, result.href))") <
    script.indexOf("removeRow(item);", script.indexOf(
      "if (!openAutomaticReview(row.app, result.href))")))

  dom.window.close()
})

test("checking notices expose settings, Pause, and dismissal", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "layout.ejs"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "layout.js"), "utf8")
  const html = ejs.render(template, {
    theme: "light",
    agent: "web",
    initialPath: "/v/ComfyUI",
    defaultPath: "/home",
    sessionId: null,
    vaultEnabled: true
  })
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/"
  })
  const requests = []
  const eventSources = []
  dom.window.EventSource = class EventSource {
    constructor(url) {
      this.url = url
      eventSources.push(this)
    }
    close() {}
  }
  dom.window.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null
    requests.push({ url, payload })
    if (url === "/vault/action") {
      return {
        ok: true,
        status: 200,
        json: async () => payload.action === "automatic_settings"
          ? {
              app: "ComfyUI",
              href: "/v/ComfyUI?pinokio_home_select=%7B%22selector%22%3A%22%23save-space-tab%22%7D"
            }
          : { dismissed: true, app: "ComfyUI" }
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  dom.window.eval(script)
  await waitFor(() => eventSources.length === 1)
  eventSources[0].onmessage({
    data: JSON.stringify({
      enabled: true,
      global_scan_ready: true,
      rows: [{
        app: "ComfyUI",
        state: "checking",
        savings: 0,
        notice_id: "checking:1:"
      }]
    })
  })
  await waitFor(() => dom.window.document.querySelector(
    ".vault-auto-scan-row"))

  const tray = dom.window.document.getElementById("vault-auto-scan-tray")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-app").textContent, "ComfyUI")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-status").textContent,
  "Checking for possible duplicate files…")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-settings").textContent,
  "Automatic check settings")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-action").textContent, "Pause")

  tray.querySelector(".vault-auto-scan-settings").click()
  await waitFor(() => requests.some((request) =>
    request.payload && request.payload.action === "automatic_settings"))
  const iframe = dom.window.document.querySelector(".layout-leaf iframe")
  await waitFor(() => iframe.getAttribute("src") ===
    "/v/ComfyUI?pinokio_home_select=%7B%22selector%22%3A%22%23save-space-tab%22%7D")
  assert.equal(dom.window.sessionStorage.getItem(
    "pinokio:vault:auto-settings:ComfyUI"), "1")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-settings").disabled, false)

  const relayed = []
  iframe.contentWindow.postMessage = (message, targetOrigin) => {
    relayed.push({ message, targetOrigin })
  }
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { e: "vault-auto-settings-ready" },
    origin: dom.window.location.origin,
    source: iframe.contentWindow
  }))
  tray.querySelector(".vault-auto-scan-settings").click()
  await waitFor(() => relayed.length === 1)
  assert.equal(relayed[0].message.e, "vault-auto-settings")
  assert.equal(relayed[0].targetOrigin, dom.window.location.origin)

  tray.querySelector(".vault-auto-scan-close").click()
  await waitFor(() => tray.hidden)
  assert.ok(requests.some((request) =>
    request.payload && request.payload.action === "automatic_dismiss" &&
      request.payload.notice_id === "checking:1:"))
  dom.window.close()
})

test("an empty automatic check briefly confirms completion", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "layout.ejs"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "layout.js"), "utf8")
  const html = ejs.render(template, {
    theme: "light",
    agent: "web",
    initialPath: "/v/ComfyUI",
    defaultPath: "/home",
    sessionId: null,
    vaultEnabled: true
  })
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/"
  })
  const eventSources = []
  const requests = []
  const completionTimers = []
  const nativeSetTimeout = dom.window.setTimeout.bind(dom.window)
  const nativeClearTimeout = dom.window.clearTimeout.bind(dom.window)
  dom.window.setTimeout = (callback, delay, ...args) => {
    if (delay <= 4000 && delay > 3500) {
      const timer = {
        callback,
        delay,
        cleared: false,
        id: 10000 + completionTimers.length
      }
      completionTimers.push(timer)
      return timer.id
    }
    return nativeSetTimeout(callback, delay, ...args)
  }
  dom.window.clearTimeout = (id) => {
    const timer = completionTimers.find((candidate) => candidate.id === id)
    if (timer) {
      timer.cleared = true
      return
    }
    nativeClearTimeout(id)
  }
  dom.window.EventSource = class EventSource {
    constructor(url) {
      this.url = url
      eventSources.push(this)
    }
    close() {}
  }
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url === "/info/vault/automatic-scans") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enabled: true,
          global_scan_ready: true,
          rows: [],
          settings: [{ app: "ComfyUI", mode: "automatic" }]
        })
      }
    }
    if (url === "/vault/action") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ dismissed: true, app: "ComfyUI" })
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  dom.window.eval(script)
  await waitFor(() => eventSources.length === 1)
  const send = (payload) => eventSources[0].onmessage({
    data: JSON.stringify(Object.assign({ global_scan_ready: true }, payload))
  })

  send({
    enabled: true,
    rows: [],
    settings: [{ app: "ComfyUI", mode: "automatic" }],
    completion: {
      app: "ComfyUI",
      outcome: "no_possible_duplicates"
    }
  })
  const tray = dom.window.document.getElementById("vault-auto-scan-tray")
  assert.equal(tray.hidden, true,
    "a completion event cannot appear without a visible checking row")

  send({
    enabled: true,
    rows: [
      {
        app: "ComfyUI",
        state: "checking",
        notice_id: "checking:1:"
      },
      {
        app: "OtherApp",
        state: "paused",
        notice_id: "paused:1:"
      }
    ],
    settings: [
      { app: "ComfyUI", mode: "automatic" },
      { app: "OtherApp", mode: "manual" }
    ]
  })
  send({
    enabled: true,
    rows: [{
      app: "OtherApp",
      state: "paused",
      notice_id: "paused:1:"
    }],
    settings: [
      { app: "ComfyUI", mode: "automatic" },
      { app: "OtherApp", mode: "manual" }
    ],
    completion: {
      app: "ComfyUI",
      outcome: "no_possible_duplicates"
    }
  })

  const completed = tray.querySelector(
    '.vault-auto-scan-row[data-state="complete"]')
  assert.ok(completed)
  assert.equal(completed.querySelector(
    ".vault-auto-scan-app").textContent, "ComfyUI")
  assert.equal(completed.querySelector(
    ".vault-auto-scan-status").textContent,
  "No possible duplicate files found")
  assert.ok(completed.querySelector(".vault-auto-scan-icon svg"))
  assert.equal(completed.querySelector(".vault-auto-scan-settings"), null)
  assert.equal(completed.querySelector(".vault-auto-scan-action"), null)
  assert.equal(completionTimers[0].delay, 4000)

  tray.querySelector(
    '.vault-auto-scan-row[data-state="paused"] .vault-auto-scan-action').click()
  await waitFor(() => requests.some((request) =>
    request.url === "/info/vault/automatic-scans"))
  await new Promise((resolve) => nativeSetTimeout(resolve, 0))
  assert.equal(completed.isConnected, true,
    "refreshing durable tray state preserves an active completion")
  assert.equal(completionTimers.length, 1,
    "a durable state refresh does not restart the completion timer")

  completed.dispatchEvent(new dom.window.MouseEvent("mouseenter"))
  assert.equal(completionTimers[0].cleared, true)
  completed.dispatchEvent(new dom.window.MouseEvent("mouseleave"))
  assert.equal(completionTimers.length, 2)
  assert.ok(completionTimers[1].delay <= 4000)

  const closeButton = completed.querySelector(".vault-auto-scan-close")
  closeButton.dispatchEvent(new dom.window.FocusEvent("focusin", {
    bubbles: true
  }))
  assert.equal(completionTimers[1].cleared, true)
  closeButton.dispatchEvent(new dom.window.FocusEvent("focusout", {
    bubbles: true,
    relatedTarget: null
  }))
  assert.equal(completionTimers.length, 3)
  completionTimers[2].callback()
  assert.equal(tray.hidden, true)

  send({
    enabled: true,
    rows: [{
      app: "ComfyUI",
      state: "checking",
      notice_id: "checking:2:"
    }],
    settings: [{ app: "ComfyUI", mode: "automatic" }]
  })
  send({
    enabled: true,
    rows: [],
    settings: [{ app: "ComfyUI", mode: "automatic" }],
    completion: {
      app: "ComfyUI",
      outcome: "no_possible_duplicates"
    }
  })
  assert.equal(tray.hidden, false)
  eventSources[0].onerror()
  await new Promise((resolve) => nativeSetTimeout(resolve, 0))
  assert.equal(tray.hidden, true,
    "a reconnect drops presentation-only completion state")

  send({
    enabled: true,
    rows: [{
      app: "ComfyUI",
      state: "checking",
      notice_id: "checking:3:"
    }],
    settings: [{ app: "ComfyUI", mode: "automatic" }]
  })
  tray.querySelector(".vault-auto-scan-close").click()
  send({
    enabled: true,
    rows: [],
    settings: [{ app: "ComfyUI", mode: "automatic" }],
    completion: {
      app: "ComfyUI",
      outcome: "no_possible_duplicates"
    }
  })
  await waitFor(() => tray.hidden)
  assert.equal(tray.querySelector(
    '.vault-auto-scan-row[data-state="complete"]'), null,
  "a closed checking row cannot be replaced by completion")
  assert.ok(requests.some((request) => {
    if (request.url !== "/vault/action" || !request.options.body) return false
    const payload = JSON.parse(request.options.body)
    return payload.action === "automatic_dismiss" &&
      payload.notice_id === "checking:3:"
  }))

  dom.window.close()
})

test("the shared layout does not initialize automatic notices when Vault is disabled", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "layout.ejs"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "layout.js"), "utf8")
  const html = ejs.render(template, {
    theme: "light",
    agent: "web",
    initialPath: "/home",
    defaultPath: "/home",
    sessionId: null,
    vaultEnabled: false
  })
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/"
  })
  let fetched = false
  dom.window.fetch = async () => {
    fetched = true
    throw new Error("Vault state must not be requested when disabled.")
  }
  dom.window.eval(script)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(fetched, false)
  assert.equal(dom.window.document.getElementById(
    "vault-auto-scan-tray").hidden, true)
  dom.window.close()
})

test("the automatic check event stream handles disconnects before initialization", async () => {
  const source = await fs.promises.readFile(
    path.join(root, "server", "index.js"), "utf8")
  const routeStart = source.indexOf(
    'this.app.get("/info/vault/automatic-scans/events"')
  const routeEnd = source.indexOf(
    "// Vault dashboard data", routeStart)
  const route = source.slice(routeStart, routeEnd)

  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.ok(route.indexOf('req.once("close", close)') <
    route.indexOf("await vault.automaticScanStatus()"))
  assert.ok(route.indexOf("if (disconnected()) return") <
    route.indexOf("vault.automaticScans.subscribe(send)"))
})

test("the app workspace focuses Scan this app without starting it after Review", async () => {
  const source = await fs.promises.readFile(
    path.join(root, "server", "public", "vault.js"), "utf8")

  assert.match(source,
    /pinokio:vault:auto-review:\$\{encodeURIComponent\(APP_NAME\)\}/)
  assert.match(source,
    /state\.automaticReviewRequested && !activeScan &&\s*!scanButton\.disabled/)
  assert.match(source,
    /scanActive\(state\.data && state\.data\.scan\)/)
  assert.match(source, /state\.automaticReviewRequested = false/)
  assert.match(source, /scanButton\.focus\(\)/)
  assert.doesNotMatch(source,
    /automaticReviewRequested[\s\S]{0,200}(post\(|btn-scan\.click)/)
})

test("the app sidebar mirrors Automatic and Manual Disk Saver modes", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "app.ejs"), "utf8")
  const server = await fs.promises.readFile(
    path.join(root, "server", "index.js"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const dom = new JSDOM(`<a id="save-space-tab">
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic" data-ready="true">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a>`, {
    runScripts: "outside-only",
    url: "http://localhost/v/ComfyUI"
  })
  const eventSources = []
  dom.window.EventSource = class EventSource {
    constructor(url) {
      this.url = url
      eventSources.push(this)
    }
    close() {}
  }

  dom.window.eval(script)
  const status = dom.window.document.querySelector("[data-app-vault-mode]")
  const label = status.querySelector("[data-app-vault-mode-label]")
  assert.equal(eventSources.length, 1)
  assert.equal(eventSources[0].url,
    "/info/vault/automatic-scans/events")
  assert.equal(status.dataset.mode, "automatic")
  assert.equal(status.hidden, false)
  assert.equal(label.textContent, "Auto")
  assert.equal(dom.window.document.getElementById("save-space-tab")
    .getAttribute("aria-label"), "Disk Saver — Automatic checking")

  eventSources[0].onmessage({
    data: JSON.stringify({
      global_scan_ready: true,
      settings: [{ app: "ComfyUI", mode: "manual" }]
    })
  })
  assert.equal(status.dataset.mode, "manual")
  assert.equal(status.hidden, false)
  assert.equal(label.textContent, "Manual")
  assert.equal(dom.window.document.getElementById("save-space-tab")
    .getAttribute("aria-label"), "Disk Saver — Manual checking")

  eventSources[0].onmessage({
    data: JSON.stringify({ global_scan_ready: true, settings: [] })
  })
  assert.equal(status.dataset.mode, "automatic")
  assert.equal(status.hidden, false)
  assert.equal(label.textContent, "Auto")

  eventSources[0].onmessage({
    data: JSON.stringify({
      global_scan_ready: false,
      settings: [{ app: "ComfyUI", mode: "automatic" }]
    })
  })
  assert.equal(status.dataset.ready, "false")
  assert.equal(label.textContent, "Set up")
  assert.equal(dom.window.document.getElementById("save-space-tab")
    .getAttribute("aria-label"), "Disk Saver — Set up required")

  eventSources[0].onmessage({
    data: JSON.stringify({
      global_scan_ready: true,
      settings: [{ app: "ComfyUI", mode: "automatic" }]
    })
  })
  assert.equal(status.dataset.ready, "true")
  assert.equal(label.textContent, "Auto")
  assert.match(template, /data-app-vault-mode/)
  assert.match(template, /app-vault-mode\.js/)
  assert.match(template,
    /#save-space-tab\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s)
  assert.match(template,
    /\.app-vault-mode\s*\{[^}]*margin-left:\s*auto;[^}]*font-size:\s*12px;[^}]*font-weight:\s*500;/s)
  assert.match(template,
    /\.app-vault-mode-chevron,\s*\.app-autolaunch-chevron\s*\{[^}]*width:\s*10px;[^}]*flex:\s*0 0 10px;/s)
  assert.doesNotMatch(template,
    /\.app-vault-mode\s*\{[^}]*(background|border-radius|padding):/s)
  assert.match(template,
    /vaultAutomaticMode === 'automatic' \? 'Auto' : 'Manual'/)
  assert.match(template,
    /fa-solid fa-angle-down app-vault-mode-chevron/)
  assert.match(template,
    /autolaunch_app\.autolaunch_enabled \? 'On' : 'Off'/)
  assert.match(template,
    /\.app-autolaunch-status\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*500;[^}]*letter-spacing:\s*0;/s)
  assert.doesNotMatch(template, /data-app-vault-mode[^>]*hidden/)
  assert.doesNotMatch(template, /app-vault-mode-dot/)
  assert.match(server,
    /result\.vault_automatic_mode = setting && setting\.mode === "manual"/)
  assert.match(server, /result\.vault_global_scan_ready/)

  dom.window.close()
})
