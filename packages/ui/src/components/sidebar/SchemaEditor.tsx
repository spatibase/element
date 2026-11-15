import { useState, useRef, useEffect, forwardRef, type RefObject } from 'react'
import { clsx } from 'clsx'
import { X, CaretDown, CaretUp, Plus, Trash } from '@phosphor-icons/react'
import { useDataStore } from '../../store/StoreContext'
import { useShallow } from 'zustand/react/shallow'
import { uniqueKey, FIELD_TYPES } from '@element-editor/core/internal'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { Input, SelectInput } from '../ui/Input'
import { ContextMenu } from '../ui/ContextMenu'
import type { SchemaField, Schema, FieldType } from '@element-editor/core'

function SchemaFieldRow({
  field,
  existingKeys,
  onUpdate,
  onDelete,
  isProtected,
}: {
  field: SchemaField
  existingKeys: Set<string>
  onUpdate: (updates: Partial<SchemaField>) => void
  onDelete: () => void
  isProtected: boolean
}) {
  const [showOptions, setShowOptions] = useState(false)
  const [newOption, setNewOption] = useState('')
  const [draftLabel, setDraftLabel] = useState(field.label)
  // Resync after undo/redo changes the label underneath us.
  useEffect(() => setDraftLabel(field.label), [field.label])

  function handleLabelBlur() {
    if (draftLabel === field.label) return
    const newKey = isProtected ? field.key : uniqueKey(draftLabel, existingKeys)
    onUpdate({ label: draftLabel, key: newKey })
  }

  function addOption() {
    const trimmed = newOption.trim()
    if (!trimmed) return
    const existing = field.options ?? []
    if (existing.includes(trimmed)) return
    onUpdate({ options: [...existing, trimmed] })
    setNewOption('')
  }

  function removeOption(opt: string) {
    onUpdate({ options: (field.options ?? []).filter((o) => o !== opt) })
  }

  return (
    <div className="bg-elm-surface-raised border border-elm-border rounded-elm-card p-3 space-y-2">
      {/* Key + delete */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-elm-text-subtle">
          key: <code className="font-elm-mono text-elm-text-muted">{field.key}</code>
        </p>
        <Tooltip content={isProtected ? 'Required field — cannot be removed' : 'Remove field'}>
          <button
            onClick={onDelete}
            disabled={isProtected}
            className="flex-shrink-0 text-elm-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors p-1 rounded-elm-chip hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700))"
            aria-label={isProtected ? 'Cannot remove required field' : 'Remove field'}
          >
            <X size={14} />
          </button>
        </Tooltip>
      </div>

      <Input
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        onBlur={handleLabelBlur}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder="Field label"
        className="w-full text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-200))"
      />

      <SelectInput
        value={field.type}
        onChange={(e) => {
          const t = e.target.value as FieldType
          onUpdate({ type: t, options: t === 'select' ? (field.options ?? []) : undefined })
          setShowOptions(t === 'select')
        }}
        className="w-full text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-200))"
      >
        {FIELD_TYPES.map((ft) => (
          <option key={ft.value} value={ft.value}>{ft.label}</option>
        ))}
      </SelectInput>

      <label className="flex items-center gap-1.5 text-xs text-elm-text-muted cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onUpdate({ required: e.target.checked })}
          className="elm-checkbox"
        />
        Required
      </label>

      {field.type === 'number' && (
        <div className="flex items-center gap-2 pt-1 border-t border-(--elm-border-subtle,var(--color-gray-100)) dark:border-(--elm-border-subtle,var(--color-gray-700))">
          <label className="flex items-center gap-1.5 text-xs text-elm-text-muted w-1/2">
            Min
            <Input
              type="number"
              value={field.min ?? ''}
              onChange={(e) => onUpdate({ min: e.target.value ? parseFloat(e.target.value) : undefined })}
              className="flex-1 w-full min-w-0"
              placeholder="Any"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-elm-text-muted w-1/2">
            Max
            <Input
              type="number"
              value={field.max ?? ''}
              onChange={(e) => onUpdate({ max: e.target.value ? parseFloat(e.target.value) : undefined })}
              className="flex-1 w-full min-w-0"
              placeholder="Any"
            />
          </label>
        </div>
      )}

      {field.type === 'select' && (
        <div className="space-y-1.5 pt-1 border-t border-(--elm-border-subtle,var(--color-gray-100)) dark:border-(--elm-border-subtle,var(--color-gray-700))">
          <button
            onClick={() => setShowOptions((v) => !v)}
            className="text-xs text-primary-500 hover:text-primary-700 hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) rounded-elm-chip px-1 -mx-1 py-0.5 flex items-center gap-1 transition-colors"
          >
            {showOptions ? <CaretUp size={11} /> : <CaretDown size={11} />}
            {showOptions ? 'Hide options' : `Options (${(field.options ?? []).length})`}
          </button>
          {showOptions && (
            <div className="space-y-1">
              {(field.options ?? []).map((opt) => (
                <div key={opt} className="flex items-center gap-1.5">
                  <span className="flex-1 text-xs text-elm-text-secondary bg-(--elm-surface-sunken,var(--color-gray-50)) dark:bg-(--elm-surface-sunken,var(--color-gray-700)) border border-(--elm-border,var(--color-gray-200)) dark:border-(--elm-border,var(--color-gray-600)) rounded-elm-chip px-2 py-1 truncate">{opt}</span>
                  <button onClick={() => removeOption(opt)} className="text-elm-text hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) transition-colors p-0.5 rounded-elm-chip" aria-label={`Remove "${opt}" option`}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 pt-1">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addOption()}
                  placeholder="New option…"
                  className="flex-1 min-w-0 text-xs text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-200))"
                />
                <Button variant="secondary" size="sm" onClick={addOption}>Add</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const SchemaNameInput = forwardRef<HTMLInputElement, { schema: Schema; onRename: (name: string) => void }>(
  function SchemaNameInput({ schema, onRename }, ref) {
    const [draft, setDraft] = useState(schema.name)
    useEffect(() => setDraft(schema.name), [schema.name])

    function handleBlur() {
      const trimmed = draft.trim()
      if (!trimmed) { setDraft(schema.name); return }
      if (trimmed !== schema.name) onRename(trimmed)
    }

    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-full text-sm font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100)) bg-transparent border-b border-transparent hover:border-(--elm-border-strong,var(--color-gray-300)) dark:hover:border-(--elm-border-strong,var(--color-gray-600)) focus-visible:border-elm-focus-ring focus:outline-none px-0 py-0 leading-snug"
      />
    )
  }
)

export default function SchemaEditor({ containerRef }: { containerRef?: RefObject<HTMLDivElement | null> }) {
  const schemas = useDataStore(useShallow((s) => s.getVisibleSchemas()))
  const addSchema = useDataStore((s) => s.addSchema)
  const updateSchema = useDataStore((s) => s.updateSchema)
  const deleteSchema = useDataStore((s) => s.deleteSchema)
  const addSchemaField = useDataStore((s) => s.addSchemaField)
  const updateSchemaField = useDataStore((s) => s.updateSchemaField)
  const removeSchemaField = useDataStore((s) => s.removeSchemaField)

  const [activeSchemaId, setActiveSchemaId] = useState<string | null>(schemas[0]?.id ?? null)
  const [ctxMenu, setCtxMenu] = useState<{ schemaId: string; offsetX: number; offsetY: number } | null>(null)
  const schemaRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const nameInputRef = useRef<HTMLInputElement>(null)
  // Tracks the id of a schema we need to focus+select the name of as soon as
  // it becomes active. Used by handleAddSchema so the user can immediately
  // type the new schema's name without a second click.
  const pendingNameFocusRef = useRef<string | null>(null)
  const activeSchema = schemas.find((s) => s.id === activeSchemaId) ?? schemas[0] ?? null

  useEffect(() => {
    if (!activeSchema) return
    if (pendingNameFocusRef.current !== activeSchema.id) return
    pendingNameFocusRef.current = null
    const el = nameInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [activeSchema?.id])

  function handleAddField(schema: Schema) {
    const existingKeys = new Set(schema.fields.map((f) => f.key))
    const key = uniqueKey('field', existingKeys)
    addSchemaField(schema.id, { key, label: '', type: 'text', required: false })
  }

  function handleAddSchema() {
    // Seed the new schema with an initial empty field so the user lands in a
    // ready-to-edit state instead of an empty right pane. One undo step.
    const id = addSchema('New schema', [{ key: uniqueKey('field', new Set()), label: '', type: 'text', required: false }])
    pendingNameFocusRef.current = id
    setActiveSchemaId(id)
  }

  function handleContextMenu(e: React.MouseEvent, schemaId: string) {
    e.preventDefault()
    const origin = containerRef?.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    setCtxMenu({ schemaId, offsetX: e.clientX - origin.left, offsetY: e.clientY - origin.top })
  }

  function handleDelete(schemaId: string) {
    if (schemas.length <= 1) return
    deleteSchema(schemaId)
    const remaining = schemas.filter((s) => s.id !== schemaId)
    setActiveSchemaId(remaining[0]?.id ?? null)
    setCtxMenu(null)
  }

  return (
    <div className="flex h-full min-h-0" onClick={() => setCtxMenu(null)}>
      {/* Left — schema list */}
      <div className="w-44 flex-shrink-0 flex flex-col border-r border-elm-border min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 py-1">
          {schemas.map((schema) => {
            const isActive = (activeSchema?.id ?? activeSchemaId) === schema.id
            return (
              <button
                key={schema.id}
                ref={(el) => { if (el) schemaRefs.current.set(schema.id, el); else schemaRefs.current.delete(schema.id) }}
                onClick={() => setActiveSchemaId(schema.id)}
                onContextMenu={(e) => handleContextMenu(e, schema.id)}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-1.5',
                  isActive
                    ? 'bg-primary-50 dark:bg-white/10 hover:bg-primary-100 dark:hover:bg-white/15 text-primary-700 dark:text-primary-300 font-medium border-r-2 border-primary-500'
                    : 'text-elm-text-muted hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-800)) hover:text-(--elm-text,var(--color-gray-800)) dark:hover:text-(--elm-text,var(--color-gray-200)) border-r-2 border-transparent',
                )}
              >
                <span className="flex-1 truncate leading-snug">{schema.name}</span>
              </button>
            )
          })}
          <button
            onClick={handleAddSchema}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-elm-text-subtle hover:text-(--elm-text-secondary,var(--color-gray-700)) dark:hover:text-(--elm-text-secondary,var(--color-gray-200)) hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-800)) transition-colors border-r-2 border-transparent"
          >
            <Plus size={11} />
            Add schema
          </button>
        </div>
      </div>

      {/* Right — field editor */}
      {activeSchema ? (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-(--elm-surface-sunken,color-mix(in_oklab,var(--color-gray-50)_60%,transparent)) dark:bg-(--elm-surface-sunken,color-mix(in_oklab,var(--color-gray-800)_30%,transparent))">
          {/* Header: name + meta + delete */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-elm-border-subtle flex-shrink-0">
            <div className="flex-1 min-w-0">
              <SchemaNameInput
                key={activeSchema.id}
                ref={nameInputRef}
                schema={activeSchema}
                onRename={(name) => updateSchema(activeSchema.id, { name })}
              />
            </div>
            <button
              onClick={() => handleAddField(activeSchema)}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-elm-text-subtle hover:text-primary-500 dark:hover:text-primary-400 transition-colors px-1.5 py-1 rounded-elm-chip hover:bg-primary-50 dark:hover:bg-white/5"
            >
              <Plus size={11} />
              Add field
            </button>
          </div>

          {/* Fields */}
          <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
            {activeSchema.fields.map((field) => {
                const existingKeys = new Set(
                  activeSchema.fields.map((f) => f.key).filter((k) => k !== field.key)
                )
                return (
                  <SchemaFieldRow
                    key={field.key}
                    field={field}
                    existingKeys={existingKeys}
                    onUpdate={(updates) => updateSchemaField(activeSchema.id, field.key, updates)}
                    onDelete={() => removeSchemaField(activeSchema.id, field.key)}
                    isProtected={field.key === 'name'}
                  />
                )
            })}
          </div>

        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-elm-text-disabled">
          Select a schema
        </div>
      )}

      {/* Right-click context menu (shared ContextMenu: themed, viewport-clamped). */}
      {ctxMenu && (
        <ContextMenu
          x={(containerRef?.current?.getBoundingClientRect().left ?? 0) + ctxMenu.offsetX}
          y={(containerRef?.current?.getBoundingClientRect().top ?? 0) + ctxMenu.offsetY}
          onClose={() => setCtxMenu(null)}
          items={[{
            label: schemas.length <= 1 ? 'Cannot delete last' : 'Delete schema',
            icon: <Trash size={16} />,
            disabled: schemas.length <= 1,
            onClick: () => handleDelete(ctxMenu.schemaId),
          }]}
        />
      )}
    </div>
  )
}
