import { bitsFor, type LengthUnit, type Vec } from '@tomkail/workshop-kit'
import type { BoreSpec, CuttingSpec, GearSpec } from './design'
import { MAX_TEETH, TOOTH_FORMS, moduleToDp } from './design'
import { len, num } from './format'
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
    /** Room for the mating gear's tip; nominally (dedendum − addendum) × module */
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

/** Tooth tips narrower than this (× module) are fragile */
export const MIN_TIP_LAND = 0.25

/** Width across the tooth tip for a given profile shift */
type ShiftInput = Pick<GearSpec, 'teeth' | 'module' | 'pressureAngle' | 'backlash' | 'toothForm'>

export function tipLandAt(spec: ShiftInput, x: number): number {
  const form = TOOTH_FORMS[spec.toothForm]
  const d = dimensions({ teeth: spec.teeth, module: spec.module, pressureAngle: spec.pressureAngle, profileShift: x, backlash: spec.backlash, tipRound: 0, root: { kind: 'fillet', radius: 0 }, ...form })
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
 * Undercut starts when the mating tooth's tip line passes below the base
 * circle's interference point: z_min = 2·h_a / sin²α, and the shift that
 * avoids it is x_min = h_a − z·sin²α / 2 (h_a = addendum × module).
 */
export function undercutLimits(teeth: number, pressureAngle: number, addendum: number) {
  const s2 = Math.sin(pressureAngle * DEG) ** 2
  return { zMin: (2 * addendum) / s2, xMin: addendum - (teeth * s2) / 2 }
}

/**
 * The most profile shift that keeps the tips at least `minLand` wide (mm),
 * to 0.01, or null if even the least shift (−0.5) is too much.
 */
export function maxShiftForTip(spec: ShiftInput, minLand: number): number | null {
  if (tipLandAt(spec, -0.5) < minLand) return null
  let lo = -0.5
  let hi = 1
  if (tipLandAt(spec, hi) >= minLand) return hi
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (tipLandAt(spec, mid) >= minLand) lo = mid
    else hi = mid
  }
  return Math.floor(lo * 100) / 100
}

/**
 * Profile shift that avoids undercut, but never so much that the tips get
 * narrower than MIN_TIP_LAND × module. With few teeth you can't have both,
 * so it stops at the most shift the tips allow.
 */
