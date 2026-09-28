import { describe, expect, it } from 'vitest'
import { arcSweep, type Vec } from '@tomkail/workshop-kit'
import { DEFAULT_DOC, DEFAULT_GEAR, docFromQuery, docToQuery, normaliseDoc, type GearSpec } from './design'
import { DEG, cubicPoint, segmentEndPoint, type Path } from './involute'
import { buildGearDrawing, buildPages } from './template'
import { centreDistance, computeDoc, contactRatio, gearAngle, meshPhase, workingPressureAngle } from './train'

function samplePath(path: Path, perSegment = 16): Vec[] {
  const out: Vec[] = []
  let current = path.start
  for (const seg of path.segments) {
    for (let i = 1; i <= perSegment; i++) {
      const u = i / perSegment
      if (seg.type === 'line') out.push({ x: current.x + (seg.to.x - current.x) * u, y: current.y + (seg.to.y - current.y) * u })
      else if (seg.type === 'cubic') out.push(cubicPoint(current, seg, u))
      else {
        const a = seg.start + arcSweep(seg) * u
        out.push({ x: seg.center.x + seg.radius * Math.cos(a), y: seg.center.y + seg.radius * Math.sin(a) })
      }
    }
    current = segmentEndPoint(seg)
  }
  return out
}

const place = (points: Vec[], center: Vec, angle: number): Vec[] =>
  points.map((p) => ({ x: center.x + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: center.y + p.x * Math.sin(angle) + p.y * Math.cos(angle) }))

function inside(p: Vec, poly: Vec[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

function pair(a: Partial<GearSpec>, b: Partial<GearSpec>, angle = 0) {
  return normaliseDoc({ ...DEFAULT_DOC, gears: [{ ...DEFAULT_GEAR, ...a }, { ...DEFAULT_GEAR, id: 'g2', ...b }], links: [{ a: 'g1', b: 'g2', angle }] })
}

/** Step the driver through one tooth pitch; report overlapping points and the closest approach */
function meshCheck(doc: ReturnType<typeof pair>, phaseError = 0) {
  const geo = computeDoc(doc, 'mm')
  const [A, B] = geo.gears
  const ptsA = samplePath(A.outline!)
  const ptsB = samplePath(B.outline!)
  let overlaps = 0
  let closest = Infinity
  const steps = 10
  for (let s = 0; s < steps; s++) {
    const t = ((2 * Math.PI) / A.spec.teeth) * (s / steps)
    const polyA = place(ptsA, geo.placements[0].center, gearAngle(geo.placements[0], t))
    const polyB = place(ptsB, geo.placements[1].center, gearAngle(geo.placements[1], t) + phaseError)
    // Only points near the line of centres can touch
    const cB = geo.placements[1].center
    for (const p of polyB) {
      if (Math.hypot(p.x - cB.x, p.y - cB.y) < B.dims.rf) continue
      if (inside(p, polyA)) overlaps++
    }
    for (const p of polyB) {
      const dA = Math.hypot(p.x - geo.placements[0].center.x, p.y - geo.placements[0].center.y)
      if (dA > A.dims.ra + 1) continue
      for (const q of polyA) closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y))
    }
  }
  return { overlaps, closest, geo }
}

describe('mesh maths', () => {
  it('uses the standard centre distance without profile shift', () => {
    expect(centreDistance(4, 20 * DEG, 20, 40, 0, 0)).toBeCloseTo(120)
    expect(workingPressureAngle(20 * DEG, 20, 40, 0, 0)).toBeCloseTo(20 * DEG)
  })

  it('matches a worked profile-shift example (KHK: m3, z 12/24, x 0.6/0.36)', () => {
    expect(workingPressureAngle(20 * DEG, 12, 24, 0.6, 0.36) / DEG).toBeCloseTo(26.0886, 3)
    expect(centreDistance(3, 20 * DEG, 12, 24, 0.6, 0.36)).toBeCloseTo(56.4999, 3)
  })

  it('gives the textbook contact ratio for a 20/20 pair', () => {
    const rb = 10 * Math.cos(20 * DEG)
    expect(contactRatio(11, rb, 11, rb, 20, 20 * DEG, 1, 20 * DEG)).toBeCloseTo(1.557, 3)
  })

  it('puts a gap opposite a tooth on the line of centres', () => {
    // θ_a = φ: a's tooth points at b, so b shows a gap (half a pitch off its own tooth) back towards a
    const phi = 0.3
    const thetaB = meshPhase(phi, 20, 30, phi)
    expect(thetaB - (phi + Math.PI)).toBeCloseTo(Math.PI / 30)
  })
})

