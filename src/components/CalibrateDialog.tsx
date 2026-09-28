import { useState } from 'react'
import {
  APPLE_DISPLAYS,
  Button,
  Callout,
  Field,
  Modal,
  NOMINAL_PX_PER_MM,
  NumberField,
  Select,
  formatLength,
  parseLength,
  pxPerMmFromDiagonal,
  resolveScreenScale,
  type ScreenCalibration,
} from '@tomkail/workshop-kit'
import { useSettingsStore, useUiStore } from '../stores/settingsStore'
import { actualSize } from '../actions'
import styles from './CalibrateDialog.module.css'

// ISO/IEC 7810 ID-1: every bank card, ID card and most gift cards
const CARD = { width: 85.6, height: 53.98, radius: 3.18 }
const COMMON_DIAGONALS = [13.3, 14, 15.6, 16, 24, 27, 32]

const SOURCE_TEXT: Record<ScreenCalibration['source'], string> = {
  measured: 'measured with a ruler',
  model: 'from the display you picked',
  diagonal: 'from the screen size you entered',
  detected: 'recognised automatically',
  estimate: 'a guess – please check',
}

export function CalibrateDialog() {
  const unit = useSettingsStore((s) => s.unit)
  const calibrations = useSettingsStore((s) => s.screenCalibrations)
  const set = useSettingsStore((s) => s.set)
  const scale = resolveScreenScale(calibrations)
  const { info, matches } = scale
  const [diagonal, setDiagonal] = useState(27)
  const [measured, setMeasured] = useState('')
  const [error, setError] = useState<string | null>(null)
  const close = () => useUiStore.getState().setDialog(null)

  const save = (calibration: ScreenCalibration) => set({ screenCalibrations: { ...calibrations, [info.signature]: calibration } })
  const reset = () => {
    const { [info.signature]: _removed, ...rest } = calibrations
    set({ screenCalibrations: rest })
  }

  const pxPerMm = scale.pxPerMm
  const matchedIds = new Set(matches.map((m) => m.model.id))
  const selected = scale.source === 'diagonal' ? 'other' : scale.modelId ?? ''
  const [showOther, setShowOther] = useState(selected === 'other' || (matches.length === 0 && !info.isMac))

  const pickDisplay = (id: string) => {
    if (id === 'other') {
      setShowOther(true)
      return
    }
    setShowOther(false)
    const model = APPLE_DISPLAYS.find((m) => m.id === id)
    if (model) save({ pxPerMm: info.width / model.widthMm, source: 'model', label: model.name, modelId: model.id })
  }

  const applyDiagonal = (inches: number) => {
    setDiagonal(inches)
    save({ pxPerMm: pxPerMmFromDiagonal(inches, info), source: 'diagonal', label: `${inches}″ screen` })
  }

  // Longest round length that fits on screen at the current scale
  const barMm = [100, 50, 25].find((mm) => mm * pxPerMm < Math.min(window.innerWidth - 96, 820)) ?? 25

  const applyMeasurement = () => {
    const mm = parseLength(measured, unit)
    if (mm === null || mm <= 0) return setError('Type the length you measured, e.g. 76 or 3"')
    const ratio = mm / barMm
    if (ratio < 0.3 || ratio > 3) return setError('That’s a long way off; check you measured the bar end to end.')
    save({ pxPerMm: pxPerMm * ratio, source: 'measured', label: 'Measured with a ruler' })
    setMeasured('')
    setError(null)
  }

  const done = () => {
    // Confirming a guess counts as calibrating this screen
    if (!calibrations[info.signature]) save({ pxPerMm, source: scale.source === 'estimate' ? 'measured' : 'model', label: scale.label, modelId: scale.modelId })
    close()
    requestAnimationFrame(actualSize)
  }

  const displayOptions = [
    { value: '', label: 'Choose your display…' },
    ...matches.map((m) => ({ value: m.model.id, label: `${m.model.name}${m.isDefault ? ' ✓ matches' : ' (matches a scaled mode)'}` })),
    ...APPLE_DISPLAYS.filter((m) => !matchedIds.has(m.id)).map((m) => ({ value: m.id, label: m.name })),
    { value: 'other', label: 'Other screen – enter its size' },
  ]

  return (
    <Modal
      title="Screen size for 1:1"
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={reset} disabled={!calibrations[info.signature]}>
            Forget this screen
          </Button>
          <Button variant="primary" onClick={done}>
            Show 1:1
          </Button>
        </>
      }
    >
      <div className={styles.status}>
        <div>
          <div className={styles.statusLabel}>This screen</div>
          <div className={styles.statusValue}>
            {info.width} × {info.height} at {info.dpr}×
          </div>
        </div>
        <div>
          <div className={styles.statusLabel}>Using</div>
          <div className={styles.statusValue}>
            {scale.label} · {Math.round(pxPerMm * 25.4)} px/inch
          </div>
          <div className={styles.statusSource}>{SOURCE_TEXT[scale.source]}</div>
        </div>
      </div>

      {info.zoomed && <Callout tone="warning">Browser zoom seems to be set above or below 100%. Reset it (⌘0 / Ctrl+0) or 1:1 will be off.</Callout>}

      <p className={styles.text}>
        Browsers can’t report how big a screen physically is, so Gear Designer recognises Apple displays from their resolution, or works it out from the size you enter. It’s remembered per screen. This only
        affects the on-screen view; prints and exports are always exact.
      </p>

      <h3 className={styles.heading}>1. Which screen is this?</h3>
      <Field label="Display" htmlFor="display">
        <Select id="display" value={showOther ? 'other' : selected} options={displayOptions} onChange={pickDisplay} />
      </Field>
      {showOther && (
        <Field label="Diagonal" htmlFor="diagonal" hint="The advertised size, e.g. a 27-inch monitor">
          <div className={styles.diagonalRow}>
            <NumberField id="diagonal" value={diagonal} onChange={applyDiagonal} min={7} max={100} step={0.1} suffix="″" format={(v) => String(Math.round(v * 10) / 10)} />
            {COMMON_DIAGONALS.map((d) => (
              <button key={d} className={`${styles.chip} ${d === diagonal && scale.source === 'diagonal' ? styles.chipActive : ''}`} onClick={() => applyDiagonal(d)}>
                {d}″
              </button>
            ))}
          </div>
        </Field>
      )}

      <h3 className={styles.heading}>2. Check it with a ruler (optional)</h3>
      <div className={styles.barStage}>
        <div className={styles.bar} style={{ width: barMm * pxPerMm }}>
          <span className={styles.barEnd} />
          <span className={styles.barEnd} />
        </div>
        <div className={styles.barLabel}>Should be {formatLength(barMm, 'mm', { mmDecimals: 0 })}</div>
      </div>
      <div className={styles.measureRow}>
        <label htmlFor="measured">If not, it actually measures</label>
        <input
          id="measured"
          className={styles.measureInput}
          value={measured}
          inputMode="decimal"
          placeholder={unit === 'mm' ? 'mm' : 'inches'}
          onChange={(e) => {
            setMeasured(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && applyMeasurement()}
        />
        <Button onClick={applyMeasurement}>Apply</Button>
        {error && <span className={styles.error}>{error}</span>}
      </div>

      <details className={styles.details}>
        <summary>No ruler? Match a bank card instead</summary>
        <p className={styles.text}>Hold any bank or ID card against the screen and drag the slider until the outline matches.</p>
        <div className={styles.stage}>
          <div className={styles.card} style={{ width: CARD.width * pxPerMm, height: CARD.height * pxPerMm, borderRadius: CARD.radius * pxPerMm }}>
            <span>85.6 × 54 mm</span>
          </div>
        </div>
        <input
          type="range"
          className={styles.slider}
          min={NOMINAL_PX_PER_MM * 0.6}
          max={NOMINAL_PX_PER_MM * 2.2}
          step={0.001}
          value={pxPerMm}
          onChange={(e) => save({ pxPerMm: parseFloat(e.target.value), source: 'measured', label: 'Matched to a card' })}
          aria-label="Screen scale"
        />
      </details>
    </Modal>
  )
}
