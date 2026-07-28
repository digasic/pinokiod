const COPY = {
  views: "VIEWS",
  locations: "LOCATIONS",
  all: "All files",
  duplicates: "Duplicates",
  shared: "Deduplicated",
  skipped: "Kept separate",
  reclaimable: "Unused files",
  activity: "Activity",
  all_description: "Every scanned file and its current deduplication status.",
  duplicates_description: "Identical files waiting to be deduplicated or kept separate.",
  shared_description: "Files that share disk storage across multiple locations.",
  tracked_description: "Files with no duplicate action required.",
  independent_description: "Duplicate files that remain as separate copies.",
  reclaimable_description: "Private links no longer used by any linked file.",
  activity_description: "A history of scans and changes made by Save space.",
  add_external_folder: "Add external folder",
  files_region: "Files",
  folder_picker_error: "The folder picker could not be opened.",
  external_added: "Added to Locations. Run a scan when you’re ready.",
  external_exists: "That folder is already in Locations.",
  external_other_disk: "Added to Locations. It can be scanned, but files on this disk cannot be deduplicated with files in your Pinokio folder.",
  remove_external_folder: "Remove from Locations",
  remove_external_confirm: "Remove “{name}” from Locations? This does not delete or modify any files.",
  external_removed: "Removed from Locations. No files were changed.",
  pinokio_folder: "Pinokio folder",
  save_space: "Save space",
  disk_space_saved: "of disk space saved",
  saved_for_app: "{size} saved for this app",
  before: "Before",
  before_help: "Estimated size of every scanned location if each app stored its own copy. File Explorer may count deduplicated files differently.",
  after: "After",
  effective_help: "For deduplicated files, disk usage is divided evenly among every location using them.",
  nothing_more_to_save: "Nothing else to save",
  more_can_be_saved: "{size} more can be saved",
  review_files: "Review files",
  scanned: "Scanned",
  not_scanned: "Not scanned yet",
  find_savings: "Scan to find duplicate files and save disk space",
  find_app_savings: "Scan this app to find duplicate files and save disk space",
  storage_details: "Storage details",
  kept_deduplicated: "Kept deduplicated",
  already_shared: "Already shared before Save space",
  last_scanned: "Last scanned",
  never: "Never",
  scan: "Scan now",
  scan_app: "Scan this app",
  scan_again: "Scan again",
  scanning: "Scanning…",
  minimum_file_size: "Minimum file size to scan",
  scanning_elsewhere: "Another location is being scanned",
  scanning_elsewhere_hint: "This app can be scanned when the current scan finishes.",
  vault_options: "Save space options",
  repair_index: "Repair index",
  repair_action: "Repair index",
  repair_description: "Reconstruct the internal index if file records or deduplication status look incorrect. This does not scan for new duplicates.",
  repair_required: "The saved index could not be loaded. Run Repair index before using Save space.",
  repair_required_description: "Pinokio did not inspect your files automatically. Repair index must be started explicitly to reconstruct the saved file records.",
  repairing: "Repairing…",
  repair_done: "Index repaired",
  repair_cancelled: "Index repair cancelled",
  repair_failed: "Index repair failed",
  repair_progress: "{folders} folders · {files} files · {records} records checked",
  cancel: "Cancel",
  cancelling: "Cancelling…",
  scan_counting: "Counting files",
  scan_progress: "Scanning your configured locations",
  scan_location: "Scanning {location}",
  scan_queued: "Waiting to start scan",
  scan_analyzing: "Analyzing files",
  scan_finishing: "Finishing scan",
  scan_counting_help: "The first scan cannot know its total until this pass finishes",
  scan_file_progress_help: "Based on the exact current file total",
  scan_hash_progress_help: "Based on the exact file count and bytes to analyze",
  scan_finishing_help: "File analysis is complete; the index is being updated",
  exact_percent: "{percent} percent.",
  scan_checked: "{done} of {total} files analyzed",
  scan_file_bytes: "{done} of {total}",
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
  search_all: "Search files",
  search_duplicates: "Search duplicates",
  search_shared: "Search deduplicated files",
  search_tracked: "Search files with no action needed",
  search_skipped: "Search files kept separate",
  search_activity: "Search activity",
  search_in: "Search in {location}",
  status_request_failed: "Couldn’t load Save space status ({status})",
  action_request_failed: "The Save space action failed ({status})",
  all_statuses: "All statuses",
  by_location: "By location",
  name: "Name",
  location_column: "Location",
  size: "Size",
  sort_largest: "Sort by size, largest first",
  sort_smallest: "Sort by size, smallest first",
  folders: "Folders",
  files_mode: "Files",
  display_mode: "Display mode",
  sorted_largest: "sorted largest first",
  sorted_smallest: "sorted smallest first",
  previous: "Previous",
  next: "Next",
  file_pages: "File pages",
  status: "Deduplication status",
  matches: "Matches",
  can_save: "Can save",
  can_free: "Can free",
  duplicate: "Duplicate",
  tracked: "No action needed",
  different_disk: "Different disk",
  can_save_suffix: "can save",
  unavailable: "Unavailable",
  sharing_unavailable: "Deduplication is unavailable on this disk",
  permissions_differ: "File permissions differ",
  changed_since_scan: "Some files changed since the scan. Scan again before deduplicating them.",
  deduplicate_locked: "Stop the app before deduplicating this file.",
  deduplicate_changed: "This file changed while it was being checked. Nothing was changed.",
  deduplicate_no_match: "This file no longer matches a deduplicated file. Nothing was changed.",
  separate_locked: "Stop the app before separating this file.",
  separate_changed: "This file changed since it was scanned. Scan again, then try again.",
  separate_conflict: "A temporary file already exists next to this file. Nothing was changed.",
  separate_not_found: "This file is no longer tracked. Scan again to refresh this view.",
  undo_incomplete: "Some files could not be separated. No existing files were overwritten.",
  action_not_completed: "The action could not be completed. No existing files were overwritten.",
  activity_write_failed: "The file action completed, but some activity history could not be recorded.",
  persistence_write_failed: "The file action completed, but its updated record could not be saved yet. It will retry automatically.",
  files_still_waiting: "{count} still waiting for review",
  cloud_sync_warning: "Cloud syncing with {provider} can make deduplicated files use separate disk space again.",
  dismiss: "Dismiss",
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
  deduplicating: "Deduplicating files",
  deduplicating_file: "Deduplicating file",
  deduplication_progress: "{done} of {total} files",
  making_separate: "Making file separate",
  keeping_separate: "Keeping file separate",
  keep_separate: "Keep separate",
  kept_separate: "Kept separate",
  make_separate: "Make separate",
  reclaim: "Clean up",
  reclaim_all: "Clean up all",
  cleanup_ready: "{size} ready to clean up",
  cleanup_ready_detail: "{count} left after their linked files were deleted.",
  review_cleanup: "Review cleanup",
  private_link: "private link",
  private_links: "private links",
  undo: "Undo",
  identical_contents_at: "Identical contents at",
  no_files: "No files found",
  no_files_hint: "Run a scan to find files that can be deduplicated. Scanning never links files together or replaces them.",
  scan_waiting: "Waiting for scan results",
  scan_waiting_hint: "Files will appear here when this scan finishes.",
  no_duplicates: "No duplicates to review",
  no_duplicates_hint: "There are no files waiting for your review.",
  no_shared: "Nothing deduplicated yet",
  no_shared_hint: "Deduplicated files will appear here after you review duplicates.",
  no_tracked: "No files with no action needed",
  no_tracked_hint: "Files without a duplicate action will appear here after a scan.",
  no_skipped: "Nothing kept separate",
  no_skipped_hint: "Files you keep separate will appear here.",
  no_reclaimable: "No cleanup needed",
  no_reclaimable_hint: "Private links with no remaining linked files will appear here.",
  no_activity: "No activity yet",
  no_activity_hint: "Scans and actions will be recorded here.",
  view_all: "View all files",
  show_all_locations: "Show all locations",
  tracked_note: "Only files {size} and larger appear here. Files keep their current locations.",
  tracked_note_all: "All non-empty files appear here. Files keep their current locations.",
  tracked_note_large_scan: "{count} unique files with no duplicates are not listed. Every file was still scanned.",
  duplicate_note: "Only files waiting for review are shown.",
  reclaimable_note: "These private links have no remaining linked files. Cleaning them up frees disk space.",
  activity_note: "Recent scans and Save space actions.",
  converted: "Deduplicated",
  files_left_separate: "{count} remained separate",
  skipped_action: "Kept separate",
  separated: "Separated",
  reclaimed: "Cleaned up",
  event_convert: "Deduplicated",
  event_found: "Duplicate found",
  event_adopt: "Added",
  event_reclaim: "Cleaned up unused link",
  event_undo: "Undid deduplication",
  event_diverged: "Changed by an app — no longer deduplicated",
  event_detach: "Separated",
  event_skip: "Kept separate",
  event_reshare: "Included in scans"
}

