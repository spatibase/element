import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { isMacPlatform } from '../../utils/platform'
import type { DialogState } from '@element-editor/core'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Trash, Copy, Check, CopySimple, CaretDown, CaretRight } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { useEmit } from '../../contexts/EventContext'
import { clipboardErrorEvent } from '../../utils/clipboardError'
import { useIsEventForEditor } from '../../hooks/useKeyboardShortcuts'
import DynamicFieldRenderer from '../dialogs/DynamicFieldRenderer'
import { Button } from '../ui/Button'
import { KbdInvert, KbdDark } from '../ui/Kbd'
import { panelHeaderIconBtn } from '../ui/panelHeader'
import { Tooltip } from '../ui/Tooltip'
import { HideLayersToggle } from './HideLayersToggle'
import { SelectInput } from '../ui/Input'
import { JsonCode } from '../ui/JsonCode'
import type { GeoJSONFeature, Schema, SchemaField } from '@element-editor/core'

function validateField(field: SchemaField, val: unknown): string | null {
  if (field.required && (val === undefined || val === null || String(val).trim() === '')) {
    return `${field.label} is required`
  }
  if (field.type === 'number' && val !== undefined && val !== null && String(val).trim() !== '') {
    const num = Number(val)
    if (!isNaN(num)) {
      const hasMin = field.min !== undefined
      const hasMax = field.max !== undefined
      if (hasMin && hasMax && (num < field.min! || num > field.max!)) {
        return `${field.label} must be between ${field.min} and ${field.max}`
      }
      if (hasMin && num < field.min!) return `${field.label} must be ≥ ${field.min}`
      if (hasMax && num > field.max!) return `${field.label} must be ≤ ${field.max}`
    }
  }
  return null
}

function usePanelSection(key: 'coordsOpen' | 'sourceOpen', defaultOpen: boolean) {
  const pref = useUIStore((s) => s.panelPrefs[key])
  const setPanelPref = useUIStore((s) => s.setPanelPref)
  const open = pref !== null ? pref : defaultOpen
  const toggle = () => setPanelPref(key, !open)
  return { open, toggle }
}

function initValues(dialogState: DialogState, schema: Schema, features: GeoJSONFeature[]): Record<string, unknown> {
  if (dialogState.type === 'new-point') {
    const blank: Record<string, unknown> = {}
    schema.fields.forEach((f) => { blank[f.key] = '' })
    if (dialogState.prefill) Object.assign(blank, dialogState.prefill)
    return blank
  }
  if (dialogState.type === 'edit') {
    const feature = features.find((f) => f.id === dialogState.featureId)
    if (feature) return { ...(feature.properties as Record<string, unknown>) }
  }
  return {}
}

