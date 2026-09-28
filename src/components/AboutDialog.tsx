import { Modal, modKey } from '@tomkail/workshop-kit'
import { useUiStore } from '../stores/settingsStore'
import styles from './AboutDialog.module.css'

const SHORTCUTS: [string, string][] = [
  [`${modKey}Z / ${modKey}⇧Z`, 'Undo / redo'],
  [`${modKey}P`, 'Print template'],
  [`${modKey}S / ${modKey}O`, 'Save / open design file'],
  [`${modKey}E`, 'Download SVG'],
  ['[ / ]', 'Fewer / more teeth'],
  ['F', 'Fit to view'],
  ['1', 'Actual size (1:1)'],
  ['M', 'Dimensions'],
  ['C', 'Construction lines'],
  ['S', 'Snapping (hold Shift while dragging for free)'],
  ['U', 'Toggle mm / inches'],
  ['Space + drag, scroll', 'Pan, zoom'],
]

export function AboutDialog() {
  const close = () => useUiStore.getState().setDialog(null)
  return (
    <Modal title="How Gear Designer works" onClose={close} wide>
      <p>
        Gear Designer draws true involute spur gears with woodworking defaults: big teeth, generous clearance and rounded corners. Set the number of teeth and the tooth size, then print a 1:1 template to stick
        on your stock.
      </p>
      <h3>Tooth size</h3>
      <p>
        <strong>Module</strong> is the pitch diameter divided by the number of teeth, in mm. <strong>Diametral pitch</strong> (DP) is the inch version: teeth per inch of pitch diameter. If neither means
        much, look at the <em>tooth spacing</em>: the distance from one tooth to the next along the pitch circle, which you can measure with a ruler. Gears only mesh if their tooth size and pressure angle match.
      </p>
      <h3>Tips from the shop</h3>
      <ul className={styles.list}>
        <li>Drill the root holes <em>first</em>, while the stock is square. Each hole forms a rounded root, and you only have to saw the flanks down to it.</li>
        <li>Back the stock with scrap when drilling, to stop tear-out as the bit exits.</li>
        <li>Stick the template on with spray adhesive, and centre-punch each crosshair before drilling.</li>
        <li>Saw just outside the line, then file and sand to it. The backlash setting gives the teeth a little room for error and for wood movement.</li>
        <li>Short grain across a tooth breaks. Lay the grain along the arrow, or use plywood for small gears.</li>
      </ul>
      <h3>Printing at the right size</h3>
      <p>
        Print at <strong>100% / Actual size</strong> and measure the scale-check rulers before cutting. Gears bigger than the paper are split across several sheets with registration marks. PDF, SVG and DXF
        downloads carry the same dimensions for CAD, laser and CNC.
      </p>
      <h3>Keyboard</h3>
      <dl className={styles.shortcuts}>
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.footer}>
        Part of a family of woodworking tools, with{' '}
        <a href="https://tomkail.github.io/serpentine/" target="_blank" rel="noreferrer">
          Serpentine
        </a>{' '}
        and{' '}
        <a href="https://tomkail.github.io/star-knobs/" target="_blank" rel="noreferrer">
          Star Knobs
        </a>
        .
      </p>
    </Modal>
  )
}
