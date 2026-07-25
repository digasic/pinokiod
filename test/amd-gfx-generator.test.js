const assert = require('node:assert/strict')
const test = require('node:test')

const generator = require('../script/update-amd-gfx-targets')

test('AMD generator joins LLVM aliases, Mesa families, and PCI IDs', () => {
  const llvm = `
    def : ProcessorModel<"gfx803", Model, FeatureISAVersion8_0_3.Features>;
    def : ProcessorModel<"polaris10", Model, FeatureISAVersion8_0_3.Features>;
  `
  const families = `
    const char *ac_get_llvm_processor_name(enum radeon_family family) {
      switch (family) {
      case CHIP_POLARIS10:
        return "polaris10";
      case CHIP_NAVI23:
        return "gfx1032";
      }
    }
    const char *ac_get_ip_type_string(void) {}
  `

  const processors = generator.parseLlvmProcessorTargets(llvm)
  const familyTargets = generator.parseMesaFamilyTargets(families, processors)
  const entries = generator.parseMesaPciTargets(
    'CHIPSET(0x67DF, POLARIS10)\n',
    familyTargets
  )
  generator.parseLinuxPciTargets(
    '{0x1002, 0x73FF, PCI_ANY_ID, PCI_ANY_ID, 0, 0, CHIP_DIMGREY_CAVEFISH},',
    familyTargets,
    { DIMGREY_CAVEFISH: 'NAVI23' },
    entries
  )

  assert.equal(familyTargets.POLARIS10, 'gfx803')
  assert.equal(entries['1002:67df'].target, 'gfx803')
  assert.equal(entries['1002:73ff'].target, 'gfx1032')
})

test('AMD generator derives former Mesa family aliases from pinned comments', () => {
  assert.deepEqual(generator.parseMesaFamilyAliases(`
    CHIP_NAVI21, /* formerly "Sienna Cichlid" */
    CHIP_NAVI23, /* formerly "Dimgrey Cavefish" */
  `), {
    SIENNA_CICHLID: 'NAVI21',
    DIMGREY_CAVEFISH: 'NAVI23'
  })
})

test('AMD generator rejects conflicting PCI family targets', () => {
  assert.throws(() => generator.parseLinuxPciTargets(
    [
      '{0x1002, 0x73FF, 0, 0, 0, 0, CHIP_NAVI21},',
      '{0x1002, 0x73FF, 0, 0, 0, 0, CHIP_NAVI23},'
    ].join('\n'),
    { NAVI21: 'gfx1030', NAVI23: 'gfx1032' },
    {}
  ), /Conflicting targets/)
})

test('AMD generator keeps exact libdrm revisions without promoting model names', () => {
  const pciTargets = {}
  const revisions = generator.parseLibdrmRevisionTargets(
    '744c, c8, AMD Radeon RX 7900 XTX\n',
    { 'radeon rx 7900 xtx': 'gfx1100' },
    pciTargets
  )

  assert.deepEqual(revisions['1002:744c:c8'], {
    target: 'gfx1100',
    model: 'AMD Radeon RX 7900 XTX'
  })
  assert.equal(pciTargets['1002:744c'], undefined)
})