/** `collapsible`: show the hide-layers toggle in the header (set when the form replaces the layers list, not in the modal). */
export default function FeatureSidePanel({ dialogState, collapsible = false }: { dialogState: Exclude<DialogState, { type: 'closed' }>; collapsible?: boolean }) {
  const { dataStore } = useGeoStore()
  const emit = useEmit()
  const closeDialog = useUIStore((s) => s.closeDialog)
  const selectFeature = useDataStore((s) => s.selectFeature)
  const schemas = useDataStore(useShallow((s) => s.getVisibleSchemas()))
  const lastUsedSchemaId = useDataStore((s) => s.lastUsedSchemaId)
  const readonly = useUIStore((s) => s.readonly)
  const { uiStore } = useGeoStore()
  const isForThisEditor = useIsEventForEditor()
  
  // Extract only the feature being edited to prevent unnecessary re-renders
  // when unrelated features are added, removed, or updated on the map.
  const features = useDataStore((s) => s.features)
  const editFeature = useMemo(() => 
    dialogState.type === 'edit'
      ? features.find((f) => f.id === dialogState.featureId) ?? null
      : null,
    [dialogState, features]
  )

  const addFeature = useDataStore((s) => s.addFeature)
  const updateFeature = useDataStore((s) => s.updateFeature)
  const deleteFeature = useDataStore((s) => s.deleteFeature)
  const duplicateFeature = useDataStore((s) => s.duplicateFeature)
  const getDefaultSchema = useDataStore((s) => s.getDefaultSchema)
  const setLastUsedSchemaId = useDataStore((s) => s.setLastUsedSchemaId)

  const isNewPoint = dialogState.type === 'new-point'


  const defaultSchema = getDefaultSchema()

  const [schemaId, setSchemaId] = useState<string>(() => {
    if (dialogState.type === 'edit' && editFeature?.schemaId) return editFeature.schemaId
    const lastValid = lastUsedSchemaId && schemas.find((s) => s.id === lastUsedSchemaId)
    return lastValid ? lastUsedSchemaId : defaultSchema.id
  })

  const activeSchema = schemas.find((s) => s.id === schemaId) ?? defaultSchema

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initValues(dialogState, activeSchema, features)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Undo/redo (or any outside edit) replaced the feature's data while the form
  // is open: show the restored values instead of the stale draft.
  const editProps = editFeature?.properties
  const editSchemaId = editFeature?.schemaId
  const [syncedFrom, setSyncedFrom] = useState({ editProps, editSchemaId })
  if (editFeature && (syncedFrom.editProps !== editProps || syncedFrom.editSchemaId !== editSchemaId)) {
    setSyncedFrom({ editProps, editSchemaId })
    setValues({ ...(editProps as Record<string, unknown>) })
    if (editSchemaId) setSchemaId(editSchemaId)
    setErrors({})
  }

  function handleSchemaChange(newSchemaId: string) {
    const newSchema = schemas.find((s) => s.id === newSchemaId) ?? defaultSchema
    if (isNewPoint) {
      const blank: Record<string, unknown> = {}
      newSchema.fields.forEach((f) => { blank[f.key] = values[f.key] ?? '' })
      setValues(blank)
    }
    setSchemaId(newSchemaId)
    setLastUsedSchemaId(newSchemaId)
    setErrors({})
  }

  useEffect(() => {
    if (readonly) return
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isForThisEditor(e)) {
        // Only step aside for the drawing tool when there's an in-progress
        // shape Cmd+Enter would commit — drawing tools now "stay in tool"
        // after commit, so editingMode alone is no longer a reliable signal.
        const us = uiStore.getState()
        const hasDrawingInProgress = us.lineInProgress.length > 0
          || us.polygonInProgress.length > 0
          || us.routeWaypoints.length > 0
          || us.freehandPoints.length > 0
          || us.circleCenter !== null
          || us.rectCorner !== null
        if (hasDrawingInProgress) return
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function handleSave() {
    const newErrors: Record<string, string> = {}
    for (const field of activeSchema.fields) {
      const err = validateField(field, values[field.key])
      if (err) newErrors[field.key] = err
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      // Focus the first field (in schema order) that has an error so the user
      // can correct it without hunting for the inline message.
      const firstErrorKey = activeSchema.fields.find((f) => newErrors[f.key])?.key
      if (firstErrorKey) {
        // setTimeout 0 lets React re-render with error state first, then
        // querySelector finds the matching wrapper in the up-to-date DOM.
        setTimeout(() => {
          const wrapper = document.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(firstErrorKey)}"]`)
          const input = wrapper?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
          input?.focus()
          if (input && 'select' in input) input.select?.()
        }, 0)
      }
      return
    }
    setErrors({})

    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) {
      if (v !== '') properties[k] = v
    }

    if (isNewPoint && dialogState.type === 'new-point') {
      addFeature({
        type: 'Feature',
        id: crypto.randomUUID(),
        schemaId,
        geometry: { type: 'Point', coordinates: dialogState.coords },
        properties,
      })
    } else if (editFeature) {
      updateFeature(editFeature.id, { properties, schemaId })
    }
    closeDialog()
  }

  function handleDuplicate() {
    if (!editFeature) return
    const label = String(editFeature.properties.name || 'feature')
    const id = editFeature.id
    const ok = duplicateFeature(id)
    closeDialog()
    if (ok) emit({ type: 'feature:duplicated', featureId: id, label })
  }

  function handleDelete() {
    if (!editFeature) return
    const name = String(editFeature.properties.name || 'Unnamed feature')
    const id = editFeature.id
    deleteFeature(id)
    closeDialog()
    emit({ type: 'feature:deleted', featureId: id, label: name, undo: () => dataStore.getState().undo() })
  }

  const title = isNewPoint
    ? 'New point'
    : editFeature
      ? String(editFeature.properties.name || 'Edit feature')
      : 'Edit feature'

  const badge = isNewPoint ? 'point'
    : editFeature?.geometry.type === 'MultiPoint' ? 'points'
    : editFeature?.geometry.type === 'LineString' ? 'line'
    : editFeature?.geometry.type === 'MultiLineString' ? 'lines'
    : editFeature?.geometry.type === 'Polygon' ? 'area'
    : editFeature?.geometry.type === 'MultiPolygon' ? 'areas'
    : editFeature?.geometry.type === 'GeometryCollection' ? 'mixed'
    : 'point'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-elm-border flex-shrink-0 bg-elm-surface-sunken">
        {collapsible && <HideLayersToggle />}
        <Tooltip content="Back to layers" side="bottom">
          <button type="button" onClick={() => { closeDialog(); selectFeature(null) }} aria-label="Back to layers" className={`flex ${panelHeaderIconBtn}`}>
            <ArrowLeft size={16} />
          </button>
        </Tooltip>
        <div className="flex-1 min-w-0 mx-1">
          <p className="text-sm leading-5 font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100)) truncate">{title}</p>
          <p className="text-xs leading-4 text-elm-text-subtle capitalize">{badge}</p>
        </div>
        {editFeature && (
          <>
            {!readonly && (
              <Tooltip
                content="Duplicate"
                shortcut={<span className="flex items-center gap-0.5"><KbdDark>⌘</KbdDark><KbdDark>D</KbdDark></span>}
                side="bottom"
              >
                <button type="button" onClick={handleDuplicate} aria-label="Duplicate feature" className={`flex ${panelHeaderIconBtn}`}>
                  <CopySimple size={16} />
                </button>
              </Tooltip>
            )}
            {!readonly && (
              <Tooltip content="Delete feature" side="bottom">
                <button type="button" onClick={handleDelete} aria-label="Delete feature" className={`flex ${panelHeaderIconBtn}`}>
                  <Trash size={16} />
                </button>
              </Tooltip>
            )}
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-4">
        {/* Scroll body: form fields use space-y inside DynamicFieldRenderer;
            collapsible sections (Source / Coordinates) supply their own
            full-width dividers and h-12 rows for uniform vertical rhythm. */}
        {schemas.length > 1 && (
          // mb-3 mirrors the inter-field spacing inside DynamicFieldRenderer
          // (space-y-3) so Schema sits the same distance above Name as Name
          // sits above Description, etc.
          <div className="mb-3">
            <label className="block text-xs font-medium text-(--elm-text-muted,var(--color-gray-600)) dark:text-(--elm-text-muted,var(--color-gray-400)) mb-1">Schema</label>
            <SelectInput
              value={schemaId}
              onChange={(e) => handleSchemaChange(e.target.value)}
              disabled={readonly}
            >
              {schemas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.id === schemas[0]?.id ? ' (default)' : ''}
                </option>
              ))}
            </SelectInput>
          </div>
        )}

        <DynamicFieldRenderer
          fields={activeSchema.fields}
          values={values}
          onChange={(key, value) => {
            setValues((prev) => ({ ...prev, [key]: value }))
            const field = activeSchema.fields.find((f) => f.key === key)
            if (field) {
              const err = validateField(field, value)
              setErrors((prev) => {
                if (err) return { ...prev, [key]: err }
                const next = { ...prev }
                delete next[key]
                return next
              })
            }
          }}
          errors={errors}
          autoFocusFirst={!readonly && (isNewPoint
            || (dialogState.type === 'edit' && !!dialogState.isNew)
            || (dialogState.type === 'edit' && !!dialogState.focusFirstField))}
          readonly={readonly}
        />
        <SourceSection dialogState={dialogState} editFeature={editFeature ?? null} values={values} schemaId={schemaId} />
        <CoordsSection dialogState={dialogState} editFeature={editFeature ?? null} />
        {/* Closing full-width divider after the last collapsible — matches the
            ones between the sections. */}
        <div className="-mx-4 border-t border-elm-border" />
      </div>

      {!readonly && (
        <div className="px-4 py-3 border-t border-elm-border flex-shrink-0">
          <Button variant="primary" onClick={handleSave} className="w-full py-2 rounded-elm font-medium">
            Save
            <span className="ml-auto flex items-center gap-0.5">
              {isMacPlatform()
                ? <><KbdInvert>⌘</KbdInvert><KbdInvert>↵</KbdInvert></>
                : <><KbdInvert>Ctrl</KbdInvert><KbdInvert>↵</KbdInvert></>
              }
            </span>
          </Button>
        </div>
      )}
    </div>
  )
}

