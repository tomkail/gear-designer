import { describe, expect, it } from 'vitest'
import { arcSweep, type Segment, type Vec } from '@tomkail/workshop-kit'
import { DEFAULT_GEAR } from './design'
import {
  DEG,
  cubicPoint,
  dimensions,
  flankAngle,
  flankError,
  gearOutline,
  idealDrillDiameter,
  segmentEndPoint,
  toothProfile,
  type Path,
  type ToothInput,
} from './involute'

const BASE: ToothInput = { teeth: 20, module: 4, pressureAngle: 20, profileShift: 0, backlash: 0, tipRound: 0.4, root: { kind: 'fillet', radius: 1.5 } }

const arcStart = (s: Extract<Segment, { type: 'arc' }>): Vec => ({ x: s.center.x + s.radius * Math.cos(s.start), y: s.center.y + s.radius * Math.sin(s.start) })
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/** Every segment starts where the last one ended, and no arc loops the wrong way */
function checkContinuous(path: Path, closed: boolean) {
  let current = path.start
  for (const seg of path.segments) {
    if (seg.type === 'arc') {
      expect(dist(arcStart(seg), current)).toBeLessThan(1e-6)
      expect(Math.abs(arcSweep(seg))).toBeLessThan(Math.PI)
    }
    current = segmentEndPoint(seg)
  }
  if (closed) expect(dist(current, path.start)).toBeLessThan(1e-6)
}

