import { useEffect, useMemo } from 'react'
import { useUIStore, useDataStore, useGeoStore } from '../store/StoreContext'
import { Button } from './ui/Button'
import { useWorkerGeometryPreview, type PreviewPayload } from '../hooks/useWorkerGeometryPreview'
import { useIsEventForEditor } from '../hooks/useKeyboardShortcuts'
import { type Geometry } from '@element-editor/core'
import { canProcessShape, countShapeVertices } from '@element-editor/core/internal'

export default function SmoothPanel() {
  const editingMode = useUIStore((s) => s.editingMode)
  const iterations = useUIStore((s) => s.smoothIterations)
  const setIterations = useUIStore((s) => s.setSmoothIterations)
  const setPreview = useUIStore((s) => s.setGeometryPreview)
  const preview = useUIStore((s) => s.geometryPreview)
  const commit = useUIStore((s) => s.commitGeometryProcess)
  const cancel = useUIStore((s) => s.cancelGeometryProcess)

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

  // Only compute while the panel is active; run in the worker so slider ticks
  // on a heavy polygon never block the main thread.
  const active = editingMode === 'smooth-shape'
  const payload = useMemo<PreviewPayload | null>(() => {
    if (!active || !originalGeom || !canProcessShape(originalGeom.type)) return null
    return { type: 'smooth', geometry: originalGeom as GeoJSON.Geometry, iterations }
  }, [active, originalGeom, iterations])
  const whenSettled = useWorkerGeometryPreview(payload, setPreview)

  // clear preview on unmount
  useEffect(() => () => { dataStore.getState(); setPreview(null) }, [setPreview, dataStore])

  const origCount = originalGeom ? countShapeVertices(originalGeom as Geometry) : 0
  const previewCount = preview ? countShapeVertices(preview) : origCount
  const delta = previewCount - origCount

  useEffect(() => {
    if (editingMode !== 'smooth-shape') return
    function onKey(e: KeyboardEvent) {
      if (!isForThisEditor(e)) return
      if (e.key === 'Enter' && preview) { e.preventDefault(); whenSettled(commit) }
      else if (e.key === 'Escape') { e.preventDefault(); cancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingMode, preview, commit, cancel, whenSettled, isForThisEditor])

  if (editingMode !== 'smooth-shape') return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 max-w-full bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-3 py-1.5 pointer-events-auto">
      <span className="text-sm font-medium text-elm-text-secondary shrink-0">Smooth</span>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={iterations}
          onChange={(e) => setIterations(Number(e.target.value))}
          className="w-24 accent-primary-600"
        />
        <span className="text-sm text-elm-text-muted w-16 shrink-0">{iterations} {iterations === 1 ? 'pass' : 'passes'}</span>
      </div>

      <div className="flex items-center gap-1 text-sm text-elm-text-muted shrink-0">
        <span className="font-elm-mono">{origCount}</span>
        <span>→</span>
        <span className="font-elm-mono font-medium text-primary-600 dark:text-primary-400">{previewCount}</span>
        {delta > 0 && <span className="text-xs text-primary-500">(+{delta})</span>}
        <span className="ml-0.5">points</span>
      </div>

      {drawType && (
        <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">
          {drawType === 'route' ? 'Turns this route into a plain line.' : `Turns this ${drawType} into a plain shape.`}
        </span>
      )}

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" onClick={cancel} className="rounded-elm-control h-8 px-3 text-sm">Cancel</Button>
        <Button variant="primary" onClick={() => whenSettled(commit)} disabled={!preview} className="rounded-elm-control h-8 px-3 text-sm">Apply</Button>
      </div>
    </div>
  )
}
