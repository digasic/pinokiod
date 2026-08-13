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
    unavailable: items.filter((entry) => entry.status === "unavailable").length,
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
    global_scan_ready: true,
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
    logical_bytes: 8192,
    bytes_on_disk: 4096,
    saved_by_sharing: 4096,
    effective_bytes: 4096,
    shared_logical_bytes: shared.reduce(
      (sum, entry) => sum + (Number(entry.size) || 0), 0),
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
        unavailable: {},
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
        deduplicate_bytes: shareable.reduce(
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
const makePage = async (status, options = {}) => {
  const appMode = !!options.appMode
  const platform = options.platform || process.platform
  const deferFolderDiscoverySelection =
    !!options.deferFolderDiscoverySelection
  const deferFolderDiscoveryAdd = !!options.deferFolderDiscoveryAdd
  const deferFolderDiscoveryStart = !!options.deferFolderDiscoveryStart
  const actionResults = options.actionResults || {}
  const folderDiscoveryChildren = options.folderDiscoveryChildren || {}
  let statusFailuresAfterFindFolders = Math.max(
    0, Number(options.statusFailuresAfterFindFolders) || 0)
  let findFoldersRequested = false
  const scopeId = appMode ? (options.scopeId || "app:app") : ""
  const homePath = Object.prototype.hasOwnProperty.call(options, "homePath")
    ? options.homePath
    : "/Users/test"
  const workspace = ejs.render(await source(workspacePath), {
    appMode
  })
  const dom = new JSDOM(
    `<body data-platform="${platform}" data-agent="electron" data-vault-mode="${appMode ? "app" : "global"}" data-vault-scope="${scopeId}" data-vault-app="${appMode ? "app" : ""}" data-vault-home="${homePath}">${workspace}</body>`,
    {
      runScripts: "outside-only",
      url: appMode
        ? "http://localhost/vault/app/app"
        : "http://localhost/vault"
    }
  )
  const requests = []
  const getRequests = []
  const parentNavigations = []
  const parentMessages = []
  const selectedSources = new Set(options.folderDiscoverySelected || [])
  const recommendedSources = new Set()
  const confirmations = []
  const pickerRequests = []
  const pendingPickers = []
  const pendingFolderDiscoveryStarts = []
  const pendingFolderDiscoverySelections = []
  const pendingFolderDiscoveryAdds = []
  let resolveAutomaticStatus = null
  const deferredAutomaticStatus = options.deferAutomaticStatus
    ? new Promise((resolve) => { resolveAutomaticStatus = resolve })
    : null
  let resolveInitialStatus = null
  let initialStatusPending = !!options.deferInitialStatus
  const deferredInitialStatus = initialStatusPending
    ? new Promise((resolve) => { resolveInitialStatus = resolve })
    : null
  const within = (ancestor, candidate) => ancestor === candidate ||
    candidate.startsWith(`${ancestor.replace(/\/$/, "")}/`)
  const discoveryResultsFrom = (response) =>
    response && response.folder_discovery_results
  const seedDiscoverySelection = (response) => {
    const results = discoveryResultsFrom(response)
    const recommendations = results && results.recommendations
    for (const item of Array.isArray(recommendations && recommendations.items)
      ? recommendations.items
      : []) {
      recommendedSources.add(item.folder)
    }
  }
  const decorateDiscoveryNode = (node) => {
    if (!node || typeof node.folder !== "string") return node
    node.selected = selectedSources.has(node.folder)
    node.selected_inside = [...selectedSources]
      .filter((folder) => folder !== node.folder && within(node.folder, folder))
      .length
    node.recommended = recommendedSources.has(node.folder)
    node.broader = !node.recommended && [...recommendedSources]
      .some((folder) => within(node.folder, folder))
    for (const child of Array.isArray(node.children) ? node.children : []) {
      decorateDiscoveryNode(child)
    }
    return node
  }
  const decorateDiscoveryResponse = (response) => {
    seedDiscoverySelection(response)
    const results = discoveryResultsFrom(response)
    if (results) {
      decorateDiscoveryNode(results.root)
      for (const item of Array.isArray(results.items) ? results.items : []) {
        decorateDiscoveryNode(item)
      }
    } else if (response && Array.isArray(response.items)) {
      for (const item of response.items) decorateDiscoveryNode(item)
    }
    return response
  }
  const selectionMutationResult = (payload) => {
    if (payload.selected) {
      for (const folder of [...selectedSources]) {
        if (within(payload.path, folder) || within(folder, payload.path)) {
          selectedSources.delete(folder)
        }
      }
      selectedSources.add(payload.path)
    } else {
      selectedSources.delete(payload.path)
    }
    const nodes = []
    let current = payload.path
    while (within(payload.root, current)) {
      nodes.push(decorateDiscoveryNode({ folder: current }))
      if (current === payload.root) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    const results = typeof status === "function"
      ? null
      : status.folder_discovery_results
    const original = results && results.selection || {}
    return {
      nodes,
      selected_count: selectedSources.size,
      selected_files: Math.max(
        selectedSources.size,
        Number(original.selected_files) || selectedSources.size),
      potential_savings: Number(original.potential_savings) || 0
    }
  }
  dom.window.confirm = (message) => {
    confirmations.push(message)
    return true
  }
  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(callback, 0)
  if (options.embeddedApp) {
    const embeddedParent = {
      location: {
        assign(target) {
          parentNavigations.push(target)
        }
      },
      postMessage(payload, targetOrigin) {
        parentMessages.push({ payload, targetOrigin })
        if (payload && payload.e === "vault-automatic-scan-state-request" &&
            options.embeddedAutomaticReply !== false) {
          dom.window.setTimeout(() => {
            const event = new dom.window.Event("message")
            Object.defineProperties(event, {
              source: { value: embeddedParent },
              origin: { value: dom.window.location.origin },
              data: {
                value: {
                  e: "vault-automatic-scan-state",
                  snapshot: options.embeddedAutomaticSnapshot || {
                    global_scan_ready: !!(status &&
                      typeof status === "object" &&
                      status.global_scan_ready === true),
                    settings: [{ app: "app", mode: "automatic" }]
                  }
                }
              }
            })
            dom.window.dispatchEvent(event)
          }, 0)
        }
      }
    }
    Object.defineProperty(dom.window, "parent", {
      configurable: true,
      value: embeddedParent
    })
  }
  if (options.fastStatusRetry || options.fastAutomaticFallback) {
    const setTimeout = dom.window.setTimeout.bind(dom.window)
    dom.window.setTimeout = (callback, delay, ...args) => {
      const fastDelay = (options.fastStatusRetry && delay === 5000) ||
        (options.fastAutomaticFallback && delay === 500)
      return setTimeout(callback, fastDelay ? 0 : delay, ...args)
    }
  }
  if (appMode && options.automaticScanFocusRequested) {
    const signature = typeof options.automaticScanFocusRequested === "string"
      ? options.automaticScanFocusRequested
      : "a".repeat(64)
    dom.window.sessionStorage.setItem(
      "pinokio:vault:auto-scan-focus:app", signature)
  }
  if (options.storedCandidateSize !== undefined) {
    dom.window.localStorage.setItem(
      "pinokio:vault:candidate-size",
      String(options.storedCandidateSize))
  }
  dom.window.Socket = class {
    run(payload, callback) {
      pickerRequests.push(payload)
      if (options.deferPicker) {
        return new Promise((resolve) => {
          pendingPickers.push({ callback, resolve })
        })
      }
      return Promise.resolve()
    }
    close() {}
  }
  dom.window.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      const payload = JSON.parse(options.body)
      requests.push(payload)
      if (payload.action === "find_folders") findFoldersRequested = true
      if (deferFolderDiscoveryStart &&
          payload.action === "find_folders") {
        await new Promise((resolve) =>
          pendingFolderDiscoveryStarts.push(resolve))
      }
      if (deferFolderDiscoverySelection &&
          payload.action === "update_folder_discovery_selection") {
        await new Promise((resolve) =>
          pendingFolderDiscoverySelections.push(resolve))
      }
      if (deferFolderDiscoveryAdd &&
          payload.action === "add_folder_discovery_sources") {
        await new Promise((resolve) => pendingFolderDiscoveryAdds.push(resolve))
      }
      const result = actionResults[payload.action] || (payload.action === "reveal"
        ? { revealed: true }
        : payload.action === "deduplicate_files"
        ? {
            converted: payload.paths.length,
            bytes_saved: payload.paths.length * 4096,
            failed: 0
          }
        : payload.action === "separate_files"
        ? { separated: payload.paths.length, failed: 0 }
        : payload.action === "separate_all"
          ? { separated: 1200, failed: 0, cancelled: false }
        : payload.action === "cancel_scan"
          ? { cancel_requested: true }
        : payload.action === "find_folders"
          ? { started: true, threshold: payload.candidate_size }
        : payload.action === "cancel_find_folders"
          ? { cancel_requested: true }
        : payload.action === "clear_find_folders"
          ? { cleared: true }
        : payload.action === "add_source"
          ? {
              created: true,
              source: {
                id: "external:found",
                label: "Found",
                target_path: payload.path,
                shareable: true
              }
            }
        : payload.action === "update_folder_discovery_selection"
          ? selectionMutationResult(payload)
        : payload.action === "add_folder_discovery_sources"
          ? {
              created_count: selectedSources.size,
              existing_count: 0,
              sources: [...selectedSources].map((folderPath, index) => ({
                id: `external:found-${index}`,
                label: path.basename(folderPath),
                target_path: folderPath,
                shareable: true
              }))
            }
          : {})
      return { ok: true, status: 200, json: async () => result }
    }
    if (findFoldersRequested && statusFailuresAfterFindFolders > 0) {
      statusFailuresAfterFindFolders -= 1
      return { ok: false, status: 503, json: async () => ({}) }
    }
    getRequests.push(url)
    const parsed = new URL(url, "http://localhost")
    if (initialStatusPending && parsed.pathname === "/info/dedup") {
      initialStatusPending = false
      await deferredInitialStatus
    }
    const parent = parsed.searchParams.get("folder_discovery_parent")
    const childPage = Number(
      parsed.searchParams.get("folder_discovery_child_page")) || 0
    const childManifest = parent
      ? folderDiscoveryChildren[parent]
      : null
    const response = await (parent
      ? typeof childManifest === "function"
        ? childManifest(childPage)
        : childManifest || {
            folder: parent,
            items: [],
            total: 0,
            page: childPage,
            page_size: 500,
            pages: 1
          }
      : typeof status === "function" ? status(url) : status)
    if (options.deferAutomaticStatus &&
        url === "/info/vault/automatic-scans") {
      await deferredAutomaticStatus
    }
    return {
      ok: true,
      status: 200,
      json: async () => decorateDiscoveryResponse(response)
    }
  }
  dom.window.eval(await source(path.join(publicRoot, "storage-size.js")))
  dom.window.eval(await source(path.join(publicRoot, "vault.js")))
  if (!options.returnBeforeInitialStatus) {
    await waitFor(() => dom.window.document.querySelector(
      ".vault-summary-value"))
  }
  const choosePickedPath = (folderPath) => {
    const pending = pendingPickers.shift()
    if (!pending) throw new Error("No folder picker is waiting for a selection.")
    pending.callback({
      type: "result",
      data: { paths: folderPath ? [folderPath] : [] }
    })
    pending.resolve()
  }
  const releaseFolderDiscoverySelection = async () => {
    await waitFor(() => pendingFolderDiscoverySelections.length > 0)
    const pending = pendingFolderDiscoverySelections.shift()
    pending()
  }
  const releaseFolderDiscoveryStart = async () => {
    await waitFor(() => pendingFolderDiscoveryStarts.length > 0)
    const pending = pendingFolderDiscoveryStarts.shift()
    pending()
  }
  const releaseFolderDiscoveryAdd = async () => {
    await waitFor(() => pendingFolderDiscoveryAdds.length > 0)
    const pending = pendingFolderDiscoveryAdds.shift()
    pending()
  }
  const releaseAutomaticStatus = () => {
    if (resolveAutomaticStatus) resolveAutomaticStatus()
  }
  const releaseInitialStatus = () => {
    if (resolveInitialStatus) resolveInitialStatus()
  }
  return {
    dom,
    requests,
    getRequests,
    parentNavigations,
    parentMessages,
    confirmations,
    pickerRequests,
    choosePickedPath,
    releaseFolderDiscoveryStart,
    releaseFolderDiscoverySelection,
    releaseFolderDiscoveryAdd,
    releaseAutomaticStatus,
    releaseInitialStatus
  }
}