function CoordsSection({
  dialogState,
  editFeature,
}: {
  dialogState: Exclude<DialogState, { type: 'closed' }>
  editFeature: GeoJSONFeature | null
}) {
  const lines = useMemo(() => {
    if (dialogState.type === 'new-point') {
      const [lng, lat] = dialogState.coords
      return [`${lat.toFixed(6)}, ${lng.toFixed(6)}`]
    }
    if (!editFeature) return []
    if (editFeature.geometry.type === 'Point') {
      const [lng, lat] = editFeature.geometry.coordinates as [number, number]
      return [`${lat.toFixed(6)}, ${lng.toFixed(6)}`]
    }
    if (editFeature.geometry.type === 'LineString') {
      const coords = editFeature.geometry.coordinates as [number, number][]
      return coords.map(([lng, lat], i) => `${i + 1}.  ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    }
    if (editFeature.geometry.type === 'Polygon') {
      const ring = (editFeature.geometry.coordinates as [number, number][][])[0]
      return ring.slice(0, -1).map(([lng, lat], i) => `${i + 1}.  ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    }
    return []
  }, [dialogState, editFeature])

  const defaultOpen = lines.length <= 5
  const { open, toggle } = usePanelSection('coordsOpen', defaultOpen)

  if (lines.length === 0) return null

  return (
    <CollapsibleSection label="Coordinates" open={open} onToggle={toggle}>
      <div className="space-y-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-xs font-elm-mono text-elm-text-muted">{line}</p>
        ))}
      </div>
    </CollapsibleSection>
  )
}

