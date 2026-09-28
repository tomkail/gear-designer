import { useEffect, useMemo, useRef, useState } from 'react'
import { drawTooltip, hexToRgba, renderGrid, tracePath, useModifierKeys, useViewportCanvas, type CanvasTheme, type LengthUnit, type ModifierState, type PointerInfo, type TooltipContent, type Vec } from '@tomkail/workshop-kit'
import { useDesignStore } from '../stores/designStore'
import { useSettingsStore, useThemeStore, useUiStore, useViewportStore } from '../stores/settingsStore'
import { MAX_MODULE, MIN_MODULE, clampTeeth, dpToModule, moduleToDp, type GearSpec } from '../model/design'
import type { GearGeometry } from '../model/gear'
import { computeDoc, gearAngle, gearLetter, type DocGeometry } from '../model/train'
import { bitSize, toothSizeLabel } from '../model/template'
import { len, num } from '../model/format'
import { canvasSize, fitView } from '../actions'
import styles from './GearCanvas.module.css'

type HandleId = 'size' | 'teeth' | 'place'

interface Handle {
  id: HandleId
  pos: Vec
  shape: 'dot' | 'diamond' | 'ring'
  /** Shown beside the handle while dragging */
  label: string
  /** Shown on hover: value, what dragging does, modifier keys */
  tooltip: TooltipContent
}

const polar = (c: Vec, r: number, a: number): Vec => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
const DEG = 180 / Math.PI

/** Direction pointing away from the gear's mesh partner, so handles stay clear of the teeth in mesh */
function outward(geo: DocGeometry, index: number): number {
  const mesh = geo.meshes.find((m) => m.a === index || m.b === index)
  if (!mesh) return 0
  const other = geo.placements[mesh.a === index ? mesh.b : mesh.a].center
  const c = geo.placements[index].center
  return Math.atan2(c.y - other.y, c.x - other.x)
}

function computeHandles(geo: DocGeometry, index: number, unit: LengthUnit, snap: boolean): Handle[] {
  const g = geo.gears[index]
  if (!g) return []
  const c = geo.placements[index].center
  const dir = outward(geo, index)
  const pair = geo.gears.length > 1
  const size = toothSizeLabel(g.spec.module, unit)
  const teeth = `${g.spec.teeth} teeth · pitch Ø${len(g.dims.r * 2, unit)}`
  const handles: Handle[] = [
    {
      id: 'size',
      pos: polar(c, g.dims.ra, dir),
      shape: 'diamond',
      label: `Tooth size: ${size}`,
      tooltip: {
        value: size,
        action: pair ? 'Drag to change tooth size (both gears)' : 'Drag to change tooth size',
        modifiers: snap ? [`⇧ drag freely (snaps to ${unit === 'in' ? '½ DP' : '0.25 module'})`] : ['Snapping off · S to turn on'],
      },
    },
    {
      id: 'teeth',
      pos: polar(c, g.dims.r, dir - Math.PI / 2),
      shape: 'dot',
      label: `${gearLetter(index)} · ${teeth}`,
      tooltip: { value: teeth, action: 'Drag out to add teeth, in to remove' },
    },
  ]
  const mesh = geo.meshes.find((m) => m.b === index)
  if (mesh) {
    const angle = `${num(mesh.angle, 3, 0, 1)}°`
    handles.push({
      id: 'place',
      pos: c,
      shape: 'ring',
      label: `Round ${gearLetter(mesh.a)} · ${angle}`,
      tooltip: { value: angle, action: `Drag to swing ${gearLetter(index)} round ${gearLetter(mesh.a)}`, modifiers: snap ? ['⇧ any angle (snaps to 15°)'] : ['Snapping off · S to turn on'] },
    })
  }
  return handles
}

/**
 * A fixed frame for a size or teeth drag, captured when the drag starts.
 *
 * A driven gear's centre moves when its size or tooth count changes (the
 * axle spacing grows with both), so measuring from its current centre
 * would feed back into itself and jitter. Instead each drag measures along
 * a fixed axis from a point that doesn't move:
 *  - size: from the gear it meshes with (or its own centre if it drives),
 *    along the line of centres. The handle's distance along it is exactly
 *    proportional to the module.
 *  - teeth: from the gear's centre, across the line of centres, where the
 *    gear doesn't move. The distance is the pitch radius, m·z/2.
 */
