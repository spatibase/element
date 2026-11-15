import { useEffect, useMemo } from 'react'
import { bbox } from '@turf/bbox'
import { useUIStore, useDataStore, useGeoStore } from '../store/StoreContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { Button } from './ui/Button'
import { useWorkerGeometryPreview, type PreviewPayload } from '../hooks/useWorkerGeometryPreview'
import { useIsEventForEditor } from '../hooks/useKeyboardShortcuts'
import { formatLength, type Geometry, type FormatOpts } from '@element-editor/core'
import { canProcessShape, countShapeVertices } from '@element-editor/core/internal'

const M_PER_DEG = 111320  // 1 degree of latitude ≈ 111.32 km

function toleranceLabel(deg: number, opts: FormatOpts): string {
  const meters = deg * M_PER_DEG
  if (meters < 1) {
    // Sub-unit threshold — use the resolved system to show the right tiny label.
    const min = formatLength(1, opts)
    return `<1${min.unit}`
  }
  const f = formatLength(meters, opts)
  return `~${f.value}${f.unit}`
}

export default function SimplifyPanel() {
  const editingMode = useUIStore((s) => s.editingMode)
  const sliderValue = useUIStore((s) => s.simplifyTolerance)
  const setSliderValue = useUIStore((s) => s.setSimplifyTolerance)
  const setPreview = useUIStore((s) => s.setGeometryPreview)
  const preview = useUIStore((s) => s.geometryPreview)
  const commit = useUIStore((s) => s.commitGeometryProcess)
  const cancel = useUIStore((s) => s.cancelGeometryProcess)

  const { units } = useElementEditorConfig()
  const lengthOpts: FormatOpts = { unit: units.length, display: units.display, precision: units.precision }

  const { dataStore } = useGeoStore()
  const isForThisEditor = useIsEventForEditor()
  const selectedId = useDataStore((s) => s.selectedIds[0] ?? null)
  const originalGeom = useDataStore((s) => {
    if (!selectedId) return null
    return s.features.find(f => f.id === selectedId)?.geometry ?? null
  })
  const drawType = useDataStore((s) => {
    if (!selectedId) return null
    return s.features.find(f => f.id === selectedId)?._drawType ?? null
  })

  // Adaptive tolerance: scales to the feature's bounding box so the slider
  // is meaningful regardless of feature size (GPS track vs. country boundary).
  // Only while the panel is open: the panel stays mounted, and a bbox walk of a
  // 50k-vertex selection on every commit is wasted work.
  const toleranceDeg = useMemo(() => {
    if (!originalGeom || editingMode !== 'simplify-shape') return 0
    try {
      const b = bbox({ type: 'Feature', geometry: originalGeom as GeoJSON.Geometry, properties: {} })
      const diagonal = Math.sqrt((b[2] - b[0]) ** 2 + (b[3] - b[1]) ** 2)
      // Quadratic curve: fine control at low end, aggressive at high end
      // Range: 0% to 30% of bbox diagonal
      return (sliderValue / 100) ** 2 * diagonal * 0.30
    } catch {
      return 0
    }
  }, [sliderValue, originalGeom, editingMode])

  // Only compute while the panel is active; run in the worker so slider ticks
  // on a heavy polygon never block the main thread.
  const active = editingMode === 'simplify-shape'
  const payload = useMemo<PreviewPayload | null>(() => {
    if (!active || !originalGeom || !canProcessShape(originalGeom.type)) return null
    return { type: 'simplify', geometry: originalGeom as GeoJSON.Geometry, tolerance: toleranceDeg }
  }, [active, originalGeom, toleranceDeg])
  const whenSettled = useWorkerGeometryPreview(payload, setPreview)

  useEffect(() => () => { dataStore.getState(); setPreview(null) }, [setPreview, dataStore])

  const origCount = originalGeom ? countShapeVertices(originalGeom as Geometry) : 0
  const previewCount = preview ? countShapeVertices(preview) : origCount
  const delta = origCount - previewCount

  useEffect(() => {
    if (editingMode !== 'simplify-shape') return
    function onKey(e: KeyboardEvent) {
      if (!isForThisEditor(e)) return
      if (e.key === 'Enter' && preview && delta > 0) { e.preventDefault(); whenSettled(commit) }
      else if (e.key === 'Escape') { e.preventDefault(); cancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingMode, preview, delta, commit, cancel, whenSettled, isForThisEditor])

  if (editingMode !== 'simplify-shape') return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 max-w-full bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-3 py-1.5 pointer-events-auto">
      <span className="text-sm font-medium text-elm-text-secondary shrink-0">Simplify</span>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={(e) => setSliderValue(Number(e.target.value))}
          className="w-32 accent-primary-600"
        />
        <span className="text-sm text-elm-text-muted w-16 shrink-0">{toleranceLabel(toleranceDeg, lengthOpts)}</span>
      </div>

      <div className="flex items-center gap-1 text-sm text-elm-text-muted shrink-0">
        <span className="font-elm-mono">{origCount}</span>
        <span>→</span>
        <span className={`font-elm-mono font-medium ${delta > 0 ? 'text-primary-600 dark:text-primary-400' : 'text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300))'}`}>{previewCount}</span>
        {delta > 0 && <span className="text-xs text-primary-500">(−{delta})</span>}
        <span className="ml-0.5">points</span>
      </div>

      {drawType && (
        <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">
          {drawType === 'route' ? 'Turns this route into a plain line.' : `Turns this ${drawType} into a plain shape.`}
        </span>
      )}

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" onClick={cancel} className="rounded-elm-control h-8 px-3 text-sm">Cancel</Button>
        <Button variant="primary" onClick={() => whenSettled(commit)} disabled={!preview || delta === 0} className="rounded-elm-control h-8 px-3 text-sm">Apply</Button>
      </div>
    </div>
  )
}
