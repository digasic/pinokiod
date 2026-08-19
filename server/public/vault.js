const COPY = {
  views: "VIEWS",
  locations: "LOCATIONS",
  all: "All files",
  duplicates: "Duplicates",
  cannot_deduplicate: "Cannot deduplicate",
  shared: "Deduplicated",
  reclaimable: "Trash",
  activity: "Activity",
  all_description: "Every scanned file and its current deduplication status.",
  duplicates_description: "Identical files waiting to be deduplicated.",
  unavailable_description: "Identical files that cannot share storage.",
  shared_description: "Files currently sharing disk storage through hardlinks.",
  tracked_description: "Files with no duplicate action required.",
  reclaimable_description: "Spare copies no file is using.",
  activity_description: "A history of changes made by Disk Saver.",
  add_external_folder: "Add external folder",
  find_folders: "Find more savings",
  find_folders_title: "Find more savings",
  suggested_locations: "Suggested locations",
  search_home_folder: "Home folder",
  choose_another_folder: "Another folder…",
  choose_another_folder_hint: "Choose a folder or drive",
  find_folders_picker: "Choose where to search",
  home_folder_unavailable: "The home folder is unavailable.",
  find_already_running: "Another folder search is already running.",
  find_requires_scan: "Run a global scan before searching for more savings.",
  find_minimum_size_help: "Search files this size and larger",
  find_wait_for_scan: "Wait for the current scan to finish.",
  find_waiting: "Waiting to search",
  find_searching: "Searching folders",
  find_verifying: "Verifying identical files",
  find_preparing: "Preparing results",
  find_stage_searching: "Searching",
  find_stage_verifying: "Verifying",
  find_stage_suggestions: "Suggestions",
  find_stages: "Folder search stages",
  find_files_checked: "files checked",
  find_folders_checked: "{count} folders checked",
  find_candidate: "1 possible match queued for verification",
  find_candidates: "{count} possible matches queued for verification",
  find_current_folder: "Currently scanning",
  find_current_file: "Currently verifying",
  find_active: "Active now",
  find_rate: "{count} files/sec",
  find_stalled: "No activity for {time}",
  find_elapsed: "{time} elapsed",
  find_verified_progress: "{done} of {total} candidates checked",
  find_verified_so_far: "{count} identical files · {size} matched so far",
  verified_identical_only: "Verified identical files only",
  matching_file: "1 identical file",
  matching_files: "{count} identical files",
  matching_bytes: "{size} matched",
  can_save_selection: "Can save {size}",
  calculating_savings: "Calculating savings…",
  choose_locations: "Choose folders to watch",
  choose_locations_hint: "Pinokio tracks these folders for duplicates. Nothing is scanned or changed until you run a scan.",
  scan_scope: "adds {size} to future scans",
  files_here_one: "1 file here",
  files_here: "{count} files here",
  selected_inside: "{count} selected inside",
  selected_location: "1 location selected",
  selected_locations: "{count} locations selected",
  add_selected_location: "Add location",
  add_selected_locations: "Add {count} locations",
  adding_locations: "Adding locations…",
  loading_folders: "Loading folders…",
  show_more_folders: "Show more folders",
  external_locations_added: "Added {count} folders to Locations.",
  search_somewhere_else: "Search somewhere else",
  done: "Done",
  no_matching_folders: "No folders with duplicate files found",
  no_matching_folders_partial: "No duplicate files found in folders that could be checked",
  no_matching_folders_hint: "Choose another folder or drive to search a different area.",
  find_partial: "Partial results · Some files could not be checked.",
  all_locations: "All locations",
  other_folders: "Other folders",
  files_region: "Files",
  folder_picker_error: "The folder picker could not be opened.",
  external_added: "Added to Locations.",
  external_exists: "That folder is already in Locations.",
  external_other_disk: "Added to Locations. It can be scanned, but this filesystem does not support file sharing.",
  remove_external_folder: "Remove from Locations",
  remove_external_confirm: "Remove “{name}” from Locations? This does not delete or modify any files.",
  external_removed: "Removed from Locations. No files were changed.",
  save_space: "Disk Saver",
  automatic: "Automatic",
  manual: "Manual",
  automatic_description: "Check after this app stops",
  manual_description: "Scan only when requested",
  storage_saved_headline: "{size} saved by deduplicating",
  storage_unique_headline: "{size} unique to this app",
  storage_still_used: "In use",
  storage_saved: "Saved",
  storage_unique: "Unique",
  storage_shared: "Shared",
  storage_can_save: "Can save",
  nothing_more_to_save: "Nothing else to save",
  more_can_be_saved: "{size} more can be saved",
  review_files: "Review files",
  scanned: "Scanned",
  not_scanned: "Not scanned yet",
  find_savings: "Scan to find duplicate files and save disk space",
  find_app_savings: "Scan this app to find duplicate files and save disk space",
  last_scanned: "Last scanned",
  never: "Never",
  scan: "Scan",
  scan_app: "Scan this app",
  setup_disk_saver: "Set up Disk Saver",
  setup_title: "Run an initial scan to enable app scans",
  setup_description: "This creates the file index used to compare apps.",
  setup_automatic_description: "It also enables automatic checks.",
  scan_again: "Scan again",
  cancel_scan: "Cancel scan",
  scanning: "Scanning…",
  minimum_file_size: "Minimum file size",
  scanning_elsewhere: "Another location is being scanned",
  scanning_elsewhere_hint: "This app can be scanned when the current scan finishes.",
  cancel: "Cancel",
  cancelling: "Cancelling…",
  scan_progress: "Discovering files",
  scan_location: "Discovering files in {location}",
  scan_queued: "Waiting to start scan",
  scan_analyzing: "Verifying duplicates",
  scan_finishing: "Finishing scan",
  scan_finishing_help: "File analysis is complete; the index is being updated",
  scan_step: "Step {current} of 3",
  scan_file_bytes: "{done} of {total}",
  scan_hash_progress: "{done} of {total} analyzed · {percent}%",
  scan_folders: "folders checked",
  scan_files: "files checked",
  analyzing: "verifying",
  scan_complete: "Scan complete",
  scan_cancelled: "Scan cancelled",
  scan_completed_with_exclusions: "Scan completed with exclusions",
  scan_unreadable_path: "file or path could not be analyzed",
  scan_unreadable_paths: "files or paths could not be analyzed",
  scan_partial_rest: "The rest of the scan completed.",
  scan_preview: "Duplicates found so far",
  scan_preview_detail: "{count} redundant copies verified · {size} can be saved so far. Provisional until the scan completes.",
  scan_preview_group: "{files} with identical contents · {size} can be saved",
  view_matches: "View matches",
  hide_matches: "Hide matches",
  partial_results: "Partial results",
  view_unreadable_path: "View affected path",
  view_unreadable_paths: "View affected paths",
  scan_not_analyzed: "could not be analyzed",
  found_in: "found in",
  locations_lower: "locations",
  can_be_saved: "can be saved",
  review: "Review",
  search_all: "Search files",
  search_duplicates: "Search duplicates",
  search_unavailable: "Search files that cannot be deduplicated",
  search_shared: "Search deduplicated files",
  search_tracked: "Search files with no action needed",
  search_activity: "Search activity",
  search_in: "Search in {location}",
  status_request_failed: "Couldn’t load Disk Saver status ({status})",
  action_request_failed: "The Disk Saver action failed ({status})",
  show_in_finder: "Show in Finder",
  show_in_file_explorer: "Show in File Explorer",
  open_containing_folder: "Open containing folder",
  reveal_failed: "The file manager could not open this file.",
  all_statuses: "All statuses",
  name: "Name",
  location_column: "Location",
  size: "Size",
  sort_largest: "Sort by size, largest first",
  sort_smallest: "Sort by size, smallest first",
  show_more: "Show more",
  sort_a_z: "Sort by name, A to Z",
  sort_z_a: "Sort by name, Z to A",
  folders: "Folders",
  files_mode: "Files",
  display_mode: "Display mode",
  sorted_largest: "sorted largest first",
  sorted_smallest: "sorted smallest first",
  sorted_a_z: "sorted A to Z",
  sorted_z_a: "sorted Z to A",
  previous: "Previous",
  next: "Next",
  file_pages: "File pages",
  status: "Deduplication status",
  matches: "Matches",
  copies: "Copies",
  size_each: "Size each",
  can_save: "Can save",
  can_free: "Can free",
  duplicate: "Duplicate",
  tracked: "No action needed",
  different_disk: "No Disk Saver storage is available on this disk",
  can_save_suffix: "available to save",
  unavailable: "Unavailable",
  sharing_unavailable: "Deduplication is unavailable on this disk",
  permissions_differ: "File permissions or ownership differ",
  hardlinks_unavailable: "This disk does not support shared files",
  anchor_conflict: "The stored matching copy could not be verified",
  permission_denied: "Disk Saver cannot modify this file or its folder",
  below_minimum_size: "This file is below the 10 MB safety minimum",
  cannot_share_safely: "This file cannot safely share storage",
  changed_since_scan: "Some files changed since the scan. Scan again before deduplicating them.",
  deduplicate_locked: "Stop the app before deduplicating this file.",
  deduplicate_changed: "This file changed while it was being checked. Nothing was changed.",
  deduplicate_no_match: "This file no longer matches a deduplicated file. Nothing was changed.",
  separate_locked: "Stop the app before separating this file.",
  separate_changed: "This file changed since it was scanned. Scan again, then try again.",
  separate_conflict: "A temporary file already exists next to this file. Nothing was changed.",
  separate_not_found: "This file is no longer tracked. Scan again to refresh this view.",
  separate_incomplete: "Some files could not be made separate. No existing files were overwritten.",
  action_not_completed: "The action could not be completed. No existing files were overwritten.",
  activity_write_failed: "The file action completed, but some activity history could not be recorded.",
  files_still_waiting: "{count} still waiting for review",
  files_cannot_deduplicate: "{count} cannot be deduplicated",
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
  deduplicate_all: "Deduplicate all {count}",
  deduplicate_selected_file: "Deduplicate selected file ({size})",
  deduplicate_selected_files: "Deduplicate {count} selected files ({size})",
  deduplicating: "Deduplicating files",
  deduplicating_file: "Deduplicating file",
  deduplication_progress: "{done} of {total} files",
  duplicate_selection_limit: "You can deduplicate up to 500 selected files at once.",
  select_for_deduplication: "Select to deduplicate",
  select_duplicate_group: "Select every eligible copy in this group",
  content_group: "content group",
  content_groups: "content groups",
  can_be_deduplicated: "can be deduplicated",
  reference_copy: "Reference copy",
  outside_results: "Outside current results",
  selected_copy: "Selected",
  loading_copies: "Loading copies…",
  show_more_copies: "Show {count} more copies",
  loading_locations: "Loading locations…",
  open_in_disk_saver: "Open this file in Disk Saver",
  open_location_confirm: "Open Disk Saver to review {location}?",
  open_location_accept: "Open",
  show_more_locations: "Show {count} more locations",
  making_separate: "Making file separate",
  make_separate: "Make separate",
  try_again: "Try again",
  reclaim: "Delete",
  reclaim_all: "Empty Trash",
  cleanup_ready: "{size} in the Trash",
  review_cleanup: "Open Trash",
  make_file_separate: "Make file separate",
  make_files_separate: "Make {count} files separate",
  making_separate_selected: "Making files separate",
  separate_progress: "{done} of {total} files",
  separate_selection_limit: "You can make up to 500 files separate at once.",
  page_files_selected: "All {count} deduplicated files on this page are selected.",
  select_all_matching: "Select all {count} matching deduplicated files",
  all_matching_selected: "All {count} matching deduplicated files are selected.",
  clear_selection: "Clear selection",
  separate_all_confirm: "Make {count} matching deduplicated files separate?\n\nThis may require up to {size} of additional disk space and may take a long time.",
  separation_cancelled: "Separation cancelled after {count}.",
  select_for_separation: "Select to make separate",
  select_all_on_page: "Select all on this page",
  stored_times: "Stored {count} times · {size} each",
  this_file: "this file",
  copy_that_stays: "the copy that stays",
  already_deduplicated: "already deduplicated",
  not_deduplicated_yet: "not deduplicated yet",
  cannot_be_deduplicated: "cannot be deduplicated",
  no_files: "No files found",
  no_files_hint: "Run a scan to find files that can be deduplicated. Scanning never links files together or replaces them.",
  scan_waiting: "Waiting for scan results",
  scan_waiting_hint: "Files will appear here when this scan finishes.",
  no_duplicates: "No duplicates to review",
  no_duplicates_hint: "There are no files waiting for your review.",
  no_unavailable: "Every duplicate can be deduplicated",
  no_unavailable_hint: "Files that cannot safely share storage will appear here.",
  no_shared: "Nothing deduplicated yet",
  no_shared_hint: "Deduplicated files will appear here after you review duplicates.",
  no_tracked: "No files with no action needed",
  no_tracked_hint: "Files without a duplicate action will appear here after a scan.",
  no_reclaimable: "Trash is empty",
  no_reclaimable_hint: "Spare copies Pinokio no longer needs appear here.",
  no_activity: "No activity yet",
  no_activity_hint: "Changes made by Disk Saver will appear here.",
  view_all: "View all files",
  tracked_note: "Only files {size} and larger appear here. Files keep their current locations.",
  tracked_note_all: "All non-empty files appear here. Files keep their current locations.",
  duplicate_note: "Only files waiting for review are shown.",
  activity_note: "Recent changes made by Disk Saver.",
  converted: "Deduplicated",
  separated: "Separated",
  reclaimed: "Cleaned up",
  event_convert: "Deduplicated",
  event_reclaim: "Emptied from Trash",
  event_detach: "Separated",
  event_change: "File state changed"
}

const SCOPE_ID = document.body.dataset.vaultScope || null
// A link from another location reveals the file where it lives: the same
// folder view the user was already reading, opened down to that file.
const REVEAL = (() => {
  const params = new URLSearchParams(window.location.search)
  const relative = String(params.get("reveal") || "").slice(0, 4096)
  if (!relative) return null
  return {
    relative,
    locationId: String(params.get("location") || "").slice(0, 200) || null
  }
})()
// A scoped page hands one content group off to the global page, which opens
// on it once its first page of duplicate results arrives.
const IS_APP_MODE = document.body.dataset.vaultMode === "app" && !!SCOPE_ID
const APP_NAME = IS_APP_MODE ? document.body.dataset.vaultApp || "" : ""
const HOME_PATH = document.body.dataset.vaultHome || ""
const MAX_BULK_DEDUPLICATE_FILES = 500
const MAX_BULK_SEPARATE_FILES = 500
const DUPLICATE_CHILD_PAGE_SIZE = 100
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
    if (state.nameSort === "desc") query.set("name_sort", "desc")
    // The server groups duplicates only for this view, but every view needs to
    // know the mode: the flat list matches the search against file names.
    if (state.displayMode === "files" && supportsDisplayMode()) {
      query.set("display_mode", "files")
    }
    query.set("page", String(state.page))
    const cursor = state.pageCursors[state.page]
    if (cursor) query.set("cursor", cursor)
    query.set("page_size", String(PAGE_SIZE))
    if (!IS_APP_MODE && state.folderDiscoveryOpen) {
      query.set("folder_discovery_page", String(state.folderDiscoveryPage))
    }
  }
  const suffix = query.toString()
  return `/info/dedup${suffix ? `?${suffix}` : ""}`
}
const folderDiscoveryChildrenUrl = (folder, page = 0) => {
  const query = new URLSearchParams({
    folder_discovery_parent: folder,
    folder_discovery_child_page: String(Math.max(0, Number(page) || 0))
  })
  return `/info/dedup?${query.toString()}`
}
const treeLevelUrl = (locationId, parent, cursor = null, directoryOffset = 0) => {
  const query = new URLSearchParams()
  if (SCOPE_ID) query.set("scope_id", SCOPE_ID)
  query.set("tree_parent", parent)
  if (locationId) query.set("location_id", locationId)
  query.set("view", state.view)
  if (state.statusFilter !== "all") query.set("status_filter", state.statusFilter)
  if (state.query) query.set("q", state.query)
  if (state.sizeSort) query.set("size_sort", state.sizeSort)
  if (state.nameSort === "desc") query.set("name_sort", "desc")
  if (cursor) query.set("cursor", cursor)
  if (directoryOffset) query.set("directory_offset", String(directoryOffset))
  query.set("page_size", String(PAGE_SIZE))
  return `/info/dedup?${query.toString()}`
}
const fileLocationsUrl = (filePath, options = {}) => {
  const query = new URLSearchParams()
  if (SCOPE_ID) query.set("scope_id", SCOPE_ID)
  query.set("locations_path", filePath)
  if (options.cursor) query.set("cursor", options.cursor)
  query.set("page_size", String(DUPLICATE_CHILD_PAGE_SIZE))
  return `/info/dedup?${query.toString()}`
}
const duplicateGroupUrl = (hash, options = {}) => {
  const query = new URLSearchParams()
  if (SCOPE_ID) query.set("scope_id", SCOPE_ID)
  query.set("group_hash", hash)
  if (state.sourceId) query.set("location_id", state.sourceId)
  if (state.query) query.set("q", state.query)
  if (options.select) {
    query.set("group_select", "1")
  } else {
    if (options.cursor) query.set("cursor", options.cursor)
    query.set("page_size", String(DUPLICATE_CHILD_PAGE_SIZE))
  }
  return `/info/dedup?${query.toString()}`
}
const duplicateGroupPageSelectionUrl = () => {
  const query = new URLSearchParams({
    group_page_select: "1",
    page_size: String(PAGE_SIZE)
  })
  if (SCOPE_ID) query.set("scope_id", SCOPE_ID)
  if (state.sourceId) query.set("location_id", state.sourceId)
  if (state.query) query.set("q", state.query)
  if (state.sizeSort) query.set("size_sort", state.sizeSort)
  const cursor = state.pageCursors[state.page]
  if (cursor) query.set("cursor", cursor)
  return `/info/dedup?${query.toString()}`
}
const reviewedScanKey = `pinokio:vault:reviewed-scan:${SCOPE_ID || "global"}`
const externalPromptKey = "pinokio:vault:external-prompt-dismissed"
const automaticScanFocusKey = APP_NAME
  ? `pinokio:vault:auto-scan-focus:${encodeURIComponent(APP_NAME)}`
  : null
const automaticScanCoachmarkSeenPrefix = APP_NAME
  ? `pinokio:vault:auto-scan-coachmark-seen:${encodeURIComponent(APP_NAME)}`
  : null
const consumeAutomaticScanFocusRequest = () => {
  if (!automaticScanFocusKey) return false
  try {
    const signature = sessionStorage.getItem(automaticScanFocusKey)
    if (signature !== null) sessionStorage.removeItem(automaticScanFocusKey)
    return signature || null
  } catch (error) {
    return null
  }
}
const automaticScanCoachmarkSeen = (signature) => {
  if (!automaticScanCoachmarkSeenPrefix || !signature) return false
  try {
    return sessionStorage.getItem(
      `${automaticScanCoachmarkSeenPrefix}:${signature}`) === "1"
  } catch (error) {
    return false
  }
}
const rememberAutomaticScanCoachmark = (signature) => {
  if (!automaticScanCoachmarkSeenPrefix || !signature) return
  try {
    sessionStorage.setItem(
      `${automaticScanCoachmarkSeenPrefix}:${signature}`, "1")
  } catch (error) {}
}
const candidateSizeBase = document.body.dataset.platform === "win32" ? 1024 : 1000
const AUTOMATIC_SUPPORTED = document.body.dataset.platform === "darwin" ||
  document.body.dataset.platform === "win32"
const defaultCandidateSize = 100 * candidateSizeBase ** 2
const candidateSizeOptions = [10, 50, 100, 500]
  .map((value) => value * candidateSizeBase ** 2)
  .concat(candidateSizeBase ** 3)
const PAGE_SIZE = 500

const state = {
  data: null,
  candidateSize: defaultCandidateSize,
  persistedCandidateSize: defaultCandidateSize,
  candidateSizeInitialized: false,
  view: "all",
  sourceId: REVEAL && REVEAL.locationId ? REVEAL.locationId : SCOPE_ID,
  query: "",
  statusFilter: "all",
  displayMode: "folders",
  sizeSort: null,
  nameSort: "asc",
  collapsedSources: new Set(),
  // One entry per folder that has been opened, keyed by its path inside the
  // location. Folders start closed, so only what the user opens is fetched.
  treeLevels: new Map(),
  expandedDirs: new Set(),
  treeGeneration: 0,
  expandedFiles: new Set(),
  expandedDuplicateGroups: new Set(),
  duplicateGroupChildren: new Map(),
  fileLocations: new Map(),
  locationsScanTs: undefined,
  duplicateGroupGeneration: 0,
  revealPending: !!REVEAL,
  revealPath: REVEAL ? REVEAL.relative : "",
  selectedDuplicateFiles: new Map(),
  selectedSeparateFiles: new Set(),
  separateAllMatching: false,
  scanRequested: false,
  scanBaseline: null,
  scanResult: null,
  scanProblemsOpen: false,
  scanPreviewOpen: false,
  feedback: null,
  actionProgress: null,
  actionRequest: false,
  automaticMode: null,
  automaticModeUpdating: false,
  automaticScanPendingSignature: consumeAutomaticScanFocusRequest(),
  automaticScanCoachmarkSignature: null,
  scanCancelRequested: false,
  folderDiscoveryOpen: false,
  folderDiscoveryChoosingRoot: false,
  folderDiscoveryStarting: false,
  folderDiscoverySubmitting: false,
  folderDiscoveryPage: 0,
  folderDiscoveryCancelRequested: false,
  folderDiscoveryLocalError: null,
  folderDiscoveryRunKey: null,
  folderDiscoveryNodes: new Map(),
  folderDiscoveryExpanded: new Set(),
  folderDiscoveryChildrenLoading: new Set(),
  folderDiscoverySelectionRemote: null,
  folderDiscoverySelectionPending: false,
  folderDiscoverySelectionPromise: null,
  folderDiscoveryReturnFocus: null,
  folderDiscoveryRateRunKey: null,
  folderDiscoveryRateSamples: [],
  page: 0,
  pageCursors: [""]
}

// Expanded location lists describe one grouping of one file. Anything that
// can change that grouping closes them instead of leaving stale paths open.
const closeFileLocations = () => {
  state.expandedFiles.clear()
  state.fileLocations.clear()
}

const resetPage = () => {
  state.page = 0
  state.pageCursors = [""]
  state.expandedDuplicateGroups.clear()
  state.duplicateGroupChildren.clear()
  closeFileLocations()
  state.duplicateGroupGeneration += 1
  // Sort order, search and view all change what a folder level contains, so
  // anything already fetched is stale.
  resetTreeLevels()
}

const clearSeparateSelection = () => {
  state.selectedSeparateFiles.clear()
  state.separateAllMatching = false
}
const clearDuplicateSelection = () => {
  state.selectedDuplicateFiles.clear()
}
const clearFileSelections = () => {
  clearDuplicateSelection()
  clearSeparateSelection()
}

