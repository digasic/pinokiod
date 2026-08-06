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
    ".vault-auto-scan-product").textContent, "Disk Saver")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-app").textContent, "ComfyUI")
  assert.equal(tray.querySelector(
    ".vault-auto-scan-status").textContent,
  "Possible duplicate files found")
  assert.equal(tray.querySelectorAll(
    ".vault-auto-scan-message").length, 1)
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
  assert.ok(script.indexOf("if (!openAutomaticReview(card.app, result.href))") <
    script.indexOf("removeCard(card.app);", script.indexOf(
      "if (!openAutomaticReview(card.app, result.href))")))

  dom.window.close()
})

test("automatic check states append within one card", async () => {
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
  const send = (rows, settings = []) => eventSources[0].onmessage({
    data: JSON.stringify({
      enabled: true,
      global_scan_ready: true,
      rows,
      settings
    })
  })
  const row = (state, noticeId) => ({
    app: "ComfyUI",
    state,
    notice_id: noticeId
  })

  send([row("checking", "checking:1:")])
  const tray = dom.window.document.getElementById("vault-auto-scan-tray")
  const card = tray.querySelector(".vault-auto-scan-row")
  assert.ok(card)

  send([row("paused", "paused:2:")], [
    { app: "ComfyUI", mode: "manual" }
  ])
  assert.equal(tray.querySelector(".vault-auto-scan-row"), card)
  assert.deepEqual([...card.querySelectorAll(".vault-auto-scan-status")]
    .map((status) => status.textContent), [
    "Checking for possible duplicate files...",
    "Automatic checks are paused"
  ])
  assert.equal(card.querySelectorAll(
    '.vault-auto-scan-message[data-current="true"]').length, 1)
  assert.equal(card.querySelector(
    '.vault-auto-scan-message[data-current="false"] button'), null)
  assert.equal(card.querySelector(
    ".vault-auto-scan-action").textContent, "Resume")

  send([row("checking", "checking:3:")], [
    { app: "ComfyUI", mode: "automatic" }
  ])
  assert.equal(tray.querySelector(".vault-auto-scan-row"), card)
  assert.equal(card.querySelectorAll(".vault-auto-scan-message").length, 3)
  assert.equal(card.querySelector(
    '.vault-auto-scan-message[data-current="true"] .vault-auto-scan-status')
    .textContent, "Checking again for possible duplicate files...")
  assert.equal(card.querySelector(
    ".vault-auto-scan-action").textContent, "Pause")

  send([row("result", "result:4:result-a")], [
    { app: "ComfyUI", mode: "automatic" }
  ])
  assert.equal(tray.querySelector(".vault-auto-scan-row"), card)
  assert.equal(card.querySelectorAll(".vault-auto-scan-message").length, 4)
  assert.equal(card.querySelector(
    '.vault-auto-scan-message[data-current="true"] .vault-auto-scan-status')
    .textContent, "Possible duplicate files found")
  assert.equal(card.querySelector(".vault-auto-scan-settings"), null)
  assert.equal(card.querySelector(
    ".vault-auto-scan-action").textContent, "Review")

  send([row("result", "result:4:result-a")], [
    { app: "ComfyUI", mode: "automatic" }
  ])
  assert.equal(card.querySelectorAll(".vault-auto-scan-message").length, 4,
    "repeated snapshots do not duplicate the current message")

  send([
    row("result", "result:4:result-a"),
    { app: "OtherApp", state: "checking", notice_id: "checking:5:" }
  ], [
    { app: "ComfyUI", mode: "automatic" },
    { app: "OtherApp", mode: "automatic" }
  ])
  assert.equal(tray.querySelectorAll(".vault-auto-scan-row").length, 2)
  assert.deepEqual([...tray.querySelectorAll(".vault-auto-scan-app")]
    .map((app) => app.textContent), ["ComfyUI", "OtherApp"])

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
  "Checking for possible duplicate files...")
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

  assert.doesNotMatch(script, /vaultAutoSettingsReady|vault-auto-settings-ready/)
  assert.doesNotMatch(script,
    /postMessage\(\s*\{ e: ['"]vault-auto-settings['"]/)

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
  const revealTimers = []
  const completionTimers = []
  const nativeSetTimeout = dom.window.setTimeout.bind(dom.window)
  const nativeClearTimeout = dom.window.clearTimeout.bind(dom.window)
  dom.window.setTimeout = (callback, delay, ...args) => {
    if (delay <= 500 && delay > 400) {
      const timer = {
        callback,
        delay,
        cleared: false,
        id: 9000 + revealTimers.length
      }
      revealTimers.push(timer)
      return timer.id
    }
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
    const timer = [...revealTimers, ...completionTimers]
      .find((candidate) => candidate.id === id)
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

  const checking = [...tray.querySelectorAll(".vault-auto-scan-row")]
    .find((card) => card.querySelector(
      ".vault-auto-scan-app").textContent === "ComfyUI")
  assert.ok(checking)
  assert.equal(checking.dataset.state, "checking")
  assert.equal(checking.querySelectorAll(
    ".vault-auto-scan-message").length, 1)
  assert.equal(tray.querySelector(
    '.vault-auto-scan-row[data-state="complete"]'), null,
  "the checking phase remains visible before an immediate result")
  assert.equal(revealTimers.length, 1)
  assert.ok(revealTimers[0].delay <= 500)

  revealTimers[0].callback()
  const completed = tray.querySelector(
    '.vault-auto-scan-row[data-state="complete"]')
  assert.ok(completed)
  assert.equal(completed.querySelector(
    ".vault-auto-scan-app").textContent, "ComfyUI")
  assert.deepEqual([...completed.querySelectorAll(
    ".vault-auto-scan-status")].map((status) => status.textContent), [
    "Checking for possible duplicate files...",
    "No possible duplicate files found"
  ])
  assert.equal(completed.querySelectorAll(
    ".vault-auto-scan-message").length, 2)
  assert.equal(completed.querySelector(
    '.vault-auto-scan-message[data-current="false"]')
    .dataset.state, "checking")
  assert.ok(completed.querySelector(
    '.vault-auto-scan-message[data-current="true"] .vault-auto-scan-icon svg'))
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
  const focusedClose = tray.querySelector(".vault-auto-scan-close")
  focusedClose.focus()
  const revealsBeforeFocusedCompletion = revealTimers.length
  const timersBeforeFocusedCompletion = completionTimers.length
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
  assert.equal(revealTimers.length, revealsBeforeFocusedCompletion + 1)
  assert.equal(completionTimers.length, timersBeforeFocusedCompletion,
    "completion dismissal cannot start before its result is revealed")
  revealTimers.at(-1).callback()
  assert.equal(completionTimers.length, timersBeforeFocusedCompletion,
    "completion does not start its timer while focus is already in the card")
  focusedClose.dispatchEvent(new dom.window.FocusEvent("focusout", {
    bubbles: true,
    relatedTarget: null
  }))
  assert.equal(completionTimers.length, timersBeforeFocusedCompletion + 1)
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
  assert.match(server,
    /result\.vault_automatic_mode = setting && setting\.mode === "manual"/)
  assert.match(server, /result\.vault_global_scan_ready/)

  dom.window.close()
})
