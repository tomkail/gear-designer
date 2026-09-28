import {
  approxFraction,
  isStandardBit,
  layoutPages,
  textWidthMm,
  translateItems,
  type ComposedPage,
  type DrawItem,
  type Drawing,
  type LengthUnit,
  type PageContent,
  type PageSetup,
  type StrokeStyle,
  type Vec,
} from '@tomkail/workshop-kit'
import type { GearDoc, GearSpec } from './design'
import type { GearGeometry } from './gear'
import { len, num } from './format'
import { gearLetter, type DocGeometry, type MeshInfo } from './train'

/**
 * Printable template. Everything here is in real millimetres; the same
 * Drawing feeds print, PDF, SVG and DXF so the dimensions always match.
 */

export const STYLES = {
  outline: { stroke: '#000000', width: 0.3, fill: '#efefef', layer: 'outline' },
  hole: { stroke: '#000000', width: 0.2, layer: 'holes' },
  mark: { stroke: '#000000', width: 0.18, layer: 'centres' },
  bore: { stroke: '#000000', width: 0.25, layer: 'bore' },
  pitch: { stroke: '#666666', width: 0.15, dash: [4, 1, 1, 1], layer: 'construction' },
  construction: { stroke: '#999999', width: 0.12, dash: [1, 1], layer: 'construction' },
  grain: { stroke: '#555555', width: 0.25, layer: 'labels' },
} satisfies Record<string, StrokeStyle>

export interface TemplateOptions {
  unit: LengthUnit
  labels: boolean
  construction: boolean
}

