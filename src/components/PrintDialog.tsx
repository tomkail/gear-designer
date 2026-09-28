import { useMemo } from 'react'
import { Callout, PrintDialog as KitPrintDialog, Switch } from '@tomkail/workshop-kit'
import { useDesignStore } from '../stores/designStore'
import { useSettingsStore, useUiStore } from '../stores/settingsStore'
import { computeDoc } from '../model/train'
import { buildPages } from '../model/template'

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gear'

export function PrintDialog() {
  const doc = useDesignStore((s) => s.doc)
  const unit = useSettingsStore((s) => s.unit)
  const print = useSettingsStore((s) => s.print)
  const setPrint = useSettingsStore((s) => s.setPrint)

  const geometry = useMemo(() => computeDoc(doc, unit), [doc, unit])
  const pages = useMemo(() => buildPages(doc, geometry, { ...print, unit }), [doc, geometry, print, unit])

  return (
    <KitPrintDialog
      title="Print template"
      pages={pages}
      options={print}
      onChange={setPrint}
      onClose={() => useUiStore.getState().setDialog(null)}
      filename={slug(doc.name)}
      documentTitle={doc.name}
      physical
      labelsLabel="Spec & cutting order"
      notices={
        <>
          {!geometry.valid && <Callout tone="danger">The design has errors. Fix them in the panel before you cut.</Callout>}
          {pages.length > 1 && <Callout tone="info">The template is bigger than one sheet, so it’s split across {pages.length} pages. Line them up on the registration marks and tape along the dashed lines.</Callout>}
        </>
      }
    >
      <Switch checked={print.construction} onChange={(construction) => setPrint({ construction })} label="Pitch and base circles" />
    </KitPrintDialog>
  )
}
