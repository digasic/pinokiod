const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

const root = path.resolve(__dirname, "..")
const plain = (value) => JSON.parse(JSON.stringify(value))

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for automatic scan state.")
}

test("the shared layout relays verified results without notification UI", async () => {
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
  const eventSources = []
  dom.window.EventSource = class EventSource {
    constructor(url) {
      this.url = url
      eventSources.push(this)
    }
    close() {}
  }
  dom.window.fetch = async (url) => {
    throw new Error(`Unexpected request: ${url}`)
  }

  dom.window.eval(script)
  await waitFor(() => eventSources.length === 1)
  const layoutFrame = dom.window.document.querySelector(".layout-leaf iframe")
  const stateMessages = []
  layoutFrame.contentWindow.postMessage = (payload, targetOrigin) => {
    stateMessages.push({ payload, targetOrigin })
  }
  eventSources[0].onmessage({
    data: JSON.stringify({
      enabled: true,
      global_scan_ready: false,
      rows: [{
        app: "ComfyUI",
        state: "checking",
        signature: "a".repeat(64)
      }]
    })
  })
  assert.equal(stateMessages.at(-1).payload.snapshot.rows.length, 0)
  eventSources[0].onmessage({
    data: JSON.stringify({
      enabled: true,
      global_scan_ready: true,
      settings: [{ app: "ComfyUI", mode: "manual" }],
      rows: [{
        app: "ComfyUI",
        state: "result",
        signature: "b".repeat(64)
      }]
    })
  })
  assert.equal(dom.window.document.getElementById("vault-auto-scan-tray"), null)
  assert.equal(dom.window.document.querySelector(".vault-auto-scan-row"), null)
  assert.doesNotMatch(template, /vault-auto-scan-(tray|row|action)/)
  assert.doesNotMatch(script, /createCard|automatic_dismiss/)
  assert.equal(eventSources[0].url,
    "/info/vault/automatic-scans/events")
  assert.deepEqual(plain(stateMessages.at(-1)), {
    payload: {
      e: "vault-automatic-scan-state",
      snapshot: {
        global_scan_ready: true,
        rows: [{
          app: "ComfyUI",
          state: "result",
          signature: "b".repeat(64)
        }],
        settings: [{ app: "ComfyUI", mode: "manual" }]
      }
    },
    targetOrigin: "http://localhost"
  })
  const messagesBeforeReplay = stateMessages.length
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { e: "vault-automatic-scan-state-request" },
    origin: "http://localhost",
    source: layoutFrame.contentWindow
  }))
  assert.equal(stateMessages.length, messagesBeforeReplay + 1)
  assert.deepEqual(plain(stateMessages.at(-1).payload),
    plain(stateMessages.at(-2).payload))

  dom.window.close()
})

test("the shared layout does not initialize automatic status when Vault is disabled", async () => {
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
  assert.equal(dom.window.document.getElementById("vault-auto-scan-tray"), null)
  dom.window.close()
})

test("the shared layout exposes no automatic result transport on Linux", async () => {
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
    vaultEnabled: true,
    vaultAutomaticSupported: false
  })
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/"
  })
  dom.window.EventSource = class EventSource {
    constructor() {
      throw new Error("Linux must not open an automatic status stream.")
    }
  }
  dom.window.fetch = async () => {
    throw new Error("Linux must not fetch automatic status.")
  }

  dom.window.eval(script)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(dom.window.document.getElementById("vault-auto-scan-tray"), null)
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
    route.indexOf("vault.automaticScans.subscribe(send, reconnect)"))
  assert.match(route,
    /vault\.automaticScans\.subscribe\(send, reconnect\)/)
})

