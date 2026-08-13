const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const root = path.resolve(__dirname, "..")
const notifierPath = path.resolve(root, "server/public/tab-idle-notifier.js")
const popoverPath = path.resolve(root, "server/public/tab-link-popover.js")
const popoverCssPath = path.resolve(root, "server/public/tab-link-popover.css")

const settle = () => new Promise((resolve) => setImmediate(resolve))

test("desktop notification settings mount inline and persist both scopes", async () => {
  const script = await fs.readFile(notifierPath, "utf8")
  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="appcanvas vertical">
      <aside>
        <div class="menu-container">
          <a class="frame-link" href="/run/test" target="test-shell" data-can-notify="true">
            <span class="tab"><span class="tab-main">Test</span></span>
          </a>
        </div>
      </aside>
    </div>
    <div id="settings"></div>
  </body></html>`, {
    url: "http://127.0.0.1:42000/run/test",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = async () => ({
        ok: true,
        async json() {
          return {
            sounds: [{
              url: "/sound/bell.mp3",
              label: "Bell",
              filename: "bell.mp3"
            }]
          }
        }
      })
      window.Audio = class {
        play() {
          return Promise.resolve()
        }
      }
    }
  })

  try {
    dom.window.eval(script)
    const link = dom.window.document.querySelector(".frame-link")
    const settings = dom.window.document.getElementById("settings")
    let enabledChange = null
    let soundChange = null

    const mounted = dom.window.PinokioIdleNotifier.mountSettingsForLink(link, settings, {
      onEnabledChange(enabled) {
        enabledChange = enabled
      },
      onSoundChange(choice) {
        soundChange = choice
      }
    })

    assert.equal(mounted, true)
    assert.equal(settings.textContent.includes("Notifications for this tab"), true)
    assert.equal(settings.textContent.includes("Sound"), true)

    const toggle = settings.querySelector('[role="switch"]')
    const status = settings.querySelector(".tab-link-notification-toggle-status")
    const select = settings.querySelector("select")
    assert.equal(toggle.getAttribute("aria-checked"), "true")
    assert.equal(status.textContent, "On")
    assert.equal(select.value, "__default__")

    toggle.click()
    assert.equal(toggle.getAttribute("aria-checked"), "false")
    assert.equal(status.textContent, "Off")
    assert.equal(enabledChange, false)
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("pinokio:idle-prefs")), {
      "test-shell": false
    })

    toggle.click()
    assert.equal(toggle.getAttribute("aria-checked"), "true")
    assert.equal(status.textContent, "On")
    assert.equal(enabledChange, true)
    assert.equal(dom.window.localStorage.getItem("pinokio:idle-prefs"), null)

    await settle()
    assert.equal(Array.from(select.options).some((option) => option.textContent === "Bell"), true)
    select.value = "/sound/bell.mp3"
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    assert.equal(soundChange, "/sound/bell.mp3")
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("pinokio:idle-sound")), {
      choice: "/sound/bell.mp3"
    })
  } finally {
    dom.window.close()
  }
})

test("tab actions expands notification settings instead of reopening at the sidebar", async () => {
  const [popover, css] = await Promise.all([
    fs.readFile(popoverPath, "utf8"),
    fs.readFile(popoverCssPath, "utf8")
  ])
  const branchStart = popover.indexOf('if (action === "notifications")')
  const branchEnd = popover.indexOf('const url = item.getAttribute("data-url")', branchStart)
  assert.notEqual(branchStart, -1)
  assert.notEqual(branchEnd, -1)
  const branch = popover.slice(branchStart, branchEnd)

  assert.match(branch, /mountSettingsForLink\(activeLink, panel/)
  assert.match(branch, /tab-link-notification-settings/)
  assert.match(branch, /panel\.setAttribute\("role", "group"\)/)
  assert.doesNotMatch(branch, /hideTabLinkPopover/)
  assert.doesNotMatch(branch, /openMenuForLink/)
  assert.match(css, /\.tab-link-notification-settings\s*\{/)
  assert.match(css, /\.tab-link-notification-switch:focus-visible/)
})

test("legacy notification popover stays inside the viewport", async () => {
  const notifier = await fs.readFile(notifierPath, "utf8")

  assert.match(notifier, /\.pinokio-notify-popover \{[\s\S]*position: fixed;/)
  assert.match(notifier, /\.pinokio-notify-popover \{[\s\S]*max-height: calc\(100dvh - 24px\);/)
  assert.match(notifier, /const topAbove = rect\.top - menuHeight - menuGap;/)
  assert.match(notifier, /top \+ menuHeight > window\.innerHeight - viewportPadding/)
})