const SCOPE_ID = document.body.dataset.vaultScope || null
const IS_APP_MODE = document.body.dataset.vaultMode === "app" && !!SCOPE_ID
const statusUrl = (progress = false) => {
  const query = new URLSearchParams()
  if (progress) query.set("progress", "1")
  if (SCOPE_ID) query.set("scope_id", SCOPE_ID)
  if (!progress) {
    query.set("view", state.view)
    if (state.sourceId) query.set("location_id", state.sourceId)
    if (state.query) query.set("q", state.query)
    if (state.statusFilter !== "all") query.set("status_filter", state.statusFilter)
    if (state.sizeSort) query.set("size_sort", state.sizeSort)
    query.set("page", String(state.page))
    query.set("page_size", String(PAGE_SIZE))
  }
  const suffix = query.toString()
  return `/info/dedup${suffix ? `?${suffix}` : ""}`
}
const reviewedScanKey = `pinokio:vault:reviewed-scan:${SCOPE_ID || "global"}`
const candidateSizeKey = "pinokio:vault:candidate-size"
const candidateSizeBase = document.body.dataset.platform === "win32" ? 1024 : 1000
const defaultCandidateSize = 100 * candidateSizeBase ** 2
const candidateSizeOptions = [0]
  .concat([1, 10, 50, 100, 500].map((value) => value * candidateSizeBase ** 2))
  .concat(candidateSizeBase ** 3)
const PAGE_SIZE = 500

const state = {
  data: null,
  view: "all",
  sourceId: SCOPE_ID,
  query: "",
  statusFilter: "all",
  displayMode: "folders",
  sizeSort: null,
  collapsedSources: new Set(),
  collapsedDirs: new Set(),
  expandedFiles: new Set(),
  scanRequested: false,
  scanBaseline: null,
  scanResult: null,
  scanProblemsOpen: false,
  feedback: null,
  actionProgress: null,
  actionRequest: false,
  repairRequested: false,
  page: 0
}

