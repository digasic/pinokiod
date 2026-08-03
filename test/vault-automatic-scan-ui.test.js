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
  throw new Error("Timed out waiting for the automatic scan tray.")
}

test("the shared layout renders and reviews automatic app-scan notices", async () => {
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
      rows: [{
        app: "ComfyUI",
        state: "result",
        savings: 12 * 1024 * 1024 * 1024
      }]
    })
  })
  await waitFor(() => dom.window.document.querySelector(
    ".vault-auto-scan-row"))

  const tray = dom.window.document.getElementById("vault-auto-scan-tray")
  assert.equal(tray.hidden, false)
  assert.match(tray.textContent, /ComfyUI — 12 GB can be saved/)
  assert.equal(tray.querySelector("button").textContent, "Review")
  assert.equal(eventSources[0].url,
    "/info/vault/automatic-scans/events")

  tray.querySelector("button").click()
  await waitFor(() => {
    const iframe = dom.window.document.querySelector(".layout-leaf iframe")
    return iframe && iframe.getAttribute("src") ===
      "/v/ComfyUI?pinokio_home_select=%7B%22selector%22%3A%22%23save-space-tab%22%7D"
  })
  assert.equal(tray.hidden, true)
  const actionRequest = requests.find((request) =>
    request && request.url === "/vault/action")
  assert.deepEqual(JSON.parse(actionRequest.options.body), {
    action: "automatic_review",
    app: "ComfyUI"
  })
  assert.equal(requests.some((request) =>
    request && request.url === "/info/vault/automatic-scans"), false)

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

test("the automatic scan event stream handles disconnects before initialization", async () => {
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
