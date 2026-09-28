import { bitsFor, formatLength, type LengthUnit, type Vec } from '@tomkail/workshop-kit'
import type { BoreSpec, CuttingSpec, GearSpec } from './design'
import { moduleToDp } from './design'
import { DEG, flankAngle, gearOutline, idealDrillDiameter, maxRootFillet, maxTipRound, toothProfile, dimensions, type GearDimensions, type Path, type ToothInput, type ToothProfile } from './involute'

/**
 * A GearSpec turned into everything the canvas, panel and template need:
 * the outline, root drilling, bore, checks and measurements.
 */

export interface Issue {
  code: string
  level: 'error' | 'warning' | 'info'
  message: string
}

export interface DrillPlan {
  diameter: number
  /** Radius of the circle through the hole centres */
  centreRadius: number
  /** Hole centres, one per tooth gap */
  centres: Vec[]
  /** Distance between neighbouring centres, for walking them round with dividers */
  stepOff: number
  /** True when the size was picked automatically */
  auto: boolean
}

export type BoreShape = { kind: 'circle'; radius: number } | { kind: 'path'; path: Path } | null

export interface GearGeometry {
  spec: GearSpec
  dims: GearDimensions
  profile: ToothProfile
  outline: Path | null
  drill: DrillPlan | null
  bore: BoreShape
  issues: Issue[]
  valid: boolean
  stats: {
    pitchDiameter: number
    outsideDiameter: number
    /** Deepest point of the gaps: the root circle, or the drilled holes' bottoms */
    rootDiameter: number
    baseDiameter: number
    circularPitch: number
    diametralPitch: number
    toothThickness: number
    /** Width across the tooth tip before rounding */
    tipLand: number
    wholeDepth: number
    /** Room for the mating gear's tip, against the standard 0.25 × module */
    clearance: number
    tipRound: number
    rootFillet: number | null
    boreWall: number | null
    zMin: number
    xMin: number
  }
}

/** Smallest bit worth offering for root holes */
const MIN_ROOT_BIT = 3

/** Largest standard bit whose hole bottoms at or below the root circle */
export function autoDrillDiameter(dims: GearDimensions, unit: LengthUnit): number | null {
  const ideal = idealDrillDiameter(dims)
  const fits = bitsFor(unit).filter((b) => b.diameter >= MIN_ROOT_BIT && b.diameter <= ideal + 1e-6)
  return fits.length ? fits[fits.length - 1].diameter : null
}

/** Tooth tips narrower than this (× module) chip in wood */
export const MIN_TIP_LAND = 0.25

/** Width across the tooth tip for a given profile shift */
export function tipLandAt(spec: Pick<GearSpec, 'teeth' | 'module' | 'pressureAngle' | 'backlash'>, x: number): number {
  const d = dimensions({ teeth: spec.teeth, module: spec.module, pressureAngle: spec.pressureAngle, profileShift: x, backlash: spec.backlash, tipRound: 0, root: { kind: 'fillet', radius: 0 } })
  return 2 * d.ra * flankAngle(d, d.ra)
}

export interface ShiftSuggestion {
  /** The shift to use */
  value: number
  /** Shift that would fully avoid undercut (0 when none is needed) */
  needed: number
  /** True when the tips can't take the full `needed` shift */
  capped: boolean
}

/**
 * Profile shift that avoids undercut, but never so much that the tips get
 * narrower than MIN_TIP_LAND × module. With few teeth you can't have both,
 * so it stops at the most shift the tips allow.
 */
export function autoProfileShift(spec: Pick<GearSpec, 'teeth' | 'module' | 'pressureAngle' | 'backlash'>): ShiftSuggestion {
  const raw = 1 - (spec.teeth * Math.sin(spec.pressureAngle * DEG) ** 2) / 2
  const needed = raw > 0 ? Math.ceil(raw * 100) / 100 : 0
  if (needed === 0) return { value: 0, needed, capped: false }
  const minLand = MIN_TIP_LAND * spec.module
  if (tipLandAt(spec, needed) >= minLand) return { value: needed, needed, capped: false }
  // Tip width falls as shift grows; find the most shift that keeps it wide enough
  let lo = 0
  let hi = needed
  if (tipLandAt(spec, 0) < minLand) return { value: 0, needed, capped: true }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (tipLandAt(spec, mid) >= minLand) lo = mid
    else hi = mid
  }
  return { value: Math.floor(lo * 100) / 100, needed, capped: true }
}

