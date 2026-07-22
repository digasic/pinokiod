const COPY = {
  views: "VIEWS",
  locations: "LOCATIONS",
  all: "All tracked files",
  duplicates: "Duplicates",
  shared: "Shared",
  skipped: "Skipped",
  reclaimable: "Reclaimable",
  activity: "Activity",
  add_external_folder: "Add external folder",
  files_region: "Vault files",
  folder_picker_error: "The folder picker could not be opened.",
  external_added: "Added to Locations. Run a scan when you’re ready.",
  external_exists: "That folder is already in Locations.",
  external_other_disk: "Added to Locations. It can be scanned, but this disk cannot share space with the Vault.",
  on_disk: "On disk",
  on_disk_help: "File managers may count shared files more than once. This is the physical space used by tracked files.",
  already_shared: "Already shared",
  already_shared_help: "Space already avoided by files sharing the same data",
  shared_files: "Shared",
  shared_files_help: "Size of this app’s files that share data with another tracked location",
  saved_by_vault: "Saved by Vault",
  saved_by_vault_help: "Space saved through your Deduplicate actions",
  can_save: "Can save",
  pinokio_folder: "Pinokio folder",
  app_folder: "App folder",
  tracked_files: "Tracked files",
  last_scanned: "Last scanned",
  never: "Never",
  scan: "Scan now",
  scan_app: "Scan this app",
  scan_again: "Scan again",
  scanning: "Scanning…",
  scanning_elsewhere: "Vault is scanning another location",
  scanning_elsewhere_hint: "This app can be scanned when the current Vault scan finishes.",
  vault_options: "Vault options",
  repair_index: "Repair Vault index",
  repair_action: "Repair index",
  repair_description: "Reconstruct Vault’s internal records if tracked files or sharing status look incorrect. This does not scan for new duplicates.",
  repairing: "Repairing…",
  repair_done: "Vault index repaired",
  scan_counting: "Counting files",
  scan_progress: "Scanning your configured locations",
  scan_location: "Scanning {location}",
  scan_queued: "Waiting to start scan",
  scan_analyzing: "Analyzing large files",
  scan_finishing: "Finishing scan",
  scan_estimate_help: "Overall progress combines file scanning and large-file analysis",
  scan_counting_help: "The first scan cannot know its total until this pass finishes",
  scan_count_estimate_help: "Estimated from the exact file total and timing of the last completed scan",
  scan_file_progress_help: "This pass uses the exact current file total; overall timing is estimated from the last scan",
  scan_hash_progress_help: "File discovery is complete; the remaining large-file count is exact",
  scan_finishing_help: "File analysis is complete; Vault is verifying its records",
  about_percent: "About {percent} percent.",
  exact_percent: "{percent} percent.",
  scan_checked: "{done} of {total} large files checked",
  scan_files_checked: "{done} of {total} files checked",
  scan_folders: "folders checked",
  scan_files: "files checked",
  scan_folders_found: "folders found",
  scan_files_found: "files found",
  analyzing: "analyzing",
  waiting: "files waiting",
  scan_complete: "Scan complete",
  scan_incomplete: "Scan incomplete",
  scan_unreadable_path: "path could not be read",
  scan_unreadable_paths: "paths could not be read",
  scan_partial_rest: "The rest of the scan completed.",
  view_unreadable_path: "View path",
  view_unreadable_paths: "View paths",
  scan_not_analyzed: "could not be analyzed",
  found_in: "found in",
  locations_lower: "locations",
  can_be_saved: "can be saved",
  review: "Review",
  search_all: "Search tracked files",
  search_duplicates: "Search duplicates",
  search_shared: "Search shared files",
  search_skipped: "Search skipped files",
  search_activity: "Search activity",
  search_in: "Search in {location}",
  status_request_failed: "Vault status request failed ({status})",
  action_request_failed: "Vault action failed ({status})",
  all_statuses: "All statuses",
  by_location: "By location",
  name: "Name",
  size: "Size",
  status: "Vault status",
  matches: "Matches",
  space: "Space",
  duplicate: "Duplicate",
  tracked: "Tracked",
  different_disk: "Different disk",
  can_save_suffix: "can save",
  unavailable: "Unavailable",
  sharing_unavailable: "Sharing is unavailable on this disk",
  permissions_differ: "File permissions differ",
  changed_since_scan: "Some files changed since the scan. Scan again before deduplicating them.",
  separate_locked: "Stop the app before separating this file.",
  separate_changed: "This file changed since it was scanned. Scan again, then try again.",
  separate_conflict: "A temporary file already exists next to this file. Vault left both files unchanged.",
  separate_not_found: "This file is no longer tracked. Scan again to refresh this view.",
  undo_incomplete: "Some files could not be separated. No existing files were overwritten.",
  action_not_completed: "The action could not be completed. No existing files were overwritten.",
  activity_write_failed: "The file action completed, but some activity history could not be recorded.",
  persistence_write_failed: "The file action completed, but Vault could not save its updated record yet. It will retry automatically.",
  files_still_waiting: "{count} still waiting for review",
  cloud_sync_warning: "Cloud syncing with {provider} can make shared files use separate disk space again.",
  dismiss: "Dismiss",
  without_sharing: "without sharing",
  just_now: "Just now",
  minutes_ago: "m ago",
  hours_ago: "h ago",
  event: "event",
  events: "events",
  unknown_location: "Unknown location",
  expand: "Expand",
  collapse: "Collapse",
  file: "file",
  files: "files",
  location: "location",
  deduplicate: "Deduplicate",
  skip: "Skip",
  separate: "Separate",
  include_in_scans: "Include in scans",
  reclaim: "Reclaim",
  reclaim_all: "Reclaim all",
  undo: "Undo",
  identical_contents_at: "Identical contents at",
  no_files: "Nothing tracked yet",
  no_files_hint: "Run a scan to find large files. Scanning never changes them.",
  scan_waiting: "Waiting for scan results",
  scan_waiting_hint: "Tracked files will appear here when this scan finishes.",
  no_duplicates: "Everything is already shared",
  no_duplicates_hint: "There are no files waiting for your review.",
  no_shared: "Nothing is shared yet",
  no_shared_hint: "Shared files will appear here after you review duplicates.",
  no_skipped: "Nothing skipped",
  no_skipped_hint: "Files you ask Vault to skip will appear here.",
  no_reclaimable: "Nothing to reclaim",
  no_reclaimable_hint: "Files no longer used by any configured location will appear here.",
  no_activity: "No activity yet",
  no_activity_hint: "Scans and actions will be recorded here.",
  view_all: "View all tracked files",
  show_all_locations: "Show all locations",
  tracked_note: "Only tracked files 100 MB and larger appear here. Files keep their current locations.",
  duplicate_note: "Only files waiting for review are shown.",
  converted: "Deduplicated",
  skipped_action: "Skipped",
  separated: "Separated",
  reclaimed: "Reclaimed",
  included_in_scans: "Included in scans",
  event_convert: "Deduplicated",
  event_found: "Duplicate found",
  event_adopt: "Added to your vault",
  event_reclaim: "Reclaimed",
  event_undo: "Undid deduplication",
  event_diverged: "Changed by an app — no longer shared",
  event_detach: "Separated",
  event_skip: "Skipped",
  event_reshare: "Included in scans"
}

const SCOPE_ID = document.body.dataset.vaultScope || null
const IS_APP_MODE = document.body.dataset.vaultMode === "app" && !!SCOPE_ID
const statusUrl = (progress = false) => {
  const query = new URLSearchParams()
  if (progress) query.set("progress", "1")
  if (SCOPE_ID) query.set("scope_id", SCOPE_ID)
  const suffix = query.toString()
  return `/info/dedup${suffix ? `?${suffix}` : ""}`
}
const reviewedScanKey = `pinokio:vault:reviewed-scan:${SCOPE_ID || "global"}`

