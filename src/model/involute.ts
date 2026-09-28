import type { ArcSeg, CubicSeg, Segment, Vec } from '@tomkail/workshop-kit'

/**
 * External involute spur tooth profile, as workshop-kit segments (mm).
 *
 * Tooth 0 is centred on +x. Angles are radians from +x towards +y, the same
 * as canvas arc(). Each flank is the involute from the base circle (or the
 * root, if larger) to the tip, fitted with cubic Béziers. Below the base
 * circle the flank continues as a radial line. The tip is rounded by a
 * fillet, and the root is either a fillet at each corner plus an arc along
 * the root circle, or a single drilled hole tangent to both flanks.
 */

export const DEG = Math.PI / 180

/** Involute function inv α = tan α − α */
export const inv = (a: number) => Math.tan(a) - a

export type RootSpec = { kind: 'fillet'; radius: number } | { kind: 'drill'; diameter: number }

export interface ToothInput {
  teeth: number
  /** mm */
  module: number
  /** degrees */
  pressureAngle: number
  profileShift: number
  /** Thinning of each tooth at the pitch circle, mm */
  backlash: number
  /** Tip rounding radius, mm */
  tipRound: number
  root: RootSpec
}

export interface GearDimensions {
  z: number
  m: number
  alpha: number
  /** Pitch, base, tip and root radii */
  r: number
  rb: number
  ra: number
  rf: number
  /** Circular tooth thickness at the pitch circle */
  s: number
  /** Half the tooth's angular thickness at the pitch and base circles */
  psi: number
  psiB: number
  /** Half the angular pitch: the gap centreline sits at this angle */
  gamma: number
}

export function dimensions(p: ToothInput): GearDimensions {
  const z = p.teeth
  const m = p.module
  const x = p.profileShift
  const alpha = p.pressureAngle * DEG
  const r = (m * z) / 2
  const s = m * (Math.PI / 2 + 2 * x * Math.tan(alpha)) - p.backlash
  const psi = s / (2 * r)
  return {
    z,
    m,
    alpha,
    r,
    rb: r * Math.cos(alpha),
    ra: r + m * (1 + x),
    rf: r - m * (1.25 - x),
    s,
    psi,
    psiB: psi + inv(alpha),
    gamma: Math.PI / z,
  }
}

/** Polar angle of the upper flank (the +angle side of tooth 0) at radius ρ */
export function flankAngle(d: GearDimensions, rho: number): number {
  if (rho <= d.rb) return d.psiB
  return d.psiB - inv(Math.acos(d.rb / rho))
}

const polar = (r: number, a: number): Vec => ({ x: r * Math.cos(a), y: r * Math.sin(a) })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const len = (v: Vec) => Math.hypot(v.x, v.y)
const angle = (v: Vec) => Math.atan2(v.y, v.x)

export const flankPoint = (d: GearDimensions, rho: number): Vec => polar(rho, flankAngle(d, rho))

/** Unit normal to the upper flank at ρ, pointing into the tooth gap */
function flankNormal(d: GearDimensions, rho: number): Vec {
  let t: Vec
  if (rho <= d.rb) {
    t = polar(1, d.psiB)
  } else {
    // Involute tangent: the roll parameter's derivative, mirrored and rotated onto the flank
    const tr = Math.sqrt((rho * rho) / (d.rb * d.rb) - 1)
    t = rotate({ x: Math.cos(tr), y: -Math.sin(tr) }, d.psiB)
  }
  const n = { x: -t.y, y: t.x }
  const theta = flankAngle(d, rho)
  const toGap = { x: -Math.sin(theta), y: Math.cos(theta) }
  return n.x * toGap.x + n.y * toGap.y >= 0 ? n : { x: -n.x, y: -n.y }
}