interface DragFrame {
  anchor: Vec
  axis: Vec
  /** Size drags: handle distance along the axis per unit of module */
  perModule: number
}

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y

function dragFrame(id: Exclude<HandleId, 'place'>, geo: DocGeometry, index: number, handle: Handle): DragFrame {
  const c = geo.placements[index].center
  const dir = outward(geo, index)
  if (id === 'teeth') return { anchor: c, axis: { x: Math.cos(dir - Math.PI / 2), y: Math.sin(dir - Math.PI / 2) }, perModule: 0 }
  const mesh = geo.meshes.find((m) => m.b === index)
  const anchor = mesh ? geo.placements[mesh.a].center : c
  const axis = { x: Math.cos(dir), y: Math.sin(dir) }
  const d = dot({ x: handle.pos.x - anchor.x, y: handle.pos.y - anchor.y }, axis)
  return { anchor, axis, perModule: d / geo.gears[index].spec.module }
}

function dragUpdate(id: Exclude<HandleId, 'place'>, info: PointerInfo, spec: GearSpec, frame: DragFrame): Partial<GearSpec> {
  const { unit, snap } = useSettingsStore.getState()
  const free = info.shift || !snap
  const along = dot({ x: info.world.x - frame.anchor.x, y: info.world.y - frame.anchor.y }, frame.axis)
  if (id === 'teeth') return { teeth: clampTeeth((2 * along) / spec.module) }
  let m = along / frame.perModule
  if (!free) m = unit === 'in' ? dpToModule(Math.max(1, Math.round(moduleToDp(m) * 2) / 2)) : Math.round(m * 4) / 4
  return { module: Math.min(MAX_MODULE, Math.max(MIN_MODULE, Math.round(m * 1000) / 1000)) }
}

function normaliseDegrees(deg: number) {
  const d = (((deg % 360) + 540) % 360) - 180
  return Math.abs(d + 180) < 1e-9 ? 180 : d
}