const state = {
  data: null,
  view: "all",
  sourceId: SCOPE_ID,
  query: "",
  statusFilter: "all",
  collapsedSources: new Set(),
  collapsedDirs: new Set(),
  expandedFiles: new Set(),
  scanRequested: false,
  scanBaseline: null,
  scanResult: null,
  scanProblemsOpen: false,
  feedback: null
}

const el = (id) => document.getElementById(id)
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]))
const attr = esc
const fmt = (value) => {
  const n = Number(value) || 0
  if (!n) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const digits = index > 1 ? 1 : 0
  return `${(n / Math.pow(1024, index)).toFixed(digits)} ${units[index]}`
}
const countLabel = (count, singular = COPY.file, plural = COPY.files) => `${count} ${count === 1 ? singular : plural}`
const basename = (value) => String(value || "").split(/[\\/]/).filter(Boolean).pop() || ""
const dirname = (value) => {
  const parts = String(value || "").split("/").filter(Boolean)
  parts.pop()
  return parts.join(" / ")
}
const timeAgo = (ts) => {
  if (!ts) return COPY.never
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return COPY.just_now
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}${COPY.minutes_ago}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}${COPY.hours_ago}`
  return new Date(ts).toLocaleDateString()
}
const post = async (payload) => {
  const response = await fetch("/vault/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  let result = null
  try { result = await response.json() } catch (error) {}
  if (!response.ok) {
    throw new Error((result && result.error) || COPY.action_request_failed.replace("{status}", response.status))
  }
  if (!result) throw new Error(COPY.action_request_failed.replace("{status}", response.status))
  return result
}
const sourceById = (id) => (state.data.sources || []).find((source) => source.id === id)
const sourceChildren = (id) => (state.data.sources || []).filter((source) => source.parent_id === id)
const sourcePath = (source) => {
  if (!source) return ""
  if (source.kind === "pinokio") return `~/${basename(source.root)}`
  if (source.kind === "external") return source.target_path || source.display_path || ""
  if (source.kind === "app") return IS_APP_MODE ? (source.display_path || source.root || "") : ""
  return source.display_path || source.root || ""
}
const isDescendantSource = (candidateId, parentId) => {
  if (!parentId) return true
  if (candidateId === parentId) return true
  let current = sourceById(candidateId)
  const seen = new Set()
  while (current && current.parent_id && !seen.has(current.id)) {
    if (current.parent_id === parentId) return true
    seen.add(current.id)
    current = sourceById(current.parent_id)
  }
  return false
}

const buildItems = () => {
  const data = state.data
  const items = []
  const duplicatePaths = new Set(data.duplicates.map((item) => item.path))
  const excludedPaths = new Set(data.excluded.map((item) => item.path))
  for (const blob of data.blobs) {
    const linkedNames = blob.names.filter((name) => name.mode === "link")
    const visibleNames = IS_APP_MODE
      ? blob.names.filter((name) => name.source_id === SCOPE_ID)
      : blob.names
    for (const name of visibleNames) {
      if (duplicatePaths.has(name.path) || excludedPaths.has(name.path)) continue
      const shared = name.mode === "link" && linkedNames.length > 1
      items.push({
        path: name.path, relative_path: name.relative_path || basename(name.path),
        source_id: name.source_id, source_label: name.source_label,
        size: blob.size || 0, status: shared ? "shared" : "tracked",
        locations: blob.names
      })
    }
  }
  for (const duplicate of data.duplicates) {
    items.push({
      path: duplicate.path, relative_path: duplicate.relative_path || basename(duplicate.path),
      source_id: duplicate.source_id, source_label: duplicate.source_label,
      size: duplicate.size || 0, status: "duplicate",
      shareable: duplicate.shareable !== false, unavailable_reason: duplicate.unavailable_reason || null,
      match: duplicate.match || null
    })
  }
  for (const independent of data.excluded) {
    items.push({
      path: independent.path, relative_path: independent.relative_path || basename(independent.path),
      source_id: independent.source_id, source_label: independent.source_label,
      size: independent.size || 0, status: "independent"
    })
  }
  return items
}

const getCounts = (items) => ({
  all: items.length,
  duplicates: items.filter((item) => item.status === "duplicate").length,
  shared: items.filter((item) => item.status === "shared").length,
  independent: items.filter((item) => item.status === "independent").length,
  reclaimable: state.data.blobs.filter((blob) => blob.orphan).length,
  activity: state.data.events.length
})

const sourceCounts = (items) => {
  const counts = new Map()
  for (const item of items) {
    let id = item.source_id
    const seen = new Set()
    while (id && !seen.has(id)) {
      counts.set(id, (counts.get(id) || 0) + 1)
      seen.add(id)
      const source = sourceById(id)
      id = source ? source.parent_id : null
    }
  }
  return counts
}
const activeItems = (items) => {
  if (state.view === "activity") return activityItems()
  if (state.view === "reclaimable") return state.data.blobs.filter((blob) => blob.orphan)
  let result = items
  if (state.view === "duplicates") result = result.filter((item) => item.status === "duplicate")
  if (state.view === "shared") result = result.filter((item) => item.status === "shared")
  if (state.view === "independent") result = result.filter((item) => item.status === "independent")
  if (state.sourceId) result = result.filter((item) => isDescendantSource(item.source_id, state.sourceId))
  if (state.view === "all" && state.statusFilter !== "all") result = result.filter((item) => item.status === state.statusFilter)
  const query = state.query.trim().toLowerCase()
  if (query) result = result.filter((item) => `${item.relative_path} ${item.path} ${item.source_label || ""}`.toLowerCase().includes(query))
  return result
}

const viewIcon = {
  all: "fa-regular fa-file-lines",
  duplicates: "fa-regular fa-copy",
  shared: "fa-solid fa-link",
  independent: "fa-solid fa-circle-minus",
  reclaimable: "fa-regular fa-trash-can",
  activity: "fa-solid fa-wave-square"
}
const viewLabel = {
  all: COPY.all,
  duplicates: COPY.duplicates,
  shared: COPY.shared,
  independent: COPY.skipped,
  reclaimable: COPY.reclaimable,
  activity: COPY.activity
}
const eventLabels = {
  convert: COPY.event_convert,
  found: COPY.event_found,
  adopt: COPY.event_adopt,
  reclaim: COPY.event_reclaim,
  undo: COPY.event_undo,
  diverged: COPY.event_diverged,
  detach: COPY.event_detach,
  skip: COPY.event_skip,
  reshare: COPY.event_reshare
}
const activityItems = () => {
  const query = state.query.toLowerCase()
  return state.data.events.filter((event) => !query ||
    `${eventLabels[event.kind] || event.kind} ${event.path || ""}`.toLowerCase().includes(query))
}

const renderViews = (items) => {
  const counts = getCounts(items)
  el("views-label").textContent = COPY.views
  const views = IS_APP_MODE
    ? ["all", "duplicates", "shared", "independent", "activity"]
    : ["all", "duplicates", "shared", "independent", "reclaimable", "activity"]
  el("vault-views").innerHTML = views.map((view) => `
    <button class="vault-nav-row ${state.view === view ? "selected" : ""}" type="button" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ""}>
      <i class="${viewIcon[view]}"></i>
      <span class="vault-nav-copy"><span class="vault-nav-name">${esc(viewLabel[view])}</span></span>
      <span class="vault-nav-count ${view === "duplicates" && counts[view] ? "attention" : ""}">${counts[view]}</span>
    </button>`).join("")
}

const renderSourceNode = (source, depth, counts) => {
  const children = sourceChildren(source.id).filter((child) => {
    const count = state.view === "duplicates" ? counts.duplicates.get(child.id) : counts.tracked.get(child.id)
    return child.kind === "virtual" || count > 0 || (child.kind === "external" && child.available)
  })
  const duplicateCount = counts.duplicates.get(source.id) || 0
  const trackedCount = counts.tracked.get(source.id) || 0
  if (!IS_APP_MODE && state.view === "duplicates" && duplicateCount === 0) return ""
  const collapsed = state.collapsedSources.has(source.id)
  const pathText = source.kind === "virtual" ? (source.id === "apps" ? "api" : "") : sourcePath(source)
  const count = state.view === "duplicates" ? duplicateCount : trackedCount
  const icon = source.kind === "app" ? "fa-regular fa-folder-open" : "fa-regular fa-folder"
  let html = `<div class="vault-source-line depth-${Math.min(depth, 2)} ${pathText ? "has-path" : ""}">`
  if (children.length) {
    html += `<button class="vault-source-toggle" type="button" data-toggle-source="${attr(source.id)}" aria-label="${collapsed ? COPY.expand : COPY.collapse}" aria-expanded="${!collapsed}"><i class="fa-solid fa-chevron-${collapsed ? "right" : "down"}"></i></button>`
  } else {
    html += `<span class="vault-source-toggle placeholder"></span>`
  }
  html += `<button class="vault-nav-row ${state.sourceId === source.id ? "selected" : ""}" type="button" data-source="${attr(source.id)}" ${state.sourceId === source.id ? 'aria-current="page"' : ""}>
    <i class="${icon}"></i>
    <span class="vault-nav-copy"><span class="vault-nav-name">${esc(source.label)}</span>${pathText ? `<span class="vault-nav-path" title="${attr(pathText)}">${esc(pathText)}</span>` : ""}</span>
    <span class="vault-nav-count ${duplicateCount ? "attention" : ""}">${count || ""}</span>
  </button></div>`
  if (!collapsed) html += children.map((child) => renderSourceNode(child, depth + 1, counts)).join("")
  return html
}

const renderLocations = (items) => {
  el("locations-label").textContent = COPY.locations
  const pinokio = sourceById("pinokio")
  const external = sourceById("external")
  const counts = {
    duplicates: sourceCounts(state.data.duplicates),
    tracked: sourceCounts(items)
  }
  let html
  if (IS_APP_MODE) {
    const source = sourceById(SCOPE_ID)
    html = source ? renderSourceNode(source, 0, counts) : ""
  } else {
    html = pinokio ? renderSourceNode(pinokio, 0, counts) : ""
    if (external && sourceChildren("external").length) html += renderSourceNode(external, 0, counts)
  }
  el("vault-locations").innerHTML = html
  el("vault-rail-footer").innerHTML = !IS_APP_MODE && state.view === "duplicates"
    ? `<button class="vault-text-button" type="button" data-view="all">${esc(COPY.show_all_locations)}</button>`
    : ""
}

const selectedSource = () => state.sourceId ? sourceById(state.sourceId) : null
const scopeDuplicates = (sourceId) => state.data.duplicates.filter((item) => item.source_id === sourceId)
const batchAction = (source) => {
  if (!source || source.kind === "virtual" || source.kind === "pinokio") return ""
  const duplicates = scopeDuplicates(source.id)
  if (!duplicates.length) return ""
  const shareable = duplicates.filter((item) => item.shareable !== false)
  if (!source.shareable || !shareable.length) return `<div class="vault-pane-action-note">${esc(COPY.sharing_unavailable)}</div>`
  return `<button class="vault-button" type="button" data-deduplicate-scope="${attr(source.id)}">${esc(COPY.deduplicate)} ${countLabel(shareable.length)}</button>`
}

const toolbarSummary = (visibleItems) => {
  if (state.view === "duplicates") {
    const locations = new Set(visibleItems.map((item) => item.source_id).filter(Boolean)).size
    const bytes = visibleItems.filter((item) => item.shareable).reduce((sum, item) => sum + item.size, 0)
    return `${countLabel(visibleItems.length)} · ${countLabel(locations, COPY.location, COPY.locations_lower)} · ${fmt(bytes)} ${COPY.can_save_suffix}`
  } else if (state.view === "activity") {
    return countLabel(visibleItems.length, COPY.event, COPY.events)
  } else if (state.view === "reclaimable") {
    return `${countLabel(visibleItems.length)} · ${fmt(state.data.reclaimable)}`
  }
  const duplicateCount = visibleItems.filter((item) => item.status === "duplicate").length
  const saveable = visibleItems.filter((item) => item.status === "duplicate" && item.shareable).reduce((sum, item) => sum + item.size, 0)
  return `${countLabel(visibleItems.length)}${duplicateCount ? ` · ${countLabel(duplicateCount, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase())} · ${fmt(saveable)} ${COPY.can_save_suffix}` : ""}`
}

const updateToolbarSummary = (visibleItems) => {
  const summary = el("vault-toolbar-summary")
  if (summary) summary.textContent = toolbarSummary(visibleItems)
}

const searchPlaceholder = () => {
  if (state.view === "duplicates") return COPY.search_duplicates
  if (state.view === "shared") return COPY.search_shared
  if (state.view === "independent") return COPY.search_skipped
  if (state.view === "activity") return COPY.search_activity
  const source = selectedSource()
  return source && source.kind === "app" ? COPY.search_in.replace("{location}", source.label) : COPY.search_all
}
const renderToolbar = (visibleItems) => {
  if (state.view === "reclaimable") {
    const count = state.data.blobs.filter((blob) => blob.orphan).length
    el("vault-toolbar").innerHTML = count
      ? `<span class="vault-toolbar-count" id="vault-toolbar-summary">${esc(toolbarSummary(visibleItems))}</span><button class="vault-button" type="button" id="btn-reclaim-all">${esc(COPY.reclaim_all)}</button>`
      : ""
    return
  }
  const source = selectedSource()
  el("vault-toolbar").innerHTML = `<label class="vault-search"><i class="fa-solid fa-magnifying-glass"></i><input id="vault-search" value="${attr(state.query)}" placeholder="${attr(searchPlaceholder())}" aria-label="${attr(searchPlaceholder())}" /></label>
    ${state.view === "all" ? `<select class="vault-select" id="vault-status-filter" aria-label="${attr(COPY.all_statuses)}">
      <option value="all" ${state.statusFilter === "all" ? "selected" : ""}>${esc(COPY.all_statuses)}</option>
      <option value="duplicate" ${state.statusFilter === "duplicate" ? "selected" : ""}>${esc(COPY.duplicates)}</option>
      <option value="shared" ${state.statusFilter === "shared" ? "selected" : ""}>${esc(COPY.shared)}</option>
      <option value="tracked" ${state.statusFilter === "tracked" ? "selected" : ""}>${esc(COPY.tracked)}</option>
      <option value="independent" ${state.statusFilter === "independent" ? "selected" : ""}>${esc(COPY.skipped)}</option>
    </select>` : state.view === "duplicates" ? `<span class="vault-select">${esc(COPY.by_location)}</span>` : ""}
    <span class="vault-toolbar-count" id="vault-toolbar-summary">${esc(toolbarSummary(visibleItems))}</span>
    ${state.view === "all" ? batchAction(source) : ""}`
}

const statusMarkup = (item) => {
  if (item.status === "duplicate") {
    const unavailable = item.unavailable_reason === "metadata"
      ? COPY.permissions_differ
      : item.unavailable_reason === "different_disk" ? COPY.different_disk : COPY.sharing_unavailable
    return item.shareable
      ? `<span class="vault-status"><span class="vault-status-dot warning"></span>${esc(COPY.duplicate)}</span>`
      : `<span class="vault-status"><i class="fa-regular fa-circle-xmark"></i>${esc(unavailable)}</span>`
  }
  if (item.status === "shared") return `<span class="vault-status"><i class="fa-solid fa-link"></i>${esc(COPY.shared)} · ${item.locations.length} ${esc(COPY.locations_lower)}</span>`
  if (item.status === "independent") return `<span class="vault-status"><i class="fa-solid fa-circle-minus"></i>${esc(COPY.skipped)}</span>`
  return `<span class="vault-status"><span class="vault-status-dot"></span>${esc(COPY.tracked)}</span>`
}
const spaceMarkup = (item) => {
  if (item.status === "duplicate") return item.shareable ? `${fmt(item.size)} ${COPY.can_save_suffix}` : COPY.unavailable
  return "—"
}
const rowAction = (item) => {
  if (item.status === "duplicate") return `<button class="vault-text-button" type="button" data-detach="${attr(item.path)}">${esc(COPY.skip)}</button>`
  if (item.status === "shared") return `<button class="vault-text-button" type="button" data-detach="${attr(item.path)}">${esc(COPY.separate)}</button>`
  if (item.status === "independent") return `<button class="vault-text-button" type="button" data-reshare="${attr(item.path)}">${esc(COPY.include_in_scans)}</button>`
  return ""
}

const fileDetail = (item) => {
  if (!state.expandedFiles.has(item.path) || !item.locations || item.locations.length < 2) return ""
  return `<div class="vault-detail"><div class="vault-detail-label">${esc(COPY.identical_contents_at)} ${countLabel(item.locations.length, COPY.location, COPY.locations_lower)}</div>${item.locations.map((location) => `
    <div class="vault-location-detail"><i class="fa-regular fa-file"></i><span>${esc(location.source_label || "")}${location.relative_path ? ` / ${esc(location.relative_path)}` : ""}</span></div>`).join("")}</div>`
}

const renderFileRow = (item, depth = 0, showMatch = false) => {
  const directoryPath = dirname(item.relative_path)
  const match = item.match
  const expandable = item.locations && item.locations.length > 1
  return `<div class="vault-file-row">
    <div class="vault-name-cell indent-${Math.min(depth, 2)}">
      ${expandable ? `<button class="vault-disclosure" type="button" data-expand-file="${attr(item.path)}" aria-label="${state.expandedFiles.has(item.path) ? COPY.collapse : COPY.expand}" aria-expanded="${state.expandedFiles.has(item.path)}"><i class="fa-solid fa-chevron-${state.expandedFiles.has(item.path) ? "down" : "right"}"></i></button>` : `<span class="vault-disclosure"></span>`}
      <i class="fa-regular fa-file vault-name-icon"></i>
      <span class="vault-name-copy"><span class="vault-file-name">${esc(basename(item.relative_path))}</span>${directoryPath && depth === 0 ? `<span class="vault-file-path">${esc(directoryPath)}</span>` : ""}</span>
    </div>
    <span class="vault-size">${item.size ? fmt(item.size) : "—"}</span>
    <span>${showMatch ? (match ? `<span class="vault-match-path">${esc(match.path)}</span>` : "—") : statusMarkup(item)}</span>
    <span class="vault-space">${esc(spaceMarkup(item))}</span>
    <span class="vault-row-action">${rowAction(item)}</span>
  </div>${fileDetail(item)}`
}

const makeTree = (items) => {
  const root = { dirs: new Map(), files: [] }
  for (const item of items) {
    const parts = String(item.relative_path || basename(item.path)).split("/").filter(Boolean)
    const fileName = parts.pop() || basename(item.path)
    item._treeName = fileName
    let node = root
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] })
      node = node.dirs.get(part)
    }
    node.files.push(item)
  }
  return root
}
const nodeItems = (node) => [...node.files, ...[...node.dirs.values()].flatMap((child) => nodeItems(child))]
const renderTreeNode = (node, prefix, depth) => {
  let current = node
  const labels = [node.name]
  while (current.files.length === 0 && current.dirs.size === 1) {
    current = [...current.dirs.values()][0]
    labels.push(current.name)
  }
  const key = [...prefix, ...labels].join("/")
  const collapsed = state.collapsedDirs.has(key)
  const items = nodeItems(current)
  const duplicateCount = items.filter((item) => item.status === "duplicate").length
  const shareableBytes = items.filter((item) => item.status === "duplicate" && item.shareable).reduce((sum, item) => sum + item.size, 0)
  const shared = items.filter((item) => item.status === "shared").length
  const summary = duplicateCount ? countLabel(duplicateCount, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase()) : shared ? COPY.shared : COPY.tracked
  let html = `<div class="vault-file-row directory">
    <div class="vault-name-cell indent-${Math.min(depth, 2)}"><button class="vault-disclosure" type="button" data-toggle-dir="${attr(key)}" aria-label="${collapsed ? COPY.expand : COPY.collapse}" aria-expanded="${!collapsed}"><i class="fa-solid fa-chevron-${collapsed ? "right" : "down"}"></i></button><i class="fa-regular fa-folder vault-name-icon"></i><span class="vault-file-name">${esc(labels.join(" / "))}</span></div>
    <span class="vault-size">${countLabel(items.length)}</span><span>${esc(summary)}</span><span class="vault-space">${shareableBytes ? `${fmt(shareableBytes)} ${COPY.can_save_suffix}` : "—"}</span><span></span>
  </div>`
  if (!collapsed) {
    html += current.files.sort((a, b) => a._treeName.localeCompare(b._treeName)).map((item) => renderFileRow(item, depth + 1)).join("")
    html += [...current.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => renderTreeNode(child, [...prefix, ...labels], depth + 1)).join("")
  }
  return html
}
const renderTree = (items) => {
  const tree = makeTree(items)
  return tree.files.map((item) => renderFileRow(item)).join("") + [...tree.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((node) => renderTreeNode(node, [], 0)).join("")
}

const groupTitle = (source) => {
  if (!source) return COPY.unknown_location
  const parts = [source.label]
  let current = source
  while (current && current.parent_id) {
    current = sourceById(current.parent_id)
    if (current) parts.unshift(current.label)
  }
  return parts.join(" / ")
}
const sourceSort = (a, b) => {
  const first = sourceById(a[0])
  const second = sourceById(b[0])
  const rank = (source) => source && source.kind === "external" ? 1 : source ? 0 : 2
  return rank(first) - rank(second) || groupTitle(first).localeCompare(groupTitle(second))
}
const renderDuplicateGroups = (items) => {
  const groups = new Map()
  for (const item of items) {
    const key = item.source_id || "unknown"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.entries()].sort(sourceSort).map(([sourceId, group]) => {
    const source = sourceById(sourceId)
    const bytes = group.filter((item) => item.shareable).reduce((sum, item) => sum + item.size, 0)
    const action = source && source.shareable && group.some((item) => item.shareable)
      ? `<button class="vault-button" type="button" data-deduplicate-scope="${attr(sourceId)}">${esc(COPY.deduplicate)} ${countLabel(group.filter((item) => item.shareable).length)}</button>`
      : `<span class="vault-unavailable">${esc(COPY.sharing_unavailable)}</span>`
    return `<div class="vault-group-row"><div class="vault-group-main"><div class="vault-group-title"><i class="fa-regular fa-folder"></i><span>${esc(groupTitle(source))}</span></div><div class="vault-group-meta">${countLabel(group.length, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase())} · ${bytes ? fmt(bytes) : COPY.unavailable}</div></div><div class="vault-group-action">${action}</div></div>${group.sort((a, b) => a.relative_path.localeCompare(b.relative_path)).map((item) => renderFileRow(item, 0, true)).join("")}`
  }).join("")
}

const renderInventoryGroups = (items) => {
  const groups = new Map()
  for (const item of items) {
    const key = item.source_id || "unknown"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.entries()].sort(sourceSort).map(([sourceId, group]) => {
    const source = sourceById(sourceId)
    const duplicates = group.filter((item) => item.status === "duplicate")
    const saveable = duplicates.filter((item) => item.shareable).reduce((sum, item) => sum + item.size, 0)
    const shared = group.filter((item) => item.status === "shared").length
    const meta = [countLabel(group.length)]
    if (duplicates.length) meta.push(countLabel(duplicates.length, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase()))
    else if (shared) meta.push(`${shared} ${COPY.shared.toLowerCase()}`)
    if (saveable) meta.push(`${fmt(saveable)} ${COPY.can_save_suffix}`)
    const action = batchAction(source)
    return `<div class="vault-group-row"><div class="vault-group-main"><div class="vault-group-title"><i class="fa-regular fa-folder"></i><span>${esc(groupTitle(source))}</span></div><div class="vault-group-meta">${esc(meta.join(" · "))}</div></div>${action ? `<div class="vault-group-action">${action}</div>` : ""}</div>${renderTree(group)}`
  }).join("")
}

const emptyState = (view) => {
  const activeScan = scanActive(state.data && state.data.scan)
  const scanning = scanMatchesContext(state.data && state.data.scan)
  const content = {
    all: scanning
      ? [COPY.scan_waiting, COPY.scan_waiting_hint, "fa-solid fa-circle-notch fa-spin"]
      : [COPY.no_files, COPY.no_files_hint, "fa-regular fa-folder-open"],
    duplicates: [COPY.no_duplicates, COPY.no_duplicates_hint, "fa-regular fa-circle-check"],
    shared: [COPY.no_shared, COPY.no_shared_hint, "fa-solid fa-link"],
    independent: [COPY.no_skipped, COPY.no_skipped_hint, "fa-solid fa-circle-minus"],
    reclaimable: [COPY.no_reclaimable, COPY.no_reclaimable_hint, "fa-regular fa-circle-check"],
    activity: [COPY.no_activity, COPY.no_activity_hint, "fa-solid fa-wave-square"]
  }[view]
  const scanLabel = IS_APP_MODE ? COPY.scan_app : COPY.scan
  return `<div class="vault-empty"><div class="vault-empty-inner"><i class="${content[2]}"></i><h3>${esc(content[0])}</h3><p>${esc(content[1])}</p>${view === "duplicates" ? `<button class="vault-button" type="button" data-view="all">${esc(COPY.view_all)}</button>` : view === "all" && !activeScan ? `<button class="vault-button" type="button" id="btn-empty-scan">${esc(scanLabel)}</button>` : ""}</div></div>`
}

const renderReclaimable = () => {
  const blobs = state.data.blobs.filter((blob) => blob.orphan)
  if (!blobs.length) return emptyState("reclaimable")
  return blobs.map((blob) => `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-regular fa-file vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name">${esc(blob.names[0] ? basename(blob.names[0].path) : `${blob.hash.slice(0, 12)}…`)}</span></span></div><span class="vault-size">${fmt(blob.size)}</span><span>${esc(COPY.reclaimable)}</span><span class="vault-space">${fmt(blob.size)}</span><span class="vault-row-action"><button class="vault-text-button" type="button" data-reclaim="${attr(blob.hash)}">${esc(COPY.reclaim)}</button></span></div>`).join("")
}