test("the app workspace presents the automatic-result coachmark without starting a scan", async () => {
  const source = await fs.promises.readFile(
    path.join(root, "server", "public", "vault.js"), "utf8")
  const workspace = await fs.promises.readFile(
    path.join(root, "server", "views", "partials", "vault_workspace.ejs"),
    "utf8")
  const presentStart = source.indexOf(
    "const presentAutomaticScanCoachmark")
  const presentEnd = source.indexOf(
    "const syncAutomaticScanCoachmark", presentStart)
  const present = source.slice(presentStart, presentEnd)

  assert.match(source,
    /pinokio:vault:auto-scan-focus:\$\{encodeURIComponent\(APP_NAME\)\}/)
  assert.match(source, /automaticScanCoachmarkSeen/)
  assert.match(source, /automaticScanPendingSignature/)
  assert.match(source,
    /scanActive\(state\.data && state\.data\.scan\)/)
  assert.match(source, /scanButton\.focus\(\)/)
  assert.match(workspace, /Automatic checking found possible duplicates/)
  assert.match(workspace, /Scanning may use CPU for a few minutes/)
  assert.match(workspace, /id='vault-scan-coachmark-action'/)
  assert.match(present,
    /actionLabel\.textContent = scanButton\.textContent\.trim\(\)/)
  assert.doesNotMatch(present, /innerHTML|post\(|btn-scan\.click/)
})

test("selecting a badged row acknowledges it without delaying navigation", async () => {
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const parent = new JSDOM("", { url: "http://localhost/" })
  const dom = new JSDOM(`<a id="save-space-tab" href="/vault/app/ComfyUI" target="app-vault">
    <span data-app-vault-result-badge></span>
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic"
      data-ready="true" data-result-signature="${"a".repeat(64)}">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a><iframe name="app-vault" src="/vault/app/ComfyUI"></iframe>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/v/ComfyUI"
  })
  Object.defineProperty(dom.window, "parent", {
    configurable: true,
    value: parent.window
  })
  parent.window.postMessage = () => {}
  const focusMessages = []
  dom.window.document.querySelector('iframe[name="app-vault"]')
    .contentWindow.postMessage = (payload, targetOrigin) => {
      focusMessages.push({ payload, targetOrigin })
    }
  const requests = []
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ acknowledged: true, app: "ComfyUI" })
    }
  }

  dom.window.eval(script)
  const tab = dom.window.document.getElementById("save-space-tab")
  let preventedByHandler = null
  tab.addEventListener("click", (event) => {
    preventedByHandler = event.defaultPrevented
    event.preventDefault()
  })
  tab.click()

  await waitFor(() => requests.length === 1)
  assert.equal(preventedByHandler, false)
  assert.equal(tab.querySelector("[data-app-vault-result-badge]").hidden, true)
  assert.equal(dom.window.sessionStorage.getItem(
    "pinokio:vault:auto-scan-focus:ComfyUI"), "a".repeat(64))
  assert.deepEqual(plain(focusMessages), [{
    payload: {
      e: "vault-automatic-scan-focus",
      app: "ComfyUI",
      signature: "a".repeat(64)
    },
    targetOrigin: "http://localhost"
  }])
  assert.equal(requests[0].url, "/vault/action")
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    action: "automatic_acknowledge",
    app: "ComfyUI",
    signature: "a".repeat(64)
  })

  dom.window.close()
  parent.window.close()
})

test("a retained Disk Saver handoff targets the visible existing frame", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "app.ejs"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const retainedStart = template.indexOf(
    'target.dataset.static === "retain"')
  const retainedEnd = template.indexOf("/*", retainedStart)
  const retainedResolution = template.slice(retainedStart, retainedEnd)

  assert.ok(retainedStart >= 0)
  assert.match(retainedResolution,
    /main\.browserview iframe\[name="\$\{escapedFrameName\}"\]/)

  const signature = "f".repeat(64)
  const parent = new JSDOM("", { url: "http://localhost/" })
  const dom = new JSDOM(`<a id="save-space-tab" href="/vault/app/ComfyUI" target="app-vault">
    <span data-app-vault-result-badge></span>
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic"
      data-ready="true" data-result-signature="${signature}">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a><main class="browserview">
    <iframe id="hidden-vault" class="hidden" name="app-vault" src="/vault/app/ComfyUI"></iframe>
    <iframe id="visible-vault" name="app-vault" src="/vault/app/ComfyUI"></iframe>
  </main>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/v/ComfyUI"
  })
  Object.defineProperty(dom.window, "parent", {
    configurable: true,
    value: parent.window
  })
  parent.window.postMessage = () => {}
  const hiddenMessages = []
  const visibleMessages = []
  dom.window.document.getElementById("hidden-vault")
    .contentWindow.postMessage = (payload) => hiddenMessages.push(payload)
  dom.window.document.getElementById("visible-vault")
    .contentWindow.postMessage = (payload) => visibleMessages.push(payload)
  dom.window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ acknowledged: true, app: "ComfyUI" })
  })

  dom.window.eval(script)
  dom.window.document.getElementById("save-space-tab").click()
  await waitFor(() => visibleMessages.length === 1)

  assert.deepEqual(hiddenMessages, [])
  assert.deepEqual(plain(visibleMessages), [{
    e: "vault-automatic-scan-focus",
    app: "ComfyUI",
    signature
  }])

  dom.window.close()
  parent.window.close()
})

