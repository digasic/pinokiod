const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const amdPci = require('../kernel/gpu/amd_pci')

test('AMD PCI identity parser handles Windows PNP IDs and numeric fields', () => {
  assert.deepEqual(amdPci.parse_pci_identity({
    PNPDeviceID: 'PCI\\VEN_1002&DEV_73FF&SUBSYS_01241002&REV_C3\\6&ABC'
  }), {
    vendor: '1002',
    device: '73ff',
    revision: 'c3'
  })

  assert.deepEqual(amdPci.parse_pci_identity({
    vendorId: '0x1002',
    deviceId: '0x731F',
    revision: '0xC1'
  }), {
    vendor: '1002',
    device: '731f',
    revision: 'c1'
  })

  assert.deepEqual(amdPci.parse_pci_identity({
    vendorId: 0x1002,
    deviceId: 0x73ff,
    revisionId: 0xc3
  }), {
    vendor: '1002',
    device: '73ff',
    revision: 'c3'
  })
})

test('AMD PCI resolver covers RX 6600M, RDNA1, and newer revision mappings', () => {
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: '73ff',
    revision: 'c3'
  }), 'gfx1032')
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: '731f',
    revision: 'c1'
  }), 'gfx1010')
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: '744c',
    revision: 'c8'
  }), 'gfx1100')
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: '744c',
    revision: 'cf'
  }), null)
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: '747e',
    revision: 'd8'
  }), null)
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: '7550',
    revision: 'c0'
  }), 'gfx1201')
  assert.equal(amdPci.resolve_pci_target({
    vendor: '1002',
    device: 'ffff',
    revision: '00'
  }), null)
})

test('AMD PCI target resolution matches the selected controller in a dual-AMD system', async () => {
  const target = await amdPci.resolve_gpu_target(
    { model: 'AMD Radeon RX 6600M' },
    {
      platform: 'win32',
      execFile: async () => ({
        stdout: JSON.stringify([
          {
            Name: 'AMD Radeon(TM) Graphics',
            PNPDeviceID: 'PCI\\VEN_1002&DEV_164E&REV_C1'
          },
          {
            Name: 'AMD Radeon RX 6600M',
            PNPDeviceID: 'PCI\\VEN_1002&DEV_73FF&REV_C3'
          }
        ])
      })
    }
  )

  assert.equal(target, 'gfx1032')
})

test('AMD Windows identity query parses the built-in CIM response', async () => {
  let invocation
  const records = await amdPci.query_windows_adapters({
    execFile: async (...args) => {
      invocation = args
      return {
        stdout: JSON.stringify({
          Name: 'AMD Radeon RX 6600M',
          AdapterCompatibility: 'Advanced Micro Devices, Inc.',
          PNPDeviceID: 'PCI\\VEN_1002&DEV_73FF&REV_C3'
        })
      }
    }
  })

  assert.equal(invocation[0], 'powershell.exe')
  assert.ok(invocation[1].includes('-NoProfile'))
  assert.equal(records.length, 1)
  assert.equal(records[0].pnpDeviceId, 'PCI\\VEN_1002&DEV_73FF&REV_C3')
})

test('AMD Linux identity reads the selected PCI device directly from sysfs', async () => {
  const sysfsRoot = '/mock/sys/bus/pci/devices'
  const values = new Map([
    [path.join(sysfsRoot, '0000:03:00.0', 'vendor'), '0x1002\n'],
    [path.join(sysfsRoot, '0000:03:00.0', 'device'), '0x731f\n'],
    [path.join(sysfsRoot, '0000:03:00.0', 'revision'), '0xc1\n']
  ])
  const identity = await amdPci.linux_identity(
    { busAddress: '03:00.0' },
    {
      sysfsRoot,
      readFile: async (file) => {
        if (!values.has(file)) throw new Error(`Unexpected read: ${file}`)
        return values.get(file)
      }
    }
  )

  assert.deepEqual(identity, {
    vendor: '1002',
    device: '731f',
    revision: 'c1'
  })
})

test('AMD PCI target resolution uses controller IDs directly on macOS', async () => {
  let reads = 0
  const target = await amdPci.resolve_gpu_target({
    vendorId: '0x1002',
    deviceId: '0x731f'
  }, {
    platform: 'darwin',
    readFile: async (file) => {
      reads += 1
      throw new Error(`Unexpected read: ${file}`)
    }
  })

  assert.equal(target, 'gfx1010')
  assert.equal(reads, 0)
})