export function GearCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doc = useDesignStore((s) => s.doc)
  const updateGear = useDesignStore((s) => s.updateGear)
  const setMeshAngle = useDesignStore((s) => s.setMeshAngle)
  const theme = useThemeStore((s) => s.theme)
  const pan = useViewportStore((s) => s.pan)
  const zoom = useViewportStore((s) => s.zoom)
  const unit = useSettingsStore((s) => s.unit)
  const showConstruction = useSettingsStore((s) => s.showConstruction)
  const showMeasurements = useSettingsStore((s) => s.showMeasurements)
  const selected = Math.min(useUiStore((s) => s.selected), doc.gears.length - 1)
  const select = useUiStore((s) => s.select)
  const playing = useUiStore((s) => s.playing)
  const snap = useSettingsStore((s) => s.snap)
  const held = useModifierKeys()

  const geo = useMemo(() => computeDoc(doc, unit), [doc, unit])
  const handles = useMemo(() => computeHandles(geo, selected, unit, snap), [geo, selected, unit, snap])
  const [hovered, setHovered] = useState<HandleId | null>(null)
  /** Another gear under the pointer, which a click would select */
  const [hoverGear, setHoverGear] = useState<number | null>(null)
  const [dragging, setDragging] = useState<HandleId | null>(null)
  const draggingRef = useRef<HandleId | null>(null)
  const frameRef = useRef<DragFrame | null>(null)
  /** Driver rotation in radians; advanced by the animation, kept across edits */
  const driverAngle = useRef(0)

  const latest = useRef({ geo, handles, selected })
  latest.current = { geo, handles, selected }

  const hitTest = (info: PointerInfo): HandleId | null => {
    const tolerance = (matchMedia('(pointer: coarse)').matches ? 22 : 12) / useViewportStore.getState().zoom
    let best: { id: HandleId; d: number } | null = null
    for (const h of latest.current.handles) {
      const d = dist(h.pos, info.world)
      if (d < tolerance && (!best || d < best.d)) best = { id: h.id, d }
    }
    return best?.id ?? null
  }

  /** The gear under the pointer, if any */
  const gearAt = (world: Vec): number | null => {
    const { geo } = latest.current
    let best: { i: number; d: number } | null = null
    geo.gears.forEach((g, i) => {
      const d = dist(world, geo.placements[i].center)
      if (d < g.dims.ra && (!best || d < best.d)) best = { i, d }
    })
    return (best as { i: number } | null)?.i ?? null
  }

  const size = useViewportCanvas(canvasRef, useViewportStore, {
    onPointerDown: (info) => {
      const id = hitTest(info)
      if (!id) {
        // Clicking a gear selects it; dragging still pans
        const i = gearAt(info.world)
        if (i !== null && i !== latest.current.selected) select(i)
        return false
      }
      draggingRef.current = id
      const { geo, selected, handles } = latest.current
      const handle = handles.find((h) => h.id === id)
      frameRef.current = id !== 'place' && handle ? dragFrame(id, geo, selected, handle) : null
      setDragging(id)
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
      return true
    },
    onDrag: (info) => {
      const id = draggingRef.current
      const { geo, selected } = latest.current
      if (!id) return
      if (id === 'place') {
        const mesh = geo.meshes.find((m) => m.b === selected)
        if (!mesh) return
        const c = geo.placements[mesh.a].center
        const deg = Math.atan2(info.world.y - c.y, info.world.x - c.x) * DEG
        const { snap } = useSettingsStore.getState()
        setMeshAngle(selected, normaliseDegrees(info.shift || !snap ? Math.round(deg * 10) / 10 : Math.round(deg / 15) * 15))
      } else if (frameRef.current) {
        updateGear(dragUpdate(id, info, geo.gears[selected].spec, frameRef.current), selected)
      }
    },
    onDragEnd: (info) => {
      draggingRef.current = null
      frameRef.current = null
      setDragging(null)
      const id = hitTest(info)
      setHovered(id)
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'grab' : ''
    },
    onHover: (info) => {
      const id = info ? hitTest(info) : null
      const gear = !id && info ? gearAt(info.world) : null
      const other = gear !== null && gear !== latest.current.selected ? gear : null
      setHovered(id)
      setHoverGear(other)
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'grab' : other !== null ? 'pointer' : ''
    },
  })

  // Keep the shared canvas size current and fit the gears on first layout
  const fitted = useRef(false)
  useEffect(() => {
    canvasSize.width = size.width
    canvasSize.height = size.height
    if (!fitted.current && size.width > 0 && size.height > 0) {
      fitted.current = true
      fitView()
    }
  }, [size.width, size.height])

  const render = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || size.width === 0) return
    draw(ctx, { canvas, dpr: size.dpr, pan, zoom, theme, geo, selected, driverAngle: driverAngle.current, handles, active: dragging ?? hovered, dragging: dragging !== null, hoverGear, held, unit, showConstruction, showMeasurements, playing })
  }
  const renderRef = useRef(render)
  renderRef.current = render

  useEffect(() => {
    const frame = requestAnimationFrame(() => renderRef.current())
    return () => cancelAnimationFrame(frame)
  }, [size, pan, zoom, theme, geo, selected, handles, hovered, dragging, hoverGear, held, unit, showConstruction, showMeasurements, playing])

  // Animation: the driver turns at its RPM, every other gear follows its placement speed
  useEffect(() => {
    if (!playing) return
    const omega = (doc.driverRpm * 2 * Math.PI) / 60
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      driverAngle.current = (driverAngle.current + (omega * (now - last)) / 1000) % (Math.PI * 2 * 3600)
      last = now
      renderRef.current()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, doc.driverRpm])

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Gear design canvas. Click a gear to edit it; drag the handles to change the tooth size and the number of teeth." />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface DrawContext {
  canvas: HTMLCanvasElement
  dpr: number
  pan: Vec
  zoom: number
  theme: CanvasTheme
  geo: DocGeometry
  selected: number
  driverAngle: number
  handles: Handle[]
  active: HandleId | null
  dragging: boolean
  hoverGear: number | null
  held: ModifierState
  unit: LengthUnit
  showConstruction: boolean
  showMeasurements: boolean
  playing: boolean
}