/** Solve f(x) = 0 for monotonic f on [lo, hi]; null if there's no sign change */
function bisect(f: (x: number) => number, lo: number, hi: number): number | null {
  let flo = f(lo)
  const fhi = f(hi)
  if (flo === 0) return lo
  if (fhi === 0) return hi
  if (Math.sign(flo) === Math.sign(fhi)) return null
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid
      flo = fm
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// Tip and root corners
// ---------------------------------------------------------------------------

export interface Corner {
  /** Radius on the flank where the corner meets it */
  rho: number
  center: Vec
  radius: number
}

/** Tip fillet tangent to the tip circle and the flank; null when there's no rounding */
export function tipCorner(d: GearDimensions, radius: number): Corner | null {
  if (radius <= 1e-9) return null
  const lo = Math.max(d.rb, d.rf, 1e-6)
  const rho = bisect((rh) => len(add(flankPoint(d, rh), flankNormal(d, rh), -radius)) - (d.ra - radius), lo, d.ra)
  if (rho === null) return null
  const center = add(flankPoint(d, rho), flankNormal(d, rho), -radius)
  return { rho, center, radius }
}

/** Largest tip radius before the two tip fillets meet on the tooth centreline */
export function maxTipRound(d: GearDimensions): number {
  const past = (q: number) => {
    const c = tipCorner(d, q)
    return c ? angle(c.center) : -1
  }
  const q = bisect(past, 1e-6, d.ra - Math.max(d.rb, d.rf))
  return q ?? 0
}

/** Root fillet tangent to the root circle and the flank */
export function rootFilletCorner(d: GearDimensions, radius: number): Corner | null {
  if (radius <= 1e-9) return null
  const rho = bisect((rh) => len(add(flankPoint(d, rh), flankNormal(d, rh), radius)) - (d.rf + radius), 1e-6, d.ra)
  if (rho === null) return null
  return { rho, center: add(flankPoint(d, rho), flankNormal(d, rho), radius), radius }
}

/** Largest root fillet before the two fillets in a gap meet on its centreline */
export function maxRootFillet(d: GearDimensions): number {
  const past = (q: number) => {
    const c = rootFilletCorner(d, q)
    return c ? d.gamma - angle(c.center) : -1
  }
  return bisect(past, 1e-6, d.ra) ?? 0
}

/**
 * A drilled hole centred on the gap centreline and tangent to both flanks.
 * Its bottom may sit below the root circle (a deeper gap, which is safe) or
 * above it (less clearance for the mating tip).
 */
export function drillCorner(d: GearDimensions, diameter: number): (Corner & { bottom: number }) | null {
  const q = diameter / 2
  if (q <= 1e-9) return null
  const rho = bisect((rh) => angle(add(flankPoint(d, rh), flankNormal(d, rh), q)) - d.gamma, 1e-6, d.ra)
  if (rho === null) return null
  const center = add(flankPoint(d, rho), flankNormal(d, rho), q)
  return { rho, center, radius: q, bottom: len(center) - q }
}

/** Hole diameter whose bottom lands exactly on the root circle */
export function idealDrillDiameter(d: GearDimensions): number {
  return (bisect((dia) => (drillCorner(d, dia)?.bottom ?? d.ra) - d.rf, 1e-3, 4 * d.m) ?? 0)
}

// ---------------------------------------------------------------------------
// Involute flank as cubic Béziers
// ---------------------------------------------------------------------------

const rotate = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) })

/** Roll parameter for a radius on the involute */
const rollAt = (d: GearDimensions, rho: number) => Math.sqrt(Math.max(0, (rho * rho) / (d.rb * d.rb) - 1))

function involuteAt(d: GearDimensions, t: number): Vec {
  return rotate({ x: d.rb * (Math.cos(t) + t * Math.sin(t)), y: -d.rb * (Math.sin(t) - t * Math.cos(t)) }, d.psiB)
}

function involuteDerivative(d: GearDimensions, t: number): Vec {
  return rotate({ x: d.rb * t * Math.cos(t), y: -d.rb * t * Math.sin(t) }, d.psiB)
}

export function cubicPoint(p0: Vec, c: CubicSeg, u: number): Vec {
  const v = 1 - u
  return {
    x: v * v * v * p0.x + 3 * v * v * u * c.c1.x + 3 * v * u * u * c.c2.x + u * u * u * c.to.x,
    y: v * v * v * p0.y + 3 * v * v * u * c.c1.y + 3 * v * u * u * c.c2.y + u * u * u * c.to.y,
  }
}

