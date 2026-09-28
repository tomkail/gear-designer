import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createHistory } from '@tomkail/workshop-kit'
import { DEFAULT_DOC, MAX_GEARS, SHARED_KEYS, matingGear, normaliseDoc, type CuttingSpec, type DocInput, type GearDoc, type GearSpec } from '../model/design'

interface DesignState {
  doc: GearDoc
  /** Merge changes into the document */
  update: (changes: Partial<Omit<GearDoc, 'gears'>>) => void
  /** Merge changes into one gear (the first by default) */
  updateGear: (changes: Partial<GearSpec>, index?: number) => void
  updateBore: (changes: Partial<GearSpec['bore']>, index?: number) => void
  updateCutting: (changes: Partial<CuttingSpec>) => void
  /** Add a gear meshing with the first */
  addGear: () => void
  removeGear: (index: number) => void
  /** Swing a meshed gear round the gear it meshes with (degrees) */
  setMeshAngle: (index: number, angle: number) => void
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
        updateGear: (changes, index = 0) => {
          // Meshed gears share tooth size and pressure angle, so edit them on every gear
          const shared = Object.fromEntries(SHARED_KEYS.filter((k) => k in changes).map((k) => [k, changes[k]]))
          const { doc } = get()
          set({ doc: normaliseDoc({ ...doc, gears: doc.gears.map((g, i) => (i === index ? { ...g, ...changes } : { ...g, ...shared })) }) })
        },
        updateBore: (changes, index = 0) => withGear(index, (g) => ({ ...g, bore: { ...g.bore, ...changes } })),
        updateCutting: (changes) => set({ doc: normaliseDoc({ ...get().doc, cutting: { ...get().doc.cutting, ...changes } }) }),
        addGear: () => {
          const { doc } = get()
          if (doc.gears.length >= MAX_GEARS) return
          const id = `g${doc.gears.length + 1}`
          set({ doc: normaliseDoc({ ...doc, gears: [...doc.gears, matingGear(doc.gears[0], id)], links: [...doc.links, { a: doc.gears[0].id, b: id, type: 'mesh', angle: 0 }] }) })
        },
        removeGear: (index) => {
          const { doc } = get()
          if (index === 0 || index >= doc.gears.length) return
          const id = doc.gears[index].id
          set({ doc: normaliseDoc({ ...doc, gears: doc.gears.filter((_, i) => i !== index), links: doc.links.filter((l) => l.a !== id && l.b !== id) }) })
        },
        setMeshAngle: (index, angle) => {
          const { doc } = get()
          const id = doc.gears[index]?.id
          set({ doc: normaliseDoc({ ...doc, links: doc.links.map((l) => (l.b === id ? { ...l, angle } : l)) }) })
        },
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
