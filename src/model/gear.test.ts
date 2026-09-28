import { describe, expect, it } from 'vitest'
import { drawingToDxf, drawingsToPdf } from '@tomkail/workshop-kit'
import { DEFAULT_DOC, DEFAULT_GEAR, docFromQuery, docToQuery, dpToModule, moduleToDp, normaliseDoc, parseToothSize, type GearSpec } from './design'
import { autoProfileShift, computeGear } from './gear'
import { buildGearDrawing, buildPages } from './template'
import { computeDoc } from './train'

const compute = (changes: Partial<GearSpec> = {}) => computeGear({ ...DEFAULT_GEAR, ...changes }, DEFAULT_DOC.cutting, 'mm')
const codes = (changes: Partial<GearSpec> = {}) => compute(changes).issues.map((i) => i.code)

describe('gear checks', () => {
  it('the default gear is valid with no warnings', () => {
    const g = compute()
    expect(g.valid).toBe(true)
    expect(g.issues).toEqual([])
    expect(g.drill?.diameter).toBe(5)
    expect(g.drill?.centres).toHaveLength(20)
  })

  it('flags undercut exactly below the minimum tooth count', () => {
    // z_min = 2 / sin²α: 17.1 at 20°, so 17 teeth undercut and 18 don't
    expect(codes({ teeth: 17 })).toContain('undercut')
    expect(codes({ teeth: 18 })).not.toContain('undercut')
    // 11.2 at 25°
    expect(codes({ teeth: 11, pressureAngle: 25 })).toContain('undercut')
    expect(codes({ teeth: 12, pressureAngle: 25 })).not.toContain('undercut')
  })

  it('auto profile shift removes the undercut warning when the tips allow', () => {
    for (const teeth of [12, 15]) {
      const shift = autoProfileShift({ ...DEFAULT_GEAR, teeth })
      expect(shift.capped).toBe(false)
      expect(codes({ teeth, profileShift: shift.value })).not.toContain('undercut')
    }
    expect(autoProfileShift({ ...DEFAULT_GEAR, teeth: 30 })).toEqual({ value: 0, needed: 0, capped: false })
  })

  it('auto profile shift never makes the teeth pointed or the tips too narrow', () => {
    for (const pressureAngle of [20, 25]) {
      for (let teeth = 6; teeth <= 20; teeth++) {
        const shift = autoProfileShift({ ...DEFAULT_GEAR, teeth, pressureAngle })
        const found = codes({ teeth, pressureAngle, profileShift: shift.value })
        expect(found).not.toContain('profile')
        if (shift.value > 0) expect(found).not.toContain('tip-narrow')
      }
    }
    // The case that made the gear vanish: 8 teeth at 20° needs 0.54, but the tips only allow about 0.2
    const eight = autoProfileShift({ ...DEFAULT_GEAR, teeth: 8 })
    expect(eight.capped).toBe(true)
    expect(eight.needed).toBeCloseTo(0.54, 2)
    expect(eight.value).toBeLessThan(0.25)
  })

  it('still draws a gear whose teeth come to a point, but marks it invalid', () => {
    const g = compute({ teeth: 8, profileShift: 0.54 })
    expect(codes({ teeth: 8, profileShift: 0.54 })).toContain('profile')
    expect(g.outline).not.toBeNull()
    expect(g.valid).toBe(false)
  })

  it('warns about small teeth and narrow tips', () => {
    expect(codes({ module: 2 })).toContain('small-teeth')
    expect(codes({ teeth: 10, profileShift: 0.5 })).toContain('tip-narrow')
  })

  it('checks root holes and blade radius', () => {
    // A bit bigger than the gap lifts the hole bottom above the root circle
    expect(codes({ drillDiameter: 8 })).toContain('clearance')
    expect(compute({ drillDiameter: 8 }).valid).toBe(false)
    // Fillet corners smaller than the blade can turn
    const g = computeGear({ ...DEFAULT_GEAR, root: 'fillet', rootFillet: 0.1 }, { method: 'scroll', toolRadius: 3 }, 'mm')
    expect(g.issues.map((i) => i.code)).toContain('blade-radius')
  })

  it('checks the bore against the roots', () => {
    expect(codes({ bore: { ...DEFAULT_GEAR.bore, diameter: 70 } })).toContain('bore')
    expect(codes({ bore: { ...DEFAULT_GEAR.bore, diameter: 60 } })).toContain('bore-wall')
    expect(compute({ bore: { ...DEFAULT_GEAR.bore, type: 'key' } }).bore?.kind).toBe('path')
    expect(compute({ bore: { ...DEFAULT_GEAR.bore, type: 'flat' } }).bore?.kind).toBe('path')
  })
})

