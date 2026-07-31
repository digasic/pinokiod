const { describe, test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

const root = path.resolve(__dirname, "..")
const publicRoot = path.join(root, "server", "public")
const workspacePath = path.join(
  root, "server", "views", "partials", "vault_workspace.ejs")

const source = async (filePath) =>
  fs.promises.readFile(filePath, "utf8")

const item = (overrides = {}) => Object.assign({
  path: "/pinokio/api/app/model.bin",
  hash: "a".repeat(64),
  size: 4096,
  app: "app",
  status: "tracked",
  shareable: false,
  unavailable_reason: null,
  location_count: 1,
  locations: [{
    path: "/pinokio/api/app/model.bin",
    source_id: "app:app",
    source_label: "app",
    relative_path: "model.bin"
  }],
  source_id: "app:app",
  source_kind: "app",
  source_label: "app",
  relative_path: "model.bin"
}, overrides)

const fixture = (items = [], overrides = {}) => {
  const counts = {
    all: items.filter((entry) => entry.status).length,
    duplicates: items.filter((entry) => entry.status === "duplicate").length,
    shared: items.filter((entry) => entry.status === "shared").length,
    tracked: items.filter((entry) => entry.status === "tracked").length,
    reclaimable: items.filter((entry) => entry.orphan).length,
    activity: items.filter((entry) => entry.activity_type).length
  }
  const shareable = items.filter((entry) =>
    entry.status === "duplicate" && entry.shareable)
  const shared = items.filter((entry) => entry.status === "shared")
  return Object.assign({
    enabled: true,
    mode: "link",
    scan: {
      active: false,
      pending: false,
      phase: "complete",
      queued: 0,
      scope_id: null
    },
    last_scan: {
      ts: Date.now(),
      files: counts.all,
      bytes_total: items.reduce(
        (sum, entry) => sum + (Number(entry.size) || 0), 0),
      hash_failures: 0
    },
    bytes_without_sharing: 8192,
    bytes_on_disk: 4096,
    saved_by_sharing: 4096,
    effective_bytes: 4096,
    reclaimable: 0,
    pending_bytes: shareable.reduce(
      (sum, entry) => sum + (Number(entry.size) || 0), 0),
    file_action: null,
    sources: [
      {
        id: "pinokio", kind: "pinokio", label: "Pinokio",
        root: "/pinokio", parent_id: null, available: true, shareable: true
      },
      {
        id: "apps", kind: "virtual", label: "Apps",
        root: "/pinokio/api", parent_id: "pinokio",
        available: true, shareable: null
      },
      {
        id: "app:app", kind: "app", label: "app",
        root: "/pinokio/api/app", parent_id: "apps",
        available: true, shareable: true
      }
    ],
    items,
    inventory: {
      view: "all",
      counts,
      source_counts: {
        all: { pinokio: counts.all, apps: counts.all, "app:app": counts.all },
        duplicates: {},
        shareable: {}
      },
      shareable_by_source: {},
      shareable_duplicates: shareable.length,
      duplicate_locations: shareable.length ? 1 : 0,
      current: {
        count: items.length,
        locations: items.length ? 1 : 0,
        shareable_bytes: shareable.reduce(
          (sum, entry) => sum + (Number(entry.size) || 0), 0),
        separate_count: shared.length,
        separate_bytes: shared.reduce(
          (sum, entry) => sum + (Number(entry.size) || 0), 0)
      },
      page: 0,
      page_size: 500,
      start: 0,
      end: items.length,
      total: items.length,
      pages: 1
    }
  }, overrides)
}

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for the interface.")
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const makePage = async (status) => {
  const workspace = ejs.render(await source(workspacePath), {
    appMode: false
  })
  const dom = new JSDOM(
    `<body data-platform="${process.platform}" data-agent="electron" data-vault-mode="global">${workspace}</body>`,
    {
      runScripts: "outside-only",
      url: "http://localhost/vault"
    }
  )
  const requests = []
  const confirmations = []
  dom.window.confirm = (message) => {
    confirmations.push(message)
    return true
  }
  dom.window.Socket = class {}
  dom.window.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      const payload = JSON.parse(options.body)
      requests.push(payload)
      const result = payload.action === "separate_files"
        ? { separated: payload.paths.length, failed: 0 }
        : payload.action === "separate_all"
          ? { separated: 1200, failed: 0, cancelled: false }
        : payload.action === "cancel_scan"
          ? { cancel_requested: true }
          : {}
      return { ok: true, status: 200, json: async () => result }
    }
    return {
      ok: true,
      status: 200,
      json: async () => typeof status === "function" ? status(url) : status
    }
  }
  dom.window.eval(await source(path.join(publicRoot, "storage-size.js")))
  dom.window.eval(await source(path.join(publicRoot, "vault.js")))
  await waitFor(() => dom.window.document.querySelector(".vault-table"))
  return { dom, requests, confirmations }
}

