import { useEffect, useMemo, useState } from 'react'
import { useUIStore, useGeoStore } from '../store/StoreContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { Button } from './ui/Button'
import { useWorkerGeometryPreview, type PreviewPayload } from '../hooks/useWorkerGeometryPreview'
import { useIsEventForEditor } from '../hooks/useKeyboardShortcuts'
import { type Geometry } from '@element-editor/core'
import { resolveUnitSystem, canProcessShape, isLineGeometryType } from '@element-editor/core/internal'

const M_PER_FT = 0.3048
const FT_PER_MILE = 5280
const M_PER_MILE = M_PER_FT * FT_PER_MILE  // 1609.344

type UnitLabel = 'm' | 'km' | 'ft' | 'mi'

function toMeters(value: number, unit: UnitLabel): number {
  switch (unit) {
    case 'm':  return value
    case 'km': return value * 1000
    case 'ft': return value * M_PER_FT
    case 'mi': return value * M_PER_MILE
  }
}

function fromMeters(meters: number, unit: UnitLabel): number {
  switch (unit) {
    case 'm':  return meters
    case 'km': return meters / 1000
    case 'ft': return meters / M_PER_FT
    case 'mi': return meters / M_PER_MILE
  }
}

export default function BufferPanel() {
  const { dataStore } = useGeoStore()
  const isForThisEditor = useIsEventForEditor()
  const editingMode = useUIStore((s) => s.editingMode)
  const distance = useUIStore((s) => s.bufferDistance)
  const setDistance = useUIStore((s) => s.setBufferDistance)
  const createNew = useUIStore((s) => s.bufferCreateNew)
  const setCreateNew = useUIStore((s) => s.setBufferCreateNew)
  const setPreview = useUIStore((s) => s.setGeometryPreview)
  const preview = useUIStore((s) => s.geometryPreview)
  const commit = useUIStore((s) => s.commitBufferProcess)
  const cancel = useUIStore((s) => s.cancelBufferProcess)

  const { units } = useElementEditorConfig()
  const system = resolveUnitSystem(units.length)
  const unitPair = useMemo<readonly [UnitLabel, UnitLabel]>(
    () => system === 'imperial' ? ['ft', 'mi'] as const : ['m', 'km'] as const,
    [system]
  )
  const [bigUnit, setBigUnit] = useState(false)
  const unit: UnitLabel = bigUnit ? unitPair[1] : unitPair[0]

  // Snapshot the source geometry once when entering buffer mode.
  // Using a store snapshot (not a live selector) breaks the feedback loop:
  // setPreview(polygon) → hides original → selectedIds may clear → live selector
  // returns null → setPreview(null). The snapshot is immune to that cascade.
  const [capturedGeom, setCapturedGeom] = useState<Geometry | null>(null)

  useEffect(() => {
    if (editingMode !== 'buffer-shape') {
      setCapturedGeom(null)
      return
    }
    const id = dataStore.getState().selectedIds[0] ?? null
    if (!id) return
    const geom = dataStore.getState().features.find(f => f.id === id)?.geometry ?? null
    if (geom && canProcessShape(geom.type)) {
      setCapturedGeom(geom as Geometry)
    }
  }, [editingMode, dataStore])

  // A line has no inside to shrink into: only positive distances (a negative
  // one would leave nothing, so there's no preview and Apply stays disabled).
  const isLine = isLineGeometryType(capturedGeom?.type)

  // Buffer (JSTS) can take hundreds of ms on an OSM polygon — run it in the worker.
  const payload = useMemo<PreviewPayload | null>(
    () => capturedGeom && !(isLine && distance <= 0) ? { type: 'buffer', geometry: capturedGeom as GeoJSON.Geometry, distance } : null,
    [capturedGeom, distance, isLine]
  )
  const whenSettled = useWorkerGeometryPreview(payload, setPreview)

  useEffect(() => {
    return () => { setPreview(null) }
  }, [setPreview])

  useEffect(() => {
    if (editingMode !== 'buffer-shape') return
    function onKey(e: KeyboardEvent) {
      if (!isForThisEditor(e)) return
      if (e.key === 'Enter' && preview) { e.preventDefault(); whenSettled(commit) }
      else if (e.key === 'Escape') { e.preventDefault(); cancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingMode, preview, commit, cancel, whenSettled, isForThisEditor])

  // Display value derived from store (always meters) using the selected unit.
  // Round small unit (m/ft) to whole numbers; large unit (km/mi) to 2 decimals.
  const isBig = unit === 'km' || unit === 'mi'
  const rawDisplay = fromMeters(distance, unit)
  const displayValue = isBig ? Number(rawDisplay.toFixed(2)) : Math.round(rawDisplay)
  const displayStep = isBig ? 0.1 : 1

  function handleDistanceInput(raw: string) {
    const parsed = parseFloat(raw)
    if (isNaN(parsed)) return
    setDistance(Math.round(toMeters(parsed, unit)))
  }

  function handleUnitToggle() {
    setBigUnit(b => !b)
  }

  if (editingMode !== 'buffer-shape') return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 max-w-full bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-3 py-1.5 pointer-events-auto">
      <span className="text-sm font-medium text-elm-text-secondary shrink-0">Buffer</span>

      <div className="flex items-center gap-1">
        <input
          type="range"
          min={isLine ? 0 : -500}
          max={2000}
          step={1}
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
          className="w-28 accent-primary-600"
        />
        <div className="flex items-center gap-0.5">
          <input
            type="number"
            value={displayValue}
            step={displayStep}
            onChange={(e) => handleDistanceInput(e.target.value)}
            className="w-16 text-sm text-right bg-transparent border border-elm-border rounded-elm-control px-1.5 py-0.5 text-elm-text-secondary focus:outline-none focus-visible:border-elm-focus-ring"
          />
          <button
            onClick={handleUnitToggle}
            className="text-xs text-primary-600 dark:text-primary-400 hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) font-medium px-1.5 py-0.5 rounded-elm-control shrink-0 transition-colors"
          >
            {unit}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-1.5 cursor-pointer shrink-0 select-none">
        <span className="text-sm text-(--elm-text-muted,var(--color-gray-600)) dark:text-(--elm-text-muted,var(--color-gray-400))">New shape</span>
        <div
          role="checkbox"
          aria-checked={createNew}
          onClick={() => setCreateNew(!createNew)}
          className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
            createNew
              ? 'bg-primary-500 dark:bg-primary-600'
              : 'bg-elm-border'
          }`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${
              createNew ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </div>
      </label>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" onClick={cancel} className="rounded-elm-control h-8 px-3 text-sm">Cancel</Button>
        <Button variant="primary" onClick={() => whenSettled(commit)} disabled={!preview} className="rounded-elm-control h-8 px-3 text-sm">Apply</Button>
      </div>
    </div>
  )
}
