import type { LengthUnit } from '@tomkail/workshop-kit'
import type { CuttingSpec, GearKindId, GearSpec } from './design'
import { computeGear, type GearGeometry, type Issue } from './gear'

/**
 * Every gear type plugs into this interface, so racks, internal gears and
 * the rest can be added later without reworking the spur code. Meshing,
 * trains and animation only need pitch radius, tooth count and phase.
 *
 * The parameter panel for each kind lives with the components, keyed by id.
 */
export interface GearKind {
  id: GearKindId
  label: string
  compute: (spec: GearSpec, cutting: CuttingSpec, unit: LengthUnit) => GearGeometry
  /** Infinity for racks */
  pitchRadius: (spec: GearSpec) => number
  canMesh: (a: GearSpec, b: GearSpec) => Issue | null
}

export const spur: GearKind = {
  id: 'spur',
  label: 'Spur gear',
  compute: computeGear,
  pitchRadius: (spec) => (spec.module * spec.teeth) / 2,
  canMesh: (a, b) => {
    if (b.kind !== 'spur') return { code: 'mesh-kind', level: 'error', message: 'Spur gears only mesh with other spur gears for now.' }
    if (Math.abs(a.module - b.module) > 1e-6) return { code: 'mesh-module', level: 'error', message: 'Meshing gears need the same tooth size (module).' }
    if (Math.abs(a.pressureAngle - b.pressureAngle) > 1e-6) return { code: 'mesh-angle', level: 'error', message: 'Meshing gears need the same pressure angle.' }
    return null
  },
}

export const GEAR_KINDS: Record<GearKindId, GearKind> = { spur }

export const kindOf = (spec: GearSpec) => GEAR_KINDS[spec.kind]
