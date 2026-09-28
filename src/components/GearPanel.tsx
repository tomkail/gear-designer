import { useMemo, type ReactNode } from 'react'
import {
  Callout,
  Field,
  NumberField,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  Segmented,
  Select,
  Stat,
  bitsFor,
  formatLength,
  isStandardBit,
  nearestBit,
  parseLength,
  type LengthUnit,
} from '@tomkail/workshop-kit'
import { useDesignStore } from '../stores/designStore'
import { useSettingsStore, useUiStore } from '../stores/settingsStore'
import { BLADES, MAX_GEARS, MAX_MODULE, MAX_TEETH, MIN_MODULE, MIN_TEETH, TOOTH_SIZES, moduleToDp, parseToothSize, type BoreType, type GearSpec, type RootMode } from '../model/design'
import { autoProfileShift } from '../model/gear'
import { computeDoc, gearLetter } from '../model/train'
import { bitSize, docSpecLines, len } from '../model/template'
import { addMatingGear, removeGear } from '../actions'
import styles from './GearPanel.module.css'

interface LengthFieldProps {
  id: string
  label: ReactNode
  value: number
  onChange: (mm: number) => void
  unit: LengthUnit
  min?: number
  max?: number
  sliderMax?: number
  hint?: ReactNode
  /** Offer standard drill bits */
  bits?: boolean
  invalid?: boolean
}

function LengthField({ id, label, value, onChange, unit, min = 0, max = 500, sliderMax, hint, bits, invalid }: LengthFieldProps) {
  const format = (mm: number) => formatLength(mm, unit, { withUnit: false, mmDecimals: 2, inDecimals: 3 })
  const parse = (text: string) => parseLength(text, unit)
  const standard = bits ? isStandardBit(value) : null
  const nearest = bits ? nearestBit(value, unit) : null
  const bitOptions = bits ? bitsFor(unit).map((b) => ({ value: String(b.diameter), label: b.label })) : []

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={
        <>
          {hint}
          {bits && <span className={standard ? styles.ok : styles.muted}>{standard ? `✓ standard ${standard.label} bit` : `Not a standard size – nearest ${nearest!.label}`}</span>}
        </>
      }
    >
      <div className={styles.lengthRow}>
        <NumberField
          id={id}
          value={value}
          onChange={onChange}
          format={format}
          parse={parse}
          min={min}
          max={max}
          step={unit === 'mm' ? 0.1 : 25.4 / 64}
          slider={sliderMax !== undefined}
          sliderMin={min}
          sliderMax={sliderMax}
          suffix={unit === 'mm' ? 'mm' : 'in'}
          invalid={invalid}
        />
        {bits && (
          <div className={styles.bitSelect}>
            <Select value={standard && standard.system === unit ? String(standard.diameter) : ''} options={[{ value: '', label: 'Bits…' }, ...bitOptions]} onChange={(v) => v && onChange(parseFloat(v))} />
          </div>
        )}
      </div>
    </Field>
  )
}

const r2 = (v: number) => String(Math.round(v * 100) / 100)

