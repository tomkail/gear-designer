import { useEffect } from 'react'
import { Notifications, ThemeProvider, useHotkeys } from '@tomkail/workshop-kit'
import { GearCanvas } from './GearCanvas'
import { GearPanel } from './GearPanel'
import { AppToolbar } from './AppToolbar'
import { PrintDialog } from './PrintDialog'
import { CalibrateDialog } from './CalibrateDialog'
import { AboutDialog } from './AboutDialog'
import { designHistory, useDesignStore } from '../stores/designStore'
import { useSettingsStore, useThemeStore, useUiStore } from '../stores/settingsStore'
import { clampTeeth, docFromQuery, docToQuery } from '../model/design'
import { actualSize, exportGearSvg, fitView, loadDesign, openDesign, saveDesign } from '../actions'
import styles from './App.module.css'

/** Load a design from the URL hash on startup, and keep the hash in sync so the URL is always shareable */
function useHashSync() {
  const doc = useDesignStore((s) => s.doc)

  useEffect(() => {
    const fromHash = docFromQuery(window.location.hash.slice(1))
    if (fromHash) {
      loadDesign(fromHash)
      designHistory.clear()
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      window.history.replaceState(null, '', `#${docToQuery(doc)}`)
      document.title = `${doc.name} – Gear Designer`
    }, 250)
    return () => clearTimeout(id)
  }, [doc])
}

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  const dialog = useUiStore((s) => s.dialog)
  const setDialog = useUiStore((s) => s.setDialog)
  const panelOpen = useSettingsStore((s) => s.panelOpen)
  useHashSync()

  const settings = () => useSettingsStore.getState()
  const bumpTeeth = (delta: number) => {
    const { doc, updateGear } = useDesignStore.getState()
    updateGear({ teeth: clampTeeth(doc.gears[0].teeth + delta) })
  }

  useHotkeys({
    'mod+z': designHistory.undo,
    'mod+shift+z': designHistory.redo,
    'mod+y': designHistory.redo,
    'mod+p': () => setDialog('print'),
    'mod+s': saveDesign,
    'mod+o': openDesign,
    'mod+e': exportGearSvg,
    f: fitView,
    '1': actualSize,
    m: () => settings().set({ showMeasurements: !settings().showMeasurements }),
    c: () => settings().set({ showConstruction: !settings().showConstruction }),
    s: () => settings().set({ snap: !settings().snap }),
    u: () => settings().set({ unit: settings().unit === 'mm' ? 'in' : 'mm' }),
    '[': () => bumpTeeth(-1),
    ']': () => bumpTeeth(1),
    '?': () => setDialog('about'),
    escape: () => settings().set({ panelOpen: false }),
  })

  return (
    <ThemeProvider theme={theme}>
      <div className={styles.app}>
        <main className={styles.main}>
          <GearCanvas />
          <GearPanel className={`${styles.panel} ${panelOpen ? styles.panelOpen : ''}`} />
        </main>
        <AppToolbar />
        <Notifications />
        {dialog === 'print' && <PrintDialog />}
        {dialog === 'calibrate' && <CalibrateDialog />}
        {dialog === 'about' && <AboutDialog />}
      </div>
    </ThemeProvider>
  )
}