describe('meshing pair', () => {
  const cases: [string, Partial<GearSpec>, Partial<GearSpec>, number][] = [
    ['20 / 40, drilled roots', {}, { teeth: 40 }, 0],
    ['12 / 30 with profile shift, filleted', { teeth: 12, profileShift: 0.3, root: 'fillet' }, { teeth: 30, root: 'fillet' }, 35],
    ['15 / 15 at 25°, placed below', { teeth: 15, pressureAngle: 25 }, { teeth: 15, pressureAngle: 25 }, 90],
    ['9 / 27 with shift on both', { teeth: 9, profileShift: 0.3, pressureAngle: 25 }, { teeth: 27, profileShift: 0.2, pressureAngle: 25 }, -120],
  ]

  for (const [name, a, b, angle] of cases) {
    it(`turns through a tooth pitch without overlapping: ${name}`, () => {
      const { overlaps, closest, geo } = meshCheck(pair({ ...a, backlash: 0.2 }, { ...b, backlash: 0.2 }, angle))
      expect(geo.gears.every((g) => g.outline)).toBe(true)
      expect(overlaps).toBe(0)
      // …and they actually engage, rather than just sitting apart
      expect(closest).toBeLessThan(0.5)
    })
  }

  it('the overlap check catches a wrong phase', () => {
    const { overlaps } = meshCheck(pair({ backlash: 0.2 }, { teeth: 40, backlash: 0.2 }), Math.PI / 40)
    expect(overlaps).toBeGreaterThan(0)
  })

  it('reports ratio, speeds and directions', () => {
    const geo = computeDoc(pair({}, { teeth: 40 }), 'mm')
    const mesh = geo.meshes[0]
    expect(mesh.ratio).toBe(2)
    expect(mesh.centreDistance).toBeCloseTo(120)
    expect(mesh.backlash).toBeCloseTo(0.8)
    expect(mesh.contactRatio).toBeGreaterThan(1.4)
    expect(geo.placements[1].speed).toBeCloseTo(-0.5)
    expect(geo.placements[1].center.x).toBeCloseTo(120)
    expect(geo.valid).toBe(true)
  })

  it('warns when the contact ratio is low', () => {
    const geo = computeDoc(pair({ teeth: 8, pressureAngle: 25, profileShift: 0.5, tipRound: 0.4 }, { teeth: 8, profileShift: 0.5, tipRound: 0.4 }), 'mm')
    expect(geo.meshes[0].issues.map((i) => i.code)).toContain('contact')
  })

  it('shares tooth size and pressure angle across the pair', () => {
    const doc = pair({ module: 5 }, { module: 3, pressureAngle: 25 })
    expect(doc.gears[1].module).toBe(5)
    expect(doc.gears[1].pressureAngle).toBe(20)
  })

  it('round-trips a pair through the share URL', () => {
    const doc = normaliseDoc({ ...pair({ teeth: 14 }, { teeth: 35, root: 'fillet', bore: { ...DEFAULT_GEAR.bore, diameter: 12 } }, 45), driverRpm: 30 })
    const back = docFromQuery(docToQuery(doc))!
    expect(back.gears).toHaveLength(2)
    expect(back.gears[1]).toMatchObject({ teeth: 35, root: 'fillet' })
    expect(back.gears[1].bore.diameter).toBe(12)
    expect(back.links[0].angle).toBe(45)
    expect(back.driverRpm).toBe(30)
  })

  it('prints both gears, labelled, with an axle-spacing gauge', () => {
    const doc = pair({ teeth: 12 }, { teeth: 24 })
    const geo = computeDoc(doc, 'mm')
    const texts = buildGearDrawing(doc, geo, { unit: 'mm', labels: true, construction: false }).items.flatMap((i) => (i.kind === 'text' ? [i.text] : []))
    expect(texts).toContain('A · 12 teeth · meshes with B (24 teeth)')
    expect(texts.some((t) => t.startsWith('Axle spacing A–B: 72 mm'))).toBe(true)
    // The gauge's crosshairs are exactly one centre distance apart
    const marks = buildGearDrawing(doc, geo, { unit: 'mm', labels: false, construction: false }).items.filter((i) => i.kind === 'circle' && i.radius === 1.5)
    expect(marks).toHaveLength(2)
    const [a, b] = marks as Extract<(typeof marks)[number], { kind: 'circle' }>[]
    expect(Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)).toBeCloseTo(72)
    const pages = buildPages(doc, geo, { paperId: 'a4', landscape: true, unit: 'mm', labels: true, construction: true, scaleCheck: true })
    expect(pages.length).toBeGreaterThanOrEqual(1)
  })
})