export interface PageOptions extends TemplateOptions {
  paperId: string
  landscape: boolean
  scaleCheck: boolean
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export { len }

/** Drill sizes, named in the system the bit is sold in, plus the other-system equivalent */
export function bitSize(mm: number, unit: LengthUnit): string {
  const system = isStandardBit(mm)?.system ?? unit
  return system === 'mm' ? `Ø${len(mm, 'mm')} (${approxFraction(mm)})` : `Ø${len(mm, 'in')} (${len(mm, 'mm')})`
}


/** "module 4 (6.35 DP)" or "6.35 DP (module 4)" depending on the unit */
export function toothSizeLabel(module: number, unit: LengthUnit): string {
  const dp = num(25.4 / module)
  return unit === 'in' ? `${dp} DP (module ${num(module)})` : `module ${num(module)} (${dp} DP)`
}

export function boreDescription(spec: GearSpec, unit: LengthUnit): string {
  const { bore } = spec
  switch (bore.type) {
    case 'none':
      return 'No bore'
    case 'round':
      return `Bore ${bitSize(bore.diameter, unit)}`
    case 'flat':
      return `Bore ${bitSize(bore.diameter, unit)} with a flat, ${len(bore.flatAcross, unit)} across`
    case 'key':
      return `Bore ${bitSize(bore.diameter, unit)} with a ${len(bore.keyWidth, unit)} keyway, ${len(bore.keyDepth, unit)} deep`
  }
}

/** Human-readable spec lines, shared by the panel and the printed template */
export function specLines(spec: GearSpec, g: GearGeometry, unit: LengthUnit): string[] {
  const s = g.stats
  const shift = spec.profileShift ? ` · profile shift ${num(spec.profileShift)}` : ''
  const lines = [
    `${spec.teeth} ${spec.toothForm === 'stub' ? 'stub ' : ''}teeth · ${toothSizeLabel(spec.module, unit)} · ${spec.pressureAngle}° pressure angle${shift}`,
    `Pitch Ø${len(s.pitchDiameter, unit)} · outside Ø${len(s.outsideDiameter, unit)} · root Ø${len(s.rootDiameter, unit)} · tooth spacing ${len(s.circularPitch, unit)}`,
  ]
  if (g.drill) {
    lines.push(
      `Drill ${spec.teeth} × ${bitSize(g.drill.diameter, unit)} root holes, centres on a ${len(g.drill.centreRadius * 2, unit)} circle, ${num(360 / spec.teeth)}° apart (step-off ${len(g.drill.stepOff, unit)})`
    )
  }
  lines.push(boreDescription(spec, unit))
  return lines
}

/** One line about the pair: ratio, axle spacing and contact ratio */
export function meshLine(mesh: MeshInfo, geo: DocGeometry, unit: LengthUnit): string {
  const A = geo.gears[mesh.a].spec
  const B = geo.gears[mesh.b].spec
  return `${gearLetter(mesh.a)} (${A.teeth} teeth) drives ${gearLetter(mesh.b)} (${B.teeth} teeth): ratio 1 : ${num(mesh.ratio)} · axle spacing ${len(mesh.centreDistance, unit)} · contact ratio ${num(mesh.contactRatio)}`
}

/** Spec lines for the whole document: each gear, prefixed with its letter when there's a pair */
export function docSpecLines(geo: DocGeometry, unit: LengthUnit): string[] {
  if (geo.gears.length === 1) return specLines(geo.gears[0].spec, geo.gears[0], unit)
  const lines = geo.meshes.map((mesh) => meshLine(mesh, geo, unit))
  geo.gears.forEach((g, i) => {
    specLines(g.spec, g, unit).forEach((line, j) => lines.push(j === 0 ? `${gearLetter(i)}: ${line}` : `    ${line}`))
  })
  return lines
}

export function workflowLines(spec: GearSpec): string[] {
  return spec.root === 'drill'
    ? [
        '1. Stick this template to square stock, grain along the arrow. 2. Drill the root holes and the bore while the stock is square and supported.',
        '3. Saw each flank from the tip down to its hole, staying just outside the line. 4. File and sand to the line; round over the tips.',
      ]
    : [
        '1. Stick this template to square stock, grain along the arrow. 2. Drill the bore while the stock is square.',
        '3. Saw round the teeth, staying just outside the line. 4. File the root corners and sand to the line.',
      ]
}

// ---------------------------------------------------------------------------
// Geometry → items (gear centred on the origin)
// ---------------------------------------------------------------------------

function crosshair(at: Vec, arm: number, style: StrokeStyle): DrawItem[] {
  return [
    { kind: 'line', from: { x: at.x - arm, y: at.y }, to: { x: at.x + arm, y: at.y }, style },
    { kind: 'line', from: { x: at.x, y: at.y - arm }, to: { x: at.x, y: at.y + arm }, style },
  ]
}

/** Double-headed arrow with "GRAIN" under it */
function grainArrow(center: Vec, length: number): DrawItem[] {
  const h = Math.min(2.5, length * 0.12)
  const a = { x: center.x - length / 2, y: center.y }
  const b = { x: center.x + length / 2, y: center.y }
  const style = STYLES.grain
  return [
    { kind: 'line', from: a, to: b, style },
    { kind: 'line', from: a, to: { x: a.x + h, y: a.y - h * 0.6 }, style },
    { kind: 'line', from: a, to: { x: a.x + h, y: a.y + h * 0.6 }, style },
    { kind: 'line', from: b, to: { x: b.x - h, y: b.y - h * 0.6 }, style },
    { kind: 'line', from: b, to: { x: b.x - h, y: b.y + h * 0.6 }, style },
    { kind: 'text', at: { x: center.x, y: center.y + 3.2 }, text: 'GRAIN', size: 2.2, align: 'middle', color: '#555555', layer: 'labels' },
  ]
}

export function gearItems(g: GearGeometry, options: Pick<TemplateOptions, 'construction' | 'labels'>): DrawItem[] {
  const items: DrawItem[] = []
  const origin = { x: 0, y: 0 }
  const { dims } = g

  if (options.construction) {
    items.push({ kind: 'circle', center: origin, radius: dims.r, style: STYLES.pitch })
    items.push({ kind: 'circle', center: origin, radius: dims.rb, style: STYLES.construction })
  }

  if (g.outline) items.push({ kind: 'path', start: g.outline.start, segments: g.outline.segments, closed: true, style: STYLES.outline })

  if (g.drill) {
    const r = g.drill.diameter / 2
    for (const c of g.drill.centres) {
      items.push({ kind: 'circle', center: c, radius: r, style: STYLES.hole })
      items.push(...crosshair(c, Math.min(2, r * 0.6), STYLES.mark))
    }
  }

  items.push(...crosshair(origin, Math.min(4, dims.rf * 0.2), STYLES.mark))
  if (g.bore?.kind === 'circle') items.push({ kind: 'circle', center: origin, radius: g.bore.radius, style: STYLES.bore })
  if (g.bore?.kind === 'path') items.push({ kind: 'path', start: g.bore.path.start, segments: g.bore.path.segments, closed: true, style: STYLES.bore })

  if (options.labels) {
    const boreR = g.bore?.kind === 'circle' ? g.bore.radius : g.spec.bore.diameter / 2
    const room = g.stats.rootDiameter / 2 - boreR
    if (room > 12) items.push(...grainArrow({ x: 0, y: -(boreR + room * 0.5) }, Math.min(40, g.stats.rootDiameter * 0.45)))
  }
  return items
}

// ---------------------------------------------------------------------------
// Layout: gears side by side for cutting, plus an axle-spacing gauge for a pair
// ---------------------------------------------------------------------------

const GAP = 8

function axleGauge(mesh: MeshInfo, at: Vec, unit: LengthUnit, labels: boolean): DrawItem[] {
  const a = { x: at.x, y: at.y }
  const b = { x: at.x + mesh.centreDistance, y: at.y }
  const items: DrawItem[] = [{ kind: 'line', from: a, to: b, style: STYLES.mark }, ...crosshair(a, 4, STYLES.mark), ...crosshair(b, 4, STYLES.mark)]
  items.push({ kind: 'circle', center: a, radius: 1.5, style: STYLES.mark }, { kind: 'circle', center: b, radius: 1.5, style: STYLES.mark })
  if (labels) {
    items.push({
      kind: 'text',
      at: { x: (a.x + b.x) / 2, y: at.y - 2 },
      text: `Axle spacing ${gearLetter(mesh.a)}–${gearLetter(mesh.b)}: ${len(mesh.centreDistance, unit)} between centres`,
      size: 2.6,
      align: 'middle',
      layer: 'labels',
    })
  }
  return items
}

/** Everything to cut, laid out left to right in mm, with its bounds */
export function layoutContent(geo: DocGeometry, options: TemplateOptions): PageContent {
  const items: DrawItem[] = []
  const pair = geo.gears.length > 1
  const maxR = Math.max(...geo.gears.map((g) => g.dims.ra + 1.5))
  const labelRow = options.labels && pair ? 7 : 0
  let x = 0
  geo.gears.forEach((g, i) => {
    const r = g.dims.ra + 1.5
    const cx = x + r
    items.push(...translateItems(gearItems(g, options), cx, 0))
    if (labelRow) {
      const mates = geo.meshes.filter((m) => m.a === i || m.b === i).map((m) => (m.a === i ? m.b : m.a))
      const text = `${gearLetter(i)} · ${g.spec.teeth} teeth${mates.map((j) => ` · meshes with ${gearLetter(j)} (${geo.gears[j].spec.teeth} teeth)`).join('')}`
      items.push({ kind: 'text', at: { x: cx, y: maxR + 5 }, text, size: 2.8, bold: true, align: 'middle', layer: 'labels' })
    }
    x += 2 * r + GAP
  })
  let bottom = maxR + labelRow
  for (const mesh of geo.meshes) {
    bottom += options.labels ? 10 : 6
    items.push(...axleGauge(mesh, { x: 4, y: bottom }, options.unit, options.labels))
    bottom += 4
  }
  const width = Math.max(x - GAP, ...geo.meshes.map((m) => m.centreDistance + 8))
  return { items, bounds: { x: 0, y: -maxR, width, height: bottom + maxR } }
}

// ---------------------------------------------------------------------------
// Artboard (SVG / DXF export)
// ---------------------------------------------------------------------------

const TEXT_SIZE = 2.8
const LINE_GAP = 4.2

export function buildGearDrawing(doc: GearDoc, geo: DocGeometry, options: TemplateOptions): Drawing {
  const margin = 5
  const content = layoutContent(geo, options)
  const { bounds } = content
  const lines = options.labels ? [doc.name, ...geo.meshes.map((m) => meshLine(m, geo, options.unit)), ...(geo.gears.length === 1 ? specLines(geo.gears[0].spec, geo.gears[0], options.unit) : [])] : []
  const textWidth = Math.max(0, ...lines.map((l, i) => textWidthMm(l, i === 0 ? 3.4 : TEXT_SIZE, i === 0)))
  const width = Math.max(bounds.width, textWidth) + margin * 2
  const labelHeight = lines.length ? lines.length * LINE_GAP + 3 : 0
  const height = bounds.height + margin * 2 + labelHeight
  const items = translateItems(content.items, margin - bounds.x + (width - margin * 2 - bounds.width) / 2, margin - bounds.y)
  lines.forEach((text, i) => {
    items.push({ kind: 'text', at: { x: width / 2, y: margin + bounds.height + 5 + i * LINE_GAP }, text, size: i === 0 ? 3.4 : TEXT_SIZE, bold: i === 0, align: 'middle', layer: 'labels' })
  })
  return { width: round(width), height: round(height), items }
}

const round = (v: number) => Math.round(v * 100) / 100

// ---------------------------------------------------------------------------
// Printable pages: one sheet, or tiled when the gears are too big
// ---------------------------------------------------------------------------

function pageSetup(doc: GearDoc, geo: DocGeometry, options: PageOptions): PageSetup {
  const notes = workflowLines(geo.gears[0].spec)
  if (geo.meshes.length) notes.push('5. Drill the axle holes in the frame at the spacing on the gauge, then check the gears turn freely before gluing anything.')
  return {
    paperId: options.paperId,
    landscape: options.landscape,
    scaleCheck: options.scaleCheck,
    header: options.labels ? { title: doc.name, tag: 'Gear Designer template · 1:1', lines: docSpecLines(geo, options.unit), notes } : undefined,
  }
}

export function buildPages(doc: GearDoc, geo: DocGeometry, options: PageOptions): ComposedPage[] {
  return layoutPages(layoutContent(geo, options), pageSetup(doc, geo, options), { mode: 'physical', mmPerUnit: 1 })
}