/**
 * Normal distance from a point to the upper flank. At radius ρ an angular
 * offset Δθ is ρ·Δθ along the circle, which the involute crosses at the
 * local pressure angle, so the normal distance is ρ·Δθ·cos α_ρ = r_b·Δθ.
 */
export function flankError(d: GearDimensions, p: Vec): number {
  const rho = len(p)
  return Math.abs(angle(p) - flankAngle(d, rho)) * Math.min(rho, d.rb)
}

export const FIT_TOLERANCE = 0.002

/** Hermite cubics along the involute from roll t0 to t1, split until within tolerance */
export function fitInvolute(d: GearDimensions, t0: number, t1: number, depth = 0): CubicSeg[] {
  const p0 = involuteAt(d, t0)
  const p1 = involuteAt(d, t1)
  const k = (t1 - t0) / 3
  const cubic: CubicSeg = { type: 'cubic', c1: add(p0, involuteDerivative(d, t0), k), c2: add(p1, involuteDerivative(d, t1), -k), to: p1 }
  let error = 0
  for (let i = 1; i < 12; i++) error = Math.max(error, flankError(d, cubicPoint(p0, cubic, i / 12)))
  if (error <= FIT_TOLERANCE || depth >= 6) return [cubic]
  const mid = (t0 + t1) / 2
  return [...fitInvolute(d, t0, mid, depth + 1), ...fitInvolute(d, mid, t1, depth + 1)]
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export interface Path {
  start: Vec
  segments: Segment[]
}

export function segmentEndPoint(seg: Segment): Vec {
  if (seg.type !== 'arc') return seg.to
  return polarFrom(seg.center, seg.radius, seg.end)
}

const polarFrom = (c: Vec, r: number, a: number): Vec => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })

/** The same path traversed backwards */
export function reversePath(path: Path): Path {
  const points = [path.start, ...path.segments.map(segmentEndPoint)]
  const segments: Segment[] = []
  for (let i = path.segments.length - 1; i >= 0; i--) {
    const seg = path.segments[i]
    const to = points[i]
    if (seg.type === 'line') segments.push({ type: 'line', to })
    else if (seg.type === 'cubic') segments.push({ type: 'cubic', c1: seg.c2, c2: seg.c1, to })
    else segments.push({ ...seg, start: seg.end, end: seg.start, ccw: !seg.ccw })
  }
  return { start: points[points.length - 1], segments }
}

/** Reflect across the x axis (the tooth centreline) */
export function mirrorPath(path: Path): Path {
  const m = (v: Vec): Vec => ({ x: v.x, y: -v.y })
  return {
    start: m(path.start),
    segments: path.segments.map((seg): Segment => {
      if (seg.type === 'line') return { type: 'line', to: m(seg.to) }
      if (seg.type === 'cubic') return { type: 'cubic', c1: m(seg.c1), c2: m(seg.c2), to: m(seg.to) }
      return { ...seg, center: m(seg.center), start: -seg.start, end: -seg.end, ccw: !seg.ccw }
    }),
  }
}

export function rotateSegment(seg: Segment, a: number): Segment {
  if (seg.type === 'line') return { type: 'line', to: rotate(seg.to, a) }
  if (seg.type === 'cubic') return { type: 'cubic', c1: rotate(seg.c1, a), c2: rotate(seg.c2, a), to: rotate(seg.to, a) }
  return { ...seg, center: rotate(seg.center, a), start: seg.start + a, end: seg.end + a }
}

const arc = (center: Vec, radius: number, start: number, end: number, ccw: boolean): ArcSeg => ({ type: 'arc', center, radius, start, end, ccw })

// ---------------------------------------------------------------------------
// Tooth and gear outlines
// ---------------------------------------------------------------------------

export interface ToothProfile {
  dims: GearDimensions
  tip: Corner | null
  /** Fillet mode: the corner fillet. Drill mode: the hole. */
  root: (Corner & { bottom: number }) | null
  rootKind: RootSpec['kind']
  /** Upper half of tooth 0: from the tip on the centreline out to the gap centreline */
  half: Path
  /** One tooth pitch, from gap centreline −γ to +γ */
  tooth: Path
  /** Why the profile couldn't be built */
  error: string | null
}