export function boreShape(bore: BoreSpec): BoreShape {
  const R = bore.diameter / 2
  if (bore.type === 'none' || R <= 0) return null
  if (bore.type === 'flat') {
    const h = bore.flatAcross - R
    if (h <= 0 || h >= R) return { kind: 'circle', radius: R }
    const w = Math.sqrt(R * R - h * h)
    const a = Math.atan2(w, h)
    return {
      kind: 'path',
      path: { start: { x: h, y: -w }, segments: [{ type: 'line', to: { x: h, y: w } }, { type: 'arc', center: { x: 0, y: 0 }, radius: R, start: a, end: 2 * Math.PI - a, ccw: false }] },
    }
  }
  if (bore.type === 'key') {
    const b = bore.keyWidth / 2
    if (b <= 0 || b >= R || bore.keyDepth <= 0) return { kind: 'circle', radius: R }
    const xk = Math.sqrt(R * R - b * b)
    const a = Math.atan2(b, xk)
    const top = R + bore.keyDepth
    return {
      kind: 'path',
      path: {
        start: { x: xk, y: -b },
        segments: [
          { type: 'line', to: { x: top, y: -b } },
          { type: 'line', to: { x: top, y: b } },
          { type: 'line', to: { x: xk, y: b } },
          { type: 'arc', center: { x: 0, y: 0 }, radius: R, start: a, end: 2 * Math.PI - a, ccw: false },
        ],
      },
    }
  }
  return { kind: 'circle', radius: R }
}

function boreExtent(bore: BoreSpec): number {
  if (bore.type === 'none') return 0
  return bore.diameter / 2 + (bore.type === 'key' && bore.keyWidth < bore.diameter ? bore.keyDepth : 0)
}