const el = (id) => document.getElementById(id)
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]))
const attr = esc
const fmt = window.PinokioFormatStorageSize
const candidateSize = () => {
  const value = Number(el("vault-candidate-size").value)
  return candidateSizeOptions.includes(value) ? value : defaultCandidateSize
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
const externalLocation = (item) => {
  const source = sourceById(item.source_id)
  if (!source || source.kind !== "external") return ""
  const base = sourcePath(source).replace(/[\\/]+$/, "")
  const relative = String(item.relative_path || "").replace(/^[\\/]+/, "")
  if (!base) return relative
  if (!relative) return base
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/"
  return `${base}${separator}${separator === "\\" ? relative.replace(/\//g, "\\") : relative}`
}
const buildItems = () => {
  return state.data && Array.isArray(state.data.items) ? state.data.items : []
}

const viewIcon = {
  all: "fa-regular fa-file-lines",
  duplicates: "fa-regular fa-copy",
  shared: "fa-solid fa-link",
  tracked: "fa-regular fa-circle-check",
  independent: "fa-solid fa-circle-minus",
  reclaimable: "fa-regular fa-trash-can",
  activity: "fa-solid fa-wave-square"
}
const viewLabel = {
  all: COPY.all,
  duplicates: COPY.duplicates,
  shared: COPY.shared,
  tracked: COPY.tracked,
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
const renderViews = () => {
  const counts = state.data.inventory.counts
  el("views-label").textContent = COPY.views
  const views = IS_APP_MODE
    ? ["all", "duplicates", "shared", "tracked", "independent", "activity"]
    : ["all", "duplicates", "shared", "tracked", "independent", "reclaimable", "activity"]
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
  let html = `<div class="vault-source-line depth-${Math.min(depth, 2)} ${pathText ? "has-path" : ""} ${state.sourceId === source.id ? "selected" : ""}">`
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

const renderLocations = () => {
  el("locations-label").textContent = COPY.locations
  const pinokio = sourceById("pinokio")
  const external = sourceById("external")
  const inventoryCounts = state.data.inventory.source_counts
  const counts = {
    duplicates: new Map(Object.entries(inventoryCounts.duplicates || {})),
    tracked: new Map(Object.entries(inventoryCounts.all || {}))
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
const scopeDuplicateCount = (sourceId, shareableOnly = false) => {
  const inventory = state.data.inventory
  const counts = shareableOnly
    ? inventory.shareable_by_source
    : inventory.source_counts && inventory.source_counts.duplicates
  return Math.max(0, Number(counts && counts[sourceId]) || 0)
}
const bulkDeduplicationCount = (selection) => selection === "duplicates"
  ? (state.sourceId
      ? scopeDuplicateCount(state.sourceId, true)
      : Number(state.data.inventory.shareable_duplicates) || 0)
  : (state.sourceId
      ? Number(state.data.inventory.source_counts.independent[state.sourceId] || 0)
      : Number(state.data.inventory.counts.independent) || 0)
const bulkDeduplicationAction = () => {
  const selection = state.view === "duplicates"
    ? "duplicates"
    : state.view === "independent" ? "kept-separate" : null
  if (!selection) return ""
  const count = bulkDeduplicationCount(selection)
  if (!count) return ""
  const context = state.sourceId || ""
  const label = `${COPY.deduplicate} ${countLabel(count)}`
  return `<button class="vault-button primary" type="button" data-deduplicate-all="${selection}" data-deduplicate-context="${attr(context)}" aria-label="${attr(label)}" title="${attr(label)}">${esc(label)}</button>`
}
const batchAction = (source) => {
  if (!source || source.kind === "virtual" || source.kind === "pinokio") return ""
  const duplicateCount = scopeDuplicateCount(source.id)
  if (!duplicateCount) return ""
  const shareableCount = scopeDuplicateCount(source.id, true)
  if (!source.shareable || !shareableCount) return `<div class="vault-pane-action-note">${esc(COPY.sharing_unavailable)}</div>`
  return `<button class="vault-button" type="button" data-deduplicate-scope="${attr(source.id)}">${esc(COPY.deduplicate)} ${countLabel(shareableCount)}</button>`
}
const removeSourceAction = (source) => source && source.removable
  ? `<button class="vault-button" type="button" data-remove-source="${attr(source.id)}">${esc(COPY.remove_external_folder)}</button>`
  : ""

const toolbarSummary = () => {
  const current = state.data.inventory.current || {}
  if (state.view === "duplicates") {
    return `${countLabel(Number(current.count) || 0)} · ${countLabel(Number(current.locations) || 0, COPY.location, COPY.locations_lower)} · ${fmt(Number(current.shareable_bytes) || 0)} ${COPY.can_save_suffix}`
  }
  if (state.view === "activity") {
    return countLabel(Number(current.count) || 0, COPY.event, COPY.events)
  }
  if (state.view === "reclaimable") {
    return `${countLabel(Number(current.count) || 0)} · ${fmt(state.data.reclaimable)}`
  }
  return countLabel(Number(current.count) || 0)
}

const searchPlaceholder = () => {
  if (state.view === "duplicates") return COPY.search_duplicates
  if (state.view === "shared") return COPY.search_shared
  if (state.view === "tracked") return COPY.search_tracked
  if (state.view === "independent") return COPY.search_skipped
  if (state.view === "activity") return COPY.search_activity
  const source = selectedSource()
  return source && source.kind === "app" ? COPY.search_in.replace("{location}", source.label) : COPY.search_all
}
const supportsDisplayMode = () => state.view === "all" || state.view === "shared" ||
  state.view === "tracked" || state.view === "independent"
const displayModeControl = () => supportsDisplayMode() ? `<div class="vault-display-mode" role="group" aria-label="${attr(COPY.display_mode)}">
  <button type="button" data-display-mode="folders" aria-pressed="${state.displayMode === "folders"}" class="${state.displayMode === "folders" ? "selected" : ""}">${esc(COPY.folders)}</button>
  <button type="button" data-display-mode="files" aria-pressed="${state.displayMode === "files"}" class="${state.displayMode === "files" ? "selected" : ""}">${esc(COPY.files_mode)}</button>
</div>` : ""
const renderToolbar = () => {
  const description = COPY[`${state.view}_description`] || ""
  const descriptionMarkup = `<span class="vault-toolbar-description" title="${attr(description)}">${esc(description)}</span>`
  if (state.view === "reclaimable") {
    const count = Number(state.data.inventory.counts.reclaimable) || 0
    el("vault-toolbar").innerHTML = count
      ? `${descriptionMarkup}<span class="vault-toolbar-count" id="vault-toolbar-summary">${esc(toolbarSummary())}</span><button class="vault-button" type="button" id="btn-reclaim-all">${esc(COPY.reclaim_all)}</button>`
      : descriptionMarkup
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
    ${displayModeControl()}
    ${descriptionMarkup}
    <span class="vault-toolbar-count" id="vault-toolbar-summary">${esc(toolbarSummary())}</span>
    ${state.view === "all" ? batchAction(source) : bulkDeduplicationAction()}
    ${removeSourceAction(source)}`
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
  if (item.status === "independent") return `<span class="vault-status"><i class="fa-solid fa-circle-minus"></i>${esc(COPY.kept_separate)}</span>`
  return `<span class="vault-status"><i class="fa-regular fa-circle-check"></i>${esc(COPY.tracked)}</span>`
}
const spaceMarkup = (item) => {
  if (item.status === "duplicate") return item.shareable ? `${fmt(item.size)} ${COPY.can_save_suffix}` : COPY.unavailable
  return "—"
}
const duplicateAction = (item) => {
  if (item.status === "duplicate") {
    return `<button class="vault-text-button" type="button" aria-label="${attr(`${COPY.keep_separate}: ${basename(item.relative_path)}`)}" data-detach="${attr(item.path)}" data-detach-kind="keep">${esc(COPY.keep_separate)}</button>`
  }
  return ""
}
const sharingControl = (item) => {
  let control = ""
  if (item.status === "shared") {
    control = `<button class="vault-text-button" type="button" aria-label="${attr(`${COPY.make_separate}: ${basename(item.relative_path)}`)}" data-detach="${attr(item.path)}" data-detach-kind="make">${esc(COPY.make_separate)}</button>`
  } else if (item.status === "independent") {
    control = `<button class="vault-text-button" type="button" aria-label="${attr(`${COPY.deduplicate}: ${basename(item.relative_path)}`)}" data-deduplicate-file="${attr(item.path)}">${esc(COPY.deduplicate)}</button>`
  } else if (item.status === "duplicate") {
    control = duplicateAction(item)
  }
  return `<span class="vault-status-cell">${statusMarkup(item)}${control}</span>`
}

const fileDetail = (item) => {
  if (!state.expandedFiles.has(item.path) || !item.locations || item.locations.length < 2) return ""
  return `<div class="vault-detail"><div class="vault-detail-label">${esc(COPY.identical_contents_at)} ${countLabel(item.locations.length, COPY.location, COPY.locations_lower)}</div>${item.locations.map((location) => `
    <div class="vault-location-detail"><i class="fa-regular fa-file"></i><span>${esc(externalLocation(location) || [location.source_label, location.relative_path].filter(Boolean).join(" / "))}</span></div>`).join("")}</div>`
}

const renderFileRow = (item, depth = 0, showMatch = false) => {
  const directoryPath = dirname(item.relative_path)
  const match = item.match
  const expandable = item.locations && item.locations.length > 1
  const rowTail = showMatch
    ? `<span>${match ? `<span class="vault-match-path">${esc(match.path)}</span>` : "—"}</span>
      <span class="vault-space">${esc(spaceMarkup(item))}</span>
      <span class="vault-row-action">${duplicateAction(item)}</span>`
    : sharingControl(item)
  return `<div class="vault-file-row">
    <div class="vault-name-cell indent-${Math.min(depth, 2)}">
      ${expandable ? `<button class="vault-disclosure" type="button" data-expand-file="${attr(item.path)}" aria-label="${state.expandedFiles.has(item.path) ? COPY.collapse : COPY.expand}" aria-expanded="${state.expandedFiles.has(item.path)}"><i class="fa-solid fa-chevron-${state.expandedFiles.has(item.path) ? "down" : "right"}"></i></button>` : `<span class="vault-disclosure"></span>`}
      <i class="fa-regular fa-file vault-name-icon"></i>
      <span class="vault-name-copy"><span class="vault-file-name">${esc(basename(item.relative_path))}</span>${directoryPath && depth === 0 ? `<span class="vault-file-path">${esc(directoryPath)}</span>` : ""}</span>
    </div>
    <span class="vault-size">${item.size ? fmt(item.size) : "—"}</span>
    ${rowTail}
  </div>${fileDetail(item)}`
}

const sizeOf = (item) => Math.max(0, Number(item && item.size) || 0)
const compareRows = (left, right, nameOf) => {
  const byName = () => nameOf(left).localeCompare(nameOf(right))
  if (!state.sizeSort) return byName()
  const sizeDifference = sizeOf(left) - sizeOf(right)
  return (state.sizeSort === "asc" ? sizeDifference : -sizeDifference) || byName()
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
  const setTreeSize = (node) => {
    node.size = node.files.reduce((sum, item) => sum + sizeOf(item), 0)
    for (const child of node.dirs.values()) node.size += setTreeSize(child)
    return node.size
  }
  setTreeSize(root)
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
  const shared = items.filter((item) => item.status === "shared").length
  const summary = duplicateCount ? countLabel(duplicateCount, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase()) : shared ? COPY.shared : COPY.tracked
  let html = `<div class="vault-file-row directory">
    <div class="vault-name-cell indent-${Math.min(depth, 2)}"><button class="vault-disclosure" type="button" data-toggle-dir="${attr(key)}" aria-label="${collapsed ? COPY.expand : COPY.collapse}" aria-expanded="${!collapsed}"><i class="fa-solid fa-chevron-${collapsed ? "right" : "down"}"></i></button><i class="fa-regular fa-folder vault-name-icon"></i><span class="vault-file-name">${esc(labels.join(" / "))}</span></div>
    <span class="vault-size">${fmt(current.size)}</span><span>${esc(summary)}</span>
  </div>`
  if (!collapsed) {
    html += [...current.files].sort((a, b) => compareRows(a, b, (item) => item._treeName)).map((item) => renderFileRow(item, depth + 1)).join("")
    html += [...current.dirs.values()].sort((a, b) => compareRows(a, b, (node) => node.name)).map((child) => renderTreeNode(child, [...prefix, ...labels], depth + 1)).join("")
  }
  return html
}
const renderTree = (items) => {
  const tree = makeTree(items)
  return [...tree.files].sort((a, b) => compareRows(a, b, (item) => item._treeName)).map((item) => renderFileRow(item)).join("") +
    [...tree.dirs.values()].sort((a, b) => compareRows(a, b, (node) => node.name)).map((node) => renderTreeNode(node, [], 0)).join("")
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
const flatLocation = (item) => externalLocation(item) ||
  [groupTitle(sourceById(item.source_id)), item.relative_path].filter(Boolean).join(" / ")
const renderFlatFiles = (items) => [...items]
  .sort((a, b) => compareRows(a, b, flatLocation))
  .map((item) => {
    const expandable = item.locations && item.locations.length > 1
    return `<div class="vault-file-row">
      <div class="vault-name-cell">
        ${expandable ? `<button class="vault-disclosure" type="button" data-expand-file="${attr(item.path)}" aria-label="${state.expandedFiles.has(item.path) ? COPY.collapse : COPY.expand}" aria-expanded="${state.expandedFiles.has(item.path)}"><i class="fa-solid fa-chevron-${state.expandedFiles.has(item.path) ? "down" : "right"}"></i></button>` : `<span class="vault-disclosure"></span>`}
        <i class="fa-regular fa-file vault-name-icon"></i>
        <span class="vault-file-name">${esc(basename(item.relative_path))}</span>
      </div>
      <span class="vault-flat-location">${esc(flatLocation(item))}</span>
      <span class="vault-size">${item.size ? fmt(item.size) : "—"}</span>
      ${sharingControl(item)}
    </div>${fileDetail(item)}`
  }).join("")
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
    const allShareable = scopeDuplicateCount(sourceId, true)
    const action = source && source.shareable && allShareable
      ? `<button class="vault-button" type="button" data-deduplicate-scope="${attr(sourceId)}">${esc(COPY.deduplicate)} ${countLabel(allShareable)}</button>`
      : `<span class="vault-unavailable">${esc(COPY.sharing_unavailable)}</span>`
    return `<div class="vault-group-row"><div class="vault-group-main"><div class="vault-group-title"><i class="fa-regular fa-folder"></i><span>${esc(groupTitle(source))}</span></div><div class="vault-group-meta">${countLabel(group.length, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase())} · ${bytes ? fmt(bytes) : COPY.unavailable}</div></div><div class="vault-group-action">${action}</div></div>${[...group].sort((a, b) => compareRows(a, b, (item) => item.relative_path)).map((item) => renderFileRow(item, 0, true)).join("")}`
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
    tracked: [COPY.no_tracked, COPY.no_tracked_hint, "fa-regular fa-circle-check"],
    independent: [COPY.no_skipped, COPY.no_skipped_hint, "fa-solid fa-circle-minus"],
    reclaimable: [COPY.no_reclaimable, COPY.no_reclaimable_hint, "fa-regular fa-circle-check"],
    activity: [COPY.no_activity, COPY.no_activity_hint, "fa-solid fa-wave-square"]
  }[view]
  const scanLabel = IS_APP_MODE ? COPY.scan_app : COPY.scan
  return `<div class="vault-empty"><div class="vault-empty-inner"><i class="${content[2]}"></i><h3>${esc(content[0])}</h3><p>${esc(content[1])}</p>${view === "duplicates" ? `<button class="vault-button" type="button" data-view="all">${esc(COPY.view_all)}</button>` : view === "all" && !activeScan ? `<button class="vault-button" type="button" id="btn-empty-scan">${esc(scanLabel)}</button>` : ""}</div></div>`
}

const renderReclaimable = (blobs) => {
  if (!blobs.length) return emptyState("reclaimable")
  return blobs.map((blob) => `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-regular fa-file vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name">${esc(blob.names[0] ? basename(blob.names[0].path) : `${blob.hash.slice(0, 12)}…`)}</span></span></div><span class="vault-size">${fmt(blob.size)}</span><span class="vault-space">${fmt(blob.size)}</span><span class="vault-row-action"><button class="vault-text-button" type="button" data-reclaim="${attr(blob.hash)}">${esc(COPY.reclaim)}</button></span></div>`).join("")
}

const renderActivity = (items) => {
  if (!items.length) return emptyState("activity")
  return items.map((item) => {
    if (item.activity_type === "batch") {
      return `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-solid fa-wave-square vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name vault-event-kind">${esc(COPY.event_convert)}</span><span class="vault-file-path">${esc(countLabel(item.files || 0))}</span></span></div><span class="vault-size">${fmt(item.bytes || 0)}</span><span class="vault-event-time">${item.ts ? esc(new Date(item.ts).toLocaleString()) : "—"}</span><span class="vault-row-action"><button class="vault-text-button" type="button" data-undo="${attr(item.batch_id)}">${esc(COPY.undo)}</button></span></div>`
    }
    const event = item
    const undo = event.show_undo
      ? `<button class="vault-text-button" type="button" data-undo="${attr(event.batch_id)}">${esc(COPY.undo)}</button>`
      : ""
    const eventPath = event.path
      ? `${event.source_label ? `${event.source_label} / ` : ""}${event.relative_path || event.path}`
      : (event.hash || "").slice(0, 12)
    return `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-solid fa-wave-square vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name vault-event-kind">${esc(eventLabels[event.kind] || event.kind)}</span><span class="vault-file-path">${esc(eventPath)}</span></span></div><span class="vault-size">${event.bytes_saved ? fmt(event.bytes_saved) : event.size ? fmt(event.size) : "—"}</span><span class="vault-event-time">${esc(new Date(event.ts).toLocaleString())}</span><span class="vault-row-action">${undo}</span></div>`
  }).join("")
}

const renderTable = (items) => {
  let body = ""
  let tableClass = "inventory"
  let headers = [COPY.name, COPY.size, COPY.status]
  if (state.view === "duplicates") {
    tableClass = "matches"
    headers = [COPY.name, COPY.size, COPY.matches, COPY.can_save, ""]
    body = items.length ? renderDuplicateGroups(items) : emptyState("duplicates")
  } else if (state.view === "reclaimable") {
    tableClass = "reclaimable"
    headers = [COPY.name, COPY.size, COPY.can_free, ""]
    body = renderReclaimable(items)
  } else if (state.view === "activity") {
    tableClass = "activity"
    headers = [COPY.name, COPY.size, COPY.last_scanned, ""]
    body = renderActivity(items)
  } else if (state.displayMode === "files" && supportsDisplayMode()) {
    tableClass = "flat"
    headers = [COPY.name, COPY.location_column, COPY.size, COPY.status]
    body = items.length ? renderFlatFiles(items) : emptyState(state.view)
  } else {
    body = items.length ? (state.sourceId ? renderTree(items) : renderInventoryGroups(items)) : emptyState(state.view)
  }
  const sortableSize = tableClass === "flat" || state.view === "duplicates" || state.view === "reclaimable"
  const sizeSortLabel = state.sizeSort === "desc" ? COPY.sort_smallest : COPY.sort_largest
  const sizeSortIcon = state.sizeSort === "desc" ? "fa-arrow-down-wide-short" : state.sizeSort === "asc" ? "fa-arrow-up-short-wide" : "fa-sort"
  const headerMarkup = headers.map((header) => header === COPY.size && sortableSize
    ? `<span class="vault-sort-column" role="columnheader" aria-sort="${state.sizeSort === "desc" ? "descending" : state.sizeSort === "asc" ? "ascending" : "none"}"><button class="vault-sort-button ${state.sizeSort ? "active" : ""}" type="button" data-sort-size aria-label="${attr(sizeSortLabel)}">${esc(header)}<i class="fa-solid ${sizeSortIcon}" aria-hidden="true"></i></button></span>`
    : `<span>${esc(header)}</span>`).join("")
  el("vault-table-wrap").innerHTML = `<div class="vault-table ${tableClass}"><div class="vault-columns">${headerMarkup}</div>${body}</div>`
}

const orderedItems = (items) => {
  if (state.view === "activity") return items
  if (state.view === "reclaimable") {
    return [...items].sort((a, b) => compareRows(a, b,
      (blob) => blob.names[0] ? blob.names[0].path : blob.hash))
  }
  if (state.displayMode === "files" && supportsDisplayMode()) {
    return [...items].sort((a, b) => compareRows(a, b, flatLocation))
  }
  return [...items].sort((a, b) => {
    const sourceOrder = state.sourceId ? 0 : sourceSort([a.source_id], [b.source_id])
    return sourceOrder || compareRows(a, b, (item) => item.relative_path || item.path)
  })
}

const pagedItems = (items) => {
  const inventory = state.data.inventory
  state.page = Number(inventory.page) || 0
  return {
    items: orderedItems(items),
    start: Number(inventory.start) || 0,
    end: Number(inventory.end) || 0,
    total: Number(inventory.total) || 0,
    pages: Math.max(1, Number(inventory.pages) || 1)
  }
}

const paneFooterText = () => {
  if (state.displayMode === "files" && supportsDisplayMode()) {
    const itemCount = Number(state.data.inventory.current && state.data.inventory.current.count) || 0
    const count = state.view === "shared"
      ? countLabel(itemCount, "deduplicated file", "deduplicated files")
      : state.view === "independent"
        ? countLabel(itemCount, "file kept separate", "files kept separate")
        : countLabel(itemCount)
    const order = state.sizeSort === "desc"
      ? COPY.sorted_largest
      : state.sizeSort === "asc" ? COPY.sorted_smallest : ""
    return `${count}${order ? ` · ${order}` : ""}`
  }
  if (state.view === "duplicates") return COPY.duplicate_note
  if (state.view === "reclaimable") return COPY.reclaimable_note
  if (state.view === "activity") return COPY.activity_note
  const minimumSize = candidateSize()
  const omittedUniqueFiles = Math.max(0,
    Number(state.data && state.data.last_scan && state.data.last_scan.unindexed_unique_files) || 0)
  if (minimumSize === 0 && omittedUniqueFiles) {
    return COPY.tracked_note_large_scan.replace("{count}", String(omittedUniqueFiles))
  }
  return minimumSize === 0
    ? COPY.tracked_note_all
    : COPY.tracked_note.replace("{size}", fmt(minimumSize))
}

const renderPaneFooter = (page) => {
  const footer = el("vault-pane-footer")
  const message = paneFooterText()
  if (page.pages === 1) {
    footer.textContent = message
    return
  }
  footer.innerHTML = `<span>${esc(message)}</span>
    <span class="vault-pagination" role="navigation" aria-label="${attr(COPY.file_pages)}">
      <button class="vault-text-button" type="button" data-page="previous" ${state.page === 0 ? "disabled" : ""}>${esc(COPY.previous)}</button>
      <span class="vault-page-range">${page.start + 1}–${page.end} of ${page.total}</span>
      <button class="vault-text-button" type="button" data-page="next" ${state.page === page.pages - 1 ? "disabled" : ""}>${esc(COPY.next)}</button>
    </span>`
}

const renderOverview = () => {
  const data = state.data
  const last = data.last_scan
  const activeScan = scanActive(data.scan)
  const repairing = !!(
    (state.actionProgress && state.actionProgress.kind === "repair") ||
    (data.repair && (data.repair.active || data.repair.phase === "queued"))
  )
  const repairRequired = !!(data.repair && data.repair.required)
  const scanning = scanMatchesContext(data.scan)
  const busyElsewhere = activeScan && !scanning
  const metrics = el("vault-metrics")
  metrics.classList.add("summary")
  {
    const beforeBytes = IS_APP_MODE
      ? Math.max(0, Number(last && last.bytes_total) || 0)
      : Math.max(0, Number(data.bytes_without_sharing) || 0)
    const afterBytes = IS_APP_MODE
      ? Math.max(0, Number(data.effective_bytes) || 0)
      : Math.max(0, Number(data.bytes_on_disk) || 0)
    const hasComparison = IS_APP_MODE
      ? !!(last && Number.isFinite(last.bytes_total) && Number.isFinite(data.effective_bytes))
      : Number.isFinite(data.bytes_without_sharing) &&
        Number.isFinite(data.bytes_on_disk) &&
        (!!last || beforeBytes > 0 || afterBytes > 0 || Number(data.pending_bytes) > 0)
    const afterRatio = beforeBytes ? Math.min(100, (afterBytes / beforeBytes) * 100) : 0
    const pendingBytes = Math.max(0, Number(data.pending_bytes) || 0)
    const freedBytes = Math.max(0, Number(data.lifetime_bytes_saved) || 0)
    const sharedNow = Math.max(0, Number(data.saved_by_sharing) || 0)
    const headline = hasComparison
      ? (IS_APP_MODE
          ? COPY.saved_for_app.replace("{size}", fmt(Math.max(0, beforeBytes - afterBytes)))
          : `${fmt(sharedNow)} ${COPY.disk_space_saved}`)
      : (IS_APP_MODE ? COPY.find_app_savings : COPY.find_savings)
    const help = IS_APP_MODE ? COPY.effective_help : COPY.before_help
    const helpId = IS_APP_MODE ? "vault-after-help" : "vault-before-help"
    const helpMarkup = `<span class="vault-compare-info" tabindex="0" aria-describedby="${helpId}"><i class="fa-regular fa-circle-question" aria-hidden="true"></i><span class="vault-compare-tooltip" id="${helpId}" role="tooltip">${esc(help)}</span></span>`
    const comparison = hasComparison ? `
      <div class="vault-comparison" aria-label="${attr(`${COPY.before}: ${fmt(beforeBytes)}. ${COPY.after}: ${fmt(afterBytes)}.`)}">
        <div class="vault-compare-row">
          <span class="vault-compare-label">${esc(COPY.before)}${IS_APP_MODE ? "" : helpMarkup}</span>
          <span class="vault-compare-track"><span class="vault-compare-fill before"></span></span>
          <span class="vault-compare-value">${fmt(beforeBytes)}</span>
        </div>
        <div class="vault-compare-row">
          <span class="vault-compare-label">${esc(COPY.after)}${IS_APP_MODE ? helpMarkup : ""}</span>
          <span class="vault-compare-track"><span class="vault-compare-fill after" style="--vault-after-ratio:${afterRatio.toFixed(2)}%"></span></span>
          <span class="vault-compare-value">${fmt(afterBytes)}</span>
        </div>
      </div>` : ""
    const opportunity = activeScan
      ? `<span class="vault-summary-state"><i class="fa-solid fa-circle-notch fa-spin"></i>${esc(COPY.scanning)}</span>`
      : pendingBytes
        ? `<span class="vault-summary-state attention"><i class="fa-regular fa-copy"></i><strong>${esc(COPY.more_can_be_saved.replace("{size}", fmt(pendingBytes)))}</strong></span>${state.view === "duplicates" ? "" : `<button class="vault-button${state.view === "independent" ? "" : " primary"}" type="button" id="btn-review-metric">${esc(COPY.review_files)}</button>`}`
        : `<span class="vault-summary-state"><i class="fa-regular fa-circle-check"></i>${esc(COPY.nothing_more_to_save)}</span>`
    const freshness = last ? `${COPY.scanned} ${timeAgo(last.ts)}` : COPY.not_scanned
    metrics.innerHTML = `
      <div class="vault-summary-main">
        <div class="vault-summary-label"><i class="fa-solid fa-hard-drive"></i>${esc(COPY.save_space)}</div>
        <div class="vault-summary-value">${esc(headline)}</div>
        ${comparison}
      </div>
      <div class="vault-summary-side">${opportunity}<span class="vault-summary-divider" aria-hidden="true"></span><span class="vault-summary-freshness">${esc(freshness)}</span></div>`
    const storageDetails = !IS_APP_MODE && el("vault-storage-details")
    if (storageDetails) {
      const homeBytes = last ? (last.home_bytes_total == null ? last.bytes_total : last.home_bytes_total) : null
      // Clamped because deleting linked files later shrinks the live sharing
      // total without touching the lifetime counter.
      const alreadyShared = Math.max(0, sharedNow - freedBytes)
      storageDetails.innerHTML = `<div class="vault-advanced-title">${esc(COPY.storage_details)}</div>
        <dl class="vault-storage-list">
          <div><dt>${esc(COPY.pinokio_folder)}</dt><dd>${homeBytes == null ? "—" : fmt(homeBytes)}</dd></div>
          <div><dt>${esc(COPY.kept_deduplicated)}</dt><dd>${fmt(sharedNow)}</dd></div>
          <div><dt>${esc(COPY.already_shared)}</dt><dd>${fmt(alreadyShared)}</dd></div>
        </dl>`
    }
  }
  el("btn-scan").innerHTML = activeScan
    ? `<i class="fa-solid fa-circle-notch fa-spin"></i>${esc(COPY.scanning)}`
    : `<i class="fa-solid fa-rotate"></i>${esc(last ? COPY.scan_again : (IS_APP_MODE ? COPY.scan_app : COPY.scan))}`
  el("btn-scan").disabled = activeScan || repairing || repairRequired
  el("vault-candidate-size").disabled = activeScan || repairing || repairRequired
  const optionsButton = el("btn-vault-options")
  const repairOptions = el("vault-advanced")
  const repairTitle = el("vault-repair-title")
  const repairDescription = el("vault-repair-description")
  const repairButton = el("btn-repair")
  if (optionsButton) optionsButton.setAttribute("aria-label", COPY.vault_options)
  if (repairOptions && repairRequired) repairOptions.open = true
  if (repairTitle) repairTitle.textContent = COPY.repair_index
  if (repairDescription) {
    repairDescription.textContent = repairRequired
      ? COPY.repair_required_description
      : COPY.repair_description
  }
  if (repairButton) {
    repairButton.textContent = repairing ? COPY.repairing : COPY.repair_action
    repairButton.disabled = activeScan || repairing
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
    const reconciling = scanPhase === "reconciling"
    const hashTotal = scan.hash_total || 0
    const hashDone = Math.min(Math.max(0, hashTotal - (scan.queued || 0)), hashTotal)
    const currentFileSize = Math.max(0, Number(scan.current_file_size) || 0)
    const currentFileBytes = Math.min(currentFileSize, Math.max(0, Number(scan.current_file_bytes) || 0))
    const currentFileRatio = currentFileSize ? currentFileBytes / currentFileSize : 0
    const hashRatio = hashTotal ? Math.min(1, (hashDone + currentFileRatio) / hashTotal) : 1
    const scanSource = scan.scope_id ? sourceById(scan.scope_id) : null
    const scanProgressLabel = scanSource
      ? COPY.scan_location.replace("{location}", scanSource.label)
      : COPY.scan_progress
    const phase = queued ? COPY.scan_queued : counting ? COPY.scan_counting : walking ? scanProgressLabel : reconciling ? COPY.scan_finishing : COPY.scan_analyzing
    const totalFiles = Number.isFinite(scan.total_files) ? scan.total_files : null
    const details = counting
      ? [`${scan.counted_dirs || 0} ${COPY.scan_folders_found}`, `${scan.counted_files || 0} ${COPY.scan_files_found}`]
      : [`${scan.dirs || 0} ${COPY.scan_folders}`, totalFiles === null
          ? `${scan.files || 0} ${COPY.scan_files}`
          : COPY.scan_files_checked.replace("{done}", scan.files || 0).replace("{total}", totalFiles), fmt(scan.bytes_total || 0)]
    if (scan.current_file) {
      const fileProgress = currentFileSize
        ? ` (${COPY.scan_file_bytes.replace("{done}", fmt(currentFileBytes)).replace("{total}", fmt(currentFileSize))})`
        : ""
      details.push(`${COPY.analyzing} ${scan.current_file}${fileProgress}`)
    }
    if (walking && scan.queued > 1) details.push(`${scan.queued} ${COPY.waiting}`)
    if (!walking && hashTotal) {
      details.push(COPY.scan_checked.replace("{done}", hashDone).replace("{total}", hashTotal))
    }
    let percent = ""
    let progress
    if (queued || counting || reconciling || (walking && totalFiles === null)) {
      const progressHelp = reconciling
        ? COPY.scan_finishing_help
        : counting ? COPY.scan_counting_help : phase
      const ariaText = `${details.join(" · ")}. ${progressHelp}.`
      progress = { determinate: false, ariaText }
    } else {
      const progressRatio = walking
        ? (totalFiles ? Math.min(1, (scan.files || 0) / totalFiles) : 1)
        : hashRatio
      const boundedProgress = Math.max(0, Math.min(1, progressRatio))
      const progressValue = Math.round(boundedProgress * 1000) / 10
      const progressHelp = walking ? COPY.scan_file_progress_help : COPY.scan_hash_progress_help
      const progressText = COPY.exact_percent.replace("{percent}", progressValue)
      percent = `${progressValue}%`
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
  const review = info.count && state.view !== "duplicates"
    ? `<button class="vault-button${state.view === "independent" ? "" : " primary"}" type="button" id="btn-review-result">${esc(COPY.review)} ${duplicateLabel}<i class="fa-solid fa-chevron-right"></i></button>`
    : ""
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
const fileActionButtons = () => document.querySelectorAll("#btn-repair, [data-deduplicate-all], [data-deduplicate-scope], [data-deduplicate-file], [data-detach]")
const fileActionLabel = (action) => ({
  "deduplicate-file": COPY.deduplicating_file,
  "keep-separate": COPY.keeping_separate,
  "make-separate": COPY.making_separate
}[action.kind] || COPY.deduplicating)
const serverFileAction = (action) => {
  if (!action || typeof action !== "object") return null
  if (action.kind === "deduplicate") {
    return {
      kind: action.kind,
      scope_id: action.scope_id || null,
      selection: action.selection || null,
      files_completed: Math.max(0, Number(action.files_completed) || 0),
      files_total: Math.max(0, Number(action.files_total) || 0)
    }
  }
  if (action.kind === "repair") {
    return {
      kind: "repair",
      phase: action.phase || "queued",
      directories_checked: Math.max(0, Number(action.directories_checked) || 0),
      files_checked: Math.max(0, Number(action.files_checked) || 0),
      records_checked: Math.max(0, Number(action.records_checked) || 0),
      current_location: action.current_location || null,
      cancel_requested: !!action.cancel_requested
    }
  }
  if (!action.path) return null
  return { kind: action.kind, path: action.path }
}
const activeRepairAction = (repair) => repair &&
  (repair.active || repair.phase === "queued")
  ? serverFileAction(Object.assign({ kind: "repair" }, repair))
  : null
let renderedActionProgress = null
const renderActionProgress = () => {
  const container = el("vault-action-state")
  if (!container) return
  const action = state.actionProgress
  for (const button of fileActionButtons()) {
    const active = !!(action && (
      (action.kind === "deduplicate" && (
        button.dataset.deduplicateScope === action.scope_id ||
        (button.dataset.deduplicateAll === action.selection &&
          (button.dataset.deduplicateContext || null) === action.scope_id)
      )) ||
      (action.kind === "deduplicate-file" && button.dataset.deduplicateFile === action.path) ||
      ((action.kind === "keep-separate" || action.kind === "make-separate") &&
        button.dataset.detach === action.path) ||
      (action.kind === "repair" && button.id === "btn-repair")
    ))
    button.disabled = !!action
    if (active) button.setAttribute("aria-busy", "true")
    else button.removeAttribute("aria-busy")
  }
  if (!action) {
    container.className = "vault-action-state"
    if (renderedActionProgress) {
      container.innerHTML = ""
      renderedActionProgress = null
    }
    return
  }
  container.className = "vault-action-state show"
  if (renderedActionProgress === action) return
  let label
  let detail
  let progress
  if (action.kind === "deduplicate") {
    const completed = Math.max(0, Number(action.files_completed) || 0)
    const total = Math.max(completed, Number(action.files_total) || 0)
    const ratio = total ? Math.min(1, completed / total) : 0
    label = COPY.deduplicating
    detail = COPY.deduplication_progress
      .replace("{done}", completed)
      .replace("{total}", total)
    progress = `<span class="vault-progress-track" role="progressbar" aria-label="${attr(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}"><span class="vault-progress-bar determinate" style="--vault-progress:${ratio}"></span></span>`
  } else if (action.kind === "repair") {
    label = COPY.repairing
    detail = COPY.repair_progress
      .replace("{folders}", action.directories_checked)
      .replace("{files}", action.files_checked)
      .replace("{records}", action.records_checked)
    if (action.current_location) detail += ` · ${basename(action.current_location)}`
    progress = `<span class="vault-progress-track" role="progressbar" aria-label="${attr(label)}" aria-valuetext="${attr(detail)}"><span class="vault-progress-bar indeterminate"></span></span>`
  } else {
    label = fileActionLabel(action)
    detail = basename(action.path)
    progress = `<span class="vault-progress-track" role="progressbar" aria-label="${attr(label)}" aria-valuetext="${attr(`${label}: ${detail}`)}"><span class="vault-progress-bar indeterminate"></span></span>`
  }
  const cancel = action.kind === "repair"
    ? `<button class="vault-button" type="button" data-cancel-repair${action.cancel_requested ? " disabled" : ""}>${esc(action.cancel_requested ? COPY.cancelling : COPY.cancel)}</button>`
    : ""
  container.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><strong>${esc(label)}</strong><span class="vault-action-detail">${esc(detail)}</span>${cancel}${progress}`
  renderedActionProgress = action
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

const renderCleanupNotice = () => {
  const notice = el("vault-cleanup-notice")
  const unusedCount = !IS_APP_MODE && state.data && state.data.enabled
    ? Number(state.data.inventory.counts.reclaimable) || 0
    : 0
  if (!unusedCount || state.view === "reclaimable") {
    notice.className = "vault-cleanup-notice"
    notice.innerHTML = ""
    return
  }
  const bytes = Number(state.data.reclaimable) || 0
  const title = COPY.cleanup_ready.replace("{size}", fmt(bytes))
  const detail = COPY.cleanup_ready_detail.replace(
    "{count}",
    countLabel(unusedCount, COPY.private_link, COPY.private_links)
  )
  notice.className = "vault-cleanup-notice show"
  notice.innerHTML = `<i class="fa-solid fa-broom" aria-hidden="true"></i><strong>${esc(title)}</strong><span class="vault-cleanup-notice-detail">${esc(detail)}</span><button class="vault-button" id="btn-review-cleanup" type="button">${esc(COPY.review_cleanup)}<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`
}

const render = () => {
  if (!state.data) return
  renderOverview()
  renderResult()
  renderFeedback()
  renderCloudWarning()
  renderCleanupNotice()
  if (!state.data.enabled) {
    el("vault-explorer").style.display = "none"
    return
  }
  el("vault-explorer").style.display = ""
  const items = buildItems()
  renderViews()
  renderLocations()
  renderToolbar()
  const page = pagedItems(items)
  renderTable(page.items)
  renderActionProgress()
  renderPaneFooter(page)
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
  const shareableDuplicateCount = Number(data.inventory.shareable_duplicates) || 0
  const unreviewed = !scanning && data.last_scan &&
    reviewedScan() !== String(data.last_scan.ts) &&
    (shareableDuplicateCount > 0 || data.last_scan.hash_failures > 0)
  state.data = data
  const fileAction = activeRepairAction(data.repair) || serverFileAction(data.file_action)
  if (fileAction) state.actionProgress = fileAction
  else if (!state.actionRequest) state.actionProgress = null
  const repair = data.repair
  if (repair && repair.required && !state.feedback) {
    state.feedback = { error: true, message: COPY.repair_required }
  }
  if (state.repairRequested && repair &&
      (repair.phase === "complete" || repair.phase === "cancelled" || repair.phase === "failed")) {
    state.repairRequested = false
    if (repair.phase === "failed") {
      state.feedback = { error: true, message: repair.error || COPY.repair_failed }
    } else if (repair.phase === "cancelled") {
      state.feedback = { error: false, message: COPY.repair_cancelled }
    } else {
      state.feedback = {
        error: !!repair.persistence_warning,
        message: repair.persistence_warning
          ? `${COPY.repair_done}. ${COPY.persistence_write_failed}`
          : COPY.repair_done
      }
    }
  }
  if (failed) {
    state.scanRequested = false
    state.feedback = { error: true, message: data.scan.error }
  } else if (completed || incomplete || (!state.scanResult && unreviewed)) {
    state.scanRequested = false
    state.scanResult = {
      count: Number(data.inventory.shareable_duplicates) || 0,
      locations: Number(data.inventory.duplicate_locations) || 0,
      bytes: Number(data.pending_bytes) || 0,
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
  return scanning || !!fileAction
}
let refreshSequence = 0
const refresh = async (forceFull = false) => {
  const sequence = ++refreshSequence
  let delay = null
  try {
    const progressOnly = !forceFull &&
      !!(state.data && (scanActive(state.data.scan) || state.actionProgress))
    if (progressOnly) {
      const progress = await fetchJson(statusUrl(true))
      if (sequence !== refreshSequence) return
      state.data.scan = progress.scan
      state.data.repair = progress.repair
      state.data.last_scan = progress.last_scan
      const fileAction = activeRepairAction(progress.repair) ||
        serverFileAction(progress.file_action)
      if (fileAction) state.actionProgress = fileAction
      else if (!state.actionRequest) state.actionProgress = null
      if (scanActive(progress.scan) || fileAction) {
        delay = 1500
        renderOverview()
        renderActionProgress()
        renderFeedback()
      } else {
        const data = await fetchJson(statusUrl())
        if (sequence !== refreshSequence) return
        if (applyFullData(data) || state.scanRequested) delay = 1500
      }
    } else {
      const data = await fetchJson(statusUrl())
      if (sequence !== refreshSequence) return
      if (applyFullData(data) || state.scanRequested) delay = 1500
    }
  } catch (error) {
    if (sequence !== refreshSequence) return
    state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
    renderFeedback()
    delay = 5000
  } finally {
    if (sequence !== refreshSequence) return
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
  await refresh(true)
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

const deduplicateKeptFeedback = (result) => {
  const unchanged = (result.locked || 0) + (result.stale || 0) + (result.unmatched || 0) +
    (result.incompatible || 0) + (result.unavailable || 0) + (result.failed || 0)
  const messages = []
  if (result.converted || result.bytes_saved) messages.push(`${COPY.converted}: ${fmt(result.bytes_saved || 0)}.`)
  if (unchanged) messages.push(`${COPY.files_left_separate.replace("{count}", countLabel(unchanged))}.`)
  if (!unchanged) return messages.join(" ") || `${COPY.converted}: ${fmt(0)}`
  return { error: true, message: messages.join(" ") }
}

const deduplicateFileFeedback = (result) => {
  if (result.status === "converted" || result.status === "already") {
    return result.bytes_saved ? `${COPY.converted}: ${fmt(result.bytes_saved)}.` : COPY.converted
  }
  const messages = {
    locked: COPY.deduplicate_locked,
    stale: COPY.deduplicate_changed,
    "no-match": COPY.deduplicate_no_match,
    "no-blob": COPY.deduplicate_no_match,
    "stale-blob": COPY.deduplicate_no_match,
    "size-mismatch": COPY.deduplicate_no_match,
    "metadata-mismatch": COPY.permissions_differ,
    unavailable: COPY.sharing_unavailable,
    conflict: COPY.separate_conflict,
    "not-found": COPY.separate_not_found
  }
  return { error: true, message: messages[result.status] || COPY.action_not_completed }
}

const showDeduplicationProgress = (scopeId, selection, progress, fallbackTotal) => {
  const completed = Math.max(0, Number(progress.files_completed) || 0)
  const total = Math.max(completed, Number(progress.files_total) || fallbackTotal)
  const current = state.actionProgress
  if (current &&
      current.kind === "deduplicate" &&
      current.scope_id === scopeId &&
      current.selection === selection &&
      current.files_completed === completed &&
      current.files_total === total) return
  state.actionProgress = {
    kind: "deduplicate",
    scope_id: scopeId,
    selection,
    files_completed: completed,
    files_total: total
  }
  renderActionProgress()
}

const trackDeduplication = (scopeId, selection = "duplicates", total = null) => {
  const fallbackTotal = total === null
    ? scopeDuplicateCount(scopeId, true)
    : total
  let stopped = false
  let timer = null
  showDeduplicationProgress(scopeId, selection, { files_completed: 0, files_total: fallbackTotal }, fallbackTotal)
  const poll = async () => {
    try {
      const status = await fetchJson(statusUrl(true))
      const action = serverFileAction(status.file_action)
      if (!stopped && action && action.kind === "deduplicate" &&
          action.scope_id === scopeId && action.selection === selection) {
        showDeduplicationProgress(scopeId, selection, action, fallbackTotal)
      }
    } catch (error) {}
    if (!stopped) timer = setTimeout(poll, 250)
  }
  poll()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (state.actionProgress &&
        state.actionProgress.kind === "deduplicate" &&
        state.actionProgress.scope_id === scopeId &&
        state.actionProgress.selection === selection) {
      state.actionProgress = null
    }
    renderActionProgress()
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
  if (state.actionProgress && (target.dataset.deduplicateAll || target.dataset.deduplicateScope || target.dataset.deduplicateFile || target.dataset.detach)) return
  if (target.id === "btn-dismiss-cloud") {
    try { localStorage.setItem(target.dataset.warningKey, "1") } catch (error) {}
    renderCloudWarning()
  } else if (target.dataset.page) {
    state.page += target.dataset.page === "next" ? 1 : -1
    await refresh(true)
    el("vault-table-wrap").scrollTop = 0
  } else if (target.hasAttribute("data-sort-size")) {
    state.sizeSort = state.sizeSort === "desc" ? "asc" : "desc"
    state.page = 0
    await refresh(true)
  } else if (target.dataset.displayMode) {
    state.displayMode = target.dataset.displayMode === "files" ? "files" : "folders"
    state.sizeSort = state.displayMode === "files" ? "desc" : null
    state.page = 0
    await refresh(true)
  } else if (target.dataset.view || target.id === "btn-review-cleanup") {
    state.view = target.dataset.view || "reclaimable"
    state.sourceId = SCOPE_ID
    state.query = ""
    state.statusFilter = "all"
    state.displayMode = state.view === "shared" ? "files" : "folders"
    state.sizeSort = state.view === "shared" ? "desc" : null
    if (state.view === "duplicates") {
      markScanReviewed()
      state.scanResult = null
    }
    state.page = 0
    await refresh(true)
  } else if (target.dataset.source) {
    state.sourceId = IS_APP_MODE
      ? SCOPE_ID
      : (state.sourceId === target.dataset.source ? null : target.dataset.source)
    state.page = 0
    await refresh(true)
  } else if (target.dataset.toggleSource) {
    const id = target.dataset.toggleSource
    if (state.collapsedSources.has(id)) state.collapsedSources.delete(id)
    else state.collapsedSources.add(id)
    renderLocations()
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
  } else if (target.dataset.removeSource) {
    const source = sourceById(target.dataset.removeSource)
    if (!source) return
    const message = COPY.remove_external_confirm.replace("{name}", source.label)
    if (!window.confirm(message)) return
    await runAction({
      action: "remove_source",
      source_id: source.id
    }, () => {
      state.sourceId = null
      return COPY.external_removed
    })
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
        state.displayMode = "folders"
        state.sizeSort = null
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
      const result = await post({
        action: "scan",
        scope_id: SCOPE_ID,
        candidate_size: candidateSize()
      })
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
  } else if (target.dataset.cancelRepair !== undefined) {
    target.disabled = true
    target.textContent = COPY.cancelling
    state.repairRequested = true
    try {
      const result = await post({ action: "cancel_repair" })
      if (!result.cancel_requested) throw new Error(COPY.action_not_completed)
      if (state.actionProgress && state.actionProgress.kind === "repair") {
        state.actionProgress = Object.assign({}, state.actionProgress, {
          cancel_requested: true
        })
      }
      renderActionProgress()
      await refresh()
    } catch (error) {
      state.repairRequested = false
      state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
      renderFeedback()
    }
  } else if (target.id === "btn-repair") {
    state.repairRequested = true
    state.feedback = null
    try {
      const result = await post({ action: "repair" })
      if (result.error) throw new Error(result.error)
      if (!result.started && !result.already_running) throw new Error(COPY.action_not_completed)
      if (result.repair) state.data.repair = result.repair
      state.actionProgress = activeRepairAction(result.repair)
      if (advanced) advanced.open = false
      render()
      await refresh(!state.actionProgress)
    } catch (error) {
      state.repairRequested = false
      state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
      renderFeedback()
    }
  } else if (target.id === "btn-review-result" || target.id === "btn-review-metric") {
    if (!state.scanResult || !state.scanResult.incomplete) markScanReviewed()
    state.view = "duplicates"
    state.displayMode = "folders"
    state.sizeSort = null
    state.sourceId = SCOPE_ID
    state.query = ""
    state.scanResult = null
    state.page = 0
    await refresh(true)
  } else if (target.dataset.deduplicateAll) {
    const selection = target.dataset.deduplicateAll
    const scopeId = target.dataset.deduplicateContext || null
    const total = bulkDeduplicationCount(selection)
    const stopTracking = trackDeduplication(scopeId, selection, total)
    state.actionRequest = true
    try {
      await runAction(
        { action: "deduplicate", selection, scope_id: scopeId },
        selection === "kept-separate" ? deduplicateKeptFeedback : deduplicateFeedback
      )
    } finally {
      state.actionRequest = false
      stopTracking()
    }
  } else if (target.dataset.deduplicateScope) {
    const scopeId = target.dataset.deduplicateScope
    const stopTracking = trackDeduplication(scopeId)
    state.actionRequest = true
    try {
      await runAction({ action: "deduplicate", scope_id: scopeId }, deduplicateFeedback)
    } finally {
      state.actionRequest = false
      stopTracking()
    }
  } else if (target.dataset.deduplicateFile) {
    const filePath = target.dataset.deduplicateFile
    state.actionProgress = {
      kind: "deduplicate-file",
      path: filePath
    }
    state.actionRequest = true
    renderActionProgress()
    try {
      await runAction({ action: "deduplicate", path: filePath }, deduplicateFileFeedback)
    } finally {
      state.actionRequest = false
      if (state.actionProgress &&
          state.actionProgress.kind === "deduplicate-file" &&
          state.actionProgress.path === filePath) {
        state.actionProgress = null
      }
      renderActionProgress()
    }
  } else if (target.dataset.detach) {
    const filePath = target.dataset.detach
    state.actionProgress = {
      kind: target.dataset.detachKind === "keep"
        ? "keep-separate"
        : "make-separate",
      path: filePath
    }
    state.actionRequest = true
    renderActionProgress()
    try {
      await runAction({ action: "detach", path: filePath }, detachFeedback)
    } finally {
      state.actionRequest = false
      if (state.actionProgress &&
          state.actionProgress.path === filePath) {
        state.actionProgress = null
      }
      renderActionProgress()
    }
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
  state.page = 0
  clearTimeout(window.__vaultSearchRefresh)
  window.__vaultSearchRefresh = setTimeout(() => refresh(true), 250)
})
document.addEventListener("change", (event) => {
  if (event.target.id === "vault-candidate-size") {
    try { localStorage.setItem(candidateSizeKey, String(candidateSize())) } catch (error) {}
    render()
    return
  }
  if (event.target.id !== "vault-status-filter") return
  state.statusFilter = event.target.value
  state.page = 0
  refresh(true)
})

el("btn-scan").textContent = COPY.scan
const candidateSizeSelect = el("vault-candidate-size")
candidateSizeSelect.setAttribute("aria-label", COPY.minimum_file_size)
candidateSizeSelect.innerHTML = candidateSizeOptions
  .map((size) => `<option value="${size}">${size === 0 ? COPY.all : `${fmt(size)}+`}</option>`)
  .join("")
candidateSizeSelect.value = String(defaultCandidateSize)
try {
  const storedValue = localStorage.getItem(candidateSizeKey)
  if (storedValue !== null) {
    const storedCandidateSize = Number(storedValue)
    if (candidateSizeOptions.includes(storedCandidateSize)) {
      candidateSizeSelect.value = String(storedCandidateSize)
    }
  }
} catch (error) {}
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