function draw(ctx: CanvasRenderingContext2D, d: DrawContext) {
  const { canvas, dpr, pan, zoom, theme, geo, unit } = d
  const px = 1 / zoom

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  renderGrid(ctx, canvas.width, canvas.height, pan, zoom, {
    baseSize: unit === 'mm' ? 1 : 25.4 / 16,
    levelMultiplier: unit === 'mm' ? 10 : 4,
    color: theme.gridColor,
    idealScreenSpacing: 24,
  })

  const world = () => ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y)
  world()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Line of centres between meshed gears
  if (d.showConstruction) {
    ctx.lineWidth = px
    ctx.strokeStyle = theme.chrome
    ctx.setLineDash([2 * px, 4 * px])
    for (const mesh of geo.meshes) {
      const a = geo.placements[mesh.a].center
      const b = geo.placements[mesh.b].center
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  geo.gears.forEach((g, i) => {
    const p = geo.placements[i]
    world()
    ctx.translate(p.center.x, p.center.y)
    drawConstruction(ctx, d, g, i === d.selected && !d.playing, px)
    ctx.rotate(gearAngle(p, d.driverAngle))
    drawGear(ctx, d, g, i === d.selected || geo.gears.length === 1, px)
  })

  if (d.showMeasurements && !d.playing) drawMeasurements(ctx, d)

  // A gear with no outline would otherwise vanish; outline its tip circle and say why
  geo.gears.forEach((g, i) => {
    if (g.outline) return
    const c = geo.placements[i].center
    world()
    ctx.lineWidth = 2 * px
    ctx.strokeStyle = theme.danger
    circle(ctx, c, g.dims.ra)
    ctx.stroke()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    pill(ctx, `Gear ${gearLetter(i)} can’t be drawn – see Checks`, { x: c.x * zoom + pan.x, y: c.y * zoom + pan.y + 24 }, theme, true)
  })

  // Handles (hidden while animating)
  if (d.playing) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  for (const handle of d.handles) {
    const s = { x: handle.pos.x * zoom + pan.x, y: handle.pos.y * zoom + pan.y }
    drawHandle(ctx, s, handle.shape, handle.id === d.active, theme)
  }
  // Dragging shows the live value; hovering shows the full tooltip (value, action, modifier keys)
  const active = d.handles.find((h) => h.id === d.active)
  if (active) {
    const s = { x: active.pos.x * zoom + pan.x, y: active.pos.y * zoom + pan.y }
    if (d.dragging) pill(ctx, active.label, { x: s.x, y: s.y - 20 }, theme, true)
    else drawTooltip(ctx, active.tooltip, s, theme, { held: d.held })
  } else if (d.hoverGear !== null) {
    const c = geo.placements[d.hoverGear].center
    drawTooltip(ctx, { action: `Click to edit gear ${gearLetter(d.hoverGear)}` }, { x: c.x * zoom + pan.x, y: c.y * zoom + pan.y }, theme)
  }
}

const circle = (ctx: CanvasRenderingContext2D, c: Vec, r: number) => {
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
}

const cross = (ctx: CanvasRenderingContext2D, c: Vec, arm: number) => {
  ctx.beginPath()
  ctx.moveTo(c.x - arm, c.y)
  ctx.lineTo(c.x + arm, c.y)
  ctx.moveTo(c.x, c.y - arm)
  ctx.lineTo(c.x, c.y + arm)
  ctx.stroke()
}

/** Pitch (dash-dot), base (dotted), tip and root (faint) circles, in the gear's unrotated frame */
function drawConstruction(ctx: CanvasRenderingContext2D, d: DrawContext, g: GearGeometry, selected: boolean, px: number) {
  if (!d.showConstruction) return
  const { theme } = d
  const origin = { x: 0, y: 0 }
  ctx.lineWidth = px
  ctx.strokeStyle = selected && d.active === 'teeth' ? theme.accent : theme.stroke
  ctx.setLineDash([10 * px, 4 * px, 2 * px, 4 * px])
  circle(ctx, origin, g.dims.r)
  ctx.stroke()
  ctx.strokeStyle = theme.chrome
  ctx.setLineDash([2 * px, 4 * px])
  circle(ctx, origin, g.dims.rb)
  ctx.stroke()
  ctx.strokeStyle = selected && d.active === 'size' ? theme.accent : theme.accentGhost
  ctx.setLineDash([2 * px, 3 * px])
  circle(ctx, origin, g.dims.ra)
  ctx.stroke()
  circle(ctx, origin, g.stats.rootDiameter / 2)
  ctx.stroke()
  ctx.setLineDash([])
}

/** Outline, root holes and bore, in the gear's rotated frame */
function drawGear(ctx: CanvasRenderingContext2D, d: DrawContext, g: GearGeometry, emphasis: boolean, px: number) {
  const { theme } = d
  const origin = { x: 0, y: 0 }
  if (g.outline) {
    ctx.beginPath()
    tracePath(ctx, { ...g.outline, closed: true })
    ctx.fillStyle = hexToRgba(theme.accent, (theme.isDark ? 0.14 : 0.18) * (emphasis ? 1 : 0.55))
    ctx.fill()
    ctx.lineWidth = (emphasis ? 2 : 1.25) * px
    ctx.strokeStyle = !g.valid ? theme.danger : emphasis ? theme.pathStroke : theme.strokeHover
    ctx.stroke()
  }

  if (g.drill) {
    ctx.lineWidth = 1.25 * px
    ctx.strokeStyle = theme.strokeHover
    for (const c of g.drill.centres) {
      circle(ctx, c, g.drill.diameter / 2)
      ctx.stroke()
    }
    ctx.lineWidth = px
    const arm = Math.min(g.drill.diameter * 0.3, 5 * px)
    for (const c of g.drill.centres) cross(ctx, c, arm)
  }

  ctx.lineWidth = 1.25 * px
  ctx.strokeStyle = theme.strokeHover
  if (g.bore?.kind === 'circle') {
    circle(ctx, origin, g.bore.radius)
    ctx.stroke()
  } else if (g.bore?.kind === 'path') {
    ctx.beginPath()
    tracePath(ctx, { ...g.bore.path, closed: true })
    ctx.stroke()
  }
  ctx.lineWidth = px
  cross(ctx, origin, 7 * px)
}

function drawHandle(ctx: CanvasRenderingContext2D, at: Vec, shape: Handle['shape'], active: boolean, theme: CanvasTheme) {
  const size = active ? 7 : 5.5
  const path = new Path2D()
  if (shape === 'diamond') {
    path.moveTo(at.x, at.y - size * 1.25)
    path.lineTo(at.x + size * 1.25, at.y)
    path.lineTo(at.x, at.y + size * 1.25)
    path.lineTo(at.x - size * 1.25, at.y)
    path.closePath()
  } else {
    path.arc(at.x, at.y, shape === 'ring' ? size * 1.4 : size, 0, Math.PI * 2)
  }
  // Double stroke (Serpentine visual language): light halo, dark outline, accent body
  ctx.lineWidth = theme.handle.innerWidth + theme.handle.outerWidth * 2
  ctx.strokeStyle = theme.handle.outerStroke
  ctx.stroke(path)
  ctx.lineWidth = theme.handle.innerWidth
  ctx.strokeStyle = theme.handle.innerStroke
  ctx.stroke(path)
  if (shape === 'ring') {
    ctx.lineWidth = 2.5
    ctx.strokeStyle = theme.accent
    ctx.stroke(path)
  } else {
    ctx.fillStyle = active ? theme.accent : hexToRgba(theme.accent, 0.85)
    ctx.fill(path)
  }
}

function pill(ctx: CanvasRenderingContext2D, text: string, at: Vec, theme: CanvasTheme, accent = false) {
  ctx.font = `500 11px 'JetBrains Mono', ui-monospace, monospace`
  const w = ctx.measureText(text).width + 12
  const h = 18
  // Keep labels on screen (the panel sits beside the canvas, not over it)
  const maxX = ctx.canvas.clientWidth - w / 2 - 6
  at = { x: Math.max(w / 2 + 6, Math.min(maxX, at.x)), y: at.y }
  ctx.beginPath()
  ctx.roundRect(at.x - w / 2, at.y - h / 2, w, h, 4)
  ctx.fillStyle = theme.ui.panelBg
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = accent ? theme.accentDim : theme.ui.panelBorder
  ctx.stroke()
  ctx.fillStyle = accent ? theme.accent : theme.ui.textSecondary
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, at.x, at.y + 0.5)
}