test("the app sidebar mirrors the shared layout state without another event stream", async () => {
  const template = await fs.promises.readFile(
    path.join(root, "server", "views", "app.ejs"), "utf8")
  const server = await fs.promises.readFile(
    path.join(root, "server", "index.js"), "utf8")
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const vaultScript = await fs.promises.readFile(
    path.join(root, "server", "public", "vault.js"), "utf8")
  const parent = new JSDOM("", { url: "http://localhost/" })
  const dom = new JSDOM(`<a id="save-space-tab">
    <span data-app-vault-result-badge hidden></span>
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic"
      data-ready="true" data-result-signature="">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a><iframe name="app-vault"></iframe>`, {
    runScripts: "outside-only",
    url: "http://localhost/v/ComfyUI"
  })
  const parentMessages = []
  const vaultMessages = []
  Object.defineProperty(dom.window, "parent", {
    configurable: true,
    value: parent.window
  })
  parent.window.postMessage = (payload, targetOrigin) => {
    parentMessages.push({ payload, targetOrigin })
  }
  const vaultFrame = dom.window.document.querySelector(
    'iframe[name="app-vault"]')
  vaultFrame.contentWindow.postMessage = (payload, targetOrigin) => {
    vaultMessages.push({ payload, targetOrigin })
  }
  dom.window.EventSource = class EventSource {
    constructor() {
      throw new Error("An app page must not open an EventSource.")
    }
  }
  dom.window.fetch = async () => {
    throw new Error("The parent replay arrived; no fallback fetch is needed.")
  }

  dom.window.eval(script)
  const status = dom.window.document.querySelector("[data-app-vault-mode]")
  const label = status.querySelector("[data-app-vault-mode-label]")
  const badge = dom.window.document.querySelector(
    "[data-app-vault-result-badge]")
  const tab = dom.window.document.getElementById("save-space-tab")
  assert.deepEqual(plain(parentMessages), [{
    payload: { e: "vault-automatic-scan-state-request" },
    targetOrigin: "http://localhost"
  }])
  assert.equal(status.dataset.mode, "automatic")
  assert.equal(status.hidden, false)
  assert.equal(label.textContent, "Auto")
  assert.equal(dom.window.document.getElementById("save-space-tab")
    .getAttribute("aria-label"), "Disk Saver — Automatic checking")

  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: parent.window,
    origin: "http://localhost",
    data: {
      e: "vault-automatic-scan-state",
      snapshot: {
        global_scan_ready: true,
        rows: [{
          app: "ComfyUI",
          state: "result",
          signature: "b".repeat(64)
        }],
        settings: [{ app: "ComfyUI", mode: "manual" }]
      }
    }
  }))
  assert.equal(status.dataset.mode, "manual")
  assert.equal(status.hidden, false)
  assert.equal(label.textContent, "Manual")
  assert.equal(badge.hidden, false)
  assert.equal(tab.classList.contains("app-vault-result-attention"), true)
  assert.equal(tab.getAttribute("aria-label"),
    "Disk Saver — Manual checking — Duplicate files found")
  assert.deepEqual(plain(vaultMessages.at(-1)), {
    payload: {
      e: "vault-automatic-scan-state",
      snapshot: {
        global_scan_ready: true,
        rows: [{
          app: "ComfyUI",
          state: "result",
          signature: "b".repeat(64)
        }],
        settings: [{ app: "ComfyUI", mode: "manual" }]
      }
    },
    targetOrigin: "http://localhost"
  })

  const animationEnd = new dom.window.Event("animationend")
  Object.defineProperty(animationEnd, "animationName", {
    value: "app-vault-result-attention"
  })
  tab.dispatchEvent(animationEnd)
  assert.equal(tab.classList.contains("app-vault-result-attention"), false)
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: parent.window,
    origin: "http://localhost",
    data: {
      e: "vault-automatic-scan-state",
      snapshot: {
        global_scan_ready: true,
        rows: [{
          app: "ComfyUI",
          state: "result",
          signature: "b".repeat(64)
        }],
        settings: [{ app: "ComfyUI", mode: "manual" }]
      }
    }
  }))
  assert.equal(tab.classList.contains("app-vault-result-attention"), false)

  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: vaultFrame.contentWindow,
    origin: "http://localhost",
    data: {
      e: "vault-automatic-mode-changed",
      app: "ComfyUI",
      mode: "automatic"
    }
  }))
  assert.equal(status.dataset.ready, "true")
  assert.equal(status.dataset.mode, "automatic")
  assert.equal(label.textContent, "Auto")
  assert.equal(badge.hidden, false)
  assert.deepEqual(plain(parentMessages.at(-1)), {
    payload: {
      e: "vault-automatic-mode-changed",
      app: "ComfyUI",
      mode: "automatic"
    },
    targetOrigin: "http://localhost"
  })

  const repliesBeforeRequest = vaultMessages.length
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: vaultFrame.contentWindow,
    origin: "http://localhost",
    data: { e: "vault-automatic-scan-state-request" }
  }))
  assert.equal(vaultMessages.length, repliesBeforeRequest + 1)
  assert.equal(vaultMessages.at(-1).payload.snapshot.settings[0].mode,
    "automatic")
  assert.equal(vaultMessages.at(-1).payload.snapshot.rows[0].signature,
    "b".repeat(64))
  assert.match(template, /data-app-vault-mode/)
  assert.match(template, /data-app-vault-result-badge/)
  assert.match(template,
    /class="app-vault-result-badge"[\s\S]{0,200}>New<\/span>/)
  assert.match(template,
    /\.app-vault-result-badge\s*\{[^}]*color:\s*#fff;[^}]*background:\s*#b91c1c;/s)
  assert.match(template,
    /body\.dark \.app-vault-result-badge\s*\{[^}]*background:\s*#dc2626;/s)
  assert.match(template,
    /#save-space-tab::before\s*\{[^}]*background:\s*var\(--pinokio-sidebar-notice-flash-bg\);/s)
  assert.doesNotMatch(template,
    /\.app-vault-result-badge\s*\{[^}]*border-radius:\s*50%/s)
  assert.match(template, /app-vault-mode\.js/)
  assert.doesNotMatch(template, /vault-auto-settings/)
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
  assert.match(template, /@keyframes app-vault-result-attention/)
  assert.match(template,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*app-vault-result-attention/)
  assert.match(server,
    /result\.vault_automatic_mode = setting && setting\.mode === "manual"/)
  assert.match(server, /result\.vault_global_scan_ready/)
  assert.match(server, /result\.vault_automatic_result_signature/)
  assert.doesNotMatch(script, /EventSource/)
  assert.doesNotMatch(vaultScript, /EventSource/)
  assert.match(script, /vault-automatic-scan-state-request/)
  assert.match(vaultScript, /vault-automatic-scan-state-request/)

  dom.window.close()
  parent.window.close()
})

test("a standalone app restores its result badge with one finite request", async () => {
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const dom = new JSDOM(`<a id="save-space-tab">
    <span data-app-vault-result-badge hidden></span>
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic"
      data-ready="true" data-result-signature="">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a>`, {
    runScripts: "outside-only",
    url: "http://localhost/v/ComfyUI"
  })
  const requests = []
  dom.window.fetch = async (url) => {
    requests.push(url)
    return {
      ok: true,
      json: async () => ({
        global_scan_ready: true,
        rows: [{
          app: "ComfyUI",
          state: "result",
          signature: "c".repeat(64)
        }],
        settings: [{ app: "ComfyUI", mode: "manual" }]
      })
    }
  }
  dom.window.EventSource = class EventSource {
    constructor() {
      throw new Error("A standalone app must not open an EventSource.")
    }
  }

  dom.window.eval(script)
  await waitFor(() => dom.window.document.querySelector(
    "[data-app-vault-result-badge]").hidden === false)
  assert.deepEqual(requests, ["/info/vault/automatic-scans"])
  assert.equal(dom.window.document.querySelector(
    "[data-app-vault-mode]").dataset.mode, "manual")
  assert.equal(dom.window.document.getElementById("save-space-tab")
    .getAttribute("aria-label"),
  "Disk Saver — Manual checking — Duplicate files found")

  dom.window.close()
})

test("a late parent state is not overwritten by the app badge fallback", async () => {
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const parent = new JSDOM("", { url: "http://localhost/" })
  const dom = new JSDOM(`<a id="save-space-tab">
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic" data-ready="true">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a>`, {
    runScripts: "outside-only",
    url: "http://localhost/v/ComfyUI"
  })
  Object.defineProperty(dom.window, "parent", {
    configurable: true,
    value: parent.window
  })
  parent.window.postMessage = () => {}
  const setTimeout = dom.window.setTimeout.bind(dom.window)
  dom.window.setTimeout = (callback, delay, ...args) =>
    setTimeout(callback, delay === 500 ? 0 : delay, ...args)
  let resolveFallback
  dom.window.fetch = () => new Promise((resolve) => {
    resolveFallback = resolve
  })

  dom.window.eval(script)
  await waitFor(() => typeof resolveFallback === "function")
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: parent.window,
    origin: "http://localhost",
    data: {
      e: "vault-automatic-scan-state",
      snapshot: {
        global_scan_ready: true,
        settings: [{ app: "ComfyUI", mode: "manual" }]
      }
    }
  }))
  resolveFallback({
    ok: true,
    json: async () => ({
      global_scan_ready: true,
      settings: [{ app: "ComfyUI", mode: "automatic" }]
    })
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(dom.window.document.querySelector(
    "[data-app-vault-mode]").dataset.mode, "manual")
  dom.window.close()
  parent.window.close()
})