export function autoProfileShift(spec: ShiftInput): ShiftSuggestion {
  const raw = undercutLimits(spec.teeth, spec.pressureAngle, TOOTH_FORMS[spec.toothForm].addendum).xMin
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
  const L = (mm: number) => len(mm, unit)

  // Root: pick the drill, or clamp the fillet
  let drillDiameter = spec.drillDiameter
  const auto = spec.root === 'drill' && drillDiameter <= 0
  if (auto) {
    const picked = autoDrillDiameter(dims, unit)
    if (picked === null) {
      // Gaps grow with tooth size; find the smallest module a standard bit fits
      let needed: number | null = null
      for (let mm = Math.ceil(m * 4) / 4; mm <= 30; mm += 0.25) {
        if (autoDrillDiameter(dimensions({ ...toToothInput({ ...spec, module: mm }, 0), root: { kind: 'fillet', radius: 0 } }), unit) !== null) {
          needed = mm
          break
        }
      }
      issues.push({
        code: 'drill-small',
        level: 'error',
        message: `The tooth gaps are too narrow for the smallest root bit (${L(MIN_ROOT_BIT)}). ${needed ? `Set Tooth size to module ${num(needed)} or more, or set` : 'Set'} Roots to “Fillet”.`,
      })
    }
    drillDiameter = picked ?? 0
  }
  const filletMax = maxRootFillet(dims)
  const tipMax = maxTipRound(dims)

  const profile = toothProfile(toToothInput(spec, drillDiameter))
  if (profile.error) issues.push({ code: 'profile', level: 'error', message: profileMessage(spec, profile, L) })
  // A profile with an error may still be drawable (e.g. pointed teeth); it's shown but marked invalid
  const outline = profile.tooth.segments.length === 0 || (spec.root === 'drill' && drillDiameter <= 0) ? null : gearOutline(profile)

  const bottom = profile.root?.bottom ?? dims.rf
  // The mating tip reaches the root circle less the nominal clearance (dedendum − addendum)
  const form = TOOTH_FORMS[spec.toothForm]
  const clearance = dims.rf + (form.dedendum - form.addendum) * m - bottom

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
    const best = autoDrillDiameter(dims, unit)
    const fix = best ? `Set Root bit to Ø${L(best)} or smaller (Auto picks it).` : 'Set Roots to “Fillet”.'
    if (clearance < 0.05 * m) {
      issues.push({ code: 'clearance', level: 'error', message: `The root holes are too big: they stop ${L(bottom - dims.rf)} short of the root circle, so the mating teeth would hit them. ${fix}` })
    } else if (clearance < 0.15 * m) {
      issues.push({ code: 'clearance', level: 'warning', message: `The root holes leave only ${L(clearance)} for the mating tooth’s tip; aim for at least ${L(0.15 * m)} (0.15 × module). ${fix}` })
    }
  }

  // Tooth shape checks
  const { zMin, xMin } = undercutLimits(spec.teeth, spec.pressureAngle, form.addendum)
  if (spec.profileShift < xMin - 1e-6) {
    const shift = autoProfileShift(spec)
    // Other settings that would let profile shift fix it without narrowing the tips
    const alternatives: [string, Partial<GearSpec>][] = [
      ['25°', { pressureAngle: 25 }],
      ['stub teeth', { toothForm: 'stub' }],
      ['stub teeth at 25°', { pressureAngle: 25, toothForm: 'stub' }],
    ]
    const works = alternatives.filter(([, change]) => {
      const next = { ...spec, ...change }
      return (next.pressureAngle !== spec.pressureAngle || next.toothForm !== spec.toothForm) && !autoProfileShift(next).capped
    })
    const alt = works[0]?.[0]
    const fix = !shift.capped
      ? `Set Profile shift to ${num(shift.needed)} or more (Auto sets it)${alt ? `, or use ${alt}` : ''}.`
      : `Profile shift alone can’t fix it here without making the tips too narrow; ${num(shift.value)} is the most they allow (Auto sets it). ${alt ? `Use ${alt}, or at least ${Math.ceil(zMin)} teeth.` : `Use at least ${Math.ceil(zMin)} teeth, or accept some undercut.`}`
    const formLabel = spec.toothForm === 'stub' ? ' stub' : ''
    issues.push({ code: 'undercut', level: 'warning', message: `Below ${Math.ceil(zMin)} teeth at ${spec.pressureAngle}°${formLabel} the roots are undercut (thinned by the mating tooth). ${fix}` })
  }
  const tipLand = 2 * dims.ra * flankAngle(dims, dims.ra)
  if (!profile.error && tipLand < MIN_TIP_LAND * m) {
    // Shorter teeth and a lower pressure angle both widen the tips; so does less shift
    const minLand = MIN_TIP_LAND * m
    const xMax = maxShiftForTip(spec, minLand)
    const others: string[] = []
    if (spec.toothForm === 'full' && tipLandAt({ ...spec, toothForm: 'stub' }, spec.profileShift) >= minLand) others.push('stub teeth')
    if (spec.pressureAngle > 20 && tipLandAt({ ...spec, pressureAngle: 20 }, spec.profileShift) >= minLand) others.push('20°')
    const fix = [xMax !== null ? `set Profile shift to ${num(xMax)} or less` : null, ...others.map((o) => `use ${o}`), 'use more teeth'].filter(Boolean) as string[]
    issues.push({
      code: 'tip-narrow',
      level: 'warning',
      message: `The tooth tips are only ${L(tipLand)} wide; below ${L(minLand)} (0.25 × module) they’re fragile. To widen them, ${list(fix)}.`,
    })
  }
  if (m < 2.5) {
    issues.push({ code: 'small-teeth', level: 'warning', message: `Module ${num(m)} teeth are small to cut accurately by hand. Set Tooth size to module 2.5 or more (DP 10 or less).` })
  }
  if (spec.teeth < 10) {
    issues.push({
      code: 'few-teeth',
      level: 'info',
      message: `With only ${spec.teeth} teeth, each carries more of the load. If the material has a grain, teeth with the grain running across them are weak; a cross-laminated sheet avoids that.`,
    })
  }
  if (spec.tipRound * m > tipMax + 1e-6 && !issues.some((i) => i.code === 'tip-narrow' || i.code === 'profile')) {
    issues.push({ code: 'tip-max', level: 'info', message: `Tip rounding above ${num(tipMax / m)} × module (${L(tipMax)}) has no effect: the tips are already fully round. Set Tip rounding to ${num(Math.floor((tipMax / m) * 100) / 100)} or less.` })
  }

  // Cutting
  const filletRadius = spec.root === 'fillet' ? Math.min(spec.rootFillet * m, filletMax) : null
  if (filletRadius !== null && filletRadius + 1e-6 < cutting.toolRadius) {
    issues.push({
      code: 'blade-radius',
      level: 'warning',
      message: `The ${L(filletRadius)} root corners are tighter than the saw can turn (${L(cutting.toolRadius)}). ${
        cutting.toolRadius <= filletMax
          ? `Set Root fillet to ${num(Math.ceil((cutting.toolRadius / m) * 100) / 100)} × module or more, or set Roots to “Drill the roots”.`
          : 'The gaps are too narrow for corners that round, so set Roots to “Drill the roots”, or use a tool that turns tighter.'
      }`,
    })
  }

  // Bore
  const extent = boreExtent(spec.bore)
  const boreWall = spec.bore.type === 'none' ? null : bottom - extent
  if (boreWall !== null && boreWall < 2 * m) {
    // Aim for a wall of 2 × module: shrink the bore, or grow the gear (its roots move out m/2 per tooth)
    const wallTarget = 2 * m
    const keyExtra = extent - spec.bore.diameter / 2
    const maxBore = 2 * (bottom - wallTarget - keyExtra)
    // Each extra tooth moves the roots out by about m/2; search for the exact count (the root bit changes too)
    let moreTeeth = 1
    while (moreTeeth < MAX_TEETH - spec.teeth && rootBottom({ ...spec, teeth: spec.teeth + moreTeeth }, unit) - extent < wallTarget - 1e-9) moreTeeth++
    const teethText = `add ${moreTeeth} ${moreTeeth === 1 ? 'tooth' : 'teeth'}`
    const fix = maxBore > 0 ? `Set Bore Ø to ${L(Math.floor(maxBore * 10) / 10)} or less${keyExtra > 0 ? ' (or use a shallower keyway)' : ''}, or ${teethText}.` : `${teethText[0].toUpperCase()}${teethText.slice(1)}, or use bigger teeth.`
    const head = boreWall <= 0 ? 'The bore breaks into the tooth gaps.' : `Only ${L(boreWall)} between the bore and the tooth roots; leave at least ${L(wallTarget)} (2 × module).`
    issues.push({ code: boreWall <= 0 ? 'bore' : 'bore-wall', level: boreWall <= 0 ? 'error' : 'warning', message: `${head} ${fix}` })
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
    ...TOOTH_FORMS[spec.toothForm],
    profileShift: spec.profileShift,
    backlash: spec.backlash,
    tipRound: spec.tipRound * spec.module,
    root: spec.root === 'drill' ? { kind: 'drill', diameter: drillDiameter } : { kind: 'fillet', radius: spec.rootFillet * spec.module },
  }
}