/** Dense points along a path */
function sample(path: Path, perSegment = 24): Vec[] {
  const out: Vec[] = [path.start]
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

/** Signed area (shoelace); positive when angles increase along the path */
function area(points: Vec[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

describe('gear dimensions', () => {
  it('matches the textbook formulas', () => {
    const d = dimensions(BASE)
    expect(d.r).toBeCloseTo(40)
    expect(d.rb).toBeCloseTo(40 * Math.cos(20 * DEG))
    expect(d.ra).toBeCloseTo(44)
    expect(d.rf).toBeCloseTo(35)
    expect(d.s).toBeCloseTo(2 * Math.PI)
  })

  it('applies profile shift and backlash', () => {
    const d = dimensions({ ...BASE, profileShift: 0.3, backlash: 0.4 })
    expect(d.ra).toBeCloseTo(40 + 4 * 1.3)
    expect(d.rf).toBeCloseTo(40 - 4 * 0.95)
    expect(d.s).toBeCloseTo(4 * (Math.PI / 2 + 0.6 * Math.tan(20 * DEG)) - 0.4)
  })
})

describe('tooth profile', () => {
  const cases: [string, ToothInput][] = [
    ['default fillet root', BASE],
    ['drilled root', { ...BASE, root: { kind: 'drill', diameter: 6 } }],
    ['sharp tips and roots', { ...BASE, tipRound: 0, root: { kind: 'fillet', radius: 0 } }],
    ['few teeth, 25°', { ...BASE, teeth: 8, pressureAngle: 25, profileShift: 0.4 }],
    ['many teeth (root above base circle)', { ...BASE, teeth: 80 }],
    ['large module with backlash', { ...BASE, module: 6, backlash: 0.6, root: { kind: 'drill', diameter: 8 } }],
  ]

  for (const [name, input] of cases) {
    it(`closes and stays continuous: ${name}`, () => {
      const profile = toothProfile(input)
      expect(profile.error).toBeNull()
      checkContinuous(profile.tooth, false)
      const outline = gearOutline(profile)
      checkContinuous(outline, true)
      const points = sample(outline)
      // A simple closed outline enclosing roughly the pitch-circle area
      const d = profile.dims
      expect(area(points)).toBeGreaterThan(Math.PI * d.rf * d.rf)
      expect(area(points)).toBeLessThan(Math.PI * d.ra * d.ra)
      for (const p of points) {
        const r = Math.hypot(p.x, p.y)
        expect(r).toBeLessThanOrEqual(d.ra + 1e-6)
        expect(r).toBeGreaterThanOrEqual(Math.min(d.rf, profile.root?.bottom ?? d.rf) - 1e-6)
      }
    })
  }

  it('has the right tooth thickness at the pitch circle', () => {
    for (const input of [BASE, { ...BASE, backlash: 0.4 }, { ...BASE, teeth: 12, profileShift: 0.3 }]) {
      const profile = toothProfile(input)
      const d = profile.dims
      // Find where the sampled upper flank crosses the pitch circle
      const points = sample(profile.half, 200)
      let crossing: Vec | null = null
      for (let i = 1; i < points.length; i++) {
        const r0 = Math.hypot(points[i - 1].x, points[i - 1].y)
        const r1 = Math.hypot(points[i].x, points[i].y)
        if ((r0 - d.r) * (r1 - d.r) <= 0) {
          const u = (d.r - r0) / (r1 - r0)
          crossing = { x: points[i - 1].x + (points[i].x - points[i - 1].x) * u, y: points[i - 1].y + (points[i].y - points[i - 1].y) * u }
          break
        }
      }
      expect(crossing).not.toBeNull()
      const halfAngle = Math.atan2(crossing!.y, crossing!.x)
      expect(2 * halfAngle * d.r).toBeCloseTo(d.s, 2)
    }
  })

  it('is symmetric about the tooth centreline', () => {
    const profile = toothProfile(BASE)
    const upper = sample(profile.half, 40)
    const lower = sample(profile.tooth, 40)
    // Every point on the upper half has a mirror image on the full tooth
    for (const p of upper) {
      const mirror = { x: p.x, y: -p.y }
      const nearest = Math.min(...lower.map((q) => dist(q, mirror)))
      expect(nearest).toBeLessThan(0.05)
    }
  })

  it('fits the involute with Béziers to within 0.01 mm', () => {
    for (const input of [BASE, { ...BASE, teeth: 8, pressureAngle: 25, profileShift: 0.4 }, { ...BASE, teeth: 120, module: 6 }]) {
      const profile = toothProfile(input)
      const d = profile.dims
      let current = profile.half.start
      let cubics = 0
      for (const seg of profile.half.segments) {
        if (seg.type === 'cubic') {
          cubics++
          for (let i = 0; i <= 50; i++) expect(flankError(d, cubicPoint(current, seg, i / 50))).toBeLessThan(0.01)
        }
        current = segmentEndPoint(seg)
      }
      expect(cubics).toBeGreaterThanOrEqual(1)
      expect(cubics).toBeLessThanOrEqual(8)
    }
  })

  it('follows the involute: tooth angle at radius matches the formula', () => {
    const d = dimensions(BASE)
    // At the pitch circle the half-angle is ψ, at the base circle ψ + inv α
    expect(flankAngle(d, d.r)).toBeCloseTo(d.psi)
    expect(flankAngle(d, d.rb)).toBeCloseTo(d.psiB)
  })

  it('reports teeth that come to a point, and still draws them cut off at the point', () => {
    const profile = toothProfile({ ...BASE, teeth: 8, profileShift: 1 })
    expect(profile.error).toMatch(/point/)
    checkContinuous(gearOutline(profile), true)
    expect(profile.dims.ra).toBeLessThan(dimensions({ ...BASE, teeth: 8, profileShift: 1 }).ra)
  })

  it('puts the drilled hole bottom on the root circle at the ideal size', () => {
    const d = dimensions(BASE)
    const ideal = idealDrillDiameter(d)
    expect(ideal).toBeGreaterThan(4)
    expect(ideal).toBeLessThan(12)
    const profile = toothProfile({ ...BASE, root: { kind: 'drill', diameter: ideal } })
    expect(profile.root!.bottom).toBeCloseTo(d.rf, 3)
    // The hole is tangent to the flank where it meets it
    const p = sample({ start: profile.half.start, segments: profile.half.segments.slice(0, -1) }, 1).pop()!
    expect(dist(p, profile.root!.center)).toBeCloseTo(ideal / 2, 6)
  })
})

describe('defaults', () => {
  it('the default gear is valid', () => {
    const profile = toothProfile({ ...BASE, teeth: DEFAULT_GEAR.teeth, module: DEFAULT_GEAR.module, backlash: DEFAULT_GEAR.backlash })
    expect(profile.error).toBeNull()
  })
})