const el = (id) => document.getElementById(id)
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]))
const attr = esc
const fmt = window.PinokioFormatStorageSize
const formatInteger = (value) => Math.max(0, Number(value) || 0)
  .toLocaleString()
const formatDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
const candidateSize = () => {
  const value = Number(state.candidateSize)
  return candidateSizeOptions.includes(value) ? value : defaultCandidateSize
}
const candidateSizeLabel = (size = candidateSize()) => {
  return `${fmt(size)}+`
}
const renderCandidateSizeControl = () => {
  const size = candidateSize()
  const select = el("vault-candidate-size")
  if (select) select.value = String(size)
  const label = el("vault-scan-size-label")
  if (label) label.textContent = candidateSizeLabel(size)
  const menu = el("vault-scan-size-menu")
  if (menu) {
    const trigger = menu.querySelector("summary")
    if (trigger) {
      trigger.setAttribute("aria-label",
        `${COPY.minimum_file_size}: ${candidateSizeLabel(size)}`)
    }
    for (const option of menu.querySelectorAll("[data-candidate-size]")) {
      const selected = Number(option.dataset.candidateSize) === size
      option.classList.toggle("selected", selected)
      option.setAttribute("aria-pressed", String(selected))
    }
  }
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
let candidateSizeSaveTail = Promise.resolve(true)
let candidateSizeSaveGeneration = 0
const saveCandidateSize = (size) => {
  if (!candidateSizeOptions.includes(size)) return candidateSizeSaveTail
  const generation = ++candidateSizeSaveGeneration
  state.candidateSize = size
  state.candidateSizeInitialized = true
  renderCandidateSizeControl()
  const save = candidateSizeSaveTail.then(async () => {
    const result = await post({
      action: "set_candidate_size",
      scope_id: SCOPE_ID,
      candidate_size: size
    })
    if (result.error) throw new Error(result.error)
    state.persistedCandidateSize = size
    return true
  })
  candidateSizeSaveTail = save.catch(async (error) => {
    const isCurrent = () => generation === candidateSizeSaveGeneration
    if (isCurrent() && candidateSize() === size) {
      state.candidateSizeInitialized = false
      const refreshed = await refresh(true)
      if (!refreshed && isCurrent() && !state.candidateSizeInitialized) {
        state.candidateSize = state.persistedCandidateSize
        state.candidateSizeInitialized = true
        renderCandidateSizeControl()
      }
    }
    if (isCurrent()) {
      state.feedback = {
        error: true,
        message: error && error.message ? error.message : String(error)
      }
      renderFeedback()
    }
    return false
  })
  const pending = candidateSizeSaveTail
  pending.finally(() => {
    if (candidateSizeSaveTail === pending) {
      candidateSizeSaveTail = Promise.resolve(true)
    }
  })
  return candidateSizeSaveTail
}
// Small confirm dialog in the workspace's own visual language, so leaving the
// page never happens through a native browser prompt.
const confirmLeave = (message, confirmLabel) => new Promise((resolve) => {
  const overlay = document.createElement("div")
  overlay.className = "vault-confirm-overlay"
  overlay.innerHTML = `<section class="vault-confirm-dialog" role="dialog" aria-modal="true"><p class="vault-confirm-message"></p><div class="vault-confirm-actions"><button class="vault-button" type="button" data-confirm-cancel>${esc(COPY.cancel)}</button><button class="vault-button primary" type="button" data-confirm-accept>${esc(confirmLabel)}</button></div></section>`
  overlay.querySelector(".vault-confirm-message").textContent = message
  const settle = (value) => {
    document.removeEventListener("keydown", onKey, true)
    overlay.remove()
    resolve(value)
  }
  const onKey = (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    settle(false)
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) settle(false)
    if (event.target.closest("[data-confirm-cancel]")) settle(false)
    if (event.target.closest("[data-confirm-accept]")) settle(true)
  })
  document.addEventListener("keydown", onKey, true)
  document.body.appendChild(overlay)
  const accept = overlay.querySelector("[data-confirm-accept]")
  if (accept) accept.focus()
})

const openGlobalWorkspace = () => {
  window.parent.location.assign("/vault")
}
// A copy in another app opens that app's page with its Disk Saver tab selected
// and the group expanded, because an app's workspace only exists inside that
// page; opening the workspace URL directly strands the user with no navigation.
// Locations that are not apps have no such page and open the global workspace.
// The label and kind travel with the row: an app workspace cannot look up
// sources belonging to other apps.
// Opens the copy where it lives: the same folder view the user was reading,
// in the location that holds it, opened down to the file and marked. Falling
// back to the content group covers a row that arrived without a path.
const openFileLocation = async (relative, sourceId, kind, label) => {
  const accepted = await confirmLeave(
    COPY.open_location_confirm.replace(
      "{location}", label || COPY.unknown_location),
    COPY.open_location_accept)
  if (!accepted) return
  // An app's workspace only exists inside that app's page, so a copy in an app
  // opens there with its Disk Saver tab selected. Anything else opens global.
  const target = kind === "app" && label
    ? `/pinokio/browser/${encodeURIComponent(label)}?vault_reveal=${encodeURIComponent(relative)}`
    : `/vault?reveal=${encodeURIComponent(relative)}&location=${encodeURIComponent(sourceId)}`
  window.parent.location.assign(target)
}
const applyAutomaticScanSnapshot = (snapshot) => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED) return
  const settings = snapshot && Array.isArray(snapshot.settings)
    ? snapshot.settings
    : []
  const setting = settings.find((item) => item && item.app === APP_NAME)
  const mode = setting && setting.mode === "manual"
    ? "manual"
    : "automatic"
  const globalScanReady = !!(snapshot &&
    snapshot.global_scan_ready === true)
  const readinessChanged = state.data &&
    state.data.global_scan_ready !== globalScanReady
  if (state.data) state.data.global_scan_ready = globalScanReady
  if (state.automaticMode === mode && !readinessChanged) return
  state.automaticMode = mode
  if (state.data) {
    if (readinessChanged) refresh(true)
    else renderOverview()
  }
}
let automaticModeParentVersion = 0
let automaticModeFallbackTimer = null
const loadAutomaticMode = async () => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED) return
  const requestedAtParentVersion = automaticModeParentVersion
  try {
    const response = await fetch("/info/vault/automatic-scans", {
      credentials: "same-origin",
      cache: "no-store"
    })
    if (!response.ok) return
    const snapshot = await response.json()
    if (window.parent !== window &&
        automaticModeParentVersion !== requestedAtParentVersion) return
    applyAutomaticScanSnapshot(snapshot)
  } catch (error) {}
}
const requestAutomaticModeFromParent = () => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED || window.parent === window) {
    return false
  }
  try {
    window.parent.postMessage({
      e: "vault-automatic-scan-state-request"
    }, window.location.origin)
    return true
  } catch (error) {
    return false
  }
}
const notifyAutomaticModeChanged = (mode) => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED || window.parent === window) return
  try {
    window.parent.postMessage({
      e: "vault-automatic-mode-changed",
      app: APP_NAME,
      mode: mode === "manual" ? "manual" : "automatic"
    }, window.location.origin)
  } catch (error) {}
}
const onAutomaticScanMessage = (event) => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED || window.parent === window ||
      !event || event.source !== window.parent ||
      event.origin !== window.location.origin ||
      !event.data || typeof event.data !== "object") return
  if (event.data.e === "vault-automatic-scan-focus" &&
      event.data.app === APP_NAME) {
    const signature = typeof event.data.signature === "string"
      ? event.data.signature
      : ""
    if (!signature) return
    try { sessionStorage.removeItem(automaticScanFocusKey) } catch (error) {}
    if (state.automaticScanCoachmarkSignature === signature) return
    if (state.automaticScanCoachmarkSignature) {
      dismissAutomaticScanCoachmark()
    }
    state.automaticScanPendingSignature = signature
    if (state.data) renderOverview()
    return
  }
  if (event.data.e !== "vault-automatic-scan-state") return
  automaticModeParentVersion += 1
  if (automaticModeFallbackTimer !== null) {
    window.clearTimeout(automaticModeFallbackTimer)
    automaticModeFallbackTimer = null
  }
  applyAutomaticScanSnapshot(event.data.snapshot)
}
const sourceById = (id) => (state.data.sources || []).find((source) => source.id === id)
const sourceChildren = (id) => (state.data.sources || []).filter((source) => source.parent_id === id)
const revealLabel = document.body.dataset.platform === "darwin"
  ? COPY.show_in_finder
  : document.body.dataset.platform === "win32"
    ? COPY.show_in_file_explorer
    : COPY.open_containing_folder
// Revealing changes nothing, so it is offered for every tracked path, not
// only the ones the current scope can act on.
const revealButton = (filePath, sourceId, name) => {
  if (!filePath) return ""
  const label = `${revealLabel}: ${name || basename(filePath)}`
  return `<button class="vault-reveal-button" type="button" data-reveal-file="${attr(filePath)}" aria-label="${attr(label)}" title="${attr(revealLabel)}"><i class="fa-regular fa-folder-open" aria-hidden="true"></i></button>`
}
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
const buildItems = () => state.data && Array.isArray(state.data.items)
  ? state.data.items
  : []

const viewIcon = {
  all: "fa-regular fa-file-lines",
  duplicates: "fa-regular fa-copy",
  unavailable: "fa-regular fa-circle-xmark",
  shared: "fa-solid fa-link",
  tracked: "fa-regular fa-circle-check",
  reclaimable: "fa-regular fa-trash-can",
  activity: "fa-solid fa-wave-square"
}
const viewLabel = {
  all: COPY.all,
  duplicates: COPY.duplicates,
  unavailable: COPY.cannot_deduplicate,
  shared: COPY.shared,
  tracked: COPY.tracked,
  reclaimable: COPY.reclaimable,
  activity: COPY.activity
}
const eventLabels = {
  convert: COPY.event_convert,
  reclaim: COPY.event_reclaim,
  detach: COPY.event_detach
}
const renderViews = () => {
  const counts = state.data.inventory.counts
  const attentionViews = new Set(["duplicates", "reclaimable"])
  el("views-label").textContent = COPY.views
  const views = IS_APP_MODE
    ? ["all", "duplicates", "unavailable", "shared", "tracked", "activity"]
    : ["all", "duplicates", "unavailable", "shared", "tracked", "reclaimable", "activity"]
  el("vault-views").innerHTML = views.map((view) => {
    const needsAttention = attentionViews.has(view) && Number(counts[view]) > 0
    return `
    <button class="vault-nav-row ${state.view === view ? "selected" : ""} ${needsAttention ? "attention" : ""}" type="button" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ""}>
      <i class="${viewIcon[view]}"></i>
      <span class="vault-nav-copy"><span class="vault-nav-name">${esc(viewLabel[view])}</span></span>
      <span class="vault-nav-count ${needsAttention ? "attention" : ""}">${counts[view]}</span>
    </button>`
  }).join("")
}

const renderSourceNode = (source, depth, counts) => {
  const children = sourceChildren(source.id)
  const duplicateCount = counts.duplicates.get(source.id) || 0
  const unavailableCount = counts.unavailable.get(source.id) || 0
  const trackedCount = counts.tracked.get(source.id) || 0
  const collapsed = state.collapsedSources.has(source.id)
  const pathText = source.kind === "virtual" ? (source.id === "apps" ? "api" : "") : sourcePath(source)
  const count = state.view === "duplicates"
    ? duplicateCount
    : state.view === "unavailable"
      ? unavailableCount
      : trackedCount
  const icon = source.kind === "app" ? "fa-regular fa-folder-open" : "fa-regular fa-folder"
  const label = source.id === "external" ? COPY.other_folders : source.label
  let html = `<div class="vault-source-line depth-${Math.min(depth, 2)} ${pathText ? "has-path" : ""} ${state.sourceId === source.id ? "selected" : ""}">`
  if (children.length) {
    html += `<button class="vault-source-toggle" type="button" data-toggle-source="${attr(source.id)}" aria-label="${collapsed ? COPY.expand : COPY.collapse}" aria-expanded="${!collapsed}"><i class="fa-solid fa-chevron-${collapsed ? "right" : "down"}"></i></button>`
  } else {
    html += `<span class="vault-source-toggle placeholder"></span>`
  }
  html += `<button class="vault-nav-row ${state.sourceId === source.id ? "selected" : ""}" type="button" data-source="${attr(source.id)}" ${state.sourceId === source.id ? 'aria-current="page"' : ""}>
    <i class="${icon}"></i>
    <span class="vault-nav-copy"><span class="vault-nav-name">${esc(label)}</span>${pathText ? `<span class="vault-nav-path" title="${attr(pathText)}">${esc(pathText)}</span>` : ""}</span>
    <span class="vault-nav-count ${state.view === "duplicates" && duplicateCount ? "attention" : ""}">${count || ""}</span>
  </button></div>`
  if (!collapsed) html += children.map((child) => renderSourceNode(child, depth + 1, counts)).join("")
  return html
}

const renderLocations = () => {
  const label = el("locations-label")
  const locations = el("vault-locations")
  if (!label || !locations) return
  label.textContent = COPY.locations
  const pinokio = sourceById("pinokio")
  const external = sourceById("external")
  const inventoryCounts = state.data.inventory.source_counts
  const counts = {
    duplicates: new Map(Object.entries(inventoryCounts.duplicates || {})),
    unavailable: new Map(Object.entries(inventoryCounts.unavailable || {})),
    tracked: new Map(Object.entries(inventoryCounts.all || {}))
  }
  const allCount = state.view === "duplicates"
    ? Number(state.data.inventory.counts.duplicates) || 0
    : state.view === "unavailable"
      ? Number(state.data.inventory.counts.unavailable) || 0
      : Number(state.data.inventory.counts.all) || 0
  let html = `<button class="vault-nav-row vault-all-locations ${state.sourceId ? "" : "selected"}" type="button" data-source="" ${state.sourceId ? "" : 'aria-current="page"'}>
    <i class="fa-solid fa-hard-drive"></i>
    <span class="vault-nav-copy"><span class="vault-nav-name">${esc(COPY.all_locations)}</span></span>
    <span class="vault-nav-count ${state.view === "duplicates" && allCount ? "attention" : ""}">${allCount || ""}</span>
  </button>`
  if (pinokio) html += renderSourceNode(pinokio, 0, counts)
  if (external && sourceChildren("external").length) {
    html += renderSourceNode(external, 0, counts)
  }
  locations.innerHTML = html
}

const externalPromptDismissed = () => {
  const scan = state.data && state.data.last_scan
  if (!scan || !scan.ts) return false
  try {
    return localStorage.getItem(externalPromptKey) === String(scan.ts)
  }
  catch (error) { return false }
}
const dismissExternalPrompt = () => {
  const scan = state.data && state.data.last_scan
  try {
    if (scan && scan.ts) {
      localStorage.setItem(externalPromptKey, String(scan.ts))
    }
  } catch (error) {}
  const prompt = el("vault-external-prompt")
  if (prompt) prompt.hidden = true
}
const renderExternalPrompt = () => {
  const prompt = el("vault-external-prompt")
  if (!prompt || IS_APP_MODE || !state.data) return
  const hasCompletedScan = !!(state.data.last_scan && state.data.last_scan.ts)
  const scanning = scanActive(state.data.scan)
  for (const findButton of document.querySelectorAll(
    "#btn-find-folders, [data-find-folders]"
  )) {
    findButton.disabled = !hasCompletedScan || scanning
    findButton.title = !hasCompletedScan
      ? COPY.find_requires_scan
      : scanning
        ? COPY.find_wait_for_scan
        : COPY.find_folders
    findButton.setAttribute("aria-label", findButton.title)
  }
  const hasExternalLocation = (state.data.sources || []).some((source) =>
    source.kind === "external")
  prompt.hidden = !hasCompletedScan || hasExternalLocation ||
    externalPromptDismissed()
}

const folderDiscoveryActive = (discovery) => !!(
  discovery && (
    discovery.pending ||
    discovery.active ||
    discovery.phase === "queued"
  )
)

const folderDiscoveryComplete = (discovery) => !!(
  discovery && ["complete", "completed_with_exclusions"]
    .includes(discovery.phase)
)

const folderDiscoveryThresholdLabel = (discovery) => {
  const threshold = Number(discovery && discovery.threshold)
  if (!Number.isFinite(threshold) || threshold < 0) return null
  return threshold === 0 ? COPY.all : fmt(threshold)
}

const folderDiscoveryStageMarkup = (phase) => {
  const activeIndex = phase === "hashing"
    ? 1
    : phase === "preparing_results" ? 2 : 0
  const labels = [
    COPY.find_stage_searching,
    COPY.find_stage_verifying,
    COPY.find_stage_suggestions
  ]
  return `<ol class="vault-find-stages" aria-label="${attr(COPY.find_stages)}">${labels.map((label, index) => {
    const complete = index < activeIndex
    const active = index === activeIndex
    const marker = complete
      ? '<i class="fa-solid fa-check" aria-hidden="true"></i>'
      : String(index + 1)
    return `<li class="vault-find-stage${complete ? " complete" : ""}${active ? " active" : ""}"${active ? ' aria-current="step"' : ""}><span class="vault-find-stage-marker">${marker}</span><span>${esc(label)}</span></li>`
  }).join("")}</ol>`
}

const folderDiscoveryRate = (discovery, now = Date.now()) => {
  const runKey = [discovery.root || "", discovery.started || ""].join("\u0000")
  if (state.folderDiscoveryRateRunKey !== runKey) {
    state.folderDiscoveryRateRunKey = runKey
    state.folderDiscoveryRateSamples = []
  }
  const files = Math.max(0, Number(discovery.files) || 0)
  const samples = state.folderDiscoveryRateSamples
  const previous = samples[samples.length - 1]
  if (!previous || previous.files !== files) {
    samples.push({ files, at: now })
  }
  while (samples.length > 2 && samples[1].at < now - 60000) {
    samples.shift()
  }
  if (samples.length > 1) {
    const first = samples[0]
    const last = samples[samples.length - 1]
    const seconds = (last.at - first.at) / 1000
    if (seconds > 0 && last.files >= first.files) {
      return (last.files - first.files) / seconds
    }
  }
  return null
}

const resetFolderDiscoveryChoices = () => {
  state.folderDiscoverySubmitting = false
  state.folderDiscoveryRunKey = null
  state.folderDiscoveryNodes.clear()
  state.folderDiscoveryExpanded.clear()
  state.folderDiscoveryChildrenLoading.clear()
  state.folderDiscoverySelectionRemote = null
  state.folderDiscoverySelectionPending = false
  state.folderDiscoverySelectionPromise = null
  state.folderDiscoveryRateRunKey = null
  state.folderDiscoveryRateSamples = []
}

const folderDiscoveryPathKey = (value) => {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || "/"
  return document.body.dataset.platform === "win32"
    ? normalized.toLowerCase()
    : normalized
}

const folderDiscoveryContains = (ancestor, candidate) => {
  const parent = folderDiscoveryPathKey(ancestor)
  const child = folderDiscoveryPathKey(candidate)
  return parent === child || parent === "/" || child.startsWith(`${parent}/`)
}

const registerFolderDiscoveryNode = (node) => {
  if (!node || typeof node.folder !== "string") return
  const key = folderDiscoveryPathKey(node.folder)
  const current = state.folderDiscoveryNodes.get(key)
  const children = current && Array.isArray(current.children)
    ? current.children
    : []
  const merged = Object.assign({}, current || {}, node, { children })
  state.folderDiscoveryNodes.set(key, merged)
  for (const child of Array.isArray(node.children) ? node.children : []) {
    registerFolderDiscoveryNode(child)
  }
  return merged
}

const registerFolderDiscoveryResult = (result) => {
  registerFolderDiscoveryNode(result)
}

const renderFolderDiscoveryNode = (
  node,
  depth = 0,
  options = {}
) => {
  const children = options.root
    ? []
    : Array.isArray(node.children) ? node.children : []
  const key = folderDiscoveryPathKey(node.folder)
  const hasChildren = !options.root &&
    Math.max(0, Number(node.child_count) || 0) > 0
  const expanded = hasChildren && state.folderDiscoveryExpanded.has(key)
  const loadingChildren = state.folderDiscoveryChildrenLoading.has(key)
  const checked = !!node.selected
  const nestedSelectionCount = Math.max(
    0, Number(node.selected_inside) || 0)
  const count = Math.max(0, Number(node.file_count) || 0)
  const eligibleBytes = Math.max(Number(node.bytes) || 0,
    Number(node.eligible_bytes) || 0)
  const matchLabel = count === 1
    ? COPY.matching_file
    : COPY.matching_files.replace("{count}", count)
  const scanLabel = COPY.scan_scope.replace("{size}", fmt(eligibleBytes))
  const directCount = Math.max(0, Number(node.direct_file_count) || 0)
  const filesHereLabel = directCount && (hasChildren || options.root)
    ? directCount === 1
      ? COPY.files_here_one
      : COPY.files_here.replace("{count}", directCount)
    : null
  const toggle = hasChildren
    ? `<button class="vault-find-tree-toggle" type="button" data-toggle-found-folder="${attr(node.folder)}" aria-label="${attr(expanded ? COPY.collapse : COPY.expand)}" aria-expanded="${expanded ? "true" : "false"}"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`
    : `<span class="vault-find-tree-toggle-spacer" aria-hidden="true"></span>`
  const nextChildPage = Math.max(0, Number(node.child_page) || 0) + 1
  const childPages = Math.max(1, Number(node.child_pages) || 1)
  const childRows = expanded
    ? children.map((child) =>
      renderFolderDiscoveryNode(child, depth + 1)).join("") +
      (loadingChildren
        ? `<div class="vault-find-tree-state" style="--vault-find-depth:${depth + 1}"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>${esc(COPY.loading_folders)}</div>`
        : node.children_loaded && nextChildPage < childPages
          ? `<div class="vault-find-tree-state" style="--vault-find-depth:${depth + 1}"><button class="vault-text-button" type="button" data-load-found-folder="${attr(node.folder)}" data-found-folder-page="${nextChildPage}">${esc(COPY.show_more_folders)}</button></div>`
          : "")
    : ""
  const nestedSelectionLabel = COPY.selected_inside.replace(
    "{count}", nestedSelectionCount)
  const detailLabel = [
    nestedSelectionCount ? nestedSelectionLabel : null,
    filesHereLabel,
    COPY.matching_bytes.replace("{size}", fmt(Number(node.bytes) || 0)),
    scanLabel
  ].filter(Boolean).join(" · ")
  const showPath = options.root || depth <= 1 || checked
  return `<div class="vault-find-tree-branch">
    <div class="vault-find-tree-row${checked ? " selected" : ""}${options.root ? " root" : ""}${showPath ? "" : " compact"}" style="--vault-find-depth:${depth}">
      ${toggle}
      <label class="vault-find-tree-check-target"><input class="vault-find-tree-check" type="checkbox" data-select-found-folder="${attr(node.folder)}" aria-label="${attr(`Select ${node.folder}`)}"${checked ? " checked" : ""}${state.folderDiscoverySelectionPending ? " disabled" : ""}></label>
      <i class="fa-regular fa-folder vault-find-tree-icon" aria-hidden="true"></i>
      <div class="vault-find-tree-copy" title="${attr(node.folder)}"><div class="vault-find-tree-name"><strong>${esc(node.name || basename(node.folder) || node.folder)}</strong></div>${showPath ? `<span>${esc(node.folder)}</span>` : ""}</div>
      <div class="vault-find-tree-saving"><strong>${esc(matchLabel)}</strong><span>${esc(detailLabel)}</span></div>
    </div>${childRows}
  </div>`
}