export function computeGear(spec: GearSpec, cutting: CuttingSpec, unit: LengthUnit): GearGeometry {
  const m = spec.module
  const dims = dimensions({ ...toToothInput(spec, 0), root: { kind: 'fillet', radius: 0 } })
  const issues: Issue[] = []
  const L = (mm: number) => formatLength(mm, unit, { mmDecimals: 1, inDecimals: 3 })

  // Root: pick the drill, or clamp the fillet
  let drillDiameter = spec.drillDiameter
  const auto = spec.root === 'drill' && drillDiameter <= 0
  if (auto) {
    const picked = autoDrillDiameter(dims, unit)
    if (picked === null) {
      issues.push({ code: 'drill-small', level: 'error', message: `The tooth gaps are too narrow for a ${L(MIN_ROOT_BIT)} bit. Use bigger teeth, or switch the root to “Fillet”.` })
    }
    drillDiameter = picked ?? 0
  }
  const filletMax = maxRootFillet(dims)
  const tipMax = maxTipRound(dims)

  const profile = toothProfile(toToothInput(spec, drillDiameter))
  if (profile.error) issues.push({ code: 'profile', level: 'error', message: profile.error })
  // A profile with an error may still be drawable (e.g. pointed teeth); it's shown but marked invalid
  const outline = profile.tooth.segments.length === 0 || (spec.root === 'drill' && drillDiameter <= 0) ? null : gearOutline(profile)

  const bottom = profile.root?.bottom ?? dims.rf
  const clearance = dims.rf + 0.25 * m - bottom

  let drill: DrillPlan | null = null
  if (spec.root === 'drill' && profile.root) {
    const Rc = Math.hypot(profile.root.center.x, profile.root.center.y)
    drill = {
      diameter: drillDiameter,
      centreRadius: Rc,
      centres: Array.from({ length: spec.teeth }, (_, k) => {
        const a = dims.gamma * (2 * k + 1)
        return { x: Rc * Math.cos(a), y: Rc * Math.sin(a) }
      }),
      stepOff: 2 * Rc * Math.sin(dims.gamma),
      auto,
    }
    if (clearance < 0.05 * m) {
      issues.push({ code: 'clearance', level: 'error', message: `The root holes are too big: they stop ${L(bottom - dims.rf)} short of the root circle, so a mating tooth would bottom out. Use a smaller bit.` })
    } else if (clearance < 0.15 * m) {
      issues.push({ code: 'clearance', level: 'warning', message: `The root holes leave only ${L(clearance)} for the mating tooth’s tip. A smaller bit gives more room.` })
    }
  }

  // Tooth shape checks
  const zMin = 2 / Math.sin(dims.alpha) ** 2
  const xMin = 1 - (spec.teeth * Math.sin(dims.alpha) ** 2) / 2
  if (spec.profileShift < xMin - 1e-6) {
    const shift = autoProfileShift(spec)
    const other = spec.pressureAngle < 25 ? autoProfileShift({ ...spec, pressureAngle: 25 }) : null
    const fix = !shift.capped
      ? `Add profile shift of at least ${shift.needed}${other && !other.capped ? ', or use 25°' : ''}.`
      : `Profile shift can’t fully fix it at this tooth count without making the tips too narrow; ${shift.value} is the most they allow. ${other && !other.capped ? 'Use 25°, or more teeth.' : 'Use more teeth, or accept some undercut.'}`
    issues.push({ code: 'undercut', level: 'warning', message: `Below ${Math.ceil(zMin)} teeth at ${spec.pressureAngle}° the roots are undercut (thinned by the mating tooth). ${fix}` })
  }
  const tipLand = 2 * dims.ra * flankAngle(dims, dims.ra)
  if (!profile.error && tipLand < MIN_TIP_LAND * m) {
    issues.push({ code: 'tip-narrow', level: 'warning', message: `The tooth tips are only ${L(tipLand)} wide and will chip in wood. Use less profile shift${spec.pressureAngle < 25 ? ', more teeth, or a 25° pressure angle' : ' or more teeth'}.` })
  }
  if (m < 2.5) {
    issues.push({ code: 'small-teeth', level: 'warning', message: `Module ${round2(m)} teeth are small for wood. Aim for module 3 or more (DP 8 or less).` })
  }
  if (spec.teeth < 10) {
    issues.push({ code: 'few-teeth', level: 'info', message: 'Few teeth means short grain across some of them. Plywood holds up better than solid wood.' })
  }
  if (spec.tipRound * m > tipMax + 1e-6 && !issues.some((i) => i.code === 'tip-narrow' || i.code === 'profile')) {
    issues.push({ code: 'tip-max', level: 'info', message: `Tip rounding is limited to ${L(tipMax)}, which makes the tips fully round.` })
  }

  // Cutting
  const filletRadius = spec.root === 'fillet' ? Math.min(spec.rootFillet * m, filletMax) : null
  if (filletRadius !== null && filletRadius + 1e-6 < cutting.toolRadius) {
    issues.push({
      code: 'blade-radius',
      level: 'warning',
      message: `The ${L(filletRadius)} root corners are tighter than the blade can turn (${L(cutting.toolRadius)}). Drill the roots, or relieve the corners with a file.`,
    })
  }

  // Bore
  const extent = boreExtent(spec.bore)
  const boreWall = spec.bore.type === 'none' ? null : bottom - extent
  if (boreWall !== null && boreWall <= 0) {
    issues.push({ code: 'bore', level: 'error', message: 'The bore breaks into the tooth gaps. Make it smaller.' })
  } else if (boreWall !== null && boreWall < 2 * m) {
    issues.push({ code: 'bore-wall', level: 'warning', message: `Only ${L(boreWall)} of wood between the bore and the tooth roots. Leave at least ${L(2 * m)}.` })
  }

  return {
    spec,
    dims,
    profile,
    outline,
    drill,
    bore: boreShape(spec.bore),
    issues,
    valid: outline !== null && !issues.some((i) => i.level === 'error'),
    stats: {
      pitchDiameter: dims.r * 2,
      outsideDiameter: dims.ra * 2,
      rootDiameter: bottom * 2,
      baseDiameter: dims.rb * 2,
      circularPitch: Math.PI * m,
      diametralPitch: moduleToDp(m),
      toothThickness: dims.s,
      tipLand,
      wholeDepth: dims.ra - bottom,
      clearance,
      tipRound: Math.min(spec.tipRound * m, tipMax),
      rootFillet: filletRadius,
      boreWall,
      zMin,
      xMin,
    },
  }
}

function toToothInput(spec: GearSpec, drillDiameter: number): ToothInput {
  return {
    teeth: spec.teeth,
    module: spec.module,
    pressureAngle: spec.pressureAngle,
    profileShift: spec.profileShift,
    backlash: spec.backlash,
    tipRound: spec.tipRound * spec.module,
    root: spec.root === 'drill' ? { kind: 'drill', diameter: drillDiameter } : { kind: 'fillet', radius: spec.rootFillet * spec.module },
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Radius that encloses everything drawn for the gear */
export const gearExtent = (g: GearGeometry) => g.dims.ra