/** Radius that encloses everything drawn for the gear */
export const gearExtent = (g: GearGeometry) => g.dims.ra

/** "a, b or c" */
function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** What went wrong with the tooth shape, and which setting fixes it */
function profileMessage(spec: GearSpec, profile: ToothProfile, L: (mm: number) => string): string {
  const m = spec.module
  switch (profile.errorKind) {
    case 'backlash': {
      const s0 = m * (Math.PI / 2 + 2 * spec.profileShift * Math.tan(spec.pressureAngle * DEG))
      return `Backlash (${L(spec.backlash)}) is more than the whole tooth (${L(s0)}). Set Backlash to about ${L(0.1 * m)} (0.1 × module).`
    }
    case 'pointed': {
      const xMax = maxShiftForTip(spec, 0.01 * m)
      return `The teeth come to a point before the tip circle. ${xMax !== null ? `Set Profile shift to ${num(xMax)} or less, or use more teeth.` : 'Use more teeth, or stub teeth.'}`
    }
    case 'root-hole':
      return `The Ø${L(spec.drillDiameter)} root bit is too big to fit between the teeth. Choose a smaller Root bit, or Auto.`
    case 'overlap':
      return `The tip rounding and ${spec.root === 'drill' ? 'root holes' : 'root fillets'} meet, leaving no straight flank. Reduce Tip rounding, or ${spec.root === 'drill' ? 'choose a smaller Root bit' : 'reduce Root fillet'}.`
    default:
      return profile.error ?? 'The tooth shape can’t be drawn.'
  }
}

/** Radius of the deepest point of the gaps, as computeGear would find it (auto root bit included) */
function rootBottom(spec: GearSpec, unit: LengthUnit): number {
  const dims = dimensions({ ...toToothInput(spec, 0), root: { kind: 'fillet', radius: 0 } })
  const drill = spec.root === 'drill' ? (spec.drillDiameter > 0 ? spec.drillDiameter : autoDrillDiameter(dims, unit)) : 0
  if (spec.root === 'drill' && !drill) return dims.rf
  return toothProfile(toToothInput(spec, drill ?? 0)).root?.bottom ?? dims.rf
}
