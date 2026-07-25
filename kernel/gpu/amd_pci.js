const childProcess = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const util = require("node:util")

const { normalize_model } = require("./common")
const amd_pci_targets = require("./amd_pci_targets.json")

const execFile = util.promisify(childProcess.execFile)
const AMD_VENDOR_ID = "1002"
const WINDOWS_GPU_QUERY = [
  "Get-CimInstance Win32_VideoController",
  "Select-Object Name,PNPDeviceID",
  "ConvertTo-Json -Compress"
].join(" | ")

let windows_adapters

const normalize_hex = (value, length) => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    let numeric = value.toString(16).padStart(length, "0")
    return numeric.length === length ? numeric : null
  }
  let normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "")
  return new RegExp(`^[0-9a-f]{${length}}$`).test(normalized) ? normalized : null
}

const parse_pci_identity = (record) => {
  if (!record) return null

  let encoded = [
    record.pnpDeviceId,
    record.PNPDeviceID,
    record.pnp_device_id,
    record.deviceId,
    record.deviceID
  ].find((value) => typeof value === "string" && /VEN_|DEV_/i.test(value))
  if (encoded) {
    let match = /VEN_([0-9a-f]{4})&DEV_([0-9a-f]{4})(?:&SUBSYS_[0-9a-f]{8})?(?:&REV_([0-9a-f]{2}))?/i.exec(encoded)
    if (match) {
      return {
        vendor: match[1].toLowerCase(),
        device: match[2].toLowerCase(),
        revision: match[3] ? match[3].toLowerCase() : null
      }
    }
  }

  let vendor = normalize_hex(record.vendorId || record.vendorID || record.vendor_id, 4)
  let device = normalize_hex(record.deviceId || record.deviceID || record.device_id, 4)
  let revision = normalize_hex(record.revision || record.revisionId || record.revision_id, 2)
  return vendor && device ? { vendor, device, revision } : null
}

const resolve_pci_target = (identity) => {
  if (!identity) return null
  let vendor = normalize_hex(identity.vendor, 4)
  let device = normalize_hex(identity.device, 4)
  let revision = normalize_hex(identity.revision, 2)
  if (!vendor || !device) return null

  let revision_entry = revision && amd_pci_targets.revision_entries[
    `${vendor}:${device}:${revision}`
  ]
  let entry = revision_entry || amd_pci_targets.entries[`${vendor}:${device}`]
  return entry && /^gfx[0-9a-f]+$/i.test(entry.target || "")
    ? entry.target.toLowerCase()
    : null
}

const parse_windows_output = (stdout) => {
  let json = String(stdout || "").trim().replace(/^\uFEFF/, "")
  if (!json) return []
  let parsed = JSON.parse(json)
  let records = Array.isArray(parsed) ? parsed : [parsed]
  return records.map((record) => ({
    model: record.Name || record.name || "",
    pnpDeviceId: record.PNPDeviceID || record.pnpDeviceId || ""
  }))
}

const query_windows_adapters = async (options = {}) => {
  let run = options.execFile || execFile
  try {
    let result = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_GPU_QUERY],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }
    )
    return parse_windows_output(result && result.stdout)
  } catch (_) {
    return []
  }
}

const windows_identity = async (controller, options = {}) => {
  let records
  if (options.execFile) {
    records = await query_windows_adapters(options)
  } else {
    if (!windows_adapters) {
      windows_adapters = query_windows_adapters()
    }
    records = await windows_adapters
  }

  let model = normalize_model(controller && controller.model)
  if (!model) return null
  let matches = records.filter((record) => (
    normalize_model(record.model) === model &&
    parse_pci_identity(record)?.vendor === AMD_VENDOR_ID
  ))
  return matches.length === 1 ? parse_pci_identity(matches[0]) : null
}

const normalize_bus_address = (value) => {
  let address = String(value || "").trim().toLowerCase()
  if (/^[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(address)) {
    return `0000:${address}`
  }
  return /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(address)
    ? address
    : null
}

const linux_identity = async (controller, options = {}) => {
  let address = normalize_bus_address(
    controller && (controller.busAddress || controller.pciBus)
  )
  if (!address) return null

  let sysfs_root = options.sysfsRoot || "/sys/bus/pci/devices"
  let readFile = options.readFile || fs.promises.readFile
  try {
    let device_path = path.join(sysfs_root, address)
    let [vendorId, deviceId, revisionId] = await Promise.all([
      readFile(path.join(device_path, "vendor"), "utf8"),
      readFile(path.join(device_path, "device"), "utf8"),
      readFile(path.join(device_path, "revision"), "utf8").catch(() => "")
    ])
    return parse_pci_identity({ vendorId, deviceId, revisionId })
  } catch (_) {
    return null
  }
}

const resolve_gpu_target = async (controller, options = {}) => {
  let direct_identity = parse_pci_identity(controller)
  if (direct_identity && direct_identity.vendor === AMD_VENDOR_ID) {
    return resolve_pci_target(direct_identity)
  }

  let platform = options.platform || process.platform
  let identity = platform === "win32"
    ? await windows_identity(controller, options)
    : platform === "linux"
      ? await linux_identity(controller, options)
      : null
  return identity && identity.vendor === AMD_VENDOR_ID
    ? resolve_pci_target(identity)
    : null
}

const reset_cache = () => {
  windows_adapters = null
}

module.exports = {
  AMD_VENDOR_ID,
  WINDOWS_GPU_QUERY,
  linux_identity,
  normalize_hex,
  normalize_bus_address,
  parse_pci_identity,
  parse_windows_output,
  query_windows_adapters,
  reset_cache,
  resolve_gpu_target,
  resolve_pci_target,
  windows_identity
}