const renderActivity = () => {
  const events = activityItems()
  const query = state.query.trim().toLowerCase()
  const undoBatches = Array.isArray(state.data.undo_batches)
    ? state.data.undo_batches.filter((batch) => !query ||
      `${COPY.event_convert} ${batch.files || 0} ${COPY.files}`.toLowerCase().includes(query))
    : []
  if (!events.length && !undoBatches.length) return emptyState("activity")
  const seenBatches = new Set()
  const eventRows = events.map((event) => {
    let undo = ""
    if (event.kind === "convert" && event.batch_id && event.undoable !== false && !seenBatches.has(event.batch_id)) {
      seenBatches.add(event.batch_id)
      undo = `<button class="vault-text-button" type="button" data-undo="${attr(event.batch_id)}">${esc(COPY.undo)}</button>`
    }
    const eventPath = event.path
      ? `${event.source_label ? `${event.source_label} / ` : ""}${event.relative_path || event.path}`
      : (event.hash || "").slice(0, 12)
    return `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-solid fa-wave-square vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name vault-event-kind">${esc(eventLabels[event.kind] || event.kind)}</span><span class="vault-file-path">${esc(eventPath)}</span></span></div><span class="vault-size">${event.bytes_saved ? fmt(event.bytes_saved) : event.size ? fmt(event.size) : "—"}</span><span class="vault-event-time">${esc(new Date(event.ts).toLocaleString())}</span><span></span><span class="vault-row-action">${undo}</span></div>`
  }).join("")
  const batchRows = undoBatches.filter((batch) => !seenBatches.has(batch.batch_id)).map((batch) =>
    `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-solid fa-wave-square vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name vault-event-kind">${esc(COPY.event_convert)}</span><span class="vault-file-path">${esc(countLabel(batch.files || 0))}</span></span></div><span class="vault-size">${fmt(batch.bytes || 0)}</span><span class="vault-event-time">${batch.ts ? esc(new Date(batch.ts).toLocaleString()) : "—"}</span><span></span><span class="vault-row-action"><button class="vault-text-button" type="button" data-undo="${attr(batch.batch_id)}">${esc(COPY.undo)}</button></span></div>`
  ).join("")
  return batchRows + eventRows
}

