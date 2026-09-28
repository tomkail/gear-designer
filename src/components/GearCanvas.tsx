import { useEffect, useMemo, useRef, useState } from 'react'
import { hexToRgba, renderGrid, tracePath, useViewportCanvas, type CanvasTheme, type LengthUnit, type PointerInfo, type Vec } from '@tomkail/workshop-kit'
import { useDesignStore } from '../stores/designStore'
import { useSettingsStore, useThemeStore, useViewportStore } from '../stores/settingsStore'
import { MAX_MODULE, MIN_MODULE, clampTeeth, dpToModule, moduleToDp, type GearSpec } from '../model/design'
import { kindOf } from '../model/kinds'
import type { GearGeometry } from '../model/gear'
import { bitSize, len, toothSizeLabel } from '../model/template'
import { canvasSize, fitView } from '../actions'
import styles from './GearCanvas.module.css'

type HandleId = 'size' | 'teeth'

interface Handle {
  id: HandleId
  pos: Vec
  shape: 'dot' | 'diamond'
  label: string
}

const polar = (r: number, a: number): Vec => ({ x: r * Math.cos(a), y: r * Math.sin(a) })
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/** Tooth size on the tip of tooth 0 (+x); tooth count on the pitch circle at the top */
function computeHandles(g: GearGeometry, unit: LengthUnit): Handle[] {
  return [
    { id: 'size', pos: polar(g.dims.ra, 0), shape: 'diamond', label: `Tooth size: ${toothSizeLabel(g.spec.module, unit)}` },
    { id: 'teeth', pos: polar(g.dims.r, -Math.PI / 2), shape: 'dot', label: `${g.spec.teeth} teeth · pitch Ø${len(g.dims.r * 2, unit)}` },
  ]
}

function dragUpdate(id: HandleId, info: PointerInfo, spec: GearSpec): Partial<GearSpec> {
  const { unit, snap } = useSettingsStore.getState()
  const free = info.shift || !snap
  const radius = Math.hypot(info.world.x, info.world.y)
  if (id === 'teeth') return { teeth: clampTeeth((2 * radius) / spec.module) }
  // Tip radius = m(z/2 + 1 + x)
  let m = radius / (spec.teeth / 2 + 1 + spec.profileShift)
  if (!free) m = unit === 'in' ? dpToModule(Math.max(1, Math.round(moduleToDp(m) * 2) / 2)) : Math.round(m * 4) / 4
  return { module: Math.min(MAX_MODULE, Math.max(MIN_MODULE, Math.round(m * 1000) / 1000)) }
}

