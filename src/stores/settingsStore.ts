import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createThemeStore, createViewportStore, defaultPaperId, defaultUnit, type LengthUnit, type ScreenCalibration } from '@tomkail/workshop-kit'

export interface PrintSettings {
  paperId: string
  landscape: boolean
  labels: boolean
  construction: boolean
  scaleCheck: boolean
}

interface SettingsState {
  unit: LengthUnit
  showConstruction: boolean
  showMeasurements: boolean
  /** Snap dragged sizes to round modules / DPs */
  snap: boolean
  /** Screen scale for the 1:1 view, per screen signature (see workshop-kit screenScale) */
  screenCalibrations: Record<string, ScreenCalibration>
  print: PrintSettings
  panelOpen: boolean

  set: (changes: Partial<Omit<SettingsState, 'set' | 'setPrint'>>) => void
  setPrint: (changes: Partial<PrintSettings>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      unit: defaultUnit(),
      showConstruction: true,
      showMeasurements: true,
      snap: true,
      screenCalibrations: {},
      print: { paperId: defaultPaperId(), landscape: false, labels: true, construction: true, scaleCheck: true },
      panelOpen: false,
      set: (changes) => set(changes),
      setPrint: (changes) => set({ print: { ...get().print, ...changes } }),
    }),
    {
      name: 'gear-designer-settings',
      partialize: ({ set: _set, setPrint: _setPrint, panelOpen: _panelOpen, ...rest }) => rest,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>
        return { ...current, ...saved, print: { ...current.print, ...saved.print }, screenCalibrations: { ...saved.screenCalibrations } }
      },
    }
  )
)

/** Theme key shared across workshop tools so they follow the same theme */
export const useThemeStore = createThemeStore('workshop-theme')

/** World units are millimetres; zoom is screen px per mm. Not persisted: we fit the gear on load. */
export const useViewportStore = createViewportStore({
  defaultZoom: 3,
  minZoom: 0.2,
  maxZoom: 80,
  fitPaddingRatio: 0.12,
})

export type Dialog = 'print' | 'calibrate' | 'about' | null

interface UiState {
  dialog: Dialog
  /** Index of the gear being edited */
  selected: number
  /** Animating the train */
  playing: boolean
  setDialog: (dialog: Dialog) => void
  select: (index: number) => void
  setPlaying: (playing: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  dialog: null,
  selected: 0,
  playing: false,
  setDialog: (dialog) => set({ dialog }),
  select: (selected) => set({ selected }),
  setPlaying: (playing) => set({ playing }),
}))