const renderTable = (items) => {
  let body = ""
  let matches = false
  if (state.view === "duplicates") {
    matches = true
    body = items.length ? renderDuplicateGroups(items) : emptyState("duplicates")
  } else if (state.view === "reclaimable") {
    body = renderReclaimable()
  } else if (state.view === "activity") {
    body = renderActivity()
  } else {
    body = items.length ? (state.sourceId ? renderTree(items) : renderInventoryGroups(items)) : emptyState(state.view)
  }
  const third = matches ? COPY.matches : state.view === "activity" ? COPY.last_scanned : COPY.status
  el("vault-table-wrap").innerHTML = `<div class="vault-table ${matches ? "matches" : ""}"><div class="vault-columns"><span>${esc(COPY.name)}</span><span>${esc(COPY.size)}</span><span>${esc(third)}</span><span>${esc(COPY.space)}</span><span></span></div>${body}</div>`
}

const renderOverview = () => {
  const data = state.data
  const last = data.last_scan
  if (IS_APP_MODE) {
    el("vault-metrics").innerHTML = `
      <div class="vault-metric"><span class="vault-metric-value">${last ? fmt(last.bytes_total) : "—"}</span><span class="vault-metric-label">${esc(COPY.app_folder)}</span></div>
      <div class="vault-metric"><span class="vault-metric-value">${fmt(data.tracked_bytes)}</span><span class="vault-metric-label">${esc(COPY.tracked_files)}</span></div>
      <div class="vault-metric" title="${attr(COPY.shared_files_help)}"><span class="vault-metric-value">${fmt(data.shared_bytes)}</span><span class="vault-metric-label">${esc(COPY.shared_files)}</span></div>
      <button class="vault-metric" type="button" id="btn-review-metric" aria-label="${attr(`${COPY.can_save}: ${fmt(data.pending_bytes)}. ${COPY.review} ${COPY.duplicates.toLowerCase()}.`)}"><span class="vault-metric-value">${fmt(data.pending_bytes)}</span><span class="vault-metric-label">${esc(COPY.can_save)}</span></button>
      <div class="vault-metric"><span class="vault-metric-value">${esc(timeAgo(last && last.ts))}</span><span class="vault-metric-label">${esc(COPY.last_scanned)}</span></div>`
  } else {
    const folderMetric = last ? `<div class="vault-metric"><span class="vault-metric-value">${fmt(last.home_bytes_total == null ? last.bytes_total : last.home_bytes_total)}</span><span class="vault-metric-label">${esc(COPY.pinokio_folder)}</span></div>` : ""
    el("vault-metrics").innerHTML = `${folderMetric}
      <div class="vault-metric" title="${attr(`${COPY.on_disk_help} ${fmt(data.bytes_without_sharing)} ${COPY.without_sharing}.`)}"><span class="vault-metric-value">${fmt(data.bytes_on_disk)}</span><span class="vault-metric-label">${esc(COPY.on_disk)}</span></div>
      <div class="vault-metric" title="${attr(COPY.already_shared_help)}"><span class="vault-metric-value">${fmt(data.saved_by_sharing)}</span><span class="vault-metric-label">${esc(COPY.already_shared)}</span></div>
      <div class="vault-metric" title="${attr(COPY.saved_by_vault_help)}"><span class="vault-metric-value">${fmt(data.lifetime_bytes_saved)}</span><span class="vault-metric-label">${esc(COPY.saved_by_vault)}</span></div>
      <button class="vault-metric" type="button" id="btn-review-metric" aria-label="${attr(`${COPY.can_save}: ${fmt(data.pending_bytes)}. ${COPY.review} ${COPY.duplicates.toLowerCase()}.`)}"><span class="vault-metric-value">${fmt(data.pending_bytes)}</span><span class="vault-metric-label">${esc(COPY.can_save)}</span></button>
      <div class="vault-metric"><span class="vault-metric-value">${esc(timeAgo(last && last.ts))}</span><span class="vault-metric-label">${esc(COPY.last_scanned)}</span></div>`
  }
  const activeScan = scanActive(data.scan)
  const scanning = scanMatchesContext(data.scan)
  const busyElsewhere = activeScan && !scanning
  el("btn-scan").innerHTML = activeScan
    ? `<i class="fa-solid fa-circle-notch fa-spin"></i>${esc(COPY.scanning)}`
    : `<i class="fa-solid fa-rotate"></i>${esc(last ? COPY.scan_again : (IS_APP_MODE ? COPY.scan_app : COPY.scan))}`
  el("btn-scan").disabled = activeScan
  const optionsButton = el("btn-vault-options")
  const repairTitle = el("vault-repair-title")
  const repairDescription = el("vault-repair-description")
  const repairButton = el("btn-repair")
  if (optionsButton) optionsButton.setAttribute("aria-label", COPY.vault_options)
  if (repairTitle) repairTitle.textContent = COPY.repair_index
  if (repairDescription) repairDescription.textContent = COPY.repair_description
  if (repairButton) {
    repairButton.textContent = COPY.repair_action
    repairButton.disabled = activeScan
  }
  const scanState = el("vault-scan-state")
  if (busyElsewhere) {
    scanState.classList.add("show")
    scanState.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><strong>${esc(COPY.scanning_elsewhere)}</strong><span class="vault-scan-detail">${esc(COPY.scanning_elsewhere_hint)}</span>`
    return
  }
  if (scanning) {
    const scan = data.scan
    const scanPhase = scan.phase || "counting"
    const queued = scanPhase === "queued"
    const counting = scanPhase === "counting"
    const walking = scanPhase === "discovering"
    const verifying = scanPhase === "verifying"
    const hashTotal = scan.hash_total || 0
    const hashDone = Math.min(Math.max(0, hashTotal - (scan.queued || 0)), hashTotal)
    const hashRatio = hashTotal ? Math.min(1, hashDone / hashTotal) : 1
    const scanSource = scan.scope_id ? sourceById(scan.scope_id) : null
    const scanProgressLabel = scanSource
      ? COPY.scan_location.replace("{location}", scanSource.label)
      : COPY.scan_progress
    const phase = queued ? COPY.scan_queued : counting ? COPY.scan_counting : walking ? scanProgressLabel : verifying ? COPY.scan_finishing : COPY.scan_analyzing
    const rawCountWeight = Number.isFinite(scan.estimated_count_weight) ? scan.estimated_count_weight : 0.4
    const countWeight = Math.max(0, Math.min(0.98, rawCountWeight))
    const rawWalkWeight = Number.isFinite(scan.estimated_walk_weight) ? scan.estimated_walk_weight : 0.5
    const walkWeight = Math.max(0, Math.min(0.98 - countWeight, rawWalkWeight))
    const analysisWeight = Math.max(0, 1 - countWeight - walkWeight)
    const countEstimate = Number.isFinite(scan.count_estimate_files) && scan.count_estimate_files > 0
      ? scan.count_estimate_files
      : null
    const countRatio = countEstimate === null ? null : Math.min(1, (scan.counted_files || 0) / countEstimate)
    const totalFiles = Number.isFinite(scan.total_files) ? scan.total_files : null
    const details = counting
      ? [`${scan.counted_dirs || 0} ${COPY.scan_folders_found}`, `${scan.counted_files || 0} ${COPY.scan_files_found}`]
      : [`${scan.dirs || 0} ${COPY.scan_folders}`, totalFiles === null
          ? `${scan.files || 0} ${COPY.scan_files}`
          : COPY.scan_files_checked.replace("{done}", scan.files || 0).replace("{total}", totalFiles), fmt(scan.bytes_total || 0)]
    if (scan.current_file) details.push(`${COPY.analyzing} ${scan.current_file}`)
    if (walking && scan.queued > 1) details.push(`${scan.queued} ${COPY.waiting}`)
    if (!walking && hashTotal) {
      details.push(COPY.scan_checked.replace("{done}", hashDone).replace("{total}", hashTotal))
    }
    let percent = ""
    let progress
    if (queued || (counting && countRatio === null) || (walking && totalFiles === null)) {
      const ariaText = `${details.join(" · ")}. ${COPY.scan_counting_help}.`
      progress = { determinate: false, ariaText }
    } else {
      const progressRatio = counting
        ? countRatio * countWeight
        : verifying
        ? 0.99
        : walking
        ? countWeight + ((totalFiles ? Math.min(1, (scan.files || 0) / totalFiles) : 1) * walkWeight)
        : Math.min(0.98, countWeight + walkWeight + (analysisWeight * hashRatio))
      const boundedProgress = Math.max(0, Math.min(1, progressRatio))
      const progressValue = Math.round(boundedProgress * 1000) / 10
      const progressHelp = counting ? COPY.scan_count_estimate_help : verifying ? COPY.scan_finishing_help : walking ? COPY.scan_file_progress_help : COPY.scan_estimate_help
      const progressText = COPY.about_percent.replace("{percent}", progressValue)
      percent = `~${progressValue}%`
      progress = { determinate: true, value: progressValue, ratio: boundedProgress, help: progressHelp, text: progressText }
    }
    if (!scanState.querySelector(".vault-progress-track")) {
      scanState.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><strong></strong><span class="vault-scan-detail"></span><span class="vault-scan-percent" hidden></span><span class="vault-progress-track" role="progressbar"><span class="vault-progress-bar"></span></span>`
    }
    scanState.classList.add("show")
    scanState.querySelector("strong").textContent = phase
    scanState.querySelector(".vault-scan-detail").textContent = details.join(" · ")
    const percentNode = scanState.querySelector(".vault-scan-percent")
    const track = scanState.querySelector(".vault-progress-track")
    const bar = scanState.querySelector(".vault-progress-bar")
    track.setAttribute("aria-label", phase)
    if (progress.determinate) {
      percentNode.hidden = false
      percentNode.textContent = percent
      percentNode.title = progress.help
      track.setAttribute("aria-valuemin", "0")
      track.setAttribute("aria-valuemax", "100")
      track.setAttribute("aria-valuenow", progress.value)
      track.setAttribute("aria-valuetext", `${progress.text} ${progress.help}.`)
      bar.className = "vault-progress-bar determinate"
      bar.style.setProperty("--vault-progress", progress.ratio)
    } else {
      percentNode.hidden = true
      track.removeAttribute("aria-valuemin")
      track.removeAttribute("aria-valuemax")
      track.removeAttribute("aria-valuenow")
      track.setAttribute("aria-valuetext", progress.ariaText)
      bar.className = "vault-progress-bar indeterminate"
      bar.style.removeProperty("--vault-progress")
    }
  } else {
    scanState.classList.remove("show")
    scanState.innerHTML = ""
  }
}

