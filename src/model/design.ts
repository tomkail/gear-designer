/**
 * The gear design document. Lengths are millimetres, angles degrees unless
 * noted. It holds a list of gears so the meshing pair and trains can be
 * added without changing the file format.
 */

import type { Vec } from '@tomkail/workshop-kit'

export type GearKindId = 'spur'
export type RootMode = 'drill' | 'fillet'
export type BoreType = 'none' | 'round' | 'flat' | 'key'
export type CuttingMethod = 'scroll'

export interface BoreSpec {
  type: BoreType
  diameter: number
  /** D-bore: distance across the flat to the far side of the hole */
  flatAcross: number
  /** Keyway width, and how far it cuts beyond the bore */
  keyWidth: number
  keyDepth: number
}

export interface GearSpec {
  id: string
  kind: GearKindId
  teeth: number
  /** mm; diametral pitch is converted on input */
  module: number
  pressureAngle: number
  profileShift: number
  /** Thinning of each tooth at the pitch circle, mm */
  backlash: number
  /** 'drill': a drilled hole forms each root. 'fillet': rounded corners and a flat root. */
  root: RootMode
  /** Fillet mode: corner radius × module */
  rootFillet: number
  /** Drill mode: bit diameter in mm, or 0 to pick the best standard bit */
  drillDiameter: number
  /** Tip rounding radius × module */
  tipRound: number
  bore: BoreSpec
  position: Vec
  /** Radians; solved for driven gears once there's a train */
  phase: number
}

export interface CuttingSpec {
  method: CuttingMethod
  /** Smallest inside radius the blade can turn, mm */
  toolRadius: number
}

export interface GearDoc {
  version: 1
  name: string
  gears: GearSpec[]
  cutting: CuttingSpec
}

export const MIN_TEETH = 6
export const MAX_TEETH = 200
export const MIN_MODULE = 0.5
export const MAX_MODULE = 30

export const DEFAULT_GEAR: GearSpec = {
  id: 'g1',
  kind: 'spur',
  teeth: 20,
  module: 4,
  pressureAngle: 20,
  profileShift: 0,
  backlash: 0.4,
  root: 'drill',
  rootFillet: 0.38,
  drillDiameter: 0,
  tipRound: 0.1,
  bore: { type: 'round', diameter: 8, flatAcross: 7, keyWidth: 3, keyDepth: 1.5 },
  position: { x: 0, y: 0 },
  phase: 0,
}

export const DEFAULT_DOC: GearDoc = {
  version: 1,
  name: '20-tooth spur gear',
  gears: [DEFAULT_GEAR],
  cutting: { method: 'scroll', toolRadius: 1 },
}

export interface Preset<T> {
  id: string
  label: string
  value: T
}

/** Tooth sizes named for people who don't know module */
export const TOOTH_SIZES: Preset<number>[] = [
  { id: 'small', label: 'Small (m3)', value: 3 },
  { id: 'medium', label: 'Medium (m4)', value: 4 },
  { id: 'large', label: 'Large (m5)', value: 5 },
  { id: 'chunky', label: 'Chunky (m6)', value: 6 },
]

/** Typical tightest turns; check your own blade */
export const BLADES: Preset<number>[] = [
  { id: 'scroll', label: 'Scroll saw blade', value: 1 },
  { id: 'band-18', label: 'Bandsaw, 1/8″ blade', value: 3 },
  { id: 'band-316', label: 'Bandsaw, 3/16″ blade', value: 8 },
  { id: 'band-14', label: 'Bandsaw, 1/4″ blade', value: 16 },
]

export const clampTeeth = (n: number) => Math.max(MIN_TEETH, Math.min(MAX_TEETH, Math.round(n)))

/** Diametral pitch (teeth per inch of pitch diameter) ↔ module */
export const moduleToDp = (m: number) => 25.4 / m
export const dpToModule = (dp: number) => 25.4 / dp

/**
 * Tooth size typed by the user: "4", "m4", "4m" or "4 mod" is a module;
 * "10dp", "dp10" or "10 DP" is diametral pitch. A bare number is read as
 * module in mm mode and DP in inch mode. Returns module in mm.
 */
export function parseToothSize(text: string, bare: 'module' | 'dp'): number | null {
  const s = text.trim().toLowerCase().replace(/,/g, '.')
  const num = s.match(/\d+(?:\.\d+)?|\.\d+/)
  if (!num) return null
  const v = parseFloat(num[0])
  if (!Number.isFinite(v) || v <= 0) return null
  const rest = s.replace(num[0], '').trim()
  if (rest === 'dp' || rest === 'p') return dpToModule(v)
  if (rest === 'm' || rest === 'mod' || rest === 'module' || rest === 'mm') return v
  if (rest === '') return bare === 'dp' ? dpToModule(v) : v
  return null
}