const folderDiscoverySelectionSummary = () => {
  const remote = state.folderDiscoverySelectionRemote || {}
  const count = Math.max(0, Number(remote.selected_count) || 0)
  const label = count === 1
    ? COPY.selected_location
    : COPY.selected_locations.replace("{count}", count)
  return {
    count,
    bytes: Math.max(0, Number(remote.potential_savings) || 0),
    files: Math.max(0, Number(remote.selected_files) || 0),
    label,
    pending: state.folderDiscoverySelectionPending
  }
}

const folderDiscoveryRunKey = (discovery) => [
  discovery.root || "",
  discovery.started || "",
  discovery.result_count || 0,
  discovery.result_bytes || 0
].join("\u0000")

const addFolderDiscoverySelection = async (discovery) => {
  if (state.folderDiscoverySelectionPromise) {
    await state.folderDiscoverySelectionPromise.catch(() => {})
  }
  const result = await post({
    action: "add_folder_discovery_sources",
    root: discovery.root,
    started: discovery.started
  })
  if (result.error) throw new Error(result.error)
  return result
}

const applyFolderDiscoverySelection = (folder, selected, result) => {
  const updateCachedNode = (changed) => {
    const results = state.data && state.data.folder_discovery_results
    if (!results) return
    const candidates = [results.root]
      .concat(Array.isArray(results.items) ? results.items : [])
    const cached = candidates.find((candidate) => candidate &&
      folderDiscoveryPathKey(candidate.folder) ===
        folderDiscoveryPathKey(changed.folder))
    if (cached) Object.assign(cached, changed)
  }
  if (selected) {
    for (const node of state.folderDiscoveryNodes.values()) {
      if (folderDiscoveryPathKey(node.folder) !==
          folderDiscoveryPathKey(folder) &&
          folderDiscoveryContains(folder, node.folder)) {
        node.selected = false
        node.selected_inside = 0
        updateCachedNode(node)
      }
    }
  }
  for (const changed of Array.isArray(result.nodes) ? result.nodes : []) {
    const node = state.folderDiscoveryNodes.get(
      folderDiscoveryPathKey(changed.folder))
    if (node) Object.assign(node, changed)
    updateCachedNode(changed)
  }
  const results = state.data && state.data.folder_discovery_results
  if (results) {
    results.selection = {
      selected_count: result.selected_count,
      selected_files: result.selected_files,
      potential_savings: result.potential_savings
    }
  }
  state.folderDiscoverySelectionRemote = result
}

const updateFolderDiscoverySelection = async (node, selected, discovery) => {
  if (!node || !folderDiscoveryComplete(discovery) ||
      state.folderDiscoverySelectionPending) return
  const runKey = state.folderDiscoveryRunKey
  const focusToken = folderDiscoveryFocusToken()
  state.folderDiscoverySelectionPending = true
  renderFolderDiscovery()
  try {
    const result = await post({
      action: "update_folder_discovery_selection",
      root: discovery.root,
      started: discovery.started,
      path: node.folder,
      selected
    })
    if (result.error) throw new Error(result.error)
    if (state.folderDiscoveryRunKey !== runKey) return
    applyFolderDiscoverySelection(node.folder, selected, result)
    state.folderDiscoveryLocalError = null
  } catch (error) {
    if (state.folderDiscoveryRunKey !== runKey) return
    state.folderDiscoveryLocalError = error && error.message
      ? error.message
      : String(error)
  } finally {
    if (state.folderDiscoveryRunKey === runKey) {
      state.folderDiscoverySelectionPending = false
      renderFolderDiscovery()
      restoreFolderDiscoveryFocus(focusToken)
    }
  }
}

const prepareFolderDiscoveryResults = (discovery, results) => {
  const runKey = folderDiscoveryRunKey(discovery)
  if (state.folderDiscoveryRunKey !== runKey) {
    resetFolderDiscoveryChoices()
    state.folderDiscoveryRunKey = runKey
  }
  if (!state.folderDiscoverySelectionPending && results.selection) {
    state.folderDiscoverySelectionRemote = results.selection
  }
  if (results.root) registerFolderDiscoveryNode(results.root)
  for (const result of Array.isArray(results.items) ? results.items : []) {
    registerFolderDiscoveryResult(result)
  }
}

const loadFolderDiscoveryChildren = async (folder, page = 0) => {
  const key = folderDiscoveryPathKey(folder)
  const runKey = state.folderDiscoveryRunKey
  if (state.folderDiscoveryChildrenLoading.has(key)) return
  const node = state.folderDiscoveryNodes.get(key)
  if (!node) return
  state.folderDiscoveryChildrenLoading.add(key)
  renderFolderDiscovery()
  try {
    const manifest = await fetchJson(
      folderDiscoveryChildrenUrl(folder, page))
    if (state.folderDiscoveryRunKey !== runKey) return
    const current = state.folderDiscoveryNodes.get(key)
    if (!current) return
    const byKey = new Map((Array.isArray(current.children)
      ? current.children
      : []).map((child) => [folderDiscoveryPathKey(child.folder), child]))
    for (const item of Array.isArray(manifest.items) ? manifest.items : []) {
      const child = registerFolderDiscoveryNode(item)
      if (child) byKey.set(folderDiscoveryPathKey(child.folder), child)
    }
    current.children = [...byKey.values()]
    current.children_loaded = true
    current.child_page = Math.max(0, Number(manifest.page) || 0)
    current.child_pages = Math.max(1, Number(manifest.pages) || 1)
    state.folderDiscoveryLocalError = null
  } catch (error) {
    state.folderDiscoveryLocalError = error && error.message
      ? error.message
      : String(error)
  } finally {
    state.folderDiscoveryChildrenLoading.delete(key)
    renderFolderDiscovery()
  }
}

const folderDiscoveryFocusToken = () => {
  const active = document.activeElement
  const overlay = el("vault-find-overlay")
  if (!active || !overlay || !overlay.contains(active)) return null
  if (active.id === "vault-find-candidate-size") {
    return { id: active.id }
  }
  const attributes = [
    "data-select-found-folder",
    "data-toggle-found-folder",
    "data-load-found-folder",
    "data-find-page",
    "data-add-found-folders",
    "data-search-somewhere-else",
    "data-close-find-folders",
    "data-cancel-find-folders",
    "data-find-home-folder",
    "data-find-other-folder",
  ]
  for (const attribute of attributes) {
    if (active.hasAttribute && active.hasAttribute(attribute)) {
      return { attribute, value: active.getAttribute(attribute) }
    }
  }
  return null
}

const restoreFolderDiscoveryFocus = (token) => {
  if (!token) return
  if (token.id) {
    const target = el(token.id)
    if (target && !target.disabled) target.focus({ preventScroll: true })
    return
  }
  const candidates = document.querySelectorAll(`[${token.attribute}]`)
  const target = [...candidates].find((candidate) =>
    candidate.getAttribute(token.attribute) === token.value)
  if (target && !target.disabled) target.focus({ preventScroll: true })
}

const setFolderDiscoveryBody = (body, html, focusToken) => {
  body.innerHTML = html
  const dialog = body.closest(".vault-find-dialog")
  const busy = state.folderDiscoverySubmitting ||
    state.folderDiscoveryStarting
  if (dialog) {
    dialog.setAttribute("aria-busy", String(busy))
    const close = dialog.querySelector(".vault-find-close")
    if (close) close.disabled = state.folderDiscoverySubmitting
  }
  if (busy) {
    for (const control of body.querySelectorAll(
      "button, input, select, summary, textarea"
    )) control.disabled = true
  }
  restoreFolderDiscoveryFocus(focusToken)
}

const focusFolderDiscoveryDialog = () => {
  const dialog = document.querySelector(".vault-find-dialog")
  if (dialog && state.folderDiscoveryOpen) {
    const target = state.folderDiscoveryChoosingRoot
      ? dialog.querySelector(
        "[data-find-home-folder]:not([disabled]), " +
        "[data-find-other-folder]:not([disabled])"
      )
      : dialog
    ;(target || dialog).focus({ preventScroll: true })
  }
}

const closeFolderDiscoveryModal = (restoreFocus = true) => {
  const returnFocus = state.folderDiscoveryReturnFocus
  state.folderDiscoveryOpen = false
  renderFolderDiscovery()
  if (restoreFocus && returnFocus && returnFocus.isConnected) {
    returnFocus.focus({ preventScroll: true })
  }
  if (restoreFocus) state.folderDiscoveryReturnFocus = null
}

const renderFolderDiscovery = () => {
  const overlay = el("vault-find-overlay")
  const body = el("vault-find-body")
  if (!overlay || !body || IS_APP_MODE) return
  const choosingRoot = state.folderDiscoveryChoosingRoot ||
    state.folderDiscoveryStarting
  const dialog = body.closest(".vault-find-dialog")
  if (dialog) dialog.classList.toggle("choosing-root", choosingRoot)
  overlay.hidden = !state.folderDiscoveryOpen
  if (!state.folderDiscoveryOpen || !state.data) return
  const focusToken = folderDiscoveryFocusToken()

  const discovery = state.data.folder_discovery || { phase: "idle" }
  const title = el("vault-find-title")
  if (title) {
    title.textContent = choosingRoot
      ? COPY.find_folders_picker
      : folderDiscoveryComplete(discovery)
      ? COPY.suggested_locations
      : COPY.find_folders_title
  }
  const active = folderDiscoveryActive(discovery)
  const localErrorBanner = state.folderDiscoveryLocalError
    ? `<div class="vault-find-partial" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${esc(state.folderDiscoveryLocalError)}</span></div>`
    : ""
  if (choosingRoot) {
    const homeLabel = HOME_PATH || COPY.home_folder_unavailable
    setFolderDiscoveryBody(body, `${localErrorBanner}<div class="vault-find-chooser">
      <div class="vault-find-size-setting">
        <label class="vault-find-size-copy" for="vault-find-candidate-size">
          <strong>${esc(COPY.minimum_file_size)}</strong>
          <span id="vault-find-size-help">${esc(COPY.find_minimum_size_help)}</span>
        </label>
        <select class="vault-select vault-find-size-select" id="vault-find-candidate-size" aria-describedby="vault-find-size-help">
          ${candidateSizeOptions.map((size) => `<option value="${size}" ${size === candidateSize() ? "selected" : ""}>${esc(candidateSizeLabel(size))}</option>`).join("")}
        </select>
      </div>
      <button class="vault-button vault-find-choice recommended" type="button" data-find-home-folder title="${attr(homeLabel)}" ${HOME_PATH ? "" : "disabled"}>
        <i class="fa-solid fa-house" aria-hidden="true"></i>
        <span class="vault-find-choice-copy"><strong>${esc(COPY.search_home_folder)}</strong><span class="vault-find-choice-path">${esc(homeLabel)}</span></span>
        <i class="fa-solid fa-chevron-right vault-find-choice-chevron" aria-hidden="true"></i>
      </button>
      <button class="vault-button vault-find-choice" type="button" data-find-other-folder>
        <i class="fa-solid fa-folder-open" aria-hidden="true"></i>
        <span class="vault-find-choice-copy"><strong>${esc(COPY.choose_another_folder)}</strong><span class="vault-find-choice-path">${esc(COPY.choose_another_folder_hint)}</span></span>
        <i class="fa-solid fa-chevron-right vault-find-choice-chevron" aria-hidden="true"></i>
      </button>
    </div>`, focusToken)
    return
  }
  if (active) {
    const labels = {
      queued: COPY.find_waiting,
      discovering: COPY.find_searching,
      hashing: COPY.find_verifying,
      preparing_results: COPY.find_preparing
    }
    const label = labels[discovery.phase] || COPY.find_searching
    const candidates = Math.max(0, Number(discovery.candidates) || 0)
    const processed = Math.max(0,
      Number(discovery.processed ?? discovery.hashed) || 0)
    const verifiedFiles = Math.max(0,
      Number(discovery.verified_files) || 0)
    const verifiedBytes = Math.max(0,
      Number(discovery.verified_bytes) || 0)
    const ratio = discovery.phase === "hashing" && candidates
      ? Math.min(1, processed / candidates)
      : null
    const now = Date.now()
    const elapsedMs = Math.max(0,
      now - (Number(discovery.started) || now))
    const elapsed = COPY.find_elapsed.replace("{time}",
      formatDuration(elapsedMs))
    const lastActivity = Number(discovery.last_activity) || 0
    const inactiveMs = lastActivity
      ? Math.max(0, now - lastActivity)
      : 0
    const stalled = lastActivity > 0 && inactiveMs >= 10000
    const thresholdLabel = folderDiscoveryThresholdLabel(discovery)
    const thresholdDetail = thresholdLabel
      ? `${COPY.minimum_file_size}: ${thresholdLabel}`
      : ""
    const currentFolder = discovery.current_folder || discovery.root || ""
    const currentDetail = discovery.phase === "hashing" && discovery.current_file
      ? discovery.current_file
      : currentFolder
    const currentLabel = discovery.phase === "hashing"
      ? COPY.find_current_file
      : COPY.find_current_folder
    const verifiedDetail = COPY.find_verified_so_far
      .replace("{count}", formatInteger(verifiedFiles))
      .replace("{size}", fmt(verifiedBytes))
    let activity = ""
    if (discovery.phase === "discovering") {
      const rate = folderDiscoveryRate(discovery, now)
      const activityState = stalled
        ? COPY.find_stalled.replace("{time}", formatDuration(inactiveMs))
        : rate && rate > 0
          ? COPY.find_rate.replace("{count}",
            formatInteger(Math.max(1, Math.round(rate))))
          : COPY.find_active
      const discoveryMeta = [
        activityState,
        COPY.find_folders_checked.replace(
          "{count}", formatInteger(discovery.dirs)),
        elapsed
      ].filter(Boolean)
      const candidateLabel = candidates === 1
        ? COPY.find_candidate
        : COPY.find_candidates.replace(
          "{count}", formatInteger(candidates))
      activity = `<div class="vault-find-live"><strong>${esc(formatInteger(discovery.files))}</strong><span>${esc(COPY.find_files_checked)}</span></div>
        <div class="vault-find-progress-meta">${discoveryMeta.map((item) => `<span>${esc(item)}</span>`).join("")}</div>
        ${discovery.candidates_known ? `<div class="vault-find-candidates"><i class="fa-solid fa-layer-group" aria-hidden="true"></i><strong>${esc(candidateLabel)}</strong></div>` : ""}
        ${currentDetail ? `<div class="vault-find-current" title="${attr(currentDetail)}"><span>${esc(currentLabel)}</span><strong>${esc(currentDetail)}</strong></div>` : ""}`
    } else if (discovery.phase === "hashing") {
      const progressLabel = COPY.find_verified_progress
        .replace("{done}", formatInteger(processed))
        .replace("{total}", formatInteger(candidates))
      activity = `<div class="vault-find-live compact"><strong>${esc(progressLabel)}</strong></div>
        ${ratio === null ? "" : `<span class="vault-progress-track" role="progressbar" aria-label="${attr(progressLabel)}" aria-valuemin="0" aria-valuemax="${candidates}" aria-valuenow="${processed}"><span class="vault-progress-bar determinate" style="--vault-progress:${ratio}"></span></span>`}
        ${currentDetail ? `<div class="vault-find-current" title="${attr(currentDetail)}"><span>${esc(currentLabel)}</span><strong>${esc(currentDetail)}</strong></div>` : ""}
        <div class="vault-find-progress-meta"><span>${esc(verifiedDetail)}</span><span>${esc(elapsed)}</span>${stalled ? `<span>${esc(COPY.find_stalled.replace("{time}", formatDuration(inactiveMs)))}</span>` : ""}</div>`
    } else if (discovery.phase === "preparing_results") {
      activity = `<div class="vault-find-live compact"><strong>${esc(verifiedDetail)}</strong></div>
        <div class="vault-find-progress-meta"><span>${esc(elapsed)}</span>${stalled ? `<span>${esc(COPY.find_stalled.replace("{time}", formatDuration(inactiveMs)))}</span>` : ""}</div>`
    } else {
      activity = `<div class="vault-find-current" title="${attr(discovery.root || "")}">${esc(discovery.root || "")}</div>`
    }
    const progressIcon = stalled
      ? "fa-regular fa-clock"
      : "fa-solid fa-circle-notch fa-spin"
    setFolderDiscoveryBody(body, `${localErrorBanner}<div class="vault-find-progress">
      ${folderDiscoveryStageMarkup(discovery.phase)}
      <div class="vault-find-progress-heading"><i class="${progressIcon}" aria-hidden="true"></i><span>${esc(label)}</span></div>
      <div class="vault-find-root" title="${attr(discovery.root || "")}">${esc(discovery.root || "")}</div>
      ${activity}
      ${thresholdDetail ? `<div class="vault-find-threshold">${esc(thresholdDetail)}</div>` : ""}
      <div class="vault-find-actions"><button class="vault-button" type="button" data-cancel-find-folders ${state.folderDiscoveryCancelRequested ? "disabled" : ""}>${esc(state.folderDiscoveryCancelRequested ? COPY.cancelling : COPY.cancel)}</button></div>
    </div>`, focusToken)
    return
  }

  if (discovery.phase === "failed" || discovery.error) {
    setFolderDiscoveryBody(body, `<div class="vault-find-error">
      <p>${esc(discovery.error || COPY.action_not_completed)}</p>
      <div class="vault-find-actions"><button class="vault-button" type="button" data-search-somewhere-else>${esc(COPY.search_somewhere_else)}</button><button class="vault-button primary" type="button" data-close-find-folders>${esc(COPY.done)}</button></div>
    </div>`, focusToken)
    return
  }

  if (folderDiscoveryComplete(discovery)) {
    const results = state.data.folder_discovery_results
    if (!results) {
      setFolderDiscoveryBody(body, `<div class="vault-find-progress"><div class="vault-find-progress-heading"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>${esc(COPY.find_preparing)}</span></div></div>`, focusToken)
      return
    }
    const partial = discovery.phase === "completed_with_exclusions" ||
      !!discovery.partial
    const items = Array.isArray(results.items) ? results.items : []
    const partialBanner = partial
      ? `<div class="vault-find-partial"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${esc(COPY.find_partial)}</span></div>`
      : ""
    prepareFolderDiscoveryResults(discovery, results)
    const root = results.root
    const hasMatches = !!(root && Number(root.file_count) > 0)
    if (!hasMatches) {
      const emptyTitle = partial
        ? COPY.no_matching_folders_partial
        : COPY.no_matching_folders
      setFolderDiscoveryBody(body, `${partialBanner}<div class="vault-find-empty">
        <p><strong>${esc(emptyTitle)}</strong><br>${esc(COPY.no_matching_folders_hint)}</p>
        <div class="vault-find-actions"><button class="vault-button" type="button" data-search-somewhere-else>${esc(COPY.search_somewhere_else)}</button><button class="vault-button primary" type="button" data-close-find-folders>${esc(COPY.done)}</button></div>
      </div>`, focusToken)
      return
    }
    const rows = renderFolderDiscoveryNode(root, 0, { root: true }) +
      items.map((result) =>
        renderFolderDiscoveryNode(
          state.folderDiscoveryNodes.get(
            folderDiscoveryPathKey(result.folder)) || result,
          1
        )).join("")
    const selection = folderDiscoverySelectionSummary()
    const page = Math.max(0, Number(results.page) || 0)
    const pages = Math.max(1, Number(results.pages) || 1)
    const pageControls = pages > 1
      ? `<div class="vault-pagination"><button class="vault-text-button" type="button" data-find-page="previous" ${page <= 0 ? "disabled" : ""}>${esc(COPY.previous)}</button><span class="vault-find-page">${page + 1} / ${pages}</span><button class="vault-text-button" type="button" data-find-page="next" ${page + 1 >= pages ? "disabled" : ""}>${esc(COPY.next)}</button></div>`
      : ""
    const addLabel = state.folderDiscoverySubmitting
      ? COPY.adding_locations
      : selection.count === 1
        ? COPY.add_selected_location
        : COPY.add_selected_locations.replace("{count}", selection.count)
    const savingsLabel = selection.pending
      ? COPY.calculating_savings
      : COPY.can_save_selection.replace("{size}", fmt(selection.bytes))
    const filesLabel = selection.files === 1
      ? COPY.matching_file
      : COPY.matching_files.replace("{count}", selection.files)
    setFolderDiscoveryBody(body, `<div class="vault-find-results-head"><div class="vault-find-results-copy"><strong>${esc(COPY.choose_locations)}</strong><span>${esc(COPY.choose_locations_hint)}</span></div><span class="vault-find-verified"><i class="fa-solid fa-check" aria-hidden="true"></i>${esc(COPY.verified_identical_only)}</span></div>${localErrorBanner}${partialBanner}<div class="vault-find-result-list">${rows}</div><footer class="vault-find-results-footer"><div class="vault-find-results-footer-summary">${pageControls}<strong>${esc(selection.label)}</strong><span>${esc(filesLabel)} · ${esc(savingsLabel)}</span></div><div class="vault-find-actions"><button class="vault-text-button" type="button" data-search-somewhere-else>${esc(COPY.search_somewhere_else)}</button><button class="vault-button" type="button" data-close-find-folders>${esc(COPY.done)}</button><button class="vault-button primary" type="button" data-add-found-folders ${selection.count && !selection.pending ? "" : "disabled"}>${esc(addLabel)}</button></div></footer>`, focusToken)
    return
  }

  state.folderDiscoveryOpen = false
  overlay.hidden = true
  body.innerHTML = ""
}

const selectedSource = () => state.sourceId ? sourceById(state.sourceId) : null
const scopeDuplicateCount = (sourceId, shareableOnly = false) => {
  const inventory = state.data.inventory
  const counts = shareableOnly
    ? inventory.shareable_by_source
    : inventory.source_counts && inventory.source_counts.duplicates
  return Math.max(0, Number(counts && counts[sourceId]) || 0)
}
const bulkDeduplicationCount = () => state.sourceId
  ? scopeDuplicateCount(state.sourceId, true)
  : Number(state.data.inventory.shareable_duplicates) || 0