export function GearCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doc = useDesignStore((s) => s.doc)
  const updateGear = useDesignStore((s) => s.updateGear)
  const theme = useThemeStore((s) => s.theme)
  const pan = useViewportStore((s) => s.pan)
  const zoom = useViewportStore((s) => s.zoom)
  const unit = useSettingsStore((s) => s.unit)
  const showConstruction = useSettingsStore((s) => s.showConstruction)
  const showMeasurements = useSettingsStore((s) => s.showMeasurements)

  const spec = doc.gears[0]
  const geometry = useMemo(() => kindOf(spec).compute(spec, doc.cutting, unit), [spec, doc.cutting, unit])
  const handles = useMemo(() => computeHandles(geometry, unit), [geometry, unit])
  const [hovered, setHovered] = useState<HandleId | null>(null)
  const [dragging, setDragging] = useState<HandleId | null>(null)
  const draggingRef = useRef<HandleId | null>(null)

  const latest = useRef({ spec, handles })
  latest.current = { spec, handles }

  const hitTest = (info: PointerInfo): HandleId | null => {
    const tolerance = (matchMedia('(pointer: coarse)').matches ? 22 : 12) / useViewportStore.getState().zoom
    let best: { id: HandleId; d: number } | null = null
    for (const h of latest.current.handles) {
      const d = dist(h.pos, info.world)
      if (d < tolerance && (!best || d < best.d)) best = { id: h.id, d }
    }
    return best?.id ?? null
  }

  const size = useViewportCanvas(canvasRef, useViewportStore, {
    onPointerDown: (info) => {
      const id = hitTest(info)
      if (!id) return false
      draggingRef.current = id
      setDragging(id)
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
      return true
    },
    onDrag: (info) => {
      const id = draggingRef.current
      if (id) updateGear(dragUpdate(id, info, latest.current.spec))
    },
    onDragEnd: (info) => {
      draggingRef.current = null
      setDragging(null)
      const id = hitTest(info)
      setHovered(id)
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'grab' : ''
    },
    onHover: (info) => {
      const id = info ? hitTest(info) : null
      setHovered(id)
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'grab' : ''
    },
  })

  // Keep the shared canvas size current and fit the gear on first layout
  const fitted = useRef(false)
  useEffect(() => {
    canvasSize.width = size.width
    canvasSize.height = size.height
    if (!fitted.current && size.width > 0 && size.height > 0) {
      fitted.current = true
      fitView()
    }
  }, [size.width, size.height])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx || size.width === 0) return
      draw(ctx, { canvas, dpr: size.dpr, pan, zoom, theme, g: geometry, handles, active: dragging ?? hovered, unit, showConstruction, showMeasurements })
    })
    return () => cancelAnimationFrame(frame)
  }, [size, pan, zoom, theme, geometry, handles, hovered, dragging, unit, showConstruction, showMeasurements])

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Gear design canvas. Drag the handles to change the tooth size and the number of teeth." />
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
  g: GearGeometry
  handles: Handle[]
  active: HandleId | null
  unit: LengthUnit
  showConstruction: boolean
  showMeasurements: boolean
}