type GearInput = Partial<Omit<GearSpec, 'bore'>> & { bore?: Partial<BoreSpec> }
export type DocInput = Partial<Omit<GearDoc, 'gears' | 'cutting'>> & { gears?: GearInput[]; cutting?: Partial<CuttingSpec> }

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function normaliseGear(input: GearInput | null | undefined, index = 0): GearSpec {
  const g = { ...DEFAULT_GEAR, ...(input ?? {}), bore: { ...DEFAULT_GEAR.bore, ...(input?.bore ?? {}) } }
  const D = DEFAULT_GEAR
  return {
    id: typeof g.id === 'string' && g.id ? g.id : `g${index + 1}`,
    kind: 'spur',
    teeth: clampTeeth(num(g.teeth, D.teeth)),
    module: clamp(num(g.module, D.module), MIN_MODULE, MAX_MODULE),
    pressureAngle: clamp(num(g.pressureAngle, D.pressureAngle), 14.5, 30),
    profileShift: clamp(num(g.profileShift, 0), -0.5, 1),
    backlash: Math.max(0, num(g.backlash, D.backlash)),
    root: g.root === 'fillet' ? 'fillet' : 'drill',
    rootFillet: clamp(num(g.rootFillet, D.rootFillet), 0, 1),
    drillDiameter: Math.max(0, num(g.drillDiameter, 0)),
    tipRound: clamp(num(g.tipRound, D.tipRound), 0, 1),
    bore: {
      type: (['none', 'round', 'flat', 'key'] as const).includes(g.bore.type) ? g.bore.type : 'none',
      diameter: Math.max(0, num(g.bore.diameter, D.bore.diameter)),
      flatAcross: Math.max(0, num(g.bore.flatAcross, D.bore.flatAcross)),
      keyWidth: Math.max(0, num(g.bore.keyWidth, D.bore.keyWidth)),
      keyDepth: Math.max(0, num(g.bore.keyDepth, D.bore.keyDepth)),
    },
    position: { x: num(g.position?.x, 0), y: num(g.position?.y, 0) },
    phase: num(g.phase, 0),
  }
}

/** Normalise a (possibly partial or older) document from storage, a file or a URL */
export function normaliseDoc(input: DocInput | null | undefined): GearDoc {
  const d = input ?? {}
  const gears = Array.isArray(d.gears) && d.gears.length ? d.gears.map(normaliseGear) : [DEFAULT_GEAR]
  return {
    version: 1,
    name: typeof d.name === 'string' ? d.name.slice(0, 80) : DEFAULT_DOC.name,
    gears,
    cutting: { method: 'scroll', toolRadius: Math.max(0, num(d.cutting?.toolRadius, DEFAULT_DOC.cutting.toolRadius)) },
  }
}

// ---------------------------------------------------------------------------
// URL sharing: compact query string in the location hash (first gear only for now)
// ---------------------------------------------------------------------------

const round = (v: number) => String(Math.round(v * 1000) / 1000)

export function docToQuery(doc: GearDoc): string {
  const g = doc.gears[0]
  const q = new URLSearchParams()
  q.set('name', doc.name)
  q.set('n', String(g.teeth))
  q.set('m', round(g.module))
  q.set('pa', round(g.pressureAngle))
  if (g.profileShift) q.set('x', round(g.profileShift))
  q.set('j', round(g.backlash))
  q.set('r', g.root === 'drill' ? 'd' : 'f')
  if (g.root === 'drill' && g.drillDiameter) q.set('dd', round(g.drillDiameter))
  if (g.root === 'fillet') q.set('rf', round(g.rootFillet))
  q.set('tr', round(g.tipRound))
  q.set('bt', g.bore.type)
  if (g.bore.type !== 'none') q.set('bd', round(g.bore.diameter))
  if (g.bore.type === 'flat') q.set('bf', round(g.bore.flatAcross))
  if (g.bore.type === 'key') {
    q.set('kw', round(g.bore.keyWidth))
    q.set('kd', round(g.bore.keyDepth))
  }
  q.set('saw', round(doc.cutting.toolRadius))
  return q.toString()
}

export function docFromQuery(query: string): GearDoc | null {
  const q = new URLSearchParams(query)
  if (!q.has('n')) return null
  const n = (key: string) => {
    const v = q.get(key)
    return v === null ? undefined : parseFloat(v)
  }
  return normaliseDoc({
    name: q.get('name') ?? undefined,
    gears: [
      {
        teeth: n('n'),
        module: n('m'),
        pressureAngle: n('pa'),
        profileShift: n('x') ?? 0,
        backlash: n('j'),
        root: q.get('r') === 'f' ? 'fillet' : 'drill',
        drillDiameter: n('dd') ?? 0,
        rootFillet: n('rf'),
        tipRound: n('tr'),
        bore: { type: (q.get('bt') as BoreType) ?? 'none', diameter: n('bd'), flatAcross: n('bf'), keyWidth: n('kw'), keyDepth: n('kd') },
      },
    ],
    cutting: { toolRadius: n('saw') },
  })
}
