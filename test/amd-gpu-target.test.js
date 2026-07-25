const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const system = require('systeminformation')

const amd = require('../kernel/gpu/amd')
const amdPci = require('../kernel/gpu/amd_pci')
const gfxTargets = require('../kernel/gpu/amd_gfx_targets.json')
const pciTargets = require('../kernel/gpu/amd_pci_targets.json')
const packageJson = require('../package.json')
const Sysinfo = require('../kernel/sysinfo')

const root = path.join(__dirname, '..')

test('AMD gfx generated data is checked in and self describing', () => {
  assert.match(gfxTargets.source, new RegExp(gfxTargets.source_revision))
  assert.doesNotMatch(gfxTargets.source, /\/develop\//)
  assert.match(gfxTargets.source_revision, /^[0-9a-f]{40}$/)
  assert.match(gfxTargets.source_sha256, /^[0-9a-f]{64}$/)
  assert.equal(gfxTargets.generated_by, 'script/update-amd-gfx-targets.js')

  assert.equal(gfxTargets.entries['radeon rx 6800 xt'], 'gfx1030')
  assert.equal(gfxTargets.entries['radeon rx 7900 xtx'], 'gfx1100')
  assert.equal(gfxTargets.entries.mi210, 'gfx90a')
})

test('AMD PCI generated data is pinned, auditable, and covers mobile and RDNA1 GPUs', () => {
  assert.equal(pciTargets.generated_by, 'script/update-amd-gfx-targets.js')
  assert.ok(pciTargets.sources.length >= 6)
  for (const source of pciTargets.sources) {
    assert.match(source.revision, /^[0-9a-f]{40}$/)
    assert.match(source.sha256, /^[0-9a-f]{64}$/)
    assert.match(source.url, new RegExp(source.revision))
    assert.doesNotMatch(source.url, /\/(?:main|master|develop)\//)
  }

  assert.equal(pciTargets.entries['1002:731f'].target, 'gfx1010')
  assert.equal(pciTargets.entries['1002:7340'].target, 'gfx1012')
  assert.equal(pciTargets.entries['1002:73ff'].target, 'gfx1032')
  assert.equal(pciTargets.entries['1002:73ff'].family, 'NAVI23')
  assert.equal(pciTargets.revision_entries['1002:73ff:c3'].model, 'AMD Radeon RX 6600M')
  assert.equal(pciTargets.revision_entries['1002:73ff:c3'].target, 'gfx1032')
  assert.equal(pciTargets.revision_entries['1002:744c:c8'].target, 'gfx1100')
  assert.equal(
    Object.values(pciTargets.entries).some((entry) => entry.family === 'LIBDRM_MODEL_CONSENSUS'),
    false
  )
})

test('AMD gfx target refresh is an explicit maintainer command', () => {
  assert.equal(packageJson.scripts['update:amd-gfx-targets'], 'node script/update-amd-gfx-targets.js')
  assert.equal(packageJson.scripts['check:amd-gfx-targets'], 'node script/update-amd-gfx-targets.js --check')
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.scripts, 'update:amd-rocm-targets'), false)

  for (const script of ['preinstall', 'install', 'postinstall', 'prestart', 'start', 'poststart']) {
    assert.doesNotMatch(packageJson.scripts[script] || '', /update-amd-gfx-targets/)
  }
})

test('AMD gfx resolver maps common product names to exact gfx targets', () => {
  const cases = [
    ['AMD Radeon RX 6800 XT', 'gfx1030'],
    ['AMD Radeon RX 7600', 'gfx1102'],
    ['Advanced Micro Devices Radeon RX 7900 XTX', 'gfx1100'],
    ['AMD Radeon RX 9070 XT', 'gfx1201'],
    ['AMD Radeon AI PRO R9700', 'gfx1201'],
    ['AMD Instinct MI210', 'gfx90a'],
    ['AMD Radeon 780M', 'gfx1103'],
    ['AMD Radeon 890M', 'gfx1150'],
    ['gfx1030', 'gfx1030']
  ]

  for (const [model, target] of cases) {
    assert.equal(amd.resolve_rocm_gfx_target(model), target, model)
  }
})

test('AMD model resolver does not hand-maintain product gaps covered by PCI identity', () => {
  assert.equal(gfxTargets.entries['radeon rx 6600m'], undefined)
  assert.equal(amd.resolve_rocm_gfx_target('AMD Radeon RX 6600'), 'gfx1032')
  assert.equal(amd.resolve_rocm_gfx_target('AMD Radeon RX 6600M'), null)
  assert.equal(amd.resolve_rocm_gfx_target('AMD Radeon(TM) RX 6600M'), null)
})