function SourceSection({
  dialogState,
  editFeature,
  values,
  schemaId,
}: {
  dialogState: Exclude<DialogState, { type: 'closed' }>
  editFeature: GeoJSONFeature | null
  values: Record<string, unknown>
  schemaId: string
}) {
  const source = useMemo(() => {
    if (dialogState.type === 'new-point') {
      const properties: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) {
        if (v !== '') properties[k] = v
      }
      return { type: 'Feature', id: '(new)', schemaId, geometry: { type: 'Point', coordinates: dialogState.coords }, properties }
    }
    return editFeature ?? null
  }, [dialogState, editFeature, values, schemaId])

  const { open, toggle } = usePanelSection('sourceOpen', false)
  const [copied, setCopied] = useState(false)
  const emit = useEmit()

  if (!source) return null

  const json = JSON.stringify(source, null, 2)

  function handleCopy() {
    Promise.resolve().then(() => navigator.clipboard.writeText(json)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, (err) => emit(clipboardErrorEvent(err)))
  }

  const copyButton = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleCopy() }}
      aria-label="Copy source"
      className={`flex items-center justify-center w-6 h-6 rounded-elm-chip hover:bg-elm-surface-hover transition-colors ${
        copied
          ? 'text-emerald-500'
          : 'text-elm-text-disabled hover:text-(--elm-text-secondary,var(--color-gray-500)) dark:hover:text-(--elm-text-secondary,var(--color-gray-300))'
      }`}
    >
      {copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}
    </button>
  )

  return (
    <CollapsibleSection label="Source" open={open} onToggle={toggle} action={copyButton}>
      <JsonCode
        json={json}
        className="text-[11px] font-elm-mono text-(--elm-text-secondary,var(--color-gray-800)) dark:text-(--elm-text-secondary,var(--color-gray-300)) bg-elm-surface-sunken border border-(--elm-border-subtle,var(--color-gray-100)) dark:border-(--elm-border-subtle,var(--color-gray-700)) rounded-elm-card p-2 overflow-x-auto whitespace-pre leading-relaxed"
      />
    </CollapsibleSection>
  )
}

function CollapsibleSection({
  label,
  open,
  onToggle,
  action,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      {/* Full-width divider sits directly above the row — no extra padding so
          spacing above and below each label is symmetric. `-mx-4` extends past
          the body's px-4 horizontal padding. */}
      <div className="-mx-4 border-t border-elm-border" />
      {/* h-12 gives every section header equal padding above and below the
          label regardless of whether the right-hand action slot is filled
          (Coordinates has none, Source has the copy-source button). */}
      <div className="flex items-center h-12">
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-elm-text-subtle hover:text-(--elm-text-secondary,var(--color-gray-600)) dark:hover:text-(--elm-text-secondary,var(--color-gray-300)) hover:bg-elm-surface-hover rounded-elm-control -ml-2 pl-2 transition-colors flex-1 text-left h-full"
          onClick={onToggle}
        >
          <span className="text-elm-text-subtle flex-shrink-0">
            {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
          </span>
          {label}
        </button>
        {action}
      </div>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}