describe('stub teeth', () => {
  it('uses stub proportions: 0.8 × module above the pitch circle, 1 below', () => {
    const g = compute({ toothForm: 'stub', root: 'fillet' })
    expect(g.dims.ra).toBeCloseTo(40 + 0.8 * 4)
    expect(g.dims.rf).toBeCloseTo(40 - 4)
    // Nominal clearance is dedendum − addendum = 0.2 × module
    expect(g.stats.clearance).toBeCloseTo(0.2 * 4)
    expect(g.valid).toBe(true)
  })

  it('undercuts at fewer teeth than full depth', () => {
    // z_min = 2·0.8 / sin²20° = 13.7
    expect(codes({ toothForm: 'stub', teeth: 13 })).toContain('undercut')
    expect(codes({ toothForm: 'stub', teeth: 14 })).not.toContain('undercut')
    expect(codes({ teeth: 14 })).toContain('undercut')
  })

  it('lets auto profile shift fix a small gear that full depth can’t', () => {
    const full = autoProfileShift({ ...DEFAULT_GEAR, teeth: 10 })
    const stub = autoProfileShift({ ...DEFAULT_GEAR, teeth: 10, toothForm: 'stub' })
    expect(full.capped).toBe(true)
    expect(stub.capped).toBe(false)
    expect(codes({ teeth: 10, toothForm: 'stub', profileShift: stub.value })).not.toContain('undercut')
  })

  it('suggests stub teeth when they would fix the undercut', () => {
    const message = compute({ teeth: 10 }).issues.find((i) => i.code === 'undercut')!.message
    expect(message).toMatch(/stub teeth/)
  })
})

describe('units and parsing', () => {
  it('converts between module and diametral pitch', () => {
    expect(moduleToDp(25.4)).toBe(1)
    expect(dpToModule(10)).toBeCloseTo(2.54)
  })

  it('reads tooth sizes as module or DP', () => {
    expect(parseToothSize('4', 'module')).toBe(4)
    expect(parseToothSize('m4', 'dp')).toBe(4)
    expect(parseToothSize('4 mod', 'dp')).toBe(4)
    expect(parseToothSize('10dp', 'module')).toBeCloseTo(2.54)
    expect(parseToothSize('dp 10', 'module')).toBeCloseTo(2.54)
    expect(parseToothSize('10', 'dp')).toBeCloseTo(2.54)
    expect(parseToothSize('abc', 'module')).toBeNull()
  })
})

describe('documents', () => {
  it('round-trips through the share URL', () => {
    const doc = normaliseDoc({
      name: 'Test gear',
      gears: [{ ...DEFAULT_GEAR, teeth: 14, module: 5, pressureAngle: 25, profileShift: 0.15, root: 'fillet', rootFillet: 0.3, bore: { type: 'key', diameter: 10, flatAcross: 0, keyWidth: 3, keyDepth: 1.4 } }],
      cutting: { method: 'scroll', toolRadius: 3 },
    })
    const back = docFromQuery(docToQuery(doc))!
    expect(back.name).toBe('Test gear')
    expect(back.gears[0]).toMatchObject({ teeth: 14, module: 5, pressureAngle: 25, profileShift: 0.15, root: 'fillet', rootFillet: 0.3 })
    expect(back.gears[0].bore).toMatchObject({ type: 'key', diameter: 10, keyWidth: 3, keyDepth: 1.4 })
    expect(back.cutting.toolRadius).toBe(3)
  })

  it('normalises junk into a valid document', () => {
    const doc = normaliseDoc({ name: 42 as unknown as string, gears: [{ teeth: 3, module: -1 }] })
    expect(doc.gears[0].teeth).toBe(6)
    expect(doc.gears[0].module).toBe(0.5)
    expect(doc.name).toBe(DEFAULT_DOC.name)
  })
})

describe('output', () => {
  it('prints the default gear on one true-size A4 page', () => {
    const g = compute()
    const pages = buildPages(DEFAULT_DOC, computeDoc({ ...DEFAULT_DOC, gears: [g.spec] }, 'mm'), { paperId: 'a4', landscape: false, unit: 'mm', labels: true, construction: true, scaleCheck: true })
    expect(pages).toHaveLength(1)
    expect(pages[0].width).toBe(210)
    expect(pages[0].mmPerUnit).toBe(1)
    const pdf = new TextDecoder('latin1').decode(drawingsToPdf(pages))
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/MediaBox [0 0 595.276 841.89]')
  })

  it('tiles a gear too big for the paper', () => {
    const g = compute({ teeth: 60, module: 5 })
    const pages = buildPages(DEFAULT_DOC, computeDoc({ ...DEFAULT_DOC, gears: [g.spec] }, 'mm'), { paperId: 'a4', landscape: false, unit: 'mm', labels: true, construction: true, scaleCheck: true })
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0].sheet?.label).toBe('A1')
  })

  it('puts one root hole per tooth in the DXF', () => {
    const g = compute({ teeth: 24 })
    const dxf = drawingToDxf(buildGearDrawing(DEFAULT_DOC, computeDoc({ ...DEFAULT_DOC, gears: [g.spec] }, 'mm'), { unit: 'mm', labels: false, construction: false }), { text: false })
    const holes = dxf.split('\n0\nCIRCLE\n8\nHOLES\n').length - 1
    expect(holes).toBe(24)
    expect(dxf).toContain('\nOUTLINE\n')
    expect(dxf.trim().endsWith('EOF')).toBe(true)
  })
})
