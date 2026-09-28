import type { LengthUnit, Vec } from '@tomkail/workshop-kit'
import type { GearDoc } from './design'
import type { GearGeometry, Issue } from './gear'
import { len, num } from './format'
import { DEG, inv } from './involute'
import { kindOf } from './kinds'

/**
 * Placing meshed gears: centre distance (with profile shift), phase, speed
 * and contact ratio. Only pitch geometry, tooth count and phase are used, so
 * this works for any gear kind that provides them.
 */

/** Solve inv α = v for α in (0, π/2) */
export function invInverse(v: number): number {
  let lo = 0
  let hi = Math.PI / 2 - 1e-9
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (inv(mid) < v) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Working pressure angle (radians) of an external pair: inv α_w = 2·tan α·(x₁ + x₂)/(z₁ + z₂) + inv α */
export function workingPressureAngle(alpha: number, z1: number, z2: number, x1: number, x2: number): number {
  return invInverse((2 * Math.tan(alpha) * (x1 + x2)) / (z1 + z2) + inv(alpha))
}

/** Centre distance a = m(z₁ + z₂)·cos α / (2·cos α_w) */
export function centreDistance(m: number, alpha: number, z1: number, z2: number, x1: number, x2: number): number {
  return (m * (z1 + z2) * Math.cos(alpha)) / (2 * Math.cos(workingPressureAngle(alpha, z1, z2, x1, x2)))
}

/**
 * Contact ratio: the average number of tooth pairs in contact.
 * ε = [√(r_a1² − r_b1²) + √(r_a2² − r_b2²) − a·sin α_w] / (π·m·cos α)
 */
export function contactRatio(ra1: number, rb1: number, ra2: number, rb2: number, a: number, alphaW: number, m: number, alpha: number): number {
  return (Math.sqrt(ra1 * ra1 - rb1 * rb1) + Math.sqrt(ra2 * ra2 - rb2 * rb2) - a * Math.sin(alphaW)) / (Math.PI * m * Math.cos(alpha))
}

/**
 * Rotation of a driven gear so it meshes. Tooth 0 of each gear sits on its
 * +x axis at rotation 0, and b's centre lies at angle φ from a's. When a has
 * a tooth on the line of centres, b has a gap there:
 * θ_b = φ + π + π/z_b − (z_a/z_b)(θ_a − φ)
 */
export function meshPhase(thetaA: number, zA: number, zB: number, phi: number): number {
  return phi + Math.PI + Math.PI / zB - (zA / zB) * (thetaA - phi)
}

export interface Placement {
  id: string
  center: Vec
  /** Rotation when the driver is at 0 */
  phase: number
  /** Angular speed relative to the driver (negative = opposite direction) */
  speed: number
}

export interface MeshInfo {
  a: number
  b: number
  angle: number
  centreDistance: number
  /** Centre distance without profile shift */
  standardDistance: number
  workingAngle: number
  contactRatio: number
  /** Speed ratio a : b, i.e. turns of a for one turn of b */
  ratio: number
  /** Circumferential play at the pitch circles: both gears' backlash */
  backlash: number
  /** Smallest gap between one gear's tip and the other's root */
  tipClearance: number
  issues: Issue[]
}

export interface DocGeometry {
  gears: GearGeometry[]
  placements: Placement[]
  meshes: MeshInfo[]
  valid: boolean
}

/** Rotation of a placed gear for a given driver angle */
export const gearAngle = (p: Placement, driverAngle: number) => p.phase + p.speed * driverAngle

export function computeDoc(doc: GearDoc, unit: LengthUnit): DocGeometry {
  const gears = doc.gears.map((spec) => kindOf(spec).compute(spec, doc.cutting, unit))
  const index = new Map(doc.gears.map((g, i) => [g.id, i]))
  const placements: Placement[] = doc.gears.map((g) => ({ id: g.id, center: g.position, phase: 0, speed: 1 }))
  const meshes: MeshInfo[] = []
  const L = (mm: number) => len(mm, unit)

  for (const link of doc.links) {
    const ia = index.get(link.a)
    const ib = index.get(link.b)
    if (ia === undefined || ib === undefined) continue
    const A = gears[ia]
    const B = gears[ib]
    const issues: Issue[] = []
    const mismatch = kindOf(A.spec).canMesh(A.spec, B.spec)
    if (mismatch) issues.push(mismatch)

    const { m, alpha } = A.dims
    const zA = A.spec.teeth
    const zB = B.spec.teeth
    const alphaW = workingPressureAngle(alpha, zA, zB, A.spec.profileShift, B.spec.profileShift)
    const a = centreDistance(m, alpha, zA, zB, A.spec.profileShift, B.spec.profileShift)
    const phi = link.angle * DEG

    const pa = placements[ia]
    const center = { x: pa.center.x + a * Math.cos(phi), y: pa.center.y + a * Math.sin(phi) }
    // θ_b is linear in θ_a; split it into the phase at θ_a = 0 and the speed
    const phase = meshPhase(pa.phase, zA, zB, phi)
    placements[ib] = { id: B.spec.id, center, phase, speed: (-pa.speed * zA) / zB }

    // Tip rounding shortens the working part of each flank
    const raA = A.profile.tip?.rho ?? A.dims.ra
    const raB = B.profile.tip?.rho ?? B.dims.ra
    const eps = contactRatio(raA, A.dims.rb, raB, B.dims.rb, a, alphaW, m, alpha)
    const tipClearance = Math.min(a - A.dims.ra - B.stats.rootDiameter / 2, a - B.dims.ra - A.stats.rootDiameter / 2)

    // Things that lengthen the contact: taller teeth, a lower pressure angle, less rounding off the tips
    const remedies = ['more teeth', 'less tip rounding', ...(A.spec.pressureAngle > 20 ? ['20°'] : []), ...(A.spec.toothForm === 'stub' ? ['full-depth teeth'] : [])]
    const remedyText = `${remedies.slice(0, -1).join(', ')} or ${remedies[remedies.length - 1]}`
    if (eps < 1.2) {
      issues.push({ code: 'contact', level: 'warning', message: `The contact ratio is only ${num(eps)}, so the gears will knock as each tooth hands over to the next. Try ${remedyText}.` })
    } else if (eps < 1.4) {
      issues.push({ code: 'contact-low', level: 'info', message: `Contact ratio ${num(eps)}. Wooden gears run more smoothly at 1.4 or more.` })
    }
    if (tipClearance < 0.1 * m) {
      issues.push({ code: 'tip-clearance', level: tipClearance <= 0 ? 'error' : 'warning', message: `Only ${L(tipClearance)} between a tooth tip and the other gear’s root. Reduce the profile shift.` })
    }

    meshes.push({
      a: ia,
      b: ib,
      angle: link.angle,
      centreDistance: a,
      standardDistance: (m * (zA + zB)) / 2,
      workingAngle: alphaW,
      contactRatio: eps,
      ratio: zB / zA,
      backlash: A.spec.backlash + B.spec.backlash,
      tipClearance,
      issues,
    })
  }

  const valid = gears.every((g) => g.valid) && meshes.every((mesh) => !mesh.issues.some((i) => i.level === 'error'))
  return { gears, placements, meshes, valid }
}

/** Bounding box of every placed gear */
export function docBounds(geo: DocGeometry, pad = 0): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  geo.gears.forEach((g, i) => {
    const c = geo.placements[i].center
    const r = g.dims.ra + pad
    minX = Math.min(minX, c.x - r)
    minY = Math.min(minY, c.y - r)
    maxX = Math.max(maxX, c.x + r)
    maxY = Math.max(maxY, c.y + r)
  })
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Letter used for each gear in labels */
export const gearLetter = (i: number) => String.fromCharCode(65 + i)
