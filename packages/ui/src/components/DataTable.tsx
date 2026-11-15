import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { DataGrid, SelectColumn, type Column, type SortColumn, type CellPasteArgs, type DataGridHandle, type RenderSortStatusProps } from 'react-data-grid'
import { Trash, CaretDown, ArrowUp, ArrowDown } from '@phosphor-icons/react'
import type { SchemaField, Schema, GeoJSONFeature } from '@element-editor/core'
import { useDataStore, useGeoStore, useUIStore } from '../store/StoreContext'
import { useEmit } from '../contexts/EventContext'
import { useShallow } from 'zustand/react/shallow'
import { useMapController } from '../contexts/MapControllerContext'
import { useTheme } from '../contexts/ThemeContext'
import { getGeometryBBox } from '@element-editor/core'
import { withXY } from '@element-editor/core/internal'
import { Tooltip } from './ui/Tooltip'
import { FeatureRowContextMenu } from './sidebar/FeatureRowContextMenu'
import { useContextMenu } from '../hooks/useContextMenu'
import { GeometryTypeIcon, geometryTypeLabel } from './ui/GeometryTypeIcon'
import { parseBooleanText, readBooleanValue } from '../utils/booleanValue'

type Row = {
  _id: string
  _type: string
  /** Size summary for non-point shapes ("4 points"); empty for points. */
  _size: string
  _schemaId: string
  _schemaName: string
  _lat: string
  _lng: string
  [key: string]: unknown
}

// Keys that are never written back to feature.properties
// Same semantics as localeCompare(b, undefined, { numeric: true }), built once
// instead of per comparison.
const collator = new Intl.Collator(undefined, { numeric: true })

const META_KEYS = new Set(['_id', '_type', '_size', '_schemaId', '_schemaName', '_lat', '_lng'])

function allFields(schemas: Schema[]): SchemaField[] {
  const seen = new Set<string>()
  const out: SchemaField[] = []
  for (const s of schemas) {
    for (const f of s.fields) {
      if (!seen.has(f.key)) {
        seen.add(f.key)
        out.push(f)
      }
    }
  }
  return out
}

/** "4 points", "2 parts, 9 points": a shape's size in plain words ('' for a point). */
function geometrySize(g: GeoJSONFeature['geometry']): string {
  const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`
  const parts = (n: number, total: number) => `${n} part${n === 1 ? '' : 's'}, ${pts(total)}`
  switch (g.type) {
    case 'Point': return ''
    case 'MultiPoint': return pts(g.coordinates.length)
    case 'LineString': return pts(g.coordinates.length)
    // Rings repeat their first position at the end: count it once.
    case 'Polygon': return pts(g.coordinates[0].length - 1)
    case 'MultiLineString': return parts(g.coordinates.length, g.coordinates.reduce((s, l) => s + l.length, 0))
    case 'MultiPolygon': return parts(g.coordinates.length, g.coordinates.reduce((s, p) => s + p[0].length - 1, 0))
    case 'GeometryCollection': return `${g.geometries.length} part${g.geometries.length === 1 ? '' : 's'}`
    default: return ''
  }
}

// The layers list's type icon (neutral) and the type in plain words.
function GeomType({ type }: { type: string }) {
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0 text-elm-text-secondary">
      <span className="text-(--elm-text-subtle,var(--color-gray-400)) flex-shrink-0"><GeometryTypeIcon type={type} size={16} /></span>
      <span className="text-sm">{geometryTypeLabel(type)}</span>
    </span>
  )
}

function CoordEditCell({
  row,
  column,
  onRowChange,
  onClose,
}: {
  row: Row
  column: Column<Row>
  onRowChange: (updated: Row) => void
  onClose: (commit: boolean) => void
}) {
  return (
    <input
      autoFocus
      type="number"
      step="any"
      // bg-transparent + text-inherit avoid the browser's UA-default input
      // chrome (white-ish in dark mode) which masks the caret. caret-primary
      // gives the blinking cursor an unmistakable accent color so the user
      // gets a clear "you can type here" hint regardless of theme.
      className="rdg-text-editor w-full h-full border-0 outline-none px-2 text-sm font-elm-mono bg-transparent text-inherit caret-primary-500"
      value={String(row[column.key] ?? '')}
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value })}
      onBlur={() => onClose(true)}
    />
  )
}

/**
 * A boolean field's cell: the feature panel's toggle, a size smaller. Click it, or press Space /
 * Enter on the selected cell, to flip the value (one undo step each). It is not a tab stop: the grid
 * cell keeps keyboard focus, as for every other cell.
 */
function BooleanSwitch({ checked, label, disabled, onToggle, autoFocus }: {
  checked: boolean
  label: string
  disabled?: boolean
  onToggle: () => void
  autoFocus?: boolean
}) {
  return (
    <span className="flex h-full items-center px-0.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        tabIndex={-1}
        autoFocus={autoFocus}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full outline-none disabled:cursor-default enabled:cursor-pointer
          ${checked ? 'bg-primary-500' : 'bg-elm-border'} ${disabled ? 'opacity-50' : 'opacity-90 enabled:hover:opacity-100'}`}
      >
        <span
          aria-hidden
          className={`absolute left-[2px] top-[2px] h-3 w-3 rounded-full border bg-white ${checked ? 'border-white' : 'border-(--elm-border-strong,var(--color-gray-300))'}`}
          // Inline transform: Tailwind v4's translate utilities set a separate `translate` property.
          style={{ transform: checked ? 'translateX(12px)' : undefined }}
        />
      </button>
    </span>
  )
}