const selectedDeduplicationBytes = () => {
  let bytes = 0
  for (const selection of state.selectedDuplicateFiles.values()) {
    bytes += Math.max(0, Number(selection.size) || 0)
  }
  return bytes
}
const allDeduplicationBytes = () => {
  const current = state.data.inventory.current || {}
  const exact = Number(current.deduplicate_bytes)
  if (Number.isFinite(exact)) return Math.max(0, exact)
  if (!state.sourceId || IS_APP_MODE) {
    return Math.max(0, Number(state.data.pending_bytes) || 0)
  }
  if (!state.query) {
    return Math.max(0, Number(current.shareable_bytes) || 0)
  }
  return null
}
const bulkDeduplicationAction = () => {
  if (state.view !== "duplicates") return ""
  const selected = state.selectedDuplicateFiles.size
  if (selected) {
    const size = fmt(selectedDeduplicationBytes())
    const label = selected === 1
      ? COPY.deduplicate_selected_file.replace("{size}", size)
      : COPY.deduplicate_selected_files
        .replace("{count}", selected)
        .replace("{size}", size)
    return `<button class="vault-button primary" type="button" data-deduplicate-selected aria-label="${attr(label)}">${esc(label)}</button>`
  }
  const count = bulkDeduplicationCount()
  if (!count) return ""
  const context = state.sourceId || ""
  const bytes = allDeduplicationBytes()
  const label = `${COPY.deduplicate_all.replace(
    "{count}",
    countLabel(count)
  )}${bytes == null ? "" : ` (${fmt(bytes)})`}`
  return `<button class="vault-button primary" type="button" data-deduplicate-all data-deduplicate-context="${attr(context)}" aria-label="${attr(label)}" title="${attr(label)}">${esc(label)}</button>`
}
const bulkSeparateAction = () => {
  const count = state.separateAllMatching
    ? Math.max(0, Number(
      state.data.inventory.current.separate_count) || 0)
    : state.selectedSeparateFiles.size
  if (!count) return ""
  const label = count === 1
    ? COPY.make_file_separate
    : COPY.make_files_separate.replace("{count}", count)
  return `<button class="vault-button" type="button" data-separate-selected aria-label="${attr(label)}">${esc(label)}</button>`
}
const batchAction = (source) => {
  if (state.view === "unavailable" ||
      (state.view === "all" && state.statusFilter === "unavailable")) {
    return ""
  }
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
    return `${countLabel(Number(current.count) || 0)} · ${countLabel(Number(current.locations) || 0, COPY.location, COPY.locations_lower)}`
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
  if (state.view === "unavailable") return COPY.search_unavailable
  if (state.view === "shared") return COPY.search_shared
  if (state.view === "tracked") return COPY.search_tracked
  if (state.view === "activity") return COPY.search_activity
  const source = selectedSource()
  return source && source.kind === "app" ? COPY.search_in.replace("{location}", source.label) : COPY.search_all
}
const supportsDisplayMode = () => state.view === "all" ||
  state.view === "duplicates" ||
  state.view === "unavailable" ||
  state.view === "shared" ||
  state.view === "tracked"
const displayModeControl = () => supportsDisplayMode() ? `<div class="vault-display-mode" role="group" aria-label="${attr(COPY.display_mode)}">
  <button type="button" data-display-mode="folders" aria-pressed="${state.displayMode === "folders"}" class="${state.displayMode === "folders" ? "selected" : ""}">${esc(COPY.folders)}</button>
  <button type="button" data-display-mode="files" aria-pressed="${state.displayMode === "files"}" class="${state.displayMode === "files" ? "selected" : ""}">${esc(COPY.files_mode)}</button>
</div>` : ""
const renderToolbar = () => {
  const previousSearch = el("vault-search")
  const restoreSearchFocus = previousSearch &&
    document.activeElement === previousSearch
  const selectionStart = restoreSearchFocus
    ? previousSearch.selectionStart
    : null
  const selectionEnd = restoreSearchFocus
    ? previousSearch.selectionEnd
    : null
  const selectionDirection = restoreSearchFocus
    ? previousSearch.selectionDirection
    : null
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
      <option value="unavailable" ${state.statusFilter === "unavailable" ? "selected" : ""}>${esc(COPY.cannot_deduplicate)}</option>
      <option value="shared" ${state.statusFilter === "shared" ? "selected" : ""}>${esc(COPY.shared)}</option>
      <option value="tracked" ${state.statusFilter === "tracked" ? "selected" : ""}>${esc(COPY.tracked)}</option>
    </select>` : ""}
    ${displayModeControl()}
    ${descriptionMarkup}
    <span class="vault-toolbar-count" id="vault-toolbar-summary">${esc(toolbarSummary())}</span>
    ${bulkSeparateAction()}
    ${state.view === "all" ? batchAction(source) : bulkDeduplicationAction()}
    ${removeSourceAction(source)}`
  if (restoreSearchFocus) {
    const search = el("vault-search")
    if (search) {
      search.focus({ preventScroll: true })
      search.setSelectionRange(
        selectionStart,
        selectionEnd,
        selectionDirection
      )
    }
  }
}

const unavailableLabel = (item) => ({
  metadata: COPY.permissions_differ,
  hardlinks: COPY.hardlinks_unavailable,
  different_disk: COPY.different_disk,
  anchor_conflict: COPY.anchor_conflict,
  permission_denied: COPY.permission_denied,
  below_minimum_size: COPY.below_minimum_size
}[item.unavailable_reason] || COPY.cannot_share_safely)
const statusMarkup = (item) => {
  if (item.status === "unavailable") {
    return `<span class="vault-status"><i class="fa-regular fa-circle-xmark"></i>${esc(unavailableLabel(item))}</span>`
  }
  if (item.status === "duplicate") {
    return `<span class="vault-status"><span class="vault-status-dot warning"></span>${esc(COPY.duplicate)}</span>`
  }
  if (item.status === "shared") {
    const locations = Array.isArray(item.locations)
      ? item.locations.length
      : 0
    const count = Math.max(
      locations,
      Number(item.location_count) || 0
    )
    return `<span class="vault-status"><i class="fa-solid fa-link"></i>${esc(COPY.shared)}${count ? ` · ${count} ${esc(COPY.locations_lower)}` : ""}</span>`
  }
  return `<span class="vault-status"><i class="fa-regular fa-circle-check"></i>${esc(COPY.tracked)}</span>`
}
const spaceMarkup = (item) => {
  if (item.status === "duplicate") return `${fmt(item.size)} ${COPY.can_save_suffix}`
  return "—"
}
const sharingControl = (item) => {
  let control = ""
  if (item.status === "shared") {
    control = `<button class="vault-text-button" type="button" aria-label="${attr(`${COPY.make_separate}: ${basename(item.relative_path)}`)}" data-detach="${attr(item.path)}">${esc(COPY.make_separate)}</button>`
  } else if (item.status === "unavailable" &&
      item.unavailable_reason === "permission_denied") {
    control = `<button class="vault-text-button" type="button" aria-label="${attr(`${COPY.try_again}: ${basename(item.relative_path)}`)}" data-deduplicate-file="${attr(item.path)}">${esc(COPY.try_again)}</button>`
  }
  return `<span class="vault-status-cell">${statusMarkup(item)}${control}</span>`
}

const fileDetail = (item, depth = 0) => {
  if (!state.expandedFiles.has(item.path)) return ""
  const locations = state.fileLocations.get(item.path)
  if (!locations || (locations.loading && !locations.loaded)) {
    return `<div class="vault-detail"${indentStyle(depth)}><div class="vault-detail-label"><i class="fa-solid fa-circle-notch fa-spin"></i> ${esc(COPY.loading_locations)}</div></div>`
  }
  if (locations.error) {
    return `<div class="vault-detail"${indentStyle(depth)}><div class="vault-detail-label error">${esc(locations.error)}</div></div>`
  }
  const total = Math.max(locations.items.length, Number(locations.total) || 0)
  // Copies are byte-identical, so the size is stated once for the group.
  const label = COPY.stored_times
    .replace("{count}", total)
    .replace("{size}", fmt(item.size))
  const remaining = Math.max(0, total - locations.items.length)
  const more = locations.nextCursor
    ? `<div class="vault-location-detail"><button class="vault-text-button" type="button" data-more-file-locations="${attr(item.path)}" ${locations.loading ? "disabled" : ""}>${esc(COPY.show_more_locations.replace("{count}", Math.min(remaining, DUPLICATE_CHILD_PAGE_SIZE)))}</button></div>`
    : ""
  const body = locations.items.map((location) => {
    const where = externalLocation(location) ||
      [location.source_label, location.relative_path].filter(Boolean).join(" / ")
    const note = location.path === item.path
      ? COPY.this_file
      : location.status === "tracked"
        ? COPY.copy_that_stays
        : location.status === "shared"
          ? COPY.already_deduplicated
          : location.status === "unavailable"
            ? COPY.cannot_be_deduplicated
            : COPY.not_deduplicated_yet
    // Only a copy that can be pointed at is a link.
    const outside = SCOPE_ID &&
      location.source_id !== SCOPE_ID &&
      location.relative_path
    const text = outside
      ? `<button class="vault-location-link" type="button" data-open-path="${attr(location.relative_path)}" data-open-source="${attr(location.source_id || "")}" data-open-kind="${attr(location.source_kind || "")}" data-open-label="${attr(location.source_label || "")}" title="${attr(COPY.open_in_disk_saver)}">${esc(where)}</button>`
      : esc(where)
    // Rows keep identical slots whether or not a reveal button exists, so the
    // notes form a column and every row is the same height.
    const reveal = revealButton(
      location.path, location.source_id, basename(location.relative_path))
    return `<div class="vault-location-detail"><i class="fa-regular fa-file"></i><span class="vault-location-path" title="${attr(where)}">${text}</span><span class="vault-location-note">${esc(note)}</span>${reveal || `<span class="vault-location-reveal-placeholder"></span>`}</div>`
  }).join("")
  return `<div class="vault-detail"${indentStyle(depth)}><div class="vault-detail-label">${esc(label)}</div>${body}${more}</div>`
}
const separateCheckbox = (item) => item.status === "shared"
  ? `<input class="vault-row-checkbox" type="checkbox" data-select-separate="${attr(item.path)}" aria-label="${attr(`${COPY.select_for_separation}: ${basename(item.relative_path)}`)}" ${state.separateAllMatching || state.selectedSeparateFiles.has(item.path) ? "checked" : ""} />`
  : ""
const duplicateCheckbox = (item) =>
  state.view === "duplicates" &&
  item.status === "duplicate" &&
  item.shareable
    ? `<input class="vault-row-checkbox" type="checkbox" data-select-duplicate="${attr(item.path)}" data-duplicate-hash="${attr(item.hash || "")}" data-duplicate-size="${attr(item.size || 0)}" aria-label="${attr(`${COPY.select_for_deduplication}: ${basename(item.relative_path)}`)}" ${state.selectedDuplicateFiles.has(item.path) ? "checked" : ""} />`
    : ""
const rowSelectionCheckbox = (item) =>
  duplicateCheckbox(item) || separateCheckbox(item)

// Folder rows carry no checkbox, so they reserve its width instead and every
// name in the tree starts on the same column.
const checkboxPlaceholder =
  '<span class="vault-row-checkbox-placeholder"></span>'
// Tree rows indent one step per level. The cap only stops a pathological tree
// from pushing the name off the row: it sits past the depth real app trees
// reach, so in practice every row indents by its own level. Names truncate
// rather than reflow, so an over-deep row degrades quietly.
const MAX_INDENT_DEPTH = 12
const indentStyle = (depth) => depth > 0
  ? ` style="--vault-indent:${Math.min(depth, MAX_INDENT_DEPTH)}"`
  : ""

const renderFileRow = (item, depth = 0, showMatch = false) => {
  const directoryPath = dirname(item.relative_path)
  const match = item.match
  const expandable = Number(item.location_count) > 1
  const rowTail = showMatch
    ? `<span>${match ? `<span class="vault-match-path">${esc(match.path)}</span>` : "—"}</span>
      <span class="vault-space">${esc(spaceMarkup(item))}</span>
      <span class="vault-row-action"></span>`
    : sharingControl(item)
  return `<div class="vault-file-row"${item.relative_path ? ` data-reveal-row="${attr(item.relative_path)}"` : ""}>
    <div class="vault-name-cell"${indentStyle(depth)}>
      ${rowSelectionCheckbox(item) || checkboxPlaceholder}
      ${expandable ? `<button class="vault-disclosure" type="button" data-expand-file="${attr(item.path)}" aria-label="${state.expandedFiles.has(item.path) ? COPY.collapse : COPY.expand}" aria-expanded="${state.expandedFiles.has(item.path)}"><i class="fa-solid fa-chevron-${state.expandedFiles.has(item.path) ? "down" : "right"}"></i></button>` : `<span class="vault-disclosure"></span>`}
      <i class="fa-regular fa-file vault-name-icon"></i>
      <span class="vault-name-copy"><span class="vault-file-name">${esc(basename(item.relative_path))}</span>${directoryPath && depth === 0 ? `<span class="vault-file-path">${esc(directoryPath)}</span>` : ""}</span>
      ${revealButton(item.path, item.source_id, basename(item.relative_path))}
    </div>
    <span class="vault-size">${item.size ? fmt(item.size) : "—"}</span>
    ${rowTail}
  </div>${fileDetail(item, depth)}`
}

const sizeOf = (item) => Math.max(0, Number(item && item.size) || 0)
const compareRows = (left, right, nameOf) => {
  const direction = state.nameSort === "desc" ? -1 : 1
  const byName = () =>
    direction * nameOf(left).localeCompare(nameOf(right))
  if (!state.sizeSort) return byName()
  const sizeDifference = sizeOf(left) - sizeOf(right)
  return (state.sizeSort === "asc" ? sizeDifference : -sizeDifference) || byName()
}
const levelKey = (locationId, parent) => `${locationId || ""}\u0000${parent}`
const treeLevel = (locationId, parent) =>
  state.treeLevels.get(levelKey(locationId, parent)) || null
// A new view, location, search or order gives the tree a different shape, so
// nothing about the old one survives.
const resetTreeLevels = () => {
  state.treeLevels.clear()
  state.expandedDirs.clear()
  state.treeGeneration += 1
}
// A scan or a file action only changes what the rows say. Dropping the fetched
// levels picks that up; keeping the open folders leaves the user where they
// were instead of collapsing the tree under them after every action.
const invalidateTreeLevels = () => {
  state.treeLevels.clear()
  state.treeGeneration += 1
}
const loadTreeLevel = async (locationId, parent, append = false) => {
  const key = levelKey(locationId, parent)
  const existing = state.treeLevels.get(key)
  if (existing && existing.loading) return
  // A level continues from two places at once: how far down the folder list it
  // got, and which file it stopped on.
  // Whatever the level is showing now was asked for under this generation. A
  // reply from an older one describes a search, filter or order that is gone.
  const generation = state.treeGeneration
  const cursor = append && existing ? existing.nextCursor : null
  const directoryOffset = append && existing
    ? existing.nextDirectoryOffset || 0
    : 0
  state.treeLevels.set(key, {
    items: existing && append ? existing.items : [],
    loading: true,
    loaded: !!(existing && append),
    error: null,
    hasNext: existing ? existing.hasNext : false,
    nextCursor: existing ? existing.nextCursor : null,
    nextDirectoryOffset: existing ? existing.nextDirectoryOffset : 0
  })
  render()
  try {
    const data = await fetchJson(
      treeLevelUrl(locationId, parent, cursor, directoryOffset))
    if (generation !== state.treeGeneration) return
    // A scope holding one location has nothing to choose between, so it opens
    // rather than making the user click through a list of one.
    const only = (data.items || []).length === 1 &&
      (data.items || [])[0].kind === "location"
      ? data.items[0]
      : null
    if (only) {
      const childKey = levelKey(only.location_id, "")
      state.expandedDirs.add(childKey)
      if (!state.treeLevels.has(childKey)) {
        loadTreeLevel(only.location_id, "")
      }
    }
    const previous = state.treeLevels.get(key)
    state.treeLevels.set(key, {
      items: append && previous
        ? [...previous.items, ...(data.items || [])]
        : (data.items || []),
      loading: false,
      loaded: true,
      error: null,
      hasNext: !!data.has_next,
      nextCursor: data.next_cursor || null,
      nextDirectoryOffset: Number(data.next_directory_offset) || 0
    })
  } catch (error) {
    if (generation !== state.treeGeneration) return
    state.treeLevels.set(key, {
      items: [],
      loading: false,
      loaded: true,
      error: error && error.message ? error.message : String(error),
      hasNext: false,
      nextCursor: null,
      nextDirectoryOffset: 0
    })
  }
  render()
}
// Opens each folder on the way down to the revealed file. Collapsed runs like
// "lib / python3.10 / site-packages" are one entry, so the walk matches on the
// entry's own path rather than stepping one segment at a time.
const walkToReveal = async () => {
  if (!state.revealPending) return
  const target = state.revealPath
  const locationId = state.sourceId
  let parent = ""
  for (let guard = 0; guard < 64; guard += 1) {
    let level = treeLevel(locationId, parent)
    if (!level || !level.loaded) {
      await loadTreeLevel(locationId, parent)
      level = treeLevel(locationId, parent)
    }
    if (!level || level.error) break
    const match = () => level.items.find((entry) => entry.kind === "directory" &&
      target.startsWith(`${entry.relative_path}/`))
    let next = match()
    // The folder on the way down can sit past the first page of a busy level,
    // so keep asking for more of that level until it appears or runs out.
    while (!next && level.hasNext) {
      await loadTreeLevel(locationId, parent, true)
      const grown = treeLevel(locationId, parent)
      if (!grown || grown.error || grown.items.length === level.items.length) break
      level = grown
      next = match()
    }
    if (!next) break
    state.expandedDirs.add(levelKey(locationId, next.relative_path))
    parent = next.relative_path
  }
  state.revealPending = false
  render()
  const row = document.querySelector(
    `[data-reveal-row="${String(target).replace(/["\\]/g, "\\$&")}"]`)
  if (!row) return
  row.classList.add("vault-row-focus")
  if (typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "center" })
  }
}
const treeSummary = (entry) => entry.duplicate_count
  ? countLabel(entry.duplicate_count, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase())
  : entry.unavailable_count
    ? COPY.cannot_deduplicate
    : entry.linked_count
      ? COPY.shared
      : COPY.tracked
const renderTreeBranch = (entry, locationId, parent, depth, icon) => {
  const key = levelKey(locationId, parent)
  const expanded = state.expandedDirs.has(key)
  const label = String(entry.label || entry.name).split("/").join(" / ")
  return `<div class="vault-file-row directory">
    <div class="vault-name-cell"${indentStyle(depth)}>${checkboxPlaceholder}<button class="vault-disclosure" type="button" data-toggle-location="${attr(locationId || "")}" data-toggle-path="${attr(parent)}" aria-label="${expanded ? COPY.collapse : COPY.expand}" aria-expanded="${expanded}"><i class="fa-solid fa-chevron-${expanded ? "down" : "right"}"></i></button><i class="fa-regular ${icon} vault-name-icon"></i><span class="vault-file-name">${esc(label)}</span></div>
    <span class="vault-size">${fmt(entry.size)}</span><span>${esc(treeSummary(entry))}</span>
  </div>${expanded ? renderTreeLevel(locationId, parent, depth + 1) : ""}`
}
const treePlaceholderRow = (depth, inner) =>
  `<div class="vault-file-row"><div class="vault-name-cell"${indentStyle(depth)}>${checkboxPlaceholder}<span class="vault-disclosure"></span>${inner}</div></div>`
const renderTreeLevel = (locationId, parent, depth) => {
  const level = treeLevel(locationId, parent)
  // Rendering a level the client does not hold is what asks for it, so the
  // root and any folder left open across a refresh both fill themselves in.
  if (!level) loadTreeLevel(locationId, parent)
  if (!level || (!level.loaded && level.loading)) {
    return treePlaceholderRow(depth, `<i class="fa-solid fa-circle-notch fa-spin vault-name-icon"></i><span class="vault-file-name">${esc(COPY.loading_locations)}</span>`)
  }
  if (level.error) {
    return treePlaceholderRow(depth, `<span class="vault-file-name error">${esc(level.error)}</span>`)
  }
  if (!level.items.length) return emptyState(state.view)
  const rows = level.items.map((entry) => {
    if (entry.kind === "location") {
      return renderTreeBranch(
        entry, entry.location_id, "", depth, "fa-folder-open")
    }
    if (entry.kind === "directory") {
      return renderTreeBranch(
        entry, locationId, entry.relative_path, depth, "fa-folder")
    }
    return renderFileRow(entry, depth)
  }).join("")
  const more = level.hasNext
    ? treePlaceholderRow(depth, `<button class="vault-text-button" type="button" data-more-location="${attr(locationId || "")}" data-more-path="${attr(parent)}" ${level.loading ? "disabled" : ""}>${esc(COPY.show_more)}</button>`)
    : ""
  return rows + more
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
    const expandable = Number(item.location_count) > 1
    return `<div class="vault-file-row">
      <div class="vault-name-cell">
        ${separateCheckbox(item) || checkboxPlaceholder}
        ${expandable ? `<button class="vault-disclosure" type="button" data-expand-file="${attr(item.path)}" aria-label="${state.expandedFiles.has(item.path) ? COPY.collapse : COPY.expand}" aria-expanded="${state.expandedFiles.has(item.path)}"><i class="fa-solid fa-chevron-${state.expandedFiles.has(item.path) ? "down" : "right"}"></i></button>` : `<span class="vault-disclosure"></span>`}
        <i class="fa-regular fa-file vault-name-icon"></i>
        <span class="vault-file-name">${esc(basename(item.relative_path))}</span>
        ${revealButton(item.path, item.source_id, basename(item.relative_path))}
      </div>
      <span class="vault-flat-location">${esc(flatLocation(item))}</span>
      <span class="vault-size">${item.size ? fmt(item.size) : "—"}</span>
      ${sharingControl(item)}
    </div>${fileDetail(item)}`
  }).join("")