export function GearPanel({ className }: { className?: string }) {
  const doc = useDesignStore((s) => s.doc)
  const update = useDesignStore((s) => s.update)
  const updateGear = useDesignStore((s) => s.updateGear)
  const updateBore = useDesignStore((s) => s.updateBore)
  const updateCutting = useDesignStore((s) => s.updateCutting)
  const unit = useSettingsStore((s) => s.unit)
  const setSettings = useSettingsStore((s) => s.set)
  const selected = Math.min(useUiStore((s) => s.selected), doc.gears.length - 1)
  const select = useUiStore((s) => s.select)

  const geo = useMemo(() => computeDoc(doc, unit), [doc, unit])
  const spec = doc.gears[selected]
  const g = geo.gears[selected]
  const pair = doc.gears.length > 1
  const mesh = geo.meshes[0]
  const issues = [...g.issues, ...geo.meshes.flatMap((m) => m.issues)]
  const errorCodes = new Set(issues.filter((i) => i.level !== 'info').map((i) => i.code))
  const set = (changes: Partial<GearSpec>) => updateGear(changes, selected)
  const setBore = (changes: Partial<GearSpec['bore']>) => updateBore(changes, selected)
  const m = spec.module
  const inch = unit === 'in'

  const suggestedShift = autoProfileShift(spec)
  const blade = BLADES.find((b) => Math.abs(b.value - doc.cutting.toolRadius) < 1e-6)

  return (
    <Panel className={className}>
      <PanelHeader title={pair ? 'Gear pair' : 'Spur gear'}>
        <Segmented<LengthUnit>
          value={unit}
          onChange={(u) => setSettings({ unit: u })}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'in', label: 'in' },
          ]}
        />
      </PanelHeader>
      <PanelBody>
        <PanelSection>
          <input className={styles.name} value={doc.name} onChange={(e) => update({ name: e.target.value })} aria-label="Design name" placeholder="Name this gear" />
          {pair ? (
            <div className={styles.gearRow}>
              <Segmented<number> value={selected} onChange={select} options={doc.gears.map((gear, i) => ({ value: i, label: `${gearLetter(i)} · ${gear.teeth} teeth`, title: i === 0 ? 'The driving gear' : 'Driven gear' }))} />
              {selected > 0 && (
                <button className={styles.link} onClick={() => removeGear(selected)}>
                  Remove {gearLetter(selected)}
                </button>
              )}
            </div>
          ) : (
            doc.gears.length < MAX_GEARS && (
              <button className={styles.addGear} onClick={addMatingGear}>
                + Add a mating gear
              </button>
            )
          )}
        </PanelSection>

        {pair && mesh && (
          <PanelSection title="Pair">
            <Stat label="Ratio" value={`1 : ${r2(mesh.ratio)}`} />
            <p className={styles.explain}>
              {mesh.ratio === 1
                ? 'Both gears turn at the same speed, in opposite directions.'
                : mesh.ratio > 1
                  ? `A turns ${r2(mesh.ratio)} times for each turn of B. B turns slower, with more force.`
                  : `B turns ${r2(1 / mesh.ratio)} times for each turn of A. B turns faster, with less force.`}
            </p>
            <Stat label="Axle spacing" value={len(mesh.centreDistance, unit)} />
            {Math.abs(mesh.centreDistance - mesh.standardDistance) > 1e-6 && <Stat label="Without profile shift" value={len(mesh.standardDistance, unit)} />}
            <Stat label="Contact ratio" value={mesh.contactRatio.toFixed(2)} tone={mesh.contactRatio < 1.2 ? 'danger' : mesh.contactRatio < 1.4 ? 'warning' : undefined} />
            <Stat label="Play between teeth" value={len(mesh.backlash, unit)} />
            <Stat label="Tip clearance" value={len(mesh.tipClearance, unit)} tone={mesh.tipClearance < 0.1 * spec.module ? 'warning' : undefined} />
            {Math.abs(mesh.workingAngle / (Math.PI / 180) - spec.pressureAngle) > 0.01 && <Stat label="Working pressure angle" value={`${r2(mesh.workingAngle / (Math.PI / 180))}°`} />}
            <Field label="A turns at" htmlFor="rpm" hint={`B turns at ${r2(doc.driverRpm / mesh.ratio)} RPM, the opposite way. Press P to play.`}>
              <NumberField id="rpm" value={doc.driverRpm} onChange={(v) => update({ driverRpm: v })} min={-600} max={600} step={1} suffix="RPM" format={r2} />
            </Field>
            <Field label="B sits at" htmlFor="meshAngle" hint="Direction from A to B. Or drag B’s centre round A on the canvas.">
              <NumberField id="meshAngle" value={mesh.angle} onChange={(v) => useDesignStore.getState().setMeshAngle(mesh.b, v)} min={-180} max={180} step={15} suffix="°" format={r2} />
            </Field>
          </PanelSection>
        )}

        <PanelSection title={pair ? `Gear ${gearLetter(selected)}` : 'Teeth'}>
          <Field label="Number of teeth" htmlFor="teeth">
            <NumberField id="teeth" value={spec.teeth} onChange={(n) => set({ teeth: n })} min={MIN_TEETH} max={MAX_TEETH} step={1} slider sliderMax={80} format={(v) => String(Math.round(v))} />
          </Field>
          <Field
            label="Tooth size"
            htmlFor="size"
            hint={
              <>
                {pair ? 'Shared by both gears. ' : ''}
                {inch ? `Module ${r2(m)}` : `${r2(moduleToDp(m))} DP`} · teeth {len(g.stats.circularPitch, 'mm')} ({len(g.stats.circularPitch, 'in')}) apart on the pitch circle. Type “m4” or “6dp” to use either.
              </>
            }
          >
            <div className={styles.lengthRow}>
              <NumberField
                id="size"
                value={m}
                onChange={(v) => set({ module: v })}
                format={(v) => r2(inch ? moduleToDp(v) : v)}
                parse={(text) => parseToothSize(text, inch ? 'dp' : 'module')}
                min={MIN_MODULE}
                max={MAX_MODULE}
                step={0.25}
                suffix={inch ? 'DP' : 'module'}
                invalid={errorCodes.has('small-teeth')}
              />
              <div className={styles.bitSelect}>
                <Select
                  value={TOOTH_SIZES.find((t) => Math.abs(t.value - m) < 1e-6)?.id ?? ''}
                  options={[{ value: '', label: 'Sizes…' }, ...TOOTH_SIZES.map((t) => ({ value: t.id, label: t.label }))]}
                  onChange={(id) => {
                    const size = TOOTH_SIZES.find((t) => t.id === id)
                    if (size) set({ module: size.value })
                  }}
                />
              </div>
            </div>
          </Field>
          <Field label="Pressure angle" hint="25° gives stronger, stubbier teeth and works with fewer teeth.">
            <Segmented<number>
              value={spec.pressureAngle}
              onChange={(pressureAngle) => set({ pressureAngle })}
              options={[
                { value: 20, label: '20°' },
                { value: 25, label: '25°' },
              ]}
            />
          </Field>
          <Field
            label="Profile shift"
            htmlFor="shift"
            hint={
              <>
                {suggestedShift.needed === 0
                  ? 'Not needed at this tooth count'
                  : suggestedShift.capped
                    ? `${r2(suggestedShift.needed)} would avoid undercut, but the tips would be too narrow. ${r2(suggestedShift.value)} is the most they allow`
                    : `${r2(suggestedShift.value)} avoids undercut at ${spec.teeth} teeth`}{' '}
                ·{' '}
                <button className={styles.link} onClick={() => set({ profileShift: suggestedShift.value })}>
                  auto
                </button>
              </>
            }
          >
            <NumberField id="shift" value={spec.profileShift} onChange={(v) => set({ profileShift: v })} min={-0.5} max={1} step={0.05} format={r2} invalid={errorCodes.has('undercut') || errorCodes.has('tip-narrow')} />
          </Field>
          <LengthField
            id="backlash"
            label="Backlash"
            value={spec.backlash}
            onChange={(v) => set({ backlash: v })}
            unit={unit}
            min={0}
            max={m}
            hint={`Each tooth is thinned by this much (${r2(spec.backlash / m)} × module). A pair’s play is the sum.`}
          />
        </PanelSection>

        <PanelSection title="Roots & tips">
          <Segmented<RootMode>
            value={spec.root}
            onChange={(root) => set({ root })}
            options={[
              { value: 'drill', label: 'Drill the roots', title: 'A drilled hole forms each tooth root' },
              { value: 'fillet', label: 'Fillet', title: 'Rounded corners and a flat root, cut or filed' },
            ]}
          />
          {spec.root === 'drill' ? (
            <>
              <p className={styles.explain}>Drill every gap while the stock is square, then saw each flank down to its hole. The hole forms the rounded root.</p>
              <Field label="Root bit" hint={g.drill ? `${g.drill.auto ? 'Best standard bit: ' : ''}${bitSize(g.drill.diameter, unit)}, reaching ${len(g.stats.rootDiameter / 2 - g.dims.rf, unit)} past the root circle` : undefined}>
                <Select
                  value={spec.drillDiameter > 0 ? String(spec.drillDiameter) : ''}
                  options={[{ value: '', label: 'Auto (best fit)' }, ...bitsFor(unit).filter((b) => b.diameter <= 4 * m).map((b) => ({ value: String(b.diameter), label: b.label }))]}
                  onChange={(v) => set({ drillDiameter: v ? parseFloat(v) : 0 })}
                />
              </Field>
            </>
          ) : (
            <Field label="Root fillet" htmlFor="fillet" hint={g.stats.rootFillet !== null ? `${len(g.stats.rootFillet, unit)} radius` : undefined}>
              <NumberField id="fillet" value={spec.rootFillet} onChange={(v) => set({ rootFillet: v })} min={0} max={1} step={0.02} format={r2} suffix="× m" invalid={errorCodes.has('blade-radius')} />
            </Field>
          )}
          <Field label="Tip rounding" htmlFor="tip" hint={`${len(g.stats.tipRound, unit)} radius`}>
            <NumberField id="tip" value={spec.tipRound} onChange={(v) => set({ tipRound: v })} min={0} max={1} step={0.02} format={r2} suffix="× m" />
          </Field>
        </PanelSection>

        <PanelSection title="Bore">
          <Segmented<BoreType>
            value={spec.bore.type}
            onChange={(type) => setBore({ type })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'round', label: 'Hole' },
              { value: 'flat', label: 'D-flat', title: 'Round hole with a flat, for a D-shaft' },
              { value: 'key', label: 'Keyway' },
            ]}
          />
          {spec.bore.type !== 'none' && <LengthField id="boreD" label="Bore Ø" value={spec.bore.diameter} onChange={(v) => setBore({ diameter: v })} unit={unit} min={0} bits invalid={errorCodes.has('bore') || errorCodes.has('bore-wall')} />}
          {spec.bore.type === 'flat' && (
            <LengthField id="flat" label="Across the flat" value={spec.bore.flatAcross} onChange={(v) => setBore({ flatAcross: v })} unit={unit} min={0} hint="From the flat to the far side of the hole" />
          )}
          {spec.bore.type === 'key' && (
            <>
              <LengthField id="keyW" label="Keyway width" value={spec.bore.keyWidth} onChange={(v) => setBore({ keyWidth: v })} unit={unit} min={0} />
              <LengthField id="keyD" label="Keyway depth" value={spec.bore.keyDepth} onChange={(v) => setBore({ keyDepth: v })} unit={unit} min={0} hint="How far it cuts beyond the bore" />
            </>
          )}
        </PanelSection>

        <PanelSection title="Cutting">
          <Field label="Saw" hint="The tightest inside curve the blade can turn. Typical figures; check your own blade.">
            <Select
              value={blade?.id ?? ''}
              options={[...(blade ? [] : [{ value: '', label: 'Custom' }]), ...BLADES.map((b) => ({ value: b.id, label: b.label }))]}
              onChange={(id) => {
                const b = BLADES.find((x) => x.id === id)
                if (b) updateCutting({ toolRadius: b.value })
              }}
            />
          </Field>
          <LengthField id="blade" label="Smallest turning radius" value={doc.cutting.toolRadius} onChange={(v) => updateCutting({ toolRadius: v })} unit={unit} min={0} />
        </PanelSection>

        <PanelSection title={issues.length ? 'Checks' : 'Checks ✓'}>
          {issues.length === 0 && <p className={styles.explain}>No problems found.</p>}
          {issues.map((issue) => (
            <Callout key={issue.code} tone={issue.level === 'error' ? 'danger' : issue.level === 'warning' ? 'warning' : 'info'}>
              {issue.message}
            </Callout>
          ))}
        </PanelSection>

        <PanelSection title={pair ? `Measurements · ${gearLetter(selected)}` : 'Measurements'}>
          <Stat label="Pitch Ø" value={len(g.stats.pitchDiameter, unit)} />
          <Stat label="Outside Ø" value={len(g.stats.outsideDiameter, unit)} />
          <Stat label="Root Ø" value={len(g.stats.rootDiameter, unit)} />
          <Stat label="Base Ø" value={len(g.stats.baseDiameter, unit)} />
          <Stat label="Tooth spacing" value={`${len(g.stats.circularPitch, 'mm')} · ${len(g.stats.circularPitch, 'in')}`} />
          <Stat label="Tooth thickness" value={len(g.stats.toothThickness, unit)} />
          <Stat label="Tip width" value={len(g.stats.tipLand, unit)} tone={g.stats.tipLand < 0.25 * m ? 'warning' : undefined} />
          <Stat label="Tooth depth" value={len(g.stats.wholeDepth, unit)} />
          <Stat label="Tip clearance" value={len(g.stats.clearance, unit)} tone={g.stats.clearance < 0.15 * m ? 'warning' : undefined} />
          {g.stats.boreWall !== null && <Stat label="Wall to bore" value={len(g.stats.boreWall, unit)} tone={g.stats.boreWall < 2 * m ? 'warning' : undefined} />}
          {g.drill && <Stat label="Root hole step-off" value={len(g.drill.stepOff, unit)} />}
          <Stat label="Undercut below" value={`${Math.ceil(g.stats.zMin)} teeth`} />
        </PanelSection>

        <PanelSection title="Template notes">
          <ul className={styles.spec}>
            {docSpecLines(geo, unit).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </PanelSection>
      </PanelBody>
    </Panel>
  )
}