function renderEditCellForField(field: SchemaField) {
  return function EditCell({
    row,
    column,
    onRowChange,
    onClose,
  }: {
    row: Row
    column: Column<Row>
    onRowChange: (updated: Row) => void
    onClose: (commit: boolean) => void
  }) {
    const value = String(row[column.key] ?? '')

    if (field.type === 'boolean') {
      // Normally unreachable (keys and double-click toggle instead), but a sane editor if opened.
      const checked = readBooleanValue(row[column.key])
      return (
        <div className="w-full h-full px-2" onBlur={() => onClose(true)}>
          <BooleanSwitch autoFocus checked={checked} label={field.label} onToggle={() => onRowChange({ ...row, [column.key]: !checked })} />
        </div>
      )
    }

    if (field.type === 'select' && field.options) {
      return (
        <div className="relative w-full h-full">
          <select
            autoFocus
            className="rdg-text-editor w-full h-full border-0 outline-none pl-2 pr-7 text-sm bg-transparent text-inherit appearance-none"
            value={value}
            onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value })}
            onBlur={() => onClose(true)}
          >
            <option value="">—</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <CaretDown size={12} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
        </div>
      )
    }

    const inputType =
      field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'

    return (
      <input
        autoFocus
        type={inputType}
        // See sibling number-editor — same bg/text/caret rationale: user needs
        // a clear blinking-cursor hint and the UA-default input chrome doesn't
        // play nicely with the dark cell background.
        className="rdg-text-editor w-full h-full border-0 outline-none px-2 text-sm bg-transparent text-inherit caret-primary-500"
        value={value}
        onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value })}
        onBlur={() => onClose(true)}
      />
    )
  }
}

interface Props {
  schemaFilter: string // 'all' or a schema id
  focusRowId?: string | null
  onFocusRowHandled?: () => void
  selectedRows: ReadonlySet<string>
  onSelectedRowsChange: (ids: ReadonlySet<string>) => void
}

// w-0 + min-w-full lets rdg's (non-shrinking) label span shrink so the label ellipsizes and the sort arrow stays visible.
function headerLabel(text: string) {
  return <span className="block w-0 min-w-full truncate">{text}</span>
}