test("a stale parent replay cannot clear a server-rendered result", async () => {
  const script = await fs.promises.readFile(
    path.join(root, "server", "public", "app-vault-mode.js"), "utf8")
  const signature = "d".repeat(64)
  const parent = new JSDOM("", { url: "http://localhost/" })
  const dom = new JSDOM(`<a id="save-space-tab">
    <span data-app-vault-result-badge></span>
    <span data-app-vault-mode data-app="ComfyUI" data-mode="automatic"
      data-ready="true" data-result-signature="${signature}">
      <span data-app-vault-mode-label>Auto</span>
    </span>
  </a>`, {
    runScripts: "outside-only",
    url: "http://localhost/v/ComfyUI"
  })
  Object.defineProperty(dom.window, "parent", {
    configurable: true,
    value: parent.window
  })
  parent.window.postMessage = () => {}
  const requests = []
  dom.window.fetch = async (url) => {
    requests.push(url)
    return {
      ok: true,
      json: async () => ({
        global_scan_ready: true,
        rows: [{ app: "ComfyUI", state: "result", signature }],
        settings: [{ app: "ComfyUI", mode: "automatic" }]
      })
    }
  }

  dom.window.eval(script)
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: parent.window,
    origin: "http://localhost",
    data: {
      e: "vault-automatic-scan-state",
      snapshot: {
        global_scan_ready: true,
        rows: [],
        settings: []
      }
    }
  }))

  await waitFor(() => requests.length === 1)
  assert.deepEqual(requests, ["/info/vault/automatic-scans"])
  assert.equal(dom.window.document.querySelector(
    "[data-app-vault-result-badge]").hidden, false)
  assert.equal(dom.window.document.querySelector(
    "[data-app-vault-mode]").dataset.resultSignature, signature)

  dom.window.close()
  parent.window.close()
})