const startHomeFolderDiscovery = async (document, opener = null) => {
  const trigger = opener || document.getElementById("btn-find-folders")
  trigger.click()
  await waitFor(() => document.querySelector("[data-find-home-folder]"))
  document.querySelector("[data-find-home-folder]").click()
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
    assert.match(combined,
      /const MAX_BULK_DEDUPLICATE_FILES = 500/)
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
    assert.match(combined, /Set up Disk Saver/)
    assert.doesNotMatch(combined, /Scan all locations/)
    assert.match(combined, /data-find-home-folder/)
    assert.match(combined, /data-find-other-folder/)
    assert.match(combined, /vault-find-candidate-size/)
    assert.match(combined, /Search files this size and larger/)
    assert.doesNotMatch(combined,
      /data-choose-find-root|find_folders_intro|choose_folder_or_drive/)
    assert.match(combined, /No folders with duplicate files found/)
    assert.match(combined,
      /No duplicate files found in folders that could be checked/)
    assert.doesNotMatch(combined,
      /btn-empty-scan|vault-rail-footer|vault-visually-hidden/)
    assert.doesNotMatch(combined, /Scan files \{size\}\+|scan_files_over/)
    assert.doesNotMatch(combined,
      /vault-comparison|vault-compare-row|saved for this app|of disk space saved/)
    assert.match(combined, /saved by deduplicating/)
    assert.match(combined, /unique to this app/)
    assert.match(vaultCss,
      /body\.vault-page \.vault-view-tabs\s*\{[^}]*padding:\s*0;/s)
    assert.match(vaultCss,
      /@media \(max-width: 1140px\)[\s\S]*?\.vault-overview\s*\{[^}]*min-height:\s*auto;/s)
    assert.match(vaultCss,
      /body\.dark\.vault-page\s*\{[^}]*--task-panel:\s*var\(--pinokio-sidebar-tabbar-bg\);/s)
    assert.match(vaultCss,
      /\.vault-view-tabs \.vault-nav-row\.attention\s*\{[^}]*background:/s)
    assert.match(vaultCss,
      /\.vault-view-tabs \.vault-nav-row\.attention \.vault-nav-name::before\s*\{[^}]*background:\s*var\(--vault-warning\);/s)
    assert.match(vaultCss,
      /\.vault-view-tabs \.vault-nav-row\.attention \.vault-nav-count\s*\{[^}]*background:/s)
    assert.match(vaultCss,
      /\.vault-view-tabs \.vault-nav-row\.attention\.selected\s*\{[^}]*border-bottom-color:\s*var\(--task-accent\);/s)
    assert.match(vaultCss,
      /\.vault-scan-control\s*>\s*\.vault-scan-action\s*\{[^}]*border-radius:\s*7px 0 0 7px;/s)
    assert.match(vaultCss,
      /\.vault-scan-size-menu\s*>\s*\.vault-scan-size-trigger\s*\{[^}]*border-radius:\s*0 7px 7px 0;/s)
    assert.match(vaultCss,
      /\.vault-scan-control\s*>\s*\.vault-scan-size-menu\s*>\s*\.vault-scan-size-trigger\.primary/)
    assert.match(vaultCss,
      /\.vault-metrics\.summary\s*\{[^}]*grid-template-columns:\s*minmax\(430px, 620px\) minmax\(230px, 1fr\);/s)
    assert.match(vaultCss,
      /\.vault-storage-track\s*\{[^}]*height:\s*10px;/s)
    assert.match(vaultCss,
      /\.vault-storage-legend\s*\{[^}]*display:\s*flex;/s)
    assert.match(vaultCss,
      /\.vault-storage-key\s*\{[^}]*display:\s*inline-flex;/s)
    assert.doesNotMatch(vaultCss,
      /\.vault-storage-legend\s*\{[^}]*grid-template-columns:/s)
    assert.match(vaultCss,
      /\.vault-storage-segment\.occupied,[^{]*\{[^}]*background:\s*var\(--task-accent\);/s)
    assert.match(vaultCss,
      /\.vault-storage-segment\.optimized,[^{]*\{[^}]*var\(--task-muted\)/s)
    assert.match(vaultCss,
      /\.vault-storage-segment\.potential,[^{]*\{[^}]*var\(--task-muted\)[^}]*repeating-linear-gradient/s)
    assert.doesNotMatch(vaultCss,
      /\.vault-storage-segment\.potential,[^{]*\{[^}]*var\(--task-accent\)/s)
    assert.doesNotMatch(vaultCss,
      /\.vault-overview\s*\{[^}]*flex:\s*0 0 auto;/s)
    assert.match(vaultCss, /repeating-linear-gradient/)
  })

  test("the global Vault page protects its rendered home path", async () => {
    const serverSource = await source(path.join(root, "server", "index.js"))
    const routeStart = serverSource.indexOf('this.app.get("/vault"')
    const routeEnd = serverSource.indexOf(
      'this.app.get("/vault/app/:name"', routeStart)
    const route = serverSource.slice(routeStart, routeEnd)
    const guardIndex = route.indexOf(
      "privacyFilterCache.isSameOriginRequest(req)")
    const renderIndex = route.indexOf('res.render("vault"')

    assert.ok(routeStart >= 0 && routeEnd > routeStart)
    assert.ok(guardIndex >= 0)
    assert.ok(renderIndex > guardIndex)
    assert.match(route, /systemHome:\s*path\.resolve\(os\.homedir\(\)\)/)
  })

  test("global and app summaries use one correctly labeled segmented bar", async () => {
    const globalStatus = fixture([item()], {
      // The last scan total can lag behind locations published afterward.
      bytes_without_sharing: 1000,
      logical_bytes: 10000,
      saved_by_sharing: 3000,
      pending_bytes: 2000
    })
    const { dom: globalDom } = await makePage(globalStatus)
    const globalDocument = globalDom.window.document
    const globalHeadline = globalDocument.querySelector(".vault-summary-value")
    const globalChart = globalDocument.querySelector(".vault-storage-chart")

    assert.match(globalHeadline.textContent, /saved by deduplicating/)
    assert.match(globalChart.getAttribute("aria-label"), /Still used:/)
    assert.match(globalChart.getAttribute("aria-label"), /Saved:/)
    assert.match(globalChart.getAttribute("aria-label"), /Can save:/)
    assert.match(globalDocument.querySelector(
      ".vault-storage-key.occupied").textContent, /Still used/)
    assert.match(globalDocument.querySelector(
      ".vault-storage-key.optimized").textContent, /Saved/)
    assert.match(globalDocument.querySelector(
      ".vault-storage-key.potential").textContent, /Can save/)
    assert.equal(globalDocument.querySelectorAll(
      ".vault-storage-key").length, 3)
    assert.equal(globalDocument.querySelectorAll(
      ".vault-storage-track").length, 1)
    assert.equal(globalChart.parentElement.className, "vault-summary-main")
    assert.equal(globalDocument.querySelector("#vault-metrics").children.length, 2)
    assert.equal(globalDocument.querySelector(".vault-storage-inside"), null)
    assert.equal(globalDocument.querySelector(".vault-comparison"), null)
    globalDom.window.close()

    const appStatus = fixture([item()], {
      last_scan: {
        ts: Date.now(),
        files: 3,
        bytes_total: 10000,
        hash_failures: 0
      },
      logical_bytes: 10000,
      shared_logical_bytes: 3000,
      pending_bytes: 2000
    })
    const { dom: appDom } = await makePage(appStatus, { appMode: true })
    const appDocument = appDom.window.document
    const appHeadline = appDocument.querySelector(".vault-summary-value")
    const appChart = appDocument.querySelector(".vault-storage-chart")

    assert.match(appHeadline.textContent, /unique to this app/)
    assert.match(appChart.getAttribute("aria-label"), /Unique:/)
    assert.match(appChart.getAttribute("aria-label"), /Shared:/)
    assert.match(appChart.getAttribute("aria-label"), /Can save:/)
    assert.match(appDocument.querySelector(
      ".vault-storage-key.occupied").textContent, /Unique/)
    assert.match(appDocument.querySelector(
      ".vault-storage-key.optimized").textContent, /Shared/)
    assert.match(appDocument.querySelector(
      ".vault-storage-key.potential").textContent, /Can save/)
    assert.equal(appDocument.querySelectorAll(
      ".vault-storage-track").length, 1)
    assert.equal(appDocument.querySelector(".vault-comparison"), null)
    appDom.window.close()
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
    const addMenu = document.getElementById("vault-add-menu")
    assert.ok(addMenu)
    assert.match(addMenu.querySelector("summary").textContent, /Add/)
    assert.ok(addMenu.contains(document.getElementById("btn-add-source")))
    assert.match(document.getElementById("btn-add-source").textContent,
      /Add folder/)
    assert.ok(addMenu.contains(document.getElementById("btn-find-folders")))
    assert.match(document.getElementById("btn-find-folders").textContent,
      /Find more savings/)
    assert.equal(document.getElementById("btn-find-folders").disabled,
      false)
    assert.equal(document.querySelectorAll("#btn-scan").length, 1)
    assert.equal(document.querySelectorAll("#vault-candidate-size").length, 0)
    assert.equal(rail.querySelector("#btn-scan"), null)
    assert.equal(rail.querySelector("#vault-candidate-size"), null)
    assert.ok(document.querySelector(".vault-overview #btn-scan"))
    assert.ok(document.querySelector(".vault-overview .vault-scan-control"))
    assert.ok(document.getElementById("vault-scan-size-menu"))
    assert.match(document.getElementById("btn-scan").textContent,
      /Scan again/)
    assert.equal(document.getElementById("btn-scan").classList
      .contains("primary"), true)
    assert.equal(document.querySelector("#vault-scan-size-menu > summary")
      .classList.contains("primary"), false)
    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /100 MB\+/)
    assert.match(document.getElementById("vault-scan-size-options").textContent,
      /Minimum file size/)

    const candidateBase = process.platform === "win32" ? 1024 : 1000
    document.querySelector(`[data-candidate-size="${10 * candidateBase ** 2}"]`).click()
    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /10 MB\+/)
    assert.match(document.getElementById("btn-scan").textContent,
      /Scan again/)
    assert.equal(requests.some((request) => request.action === "scan"), false)
    document.querySelector('[data-candidate-size="0"]').click()
    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /All files/)
    assert.equal(requests.some((request) => request.action === "scan"), false)
    document.querySelector(`[data-candidate-size="${100 * candidateBase ** 2}"]`).click()
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
    assert.equal("candidate_size" in scan, false)
    await settle()
    dom.window.close()
  })

  test("Cannot deduplicate is separate from actionable duplicates", async () => {
    const duplicate = item({
      path: "/pinokio/api/app/models/duplicate.bin",
      relative_path: "models/duplicate.bin",
      status: "duplicate",
      shareable: true
    })
    const unavailable = item({
      path: "/pinokio/api/app/models/blocked.bin",
      relative_path: "models/blocked.bin",
      status: "unavailable",
      unavailable_reason: "permission_denied"
    })
    const base = fixture([duplicate, unavailable])
    base.inventory.source_counts.duplicates["app:app"] = 1
    base.inventory.source_counts.unavailable["app:app"] = 1
    base.inventory.shareable_by_source["app:app"] = 1
    const response = (url) => {
      const view = new URL(url, "http://localhost")
        .searchParams.get("view") || "all"
      const result = JSON.parse(JSON.stringify(base))
      result.inventory.view = view
      result.items = view === "duplicates"
        ? [duplicate]
        : view === "unavailable"
          ? [unavailable]
          : [duplicate, unavailable]
      result.inventory.current.count = result.items.length
      result.inventory.total = result.items.length
      result.inventory.end = result.items.length
      return result
    }
    const { dom, requests } = await makePage(response, {
      actionResults: {
        deduplicate: {
          status: "unavailable",
          unavailable_reason: "permission_denied"
        }
      }
    })
    const document = dom.window.document

    assert.match(document.querySelector("#vault-views").textContent,
      /Cannot deduplicate\s*1/)
    assert.match(document.querySelector("#vault-status-filter").textContent,
      /Cannot deduplicate/)
    assert.equal(document.getElementById("btn-review-metric").classList
      .contains("primary"), true)
    assert.equal(document.getElementById("btn-scan").classList
      .contains("primary"), false)

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))
    assert.match(document.querySelector(".vault-table").textContent,
      /duplicate\.bin/)
    assert.doesNotMatch(document.querySelector(".vault-table").textContent,
      /blocked\.bin/)
    assert.equal(document.querySelector("[data-deduplicate-all]")
      .classList.contains("primary"), true)
    assert.equal(document.getElementById("btn-scan").classList
      .contains("primary"), false)

    document.querySelector('[data-view="unavailable"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="unavailable"].selected'))
    const table = document.querySelector(".vault-table")
    assert.match(table.textContent, /blocked\.bin/)
    assert.match(table.textContent,
      /Disk Saver cannot modify this file or its folder/)
    assert.doesNotMatch(table.textContent, /duplicate\.bin/)
    assert.equal(document.querySelector("[data-deduplicate-all]"), null)
    assert.equal(document.querySelector("[data-select-duplicate]"), null)
    document.querySelector("[data-deduplicate-file]").click()
    await waitFor(() => requests.some((request) =>
      request.action === "deduplicate" &&
      request.path === unavailable.path))
    await waitFor(() => document.getElementById("vault-feedback")
      .textContent.includes("Disk Saver cannot modify this file or its folder"))

    dom.window.close()
  })

  test("a scan relies on the saved scope setting, not browser storage", async () => {
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const saved = 50 * candidateBase ** 2
    const stored = 10 * candidateBase ** 2
    const { dom, requests } = await makePage(fixture([], {
      candidate_min_bytes: saved,
      global_candidate_min_bytes: 100 * candidateBase ** 2
    }), {
      storedCandidateSize: stored
    })
    const document = dom.window.document

    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /50 MB\+/)
    document.getElementById("btn-scan").click()
    await waitFor(() => requests.some((request) =>
      request.action === "scan"))
    assert.equal("candidate_size" in requests.find((request) =>
      request.action === "scan"), false)

    await settle()
    dom.window.close()
  })

  test("an app displays and immediately saves its own minimum size", async () => {
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const appMinimum = candidateBase ** 2
    const globalMinimum = 10 * candidateBase ** 2
    const selected = 50 * candidateBase ** 2
    const { dom, requests } = await makePage(fixture([], {
      candidate_min_bytes: appMinimum,
      global_candidate_min_bytes: globalMinimum
    }), { appMode: true })
    const document = dom.window.document
    const selector = document.getElementById("vault-candidate-size")

    assert.equal(selector.value, String(appMinimum))
    selector.value = String(selected)
    selector.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    await waitFor(() => requests.some((request) =>
      request.action === "set_candidate_size"))
    const request = requests.find((entry) =>
      entry.action === "set_candidate_size")
    assert.equal(request.scope_id, "app:app")
    assert.equal(request.candidate_size, selected)
    assert.equal(selector.value, String(selected))

    dom.window.close()
  })

  test("a threshold chosen before initial status remains selected", async () => {
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const published = 50 * candidateBase ** 2
    const selected = 10 * candidateBase ** 2
    const {
      dom,
      requests,
      releaseInitialStatus
    } = await makePage(fixture([], {
      global_candidate_min_bytes: published
    }), {
      deferInitialStatus: true,
      returnBeforeInitialStatus: true
    })
    const document = dom.window.document

    document.querySelector(`[data-candidate-size="${selected}"]`).click()
    releaseInitialStatus()
    await waitFor(() => document.querySelector(".vault-summary-value"))

    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /10 MB\+/)
    document.getElementById("btn-scan").click()
    await waitFor(() => requests.some((request) =>
      request.action === "scan"))
    const savedIndex = requests.findIndex((request) =>
      request.action === "set_candidate_size")
    const scanIndex = requests.findIndex((request) =>
      request.action === "scan")
    assert.ok(savedIndex >= 0 && savedIndex < scanIndex)
    assert.equal("candidate_size" in requests[scanIndex], false)

    await settle()
    dom.window.close()
  })

  test("a rejected minimum size save blocks a pending scan and restores the saved size", async () => {
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const saved = 50 * candidateBase ** 2
    const selected = 10 * candidateBase ** 2
    const { dom, requests } = await makePage(fixture([], {
      candidate_min_bytes: saved,
      global_candidate_min_bytes: saved
    }), {
      actionResults: {
        set_candidate_size: { error: "Could not save minimum file size." }
      }
    })
    const document = dom.window.document

    document.querySelector(`[data-candidate-size="${selected}"]`).click()
    document.getElementById("btn-scan").click()

    await waitFor(() => /50 MB\+/.test(document.getElementById(
      "vault-scan-size-label").textContent) &&
      /could not save minimum file size/i.test(
        document.getElementById("vault-feedback").textContent))
    assert.equal(requests.some((request) => request.action === "scan"), false)

    dom.window.close()
  })

  test("a stale minimum size failure does not replace a newer successful selection", async () => {
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const first = 10 * candidateBase ** 2
    const second = 50 * candidateBase ** 2
    const currentStatus = fixture([], {
      candidate_min_bytes: 100 * candidateBase ** 2,
      global_candidate_min_bytes: 100 * candidateBase ** 2
    })
    let statusCount = 0
    let releaseRecovery
    const recovery = new Promise((resolve) => { releaseRecovery = resolve })
    let saveCount = 0
    const actionResults = {}
    Object.defineProperty(actionResults, "set_candidate_size", {
      get() {
        saveCount += 1
        return saveCount === 1
          ? { error: "Could not save minimum file size." }
          : {}
      }
    })
    const { dom, requests } = await makePage(async () => {
      statusCount += 1
      if (statusCount === 2) await recovery
      return currentStatus
    }, { actionResults })
    const document = dom.window.document

    document.querySelector(`[data-candidate-size="${first}"]`).click()
    await waitFor(() => statusCount === 2)
    document.querySelector(`[data-candidate-size="${second}"]`).click()
    releaseRecovery()

    await waitFor(() => requests.filter((request) =>
      request.action === "set_candidate_size").length === 2)
    await settle()
    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /50 MB\+/)
    assert.doesNotMatch(document.getElementById("vault-feedback").textContent,
      /could not save minimum file size/i)

    dom.window.close()
  })

  test("a runtime write denial is reported as cannot deduplicate", async () => {
    const duplicate = item({
      status: "duplicate",
      shareable: true
    })
    const { dom } = await makePage(fixture([duplicate]), {
      actionResults: {
        deduplicate: {
          unavailable: 1,
          unavailable_by_reason: { permission_denied: 1 }
        }
      }
    })
    const document = dom.window.document

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))
    document.querySelector("[data-deduplicate-all]").click()
    await waitFor(() => document.getElementById("vault-feedback")
      .textContent.includes("1 file cannot be deduplicated"))
    assert.match(document.getElementById("vault-feedback").textContent,
      /Disk Saver cannot modify this file or its folder/)
    assert.doesNotMatch(document.getElementById("vault-feedback").textContent,
      /still waiting for review/)

    dom.window.close()
  })

  test("Cannot deduplicate filters expose no hidden deduplication action", async () => {
    const duplicate = item({
      path: "/pinokio/api/app/models/duplicate.bin",
      relative_path: "models/duplicate.bin",
      status: "duplicate",
      shareable: true
    })
    const unavailable = item({
      path: "/pinokio/api/app/models/blocked.bin",
      relative_path: "models/blocked.bin",
      status: "unavailable",
      unavailable_reason: "metadata"
    })
    const base = fixture([duplicate, unavailable])
    base.inventory.source_counts.duplicates["app:app"] = 1
    base.inventory.source_counts.unavailable["app:app"] = 1
    base.inventory.shareable_by_source["app:app"] = 1
    const response = (url) => {
      const filter = new URL(url, "http://localhost")
        .searchParams.get("status_filter") || "all"
      const result = JSON.parse(JSON.stringify(base))
      result.items = filter === "unavailable"
        ? [unavailable]
        : filter === "duplicate" ? [duplicate] : [duplicate, unavailable]
      result.inventory.current.count = result.items.length
      result.inventory.total = result.items.length
      result.inventory.end = result.items.length
      return result
    }
    const { dom } = await makePage(response, { appMode: true })
    const document = dom.window.document

    assert.ok(document.querySelector("[data-deduplicate-scope]"))
    const filter = document.getElementById("vault-status-filter")
    filter.value = "unavailable"
    filter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    await waitFor(() => document.querySelector(
      "[data-deduplicate-scope]") === null)
    assert.match(document.querySelector(".vault-table").textContent,
      /blocked\.bin/)
    assert.doesNotMatch(document.querySelector(".vault-table").textContent,
      /duplicate\.bin/)
    assert.equal(document.querySelector("[data-deduplicate-file]"), null)

    dom.window.close()
  })

  test("the external-folder prompt appears after a scan and respects dismissal", async () => {
    const scanned = fixture([item()])
    const { dom } = await makePage(scanned)
    const document = dom.window.document
    const prompt = document.getElementById("vault-external-prompt")

    assert.ok(prompt)
    assert.equal(prompt.hidden, false)
    assert.match(prompt.textContent, /Save space outside Pinokio/)
    assert.match(prompt.textContent,
      /Some files may be taking up space more than once\./)
    assert.match(prompt.querySelector("[data-find-folders]").textContent,
      /Find more savings/)
    assert.ok(prompt.querySelector("[data-find-folders]"))

    prompt.querySelector("[data-dismiss-external-prompt]").click()
    assert.equal(prompt.hidden, true)
    assert.equal(document.getElementById("btn-find-folders").disabled,
      false)
    assert.equal(dom.window.localStorage.getItem(
      "pinokio:vault:external-prompt-dismissed"),
      String(scanned.last_scan.ts))

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))
    assert.equal(prompt.hidden, true)

    scanned.last_scan.ts += 1
    document.querySelector('[data-view="all"]').click()
    await waitFor(() => document.querySelector('[data-view="all"].selected'))
    assert.equal(prompt.hidden, false)

    dom.window.close()

    const withoutScan = fixture([item()], { last_scan: null })
    const { dom: unscannedDom } = await makePage(withoutScan)
    assert.equal(unscannedDom.window.document.getElementById(
      "vault-external-prompt").hidden, true)
    assert.equal(unscannedDom.window.document.getElementById(
      "btn-find-folders").disabled, true)
    unscannedDom.window.close()

    const scanning = fixture([item()])
    scanning.scan = Object.assign({}, scanning.scan, {
      active: true,
      phase: "hashing"
    })
    const { dom: scanningDom } = await makePage(scanning)
    const scanningDocument = scanningDom.window.document
    assert.equal(scanningDocument.getElementById(
      "btn-find-folders").disabled, true)
    assert.equal(scanningDocument.querySelector(
      "[data-find-folders]").disabled, true)
    assert.match(scanningDocument.getElementById(
      "btn-find-folders").title, /current scan/i)
    scanningDom.window.close()
  })

  test("Find folders opens a chooser before starting a home search", async () => {
    const status = fixture([item()])
    const { dom, requests, pickerRequests } = await makePage(status)
    const document = dom.window.document
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const selectedThreshold = 50 * candidateBase ** 2

    document.getElementById("btn-find-folders").click()
    await waitFor(() => document.querySelector("[data-find-home-folder]"))
    assert.equal(document.getElementById("vault-find-overlay").hidden, false)
    assert.equal(document.getElementById("vault-find-title").textContent,
      "Choose where to search")
    assert.match(document.getElementById("vault-find-body").textContent,
      /Minimum file size\s*Search files this size and larger[\s\S]*Home folder\s*\/Users\/test\s*Another folder…\s*Choose a folder or drive/)
    const threshold = document.getElementById(
      "vault-find-candidate-size")
    assert.equal(threshold.value, String(100 * candidateBase ** 2))
    threshold.value = String(selectedThreshold)
    threshold.dispatchEvent(new dom.window.Event("change", {
      bubbles: true
    }))
    assert.match(document.getElementById(
      "vault-scan-size-label").textContent, /50 MB\+/)
    assert.equal(document.activeElement.hasAttribute(
      "data-find-home-folder"), true)
    assert.equal(pickerRequests.length, 0)
    assert.equal(requests.some((request) =>
      request.action === "find_folders"), false)

    document.querySelector("[data-find-home-folder]").click()
    await waitFor(() => requests.some((request) =>
      request.action === "find_folders"))
    assert.equal(requests.find((entry) =>
      entry.action === "find_folders").path, "/Users/test")
    const savedIndex = requests.findIndex((request) =>
      request.action === "set_candidate_size")
    const findIndex = requests.findIndex((request) =>
      request.action === "find_folders")
    assert.ok(savedIndex >= 0 && savedIndex < findIndex)
    assert.equal("candidate_size" in requests[findIndex], false)
    assert.equal(pickerRequests.length, 0)
    await waitFor(() => document.getElementById(
      "vault-find-overlay").hidden)
    dom.window.close()
  })

  test("a rejected minimum size save blocks pending folder discovery", async () => {
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    const saved = 100 * candidateBase ** 2
    const selected = 50 * candidateBase ** 2
    const { dom, requests } = await makePage(fixture([item()], {
      candidate_min_bytes: saved,
      global_candidate_min_bytes: saved
    }), {
      actionResults: {
        set_candidate_size: { error: "Could not save minimum file size." }
      }
    })
    const document = dom.window.document

    document.getElementById("btn-find-folders").click()
    await waitFor(() => document.querySelector("[data-find-home-folder]"))
    const selector = document.getElementById("vault-find-candidate-size")
    selector.value = String(selected)
    selector.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    document.querySelector("[data-find-home-folder]").click()

    await waitFor(() => document.getElementById(
      "vault-find-candidate-size").value === String(saved) &&
      /could not save minimum file size/i.test(
        document.getElementById("vault-feedback").textContent))
    assert.equal(requests.some((request) =>
      request.action === "find_folders"), false)

    dom.window.close()
  })

  test("Find folders explains when a lower threshold needs a global scan", async () => {
    const message = "Run a global scan with this minimum file size before searching folders."
    const { dom, requests } = await makePage(fixture([item()]), {
      actionResults: {
        find_folders: { error: message }
      }
    })
    const document = dom.window.document
    const candidateBase = process.platform === "win32" ? 1024 : 1000

    document.getElementById("btn-find-folders").click()
    await waitFor(() => document.querySelector("[data-find-home-folder]"))
    const threshold = document.getElementById("vault-find-candidate-size")
    threshold.value = String(50 * candidateBase ** 2)
    threshold.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    document.querySelector("[data-find-home-folder]").click()

    await waitFor(() => document.querySelector(
      ".vault-find-partial[role='alert']"))
    assert.equal(document.querySelector(
      ".vault-find-partial[role='alert']").textContent.trim(), message)
    assert.ok(document.querySelector("[data-find-home-folder]"))
    assert.equal("candidate_size" in requests.find((request) =>
      request.action === "find_folders"), false)
    dom.window.close()
  })

  test("Find folders uses the native picker and returns after cancellation", async () => {
    const status = fixture([item()])
    const custom = await makePage(status, {
      deferPicker: true
    })
    const customDocument = custom.dom.window.document

    customDocument.getElementById("btn-find-folders").click()
    await waitFor(() => customDocument.querySelector(
      "[data-find-other-folder]"))
    customDocument.querySelector("[data-find-other-folder]").click()
    await waitFor(() => custom.pickerRequests.length === 1)
    assert.equal(custom.requests.some((request) =>
      request.action === "find_folders"), false)
    custom.choosePickedPath("/Volumes/models")
    await waitFor(() => custom.requests.some((request) =>
      request.action === "find_folders"))
    assert.equal(custom.requests.find((entry) =>
      entry.action === "find_folders").path, "/Volumes/models")
    await waitFor(() => customDocument.getElementById(
      "vault-find-overlay").hidden)
    custom.dom.window.close()

    const cancelled = await makePage(status, {
      deferPicker: true
    })
    const cancelledDocument = cancelled.dom.window.document
    cancelledDocument.getElementById("btn-find-folders").click()
    await waitFor(() => cancelledDocument.querySelector(
      "[data-find-other-folder]"))
    cancelledDocument.querySelector("[data-find-other-folder]").click()
    await waitFor(() => cancelled.pickerRequests.length === 1)
    cancelled.choosePickedPath(null)
    await settle()
    assert.equal(cancelled.requests.some((request) =>
      request.action === "find_folders"), false)
    assert.ok(cancelledDocument.querySelector("[data-find-home-folder]"))
    assert.equal(cancelledDocument.getElementById(
      "vault-find-overlay").hidden, false)
    cancelledDocument.dispatchEvent(new cancelled.dom.window.KeyboardEvent(
      "keydown", { key: "Escape", bubbles: true }))
    await waitFor(() => cancelledDocument.getElementById(
      "vault-find-overlay").hidden)
    assert.equal(cancelled.requests.some((request) =>
      request.action === "clear_find_folders"), false)
    cancelled.dom.window.close()
  })

  test("an accepted folder search stays closable when status refresh fails", async () => {
    const { dom, requests } = await makePage(fixture([item()]), {
      statusFailuresAfterFindFolders: 1
    })
    const document = dom.window.document

    await startHomeFolderDiscovery(document)
    await waitFor(() => document.getElementById(
      "vault-find-body").textContent.includes(
      "Couldn’t load Disk Saver status (503)"))
    const close = document.querySelector("[data-close-find-folders]")
    assert.equal(close.disabled, false)
    assert.equal(document.querySelector("[data-find-home-folder]").disabled,
      true)
    close.click()
    assert.equal(document.getElementById("vault-find-overlay").hidden, true)
    assert.equal(requests.filter((request) =>
      request.action === "find_folders").length, 1)
    assert.equal(requests.some((request) =>
      request.action === "clear_find_folders"), false)
    dom.window.close()
  })

  test("closing and reopening cannot duplicate a pending folder search", async () => {
    const page = await makePage(fixture([item()]), {
      deferFolderDiscoveryStart: true
    })
    const document = page.dom.window.document

    await startHomeFolderDiscovery(document)
    await waitFor(() => page.requests.filter((request) =>
      request.action === "find_folders").length === 1)
    document.querySelector("[data-close-find-folders]").click()
    document.getElementById("btn-find-folders").click()
    await waitFor(() => document.getElementById(
      "vault-find-overlay").hidden === false)
    const home = document.querySelector("[data-find-home-folder]")
    assert.equal(home.disabled, true)
    home.click()
    await settle()
    assert.equal(page.requests.filter((request) =>
      request.action === "find_folders").length, 1)
    await page.releaseFolderDiscoveryStart()
    await waitFor(() => document.getElementById(
      "vault-find-overlay").hidden)
    page.dom.window.close()
  })

  test("a failed status refresh recovers from active progress", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: true,
      pending: false,
      phase: "discovering",
      root: "/Volumes/existing-search",
      threshold: 100000000,
      started: Date.now(),
      dirs: 1,
      files: 2,
      candidates: 0,
      candidates_known: false,
      last_activity: Date.now()
    }
    const { dom } = await makePage(status, {
      actionResults: {
        find_folders: { started: false, already_running: true }
      },
      statusFailuresAfterFindFolders: 1,
      fastStatusRetry: true
    })
    const document = dom.window.document

    await startHomeFolderDiscovery(document)
    await waitFor(() => document.getElementById(
      "vault-find-body").textContent.includes("/Volumes/existing-search"))
    assert.equal(document.querySelector("[data-find-home-folder]"), null)
    assert.equal(document.querySelector(".vault-find-dialog")
      .getAttribute("aria-busy"), "false")
    dom.window.close()
  })

  test("Find folders shows an existing concurrent search", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: true,
      pending: false,
      phase: "discovering",
      root: "/Volumes/existing-search",
      threshold: 100000000,
      started: Date.now(),
      dirs: 0,
      files: 0,
      candidates: 0,
      candidates_known: false,
      last_activity: Date.now()
    }
    const { dom, requests } = await makePage(status, {
      actionResults: {
        find_folders: { started: false, already_running: true }
      }
    })
    const document = dom.window.document

    await startHomeFolderDiscovery(document)
    await waitFor(() => document.getElementById(
      "vault-find-body").textContent.includes("Another folder search"))
    assert.match(document.getElementById("vault-find-body").textContent,
      /Another folder search is already running[\s\S]*\/Volumes\/existing-search/)
    assert.equal(requests.find((request) =>
      request.action === "find_folders").path, "/Users/test")
    dom.window.close()
  })

  test("Find folders focuses the custom picker when home is unavailable", async () => {
    const { dom, requests } = await makePage(fixture([item()]), {
      homePath: ""
    })
    const document = dom.window.document

    document.getElementById("btn-find-folders").click()
    await waitFor(() => document.querySelector("[data-find-other-folder]"))
    assert.equal(document.querySelector("[data-find-home-folder]").disabled,
      true)
    assert.equal(document.activeElement.hasAttribute(
      "data-find-other-folder"), true)
    document.querySelector("[data-close-find-folders]").click()
    assert.equal(requests.some((request) =>
      request.action === "find_folders"), false)
    dom.window.close()
  })

  test("Find folders returns completed searches to the scope chooser", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: false,
      pending: false,
      phase: "complete",
      root: "/Users/test",
      started: 100,
      result_count: 0,
      result_files: 0,
      result_bytes: 0,
      partial: false
    }
    status.folder_discovery_results = {
      root: {
        folder: "/Users/test",
        name: "test",
        file_count: 0,
        bytes: 0,
        eligible_file_count: 1,
        eligible_bytes: 4096,
        child_count: 0
      },
      items: [],
      total: 0,
      page: 0,
      page_size: 500,
      pages: 1,
      recommendations: {
        items: [], total: 0, page: 0, page_size: 500, pages: 1
      },
      selection: {
        selected_count: 0,
        selected_files: 0,
        potential_savings: 0
      }
    }
    const { dom, requests } = await makePage(status)
    const document = dom.window.document

    await startHomeFolderDiscovery(document)
    await waitFor(() => document.querySelector(
      "[data-search-somewhere-else]"))
    document.querySelector("[data-search-somewhere-else]").click()
    await waitFor(() => document.querySelector("[data-find-home-folder]"))
    assert.equal(requests.some((request) =>
      request.action === "clear_find_folders"), true)
    assert.equal(document.getElementById("vault-find-overlay").hidden, false)
    dom.window.close()
  })

  test("Find folders shows truthful live discovery and determinate verification progress", async () => {
    const discovering = fixture([item()])
    const candidateBase = process.platform === "win32" ? 1024 : 1000
    discovering.last_scan.candidate_min_bytes = candidateBase ** 2
    discovering.folder_discovery = {
      active: true,
      pending: false,
      phase: "discovering",
      root: "/Users/test",
      started: Date.now() - 125000,
      threshold: 100 * candidateBase ** 2,
      dirs: 1234,
      files: 32013427,
      candidates: 0,
      candidates_known: false,
      current_folder: "/Users/test/Library/Application Support",
      last_activity: Date.now()
    }
    const initialFiles = discovering.folder_discovery.files
    const { dom: discoveringDom } = await makePage((url) => {
      if (url.includes("progress=1")) {
        discovering.folder_discovery.files = initialFiles + 1500
      }
      return discovering
    })
    const discoveringDocument = discoveringDom.window.document
    await startHomeFolderDiscovery(discoveringDocument)
    await waitFor(() => discoveringDocument.getElementById(
      "vault-find-body").textContent.includes("32,013,427"))
    const discoveryBody = discoveringDocument.getElementById("vault-find-body")
    assert.deepEqual([...discoveryBody.querySelectorAll(
      ".vault-find-stage > span:last-child"
    )].map((stage) => stage.textContent), [
      "Searching", "Verifying", "Suggestions"
    ])
    assert.equal(discoveryBody.querySelector(
      ".vault-find-stage[aria-current='step'] > span:last-child"
    ).textContent, "Searching")
    assert.match(discoveryBody.textContent, /1,234 folders checked/)
    assert.match(discoveryBody.textContent,
      /Currently scanning\/Users\/test\/Library\/Application Support/)
    assert.match(discoveryBody.textContent, /Active now/)
    assert.match(discoveryBody.textContent,
      /Minimum file size: 100 MB/)
    assert.doesNotMatch(discoveryBody.textContent,
      /Minimum file size: 1 MB/)
    assert.equal(discoveryBody.textContent.includes("files/sec"), false)
    assert.match(discoveryBody.textContent, /2m \d+s elapsed/)
    assert.equal(discoveryBody.textContent.includes("Updated"), false)
    assert.equal(discoveryBody.textContent.includes("possible matches"), false)
    assert.equal(discoveryBody.querySelector("[aria-live]"), null)
    assert.equal(discoveryBody.querySelector("[role='progressbar']"), null)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await waitFor(() => discoveryBody.textContent.includes("files/sec"))
    assert.match(discoveryBody.textContent, /[\d,]+ files\/sec/)
    discoveringDom.window.close()

    const missingThreshold = fixture([item()])
    missingThreshold.last_scan.candidate_min_bytes = candidateBase ** 2
    missingThreshold.folder_discovery = Object.assign(
      {}, discovering.folder_discovery)
    delete missingThreshold.folder_discovery.threshold
    const { dom: missingThresholdDom } = await makePage(missingThreshold)
    const missingThresholdDocument = missingThresholdDom.window.document
    await startHomeFolderDiscovery(missingThresholdDocument)
    await waitFor(() => missingThresholdDocument.getElementById(
      "vault-find-body").textContent.includes("Currently scanning"))
    assert.doesNotMatch(missingThresholdDocument.getElementById(
      "vault-find-body").textContent, /Minimum file size:/)
    missingThresholdDom.window.close()

    const liveDiscovery = fixture([item()])
    liveDiscovery.folder_discovery = Object.assign(
      {}, discovering.folder_discovery, {
        candidates: 42,
        candidates_known: true
      })
    const { dom: liveDiscoveryDom } = await makePage(liveDiscovery)
    const liveDiscoveryDocument = liveDiscoveryDom.window.document
    await startHomeFolderDiscovery(liveDiscoveryDocument)
    await waitFor(() => liveDiscoveryDocument.getElementById(
      "vault-find-body").textContent.includes(
      "42 possible matches queued for verification"))
    liveDiscoveryDom.window.close()

    const stalledDiscovery = fixture([item()])
    stalledDiscovery.folder_discovery = Object.assign(
      {}, discovering.folder_discovery, {
        last_activity: Date.now() - 15000
      })
    const { dom: stalledDiscoveryDom } = await makePage(stalledDiscovery)
    const stalledDiscoveryDocument = stalledDiscoveryDom.window.document
    await startHomeFolderDiscovery(stalledDiscoveryDocument)
    await waitFor(() => stalledDiscoveryDocument.getElementById(
      "vault-find-body").textContent.includes("No activity for"))
    assert.match(stalledDiscoveryDocument.getElementById(
      "vault-find-body").textContent, /No activity for \d+s/)
    assert.ok(stalledDiscoveryDocument.querySelector(
      ".vault-find-progress-heading .fa-clock"))
    stalledDiscoveryDom.window.close()

    const verifying = fixture([item()])
    verifying.folder_discovery = {
      active: true,
      pending: false,
      phase: "hashing",
      root: "/Users/test",
      started: Date.now() - 125000,
      threshold: 100000000,
      candidates: 992,
      candidates_known: true,
      processed: 423,
      verified_files: 37,
      verified_bytes: 18400000000,
      current_file: "model.bin",
      last_activity: Date.now()
    }
    const { dom: verifyingDom } = await makePage(verifying)
    const verifyingDocument = verifyingDom.window.document
    await startHomeFolderDiscovery(verifyingDocument)
    await waitFor(() => verifyingDocument.getElementById(
      "vault-find-body").textContent.includes("423 of 992"))
    const verifyingBody = verifyingDocument.getElementById("vault-find-body")
    assert.match(verifyingBody.textContent,
      /423 of 992 candidates checked/)
    assert.match(verifyingBody.textContent,
      /37 identical files · 18.4 GB matched so far/)
    assert.match(verifyingBody.textContent,
      /Currently verifyingmodel\.bin/)
    assert.equal(verifyingBody.querySelector("[aria-live]"), null)
    const progress = verifyingBody.querySelector("[role='progressbar']")
    assert.equal(progress.getAttribute("aria-label"),
      "423 of 992 candidates checked")
    assert.equal(progress.getAttribute("aria-valuenow"), "423")
    assert.equal(progress.getAttribute("aria-valuemax"), "992")
    verifyingDom.window.close()
  })

  test("Find folders locks and adds verified partial recommendations", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: false,
      pending: false,
      phase: "completed_with_exclusions",
      root: "/Users/test",
      started: 101,
      threshold: 100000000,
      result_count: 1,
      result_files: 23,
      result_bytes: 8400000000,
      partial: true
    }
    status.folder_discovery_results = {
      root: {
        folder: "/Users/test",
        name: "test",
        file_count: 23,
        bytes: 8400000000,
        eligible_file_count: 100,
        eligible_bytes: 15000000000,
        child_count: 1
      },
      items: [{
        folder: "/Users/test/Library/OtherApp",
        parent: "/Users/test",
        name: "OtherApp",
        file_count: 23,
        bytes: 8400000000,
        eligible_file_count: 80,
        eligible_bytes: 12000000000,
        child_count: 1
      }],
      total: 1,
      page: 0,
      page_size: 500,
      pages: 1,
      recommendations: {
        items: [{
          folder: "/Users/test/Library/OtherApp/models",
          name: "models",
          file_count: 23,
          bytes: 8400000000
        }],
        total: 1,
        page: 0,
        page_size: 500,
        pages: 1
      },
      selection: {
        selected_count: 0,
        selected_files: 0,
        potential_savings: 0
      }
    }
    const childManifest = {
      folder: "/Users/test/Library/OtherApp",
      items: [{
            folder: "/Users/test/Library/OtherApp/models",
            parent: "/Users/test/Library/OtherApp",
            name: "models",
            file_count: 23,
            bytes: 8400000000,
            eligible_file_count: 24,
            eligible_bytes: 8500000000,
            child_count: 0
      }],
      total: 1,
      page: 0,
      page_size: 500,
      pages: 1
    }
    const {
      dom,
      requests,
      releaseFolderDiscoveryAdd
    } = await makePage(status, {
      deferFolderDiscoveryAdd: true,
      folderDiscoveryChildren: {
        "/Users/test/Library/OtherApp": childManifest
      }
    })
    const document = dom.window.document

    await startHomeFolderDiscovery(document)
    await waitFor(() => document.querySelector(
      "[data-add-found-folders]"))
    const modal = document.getElementById("vault-find-body")
    assert.equal(document.getElementById("vault-find-title").textContent,
      "Suggested locations")
    assert.match(modal.textContent, /Verified identical files only/)
    assert.match(modal.textContent, /Partial results/)
    assert.match(modal.textContent, /Choose folders to watch/)
    assert.match(modal.textContent,
      /Nothing is scanned or changed until you run a scan\./)
    assert.match(modal.textContent, /23 identical files/)
    assert.match(modal.querySelector(".vault-find-results-footer").textContent,
      /0 locations selected0 identical files · Can save 0 B/)
    assert.equal(document.querySelector("[data-add-found-folders]").disabled,
      true)
    const rootRow = document.querySelector(
      '[data-select-found-folder="/Users/test"]'
    ).closest(".vault-find-tree-row")
    assert.doesNotMatch(rootRow.textContent, /selected inside/)
    assert.equal(modal.querySelector(".vault-find-tree-badge"), null)
    assert.equal(document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]'),
    null)
    const clusterToggle = document.querySelector(
      '[data-toggle-found-folder="/Users/test/Library/OtherApp"]')
    assert.equal(clusterToggle.getAttribute("aria-expanded"), "false")
    clusterToggle.click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]'))
    assert.equal(document.querySelector(
      '[data-toggle-found-folder="/Users/test/Library/OtherApp"]')
      .getAttribute("aria-expanded"), "true")
    assert.match(modal.textContent, /adds 12 GB to future scans/)
    const expandedParentRow = document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp"]'
    ).closest(".vault-find-tree-row")
    assert.doesNotMatch(expandedParentRow.textContent, /selected inside/)
    assert.equal(modal.querySelector(".vault-find-tree-badge"), null)
    document.querySelector(
      '[data-toggle-found-folder="/Users/test/Library/OtherApp"]')
      .click()
    assert.equal(document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]'),
    null)
    document.querySelector(
      '[data-toggle-found-folder="/Users/test/Library/OtherApp"]')
      .click()
    const parent = document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp"]')
    const root = document.querySelector(
      '[data-select-found-folder="/Users/test"]')
    const recommended = document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]')
    assert.equal(root.indeterminate, false)
    assert.equal(parent.indeterminate, false)
    assert.equal(recommended.checked, false)
    assert.equal(modal.querySelector("[aria-checked='mixed']"), null)
    recommended.click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]')
      .checked)
    document.querySelector(
      '[data-select-found-folder="/Users/test"]').click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test"]')
      .checked)
    assert.equal(document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]')
      .checked, false)
    document.querySelector(
      '[data-select-found-folder="/Users/test/Library/OtherApp/models"]')
      .click()
    await waitFor(() => !document.querySelector(
      '[data-select-found-folder="/Users/test"]')
      .checked)

    document.querySelector("[data-add-found-folders]").click()
    await waitFor(() => requests.some((request) =>
      request.action === "add_folder_discovery_sources"))
    const dialog = document.querySelector(".vault-find-dialog")
    assert.equal(dialog.getAttribute("aria-busy"), "true")
    assert.equal(document.querySelector(".vault-find-close").disabled, true)
    assert.ok([...document.querySelectorAll(
      "#vault-find-body button, #vault-find-body input"
    )].every((control) => control.disabled))
    await releaseFolderDiscoveryAdd()
    await settle()
    dom.window.close()
  })

  test("Find folders allows a parent or descendant without overlapping selections", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: false,
      pending: false,
      phase: "complete",
      root: "/Users/test",
      started: 123,
      result_count: 1,
      result_files: 2,
      result_bytes: 8000,
      partial: false
    }
    status.folder_discovery_results = {
      root: {
        folder: "/Users/test",
        name: "test",
        file_count: 2,
        bytes: 8000,
        eligible_file_count: 75,
        eligible_bytes: 300000,
        child_count: 1
      },
      items: [{
        folder: "/Users/test/.comfycraft",
        parent: "/Users/test",
        name: ".comfycraft",
        file_count: 2,
        bytes: 8000,
        eligible_file_count: 50,
        eligible_bytes: 200000,
        child_count: 1
      }],
      total: 1,
      page: 0,
      page_size: 500,
      pages: 1,
      recommendations: {
        items: [{
          folder: "/Users/test/.comfycraft/kits",
          name: "kits",
          file_count: 2,
          bytes: 8000
        }],
        total: 1,
        page: 0,
        page_size: 500,
        pages: 1
      },
      selection: {
        selected_count: 0,
        selected_files: 0,
        potential_savings: 0
      }
    }
    const { dom, requests } = await makePage(status, {
      folderDiscoveryChildren: {
        "/Users/test/.comfycraft": {
          folder: "/Users/test/.comfycraft",
          items: [{
            folder: "/Users/test/.comfycraft/kits",
            parent: "/Users/test/.comfycraft",
            name: "kits",
            file_count: 2,
            bytes: 8000,
            eligible_file_count: 4,
            eligible_bytes: 16000,
            child_count: 1
          }],
          total: 1, page: 0, page_size: 500, pages: 1
        },
        "/Users/test/.comfycraft/kits": {
          folder: "/Users/test/.comfycraft/kits",
          items: [{
            folder: "/Users/test/.comfycraft/kits/ace",
            parent: "/Users/test/.comfycraft/kits",
            name: "ace",
            file_count: 1,
            bytes: 4000,
            eligible_file_count: 2,
            eligible_bytes: 8000,
            child_count: 0
          }],
          total: 1, page: 0, page_size: 500, pages: 1
        }
      }
    })
    const document = dom.window.document
    await startHomeFolderDiscovery(document)
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft"]'))

    const parent = document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft"]')
    parent.click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft"]')
      .checked)
    assert.equal(document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft/kits"]'), null)
    document.querySelector(
      '[data-toggle-found-folder="/Users/test/.comfycraft"]')
      .click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft/kits"]'))
    assert.equal(document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft/kits"]')
      .checked, false)

    document.querySelector(
      '[data-toggle-found-folder="/Users/test/.comfycraft/kits"]')
      .click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft/kits/ace"]'))
    const child = document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft/kits/ace"]')
    child.click()
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft/kits/ace"]')
      .checked)
    assert.equal(document.querySelector(
      '[data-select-found-folder="/Users/test/.comfycraft"]')
      .checked, false)

    document.querySelector("[data-add-found-folders]").click()
    await waitFor(() => requests.some((request) =>
      request.action === "add_folder_discovery_sources"))
    assert.equal(requests.filter((request) =>
      request.action === "update_folder_discovery_selection").length, 2)
    await settle()
    dom.window.close()
  })

  test("Find folders leaves recommendations unselected until the user chooses one", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: false,
      pending: false,
      phase: "complete",
      root: "/Users/test",
      started: 456,
      result_count: 2,
      result_files: 2,
      result_bytes: 12000,
      partial: false
    }
    const resultBase = {
      root: {
        folder: "/Users/test",
        name: "test",
        file_count: 2,
        bytes: 12000,
        eligible_file_count: 20,
        eligible_bytes: 50000,
        direct_file_count: 1
      },
      items: [{
        folder: "/Users/test/first",
        name: "first",
        file_count: 1,
        bytes: 7000,
        eligible_file_count: 2,
        eligible_bytes: 8000
      }],
      total: 2,
      page: 0,
      page_size: 1,
      pages: 2,
      recommendations: {
        items: [{
          folder: "/Users/test/first",
          name: "first",
          file_count: 1,
          bytes: 7000
        }],
        total: 1,
        page: 0,
        page_size: 500,
        pages: 1
      },
      selection: {
        selected_count: 0,
        selected_files: 0,
        potential_savings: 0
      }
    }
    const response = () => Object.assign({}, status, {
      folder_discovery_results: resultBase
    })
    const { dom, requests } = await makePage(response)
    const document = dom.window.document
    await startHomeFolderDiscovery(document)
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/first"]'))
    const recommendation = document.querySelector(
      '[data-select-found-folder="/Users/test/first"]')
    const add = document.querySelector("[data-add-found-folders]")
    assert.equal(recommendation.checked, false)
    assert.equal(add.disabled, true)
    assert.match(document.querySelector(".vault-find-results-footer")
      .textContent, /0 locations selected/)
    assert.equal(document.querySelector(".vault-find-tree-badge"), null)
    const rootRow = document.querySelector(
      '[data-select-found-folder="/Users/test"]'
    ).closest(".vault-find-tree-row")
    assert.match(rootRow.textContent, /1 file here/)
    assert.doesNotMatch(
      recommendation.closest(".vault-find-tree-row").textContent,
      /file here/)

    recommendation.click()
    await waitFor(() => requests.some((request) =>
      request.action === "update_folder_discovery_selection"))
    await waitFor(() => document.querySelector(
      '[data-select-found-folder="/Users/test/first"]').checked)
    assert.equal(document.querySelector("[data-add-found-folders]").disabled,
      false)
    await settle()
    dom.window.close()
  })

  test("Find folders traps modal focus, preserves row focus, and restores its opener", async () => {
    const status = fixture([item()])
    status.folder_discovery = {
      active: false,
      pending: false,
      phase: "complete",
      root: "/Users/test",
      started: 789,
      result_count: 1,
      result_files: 1,
      result_bytes: 4096,
      partial: false
    }
    status.folder_discovery_results = {
      root: {
        folder: "/Users/test",
        name: "test",
        file_count: 1,
        bytes: 4096,
        eligible_file_count: 2,
        eligible_bytes: 8192
      },
      items: [{
        folder: "/Users/test/models",
        file_count: 1,
        bytes: 4096,
        eligible_file_count: 1,
        eligible_bytes: 4096
      }],
      total: 1,
      page: 0,
      page_size: 500,
      pages: 1,
      recommendations: {
        items: [{
          folder: "/Users/test/models",
          name: "models",
          file_count: 1,
          bytes: 4096
        }],
        total: 1,
        page: 0,
        page_size: 500,
        pages: 1
      }
    }
    const { dom } = await makePage(status)
    const document = dom.window.document
    const opener = document.querySelector(".vault-external-prompt-action")
    await startHomeFolderDiscovery(document, opener)
    await waitFor(() => document.querySelector(
      "[data-select-found-folder]"))
    assert.equal(document.activeElement.classList.contains(
      "vault-find-dialog"), true)
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true
    }))
    assert.equal(document.activeElement.hasAttribute(
      "data-close-find-folders"), true)

    const checkbox = document.querySelector(
      '[data-select-found-folder="/Users/test/models"]')
    checkbox.focus()
    checkbox.click()
    await waitFor(() => {
      const current = document.querySelector(
        '[data-select-found-folder="/Users/test/models"]')
      return current && !current.disabled
    })
    assert.equal(document.activeElement.dataset.selectFoundFolder,
      "/Users/test/models")

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true
    }))
    await waitFor(() => document.getElementById(
      "vault-find-overlay").hidden)
    assert.equal(document.activeElement, opener)
    dom.window.close()
  })

  test("search keeps focus while debounced results refresh", async () => {
    const status = fixture([item()])
    const urls = []
    const { dom } = await makePage((url) => {
      urls.push(url)
      return status
    })
    const document = dom.window.document
    urls.length = 0

    const search = document.getElementById("vault-search")
    search.focus()
    search.value = "model"
    search.setSelectionRange(3, 3)
    search.dispatchEvent(new dom.window.Event("input", {
      bubbles: true
    }))

    await waitFor(() => urls.some((url) =>
      url.includes("q=model")))
    await waitFor(() =>
      document.getElementById("vault-search") !== search)

    const refreshedSearch = document.getElementById("vault-search")
    assert.equal(document.activeElement, refreshedSearch)
    assert.equal(refreshedSearch.value, "model")
    assert.equal(refreshedSearch.selectionStart, 3)
    assert.equal(refreshedSearch.selectionEnd, 3)

    dom.window.close()
  })

  test("Duplicates can switch between location groups and content groups", async () => {
    const duplicate = item({
      path: "/pinokio/api/app/models/duplicate.bin",
      relative_path: "models/duplicate.bin",
      status: "duplicate",
      shareable: true,
      match: {
        path: "/Users/test/Models/original.bin",
        source_id: "external:models",
        source_label: "Models",
        relative_path: "original.bin"
      }
    })
    const status = fixture([duplicate])
    status.inventory.source_counts.duplicates["app:app"] = 1
    status.inventory.shareable_by_source["app:app"] = 1
    delete status.inventory.current.deduplicate_bytes
    const grouped = JSON.parse(JSON.stringify(status))
    grouped.items = [{
      kind: "duplicate_group",
      hash: duplicate.hash,
      path: duplicate.path,
      size: duplicate.size,
      total_count: 2,
      eligible_count: 1,
      can_save: duplicate.size,
      source_id: duplicate.source_id,
      source_kind: duplicate.source_kind,
      source_label: duplicate.source_label,
      relative_path: duplicate.relative_path
    }]
    grouped.inventory.total = 1
    grouped.inventory.end = 1
    const children = {
      hash: duplicate.hash,
      total: 2,
      next_cursor: null,
      items: [
        Object.assign({}, duplicate, {
          kind: "duplicate_path",
          registry_status: "duplicate",
          selectable: true
        }),
        item({
          kind: "duplicate_path",
          path: "/Users/test/Models/original.bin",
          relative_path: "original.bin",
          status: "tracked",
          registry_status: "reference",
          shareable: false,
          selectable: false,
          source_id: "external:models",
          source_kind: "external",
          source_label: "Models"
        })
      ]
    }

    const { dom, requests } = await makePage((url) => {
      if (url.includes("group_hash=")) return children
      return url.includes("display_mode=files") ? grouped : status
    })
    const document = dom.window.document

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))

    assert.equal(
      document.getElementById("vault-toolbar-summary").textContent.trim(),
      "1 file · 1 location"
    )
    assert.equal(
      document.querySelector("[data-deduplicate-all]").textContent.trim(),
      `Deduplicate all 1 file (${dom.window.PinokioFormatStorageSize(
        status.pending_bytes
      )})`
    )

    const displayMode = document.querySelector(".vault-display-mode")
    assert.ok(displayMode)
    assert.equal(document.querySelector(
      '[data-display-mode="folders"]').getAttribute("aria-pressed"), "true")
    assert.ok(document.querySelector(".vault-table.matches"))
    assert.match(document.querySelector(".vault-group-title").textContent,
      /Pinokio \/ Apps \/ app/)
    assert.doesNotMatch(document.getElementById("vault-toolbar").textContent,
      /By location/)

    document.querySelector('[data-display-mode="files"]').click()
    await waitFor(() => document.querySelector(
      '[data-display-mode="files"]').getAttribute("aria-pressed") === "true")

    const table = document.querySelector(".vault-table.duplicate-files")
    assert.ok(table)
    assert.match(table.querySelector(".vault-columns").textContent,
      /NameCopiesSize eachCan save/)
    assert.equal(table.querySelectorAll(
      ".vault-duplicate-content-group").length, 1)
    assert.match(table.querySelector(
      ".vault-duplicate-content-group").textContent,
      /duplicate\.bin2 identical copies · 1 can be deduplicated/)
    assert.equal(document.querySelector(
      "[data-select-duplicate-page]"), null)

    table.querySelector("[data-expand-duplicate-group]").click()
    await waitFor(() => document.querySelectorAll(
      ".vault-duplicate-child").length === 2)
    assert.match(document.querySelector(
      ".vault-duplicate-children").textContent,
      /duplicate\.bin/)
    assert.match(document.querySelector(
      ".vault-duplicate-children").textContent,
      /original\.bin/)
    assert.equal(document.querySelector(
      ".vault-duplicate-content-group [data-reveal-file]"), null)
    const revealButtons = document.querySelectorAll(
      ".vault-duplicate-child [data-reveal-file]")
    assert.equal(revealButtons.length, 2)
    const revealLabel = process.platform === "darwin"
      ? "Show in Finder"
      : process.platform === "win32"
        ? "Show in File Explorer"
        : "Open containing folder"
    assert.equal(revealButtons[0].title, revealLabel)
    assert.match(revealButtons[0].getAttribute("aria-label"),
      new RegExp(`^${revealLabel}:`))

    revealButtons[0].click()
    await waitFor(() => requests.some((request) =>
      request.action === "reveal"))
    const reveal = requests.find((request) => request.action === "reveal")
    assert.equal(reveal.path, duplicate.path)
    assert.equal(reveal.scope_id, null)

    dom.window.close()
  })

  test("Duplicate rows can be selected and deduplicated as a bounded batch", async () => {
    const first = item({
      path: "/pinokio/api/app/models/first.bin",
      relative_path: "models/first.bin",
      status: "duplicate",
      shareable: true
    })
    const second = item({
      path: "/pinokio/api/app/models/second.bin",
      relative_path: "models/second.bin",
      status: "duplicate",
      shareable: true
    })
    const status = fixture([first, second])
    status.inventory.source_counts.duplicates["app:app"] = 2
    status.inventory.shareable_by_source["app:app"] = 2
    const grouped = JSON.parse(JSON.stringify(status))
    grouped.items = [{
      kind: "duplicate_group",
      hash: first.hash,
      path: first.path,
      size: first.size,
      total_count: 3,
      eligible_count: 2,
      can_save: first.size + second.size,
      source_id: first.source_id,
      source_kind: first.source_kind,
      source_label: first.source_label,
      relative_path: first.relative_path
    }]
    grouped.inventory.total = 1
    grouped.inventory.end = 1
    const childItems = [
      Object.assign({}, first, {
        kind: "duplicate_path",
        registry_status: "duplicate",
        selectable: true
      }),
      Object.assign({}, second, {
        kind: "duplicate_path",
        registry_status: "duplicate",
        selectable: true
      }),
      item({
        kind: "duplicate_path",
        path: "/pinokio/api/app/models/reference.bin",
        relative_path: "models/reference.bin",
        status: "tracked",
        registry_status: "reference",
        shareable: false,
        selectable: false
      })
    ]

    const { dom, requests } = await makePage((url) => {
      if (url.includes("group_page_select=1")) {
        return {
          items: [first, second].map((entry) => ({
            path: entry.path,
            hash: entry.hash,
            size: entry.size
          })),
          exceeded: false
        }
      }
      if (url.includes("group_select=1")) {
        return {
          hash: first.hash,
          paths: [first.path, second.path],
          exceeded: false
        }
      }
      if (url.includes("group_hash=")) {
        return {
          hash: first.hash,
          total: childItems.length,
          next_cursor: null,
          items: childItems
        }
      }
      return url.includes("display_mode=files") ? grouped : status
    })
    const document = dom.window.document

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))

    let checkboxes = document.querySelectorAll(
      "[data-select-duplicate]")
    assert.equal(checkboxes.length, 2)
    const selectPage = document.querySelector(
      "[data-select-duplicate-page]")
    assert.ok(selectPage)
    assert.equal(selectPage.checked, false)

    checkboxes[0].click()
    assert.equal(selectPage.indeterminate, true)
    assert.equal(
      document.querySelector("[data-deduplicate-selected]")
        .textContent.trim(),
      `Deduplicate selected file (${dom.window.PinokioFormatStorageSize(
        first.size
      )})`
    )
    assert.equal(document.querySelector("[data-deduplicate-all]"), null)

    document.querySelector('[data-display-mode="files"]').click()
    await waitFor(() => document.querySelector(
      ".vault-table.duplicate-files"))
    const groupPageCheckbox = document.querySelector(
      "[data-select-duplicate-group-page]")
    assert.ok(groupPageCheckbox)
    assert.equal(groupPageCheckbox.checked, false)
    groupPageCheckbox.click()
    await waitFor(() => document.querySelector(
      "[data-deduplicate-selected]") &&
      document.querySelector("[data-deduplicate-selected]")
        .textContent.includes("2 selected"))
    assert.equal(document.querySelector(
      "[data-select-duplicate-group-page]").checked, true)
    assert.equal(document.querySelector(
      "[data-select-duplicate-group]").checked, true)
    document.querySelector(
      "[data-select-duplicate-group-page]").click()
    assert.equal(document.querySelector(
      "[data-deduplicate-selected]"), null)

    let groupCheckbox = document.querySelector(
      "[data-select-duplicate-group]")
    assert.ok(groupCheckbox)
    assert.equal(groupCheckbox.checked, false)
    assert.equal(groupCheckbox.indeterminate, false)
    assert.equal(document.querySelector(
      "[data-deduplicate-selected]"), null)

    document.querySelector("[data-expand-duplicate-group]").click()
    await waitFor(() => document.querySelectorAll(
      "[data-select-duplicate]").length === 2)
    checkboxes = document.querySelectorAll("[data-select-duplicate]")
    assert.equal(checkboxes[0].checked, false)
    assert.equal(checkboxes[1].checked, false)
    checkboxes[0].click()
    assert.equal(document.querySelector(
      "[data-select-duplicate-group]").indeterminate, true)

    groupCheckbox = document.querySelector(
      "[data-select-duplicate-group]")
    groupCheckbox.click()
    await waitFor(() => document.querySelector(
      "[data-deduplicate-selected]") &&
      document.querySelector("[data-deduplicate-selected]")
        .textContent.includes("2 selected"))
    const selectedAction = document.querySelector(
      "[data-deduplicate-selected]")
    assert.equal(
      selectedAction.textContent.trim(),
      `Deduplicate 2 selected files (${dom.window.PinokioFormatStorageSize(
        first.size + second.size
      )})`
    )
    selectedAction.click()

    await waitFor(() => requests.some((request) =>
      request.action === "deduplicate_files"))
    assert.deepEqual(
      requests.find((request) =>
        request.action === "deduplicate_files"),
      {
        action: "deduplicate_files",
        paths: [first.path, second.path]
      }
    )
    await settle()
    dom.window.close()
  })

  test("an oversized content group is not partially selected", async () => {
    const duplicate = item({
      status: "duplicate",
      shareable: true
    })
    const status = fixture([duplicate])
    status.inventory.source_counts.duplicates["app:app"] = 501
    status.inventory.shareable_by_source["app:app"] = 501
    const grouped = JSON.parse(JSON.stringify(status))
    grouped.items = [{
      kind: "duplicate_group",
      hash: duplicate.hash,
      path: duplicate.path,
      size: duplicate.size,
      total_count: 502,
      eligible_count: 501,
      can_save: duplicate.size * 501,
      source_id: duplicate.source_id,
      source_kind: duplicate.source_kind,
      source_label: duplicate.source_label,
      relative_path: duplicate.relative_path
    }]
    grouped.inventory.current.count = 501
    grouped.inventory.total = 1
    grouped.inventory.end = 1

    const { dom } = await makePage((url) => {
      if (url.includes("group_select=1")) {
        return {
          hash: duplicate.hash,
          paths: [],
          exceeded: true
        }
      }
      return url.includes("display_mode=files") ? grouped : status
    })
    const document = dom.window.document

    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))
    document.querySelector('[data-display-mode="files"]').click()
    await waitFor(() => document.querySelector(
      "[data-select-duplicate-group]"))
    document.querySelector("[data-select-duplicate-group]").click()

    await waitFor(() => document.getElementById(
      "vault-feedback").textContent.includes("up to 500"))
    assert.equal(document.querySelector(
      "[data-deduplicate-selected]"), null)
    assert.equal(document.querySelector(
      "[data-select-duplicate-group]").checked, false)

    dom.window.close()
  })

  test("the fresh empty state keeps the header as the only scan action", async () => {
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
    assert.ok(document.querySelector(".vault-overview #btn-scan"))
    assert.equal(document.querySelector(".vault-rail-global #btn-scan"), null)
    assert.match(document.getElementById("btn-scan").textContent, /Scan/)
    assert.doesNotMatch(document.getElementById("btn-scan").textContent,
      /again/)
    assert.match(document.getElementById("vault-scan-size-label").textContent,
      /100 MB\+/)
    assert.equal(document.getElementById("btn-scan").classList
      .contains("primary"), true)
    assert.equal(document.querySelector("#vault-scan-size-menu > summary")
      .classList.contains("primary"), true)
    assert.match(document.querySelector(".vault-empty").textContent, /No files/)

    dom.window.close()
  })

  test("a fresh app workspace makes Scan this app primary", async () => {
    const status = fixture([], {
      last_scan: null,
      bytes_without_sharing: 0,
      bytes_on_disk: 0,
      saved_by_sharing: 0,
      effective_bytes: 0
    })
    const { dom } = await makePage(status, {
      appMode: true,
      platform: "darwin",
      automaticScanFocusRequested: "e".repeat(64),
      scopeId: "app:app"
    })
    const document = dom.window.document
    const scanButton = document.getElementById("btn-scan")

    assert.match(scanButton.textContent, /Scan this app/)
    assert.equal(scanButton.classList.contains("primary"), true)
    assert.match(document.getElementById("vault-scan-coachmark").textContent,
      /click Scan this app to review them/)
    await waitFor(() => document.activeElement === scanButton)

    dom.window.close()
  })

  test("a completed app workspace keeps Scan again primary", async () => {
    const { dom } = await makePage(fixture([]), {
      appMode: true,
      scopeId: "app:app"
    })
    const document = dom.window.document

    assert.match(document.getElementById("btn-scan").textContent,
      /Scan again/)
    assert.equal(document.getElementById("btn-scan").classList
      .contains("primary"), true)

    dom.window.close()
  })

  test("an app with duplicates keeps Scan again secondary", async () => {
    const duplicate = item({ status: "duplicate", shareable: true })
    const { dom } = await makePage(fixture([duplicate]), {
      appMode: true,
      scopeId: "app:app"
    })
    const document = dom.window.document

    assert.equal(document.getElementById("btn-review-metric").classList
      .contains("primary"), true)
    assert.equal(document.getElementById("btn-scan").classList
      .contains("primary"), false)

    dom.window.close()
  })

  test("an app without a global baseline shows setup and opens global Disk Saver", async () => {
    const status = fixture([], {
      global_scan_ready: false,
      last_scan: null,
      logical_bytes: 0,
      saved_by_sharing: 0,
      pending_bytes: 0
    })
    const {
      dom,
      requests,
      getRequests,
      parentNavigations,
      parentMessages
    } = await makePage(status, {
      appMode: true,
      embeddedApp: true,
      scopeId: "app:app",
      actionResults: {
        automatic_set_mode: { app: "app", mode: "manual" }
      }
    })
    const document = dom.window.document
    const scanButton = document.getElementById("btn-scan")

    assert.match(document.querySelector(".vault-summary-value").textContent,
      /Run an initial scan to enable app scans/)
    assert.match(document.querySelector(".vault-setup-copy").textContent,
      /creates the file index used to compare apps/)
    assert.match(scanButton.textContent, /Set up Disk Saver/)
    assert.equal(scanButton.classList.contains("primary"), true)
    assert.equal(document.getElementById("vault-candidate-size").hidden, true)
    assert.equal(document.getElementById("vault-explorer").style.display,
      "none")
    assert.doesNotMatch(document.getElementById("vault-metrics").textContent,
      /Nothing else to save/)

    await waitFor(() => document.querySelector(
      '[data-automatic-mode="manual"]'))
    document.querySelector('[data-automatic-mode="manual"]').click()
    await waitFor(() => requests.some((request) =>
      request.action === "automatic_set_mode"))
    await waitFor(() => document.getElementById(
      "vault-auto-mode").classList.contains("manual"))
    assert.deepEqual(JSON.parse(JSON.stringify(parentMessages)), [
      {
        payload: { e: "vault-automatic-scan-state-request" },
        targetOrigin: "http://localhost"
      },
      {
        payload: {
          e: "vault-automatic-mode-changed",
          app: "app",
          mode: "manual"
        },
        targetOrigin: "http://localhost"
      }
    ])
    assert.equal(getRequests.includes(
      "/info/vault/automatic-scans"), false)
    assert.match(document.querySelector(".vault-summary-value").textContent,
      /Run an initial scan to enable app scans/)
    assert.equal(document.getElementById("vault-explorer").style.display,
      "none")

    scanButton.click()
    assert.deepEqual(parentNavigations, ["/vault"])
    assert.equal(requests.some((request) => request.action === "scan"), false)

    dom.window.close()
  })

  test("Linux app workspaces expose no automatic-check UI or requests", async () => {
    const status = fixture([], {
      global_scan_ready: false,
      last_scan: null,
      logical_bytes: 0,
      saved_by_sharing: 0,
      pending_bytes: 0
    })
    const { dom, getRequests } = await makePage(status, {
      appMode: true,
      platform: "linux",
      scopeId: "app:app"
    })
    const document = dom.window.document

    assert.equal(document.getElementById("vault-auto-mode"), null)
    assert.equal(getRequests.includes("/info/vault/automatic-scans"), false)
    assert.match(document.querySelector(".vault-setup-copy").textContent,
      /creates the file index used to compare apps/)
    assert.doesNotMatch(document.querySelector(
      ".vault-setup-copy").textContent, /automatic/i)

    dom.window.close()
  })

  test("actionable tabs highlight nonzero cleanup opportunities", async () => {
    const actionableStatus = fixture([
      item({
        path: "/pinokio/api/app/duplicate.bin",
        relative_path: "duplicate.bin",
        status: "duplicate",
        shareable: true
      }),
      item({
        path: "/pinokio/api/app/unused.bin",
        relative_path: "unused.bin",
        orphan: true
      })
    ], {
      reclaimable: 4096
    })
    const { dom } = await makePage(actionableStatus)

    for (const view of ["duplicates", "reclaimable"]) {
      const tab = dom.window.document.querySelector(`[data-view="${view}"]`)
      const count = tab.querySelector(".vault-nav-count")
      assert.equal(count.textContent.trim(), "1")
      assert.equal(tab.classList.contains("attention"), true)
      assert.equal(count.classList.contains("attention"), true)
    }
    dom.window.close()

    const { dom: emptyDom } = await makePage(fixture([item()]))

    for (const view of ["duplicates", "reclaimable"]) {
      const tab = emptyDom.window.document.querySelector(`[data-view="${view}"]`)
      const count = tab.querySelector(".vault-nav-count")
      assert.equal(count.textContent.trim(), "0")
      assert.equal(tab.classList.contains("attention"), false)
      assert.equal(count.classList.contains("attention"), false)
    }
    emptyDom.window.close()

    const appStatus = fixture([item({
      status: "duplicate",
      shareable: true
    })])
    const { dom: appDom } = await makePage(appStatus, {
      appMode: true,
      scopeId: "app:app"
    })

    assert.equal(appDom.window.document.querySelector(
      '[data-view="duplicates"]').classList.contains("attention"), true)
    assert.equal(appDom.window.document.querySelector(
      '[data-view="reclaimable"]'), null)
    appDom.window.close()
  })

  test("app setup remains visible during global scan progress", async () => {
    let progressRequests = 0
    const status = fixture([], {
      global_scan_ready: false,
      scan: {
        active: true,
        pending: false,
        phase: "walking",
        queued: 0,
        scope_id: null
      },
      last_scan: null,
      logical_bytes: 0,
      saved_by_sharing: 0,
      pending_bytes: 0
    })
    const { dom } = await makePage((url) => {
      if (url.includes("progress=1")) progressRequests += 1
      return status
    }, {
      appMode: true,
      scopeId: "app:app"
    })
    const document = dom.window.document

    for (let attempt = 0; attempt < 400 && !progressRequests; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.ok(progressRequests)
    assert.match(document.querySelector(".vault-summary-value").textContent,
      /Run an initial scan to enable app scans/)
    assert.equal(document.getElementById("vault-explorer").style.display,
      "none")
    assert.equal(document.getElementById("vault-result").textContent, "")
    assert.equal(document.getElementById("vault-action-state").textContent, "")

    dom.window.close()
  })

  test("app mode uses full-width results without redundant locations", async () => {
    const status = fixture([item()])
    const { dom, requests } = await makePage(status, {
      appMode: true,
      scopeId: "app:app"
    })
    const document = dom.window.document

    assert.equal(document.querySelector(".vault-rail"), null)
    assert.equal(document.getElementById("vault-locations"), null)
    assert.equal(document.getElementById("btn-add-source"), null)
    assert.ok(document.querySelector(".vault-view-tabs"))
    assert.equal(document.querySelectorAll(
      ".vault-view-tabs [data-view]").length, 6)
    assert.ok(document.querySelector(
      '[data-view="unavailable"]'))
    assert.equal(document.querySelector(
      '[data-view="reclaimable"]'), null)
    assert.ok(document.querySelector(
      ".vault-overview-actions #btn-scan"))
    assert.ok(document.getElementById("vault-candidate-size"))
    assert.equal(document.getElementById("vault-scan-control"), null)

    document.getElementById("btn-scan").click()
    await waitFor(() => requests.some((request) =>
      request.action === "scan"))
    const scan = requests.find((request) => request.action === "scan")
    assert.equal(scan.scope_id, "app:app")

    await settle()
    dom.window.close()
  })

  test("app mode shows and updates its automatic-scan setting", async () => {
    const { dom, requests } = await makePage(fixture([item()]), {
      appMode: true,
      scopeId: "app:app",
      actionResults: {
        automatic_set_mode: { app: "app", mode: "manual" }
      }
    })
    const document = dom.window.document
    await waitFor(() => document.getElementById("vault-auto-mode"))

    let selector = document.getElementById("vault-auto-mode")
    assert.equal(selector.classList.contains("automatic"), true)
    assert.equal(selector.open, false)
    assert.match(selector.querySelector("summary").textContent, /Automatic/)

    selector.querySelector('[data-automatic-mode="manual"]').click()
    await waitFor(() => requests.some((request) =>
      request.action === "automatic_set_mode"))
    await waitFor(() => document.getElementById(
      "vault-auto-mode").classList.contains("manual"))
    selector = document.getElementById("vault-auto-mode")
    assert.match(selector.querySelector("summary").textContent, /Manual/)
    assert.deepEqual(requests.find((request) =>
      request.action === "automatic_set_mode"), {
      action: "automatic_set_mode",
      app: "app",
      mode: "manual"
    })

    dom.window.close()
  })

  test("an embedded app workspace fetches status only when its parent does not reply", async () => {
    const { dom, getRequests, parentMessages } = await makePage(
      fixture([item()]), {
        appMode: true,
        embeddedApp: true,
        embeddedAutomaticReply: false,
        fastAutomaticFallback: true,
        scopeId: "app:app"
      })

    await waitFor(() => dom.window.document.getElementById(
      "vault-auto-mode"))
    assert.deepEqual(JSON.parse(JSON.stringify(parentMessages)), [{
      payload: { e: "vault-automatic-scan-state-request" },
      targetOrigin: "http://localhost"
    }])
    assert.equal(getRequests.filter((url) =>
      url === "/info/vault/automatic-scans").length, 1)

    dom.window.close()
  })

  test("a late parent state wins over an app workspace fallback", async () => {
    const {
      dom,
      getRequests,
      releaseAutomaticStatus
    } = await makePage(fixture([item()]), {
      appMode: true,
      embeddedApp: true,
      embeddedAutomaticReply: false,
      fastAutomaticFallback: true,
      deferAutomaticStatus: true,
      scopeId: "app:app"
    })

    await waitFor(() => getRequests.includes(
      "/info/vault/automatic-scans"))
    const event = new dom.window.Event("message")
    Object.defineProperties(event, {
      source: { value: dom.window.parent },
      origin: { value: dom.window.location.origin },
      data: {
        value: {
          e: "vault-automatic-scan-state",
          snapshot: {
            global_scan_ready: true,
            settings: [{ app: "app", mode: "manual" }]
          }
        }
      }
    })
    dom.window.dispatchEvent(event)
    await waitFor(() => dom.window.document.getElementById(
      "vault-auto-mode").classList.contains("manual"))
    await releaseAutomaticStatus()
    await settle()

    assert.equal(dom.window.document.getElementById(
      "vault-auto-mode").classList.contains("manual"), true)
    dom.window.close()
  })

  test("badge acknowledgement waits to explain Scan this app until it is available", async () => {
    let current = fixture([item()], {
      scan: {
        active: true,
        pending: false,
        phase: "walking",
        scope_id: "app:app"
      }
    })
    const { dom, requests } = await makePage(() => current, {
      appMode: true,
      platform: "darwin",
      scopeId: "app:app",
      automaticScanFocusRequested: "a".repeat(64)
    })
    const document = dom.window.document
    const scanButton = document.getElementById("btn-scan")
    const coachmark = document.getElementById("vault-scan-coachmark")

    assert.equal(scanButton.disabled, false)
    assert.match(scanButton.textContent, /Cancel scan/)
    assert.notEqual(document.activeElement, scanButton)
    assert.equal(coachmark.hidden, true)
    assert.equal(dom.window.sessionStorage.getItem(
      "pinokio:vault:auto-scan-focus:app"), null)

    current = fixture([item()])
    for (let attempt = 0; attempt < 400 &&
        document.activeElement !== scanButton; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    assert.equal(document.activeElement, scanButton)
    assert.equal(scanButton.disabled, false)
    assert.equal(coachmark.hidden, false)
    assert.match(coachmark.textContent,
      /Automatic checking found possible duplicates/)
    assert.match(coachmark.textContent, /click Scan again to review them/)
    assert.match(coachmark.textContent,
      /Scanning may use CPU for a few minutes/)
    assert.equal(coachmark.querySelectorAll("button").length, 1)
    assert.equal(coachmark.querySelector("button").getAttribute("aria-label"),
      "Dismiss explanation")
    assert.equal(document.getElementById("vault-candidate-size").hidden, false)
    assert.match(document.getElementById("vault-table-wrap").textContent,
      /model\.bin/)
    assert.equal(requests.some((request) => request.action === "scan"), false)

    coachmark.querySelector("[data-dismiss-automatic-scan-coachmark]").click()
    assert.equal(coachmark.hidden, true)
    assert.match(document.getElementById("vault-table-wrap").textContent,
      /model\.bin/)
    assert.equal(requests.some((request) => request.action === "scan"), false)
    dom.window.close()
  })

  test("a retained app workspace handles a live badge coachmark request", async () => {
    const { dom, requests } = await makePage(fixture([item()]), {
      appMode: true,
      platform: "darwin",
      embeddedApp: true,
      scopeId: "app:app"
    })
    const document = dom.window.document
    const scanButton = document.getElementById("btn-scan")
    const candidateSize = document.getElementById("vault-candidate-size")
    const selectedSize = candidateSize.options[1].value
    candidateSize.value = selectedSize
    candidateSize.dispatchEvent(new dom.window.Event("change", {
      bubbles: true
    }))
    document.querySelector('[data-view="duplicates"]').click()
    await waitFor(() => document.querySelector(
      '[data-view="duplicates"].selected'))
    const resultsBeforeHandoff = document.getElementById("vault-table-wrap")
    const resultsTextBeforeHandoff = resultsBeforeHandoff.textContent
    const focusKey = "pinokio:vault:auto-scan-focus:app"
    const signature = "b".repeat(64)
    dom.window.sessionStorage.setItem(focusKey, signature)
    const event = new dom.window.Event("message")
    Object.defineProperties(event, {
      source: { value: dom.window.parent },
      origin: { value: dom.window.location.origin },
      data: {
        value: {
          e: "vault-automatic-scan-focus",
          app: "app",
          signature
        }
      }
    })

    dom.window.dispatchEvent(event)
    await waitFor(() => document.activeElement === scanButton)

    assert.equal(dom.window.sessionStorage.getItem(focusKey), null)
    assert.equal(requests.some((request) => request.action === "scan"), false)
    const coachmark = document.getElementById("vault-scan-coachmark")
    assert.equal(coachmark.hidden, false)
    assert.equal(candidateSize.value, selectedSize)
    assert.ok(document.querySelector('[data-view="duplicates"].selected'))
    assert.equal(document.getElementById("vault-table-wrap"),
      resultsBeforeHandoff)
    assert.equal(resultsBeforeHandoff.textContent, resultsTextBeforeHandoff)

    scanButton.click()
    await waitFor(() => requests.some((request) => request.action === "scan"))
    assert.equal(coachmark.hidden, true)
    assert.equal(requests.filter((request) => request.action === "scan").length,
      1)
    await settle()
    dom.window.close()
  })

  test("the automatic-result coachmark is shown once per signature and Escape dismisses it", async () => {
    const { dom, requests } = await makePage(fixture([item()]), {
      appMode: true,
      platform: "darwin",
      embeddedApp: true,
      scopeId: "app:app"
    })
    const document = dom.window.document
    const coachmark = document.getElementById("vault-scan-coachmark")
    const sendFocus = (signature) => {
      const event = new dom.window.Event("message")
      Object.defineProperties(event, {
        source: { value: dom.window.parent },
        origin: { value: dom.window.location.origin },
        data: {
          value: {
            e: "vault-automatic-scan-focus",
            app: "app",
            signature
          }
        }
      })
      dom.window.dispatchEvent(event)
    }
    const firstSignature = "c".repeat(64)
    const secondSignature = "d".repeat(64)

    sendFocus(firstSignature)
    assert.equal(coachmark.hidden, false)
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true
    }))
    assert.equal(coachmark.hidden, true)

    sendFocus(firstSignature)
    assert.equal(coachmark.hidden, true)
    sendFocus(secondSignature)
    assert.equal(coachmark.hidden, false)
    assert.equal(dom.window.sessionStorage.getItem(
      `pinokio:vault:auto-scan-coachmark-seen:app:${secondSignature}`), "1")
    coachmark.querySelector("[data-dismiss-automatic-scan-coachmark]").click()
    sendFocus(firstSignature)
    assert.equal(coachmark.hidden, true)
    assert.equal(requests.some((request) => request.action === "scan"), false)
    dom.window.close()
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

    assert.match(button.textContent, /Cancel scan/)
    assert.equal(button.classList.contains("primary"), false)
    assert.equal(document.getElementById("vault-scan-size-menu").hidden, true)
    assert.equal(document.getElementById("vault-scan-control").classList
      .contains("single"), true)
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