function drawMeasurements(ctx: CanvasRenderingContext2D, d: DrawContext) {
  const { dpr, pan, zoom, theme, geo, unit } = d
  const g = geo.gears[d.selected]
  const c = geo.placements[d.selected].center
  const { dims } = g
  if (zoom * dims.ra < 40) return // too small to label legibly
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const S = (p: Vec): Vec => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y })

  const dimension = (from: Vec, to: Vec, offset: number, label: string) => {
    // Dimension line offset perpendicular to from→to by `offset` screen px
    const a = S(from)
    const b = S(to)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
    const a2 = { x: a.x + n.x * offset, y: a.y + n.y * offset }
    const b2 = { x: b.x + n.x * offset, y: b.y + n.y * offset }
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    ctx.lineWidth = 1
    ctx.strokeStyle = theme.chrome
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(a2.x, a2.y)
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b2.x, b2.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = theme.strokeHover
    ctx.beginPath()
    ctx.moveTo(a2.x, a2.y)
    ctx.lineTo(b2.x, b2.y)
    for (const [p, dir] of [[a2, 1], [b2, -1]] as const) {
      ctx.moveTo(p.x + dir * 7 * u.x - 4 * n.x, p.y + dir * 7 * u.y - 4 * n.y)
      ctx.lineTo(p.x, p.y)
      ctx.lineTo(p.x + dir * 7 * u.x + 4 * n.x, p.y + dir * 7 * u.y + 4 * n.y)
    }
    ctx.stroke()
    pill(ctx, label, { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }, theme)
  }

  // Offsets are screen px, positive = down for a left-to-right dimension
  const clear = dims.ra * zoom + 26
  dimension({ x: c.x - dims.ra, y: c.y }, { x: c.x + dims.ra, y: c.y }, clear, `Outside Ø${len(dims.ra * 2, unit)}`)
  dimension({ x: c.x - dims.r, y: c.y }, { x: c.x + dims.r, y: c.y }, -clear, `Pitch Ø${len(dims.r * 2, unit)}`)

  // Axle spacing parallel to each line of centres, clear of both gears
  for (const mesh of geo.meshes) {
    const a = geo.placements[mesh.a].center
    const b = geo.placements[mesh.b].center
    const flip = b.x < a.x
    const offset = Math.max(geo.gears[mesh.a].dims.ra, geo.gears[mesh.b].dims.ra) * zoom + 56
    dimension(flip ? b : a, flip ? a : b, -offset, `Axle spacing ${len(mesh.centreDistance, unit)}`)
  }

  // Bit size beside the root hole nearest the lower left, clear of the handles and the panel
  if (g.drill && g.drill.diameter * zoom > 14) {
    const angle = gearAngle(geo.placements[d.selected], d.driverAngle)
    const target = (3 * Math.PI) / 4
    const at = (p: Vec) => Math.atan2(p.y, p.x) + angle
    const off = (p: Vec) => Math.abs(normaliseDegrees((at(p) - target) * DEG))
    const hole = g.drill.centres.reduce((best, p) => (off(p) < off(best) ? p : best))
    const dir = at(hole)
    const h = S(polar(c, g.drill.centreRadius, dir))
    const edge = S(polar(c, dims.ra, dir))
    ctx.lineWidth = 1
    ctx.strokeStyle = theme.chrome
    ctx.beginPath()
    ctx.moveTo(h.x, h.y)
    ctx.lineTo(edge.x + Math.cos(dir) * 18, edge.y + Math.sin(dir) * 18)
    ctx.stroke()
    pill(ctx, `Drill ${bitSize(g.drill.diameter, unit)}`, { x: edge.x + Math.cos(dir) * 18, y: edge.y + Math.sin(dir) * 18 + 10 }, theme)
  }
}