const duplicateGroupSelectedCount = (hash) => {
  let count = 0
  for (const selection of state.selectedDuplicateFiles.values()) {
    if (selection.hash === hash) count += 1
  }
  return count
}
const duplicateChildStatus = (item) => {
  if (item.selectable) {
    return state.selectedDuplicateFiles.has(item.path)
      ? `${COPY.selected_copy} · ${fmt(item.size)}`
      : COPY.duplicate
  }
  if (item.registry_status === "linked") return COPY.shared
  if (item.registry_status === "reference") return COPY.reference_copy
  return COPY.outside_results
}
const renderDuplicateGroupChildren = (group) => {
  if (!state.expandedDuplicateGroups.has(group.hash)) return ""
  const children = state.duplicateGroupChildren.get(group.hash)
  if (!children || (children.loading && !children.loaded)) {
    return `<div class="vault-duplicate-children"><div class="vault-duplicate-children-state"><i class="fa-solid fa-circle-notch fa-spin"></i>${esc(COPY.loading_copies)}</div></div>`
  }
  if (children.error) {
    return `<div class="vault-duplicate-children"><div class="vault-duplicate-children-state error">${esc(children.error)}</div></div>`
  }
  const rows = children.items.map((item) => {
    const location = externalLocation(item) ||
      [groupTitle(sourceById(item.source_id)), item.relative_path]
        .filter(Boolean).join(" / ")
    const checkbox = item.selectable
      ? `<input class="vault-row-checkbox" type="checkbox" data-select-duplicate="${attr(item.path)}" data-duplicate-hash="${attr(group.hash)}" data-duplicate-size="${attr(item.size || 0)}" aria-label="${attr(`${COPY.select_for_deduplication}: ${basename(item.relative_path)}`)}" ${state.selectedDuplicateFiles.has(item.path) ? "checked" : ""} />`
      : `<span class="vault-row-checkbox-placeholder"></span>`
    return `<div class="vault-duplicate-child ${item.selectable ? "" : "context-only"}">
      ${checkbox}
      <i class="fa-regular fa-file"></i>
      <span class="vault-duplicate-child-path" title="${attr(location)}">${esc(location)}</span>
      <span class="vault-duplicate-child-status ${state.selectedDuplicateFiles.has(item.path) ? "selected" : ""}">${esc(duplicateChildStatus(item))}</span>
      ${revealButton(item.path, item.source_id, basename(item.relative_path))}
    </div>`
  }).join("")
  const remaining = Math.max(
    0,
    Number(children.total) - children.items.length
  )
  const more = children.nextCursor
    ? `<button class="vault-text-button vault-duplicate-more" type="button" data-more-duplicate-group="${attr(group.hash)}" ${children.loading ? "disabled" : ""}>${esc(COPY.show_more_copies.replace("{count}", Math.min(remaining, DUPLICATE_CHILD_PAGE_SIZE)))}</button>`
    : ""
  return `<div class="vault-duplicate-children">${rows}${more}</div>`
}
const renderGroupedDuplicates = (groups) => groups.map((group) => {
  const expanded = state.expandedDuplicateGroups.has(group.hash)
  const selected = duplicateGroupSelectedCount(group.hash)
  const eligible = Math.max(0, Number(group.eligible_count) || 0)
  const checkbox = eligible
    ? `<input class="vault-row-checkbox" type="checkbox" data-select-duplicate-group="${attr(group.hash)}" data-duplicate-size="${attr(group.size || 0)}" data-selected-count="${selected}" data-eligible-count="${eligible}" aria-label="${attr(`${COPY.select_duplicate_group}: ${basename(group.relative_path)}`)}" ${selected === eligible ? "checked" : ""} />`
    : `<span class="vault-row-checkbox-placeholder"></span>`
  const copies = Math.max(0, Number(group.total_count) || 0)
  const meta = `${countLabel(copies, "identical copy", "identical copies")} · ${eligible} ${COPY.can_be_deduplicated}`
  return `<div class="vault-file-row vault-duplicate-content-group">
    <div class="vault-name-cell">
      ${checkbox}
      <button class="vault-disclosure" type="button" data-expand-duplicate-group="${attr(group.hash)}" aria-label="${expanded ? COPY.collapse : COPY.expand}" aria-expanded="${expanded}"><i class="fa-solid fa-chevron-${expanded ? "down" : "right"}"></i></button>
      <i class="fa-regular fa-file vault-name-icon"></i>
      <span class="vault-name-copy"><span class="vault-file-name">${esc(basename(group.relative_path))}</span><span class="vault-file-path">${esc(meta)}</span></span>
    </div>
    <span class="vault-copy-count">${copies}</span>
    <span class="vault-size">${group.size ? fmt(group.size) : "—"}</span>
    <span class="vault-space">${group.can_save ? fmt(group.can_save) : "—"}</span>
  </div>${renderDuplicateGroupChildren(group)}`
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


const emptyState = (view) => {
  const scanning = scanMatchesContext(state.data && state.data.scan)
  const content = {
    all: scanning
      ? [COPY.scan_waiting, COPY.scan_waiting_hint, "fa-solid fa-circle-notch fa-spin"]
      : [COPY.no_files, COPY.no_files_hint, "fa-regular fa-folder-open"],
    duplicates: [COPY.no_duplicates, COPY.no_duplicates_hint, "fa-regular fa-circle-check"],
    unavailable: [COPY.no_unavailable, COPY.no_unavailable_hint, "fa-regular fa-circle-check"],
    shared: [COPY.no_shared, COPY.no_shared_hint, "fa-solid fa-link"],
    tracked: [COPY.no_tracked, COPY.no_tracked_hint, "fa-regular fa-circle-check"],
    reclaimable: [COPY.no_reclaimable, COPY.no_reclaimable_hint, "fa-regular fa-circle-check"],
    activity: [COPY.no_activity, COPY.no_activity_hint, "fa-solid fa-wave-square"]
  }[view]
  return `<div class="vault-empty"><div class="vault-empty-inner"><i class="${content[2]}"></i><h3>${esc(content[0])}</h3><p>${esc(content[1])}</p>${view === "duplicates" ? `<button class="vault-button" type="button" data-view="all">${esc(COPY.view_all)}</button>` : ""}</div></div>`
}

const renderReclaimable = (blobs) => {
  if (!blobs.length) return emptyState("reclaimable")
  return blobs.map((blob) => `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-regular fa-file vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name">${esc(`${blob.hash.slice(0, 12)}…`)}</span></span></div><span class="vault-size">${fmt(blob.size)}</span><span class="vault-space">${fmt(blob.size)}</span><span class="vault-row-action"><button class="vault-text-button" type="button" data-reclaim="${attr(blob.hash)}" data-reclaim-store="${attr(blob.store_id)}">${esc(COPY.reclaim)}</button></span></div>`).join("")
}

const renderActivity = (items) => {
  if (!items.length) return emptyState("activity")
  return items.map((item) => {
    if (item.activity_type === "batch") {
      return `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-solid fa-wave-square vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name vault-event-kind">${esc(eventLabels[item.kind] || COPY.event_change)}</span><span class="vault-file-path">${esc(countLabel(item.files || 0))}</span></span></div><span class="vault-size">${fmt(item.bytes_saved || 0)}</span><span class="vault-event-time">${item.ts ? esc(new Date(item.ts).toLocaleString()) : "—"}</span><span class="vault-row-action"></span></div>`
    }
    const event = item
    const eventPath = event.path
      ? `${event.source_label ? `${event.source_label} / ` : ""}${event.relative_path || event.path}`
      : (event.hash || "").slice(0, 12)
    return `<div class="vault-file-row"><div class="vault-name-cell"><span class="vault-disclosure"></span><i class="fa-solid fa-wave-square vault-name-icon"></i><span class="vault-name-copy"><span class="vault-file-name vault-event-kind">${esc(eventLabels[event.kind] || COPY.event_change)}</span><span class="vault-file-path">${esc(eventPath)}</span></span></div><span class="vault-size">${event.bytes_saved ? fmt(event.bytes_saved) : event.size ? fmt(event.size) : "—"}</span><span class="vault-event-time">${esc(new Date(event.ts).toLocaleString())}</span><span class="vault-row-action"></span></div>`
  }).join("")
}

const selectablePagePaths = (items) => items
  .filter((item) => item.status === "shared")
  .map((item) => item.path)
const selectableDuplicatePagePaths = (items) => items
  .filter((item) =>
    item.status === "duplicate" && item.shareable)
  .map((item) => item.path)

const syncPageSelectionCheckbox = () => {
  const selectPage = document.querySelector("[data-select-separate-page]")
  if (!selectPage) return
  const pageCheckboxes = [
    ...document.querySelectorAll("[data-select-separate]")
  ]
  const selected = pageCheckboxes.filter((checkbox) =>
    state.separateAllMatching ||
    state.selectedSeparateFiles.has(checkbox.dataset.selectSeparate)).length
  selectPage.checked = pageCheckboxes.length > 0 &&
    selected === pageCheckboxes.length
  selectPage.indeterminate = selected > 0 &&
    selected < pageCheckboxes.length
}
const syncDuplicatePageSelectionCheckbox = () => {
  const selectPage = document.querySelector(
    "[data-select-duplicate-page]")
  if (!selectPage) return
  const pageCheckboxes = [
    ...document.querySelectorAll("[data-select-duplicate]")
  ]
  const selected = pageCheckboxes.filter((checkbox) =>
    state.selectedDuplicateFiles.has(
      checkbox.dataset.selectDuplicate)).length
  selectPage.checked = pageCheckboxes.length > 0 &&
    selected === pageCheckboxes.length
  selectPage.indeterminate = selected > 0 &&
    selected < pageCheckboxes.length
}
const syncDuplicateGroupCheckboxes = () => {
  for (const checkbox of document.querySelectorAll(
    "[data-select-duplicate-group]"
  )) {
    const selected = Math.max(
      0,
      Number(checkbox.dataset.selectedCount) || 0
    )
    const eligible = Math.max(
      0,
      Number(checkbox.dataset.eligibleCount) || 0
    )
    checkbox.checked = eligible > 0 && selected === eligible
    checkbox.indeterminate = selected > 0 && selected < eligible
  }
}
const syncDuplicateGroupPageSelectionCheckbox = () => {
  const selectPage = document.querySelector(
    "[data-select-duplicate-group-page]")
  if (!selectPage) return
  const groupCheckboxes = [...document.querySelectorAll(
    "[data-select-duplicate-group]")]
  const eligible = groupCheckboxes.reduce((sum, checkbox) =>
    sum + Math.max(0, Number(checkbox.dataset.eligibleCount) || 0), 0)
  const selected = groupCheckboxes.reduce((sum, checkbox) =>
    sum + Math.max(0, Number(checkbox.dataset.selectedCount) || 0), 0)
  selectPage.checked = eligible > 0 && selected === eligible
  selectPage.indeterminate = selected > 0 && selected < eligible
}

const renderSeparateSelectionBanner = (
  pagePaths = selectablePagePaths(buildItems())
) => {
  const banner = el("vault-selection-state")
  if (!banner) return
  const total = Math.max(0, Number(
    state.data.inventory.current.separate_count) || 0)
  if (!total || !pagePaths.length) {
    banner.className = "vault-selection-state"
    banner.innerHTML = ""
    return
  }
  if (state.separateAllMatching) {
    const message = COPY.all_matching_selected.replace("{count}", total)
    banner.className = "vault-selection-state show"
    banner.innerHTML = `<span>${esc(message)}</span><button class="vault-text-button" type="button" data-clear-separate-selection>${esc(COPY.clear_selection)}</button>`
    return
  }
  const pageSelected = pagePaths.every((filePath) =>
    state.selectedSeparateFiles.has(filePath))
  if (!pageSelected || total <= pagePaths.length) {
    banner.className = "vault-selection-state"
    banner.innerHTML = ""
    return
  }
  const pageMessage = COPY.page_files_selected.replace(
    "{count}", pagePaths.length)
  const allMessage = COPY.select_all_matching.replace("{count}", total)
  banner.className = "vault-selection-state show"
  banner.innerHTML = `<span>${esc(pageMessage)}</span><button class="vault-text-button" type="button" data-select-separate-all>${esc(allMessage)}</button>`
}

const renderTable = (items) => {
  let body = ""
  let tableClass = "inventory"
  let headers = [COPY.name, COPY.size, COPY.status]
  if (state.view === "duplicates") {
    if (state.displayMode === "files") {
      tableClass = "duplicate-files duplicate-content-groups"
      headers = [
        COPY.name,
        COPY.copies,
        COPY.size_each,
        COPY.can_save
      ]
      body = items.length
        ? renderGroupedDuplicates(items)
        : emptyState("duplicates")
    } else {
      tableClass = "matches"
      headers = [COPY.name, COPY.size, COPY.matches, COPY.can_save, ""]
      body = items.length
        ? renderDuplicateGroups(items)
        : emptyState("duplicates")
    }
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
    body = renderTreeLevel(state.sourceId, "", 0)
  }
  const sortableSize = tableClass === "flat" ||
    tableClass === "inventory" ||
    state.view === "duplicates" ||
    state.view === "reclaimable"
  const sizeSortLabel = state.sizeSort === "desc" ? COPY.sort_smallest : COPY.sort_largest
  const sizeSortIcon = state.sizeSort === "desc" ? "fa-arrow-down-wide-short" : state.sizeSort === "asc" ? "fa-arrow-up-short-wide" : "fa-sort"
  // Every table whose rows are paths, which is every one whose Name column
  // holds a name. Content groups are labelled with a sample path rather than an
  // identity, Trash rows are labelled with a hash, and Activity is a log kept in
  // time order, so none of the three has a name to sort by.
  const sortableName = tableClass === "flat" ||
    tableClass === "inventory" ||
    tableClass === "matches"
  const nameSortLabel = state.nameSort === "desc" ? COPY.sort_a_z : COPY.sort_z_a
  const nameSortIcon = state.nameSort === "desc"
    ? "fa-arrow-down-z-a"
    : "fa-arrow-down-a-z"
  const separatePagePaths = selectablePagePaths(items)
  const duplicatePagePaths = state.view === "duplicates"
    ? selectableDuplicatePagePaths(items)
    : []
  const groupedDuplicatePage = state.view === "duplicates" &&
    state.displayMode === "files" &&
    items.some((item) => item.kind === "duplicate_group")
  const groupedEligible = groupedDuplicatePage
    ? items.reduce((sum, item) =>
        sum + Math.max(0, Number(item.eligible_count) || 0), 0)
    : 0
  const groupedSelected = groupedDuplicatePage
    ? items.reduce((sum, item) => sum + Math.min(
        Math.max(0, Number(item.eligible_count) || 0),
        duplicateGroupSelectedCount(item.hash)
      ), 0)
    : 0
  let pageSelectionAttribute = ""
  let allPageSelected = false
  const lazyTree = tableClass === "inventory"
  if (lazyTree) {
    // The rows on screen come from the folder levels, not the status page, so
    // a "select everything here" box would reach rows the user cannot see.
    pageSelectionAttribute = ""
  } else if (groupedEligible) {
    pageSelectionAttribute = "data-select-duplicate-group-page"
    allPageSelected = groupedSelected === groupedEligible
  } else if (duplicatePagePaths.length) {
    pageSelectionAttribute = "data-select-duplicate-page"
    allPageSelected = duplicatePagePaths.every((filePath) =>
      state.selectedDuplicateFiles.has(filePath))
  } else if (separatePagePaths.length) {
    pageSelectionAttribute = "data-select-separate-page"
    allPageSelected = separatePagePaths.every((filePath) =>
      state.selectedSeparateFiles.has(filePath))
  }
  const nameSortButton = `<button class="vault-sort-button ${state.sizeSort ? "" : "active"}" type="button" data-sort-name aria-label="${attr(nameSortLabel)}">${esc(COPY.name)}<i class="fa-solid ${nameSortIcon}" aria-hidden="true"></i></button>`
  const nameHeader = (header) => {
    const inner = sortableName ? nameSortButton : `<span>${esc(header)}</span>`
    const sorted = !sortableName || state.sizeSort
      ? "none"
      : state.nameSort === "desc" ? "descending" : "ascending"
    if (pageSelectionAttribute) {
      return `<span class="vault-name-header" role="columnheader" aria-sort="${sorted}"><input class="vault-row-checkbox" type="checkbox" ${pageSelectionAttribute} aria-label="${attr(COPY.select_all_on_page)}" title="${attr(COPY.select_all_on_page)}" ${allPageSelected ? "checked" : ""} />${inner}</span>`
    }
    return sortableName
      ? `<span class="vault-sort-column" role="columnheader" aria-sort="${sorted}">${inner}</span>`
      : `<span>${esc(header)}</span>`
  }
  const headerMarkup = headers.map((header, index) => index === 0
    ? nameHeader(header)
    : (header === COPY.size || header === COPY.size_each) && sortableSize
      ? `<span class="vault-sort-column" role="columnheader" aria-sort="${state.sizeSort === "desc" ? "descending" : state.sizeSort === "asc" ? "ascending" : "none"}"><button class="vault-sort-button ${state.sizeSort ? "active" : ""}" type="button" data-sort-size aria-label="${attr(sizeSortLabel)}">${esc(header)}<i class="fa-solid ${sizeSortIcon}" aria-hidden="true"></i></button></span>`
      : `<span>${esc(header)}</span>`).join("")
  el("vault-table-wrap").innerHTML = `<div class="vault-table ${tableClass}"><div class="vault-columns">${headerMarkup}</div>${body}</div>`
  renderSeparateSelectionBanner(separatePagePaths)
  syncPageSelectionCheckbox()
  syncDuplicatePageSelectionCheckbox()
  syncDuplicateGroupCheckboxes()
  syncDuplicateGroupPageSelectionCheckbox()
}

const orderedItems = (items) => {
  if (state.view === "activity") return items
  if (items.some((item) => item.kind === "duplicate_group")) return items
  if (state.view === "reclaimable") {
    return [...items].sort((a, b) => compareRows(a, b,
      (blob) => blob.hash))
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
  if (state.displayMode !== "files") {
    return {
      items,
      start: 0,
      end: items.length,
      total: items.length,
      pages: 1,
      hasPrevious: false,
      hasNext: false,
      nextCursor: null
    }
  }
  return {
    items: orderedItems(items),
    start: Number(inventory.start) || 0,
    end: Number(inventory.end) || 0,
    total: Number(inventory.total) || 0,
    pages: Math.max(1, Number(inventory.pages) || 1),
    hasPrevious: !!inventory.has_previous,
    hasNext: !!inventory.has_next,
    nextCursor: inventory.next_cursor || null
  }
}

const paneFooterText = () => {
  if (state.view === "duplicates" &&
      state.displayMode === "files") {
    const groupCount = Math.max(
      0,
      Number(state.data.inventory.total) || 0
    )
    const count = countLabel(
      groupCount,
      COPY.content_group,
      COPY.content_groups
    )
    const order = state.sizeSort === "asc"
      ? COPY.sorted_smallest
      : COPY.sorted_largest
    return `${count} · ${order}`
  }
  if (state.displayMode === "files" && supportsDisplayMode()) {
    const itemCount = Number(state.data.inventory.current && state.data.inventory.current.count) || 0
    const count = state.view === "shared"
      ? countLabel(itemCount, "deduplicated file", "deduplicated files")
      : countLabel(itemCount)
    const order = state.sizeSort === "desc"
      ? COPY.sorted_largest
      : state.sizeSort === "asc"
        ? COPY.sorted_smallest
        : state.nameSort === "desc" ? COPY.sorted_z_a : COPY.sorted_a_z
    return `${count}${order ? ` · ${order}` : ""}`
  }
  if (state.view === "duplicates") return COPY.duplicate_note
  if (state.view === "reclaimable") return ""
  if (state.view === "activity") return COPY.activity_note
  const minimumSize = state.data.last_scan &&
    Number.isFinite(state.data.last_scan.candidate_min_bytes)
    ? state.data.last_scan.candidate_min_bytes
    : candidateSize()
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
      <button class="vault-text-button" type="button" data-page="previous" ${page.hasPrevious ? "" : "disabled"}>${esc(COPY.previous)}</button>
      <span class="vault-page-range">${page.start + 1}–${page.end} of ${page.total}</span>
      <button class="vault-text-button" type="button" data-page="next" ${page.hasNext ? "" : "disabled"}>${esc(COPY.next)}</button>
    </span>`
}

const storageSummaryMarkup = (segments, logicalBytes) => {
  const barBytes = Math.max(logicalBytes, 1)
  const visible = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => Object.assign({}, segment, {
      percent: Math.min(100, (segment.value / barBytes) * 100)
    }))
  const ariaLabel = segments.map((segment) =>
    `${segment.label}: ${fmt(segment.value)}`).join(". ")
  const track = visible.map((segment) => `
    <span class="vault-storage-segment ${segment.kind}" style="--vault-segment-share:${segment.percent.toFixed(4)}%"></span>`).join("")
  const legend = visible.map((segment) => `
    <span class="vault-storage-key ${segment.kind}">
      <i aria-hidden="true"></i><span>${esc(segment.label)}</span><strong>${fmt(segment.value)}</strong>
    </span>`).join("")
  return `
    <div class="vault-storage-chart" role="img" aria-label="${attr(ariaLabel)}">
      <div class="vault-storage-track" aria-hidden="true">${track}</div>
      <div class="vault-storage-legend" aria-hidden="true">${legend}</div>
    </div>`
}

const automaticModeMarkup = () => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED || !state.automaticMode) return ""
  const automatic = state.automaticMode === "automatic"
  const label = automatic ? COPY.automatic : COPY.manual
  return `<details class="vault-auto-mode ${automatic ? "automatic" : "manual"}" id="vault-auto-mode">
    <summary aria-label="Automatic checking: ${attr(label)}">
      <span class="vault-auto-mode-dot" aria-hidden="true"></span>
      <span>${esc(label)}</span>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </summary>
    <div class="vault-auto-mode-popover" role="menu">
      <button type="button" role="menuitemradio" aria-checked="${automatic}" data-automatic-mode="automatic" ${state.automaticModeUpdating ? "disabled" : ""}>
        <span><strong>${esc(COPY.automatic)}</strong><small>${esc(COPY.automatic_description)}</small></span>
        <i class="fa-solid fa-check" aria-hidden="true"></i>
      </button>
      <button type="button" role="menuitemradio" aria-checked="${!automatic}" data-automatic-mode="manual" ${state.automaticModeUpdating ? "disabled" : ""}>
        <span><strong>${esc(COPY.manual)}</strong><small>${esc(COPY.manual_description)}</small></span>
        <i class="fa-solid fa-check" aria-hidden="true"></i>
      </button>
    </div>
  </details>`
}

const appSetupRequired = () => IS_APP_MODE && state.data &&
  state.data.global_scan_ready !== true

const restoreAutomaticModeMenu = (open) => {
  const modeMenu = el("vault-auto-mode")
  if (modeMenu && open) modeMenu.open = true
}

const dismissAutomaticScanCoachmark = (restoreFocus = false) => {
  const coachmark = el("vault-scan-coachmark")
  const control = el("vault-app-scan-control")
  const scanButton = el("btn-scan")
  state.automaticScanCoachmarkSignature = null
  if (coachmark) coachmark.hidden = true
  if (control) control.classList.remove("coachmark-visible")
  if (scanButton && scanButton.getAttribute("aria-describedby") ===
      "vault-scan-coachmark-instruction vault-scan-coachmark-disclosure") {
    scanButton.removeAttribute("aria-describedby")
  }
  if (restoreFocus && scanButton && scanButton.isConnected &&
      !scanButton.disabled) {
    scanButton.focus()
  }
}

const presentAutomaticScanCoachmark = (scanButton, signature) => {
  const coachmark = el("vault-scan-coachmark")
  const control = el("vault-app-scan-control")
  const actionLabel = el("vault-scan-coachmark-action")
  state.automaticScanPendingSignature = null
  if (!coachmark || !control || !actionLabel || !signature ||
      automaticScanCoachmarkSeen(signature)) return
  rememberAutomaticScanCoachmark(signature)
  state.automaticScanCoachmarkSignature = signature
  actionLabel.textContent = scanButton.textContent.trim()
  coachmark.hidden = false
  control.classList.add("coachmark-visible")
  scanButton.setAttribute("aria-describedby",
    "vault-scan-coachmark-instruction vault-scan-coachmark-disclosure")
  requestAnimationFrame(() => {
    if (state.automaticScanCoachmarkSignature !== signature ||
        !scanButton.isConnected ||
        scanButton.disabled || scanActive(state.data && state.data.scan)) {
      return
    }
    scanButton.focus()
  })
}

const syncAutomaticScanCoachmark = (scanButton, activeScan) => {
  if (!IS_APP_MODE || !AUTOMATIC_SUPPORTED) return
  if (activeScan || scanButton.disabled) {
    if (state.automaticScanCoachmarkSignature) {
      dismissAutomaticScanCoachmark()
    }
    return
  }
  if (state.automaticScanCoachmarkSignature) return
  const signature = state.automaticScanPendingSignature
  if (!signature) return
  presentAutomaticScanCoachmark(scanButton, signature)
}

const renderSetupOverview = () => {
  const metrics = el("vault-metrics")
  const existingModeMenu = el("vault-auto-mode")
  const modeMenuOpen = !!(existingModeMenu && existingModeMenu.open)
  metrics.classList.add("summary")
  metrics.innerHTML = `
    <div class="vault-summary-main">
      <div class="vault-summary-label"><i class="fa-solid fa-hard-drive"></i><span>${esc(COPY.save_space)}</span>${automaticModeMarkup()}</div>
      <div class="vault-summary-value">${esc(COPY.setup_title)}</div>
      <p class="vault-setup-copy">${esc(COPY.setup_description)}${AUTOMATIC_SUPPORTED ? ` ${esc(COPY.setup_automatic_description)}` : ""}</p>
    </div>
    <div class="vault-summary-side"></div>`
  restoreAutomaticModeMenu(modeMenuOpen)

  const scanButton = el("btn-scan")
  scanButton.innerHTML = `<i class="fa-solid fa-arrow-right" aria-hidden="true"></i>${esc(COPY.setup_disk_saver)}`
  scanButton.classList.add("primary")
  scanButton.disabled = false
  const candidateSizeSelect = el("vault-candidate-size")
  if (candidateSizeSelect) candidateSizeSelect.hidden = true
  const scanState = el("vault-scan-state")
  scanState.classList.remove("show")
  scanState.innerHTML = ""
  if (state.automaticScanCoachmarkSignature) {
    dismissAutomaticScanCoachmark()
  }
}

const renderNormalOverview = () => {
  const data = state.data
  const last = data.last_scan
  const activeScan = scanActive(data.scan)
  const scanning = scanMatchesContext(data.scan)
  const busyElsewhere = activeScan && !scanning
  const actionableDuplicates = Math.max(0, Number(
    data.inventory && data.inventory.shareable_duplicates) || 0)
  const metrics = el("vault-metrics")
  const existingModeMenu = el("vault-auto-mode")
  const modeMenuOpen = !!(existingModeMenu && existingModeMenu.open)
  metrics.classList.add("summary")
  {
    const fallbackLogicalBytes = IS_APP_MODE
      ? Number(last && last.bytes_total)
      : Number(data.bytes_without_sharing)
    const logicalBytes = Math.max(
      0,
      Number.isFinite(data.logical_bytes)
        ? data.logical_bytes
        : fallbackLogicalBytes || 0
    )
    const pendingBytes = Math.max(0, Number(data.pending_bytes) || 0)
    const savedBytes = Math.max(0, Number(data.saved_by_sharing) || 0)
    const sharedLogicalBytes = Math.max(
      0, Number(data.shared_logical_bytes) || 0)
    const uniqueBytes = Math.max(
      0, logicalBytes - sharedLogicalBytes - pendingBytes)
    const stillUsedBytes = Math.max(
      0, logicalBytes - savedBytes - pendingBytes)
    const hasSummary = IS_APP_MODE
      ? !!(last && Number.isFinite(last.bytes_total) &&
        Number.isFinite(data.logical_bytes) &&
        Number.isFinite(data.shared_logical_bytes) &&
        Number.isFinite(data.pending_bytes))
      : Number.isFinite(data.logical_bytes) &&
        Number.isFinite(data.saved_by_sharing) &&
        Number.isFinite(data.pending_bytes) &&
        (!!last || logicalBytes > 0 || savedBytes > 0 || pendingBytes > 0)
    const headline = hasSummary
      ? (IS_APP_MODE
          ? COPY.storage_unique_headline.replace("{size}", fmt(uniqueBytes))
          : COPY.storage_saved_headline.replace("{size}", fmt(savedBytes)))
      : (IS_APP_MODE ? COPY.find_app_savings : COPY.find_savings)
    const segments = IS_APP_MODE
      ? [
          { label: COPY.storage_unique, value: uniqueBytes, kind: "occupied" },
          { label: COPY.storage_shared, value: sharedLogicalBytes, kind: "optimized" },
          { label: COPY.storage_can_save, value: pendingBytes, kind: "potential" }
        ]
      : [
          { label: COPY.storage_still_used, value: stillUsedBytes, kind: "occupied" },
          { label: COPY.storage_saved, value: savedBytes, kind: "optimized" },
          { label: COPY.storage_can_save, value: pendingBytes, kind: "potential" }
        ]
    const summary = hasSummary
      ? storageSummaryMarkup(segments, logicalBytes)
      : ""
    const opportunity = activeScan
      ? ""
      : pendingBytes
        ? `<span class="vault-summary-state attention"><i class="fa-regular fa-copy"></i><strong>${esc(COPY.more_can_be_saved.replace("{size}", fmt(pendingBytes)))}</strong></span>${state.view === "duplicates" ? "" : `<button class="vault-button primary" type="button" id="btn-review-metric">${esc(COPY.review_files)}</button>`}`
        : `<span class="vault-summary-state"><i class="fa-regular fa-circle-check"></i>${esc(COPY.nothing_more_to_save)}</span>`
    const freshness = last
      ? `${last.partial ? `${COPY.partial_results} · ` : ""}${COPY.scanned} ${timeAgo(last.ts)}`
      : COPY.not_scanned
    const summarySide = opportunity
      ? `${opportunity}<span class="vault-summary-divider" aria-hidden="true"></span><span class="vault-summary-freshness">${esc(freshness)}</span>`
      : `<span class="vault-summary-freshness">${esc(freshness)}</span>`
    metrics.innerHTML = `
      <div class="vault-summary-main">
        <div class="vault-summary-label"><i class="fa-solid fa-hard-drive"></i><span>${esc(COPY.save_space)}</span>${automaticModeMarkup()}</div>
        <div class="vault-summary-value">${esc(headline)}</div>
        ${summary}
      </div>
      <div class="vault-summary-side">${summarySide}</div>`
    restoreAutomaticModeMenu(modeMenuOpen)
  }
  const idleScanLabel = IS_APP_MODE
    ? (last ? COPY.scan_again : COPY.scan_app)
    : (last ? COPY.scan_again : COPY.scan)
  const scanButton = el("btn-scan")
  scanButton.innerHTML = scanning
    ? `<i class="fa-solid fa-xmark"></i>${esc(state.scanCancelRequested ? COPY.cancelling : COPY.cancel_scan)}`
    : activeScan
      ? `<i class="fa-solid fa-circle-notch fa-spin"></i>${esc(COPY.scanning)}`
    : `<i class="fa-solid fa-rotate"></i>${esc(idleScanLabel)}`
  const firstScan = !last && !activeScan
  const scanIsPrimary = firstScan || (!activeScan && !actionableDuplicates)
  scanButton.classList.toggle("primary", scanIsPrimary)
  scanButton.disabled = busyElsewhere || state.scanCancelRequested
  const candidateSizeSelect = el("vault-candidate-size")
  if (candidateSizeSelect) {
    candidateSizeSelect.hidden = false
    candidateSizeSelect.disabled = activeScan
  }
  syncAutomaticScanCoachmark(scanButton, activeScan)
  const scanControl = el("vault-scan-control")
  if (scanControl) scanControl.classList.toggle("single", activeScan)
  const scanSizeMenu = el("vault-scan-size-menu")
  if (scanSizeMenu) {
    const scanSizeTrigger = scanSizeMenu.querySelector("summary")
    if (scanSizeTrigger) {
      scanSizeTrigger.classList.toggle("primary", firstScan)
    }
    scanSizeMenu.hidden = activeScan
    if (activeScan) scanSizeMenu.open = false
  }
  renderCandidateSizeControl()
  const scanState = el("vault-scan-state")
  if (busyElsewhere) {
    scanState.classList.add("show")
    scanState.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><strong>${esc(COPY.scanning_elsewhere)}</strong><span class="vault-scan-detail">${esc(COPY.scanning_elsewhere_hint)}</span>`
    return
  }
  if (scanning) {
    const scan = data.scan
    const scanPhase = scan.phase || "discovering"
    const queued = scanPhase === "queued"
    const walking = scanPhase === "discovering"
    const hashing = scanPhase === "hashing"
    const finishing = scanPhase === "publishing"
    const currentFileSize = Math.max(0, Number(scan.current_file_size) || 0)
    const currentFileBytes = Math.min(currentFileSize, Math.max(0, Number(scan.current_file_bytes) || 0))
    const scanSource = scan.scope_id ? sourceById(scan.scope_id) : null
    const scanProgressLabel = scanSource
      ? COPY.scan_location.replace("{location}", scanSource.label)
      : COPY.scan_progress
    const phaseName = queued
      ? COPY.scan_queued
      : walking
        ? scanProgressLabel
        : finishing
          ? COPY.scan_finishing
          : COPY.scan_analyzing
    const step = queued ? null : walking ? 1 : finishing ? 3 : 2
    const phase = step
      ? `${COPY.scan_step.replace("{current}", step)} · ${phaseName}`
      : phaseName
    const hashWorkBytes = Math.max(
      0, Number(scan.hash_work_bytes) || 0)
    const completedHashBytes = Math.min(
      hashWorkBytes,
      Math.max(0, Number(scan.hash_bytes_completed) || 0) +
        (hashing ? currentFileBytes : 0)
    )
    const hashRatio = hashWorkBytes
      ? Math.min(1, completedHashBytes / hashWorkBytes)
      : 0
    const details = hashing && hashWorkBytes
      ? [COPY.scan_hash_progress
          .replace("{done}", fmt(completedHashBytes))
          .replace("{total}", fmt(hashWorkBytes))
          .replace("{percent}", Math.floor(hashRatio * 100))]
      : [
          `${scan.dirs || 0} ${COPY.scan_folders}`,
          `${scan.files || 0} ${COPY.scan_files}`,
          fmt(scan.bytes_total || 0)
        ]
    if (scan.current_file) {
      const fileProgress = currentFileSize
        ? ` (${COPY.scan_file_bytes.replace("{done}", fmt(currentFileBytes)).replace("{total}", fmt(currentFileSize))})`
        : ""
      details.push(`${COPY.analyzing} ${scan.current_file}${fileProgress}`)
    }
    const progress = hashing && hashWorkBytes
      ? `<span class="vault-progress-track" role="progressbar" aria-label="${attr(phaseName)}" aria-valuemin="0" aria-valuemax="${hashWorkBytes}" aria-valuenow="${completedHashBytes}"><span class="vault-progress-bar determinate" style="--vault-progress:${hashRatio}"></span></span>`
      : `<span class="vault-progress-track" role="progressbar" aria-label="${attr(phaseName)}" aria-valuetext="${attr(`${details.join(" · ")}. ${finishing ? COPY.scan_finishing_help : phaseName}.`)}"><span class="vault-progress-bar indeterminate"></span></span>`
    scanState.classList.add("show")
    scanState.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><strong>${esc(phase)}</strong><span class="vault-scan-detail">${esc(details.join(" · "))}</span>${progress}`
  } else {
    scanState.classList.remove("show")
    scanState.innerHTML = ""
  }
}

const renderOverview = () => {
  if (appSetupRequired()) {
    renderSetupOverview()
    return
  }
  renderNormalOverview()
}

const renderResult = () => {
  const result = el("vault-result")
  if (!state.scanResult) {
    const scan = state.data && state.data.scan
    const preview = scanMatchesContext(scan) && scan.preview
    const groups = preview && Array.isArray(preview.groups)
      ? preview.groups
      : []
    if (groups.length) {
      const count = Math.max(0, Number(preview.duplicate_files) || 0)
      const detail = COPY.scan_preview_detail
        .replace("{count}", count)
        .replace("{size}", fmt(preview.bytes || 0))
      const groupDetails = groups.map((group) => {
        const groupDetail = COPY.scan_preview_group
          .replace("{files}", countLabel(
            Number(group.locations) || 0, COPY.file, COPY.files))
          .replace("{size}", fmt(group.bytes || 0))
        const representative = group.representative_path
          ? `${group.representative_path} · `
          : ""
        return `<div class="vault-result-path"><span class="vault-result-path-dot" aria-hidden="true"></span><span>${esc(`${representative}${groupDetail}`)}</span></div>`
      }).join("")
      const toggleLabel = state.scanPreviewOpen
        ? COPY.hide_matches
        : COPY.view_matches
      result.className = `vault-result show preview${state.scanPreviewOpen ? " expanded" : ""}`
      result.innerHTML = `<div class="vault-result-message"><i class="fa-regular fa-copy"></i><span class="vault-result-heading"><strong>${esc(COPY.scan_preview)}</strong><span>${esc(detail)}</span></span><button class="vault-result-toggle" type="button" id="btn-scan-preview" aria-expanded="${state.scanPreviewOpen}" aria-controls="vault-preview-paths">${esc(toggleLabel)}<i class="fa-solid fa-chevron-down"></i></button></div><div class="vault-result-paths" id="vault-preview-paths"${state.scanPreviewOpen ? "" : " hidden"}>${groupDetails}</div>`
      return
    }
    result.className = "vault-result"
    result.innerHTML = ""
    return
  }
  const info = state.scanResult
  const duplicateLabel = countLabel(info.count, COPY.duplicate.toLowerCase(), COPY.duplicates.toLowerCase())
  const review = info.count && state.view !== "duplicates"
    ? `<button class="vault-button primary" type="button" id="btn-review-result">${esc(COPY.review)} ${duplicateLabel}<i class="fa-solid fa-chevron-right"></i></button>`
    : ""
  if (info.partial) {
    result.className = `vault-result show incomplete${state.scanProblemsOpen ? " expanded" : ""}`
    const unreadableLabel = `${info.inaccessible} ${info.inaccessible === 1 ? COPY.scan_unreadable_path : COPY.scan_unreadable_paths}`
    const exclusions = info.exclusions
    const viewLabel = exclusions.length === 1
      ? COPY.view_unreadable_path
      : COPY.view_unreadable_paths
    const paths = exclusions.map((exclusion) =>
      `<div class="vault-result-path"><span class="vault-result-path-dot" aria-hidden="true"></span><span>${esc(exclusion.path)} · ${esc(String(exclusion.reason || COPY.scan_not_analyzed).replaceAll("_", " "))}</span></div>`
    ).join("")
    const toggle = exclusions.length
      ? `<button class="vault-result-toggle" type="button" id="btn-scan-problems" aria-expanded="${state.scanProblemsOpen}" aria-controls="vault-result-paths">${esc(viewLabel)}<i class="fa-solid fa-chevron-down"></i></button>`
      : ""
    const pathDetails = exclusions.length
      ? `<div class="vault-result-paths" id="vault-result-paths"${state.scanProblemsOpen ? "" : " hidden"}>${paths}</div>`
      : ""
    result.innerHTML = `<div class="vault-result-message"><i class="fa-solid fa-triangle-exclamation"></i><span class="vault-result-heading"><strong>${esc(COPY.scan_completed_with_exclusions)}</strong><span>${esc(`${unreadableLabel}. ${COPY.scan_partial_rest}`)}</span></span><span class="vault-result-actions">${toggle}${review}</span></div>${pathDetails}`
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
const fileActionButtons = () => document.querySelectorAll("[data-deduplicate-all], [data-deduplicate-selected], [data-deduplicate-scope], [data-deduplicate-file], [data-detach], [data-separate-selected]")
const fileActionLabel = (action) => ({
  "deduplicate-file": COPY.deduplicating_file,
  "make-separate": COPY.making_separate
}[action.kind] || COPY.deduplicating)
const serverFileAction = (action) => {
  if (!action || typeof action !== "object") return null
  if (action.kind === "deduplicate") {
    return {
      kind: action.kind,
      scope_id: action.scope_id || null,
      files_completed: Math.max(0, Number(action.files_completed) || 0),
      files_total: Math.max(0, Number(action.files_total) || 0)
    }
  }
  if (action.kind === "deduplicate-files") {
    return {
      kind: action.kind,
      files_completed: Math.max(0, Number(action.files_completed) || 0),
      files_total: Math.max(0, Number(action.files_total) || 0)
    }
  }
  if (action.kind === "separate-files") {
    return {
      kind: action.kind,
      files_completed: Math.max(0, Number(action.files_completed) || 0),
      files_total: Math.max(0, Number(action.files_total) || 0),
      all_matching: !!action.all_matching,
      cancelable: !!action.cancelable,
      cancel_requested: !!action.cancel_requested
    }
  }
  if (!action.path) return null
  return { kind: action.kind, path: action.path }
}
let renderedActionProgress = null
const renderActionProgress = () => {
  const container = el("vault-action-state")
  if (!container) return
  const action = state.actionProgress
  for (const button of fileActionButtons()) {
    const active = !!(action && (
      (action.kind === "deduplicate" && (
        button.dataset.deduplicateScope === action.scope_id ||
        (button.hasAttribute("data-deduplicate-all") &&
          (button.dataset.deduplicateContext || null) === action.scope_id)
      )) ||
      (action.kind === "deduplicate-files" &&
        button.hasAttribute("data-deduplicate-selected")) ||
      (action.kind === "deduplicate-file" && button.dataset.deduplicateFile === action.path) ||
      (action.kind === "separate-files" && button.hasAttribute("data-separate-selected")) ||
      (action.kind === "make-separate" &&
        button.dataset.detach === action.path)
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
  if (action.kind === "deduplicate" ||
      action.kind === "deduplicate-files" ||
      action.kind === "separate-files") {
    const completed = Math.max(0, Number(action.files_completed) || 0)
    const total = Math.max(completed, Number(action.files_total) || 0)
    const ratio = total ? Math.min(1, completed / total) : 0
    label = action.kind === "separate-files" ? COPY.making_separate_selected : COPY.deduplicating
    detail = (action.kind === "separate-files" ? COPY.separate_progress : COPY.deduplication_progress)
      .replace("{done}", completed)
      .replace("{total}", total)
    progress = `<span class="vault-progress-track" role="progressbar" aria-label="${attr(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}"><span class="vault-progress-bar determinate" style="--vault-progress:${ratio}"></span></span>`
  } else {
    label = fileActionLabel(action)
    detail = basename(action.path)
    progress = `<span class="vault-progress-track" role="progressbar" aria-label="${attr(label)}" aria-valuetext="${attr(`${label}: ${detail}`)}"><span class="vault-progress-bar indeterminate"></span></span>`
  }
  const cancel = action.cancelable
    ? `<button class="vault-button" type="button" data-cancel-file-action ${action.cancel_requested ? "disabled" : ""}>${esc(action.cancel_requested ? COPY.cancelling : COPY.cancel)}</button>`
    : ""
  container.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><strong>${esc(label)}</strong><span class="vault-action-detail">${esc(detail)}</span>${progress}${cancel}`
  renderedActionProgress = action
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
  notice.className = "vault-cleanup-notice show"
  notice.innerHTML = `<i class="fa-regular fa-trash-can" aria-hidden="true"></i><strong>${esc(title)}</strong><button class="vault-button" id="btn-review-cleanup" type="button">${esc(COPY.review_cleanup)}<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`
}

const clearPanel = (id, className) => {
  const panel = el(id)
  panel.className = className
  panel.innerHTML = ""
}

const renderSetupWorkspace = () => {
  renderSetupOverview()
  renderFeedback()
  el("vault-explorer").style.display = "none"
  clearPanel("vault-action-state", "vault-action-state")
  clearPanel("vault-result", "vault-result")
  clearPanel("vault-cleanup-notice", "vault-cleanup-notice")
  renderedActionProgress = null
}

const render = () => {
  if (!state.data) return
  const setupRequired = appSetupRequired()
  const body = document.querySelector(".vault-body")
  if (body) body.classList.toggle("setup-required", setupRequired)
  if (setupRequired) {
    renderSetupWorkspace()
    return
  }
  renderOverview()
  renderFeedback()
  renderResult()
  renderCleanupNotice()
  if (!state.data.enabled) {
    el("vault-explorer").style.display = "none"
    return
  }
  el("vault-explorer").style.display = ""
  const items = buildItems()
  const groupedDuplicates = state.view === "duplicates" &&
    state.displayMode === "files" &&
    items.some((item) => item.kind === "duplicate_group")
  const visibleSeparatePaths = new Set(selectablePagePaths(items))
  const visibleDuplicatePaths = new Set(
    selectableDuplicatePagePaths(items))
  if (state.separateAllMatching &&
      !(Number(state.data.inventory.current.separate_count) > 0)) {
    clearSeparateSelection()
  }
  for (const filePath of state.selectedSeparateFiles) {
    if (!visibleSeparatePaths.has(filePath)) {
      state.selectedSeparateFiles.delete(filePath)
    }
  }
  if (!groupedDuplicates) {
    for (const filePath of state.selectedDuplicateFiles.keys()) {
      if (!visibleDuplicatePaths.has(filePath)) {
        state.selectedDuplicateFiles.delete(filePath)
      }
    }
  }
  if (state.revealPending && !state.revealWalking) {
    const root = treeLevel(state.sourceId, "")
    if (root && root.loaded) {
      state.revealWalking = true
      walkToReveal().finally(() => { state.revealWalking = false })
    }
  }
  renderViews()
  renderExternalPrompt()
  renderFolderDiscovery()
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
const loadPagedChildren = async (cache, key, buildUrl, append) => {
  const generation = state.duplicateGroupGeneration
  const current = cache.get(key) || {
    items: [],
    total: 0,
    nextCursor: null,
    loaded: false,
    loading: false,
    error: null
  }
  if (current.loading) return
  current.loading = true
  current.error = null
  cache.set(key, current)
  render()
  try {
    const result = await fetchJson(
      buildUrl(append ? current.nextCursor : null))
    if (generation !== state.duplicateGroupGeneration) return
    const items = Array.isArray(result.items) ? result.items : []
    current.items = append ? current.items.concat(items) : items
    current.total = Math.max(0, Number(result.total) || 0)
    current.nextCursor = result.next_cursor || null
    current.loaded = true
  } catch (error) {
    if (generation !== state.duplicateGroupGeneration) return
    current.error = error && error.message
      ? error.message
      : String(error)
  } finally {
    if (generation === state.duplicateGroupGeneration) {
      current.loading = false
      render()
    }
  }
}
const loadDuplicateGroupChildren = (hash, append = false) =>
  loadPagedChildren(state.duplicateGroupChildren, hash, (cursor) =>
    duplicateGroupUrl(hash, { cursor }), append)
const loadFileLocations = (filePath, append = false) =>
  loadPagedChildren(state.fileLocations, filePath, (cursor) =>
    fileLocationsUrl(filePath, { cursor }), append)
const duplicateGroupSelectionPaths = async (hash) =>
  fetchJson(duplicateGroupUrl(hash, { select: true }))
const duplicateGroupPageSelectionItems = async () =>
  fetchJson(duplicateGroupPageSelectionUrl())
const settleFolderDiscoveryStart = () => {
  if (!state.folderDiscoveryStarting ||
      state.folderDiscoveryChoosingRoot) return
  state.folderDiscoveryStarting = false
  state.folderDiscoveryLocalError = null
}
const applyFullData = (data) => {
  if (!state.candidateSizeInitialized) {
    const saved = Number(data && data.candidate_min_bytes)
    const fallback = Number(data && data.global_candidate_min_bytes)
    const selected = candidateSizeOptions.includes(saved) ? saved : fallback
    state.candidateSize = candidateSizeOptions.includes(selected)
      ? selected
      : defaultCandidateSize
    state.persistedCandidateSize = state.candidateSize
    state.candidateSizeInitialized = true
  }
  const scanning = scanActive(data.scan)
  const findingFolders = folderDiscoveryActive(data.folder_discovery)
  const contextualScan = !IS_APP_MODE || !data.scan || data.scan.scope_id === SCOPE_ID
  const completed = state.scanRequested && !scanning && data.last_scan && data.last_scan.ts !== state.scanBaseline
  const partial = contextualScan && !scanning && (
    (data.scan && data.scan.phase === "completed_with_exclusions") ||
    (completed && data.last_scan && data.last_scan.partial)
  )
  const cancelled = contextualScan && !scanning && data.scan && data.scan.phase === "cancelled"
  const failed = contextualScan && state.scanRequested && !scanning && data.scan && data.scan.error
  const shareableDuplicateCount = Number(data.inventory.shareable_duplicates) || 0
  const unreviewed = !scanning && data.last_scan &&
    reviewedScan() !== String(data.last_scan.ts) &&
    (shareableDuplicateCount > 0 || data.last_scan.partial)
  settleFolderDiscoveryStart()
  const publishedScan = data.last_scan ? data.last_scan.ts : null
  if (publishedScan !== state.locationsScanTs) {
    state.locationsScanTs = publishedScan
    closeFileLocations()
    invalidateTreeLevels()
  }
  state.data = data
  const fileAction = serverFileAction(data.file_action)
  if (fileAction) state.actionProgress = fileAction
  else if (!state.actionRequest) state.actionProgress = null
  if (!scanning) state.scanCancelRequested = false
  if (!findingFolders) state.folderDiscoveryCancelRequested = false
  if (failed) {
    state.scanRequested = false
    state.feedback = { error: true, message: data.scan.error }
  } else if (cancelled) {
    state.scanRequested = false
    state.feedback = { error: false, message: COPY.scan_cancelled }
  } else if (completed || partial || (!state.scanResult && unreviewed)) {
    state.scanRequested = false
    const exclusions = Array.isArray(data.last_scan && data.last_scan.exclusions)
      ? data.last_scan.exclusions
      : Array.isArray(data.scan && data.scan.exclusions)
        ? data.scan.exclusions
        : []
    const resultPartial = partial ||
      !!(data.last_scan && data.last_scan.partial)
    state.scanResult = {
      count: Number(data.inventory.shareable_duplicates) || 0,
      locations: Number(data.inventory.duplicate_locations) || 0,
      bytes: Number(data.pending_bytes) || 0,
      skipped: exclusions.length,
      partial: resultPartial,
      inaccessible: exclusions.length,
      exclusions
    }
  }
  render()
  return scanning || findingFolders || !!fileAction
}
let refreshSequence = 0
const refresh = async (forceFull = false) => {
  const sequence = ++refreshSequence
  let delay = null
  try {
    const progressOnly = !forceFull &&
      !!(state.data && (
        scanActive(state.data.scan) ||
        folderDiscoveryActive(state.data.folder_discovery) ||
        state.actionProgress
      ))
    if (progressOnly) {
      const progress = await fetchJson(statusUrl(true))
      if (sequence !== refreshSequence) return
      state.data.scan = progress.scan
      state.data.last_scan = progress.last_scan
      state.data.folder_discovery = progress.folder_discovery
      settleFolderDiscoveryStart()
      const fileAction = serverFileAction(progress.file_action)
      if (fileAction) state.actionProgress = fileAction
      else if (!state.actionRequest) state.actionProgress = null
      if (scanActive(progress.scan) ||
          folderDiscoveryActive(progress.folder_discovery) ||
          fileAction) {
        delay = 1500
        if (appSetupRequired()) {
          renderSetupWorkspace()
        } else {
          renderOverview()
          renderResult()
          renderActionProgress()
          renderFeedback()
          renderExternalPrompt()
          renderFolderDiscovery()
        }
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
    return true
  } catch (error) {
    if (sequence !== refreshSequence) return
    state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
    renderFeedback()
    delay = 5000
    return false
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
      if (result.activity_warning) {
        state.feedback = {
          error: true,
          message: [state.feedback && state.feedback.message, COPY.activity_write_failed]
            .filter(Boolean).join(" ")
        }
      }
    }
  } catch (error) {
    state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
  }
  closeFileLocations()
  // A file action changes what the rows say without publishing a scan, so the
  // fetched levels have to go even though the scan timestamp has not moved.
  invalidateTreeLevels()
  await refresh(true)
}

const deduplicateFeedback = (result) => {
  const unavailable = result.unavailable || 0
  const waiting = (result.locked || 0) + (result.incompatible || 0) + (result.failed || 0)
  const messages = []
  if (result.converted || result.bytes_saved) messages.push(`${COPY.converted}: ${fmt(result.bytes_saved || 0)}.`)
  if (result.stale) messages.push(COPY.changed_since_scan)
  if (unavailable) {
    const label = COPY.files_cannot_deduplicate.replace(
      "{count}", countLabel(unavailable))
    const reasonEntries = Object.entries(result.unavailable_by_reason || {})
      .filter((entry) => Number(entry[1]) > 0)
    const reasons = reasonEntries.length === 1 &&
      Number(reasonEntries[0][1]) === unavailable
      ? unavailableLabel({ unavailable_reason: reasonEntries[0][0] })
      : reasonEntries.map(([reason, count]) =>
        `${countLabel(Number(count))} — ${unavailableLabel({
          unavailable_reason: reason
        })}`).join("; ")
    messages.push(`${label}${reasons ? `: ${reasons}` : ""}.`)
  }
  if (waiting) messages.push(`${COPY.files_still_waiting.replace("{count}", countLabel(waiting))}.`)
  if (!result.stale && !unavailable && !waiting) return messages.join(" ") || `${COPY.converted}: ${fmt(0)}`
  return {
    error: true,
    message: messages.join(" ")
  }
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
    unavailable: unavailableLabel(result),
    conflict: COPY.separate_conflict,
    "not-found": COPY.separate_not_found
  }
  return { error: true, message: messages[result.status] || COPY.action_not_completed }
}

const showDeduplicationProgress = (scopeId, progress, fallbackTotal) => {
  const completed = Math.max(0, Number(progress.files_completed) || 0)
  const total = Math.max(completed, Number(progress.files_total) || fallbackTotal)
  const current = state.actionProgress
  if (current &&
      current.kind === "deduplicate" &&
      current.scope_id === scopeId &&
      current.files_completed === completed &&
      current.files_total === total) return
  state.actionProgress = {
    kind: "deduplicate",
    scope_id: scopeId,
    files_completed: completed,
    files_total: total
  }
  renderActionProgress()
}

const trackDeduplication = (scopeId, total = null) => {
  const fallbackTotal = total === null
    ? scopeDuplicateCount(scopeId, true)
    : total
  let stopped = false
  let timer = null
  showDeduplicationProgress(scopeId, { files_completed: 0, files_total: fallbackTotal }, fallbackTotal)
  const poll = async () => {
    try {
      const status = await fetchJson(statusUrl(true))
      const action = serverFileAction(status.file_action)
      if (!stopped && action && action.kind === "deduplicate" &&
          action.scope_id === scopeId) {
        showDeduplicationProgress(scopeId, action, fallbackTotal)
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
        state.actionProgress.scope_id === scopeId) {
      state.actionProgress = null
    }
    renderActionProgress()
  }
}

const showSelectedDeduplicationProgress = (progress, fallbackTotal) => {
  const completed = Math.max(0, Number(progress.files_completed) || 0)
  const total = Math.max(
    completed,
    Number(progress.files_total) || fallbackTotal
  )
  const current = state.actionProgress
  if (current &&
      current.kind === "deduplicate-files" &&
      current.files_completed === completed &&
      current.files_total === total) return
  state.actionProgress = {
    kind: "deduplicate-files",
    files_completed: completed,
    files_total: total
  }
  renderActionProgress()
}

const trackSelectedDeduplication = (total) => {
  let stopped = false
  let timer = null
  showSelectedDeduplicationProgress({
    files_completed: 0,
    files_total: total
  }, total)
  const poll = async () => {
    try {
      const status = await fetchJson(statusUrl(true))
      const action = serverFileAction(status.file_action)
      if (!stopped &&
          action &&
          action.kind === "deduplicate-files") {
        showSelectedDeduplicationProgress(action, total)
      }
    } catch (error) {}
    if (!stopped) timer = setTimeout(poll, 250)
  }
  poll()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (state.actionProgress &&
        state.actionProgress.kind === "deduplicate-files") {
      state.actionProgress = null
    }
    renderActionProgress()
  }
}

const showBulkSeparateProgress = (progress, fallbackTotal) => {
  const completed = Math.max(0, Number(progress.files_completed) || 0)
  const total = Math.max(completed, Number(progress.files_total) || fallbackTotal)
  const current = state.actionProgress
  if (current && current.kind === "separate-files" &&
      current.files_completed === completed &&
      current.files_total === total &&
      current.cancelable === !!progress.cancelable &&
      current.cancel_requested === !!progress.cancel_requested) return
  state.actionProgress = {
    kind: "separate-files",
    files_completed: completed,
    files_total: total,
    all_matching: !!progress.all_matching,
    cancelable: !!progress.cancelable,
    cancel_requested: !!progress.cancel_requested
  }
  renderActionProgress()
}

const trackBulkSeparate = (total, allMatching = false) => {
  let stopped = false
  let timer = null
  showBulkSeparateProgress({
    files_completed: 0,
    files_total: total,
    all_matching: allMatching,
    cancelable: false
  }, total)
  const poll = async () => {
    try {
      const status = await fetchJson(statusUrl(true))
      const action = serverFileAction(status.file_action)
      if (!stopped && action && action.kind === "separate-files") {
        showBulkSeparateProgress(action, total)
      }
    } catch (error) {}
    if (!stopped) timer = setTimeout(poll, 250)
  }
  poll()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (state.actionProgress && state.actionProgress.kind === "separate-files") {
      state.actionProgress = null
    }
    renderActionProgress()
  }
}

const detachFeedback = (result) => {
  if (result.status === "detached") return COPY.separated
  const messages = {
    locked: COPY.separate_locked,
    stale: COPY.separate_changed,
    conflict: COPY.separate_conflict,
    "not-found": COPY.separate_not_found
  }
  return { error: true, message: messages[result.status] || COPY.action_not_completed }
}

const chooseExternalFolder = (title = COPY.add_external_folder) => new Promise((resolve, reject) => {
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
    params: { title, type: "folder" }
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

const startFolderDiscovery = async (folderPath) => {
  if (!folderPath || state.folderDiscoveryStarting) return
  state.folderDiscoveryStarting = true
  state.folderDiscoveryLocalError = null
  renderFolderDiscovery()
  try {
    resetFolderDiscoveryChoices()
    if (!await candidateSizeSaveTail) {
      state.folderDiscoveryStarting = false
      state.folderDiscoveryChoosingRoot = true
      renderFolderDiscovery()
      focusFolderDiscoveryDialog()
      return
    }
    const result = await post({
      action: "find_folders",
      path: folderPath
    })
    if (result.error) throw new Error(result.error)
    if (!result.started && !result.already_running) {
      throw new Error(COPY.action_not_completed)
    }
    state.folderDiscoveryChoosingRoot = false
    state.folderDiscoveryLocalError = null
    state.folderDiscoveryPage = 0
    state.folderDiscoveryCancelRequested = false
    const refreshed = await refresh(true)
    if (result.already_running && !state.folderDiscoveryStarting) {
      state.folderDiscoveryLocalError = COPY.find_already_running
      renderFolderDiscovery()
    } else if (!refreshed && state.folderDiscoveryStarting &&
        state.folderDiscoveryOpen) {
      state.folderDiscoveryLocalError = state.feedback &&
        state.feedback.error
        ? state.feedback.message
        : COPY.action_not_completed
      renderFolderDiscovery()
    }
    focusFolderDiscoveryDialog()
  } catch (error) {
    state.folderDiscoveryStarting = false
    state.folderDiscoveryChoosingRoot = true
    state.folderDiscoveryLocalError = error && error.message
      ? error.message
      : String(error)
    renderFolderDiscovery()
    focusFolderDiscoveryDialog()
  }
}

const beginFolderDiscovery = (opener = null) => {
  if (opener && typeof opener.focus === "function") {
    state.folderDiscoveryReturnFocus = opener
  }
  const returnToOpener = () => {
    const target = opener || state.folderDiscoveryReturnFocus
    if (target && target.isConnected) target.focus({ preventScroll: true })
    state.folderDiscoveryReturnFocus = null
  }
  if (!state.folderDiscoveryStarting) {
    state.folderDiscoveryLocalError = null
    state.feedback = null
    renderFeedback()
  }
  if (!(state.data && state.data.last_scan && state.data.last_scan.ts)) {
    state.feedback = { error: true, message: COPY.find_requires_scan }
    renderFeedback()
    returnToOpener()
    return
  }
  if (scanActive(state.data.scan)) {
    state.feedback = { error: true, message: COPY.find_wait_for_scan }
    renderFeedback()
    returnToOpener()
    return
  }
  state.folderDiscoveryOpen = true
  if (!state.folderDiscoveryStarting) {
    state.folderDiscoveryChoosingRoot = true
  }
  state.folderDiscoveryPage = 0
  state.folderDiscoveryCancelRequested = false
  renderFolderDiscovery()
  focusFolderDiscoveryDialog()
}

const closeAddMenu = () => {
  const menu = el("vault-add-menu")
  if (menu) menu.open = false
}
const closeScanSizeMenu = () => {
  const menu = el("vault-scan-size-menu")
  if (menu) menu.open = false
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button")
  if (!target) return
  if (target.dataset.openPath) {
    await openFileLocation(
      target.dataset.openPath,
      target.dataset.openSource,
      target.dataset.openKind,
      target.dataset.openLabel)
    return
  }
  if (target.hasAttribute("data-dismiss-automatic-scan-coachmark")) {
    dismissAutomaticScanCoachmark(true)
    return
  }
  if (target.hasAttribute("data-automatic-mode")) {
    const mode = target.dataset.automaticMode
    const menu = el("vault-auto-mode")
    if (mode === state.automaticMode) {
      if (menu) menu.open = false
      return
    }
    state.automaticModeUpdating = true
    renderOverview()
    try {
      const result = await post({
        action: "automatic_set_mode",
        app: APP_NAME,
        mode
      })
      if (result.error) throw new Error(result.error)
      state.automaticMode = result.mode
      notifyAutomaticModeChanged(result.mode)
    } catch (error) {
      state.feedback = {
        error: true,
        message: error && error.message ? error.message : String(error)
      }
      renderFeedback()
    } finally {
      state.automaticModeUpdating = false
      renderOverview()
      const currentMenu = el("vault-auto-mode")
      if (currentMenu) currentMenu.open = false
    }
    return
  }
  if (state.folderDiscoverySubmitting &&
      target.closest("#vault-find-overlay")) return
  if (target.hasAttribute("data-candidate-size")) {
    const size = Number(target.dataset.candidateSize)
    if (candidateSizeOptions.includes(size)) {
      closeScanSizeMenu()
      await saveCandidateSize(size)
    }
    return
  }
  if (target.id === "btn-find-folders" ||
      target.hasAttribute("data-find-folders")) {
    const addMenu = el("vault-add-menu")
    const opener = target.id === "btn-find-folders" && addMenu
      ? addMenu.querySelector("summary")
      : target
    closeAddMenu()
    state.folderDiscoveryLocalError = null
    state.folderDiscoveryPage = 0
    beginFolderDiscovery(opener)
    return
  }
  if (target.hasAttribute("data-find-home-folder")) {
    await startFolderDiscovery(HOME_PATH)
    return
  }
  if (target.hasAttribute("data-find-other-folder")) {
    target.disabled = true
    try {
      const folderPath = await chooseExternalFolder(
        COPY.find_folders_picker)
      if (folderPath) {
        await startFolderDiscovery(folderPath)
      } else if (state.folderDiscoveryOpen &&
          state.folderDiscoveryChoosingRoot) {
        target.disabled = false
        target.focus({ preventScroll: true })
      }
    } catch (error) {
      state.folderDiscoveryLocalError = error && error.message
        ? error.message
        : String(error)
      renderFolderDiscovery()
      focusFolderDiscoveryDialog()
    } finally {
      if (target.isConnected) target.disabled = false
    }
    return
  }
  if (target.hasAttribute("data-close-find-folders")) {
    if (state.folderDiscoveryChoosingRoot ||
        state.folderDiscoveryStarting) {
      closeFolderDiscoveryModal()
      return
    }
    if (folderDiscoveryActive(
      state.data && state.data.folder_discovery
    )) {
      state.folderDiscoveryCancelRequested = true
      renderFolderDiscovery()
      try {
        await post({ action: "cancel_find_folders" })
        closeFolderDiscoveryModal()
        await refresh()
      } catch (error) {
        state.folderDiscoveryCancelRequested = false
        state.folderDiscoveryLocalError = error && error.message
          ? error.message
          : String(error)
        renderFolderDiscovery()
      }
    } else {
      target.disabled = true
      try {
        const result = await post({ action: "clear_find_folders" })
        if (result.error) throw new Error(result.error)
        closeFolderDiscoveryModal()
        resetFolderDiscoveryChoices()
        await refresh(true)
      } catch (error) {
        target.disabled = false
        state.folderDiscoveryLocalError = error && error.message
          ? error.message
          : String(error)
        renderFolderDiscovery()
      }
    }
    return
  }
  if (target.hasAttribute("data-cancel-find-folders")) {
    target.disabled = true
    state.folderDiscoveryCancelRequested = true
    renderFolderDiscovery()
    try {
      const result = await post({ action: "cancel_find_folders" })
      if (!result.cancel_requested) {
        throw new Error(COPY.action_not_completed)
      }
      closeFolderDiscoveryModal()
      await refresh()
    } catch (error) {
      state.folderDiscoveryCancelRequested = false
      state.folderDiscoveryLocalError = error && error.message
        ? error.message
        : String(error)
      renderFolderDiscovery()
    }
    return
  }
  if (target.hasAttribute("data-search-somewhere-else")) {
    target.disabled = true
    try {
      const result = await post({ action: "clear_find_folders" })
      if (result.error) throw new Error(result.error)
      state.folderDiscoveryPage = 0
      state.folderDiscoveryLocalError = null
      closeFolderDiscoveryModal(false)
      await refresh(true)
      beginFolderDiscovery()
    } catch (error) {
      state.folderDiscoveryLocalError = error && error.message
        ? error.message
        : String(error)
      renderFolderDiscovery()
    } finally {
      target.disabled = false
    }
    return
  }
  if (target.dataset.findPage) {
    const direction = target.dataset.findPage
    state.folderDiscoveryPage = Math.max(
      0,
      state.folderDiscoveryPage + (direction === "next" ? 1 : -1)
    )
    await refresh(true)
    return
  }
  if (target.dataset.toggleFoundFolder) {
    const key = folderDiscoveryPathKey(target.dataset.toggleFoundFolder)
    if (state.folderDiscoveryExpanded.has(key)) {
      state.folderDiscoveryExpanded.delete(key)
      renderFolderDiscovery()
    } else {
      state.folderDiscoveryExpanded.add(key)
      const node = state.folderDiscoveryNodes.get(key)
      if (node && !node.children_loaded) {
        await loadFolderDiscoveryChildren(node.folder, 0)
      } else {
        renderFolderDiscovery()
      }
    }
    return
  }
  if (target.dataset.loadFoundFolder) {
    await loadFolderDiscoveryChildren(
      target.dataset.loadFoundFolder,
      target.dataset.foundFolderPage)
    return
  }
  if (target.hasAttribute("data-add-found-folders")) {
    if (state.folderDiscoverySubmitting) return
    const selection = folderDiscoverySelectionSummary()
    if (!selection.count) return
    const discovery = state.data && state.data.folder_discovery
    if (!folderDiscoveryComplete(discovery)) return
    state.folderDiscoverySubmitting = true
    renderFolderDiscovery()
    focusFolderDiscoveryDialog()
    try {
      const result = await addFolderDiscoverySelection(discovery)
      dismissExternalPrompt()
      const created = Math.max(0, Number(result.created_count) || 0)
      state.feedback = {
        error: false,
        message: created === 0
          ? COPY.external_exists
          : created === 1
            ? COPY.external_added
            : COPY.external_locations_added.replace("{count}", created)
      }
      closeFolderDiscoveryModal()
      resetFolderDiscoveryChoices()
      await refresh(true)
    } catch (error) {
      state.folderDiscoveryLocalError = error && error.message
        ? error.message
        : String(error)
    } finally {
      state.folderDiscoverySubmitting = false
      if (state.folderDiscoveryOpen) renderFolderDiscovery()
    }
    return
  }
  if (target.hasAttribute("data-reveal-file")) {
    target.disabled = true
    target.setAttribute("aria-busy", "true")
    try {
      const result = await post({
        action: "reveal",
        scope_id: SCOPE_ID,
        path: target.dataset.revealFile
      })
      if (result.error || !result.revealed) {
        throw new Error(result.error || COPY.reveal_failed)
      }
    } catch (error) {
      state.feedback = {
        error: true,
        message: error && error.message ? error.message : String(error)
      }
      renderFeedback()
    } finally {
      target.disabled = false
      target.removeAttribute("aria-busy")
    }
    return
  }
  if (target.hasAttribute("data-cancel-file-action")) {
    target.disabled = true
    try {
      const result = await post({ action: "cancel_file_action" })
      if (!result.cancel_requested) throw new Error(COPY.action_not_completed)
      if (state.actionProgress) {
        state.actionProgress.cancel_requested = true
      }
      renderedActionProgress = null
      renderActionProgress()
    } catch (error) {
      state.feedback = {
        error: true,
        message: error && error.message ? error.message : String(error)
      }
      renderFeedback()
    }
    return
  }
  if (target.hasAttribute("data-select-separate-all")) {
    state.selectedSeparateFiles.clear()
    state.separateAllMatching = true
    for (const checkbox of document.querySelectorAll(
      "[data-select-separate]")) {
      checkbox.checked = true
    }
    renderToolbar()
    renderSeparateSelectionBanner()
    syncPageSelectionCheckbox()
    return
  }
  if (target.hasAttribute("data-clear-separate-selection")) {
    clearSeparateSelection()
    for (const checkbox of document.querySelectorAll(
      "[data-select-separate]")) {
      checkbox.checked = false
    }
    renderToolbar()
    renderSeparateSelectionBanner()
    syncPageSelectionCheckbox()
    return
  }
  if (state.actionProgress && (target.hasAttribute("data-deduplicate-all") || target.hasAttribute("data-deduplicate-selected") || target.dataset.deduplicateScope || target.dataset.deduplicateFile || target.dataset.detach || target.hasAttribute("data-separate-selected"))) return
  if (target.dataset.page) {
    clearFileSelections()
    if (target.dataset.page === "next") {
      const cursor = state.data.inventory.next_cursor
      if (!cursor) return
      state.pageCursors[state.page + 1] = cursor
      state.page += 1
    } else {
      state.page = Math.max(0, state.page - 1)
    }
    await refresh(true)
    el("vault-table-wrap").scrollTop = 0
  } else if (target.hasAttribute("data-sort-size")) {
    clearFileSelections()
    state.sizeSort = state.sizeSort === "desc" ? "asc" : "desc"
    resetPage()
    await refresh(true)
  } else if (target.dataset.togglePath !== undefined) {
    const locationId = target.dataset.toggleLocation || null
    const parent = target.dataset.togglePath
    const key = levelKey(locationId, parent)
    if (state.expandedDirs.has(key)) {
      state.expandedDirs.delete(key)
      render()
    } else {
      state.expandedDirs.add(key)
      if (!treeLevel(locationId, parent)) {
        await loadTreeLevel(locationId, parent)
      } else render()
    }
    return
  } else if (target.dataset.morePath !== undefined) {
    await loadTreeLevel(
      target.dataset.moreLocation || null, target.dataset.morePath, true)
    return
  } else if (target.hasAttribute("data-sort-name")) {
    clearFileSelections()
    // Size ordering wins over name ordering server-side, so sorting by name
    // has to drop it rather than sit underneath it doing nothing visible.
    state.nameSort = !state.sizeSort && state.nameSort === "asc"
      ? "desc"
      : "asc"
    state.sizeSort = null
    resetPage()
    await refresh(true)
  } else if (target.dataset.displayMode) {
    clearFileSelections()
    state.displayMode = target.dataset.displayMode === "files" ? "files" : "folders"
    state.sizeSort = state.displayMode === "files" ? "desc" : null
    state.nameSort = "asc"
    resetPage()
    await refresh(true)
  } else if (target.dataset.view || target.id === "btn-review-cleanup") {
    state.view = target.dataset.view || "reclaimable"
    clearFileSelections()
    state.sourceId = SCOPE_ID
    state.query = ""
    state.statusFilter = "all"
    state.displayMode = state.view === "shared" ? "files" : "folders"
    state.sizeSort = state.view === "shared" ? "desc" : null
    state.nameSort = "asc"
    if (state.view === "duplicates") {
      markScanReviewed()
      state.scanResult = null
    }
    resetPage()
    await refresh(true)
  } else if (target.hasAttribute("data-source")) {
    clearFileSelections()
    const sourceId = target.dataset.source || null
    state.sourceId = IS_APP_MODE
      ? SCOPE_ID
      : (state.sourceId === sourceId ? null : sourceId)
    resetPage()
    await refresh(true)
  } else if (target.dataset.toggleSource) {
    const id = target.dataset.toggleSource
    if (state.collapsedSources.has(id)) state.collapsedSources.delete(id)
    else state.collapsedSources.add(id)
    renderLocations()
  } else if (target.dataset.expandDuplicateGroup) {
    const hash = target.dataset.expandDuplicateGroup
    if (state.expandedDuplicateGroups.has(hash)) {
      state.expandedDuplicateGroups.delete(hash)
      render()
    } else {
      state.expandedDuplicateGroups.add(hash)
      render()
      const children = state.duplicateGroupChildren.get(hash)
      if (!children || !children.loaded) {
        await loadDuplicateGroupChildren(hash)
      }
    }
  } else if (target.dataset.moreDuplicateGroup) {
    await loadDuplicateGroupChildren(
      target.dataset.moreDuplicateGroup,
      true
    )
  } else if (target.dataset.moreFileLocations) {
    await loadFileLocations(target.dataset.moreFileLocations, true)
  } else if (target.dataset.expandFile) {
    const file = target.dataset.expandFile
    if (state.expandedFiles.has(file)) {
      state.expandedFiles.delete(file)
      render()
    } else {
      state.expandedFiles.add(file)
      render()
      const loaded = state.fileLocations.get(file)
      if (!loaded || (!loaded.loaded && !loaded.loading)) {
        await loadFileLocations(file)
      }
    }
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
  } else if (target.hasAttribute("data-dismiss-external-prompt")) {
    dismissExternalPrompt()
  } else if (target.id === "btn-add-source" || target.hasAttribute("data-add-source")) {
    closeAddMenu()
    target.disabled = true
    try {
      const folderPath = await chooseExternalFolder()
      if (!folderPath) return
      const result = await post({ action: "add_source", path: folderPath })
      if (result.error) {
        state.feedback = { error: true, message: result.error }
      } else {
        dismissExternalPrompt()
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
  } else if (target.id === "btn-scan") {
    if (state.automaticScanCoachmarkSignature) {
      dismissAutomaticScanCoachmark()
    }
    if (scanMatchesContext(state.data && state.data.scan)) {
      state.scanCancelRequested = true
      renderOverview()
      try {
        const result = await post({ action: "cancel_scan" })
        if (!result.cancel_requested) throw new Error(COPY.action_not_completed)
        await refresh()
      } catch (error) {
        state.scanCancelRequested = false
        state.feedback = {
          error: true,
          message: error && error.message ? error.message : String(error)
        }
        render()
      }
      return
    }
    if (appSetupRequired()) {
      openGlobalWorkspace()
      return
    }
    state.scanRequested = true
    state.scanBaseline = state.data.last_scan ? state.data.last_scan.ts : null
    state.scanResult = null
    state.scanProblemsOpen = false
    state.scanPreviewOpen = false
    state.feedback = null
    try {
      if (!await candidateSizeSaveTail) {
        state.scanRequested = false
        return
      }
      const result = await post({
        action: "scan",
        scope_id: SCOPE_ID
      })
      if (result.error) throw new Error(result.error)
      await refresh()
    } catch (error) {
      state.scanRequested = false
      state.feedback = { error: true, message: error && error.message ? error.message : String(error) }
      renderFeedback()
    }
  } else if (target.id === "btn-scan-preview") {
    state.scanPreviewOpen = !state.scanPreviewOpen
    const paths = el("vault-preview-paths")
    target.setAttribute("aria-expanded", String(state.scanPreviewOpen))
    target.firstChild.textContent = state.scanPreviewOpen
      ? COPY.hide_matches
      : COPY.view_matches
    target.closest(".vault-result").classList.toggle(
      "expanded", state.scanPreviewOpen)
    if (paths) paths.hidden = !state.scanPreviewOpen
  } else if (target.id === "btn-scan-problems") {
    state.scanProblemsOpen = !state.scanProblemsOpen
    const paths = el("vault-result-paths")
    target.setAttribute("aria-expanded", String(state.scanProblemsOpen))
    target.closest(".vault-result").classList.toggle("expanded", state.scanProblemsOpen)
    if (paths) paths.hidden = !state.scanProblemsOpen
  } else if (target.id === "btn-review-result" || target.id === "btn-review-metric") {
    if (!state.scanResult || !state.scanResult.partial) markScanReviewed()
    state.view = "duplicates"
    state.displayMode = "folders"
    state.sizeSort = null
    state.sourceId = SCOPE_ID
    state.query = ""
    clearFileSelections()
    state.scanResult = null
    resetPage()
    await refresh(true)
  } else if (target.hasAttribute("data-deduplicate-selected")) {
    const paths = [...state.selectedDuplicateFiles.keys()]
    const stopTracking = trackSelectedDeduplication(paths.length)
    state.actionRequest = true
    try {
      await runAction(
        { action: "deduplicate_files", paths },
        deduplicateFeedback
      )
      clearDuplicateSelection()
      render()
    } finally {
      state.actionRequest = false
      stopTracking()
    }
  } else if (target.hasAttribute("data-deduplicate-all")) {
    const scopeId = target.dataset.deduplicateContext || null
    const total = bulkDeduplicationCount()
    const stopTracking = trackDeduplication(scopeId, total)
    state.actionRequest = true
    try {
      await runAction(
        { action: "deduplicate", scope_id: scopeId },
        deduplicateFeedback
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
      kind: "make-separate",
      path: filePath
    }
    state.actionRequest = true
    renderActionProgress()
    try {
      await runAction({ action: "detach", path: filePath }, (result) => {
        if (result.status === "detached") {
          state.selectedSeparateFiles.delete(filePath)
        }
        return detachFeedback(result)
      })
    } finally {
      state.actionRequest = false
      if (state.actionProgress &&
          state.actionProgress.path === filePath) {
        state.actionProgress = null
      }
      renderActionProgress()
    }
  } else if (target.dataset.reclaim) {
    await runAction({ action: "reclaim", hash: target.dataset.reclaim, store_id: target.dataset.reclaimStore }, (result) => result.status === "reclaimed"
      ? `${COPY.reclaimed}: ${fmt(result.bytes_freed || 0)}`
      : { error: true, message: COPY.unavailable })
  } else if (target.id === "btn-reclaim-all") {
    await runAction({ action: "reclaim_all" }, (result) => result.failed
      ? { error: true, message: `${COPY.reclaimed}: ${fmt(result.bytes_freed || 0)}. ${COPY.action_not_completed}` }
      : `${COPY.reclaimed}: ${fmt(result.bytes_freed || 0)}`)
  } else if (target.hasAttribute("data-separate-selected")) {
    const paths = [...state.selectedSeparateFiles]
    const allMatching = state.separateAllMatching
    const total = allMatching
      ? Math.max(0, Number(
        state.data.inventory.current.separate_count) || 0)
      : paths.length
    if (allMatching) {
      const message = COPY.separate_all_confirm
        .replace("{count}", total)
        .replace("{size}", fmt(
          Number(state.data.inventory.current.separate_bytes) || 0))
      if (!window.confirm(message)) return
    }
    const stopTracking = trackBulkSeparate(total, allMatching)
    state.actionRequest = true
    try {
      const payload = allMatching
        ? {
            action: "separate_all",
            scope_id: SCOPE_ID,
            location_id: state.sourceId,
            view: state.view,
            status_filter: state.statusFilter,
            display_mode: state.displayMode,
            query: state.query
          }
        : { action: "separate_files", paths }
      await runAction(payload, (result) => {
        if (result.cancelled) {
          return COPY.separation_cancelled.replace(
            "{count}", countLabel(result.separated || 0))
        }
        return result.failed
          ? { error: true, message: `${COPY.separated} (${result.separated || 0}). ${COPY.separate_incomplete}` }
          : `${COPY.separated} (${result.separated || 0})`
      })
      clearSeparateSelection()
      render()
    } finally {
      state.actionRequest = false
      stopTracking()
    }
  }
})

document.addEventListener("change", async (event) => {
  const target = event.target.closest("[data-select-found-folder]")
  if (!target || state.folderDiscoverySubmitting ||
      state.folderDiscoverySelectionPending) return
  const node = state.folderDiscoveryNodes.get(
    folderDiscoveryPathKey(target.dataset.selectFoundFolder))
  if (!node) return
  const promise = updateFolderDiscoverySelection(
    node,
    target.checked,
    state.data && state.data.folder_discovery
  )
  state.folderDiscoverySelectionPromise = promise
  try {
    await promise
  } finally {
    if (state.folderDiscoverySelectionPromise === promise) {
      state.folderDiscoverySelectionPromise = null
    }
  }
})

document.addEventListener("keydown", (event) => {
  if (!state.folderDiscoveryOpen) return
  const overlay = el("vault-find-overlay")
  const dialog = overlay && overlay.querySelector(".vault-find-dialog")
  if (!dialog) return
  if (event.key === "Escape") {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (state.folderDiscoverySubmitting) return
    const close = dialog.querySelector("[data-close-find-folders]")
    if (close) close.click()
    return
  }
  if (event.key !== "Tab") return
  const focusable = [...dialog.querySelectorAll(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])"
  )].filter((candidate) => !candidate.closest("[hidden]"))
  if (!focusable.length) {
    event.preventDefault()
    dialog.focus({ preventScroll: true })
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (document.activeElement === dialog ||
      !dialog.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus({ preventScroll: true })
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus({ preventScroll: true })
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus({ preventScroll: true })
  }
}, true)

document.addEventListener("input", (event) => {
  if (event.target.id !== "vault-search") return
  clearFileSelections()
  state.query = event.target.value
  resetPage()
  clearTimeout(window.__vaultSearchRefresh)
  window.__vaultSearchRefresh = setTimeout(() => refresh(true), 250)
})
document.addEventListener("change", async (event) => {
  if (event.target.hasAttribute("data-select-duplicate-group-page")) {
    const checkbox = event.target
    const pageHashes = new Set([...document.querySelectorAll(
      "[data-select-duplicate-group]")].map((item) =>
      item.dataset.selectDuplicateGroup))
    if (!checkbox.checked) {
      for (const [filePath, selection] of state.selectedDuplicateFiles) {
        if (!selection || !pageHashes.has(selection.hash)) continue
        state.selectedDuplicateFiles.delete(filePath)
      }
      render()
      return
    }
    checkbox.disabled = true
    const generation = state.duplicateGroupGeneration
    try {
      const result = await duplicateGroupPageSelectionItems()
      if (generation !== state.duplicateGroupGeneration) return
      const items = Array.isArray(result.items)
        ? result.items.filter((item) => item && item.path)
        : []
      const combined = new Set(state.selectedDuplicateFiles.keys())
      for (const item of items) combined.add(item.path)
      if (result.exceeded ||
          combined.size > MAX_BULK_DEDUPLICATE_FILES) {
        state.feedback = {
          error: true,
          message: COPY.duplicate_selection_limit
        }
      } else {
        for (const item of items) {
          state.selectedDuplicateFiles.set(item.path, {
            hash: item.hash || "",
            size: Math.max(0, Number(item.size) || 0)
          })
        }
      }
    } catch (error) {
      if (generation === state.duplicateGroupGeneration) {
        state.feedback = {
          error: true,
          message: error && error.message
            ? error.message
            : String(error)
        }
      }
    } finally {
      if (generation === state.duplicateGroupGeneration) render()
    }
    return
  }
  if (event.target.dataset.selectDuplicateGroup) {
    const checkbox = event.target
    const hash = checkbox.dataset.selectDuplicateGroup
    const size = Math.max(
      0,
      Number(checkbox.dataset.duplicateSize) || 0
    )
    if (!checkbox.checked) {
      for (const [filePath, selection] of state.selectedDuplicateFiles) {
        if (selection.hash !== hash) continue
        state.selectedDuplicateFiles.delete(filePath)
      }
      render()
      return
    }
    checkbox.disabled = true
    const generation = state.duplicateGroupGeneration
    try {
      const result = await duplicateGroupSelectionPaths(hash)
      if (generation !== state.duplicateGroupGeneration) return
      const paths = Array.isArray(result.paths) ? result.paths : []
      const combined = new Set(state.selectedDuplicateFiles.keys())
      for (const filePath of paths) combined.add(filePath)
      if (result.exceeded ||
          combined.size > MAX_BULK_DEDUPLICATE_FILES) {
        state.feedback = {
          error: true,
          message: COPY.duplicate_selection_limit
        }
      } else {
        for (const filePath of paths) {
          state.selectedDuplicateFiles.set(filePath, { hash, size })
        }
      }
    } catch (error) {
      if (generation === state.duplicateGroupGeneration) {
        state.feedback = {
          error: true,
          message: error && error.message
            ? error.message
            : String(error)
        }
      }
    } finally {
      if (generation === state.duplicateGroupGeneration) render()
    }
    return
  }
  if (event.target.hasAttribute("data-select-duplicate-page")) {
    const pageCheckboxes = [
      ...document.querySelectorAll("[data-select-duplicate]")
    ]
    if (event.target.checked &&
        pageCheckboxes.length > MAX_BULK_DEDUPLICATE_FILES) {
      event.target.checked = false
      state.feedback = {
        error: true,
        message: COPY.duplicate_selection_limit
      }
      renderFeedback()
      return
    }
    for (const checkbox of pageCheckboxes) {
      checkbox.checked = event.target.checked
      if (event.target.checked) {
        const filePath = checkbox.dataset.selectDuplicate
        state.selectedDuplicateFiles.set(
          filePath,
          {
            hash: checkbox.dataset.duplicateHash || "",
            size: Math.max(
              0,
              Number(checkbox.dataset.duplicateSize) || 0
            )
          }
        )
      } else {
        const filePath = checkbox.dataset.selectDuplicate
        state.selectedDuplicateFiles.delete(filePath)
      }
    }
    renderToolbar()
    syncDuplicatePageSelectionCheckbox()
    return
  }
  if (event.target.dataset.selectDuplicate) {
    const filePath = event.target.dataset.selectDuplicate
    if (event.target.checked &&
        state.selectedDuplicateFiles.size >=
          MAX_BULK_DEDUPLICATE_FILES) {
      event.target.checked = false
      state.feedback = {
        error: true,
        message: COPY.duplicate_selection_limit
      }
      renderFeedback()
      return
    }
    if (event.target.checked) {
      state.selectedDuplicateFiles.set(
        filePath,
        {
          hash: event.target.dataset.duplicateHash || "",
          size: Math.max(
            0,
            Number(event.target.dataset.duplicateSize) || 0
          )
        }
      )
    } else {
      state.selectedDuplicateFiles.delete(filePath)
    }
    if (state.view === "duplicates" &&
        state.displayMode === "files") {
      render()
    } else {
      renderToolbar()
      syncDuplicatePageSelectionCheckbox()
    }
    return
  }
  if (event.target.hasAttribute("data-select-separate-page")) {
    const pageCheckboxes = [
      ...document.querySelectorAll("[data-select-separate]")
    ]
    if (state.separateAllMatching) clearSeparateSelection()
    for (const checkbox of pageCheckboxes) {
      checkbox.checked = event.target.checked
      if (event.target.checked) {
        state.selectedSeparateFiles.add(checkbox.dataset.selectSeparate)
      } else {
        state.selectedSeparateFiles.delete(checkbox.dataset.selectSeparate)
      }
    }
    renderToolbar()
    renderSeparateSelectionBanner()
    syncPageSelectionCheckbox()
    return
  }
  if (event.target.dataset.selectSeparate) {
    const filePath = event.target.dataset.selectSeparate
    if (state.separateAllMatching) {
      const pageCheckboxes = [
        ...document.querySelectorAll("[data-select-separate]")
      ]
      clearSeparateSelection()
      for (const checkbox of pageCheckboxes) {
        state.selectedSeparateFiles.add(
          checkbox.dataset.selectSeparate)
      }
    }
    if (event.target.checked && state.selectedSeparateFiles.size >= MAX_BULK_SEPARATE_FILES) {
      event.target.checked = false
      state.feedback = { error: true, message: COPY.separate_selection_limit }
      renderFeedback()
      return
    }
    if (event.target.checked) state.selectedSeparateFiles.add(filePath)
    else state.selectedSeparateFiles.delete(filePath)
    renderToolbar()
    renderSeparateSelectionBanner()
    syncPageSelectionCheckbox()
    return
  }
  if (["vault-candidate-size", "vault-find-candidate-size"]
      .includes(event.target.id)) {
    const size = Number(event.target.value)
    await saveCandidateSize(candidateSizeOptions.includes(size)
      ? size
      : defaultCandidateSize)
    return
  }
  if (event.target.id !== "vault-status-filter") return
  clearFileSelections()
  state.statusFilter = event.target.value
  resetPage()
  refresh(true)
})

const candidateSizeSelect = el("vault-candidate-size")
if (candidateSizeSelect) {
  candidateSizeSelect.setAttribute("aria-label", COPY.minimum_file_size)
  candidateSizeSelect.innerHTML = candidateSizeOptions
    .map((size) => `<option value="${size}">${candidateSizeLabel(size)}</option>`)
    .join("")
}
const candidateSizeOptionsElement = el("vault-scan-size-options")
if (candidateSizeOptionsElement) {
  candidateSizeOptionsElement.innerHTML = `
    <div class="vault-scan-size-heading">${esc(COPY.minimum_file_size)}</div>
    ${candidateSizeOptions.map((size) => `
      <button class="vault-scan-size-option" type="button" data-candidate-size="${size}" aria-pressed="false">
        <span>${esc(candidateSizeLabel(size))}</span>
        <i class="fa-solid fa-check" aria-hidden="true"></i>
      </button>`).join("")}`
}
renderCandidateSizeControl()
el("btn-scan").textContent = IS_APP_MODE ? COPY.scan_app : COPY.scan
const addSourceButton = el("btn-add-source")
if (addSourceButton) {
  addSourceButton.setAttribute("aria-label", COPY.add_external_folder)
  addSourceButton.setAttribute("title", COPY.add_external_folder)
}
const disclosureMenus = [el("vault-add-menu"), el("vault-scan-size-menu")]
  .filter(Boolean)
if (disclosureMenus.length) {
  document.addEventListener("pointerdown", (event) => {
    for (const menu of disclosureMenus) {
      if (menu.open && !menu.contains(event.target)) menu.open = false
    }
  }, true)
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    for (const menu of disclosureMenus) {
      if (!menu.open) continue
      menu.open = false
      const trigger = menu.querySelector("summary")
      if (trigger) trigger.focus()
    }
  }, true)
}
if (IS_APP_MODE && AUTOMATIC_SUPPORTED) {
  document.addEventListener("pointerdown", (event) => {
    const menu = el("vault-auto-mode")
    if (menu && menu.open && !menu.contains(event.target)) menu.open = false
  }, true)
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    if (state.automaticScanCoachmarkSignature) {
      event.preventDefault()
      dismissAutomaticScanCoachmark(true)
      return
    }
    const menu = el("vault-auto-mode")
    if (!menu || !menu.open) return
    menu.open = false
    const trigger = menu.querySelector("summary")
    if (trigger) trigger.focus()
  }, true)
  window.addEventListener("message", onAutomaticScanMessage)
  if (requestAutomaticModeFromParent()) {
    automaticModeFallbackTimer = window.setTimeout(() => {
      automaticModeFallbackTimer = null
      loadAutomaticMode()
    }, 500)
  } else {
    loadAutomaticMode()
  }
}
el("vault-pane").setAttribute("aria-label", COPY.files_region)
refresh()
