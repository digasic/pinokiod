const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const { normalize_model } = require('../kernel/gpu/common')

const GENERATOR = 'script/update-amd-gfx-targets.js'
const AMD_VENDOR_ID = '1002'

// Update these revisions deliberately during release maintenance. Runtime GPU
// detection never fetches upstream data.
const ROCM_REVISION = '14f8138863403a26e0caef6671cfab9b09aa636e'
const MESA_REVISION = '3e2d8517b897026377267c09975db83525d2fc95'
const LLVM_REVISION = '2f3f97fb72606f51ece7d64d6a7a73c9eaad8978'
const LINUX_REVISION = '7d0a66e4bb9081d75c82ec4957c50034cb0ea449'
const LIBDRM_REVISION = 'f198c21dfcb89127083413dd4779a13b3f9a6507'

const SOURCES = {
  rocm_specs: {
    repository: 'https://github.com/ROCm/ROCm',
    revision: ROCM_REVISION,
    path: 'docs/reference/gpu-arch-specs.rst',
    url: `https://raw.githubusercontent.com/ROCm/ROCm/${ROCM_REVISION}/docs/reference/gpu-arch-specs.rst`
  },
  mesa_pci_ids: {
    repository: 'https://gitlab.freedesktop.org/mesa/mesa',
    revision: MESA_REVISION,
    path: 'include/pci_ids/radeonsi_pci_ids.h',
    url: `https://gitlab.freedesktop.org/mesa/mesa/-/raw/${MESA_REVISION}/include/pci_ids/radeonsi_pci_ids.h`
  },
  mesa_families: {
    repository: 'https://gitlab.freedesktop.org/mesa/mesa',
    revision: MESA_REVISION,
    path: 'src/amd/common/amd_family.c',
    url: `https://gitlab.freedesktop.org/mesa/mesa/-/raw/${MESA_REVISION}/src/amd/common/amd_family.c`
  },
  mesa_family_names: {
    repository: 'https://gitlab.freedesktop.org/mesa/mesa',
    revision: MESA_REVISION,
    path: 'src/amd/common/amd_family.h',
    url: `https://gitlab.freedesktop.org/mesa/mesa/-/raw/${MESA_REVISION}/src/amd/common/amd_family.h`
  },
  llvm_processors: {
    repository: 'https://github.com/llvm/llvm-project',
    revision: LLVM_REVISION,
    path: 'llvm/lib/Target/AMDGPU/GCNProcessors.td',
    url: `https://raw.githubusercontent.com/llvm/llvm-project/${LLVM_REVISION}/llvm/lib/Target/AMDGPU/GCNProcessors.td`
  },
  linux_pci_ids: {
    repository: 'https://github.com/torvalds/linux',
    revision: LINUX_REVISION,
    path: 'drivers/gpu/drm/amd/amdgpu/amdgpu_drv.c',
    url: `https://raw.githubusercontent.com/torvalds/linux/${LINUX_REVISION}/drivers/gpu/drm/amd/amdgpu/amdgpu_drv.c`
  },
  libdrm_names: {
    repository: 'https://gitlab.freedesktop.org/mesa/libdrm',
    revision: LIBDRM_REVISION,
    path: 'data/amdgpu.ids',
    url: `https://gitlab.freedesktop.org/mesa/libdrm/-/raw/${LIBDRM_REVISION}/data/amdgpu.ids`
  }
}

