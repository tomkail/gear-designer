import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createHistory } from '@tomkail/workshop-kit'
import { DEFAULT_DOC, normaliseDoc, type CuttingSpec, type DocInput, type GearDoc, type GearSpec } from '../model/design'

interface DesignState {
  doc: GearDoc
  /** Merge changes into the document */
  update: (changes: Partial<Omit<GearDoc, 'gears'>>) => void
  /** Merge changes into one gear (the first by default) */
  updateGear: (changes: Partial<GearSpec>, index?: number) => void
  updateBore: (changes: Partial<GearSpec['bore']>, index?: number) => void
  updateCutting: (changes: Partial<CuttingSpec>) => void
  load: (doc: DocInput) => void
}

export const useDesignStore = create<DesignState>()(
  persist(
    (set, get) => {
      const withGear = (index: number, fn: (g: GearSpec) => GearSpec) => {
        const { doc } = get()
        set({ doc: normaliseDoc({ ...doc, gears: doc.gears.map((g, i) => (i === index ? fn(g) : g)) }) })
      }
      return {
        doc: DEFAULT_DOC,
        update: (changes) => set({ doc: normaliseDoc({ ...get().doc, ...changes }) }),
        updateGear: (changes, index = 0) => withGear(index, (g) => ({ ...g, ...changes })),
        updateBore: (changes, index = 0) => withGear(index, (g) => ({ ...g, bore: { ...g.bore, ...changes } })),
        updateCutting: (changes) => set({ doc: normaliseDoc({ ...get().doc, cutting: { ...get().doc.cutting, ...changes } }) }),
        load: (doc) => set({ doc: normaliseDoc(doc) }),
      }
    },
    {
      name: 'gear-designer-design',
      partialize: (state) => ({ doc: state.doc }),
      merge: (persisted, current) => ({ ...current, doc: normaliseDoc((persisted as { doc?: GearDoc })?.doc) }),
    }
  )
)

export const designHistory = createHistory(
  useDesignStore,
  (state) => state.doc,
  (doc) => useDesignStore.setState({ doc })
)