export function toothProfile(input: ToothInput): ToothProfile {
  const d = dimensions(input)
  const fail = (error: string): ToothProfile => ({ dims: d, tip: null, root: null, rootKind: input.root.kind, half: { start: polar(d.ra, 0), segments: [] }, tooth: { start: polar(d.ra, 0), segments: [] }, error })

  if (d.s <= 0) return fail('The backlash is larger than the tooth, so there’s nothing left.')
  if (flankAngle(d, d.ra) <= 0) return fail('The teeth come to a point before the tip circle. Use less profile shift, or more teeth.')

  const tipRadius = Math.min(input.tipRound, maxTipRound(d))
  const tip = tipCorner(d, tipRadius)

  let root: ToothProfile['root'] = null
  if (input.root.kind === 'drill') {
    root = drillCorner(d, input.root.diameter)
    if (!root) return fail('The root hole is too big to fit between the flanks.')
  } else {
    const fillet = rootFilletCorner(d, Math.min(input.root.radius, maxRootFillet(d)))
    root = fillet ? { ...fillet, bottom: d.rf } : null
  }

  const rhoTip = tip?.rho ?? d.ra
  const rhoRoot = root?.rho ?? d.rf
  if (rhoRoot >= rhoTip) return fail('The tip and root rounding overlap, so there’s no straight flank left. Reduce the rounding.')

  // Upper half, tip → gap centreline
  const segments: Segment[] = []
  const tipAngle = tip ? angle(tip.center) : flankAngle(d, d.ra)
  if (tipAngle > 1e-9) segments.push(arc({ x: 0, y: 0 }, d.ra, 0, tipAngle, false))
  if (tip) segments.push(arc(tip.center, tip.radius, tipAngle, angle(sub(flankPoint(d, tip.rho), tip.center)), false))

  const rhoInvoluteEnd = Math.max(d.rb, rhoRoot)
  if (rhoTip > rhoInvoluteEnd + 1e-9) segments.push(...fitInvolute(d, rollAt(d, rhoTip), rollAt(d, rhoInvoluteEnd)))
  if (rhoRoot < d.rb - 1e-9) segments.push({ type: 'line', to: flankPoint(d, rhoRoot) })

  if (root && input.root.kind === 'drill') {
    segments.push(arc(root.center, root.radius, angle(sub(flankPoint(d, root.rho), root.center)), d.gamma + Math.PI, true))
  } else if (root) {
    const rootAngle = angle(root.center)
    segments.push(arc(root.center, root.radius, angle(sub(flankPoint(d, root.rho), root.center)), rootAngle + Math.PI, true))
    if (d.gamma - rootAngle > 1e-9) segments.push(arc({ x: 0, y: 0 }, d.rf, rootAngle, d.gamma, false))
  } else {
    // Sharp root: radial line down to the root circle, then along it
    const a = flankAngle(d, d.rf)
    if (segments.length && Math.abs(len(segmentEndPoint(segments[segments.length - 1])) - d.rf) > 1e-9) segments.push({ type: 'line', to: polar(d.rf, a) })
    segments.push(arc({ x: 0, y: 0 }, d.rf, a, d.gamma, false))
  }

  const half: Path = { start: polar(d.ra, 0), segments }
  const lower = reversePath(mirrorPath(half))
  const tooth: Path = { start: lower.start, segments: [...lower.segments, ...half.segments] }
  return { dims: d, tip, root, rootKind: input.root.kind, half, tooth, error: null }
}

/** The whole gear: every tooth, rotated round from tooth 0 */
export function gearOutline(profile: ToothProfile): Path {
  const { z } = profile.dims
  const segments: Segment[] = []
  for (let k = 0; k < z; k++) {
    const a = (k * 2 * Math.PI) / z
    for (const seg of profile.tooth.segments) segments.push(rotateSegment(seg, a))
  }
  return { start: profile.tooth.start, segments }
}