const repoRoot = path.resolve(__dirname, '..')

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString()
        response.resume()
        fetchText(nextUrl).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`${url} returned ${response.statusCode}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function canonicalKey(value) {
  let key = normalize_model(value)
  let previous
  do {
    previous = key
    key = key
      .replace(/^advanced micro devices\s+/, '')
      .replace(/^amd\s+/, '')
      .replace(/^instinct\s+/, '')
      .trim()
  } while (key !== previous)
  return key
}

function addEntry(entries, name, target) {
  const key = canonicalKey(name)
  if (key && /^gfx[0-9a-f]+$/i.test(target)) {
    entries[key] = target.toLowerCase()
  }
}

function parseGpuSpecs(rst) {
  const entries = {}
  let headers = null
  let cells = []
  let inRow = false

  const flushRow = () => {
    if (!inRow || cells.length === 0) return
    if (cells.includes('Name') && cells.includes('LLVM target name')) {
      headers = cells
    } else if (headers) {
      const nameIndex = headers.indexOf('Name')
      const graphicsIndex = headers.indexOf('Graphics model')
      const targetIndex = headers.indexOf('LLVM target name')
      const target = cells[targetIndex]
      if (target) {
        addEntry(entries, cells[nameIndex], target)
        if (graphicsIndex >= 0) {
          addEntry(entries, cells[graphicsIndex], target)
        }
      }
    }
    cells = []
  }

  for (const line of rst.split(/\r?\n/)) {
    if (/^\s*\*\s*$/.test(line)) {
      flushRow()
      inRow = true
      continue
    }
    const cell = line.match(/^\s*-\s*(.*)$/)
    if (inRow && cell) {
      cells.push(cell[1].trim())
    }
  }
  flushRow()

  return entries
}

function parseLlvmProcessorTargets(tablegen) {
  const processors = {}
  const processorPattern = /def\s*:\s*ProcessorModel<"([^"]+)"([\s\S]*?)>;/g
  let processorMatch
  while ((processorMatch = processorPattern.exec(tablegen))) {
    const name = processorMatch[1].toLowerCase()
    const version = processorMatch[2].match(
      /FeatureISAVersion([0-9]+)_([0-9a-f]+)_([0-9a-f]+)\.Features/i
    )
    if (!version) continue
    const target = /^gfx[0-9a-f]+$/.test(name)
      ? name
      : `gfx${version[1]}${version[2]}${version[3]}`.toLowerCase()
    processors[name] = target
  }
  return processors
}

function parseMesaFamilyTargets(source, processorTargets) {
  const start = source.indexOf('const char *ac_get_llvm_processor_name')
  const end = source.indexOf('const char *ac_get_ip_type_string', start)
  if (start < 0 || end < 0) {
    throw new Error('Mesa ac_get_llvm_processor_name function was not found')
  }

  const body = source.slice(start, end)
  const familyTargets = {}
  const returnPattern = /((?:\s*case\s+CHIP_[A-Z0-9_]+:\s*)+)\s*return\s+"([^"]+)";/g
  let returnMatch
  while ((returnMatch = returnPattern.exec(body))) {
    const processor = returnMatch[2].toLowerCase()
    const target = /^gfx[0-9a-f]+$/.test(processor)
      ? processor
      : processorTargets[processor]
    if (!target || !/^gfx[0-9a-f]+$/.test(target)) continue

    const familyPattern = /case\s+CHIP_([A-Z0-9_]+):/g
    let familyMatch
    while ((familyMatch = familyPattern.exec(returnMatch[1]))) {
      familyTargets[familyMatch[1]] = target
    }
  }
  return familyTargets
}

function parseMesaFamilyAliases(source) {
  const aliases = {}
  const aliasPattern = /CHIP_([A-Z0-9_]+),[^\n]*formerly\s+"([^"]+)"/gi
  let aliasMatch
  while ((aliasMatch = aliasPattern.exec(source))) {
    const current = aliasMatch[1].toUpperCase()
    const former = aliasMatch[2].toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    aliases[former] = current
  }
  return aliases
}

function addPciEntry(entries, device, family, target) {
  if (!target) return
  const key = `${AMD_VENDOR_ID}:${device.toLowerCase()}`
  const previous = entries[key]
  if (previous && previous.target !== target) {
    throw new Error(
      `Conflicting targets for ${key}: ${previous.target} (${previous.family}) and ${target} (${family})`
    )
  }
  entries[key] = { target, family }
}

function parseMesaPciTargets(source, familyTargets, entries = {}) {
  const pciPattern = /CHIPSET\(0x([0-9a-f]{4}),\s*([A-Z0-9_]+)\)/gi
  let pciMatch
  while ((pciMatch = pciPattern.exec(source))) {
    const device = pciMatch[1].toLowerCase()
    const family = pciMatch[2].toUpperCase()
    addPciEntry(entries, device, family, familyTargets[family])
  }
  return entries
}

function parseLinuxPciTargets(source, familyTargets, familyAliases, entries = {}) {
  const pciPattern = /\{\s*0x1002,\s*0x([0-9a-f]{4}),[^\n]*\bCHIP_([A-Z0-9_]+)/gi
  let pciMatch
  while ((pciMatch = pciPattern.exec(source))) {
    const device = pciMatch[1].toLowerCase()
    const sourceFamily = pciMatch[2].toUpperCase()
    const family = familyAliases[sourceFamily] || sourceFamily
    addPciEntry(entries, device, family, familyTargets[family])
  }
  return entries
}

function parseLibdrmRevisionTargets(source, modelTargets, pciTargets) {
  const entries = {}
  const rowPattern = /^([0-9a-f]{4}),\s*([0-9a-f]{2}),\s*(.+?)\s*$/gim
  let rowMatch
  while ((rowMatch = rowPattern.exec(source))) {
    const device = rowMatch[1].toLowerCase()
    const revision = rowMatch[2].toLowerCase()
    const model = rowMatch[3].trim()
    const modelTarget = modelTargets[canonicalKey(model)]
    const pciTarget = pciTargets[`${AMD_VENDOR_ID}:${device}`]
    if (pciTarget && modelTarget && pciTarget.target !== modelTarget) {
      throw new Error(
        `Conflicting family/model targets for ${device}:${revision} (${model}): ` +
        `${pciTarget.target} and ${modelTarget}`
      )
    }
    const target = pciTarget ? pciTarget.target : modelTarget
    if (target) {
      entries[`${AMD_VENDOR_ID}:${device}:${revision}`] = { target, model }
    }
  }
  return entries
}

function sourceMetadata(definition, contents) {
  return {
    repository: definition.repository,
    revision: definition.revision,
    path: definition.path,
    url: definition.url,
    sha256: sha256(contents)
  }
}

function sortedObject(entries) {
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
}

function buildOutputs(contents) {
  const modelTargets = parseGpuSpecs(contents.rocm_specs)
  const processorTargets = parseLlvmProcessorTargets(contents.llvm_processors)
  const familyTargets = parseMesaFamilyTargets(contents.mesa_families, processorTargets)
  const familyAliases = parseMesaFamilyAliases(contents.mesa_family_names)
  const pciTargets = parseMesaPciTargets(contents.mesa_pci_ids, familyTargets)
  parseLinuxPciTargets(
    contents.linux_pci_ids,
    familyTargets,
    familyAliases,
    pciTargets
  )
  const revisionTargets = parseLibdrmRevisionTargets(
    contents.libdrm_names,
    modelTargets,
    pciTargets
  )

  const required = {
    '1002:731f': 'gfx1010',
    '1002:7340': 'gfx1012',
    '1002:73bf': 'gfx1030',
    '1002:73ff': 'gfx1032'
  }
  for (const [key, target] of Object.entries(required)) {
    if (!pciTargets[key] || pciTargets[key].target !== target) {
      throw new Error(`Pinned sources did not produce required mapping ${key} -> ${target}`)
    }
  }

  return {
    models: {
      source: SOURCES.rocm_specs.url,
      source_revision: SOURCES.rocm_specs.revision,
      source_sha256: sha256(contents.rocm_specs),
      generated_by: GENERATOR,
      entries: sortedObject(modelTargets)
    },
    pci: {
      generated_by: GENERATOR,
      sources: [
        sourceMetadata(SOURCES.mesa_pci_ids, contents.mesa_pci_ids),
        sourceMetadata(SOURCES.mesa_families, contents.mesa_families),
        sourceMetadata(SOURCES.mesa_family_names, contents.mesa_family_names),
        sourceMetadata(SOURCES.llvm_processors, contents.llvm_processors),
        sourceMetadata(SOURCES.linux_pci_ids, contents.linux_pci_ids),
        sourceMetadata(SOURCES.libdrm_names, contents.libdrm_names)
      ],
      revision_entries: sortedObject(revisionTargets),
      entries: sortedObject(pciTargets)
    }
  }
}

function writeJson(relativePath, data) {
  const file = path.join(repoRoot, relativePath)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

function checkJson(relativePath, data) {
  const file = path.join(repoRoot, relativePath)
  const expected = `${JSON.stringify(data, null, 2)}\n`
  if (fs.readFileSync(file, 'utf8') !== expected) {
    throw new Error(`${relativePath} is stale; run npm run update:amd-gfx-targets`)
  }
}

async function main() {
  const contents = Object.fromEntries(await Promise.all(
    Object.entries(SOURCES).map(async ([name, source]) => [name, await fetchText(source.url)])
  ))
  const outputs = buildOutputs(contents)
  const files = [
    ['kernel/gpu/amd_gfx_targets.json', outputs.models],
    ['kernel/gpu/amd_pci_targets.json', outputs.pci]
  ]

  if (process.argv.includes('--check')) {
    for (const [file, data] of files) checkJson(file, data)
    console.log('AMD gfx target data is up to date')
    return
  }

  for (const [file, data] of files) writeJson(file, data)

  console.log(
    `Wrote ${Object.keys(outputs.models.entries).length} AMD model targets and ` +
    `${Object.keys(outputs.pci.entries).length} AMD PCI targets`
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  SOURCES,
  buildOutputs,
  checkJson,
  parseGpuSpecs,
  parseLibdrmRevisionTargets,
  parseLinuxPciTargets,
  parseLlvmProcessorTargets,
  parseMesaFamilyAliases,
  parseMesaFamilyTargets,
  parseMesaPciTargets
}