function draw(ctx: CanvasRenderingContext2D, d: DrawContext) {
  const { canvas, dpr, pan, zoom, theme, g, unit } = d
  const { dims } = g
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

  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const circle = (c: Vec, r: number) => {
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  }
  const cross = (c: Vec, arm: number) => {
    ctx.beginPath()
    ctx.moveTo(c.x - arm, c.y)
    ctx.lineTo(c.x + arm, c.y)
    ctx.moveTo(c.x, c.y - arm)
    ctx.lineTo(c.x, c.y + arm)
    ctx.stroke()
  }
  const origin = { x: 0, y: 0 }

  // Gear body
  if (g.outline) {
    ctx.beginPath()
    tracePath(ctx, { ...g.outline, closed: true })
    ctx.fillStyle = hexToRgba(theme.accent, theme.isDark ? 0.14 : 0.18)
    ctx.fill()
    ctx.lineWidth = 2 * px
    ctx.strokeStyle = g.valid ? theme.pathStroke : theme.danger
    ctx.stroke()
  }

  // Construction circles: pitch (dash-dot), base (dotted), tip and root (faint)
  if (d.showConstruction) {
    ctx.lineWidth = px
    ctx.strokeStyle = d.active === 'teeth' ? theme.accent : theme.stroke
    ctx.setLineDash([10 * px, 4 * px, 2 * px, 4 * px])
    circle(origin, dims.r)
    ctx.stroke()
    ctx.strokeStyle = theme.chrome
    ctx.setLineDash([2 * px, 4 * px])
    circle(origin, dims.rb)
    ctx.stroke()
    ctx.strokeStyle = d.active === 'size' ? theme.accent : theme.accentGhost
    ctx.setLineDash([2 * px, 3 * px])
    circle(origin, dims.ra)
    ctx.stroke()
    circle(origin, g.stats.rootDiameter / 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Root drilling
  if (g.drill) {
    ctx.lineWidth = 1.25 * px
    ctx.strokeStyle = theme.strokeHover
    for (const c of g.drill.centres) {
      circle(c, g.drill.diameter / 2)
      ctx.stroke()
    }
    ctx.lineWidth = px
    const arm = Math.min(g.drill.diameter * 0.3, 5 * px)
    for (const c of g.drill.centres) cross(c, arm)
  }

  // Bore
  ctx.lineWidth = 1.25 * px
  ctx.strokeStyle = theme.strokeHover
  if (g.bore?.kind === 'circle') {
    circle(origin, g.bore.radius)
    ctx.stroke()
  } else if (g.bore?.kind === 'path') {
    ctx.beginPath()
    tracePath(ctx, { ...g.bore.path, closed: true })
    ctx.stroke()
  }
  ctx.lineWidth = px
  cross(origin, 7 * px)

  if (d.showMeasurements) drawMeasurements(ctx, d)

  // Handles
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  for (const handle of d.handles) {
    const s = { x: handle.pos.x * zoom + pan.x, y: handle.pos.y * zoom + pan.y }
    drawHandle(ctx, s, handle.shape, handle.id === d.active, theme)
  }
  const active = d.handles.find((h) => h.id === d.active)
  if (active) {
    const s = { x: active.pos.x * zoom + pan.x, y: active.pos.y * zoom + pan.y }
    pill(ctx, active.label, { x: s.x, y: s.y - 20 }, theme, true)
  }
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
    path.arc(at.x, at.y, size, 0, Math.PI * 2)
  }
  // Double stroke (Serpentine visual language): light halo, dark outline, accent body
  ctx.lineWidth = theme.handle.innerWidth + theme.handle.outerWidth * 2
  ctx.strokeStyle = theme.handle.outerStroke
  ctx.stroke(path)
  ctx.lineWidth = theme.handle.innerWidth
  ctx.strokeStyle = theme.handle.innerStroke
  ctx.stroke(path)
  ctx.fillStyle = active ? theme.accent : hexToRgba(theme.accent, 0.85)
  ctx.fill(path)
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
  const { dpr, pan, zoom, theme, g, unit } = d
  const { dims } = g
  if (zoom * dims.ra < 40) return // too small to label legibly
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const S = (p: Vec): Vec => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y })

  const dimension = (r: number, y: number, label: string) => {
    const a = S({ x: -r, y: 0 })
    const b = S({ x: r, y: 0 })
    ctx.lineWidth = 1
    ctx.strokeStyle = theme.chrome
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(a.x, y)
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = theme.strokeHover
    ctx.beginPath()
    ctx.moveTo(a.x, y)
    ctx.lineTo(b.x, y)
    for (const [x, dir] of [[a.x, 1], [b.x, -1]] as const) {
      ctx.moveTo(x + dir * 7, y - 4)
      ctx.lineTo(x, y)
      ctx.lineTo(x + dir * 7, y + 4)
    }
    ctx.stroke()
    pill(ctx, label, { x: (a.x + b.x) / 2, y }, theme)
  }

  dimension(dims.ra, S({ x: 0, y: dims.ra }).y + 26, `Outside Ø${len(dims.ra * 2, unit)}`)
  dimension(dims.r, S({ x: 0, y: -dims.ra }).y - 26, `Pitch Ø${len(dims.r * 2, unit)}`)

  // Bit size beside the root hole nearest the lower left, clear of the handles and the panel
  if (g.drill && g.drill.diameter * zoom > 14) {
    const target = (3 * Math.PI) / 4
    const gap = (c: Vec) => Math.abs(Math.atan2(c.y, c.x) - target)
    const c = g.drill.centres.reduce((best, p) => (gap(p) < gap(best) ? p : best))
    const dir = Math.atan2(c.y, c.x)
    const edge = S({ x: Math.cos(dir) * dims.ra, y: Math.sin(dir) * dims.ra })
    const hole = S(c)
    ctx.lineWidth = 1
    ctx.strokeStyle = theme.chrome
    ctx.beginPath()
    ctx.moveTo(hole.x, hole.y)
    ctx.lineTo(edge.x + Math.cos(dir) * 18, edge.y + Math.sin(dir) * 18)
    ctx.stroke()
    pill(ctx, `Drill ${bitSize(g.drill.diameter, unit)}`, { x: edge.x + Math.cos(dir) * 18, y: edge.y + Math.sin(dir) * 18 + 10 }, theme)
  }
}