test('AMD gfx resolver rejects unknown products and preserves raw gfx targets', () => {
  const unknownModels = [
    'AMD Radeon RX 480',
    'AMD Radeon RX 5700 XT',
    'AMD Radeon RX 9999',
    'AMD Radeon RX 9999M XT'
  ]

  for (const model of unknownModels) {
    assert.equal(amd.resolve_rocm_gfx_target(model), null, model)
  }

  for (const target of ['gfx803', 'gfx1013', 'gfx1104', 'gfx1209', 'GFX90A']) {
    assert.equal(amd.resolve_rocm_gfx_target(target), target.toLowerCase(), target)
  }
})

test('AMD gpu_target resolution uses CPU brand only for generic Radeon Graphics models', async () => {
  let cpuBrandCalls = 0
  const cpuBrand = async () => {
    cpuBrandCalls += 1
    return 'AMD Ryzen AI 9 HX 375'
  }

  assert.equal(await amd.resolve_gpu_target('AMD Radeon RX 6800 XT', cpuBrand), 'gfx1030')
  assert.equal(cpuBrandCalls, 0)

  assert.equal(await amd.resolve_gpu_target('AMD Radeon RX 480', cpuBrand), null)
  assert.equal(cpuBrandCalls, 0)

  assert.equal(await amd.resolve_gpu_target('AMD Radeon Graphics', cpuBrand), 'gfx1150')
  assert.equal(cpuBrandCalls, 1)

  assert.equal(await amd.resolve_gpu_target('AMD Radeon Graphics', 'Unknown AMD CPU'), null)
})

test('Sysinfo exposes AMD gpu_target for resolved discrete GPUs', async (t) => {
  t.mock.method(amdPci, 'resolve_gpu_target', async () => {
    throw new Error('PCI fallback should not run for a resolved model')
  })
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 6800 XT',
        vram: 16384,
        driverVersion: '31.0.1'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_target, 'gfx1030')
})

test('Sysinfo exposes AMD gpu_target for a PCI-resolved mobile GPU', async (t) => {
  t.mock.method(amdPci, 'resolve_gpu_target', async (controller) => {
    assert.equal(controller.model, 'AMD Radeon RX 6600M')
    return 'gfx1032'
  })
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'Advanced Micro Devices, Inc.',
        model: 'AMD Radeon(TM) Graphics',
        vram: 512
      },
      {
        vendor: 'Advanced Micro Devices, Inc.',
        model: 'AMD Radeon RX 6600M',
        vram: 8192
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_model, 'amd radeon rx 6600m')
  assert.equal(sys.info.gpu_target, 'gfx1032')
})

test('Sysinfo uses exact AMD PCI identity after model lookup misses', async (t) => {
  t.mock.method(amdPci, 'resolve_gpu_target', async (controller) => {
    assert.equal(controller.model, 'AMD Radeon RX 5700 XT')
    return 'gfx1010'
  })
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 5700 XT',
        vram: 8192
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu_target, 'gfx1010')
})

test('Sysinfo leaves unresolved AMD gpu_target null', async (t) => {
  t.mock.method(amdPci, 'resolve_gpu_target', async () => null)
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 480',
        vram: 8192,
        driverVersion: '31.0.1'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_target, null)
})

test('Sysinfo exposes AMD gpu_target through generic APU CPU fallback', async (t) => {
  let cpuBrandCalls = 0
  t.mock.method(amdPci, 'resolve_gpu_target', async () => {
    throw new Error('PCI fallback should not run for a resolved APU')
  })
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon Graphics',
        vram: 16384,
        driverVersion: '31.0.1'
      }
    ],
    displays: []
  }))
  t.mock.method(system, 'cpu', async () => {
    cpuBrandCalls += 1
    return { brand: 'AMD Ryzen AI 9 HX 375' }
  })

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_target, 'gfx1150')
  assert.equal(cpuBrandCalls, 1)
})

test('AMD model fallback stays offline and data-only', () => {
  const modelSource = fs.readFileSync(path.join(root, 'kernel', 'gpu', 'amd.js'), 'utf8')
  const pciSource = fs.readFileSync(path.join(root, 'kernel', 'gpu', 'amd_pci.js'), 'utf8')

  assert.doesNotMatch(modelSource, /require\(["'](?:node:)?https?["']\)/)
  assert.doesNotMatch(modelSource, /require\(["'](?:node:)?child_process["']\)/)
  assert.doesNotMatch(modelSource, /\b(fetch|axios|rocminfo|hipInfo|ze_info)\b/)
  assert.doesNotMatch(modelSource, /\b(kfd|topology)\b/i)
  assert.doesNotMatch(pciSource, /require\(["'](?:node:)?https?["']\)/)
  assert.doesNotMatch(pciSource, /\b(fetch|axios|OpenCL|rocminfo|hipInfo)\b/i)
})
