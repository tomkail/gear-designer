import { resolveScreenScale, downloadBlob, drawingToDxf, drawingToSvg, drawingsToPdf, notify, pickTextFile, printDrawings } from '@tomkail/workshop-kit'
import { DEFAULT_DOC, docToQuery, normaliseDoc, type GearDoc } from './model/design'
import { kindOf } from './model/kinds'
import { buildGearDrawing, buildPages } from './model/template'
import { designHistory, useDesignStore } from './stores/designStore'
import { useSettingsStore, useUiStore, useViewportStore } from './stores/settingsStore'

/** Canvas size in CSS px, kept up to date by the canvas component */
export const canvasSize = { width: 0, height: 0 }

const current = () => {
  const doc = useDesignStore.getState().doc
  const settings = useSettingsStore.getState()
  const spec = doc.gears[0]
  return { doc, geometry: kindOf(spec).compute(spec, doc.cutting, settings.unit), settings }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gear'

export function fitView() {
  const { geometry } = current()
  const r = geometry.dims.ra + 4
  useViewportStore.getState().fitToRect({ x: -r, y: -r, width: r * 2, height: r * 2 }, canvasSize.width, canvasSize.height)
}

/** Zoom so 1 mm on screen is 1 mm in real life (using the calibrated px/mm) */
export function actualSize() {
  const { settings } = current()
  const scale = resolveScreenScale(settings.screenCalibrations)
  // Browsers can't report physical screen size; ask unless we recognise the display or it's been set
  if (!scale.confident) {
    useUiStore.getState().setDialog('calibrate')
    return
  }
  useViewportStore.getState().centerOn({ x: 0, y: 0 }, canvasSize.width, canvasSize.height, scale.pxPerMm)
  notify.info(`Actual size, using ${scale.label}. Not right? Settings → Calibrate screen.`)
}

export function newDesign() {
  useDesignStore.getState().load(DEFAULT_DOC)
  requestAnimationFrame(fitView)
}

export function loadDesign(doc: GearDoc) {
  useDesignStore.getState().load(doc)
  designHistory.flush()
  requestAnimationFrame(fitView)
}

export function saveDesign() {
  const { doc } = current()
  const file = { app: 'gear-designer', version: 1, doc }
  downloadBlob(JSON.stringify(file, null, 2), `${slug(doc.name)}.gear.json`, 'application/json')
}

export async function openDesign() {
  const file = await pickTextFile('.json,.gear,application/json')
  if (!file) return
  try {
    const parsed = JSON.parse(file.text)
    const doc = parsed?.doc ?? parsed
    if (typeof doc !== 'object' || doc === null || !Array.isArray(doc.gears)) throw new Error('This doesn’t look like a Gear Designer file.')
    loadDesign(normaliseDoc(doc))
    notify.success(`Opened ${file.name}`)
  } catch (error) {
    notify.error(`Couldn’t open ${file.name}`, error instanceof Error ? error.message : String(error))
  }
}

export function shareUrl(doc: GearDoc = useDesignStore.getState().doc): string {
  const url = new URL(window.location.href)
  url.hash = docToQuery(doc)
  return url.toString()
}

export async function copyShareLink() {
  const url = shareUrl()
  try {
    await navigator.clipboard.writeText(url)
    notify.success('Share link copied to clipboard')
  } catch {
    window.prompt('Copy this link:', url)
  }
}

function warnIfInvalid(): boolean {
  const { geometry } = current()
  if (!geometry.valid) {
    notify.warning('The design has errors, so the export may be missing the outline. Fix the issues listed in the panel first.')
  }
  return geometry.valid
}

/** Just the gear at 1:1 on a tight artboard */
export function exportGearSvg() {
  const { doc, geometry, settings } = current()
  warnIfInvalid()
  const drawing = buildGearDrawing(doc, geometry, { unit: settings.unit, labels: true, construction: settings.print.construction })
  downloadBlob(drawingToSvg(drawing, { title: doc.name }), `${slug(doc.name)}.svg`, 'image/svg+xml')
}

/** Outline, root holes and bore for CAD / CNC / laser, no construction or text */
export function exportDxf() {
  const { doc, geometry, settings } = current()
  warnIfInvalid()
  const drawing = buildGearDrawing(doc, geometry, { unit: settings.unit, labels: false, construction: false })
  downloadBlob(drawingToDxf(drawing, { text: false }), `${slug(doc.name)}.dxf`, 'application/dxf')
}

export function buildCurrentPages() {
  const { doc, geometry, settings } = current()
  return buildPages(doc, geometry, { ...settings.print, unit: settings.unit })
}

export function exportPagePdf() {
  const { doc } = current()
  warnIfInvalid()
  downloadBlob(drawingsToPdf(buildCurrentPages(), { title: doc.name }), `${slug(doc.name)}.pdf`, 'application/pdf')
}

export function printPage() {
  const { doc } = current()
  warnIfInvalid()
  return printDrawings(buildCurrentPages(), doc.name)
}