const renderResult = () => {
  const result = el("vault-result")
  if (!state.scanResult) {
    result.className = "vault-result"
    result.innerHTML = ""
    return
  }
  const info = state.scanResult
  const duplicateLabel = countLabel(info.count, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase())
  const review = info.count ? `<button class="vault-button" type="button" id="btn-review-result">${esc(COPY.review)} ${duplicateLabel}<i class="fa-solid fa-chevron-right"></i></button>` : ""
  if (info.incomplete) {
    result.className = `vault-result show incomplete${state.scanProblemsOpen ? " expanded" : ""}`
    const unreadableLabel = `${info.inaccessible} ${info.inaccessible === 1 ? COPY.scan_unreadable_path : COPY.scan_unreadable_paths}`
    const viewLabel = info.inaccessible === 1 ? COPY.view_unreadable_path : COPY.view_unreadable_paths
    const paths = info.inaccessiblePaths.map((filePath) =>
      `<div class="vault-result-path"><span class="vault-result-path-dot" aria-hidden="true"></span><span>${esc(filePath)}</span></div>`
    ).join("")
    const toggle = `<button class="vault-result-toggle" type="button" id="btn-scan-problems" aria-expanded="${state.scanProblemsOpen}" aria-controls="vault-result-paths">${esc(viewLabel)}<i class="fa-solid fa-chevron-down"></i></button>`
    result.innerHTML = `<div class="vault-result-message"><i class="fa-solid fa-triangle-exclamation"></i><span class="vault-result-heading"><strong>${esc(COPY.scan_incomplete)}</strong><span>${esc(`${unreadableLabel}. ${COPY.scan_partial_rest}`)}</span></span><span class="vault-result-actions">${toggle}${review}</span></div><div class="vault-result-paths" id="vault-result-paths"${state.scanProblemsOpen ? "" : " hidden"}>${paths}</div>`
    return
  }
  result.className = "vault-result show"
  const skipped = info.skipped ? ` · ${countLabel(info.skipped)} ${esc(COPY.scan_not_analyzed)}` : ""
  const resultIcon = info.skipped ? "fa-solid fa-triangle-exclamation" : "fa-regular fa-circle-check"
  result.innerHTML = `<i class="${resultIcon}"></i><strong>${esc(COPY.scan_complete)}</strong><span class="vault-result-detail">${duplicateLabel} ${esc(COPY.found_in)} ${countLabel(info.locations, COPY.location, COPY.locations_lower)} · ${fmt(info.bytes)} ${esc(COPY.can_be_saved)}${skipped}</span>${review}`
}
const renderFeedback = () => {
  const feedback = el("vault-feedback")
  if (!state.feedback) {
    feedback.className = "vault-feedback"
    feedback.innerHTML = ""
    return
  }
  feedback.className = `vault-feedback show ${state.feedback.error ? "error" : ""}`
  feedback.innerHTML = `<i class="fa-solid fa-${state.feedback.error ? "triangle-exclamation" : "circle-check"}"></i><span>${esc(state.feedback.message)}</span>`
}
const renderCloudWarning = () => {
  const warning = el("vault-cloud-warning")
  const provider = state.data && state.data.cloud_sync_warning
  const key = provider ? `pinokio:vault:cloud-warning:${provider}` : null
  let dismissed = false
  try { dismissed = !!(key && localStorage.getItem(key)) } catch (error) {}
  if (!provider || dismissed) {
    warning.classList.remove("show")
    warning.innerHTML = ""
    return
  }
  const message = COPY.cloud_sync_warning.replace("{provider}", provider)
  warning.classList.add("show")
  warning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${esc(message)}</span><button class="vault-text-button" id="btn-dismiss-cloud" type="button" data-warning-key="${attr(key)}">${esc(COPY.dismiss)}</button>`
}

const render = () => {
  if (!state.data) return
  renderOverview()
  renderResult()
  renderFeedback()
  renderCloudWarning()
  if (!state.data.enabled) {
    el("vault-explorer").style.display = "none"
    return
  }
  el("vault-explorer").style.display = "grid"
  const items = buildItems()
  renderViews(items)
  renderLocations(items)
  const visible = activeItems(items)
  renderToolbar(visible)
  renderTable(visible)
  el("vault-pane-footer").textContent = state.view === "duplicates" ? COPY.duplicate_note : COPY.tracked_note
}

const scanActive = (scan) => !!(scan && (scan.pending || scan.active || scan.queued > 0))
const scanMatchesContext = (scan) => scanActive(scan) && (!IS_APP_MODE || scan.scope_id === SCOPE_ID)
const reviewedScan = () => {
  try { return localStorage.getItem(reviewedScanKey) }
  catch (error) { return null }
}
const markScanReviewed = () => {
  const last = state.data && state.data.last_scan
  if (!last || !last.ts) return
  try { localStorage.setItem(reviewedScanKey, String(last.ts)) } catch (error) {}
}
const fetchJson = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(COPY.status_request_failed.replace("{status}", response.status))
  return response.json()
}
const applyFullData = (data) => {
  const scanning = scanActive(data.scan)
  const contextualScan = !IS_APP_MODE || !data.scan || data.scan.scope_id === SCOPE_ID
  const completed = state.scanRequested && !scanning && data.last_scan && data.last_scan.ts !== state.scanBaseline
  const incomplete = contextualScan && !scanning && data.scan && data.scan.phase === "incomplete"
  const failed = contextualScan && state.scanRequested && !scanning && data.scan && data.scan.error
  const unreviewed = !scanning && data.last_scan &&
    reviewedScan() !== String(data.last_scan.ts) &&
    (data.duplicates.some((item) => item.shareable !== false) || data.last_scan.hash_failures > 0)
  state.data = data
  if (failed) {
    state.scanRequested = false
    state.feedback = { error: true, message: data.scan.error }
  } else if (completed || incomplete || (!state.scanResult && unreviewed)) {
    state.scanRequested = false
    const shareable = data.duplicates.filter((item) => item.shareable !== false)
    state.scanResult = {
      count: shareable.length,
      locations: new Set(shareable.map((item) => item.source_id).filter(Boolean)).size,
      bytes: shareable.reduce((sum, item) => sum + item.size, 0),
      skipped: Number(incomplete ? data.scan.hash_failures : data.last_scan && data.last_scan.hash_failures) || 0,
      incomplete,
      inaccessible: Number(incomplete && data.scan.inaccessible) || 0,
      inaccessiblePaths: incomplete && Array.isArray(data.scan.inaccessible_paths)
        ? data.scan.inaccessible_paths
        : []
    }
  }
  if (data.activity_error) {
    state.feedback = { error: true, message: COPY.activity_write_failed }
  }
  render()
  return scanning
}
const refresh = async () => {
  let delay = null
  try {
    const progressOnly = !!(state.data && scanActive(state.data.scan))
    if (progressOnly) {
      const progress = await fetchJson(statusUrl(true))
      state.data.scan = progress.scan
      state.data.last_scan = progress.last_scan
      if (scanActive(progress.scan)) {
        delay = 1500
        renderOverview()
        renderFeedback()
      } else {
        if (applyFullData(await fetchJson(statusUrl())) || state.scanRequested) delay = 1500
      }
    } else {
      if (applyFullData(await fetchJson(statusUrl())) || state.scanRequested) delay = 1500
    }
  } catch (error) {
    state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
    renderFeedback()
    delay = 5000
  } finally {
    clearTimeout(window.__vaultRefresh)
    window.__vaultRefresh = delay == null ? null : setTimeout(refresh, delay)
  }
}

const runAction = async (payload, success) => {
  state.feedback = null
  renderFeedback()
  try {
    const result = await post(payload)
    if (result.error) state.feedback = { error: true, message: result.error }
    else {
      const outcome = typeof success === "function" ? success(result) : success
      state.feedback = outcome && typeof outcome === "object"
        ? outcome
        : { error: false, message: outcome }
      if (result.persistence_warning) {
        state.feedback = {
          error: true,
          message: [state.feedback && state.feedback.message, COPY.persistence_write_failed]
            .filter(Boolean).join(" ")
        }
      }
    }
  } catch (error) {
    state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
  }
  await refresh()
}

const deduplicateFeedback = (result) => {
  const waiting = (result.locked || 0) + (result.incompatible || 0) + (result.unavailable || 0) + (result.failed || 0)
  const messages = []
  if (result.converted || result.bytes_saved) messages.push(`${COPY.converted}: ${fmt(result.bytes_saved || 0)}.`)
  if (result.stale) messages.push(COPY.changed_since_scan)
  if (waiting) messages.push(`${COPY.files_still_waiting.replace("{count}", countLabel(waiting))}.`)
  if (!result.stale && !waiting) return messages.join(" ") || `${COPY.converted}: ${fmt(0)}`
  return {
    error: true,
    message: messages.join(" ")
  }
}

const detachFeedback = (result) => {
  if (result.status === "detached") return COPY.separated
  if (result.status === "ignored") return COPY.skipped_action
  const messages = {
    locked: COPY.separate_locked,
    stale: COPY.separate_changed,
    conflict: COPY.separate_conflict,
    "not-found": COPY.separate_not_found
  }
  return { error: true, message: messages[result.status] || COPY.action_not_completed }
}

const chooseExternalFolder = () => new Promise((resolve, reject) => {
  const picker = new Socket()
  let settled = false
  const finish = (value) => {
    if (settled) return
    settled = true
    resolve(value)
  }
  const fail = (error) => {
    if (settled) return
    settled = true
    reject(error)
  }
  picker.run({
    method: "kernel.bin.filepicker",
    params: { title: COPY.add_external_folder, type: "folder" }
  }, (packet) => {
    if (packet.type === "result") {
      const paths = packet.data && Array.isArray(packet.data.paths) ? packet.data.paths : []
      finish(paths[0] || null)
      picker.close()
    } else if (packet.type === "error") {
      const message = packet.data && packet.data.message ? packet.data.message : COPY.folder_picker_error
      fail(new Error(message))
      picker.close()
    }
  }).then(() => finish(null)).catch(fail)
})

document.addEventListener("click", async (event) => {
  const advanced = el("vault-advanced")
  if (advanced && advanced.open && !advanced.contains(event.target)) advanced.open = false
  const target = event.target.closest("button")
  if (!target) return
  if (target.id === "btn-dismiss-cloud") {
    try { localStorage.setItem(target.dataset.warningKey, "1") } catch (error) {}
    renderCloudWarning()
  } else if (target.dataset.view) {
    state.view = target.dataset.view
    state.sourceId = SCOPE_ID
    state.query = ""
    state.statusFilter = "all"
    if (state.view === "duplicates") {
      markScanReviewed()
      state.scanResult = null
    }
    render()
  } else if (target.dataset.source) {
    state.sourceId = IS_APP_MODE
      ? SCOPE_ID
      : (state.sourceId === target.dataset.source ? null : target.dataset.source)
    render()
  } else if (target.dataset.toggleSource) {
    const id = target.dataset.toggleSource
    if (state.collapsedSources.has(id)) state.collapsedSources.delete(id)
    else state.collapsedSources.add(id)
    renderLocations(buildItems())
  } else if (target.dataset.toggleDir) {
    const key = target.dataset.toggleDir
    if (state.collapsedDirs.has(key)) state.collapsedDirs.delete(key)
    else state.collapsedDirs.add(key)
    render()
  } else if (target.dataset.expandFile) {
    const file = target.dataset.expandFile
    if (state.expandedFiles.has(file)) state.expandedFiles.delete(file)
    else state.expandedFiles.add(file)
    render()
  } else if (target.id === "btn-add-source") {
    target.disabled = true
    try {
      const folderPath = await chooseExternalFolder()
      if (!folderPath) return
      const result = await post({ action: "add_source", path: folderPath })
      if (result.error) {
        state.feedback = { error: true, message: result.error }
      } else {
        state.view = "all"
        state.sourceId = result.source && result.source.id ? result.source.id : null
        state.query = ""
        state.feedback = {
          error: false,
          message: result.created === false
            ? COPY.external_exists
            : result.source && result.source.shareable === false
              ? COPY.external_other_disk
              : COPY.external_added
        }
      }
      await refresh()
    } catch (error) {
      state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
      renderFeedback()
    } finally {
      target.disabled = false
    }
  } else if (target.id === "btn-scan" || target.id === "btn-empty-scan") {
    state.scanRequested = true
    state.scanBaseline = state.data.last_scan ? state.data.last_scan.ts : null
    state.scanResult = null
    state.scanProblemsOpen = false
    state.feedback = null
    try {
      const result = await post({ action: "scan", scope_id: SCOPE_ID })
      if (result.error) throw new Error(result.error)
      await refresh()
    } catch (error) {
      state.scanRequested = false
      state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
      renderFeedback()
    }
  } else if (target.id === "btn-scan-problems") {
    state.scanProblemsOpen = !state.scanProblemsOpen
    const paths = el("vault-result-paths")
    target.setAttribute("aria-expanded", String(state.scanProblemsOpen))
    target.closest(".vault-result").classList.toggle("expanded", state.scanProblemsOpen)
    if (paths) paths.hidden = !state.scanProblemsOpen
  } else if (target.id === "btn-repair") {
    target.disabled = true
    target.textContent = COPY.repairing
    await runAction({ action: "repair" }, COPY.repair_done)
    if (advanced) advanced.open = false
  } else if (target.id === "btn-review-result" || target.id === "btn-review-metric") {
    if (!state.scanResult || !state.scanResult.incomplete) markScanReviewed()
    state.view = "duplicates"
    state.sourceId = SCOPE_ID
    state.query = ""
    state.scanResult = null
    render()
  } else if (target.dataset.deduplicateScope) {
    await runAction({ action: "deduplicate", scope_id: target.dataset.deduplicateScope }, deduplicateFeedback)
  } else if (target.dataset.detach) {
    await runAction({ action: "detach", path: target.dataset.detach }, detachFeedback)
  } else if (target.dataset.reshare) {
    await runAction({ action: "reshare", path: target.dataset.reshare }, (result) => result.status === "resharable"
      ? COPY.included_in_scans
      : { error: true, message: COPY.action_not_completed })
  } else if (target.dataset.reclaim) {
    await runAction({ action: "reclaim", hash: target.dataset.reclaim }, (result) => result.status === "reclaimed"
      ? `${COPY.reclaimed}: ${fmt(result.bytes_freed || 0)}`
      : { error: true, message: COPY.unavailable })
  } else if (target.id === "btn-reclaim-all") {
    await runAction({ action: "reclaim_all" }, (result) => result.failed
      ? { error: true, message: `${COPY.reclaimed}: ${fmt(result.bytes_freed || 0)}. ${COPY.action_not_completed}` }
      : `${COPY.reclaimed}: ${fmt(result.bytes_freed || 0)}`)
  } else if (target.dataset.undo) {
    await runAction({ action: "undo", batch_id: target.dataset.undo }, (result) => result.failed
      ? { error: true, message: `${COPY.event_undo} (${result.undone || 0}). ${COPY.undo_incomplete}` }
      : `${COPY.event_undo} (${result.undone || 0})`)
  }
})

document.addEventListener("input", (event) => {
  if (event.target.id !== "vault-search") return
  state.query = event.target.value
  const items = activeItems(buildItems())
  updateToolbarSummary(items)
  renderTable(items)
})
document.addEventListener("change", (event) => {
  if (event.target.id !== "vault-status-filter") return
  state.statusFilter = event.target.value
  render()
})

el("btn-scan").textContent = COPY.scan
const addSourceButton = el("btn-add-source")
if (addSourceButton) {
  addSourceButton.setAttribute("aria-label", COPY.add_external_folder)
  addSourceButton.setAttribute("title", COPY.add_external_folder)
}
el("vault-pane").setAttribute("aria-label", COPY.files_region)
if (el("btn-vault-options")) el("btn-vault-options").setAttribute("aria-label", COPY.vault_options)
if (el("vault-repair-title")) el("vault-repair-title").textContent = COPY.repair_index
if (el("vault-repair-description")) el("vault-repair-description").textContent = COPY.repair_description
if (el("btn-repair")) el("btn-repair").textContent = COPY.repair_action
refresh()