// rdg wraps this in a plain stretched span, so fill it and centre the icon vertically.
function renderSortStatus({ sortDirection, priority }: RenderSortStatusProps) {
  if (!sortDirection) return null
  const Icon = sortDirection === 'ASC' ? ArrowUp : ArrowDown
  return (
    <span className="flex h-full items-center gap-0.5 pl-1">
      <Icon size={12} className="shrink-0" aria-hidden />
      {priority !== undefined && priority > 1 && <span className="text-[10px] leading-none opacity-60">{priority}</span>}
    </span>
  )
}

export default function DataTable({ schemaFilter, focusRowId, onFocusRowHandled, selectedRows, onSelectedRowsChange }: Props) {
  const features = useDataStore((s) => s.features)
  const groups = useDataStore((s) => s.groups)
  const schemas = useDataStore(useShallow((s) => s.getVisibleSchemas()))
  const selectFeature = useDataStore((s) => s.selectFeature)
  const updateFeature = useDataStore((s) => s.updateFeature)
  const deleteFeature = useDataStore((s) => s.deleteFeature)
  // Readonly: no cell editing, paste or delete (row selection still works).
  const readonly = useUIStore((s) => s.readonly)
  // Map / layers-list selection, highlighted separately from the checkbox selection.
  const selectedIds = useDataStore((s) => s.selectedIds)
  const { panTo, fitBounds } = useMapController()
  const theme = useTheme()

  const gridRef = useRef<DataGridHandle>(null)
  // rdg keeps its selected cell after focus leaves the grid; shared.css hides that cell's ring
  // while the grid isn't focused (no remount of the whole grid on outside clicks).
  const { dataStore } = useGeoStore()
  const emit = useEmit()
  // Right-click a row → same menu as the layers list (minus grouping).
  const rowCtxMenu = useContextMenu<GeoJSONFeature>()
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([])

  const activeFields = useMemo(() => {
    if (schemaFilter === 'all') return allFields(schemas)
    const schema = schemas.find((s) => s.id === schemaFilter)
    return schema ? schema.fields : allFields(schemas)
  }, [schemas, schemaFilter])

  const schemaMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of schemas) m[s.id] = s.name
    return m
  }, [schemas])

  const filteredFeatures = useMemo(() => {
    // Match layer list visual order: grouped features (in groups order), then ungrouped
    // Single bucketing pass (O(n)) instead of one filter per group.
    const byGroup = new Map<string, GeoJSONFeature[]>()
    const ungrouped: GeoJSONFeature[] = []
    for (const f of features) {
      if (!f.groupId) { ungrouped.push(f); continue }
      const arr = byGroup.get(f.groupId)
      if (arr) arr.push(f)
      else byGroup.set(f.groupId, [f])
    }
    const ordered = [
      ...groups.flatMap((g) => byGroup.get(g.id) ?? []),
      ...ungrouped,
    ]
    if (schemaFilter === 'all') return ordered
    const defaultId = schemas[0]?.id
    return ordered.filter((f) => (f.schemaId ?? defaultId) === schemaFilter)
  }, [features, groups, schemas, schemaFilter])

  const rows: Row[] = useMemo(
    () =>
      filteredFeatures.map((f) => {
        // Lat / Lng belong to points; everything else gets a short size
        // summary in the Geometry column instead.
        let latStr = ''
        let lngStr = ''
        if (f.geometry.type === 'Point') {
          const [lng, lat] = f.geometry.coordinates
          latStr = String(lat)
          lngStr = String(lng)
        }
        const effectiveSchemaId = f.schemaId ?? schemas[0]?.id ?? ''
        return {
          _id: f.id,
          _type: f.geometry.type,
          _size: geometrySize(f.geometry),
          _schemaId: effectiveSchemaId,
          _schemaName: schemaMap[effectiveSchemaId] ?? schemas[0]?.name ?? '',
          _lat: latStr,
          _lng: lngStr,
          ...(f.properties as Record<string, unknown>),
        }
      }),
    [filteredFeatures, schemaMap, schemas]
  )

  // Boolean fields: one toggle per cell (no text editor), sorted off before on.
  const booleanKeys = useMemo(() => new Set(activeFields.filter((f) => f.type === 'boolean').map((f) => f.key)), [activeFields])

  const sortedRows = useMemo(() => {
    if (sortColumns.length === 0) return rows
    const sortText = (r: Row, key: string) => booleanKeys.has(key) ? (readBooleanValue(r[key]) ? '1' : '0') : String(r[key] ?? '')
    return [...rows].sort((a, b) => {
      for (const sc of sortColumns) {
        const av = sortText(a, sc.columnKey)
        const bv = sortText(b, sc.columnKey)
        const cmp = collator.compare(av, bv)
        if (cmp !== 0) return sc.direction === 'ASC' ? cmp : -cmp
      }
      return 0
    })
  }, [rows, sortColumns, booleanKeys])

  const hasPoints = useMemo(() => rows.some((r) => r._type === 'Point'), [rows])

  // Flips a boolean field from the current store value, stored as a real boolean. updateFeatures
  // pushes one undo entry per call (no 1 s coalescing, which would merge on + off into nothing).
  const toggleBoolean = useCallback((id: string, key: string) => {
    if (readonly) return
    const ds = dataStore.getState()
    const f = ds.features.find((x) => x.id === id)
    if (!f) return
    ds.updateFeatures([{ id, patch: { properties: { ...f.properties, [key]: !readBooleanValue(f.properties?.[key]) } } }])
  }, [dataStore, readonly])

  const columns: Column<Row>[] = useMemo(() => {
    const cols: Column<Row>[] = [
      SelectColumn,
      {
        key: '_type',
        name: headerLabel('Type'),
        width: 150,
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => (
          <span className="flex items-center gap-2 min-w-0">
            <GeomType type={row._type} />
            {row._size && <span className="truncate text-xs text-elm-text-muted">{row._size}</span>}
          </span>
        ),
      },
    ]

    if (schemas.length > 1) {
      cols.push({
        key: '_schemaName',
        name: headerLabel('Schema'),
        width: 100,
        resizable: true,
        sortable: true,
        editable: true,
        renderCell: ({ row }) => (
          <span className="inline-block px-1.5 py-0.5 rounded-elm-chip bg-elm-surface-hover text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300)) text-[10px] font-medium">
            {row._schemaName}
          </span>
        ),
        renderEditCell: ({ row, onRowChange, onClose }) => (
          <div className="relative w-full h-full">
            <select
              autoFocus
              className="rdg-text-editor w-full h-full border-0 outline-none pl-2 pr-7 text-sm appearance-none"
              value={row._schemaId}
              onChange={(e) => {
                const s = schemas.find((sc) => sc.id === e.target.value)
                if (s) onRowChange({ ...row, _schemaId: s.id, _schemaName: s.name })
              }}
              onBlur={() => onClose(true)}
            >
              {schemas.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <CaretDown size={12} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
          </div>
        ),
      })
    }

    // Lat / Lng only while the table shows a point (they're empty for every other shape).
    if (hasPoints) cols.push(
      {
        key: '_lat',
        name: headerLabel('Lat'),
        width: 110,
        resizable: true,
        sortable: true,
        editable: (row) => row._type === 'Point',
        renderCell: ({ row }) => (
          <span className="font-elm-mono text-xs text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300))">{row._lat}</span>
        ),
        renderEditCell: CoordEditCell,
      },
      {
        key: '_lng',
        name: headerLabel('Lng'),
        width: 110,
        resizable: true,
        sortable: true,
        editable: (row) => row._type === 'Point',
        renderCell: ({ row }) => (
          <span className="font-elm-mono text-xs text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300))">{row._lng}</span>
        ),
        renderEditCell: CoordEditCell,
      }
    )

    for (const field of activeFields) {
      if (field.type === 'boolean') {
        cols.push({
          key: field.key,
          name: headerLabel(field.label),
          minWidth: 80,
          resizable: true,
          sortable: true,
          // Editable so rdg routes paste here (it also needs a renderEditCell); keys and
          // double-click toggle instead of opening the editor (onCellKeyDown / onCellDoubleClick).
          editable: true,
          renderCell: ({ row }) => (
            <BooleanSwitch
              checked={readBooleanValue(row[field.key])}
              label={field.label}
              disabled={readonly}
              onToggle={() => toggleBoolean(row._id, field.key)}
            />
          ),
          renderEditCell: renderEditCellForField(field),
        })
        continue
      }
      cols.push({
        key: field.key,
        name: headerLabel(field.label),
        // Room for a typical name; other fields size to their content (resizable).
        ...(field.key === 'name' && { width: 200 }),
        minWidth: 80,
        resizable: true,
        sortable: true,
        editable: true,
        renderEditCell: renderEditCellForField(field),
      })
    }

    // Filler column — absorbs remaining width so the grid always fills its container.
    cols.push({
      key: '_spacer',
      name: '',
      minWidth: 0,
      width: 'minmax(0, 1fr)',
      resizable: false,
      sortable: false,
      renderCell: () => null,
    })

    cols.push({
      key: '_delete',
      name: '',
      width: 36,
      resizable: false,
      sortable: false,
      // With rows checked, the delete column's header deletes them all —
      // same spot as the per-row delete buttons. One undo step. (The selected
      // count is shown in the panel toolbar next to the feature count.)
      renderHeaderCell: () => selectedRows.size > 0 ? (
        <div className="w-full h-full flex items-center justify-center">
          <Tooltip content={`Delete ${selectedRows.size} selected`}>
            <button
              aria-label={`Delete ${selectedRows.size} selected`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                const ds = dataStore.getState()
                const count = selectedRows.size
                ds.setSelection([...selectedRows])
                ds.deleteSelection()
                onSelectedRowsChange(new Set())
                emit({ type: 'features:deleted', count, undo: () => dataStore.getState().undo() })
              }}
              className="w-7 h-7 rounded-elm-control flex items-center justify-center text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300)) hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) hover:text-(--elm-text-secondary,var(--color-gray-700)) dark:hover:text-(--elm-text-secondary,var(--color-gray-200)) transition-colors"
            >
              <Trash size={16} />
            </button>
          </Tooltip>
        </div>
      ) : null,
      renderCell: ({ row }) => (
        <div className="w-full h-full flex items-center justify-center">
          <Tooltip content="Delete row">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); deleteFeature(row._id) }}
              className="w-7 h-7 rounded-elm-control flex items-center justify-center text-elm-text hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) transition-colors"
            >
              <Trash size={16} />
            </button>
          </Tooltip>
        </div>
      ),
    })

    if (readonly) return cols.filter((c) => c.key !== '_delete').map((c) => ({ ...c, editable: false }))
    return cols
  }, [activeFields, schemas.length, hasPoints, deleteFeature, selectedRows, onSelectedRowsChange, dataStore, emit, readonly, toggleBoolean])

  // When a new row is added via "Add entry", scroll to it and open Lat for editing
  useEffect(() => {
    if (!focusRowId) return
    const rowIdx = sortedRows.findIndex((r) => r._id === focusRowId)
    if (rowIdx === -1) return
    const latIdx = columns.findIndex((c) => c.key === '_lat')
    if (latIdx === -1) return
    requestAnimationFrame(() => {
      gridRef.current?.selectCell({ rowIdx, idx: latIdx }, { enableEditor: true })
      onFocusRowHandled?.()
    })
  }, [focusRowId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the selected feature's row into view when the selection changes
  // (layers list or map click), not on every edit/sort.
  useEffect(() => {
    if (selectedIds.length === 0) return
    const rowIdx = sortedRows.findIndex((r) => r._id === selectedIds[0])
    if (rowIdx !== -1) gridRef.current?.scrollToCell({ rowIdx })
  }, [selectedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRowsChange(updatedRows: Row[], { indexes }: { indexes: number[] }) {
    if (readonly) return
    const changed = updatedRows[indexes[0]]

    // Separate geometry fields from property fields
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(changed)) {
      if (!META_KEYS.has(k)) properties[k] = v
    }

    const feature = features.find((f) => f.id === changed._id)

    // Schema change
    const oldSchemaId = feature?.schemaId ?? schemas[0]?.id ?? ''
    if (changed._schemaId !== oldSchemaId) {
      updateFeature(changed._id, { schemaId: changed._schemaId, properties })
      return
    }

    // If lat/lng changed and feature is a Point, update geometry
    if (feature?.geometry.type === 'Point') {
      const newLat = parseFloat(changed._lat)
      const newLng = parseFloat(changed._lng)
      const [oldLng, oldLat] = feature.geometry.coordinates
      if (!isNaN(newLat) && !isNaN(newLng) && (newLat !== oldLat || newLng !== oldLng)) {
        // Geometry updates don't push undo themselves — snapshot once here.
        dataStore.getState().takeSnapshot()
        updateFeature(changed._id, {
          geometry: { type: 'Point', coordinates: withXY(feature.geometry.coordinates, [newLng, newLat]) },
          properties,
        })
        return
      }
    }

    updateFeature(changed._id, { properties })
  }

  // Paste clipboard text into the selected (editable — rdg checks) cell. Only
  // the first cell of a spreadsheet copy is used. Returning the same row object
  // is a no-op in rdg, so invalid input changes nothing. Valid input goes
  // through handleRowsChange like a typed edit (schema / Point geometry / undo).
  function handleCellPaste({ row, column }: CellPasteArgs<Row>, event: React.ClipboardEvent<HTMLDivElement>): Row {
    const text = event.clipboardData.getData('text/plain').split(/\r?\n/)[0].split('\t')[0].trim()
    if (!text || readonly) return row
    if (column.key === '_schemaName') {
      const s = schemas.find((sc) => sc.name === text || sc.id === text)
      return s ? { ...row, _schemaId: s.id, _schemaName: s.name } : row
    }
    if (column.key === '_lat' || column.key === '_lng') {
      return Number.isFinite(Number(text)) ? { ...row, [column.key]: text } : row
    }
    const field = activeFields.find((f) => f.key === column.key)
    if (field?.type === 'boolean') {
      // "true" / "yes" / "1" / ... become a real boolean; anything else changes nothing.
      const b = parseBooleanText(text)
      return b === null ? row : { ...row, [column.key]: b }
    }
    if (field?.type === 'number') return Number.isFinite(Number(text)) ? { ...row, [column.key]: text } : row
    if (field?.type === 'select' && field.options && !field.options.includes(text)) return row
    return { ...row, [column.key]: text }
  }

  function handleSelectedRowsChange(ids: ReadonlySet<string>) {
    onSelectedRowsChange(ids)
    if (ids.size !== 1) return
    const id = [...ids][0]
    selectFeature(id)
    const feature = features.find((f) => f.id === id)
    if (!feature) return
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates
      panTo?.([lat, lng])
    } else {
      fitBounds?.(feature.bbox || getGeometryBBox(feature.geometry))
    }
  }

  return (
    // Prevent the browser's native text-selection that fires on double-click
    // (mousedown with detail>=2). react-data-grid's own click/dblclick handlers
    // are unaffected — they fire as separate events after mousedown. We exempt
    // inputs/selects so text selection inside edit cells still works normally.
    <div
      className="contents"
      onMouseDown={(e) => {
        if (e.detail >= 2 && !(e.target as HTMLElement).closest('input, select, textarea')) {
          e.preventDefault()
        }
      }}
    >
    <DataGrid
      ref={gridRef}
      columns={columns}
      rows={sortedRows}
      rowKeyGetter={(row: Row) => row._id}
      rowClass={(row: Row) => (selectedIds.includes(row._id) ? 'elm-row-active' : undefined)}
      onRowsChange={handleRowsChange}
      renderers={{ renderSortStatus }}
      sortColumns={sortColumns}
      onSortColumnsChange={setSortColumns}
      selectedRows={selectedRows}
      onSelectedRowsChange={handleSelectedRowsChange}
      onCellPaste={handleCellPaste}
      onCellKeyDown={({ mode, row, column }, event) => {
        if (mode !== 'SELECT' || !booleanKeys.has(column.key)) return
        if (event.key === ' ' && event.shiftKey) return // Shift+Space checks the row (rdg)
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventGridDefault()
          event.preventDefault() // no page scroll on Space
          toggleBoolean(row._id, column.key)
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventGridDefault() // typing doesn't open a text editor on a toggle
        }
      }}
      onCellDoubleClick={({ column }, event) => {
        if (booleanKeys.has(column.key)) event.preventGridDefault() // the click on the toggle already flipped it
      }}
      onCellContextMenu={({ row }, event) => {
        const feature = features.find((f) => f.id === row._id)
        if (!feature) return
        event.preventGridDefault()
        event.preventDefault()
        rowCtxMenu.open(event.clientX, event.clientY, feature)
      }}
      className={theme === 'dark' ? 'rdg-dark' : 'rdg-light'}
      style={
        // Cells are transparent so the surrounding DataTablePanel's
        // `bg-elm-surface/95 backdrop-blur-md` shows through —
        // matches the LayersPanel chrome exactly. Sticky cells (last-column
        // row-delete + header) need a SOLID bg to mask horizontally-scrolling
        // content underneath, so they get a panel-matching OPAQUE colour via
        // `--elm-rdg-sticky-bg` (used by sticky rules in index.css) — the header
        // row is sticky on scroll too, so it uses the same colour instead of
        // transparent (rows showed through it). 95% would still leak. Hover /
        // selected stay solid because they need to be readable on top of the
        // panel.
        ({
          // Design tokens; the fallbacks are react-data-grid's own text/border
          // colours we used before (#000 / #ddd light, #e5e5e5 / #404040 dark).
          ...(theme === 'dark'
          ? {
              '--rdg-color': 'var(--elm-text, #e5e5e5)',
              '--rdg-border-color': 'var(--elm-border, #404040)',
              '--rdg-selection-color': 'var(--color-primary-400)',
            }
          : {
              '--rdg-color': 'var(--elm-text, #000)',
              '--rdg-border-color': 'var(--elm-border, #ddd)',
              '--rdg-selection-color': 'var(--color-primary-500)',
            }),
          '--rdg-background-color': 'transparent',
          '--rdg-header-background-color': 'var(--elm-surface, var(--_elm-surface))',
          '--elm-rdg-sticky-bg': 'var(--elm-surface, var(--_elm-surface))',
          blockSize: '100%',
          // Row states share the per-theme --elm-row-* tokens with FeatureRow (index.css).
          '--rdg-row-hover-background-color': 'var(--elm-row-hover)',
          '--rdg-row-selected-background-color': 'var(--elm-row-checked)',
          '--rdg-row-selected-hover-background-color': 'var(--elm-row-checked-hover)',
        }) as unknown as React.CSSProperties
      }
    />
    {rowCtxMenu.state && (
      <FeatureRowContextMenu
        x={rowCtxMenu.state.x}
        y={rowCtxMenu.state.y}
        feature={features.find((f) => f.id === rowCtxMenu.state!.data.id) ?? rowCtxMenu.state.data}
        onClose={rowCtxMenu.close}
        showGrouping={false}
      />
    )}
    </div>
  )
}