describe("Save Space interface", () => {
  test("the interface exposes only the specified workflow and size choices", async () => {
    const combined = [
      await source(path.join(publicRoot, "vault.js")),
      await source(workspacePath)
    ].join("\n")
    const vaultCss = await source(path.join(publicRoot, "vault.css"))

    assert.doesNotMatch(combined, /\brepair\b/i)
    assert.doesNotMatch(combined, /\bmigration\b/i)
    assert.doesNotMatch(combined, /hugging\s*face|HF_HOME/i)
    assert.doesNotMatch(combined, /lifetime[_ -]?(bytes|saving)/i)
    assert.match(combined, /action:\s*"separate_files"/)
    assert.match(combined, /action:\s*"separate_all"/)
    assert.match(combined, /action:\s*"cancel_file_action"/)
    assert.match(combined, /action:\s*"cancel_scan"/)
    assert.match(combined, /const MAX_BULK_SEPARATE_FILES = 500/)
    assert.match(combined, /make_file_separate:\s*"Make file separate"/)
    assert.match(combined, /make_files_separate:\s*"Make \{count\} files separate"/)
    assert.doesNotMatch(combined,
      /Keep separate|Kept separate|Review again|review_again/)
    assert.doesNotMatch(combined, /\bundo\b/i)
    assert.match(combined, /const candidateSizeOptions = \[0\]/)
    assert.match(combined, /\[1, 10, 50, 100, 500\]/)
    assert.match(combined, /The rest of the scan completed\./)
    assert.doesNotMatch(combined, /Previous completed results were kept\./)
    assert.match(combined, /Scan completed with exclusions/)
    assert.match(combined, /Provisional until the scan completes/)
    assert.doesNotMatch(combined, /Scan all locations/)
    assert.doesNotMatch(combined,
      /btn-empty-scan|vault-rail-footer|vault-visually-hidden/)
    assert.match(vaultCss,
      /body\.vault-page \.vault-view-tabs\s*\{[^}]*padding:\s*0;/s)
  })

  test("global mode makes the existing location hierarchy primary", async () => {
    const status = fixture([item()])
    status.sources.push(
      {
        id: "external", kind: "virtual", label: "External folders",
        root: null, parent_id: null, available: true, shareable: null
      },
      {
        id: "external:movies", kind: "external", label: "Movies",
        root: "/Users/test/Movies", parent_id: "external",
        available: true, shareable: true, removable: true
      },
      {
        id: "external:pictures", kind: "external", label: "Pictures",
        root: "/Users/test/Pictures", parent_id: "external",
        available: true, shareable: true, removable: true
      },
      {
        id: "app:empty", kind: "app", label: "empty-app",
        root: "/pinokio/api/empty-app", parent_id: "apps",
        available: true, shareable: true
      },
      {
        id: "folder:empty", kind: "folder", label: "empty-folder",
        root: "/pinokio/empty-folder", parent_id: "pinokio",
        available: true, shareable: true
      }
    )
    status.inventory.source_counts.all.external = 0
    status.inventory.source_counts.all["external:movies"] = 0
    status.inventory.source_counts.all["external:pictures"] = 0

    const { dom, requests } = await makePage(status)
    const document = dom.window.document
    const rail = document.querySelector(".vault-rail-global")
    const tabs = document.querySelector(".vault-view-tabs")

    assert.ok(rail)
    assert.ok(tabs)
    assert.equal(rail.querySelector("#vault-views"), null)
    assert.ok(tabs.querySelector("#vault-views"))
    assert.match(tabs.textContent, /All files/)
    assert.match(tabs.textContent, /Duplicates/)
    assert.match(document.getElementById("btn-add-source").textContent,
      /Add folder/)
    assert.equal(document.querySelectorAll("#btn-scan").length, 1)
    assert.equal(document.querySelectorAll("#vault-candidate-size").length, 1)
    assert.ok(rail.querySelector("#btn-scan"))
    assert.ok(rail.querySelector("#vault-candidate-size"))
    assert.equal(document.querySelector(".vault-overview #btn-scan"), null)
    assert.match(document.getElementById("btn-scan").textContent,
      /Scan again/)
    assert.ok(document.querySelector('.vault-all-locations[data-source=""]'))
    assert.ok(document.querySelector('[data-source="pinokio"]'))
    assert.ok(document.querySelector('[data-source="apps"]'))
    assert.ok(document.querySelector('[data-source="app:app"]'))
    assert.match(document.getElementById("vault-locations").textContent,
      /Other folders/)
    assert.ok(document.querySelector('[data-source="external:movies"]'))
    assert.ok(document.querySelector('[data-source="external:pictures"]'))
    assert.ok(document.querySelector('[data-source="app:empty"]'))
    assert.ok(document.querySelector('[data-source="folder:empty"]'))

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))
    assert.ok(document.querySelector('[data-source="pinokio"]'))
    assert.ok(document.querySelector('[data-source="apps"]'))
    assert.ok(document.querySelector('[data-source="app:app"]'))
    assert.ok(document.querySelector('[data-source="external:movies"]'))
    assert.ok(document.querySelector('[data-source="app:empty"]'))
    assert.ok(document.querySelector('[data-source="folder:empty"]'))

    document.getElementById("btn-scan").click()
    await waitFor(() => requests.some((request) =>
      request.action === "scan"))
    const scan = requests.find((request) => request.action === "scan")
    assert.equal(scan.scope_id, null)
    assert.equal(scan.candidate_size, 100 *
      (process.platform === "win32" ? 1024 : 1000) ** 2)
    await settle()
    dom.window.close()
  })

  test("the fresh empty state keeps the rail as the only scan action", async () => {
    const status = fixture([], {
      last_scan: null,
      bytes_without_sharing: 0,
      bytes_on_disk: 0,
      saved_by_sharing: 0,
      effective_bytes: 0
    })
    const { dom } = await makePage(status)
    const document = dom.window.document

    assert.equal(document.querySelectorAll("#btn-scan").length, 1)
    assert.equal(document.getElementById("btn-empty-scan"), null)
    assert.ok(document.querySelector(".vault-rail-global #btn-scan"))
    assert.match(document.getElementById("btn-scan").textContent, /Scan now/)
    assert.match(document.querySelector(".vault-empty").textContent, /No files/)

    dom.window.close()
  })

  test("app mode keeps its existing rail structure", async () => {
    const workspace = ejs.render(await source(workspacePath), {
      appMode: true
    })

    assert.match(workspace, /vault-rail-app/)
    assert.match(workspace, /id='vault-views'/)
    assert.match(workspace, /id='vault-locations'/)
    assert.match(workspace, /vault-overview-actions/)
    assert.match(workspace, /id='btn-scan'/)
    assert.doesNotMatch(workspace, /id='btn-rail-scan'/)
    assert.doesNotMatch(workspace, /class='vault-view-tabs'/)
  })

  test("the header checkbox selects every Deduplicated row on the page", async () => {
    const managed = item({
      path: "/pinokio/api/app/managed.bin",
      relative_path: "managed.bin",
      status: "shared"
    })
    const ordinaryHardlink = item({
      path: "/pinokio/api/app/ordinary.bin",
      relative_path: "ordinary.bin",
      status: "shared"
    })
    const unique = item({
      path: "/pinokio/api/app/unique.bin",
      relative_path: "unique.bin",
      status: "tracked"
    })
    const { dom, requests } = await makePage(
      fixture([managed, ordinaryHardlink, unique]))
    const document = dom.window.document

    const checkboxes = document.querySelectorAll("[data-select-separate]")
    assert.equal(checkboxes.length, 2)
    const selectPage = document.querySelector(
      "[data-select-separate-page]")
    assert.ok(selectPage)
    assert.equal(selectPage.getAttribute("aria-label"),
      "Select all on this page")
    assert.equal(selectPage.checked, false)
    assert.equal(selectPage.indeterminate, false)

    checkboxes[0].click()
    assert.equal(selectPage.checked, false)
    assert.equal(selectPage.indeterminate, true)
    let button = document.querySelector("[data-separate-selected]")
    assert.ok(button)
    assert.equal(button.textContent.trim(), "Make file separate")

    selectPage.click()
    assert.equal(selectPage.checked, true)
    assert.equal(selectPage.indeterminate, false)
    assert.equal([...checkboxes].every((checkbox) => checkbox.checked), true)

    button = document.querySelector("[data-separate-selected]")
    assert.equal(button.textContent.trim(), "Make 2 files separate")
    button.click()

    await waitFor(() => requests.some((request) =>
      request.action === "separate_files"))
    assert.deepEqual(
      requests.find((request) => request.action === "separate_files"),
      {
        action: "separate_files",
        paths: [managed.path, ordinaryHardlink.path]
      }
    )
    await settle()
    dom.window.close()
  })

  test("page selection can expand to every matching Deduplicated file", async () => {
    const first = item({
      path: "/pinokio/api/app/first.bin",
      relative_path: "first.bin",
      status: "shared"
    })
    const second = item({
      path: "/pinokio/api/app/second.bin",
      relative_path: "second.bin",
      status: "shared"
    })
    const status = fixture([first, second])
    status.inventory.current.separate_count = 1200
    status.inventory.current.separate_bytes = 5_000_000_000
    const { dom, requests, confirmations } = await makePage(status)
    const document = dom.window.document

    document.querySelector("[data-select-separate-page]").click()
    const selectAll = document.querySelector("[data-select-separate-all]")
    assert.ok(selectAll)
    assert.equal(
      selectAll.textContent.trim(),
      "Select all 1200 matching deduplicated files"
    )

    selectAll.click()
    assert.match(
      document.getElementById("vault-selection-state").textContent,
      /All 1200 matching deduplicated files are selected/
    )
    const button = document.querySelector("[data-separate-selected]")
    assert.equal(button.textContent.trim(), "Make 1200 files separate")
    button.click()

    await waitFor(() => requests.some((request) =>
      request.action === "separate_all"))
    assert.deepEqual(
      requests.find((request) => request.action === "separate_all"),
      {
        action: "separate_all",
        scope_id: null,
        location_id: null,
        view: "all",
        status_filter: "all",
        query: ""
      }
    )
    assert.match(confirmations[0], /1200 matching deduplicated files/)
    assert.match(confirmations[0], /additional disk space/)
    await settle()
    dom.window.close()
  })

  test("Duplicate rows do not offer a persistent Keep separate action", async () => {
    const duplicate = item({
      path: "/pinokio/api/app/duplicate.bin",
      relative_path: "duplicate.bin",
      status: "duplicate",
      shareable: true
    })
    const { dom } = await makePage(fixture([duplicate]))
    const document = dom.window.document

    assert.equal(document.querySelector("[data-detach]"), null)
    assert.equal(document.querySelector("[data-review-again]"), null)
    assert.doesNotMatch(document.body.textContent,
      /Keep separate|Kept separate|Review again/)
    dom.window.close()
  })

  test("the main scan button cancels the active scan", async () => {
    const active = fixture([], {
      scan: {
        active: true,
        pending: false,
        phase: "discovering",
        queued: 0,
        scope_id: null,
        dirs: 3,
        files: 12,
        bytes_total: 4096
      }
    })
    const { dom, requests } = await makePage(active)
    const document = dom.window.document
    const button = document.getElementById("btn-scan")
    const progress = document.querySelector(
      "#vault-scan-state [role='progressbar']")

    assert.match(button.textContent, /Cancel/)
    assert.ok(progress.querySelector(".vault-progress-bar.indeterminate"))
    assert.doesNotMatch(
      document.getElementById("vault-metrics").textContent,
      /Scanning/)
    button.click()
    await waitFor(() => requests.some((request) =>
      request.action === "cancel_scan"))
    assert.deepEqual(
      requests.find((request) => request.action === "cancel_scan"),
      { action: "cancel_scan" }
    )
    await settle()
    dom.window.close()
  })

  test("hashing is one determinate scan while provisional matches are results", async () => {
    const active = fixture([], {
      scan: {
        active: true,
        pending: false,
        phase: "hashing",
        queued: 1,
        scope_id: null,
        dirs: 20,
        files: 100,
        bytes_total: 4096,
        hash_work_bytes: 1000,
        hash_bytes_completed: 300,
        current_file: "model.bin",
        current_file_size: 500,
        current_file_bytes: 100,
        preview: {
          provisional: true,
          duplicate_files: 1,
          bytes: 200,
          groups: [{
            hash: "a".repeat(64),
            representative_path: "/pinokio/api/app/model.bin",
            locations: 2,
            duplicate_files: 1,
            bytes: 200
          }]
        }
      }
    })
    const { dom } = await makePage(active)
    const document = dom.window.document
    const scan = document.getElementById("vault-scan-state")
    const progress = scan.querySelector('[role="progressbar"]')
    const preview = document.getElementById("vault-result")

    try {
      assert.match(scan.textContent, /Step 2 of 3 · Verifying duplicates/)
      assert.match(scan.textContent, /400 B of 1 KB analyzed · 40%/)
      assert.ok(progress.querySelector(".vault-progress-bar.determinate"))
      assert.equal(progress.getAttribute("aria-valuemax"), "1000")
      assert.equal(progress.getAttribute("aria-valuenow"), "400")
      assert.match(preview.textContent, /Duplicates found so far/)
      assert.match(preview.textContent,
        /\/pinokio\/api\/app\/model\.bin · 2 files with identical contents/)
      assert.equal(preview.querySelector(".fa-spin"), null)
      assert.equal(preview.querySelector(".vault-result-paths").hidden, true)
      assert.match(preview.querySelector("#btn-scan-preview").textContent,
        /View matches/)
      preview.querySelector("#btn-scan-preview").click()
      assert.equal(preview.querySelector(".vault-result-paths").hidden, false)
      assert.match(preview.querySelector("#btn-scan-preview").textContent,
        /Hide matches/)
      assert.doesNotMatch(preview.textContent, /locations locations/)
      assert.doesNotMatch(preview.textContent,
        /duplicates verified duplicates/)
    } finally {
      dom.window.close()
    }
  })
})
