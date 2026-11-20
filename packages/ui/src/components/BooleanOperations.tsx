import { useGeoStore, useDataStore } from '../store/StoreContext'
import { useUIStore } from '../store/StoreContext'
import { EditToolbarBtn } from './ui/EditToolbarBtn'
import { UniteSquare, SubtractSquare, IntersectSquare, ExcludeSquare, Spinner } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useEmit, useIsManaged, useToasterId } from '../contexts/EventContext'
import { ElementEditorError, type GeoJSONFeature } from '@element-editor/core'
import { freeGeometry } from '@element-editor/core/internal'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { runGeometryWorkerOperation } from '../utils/geometryWorkerClient'

type PolyFeature = Feature<Polygon | MultiPolygon>

export default function BooleanOperations() {
  const { dataStore } = useGeoStore()
  const selectedIds = useDataStore((s) => s.selectedIds)
  const features = useDataStore((s) => s.features)
  // `geometryTypes`: what a result may be isn't known until it is computed, but a result that can only be
  // a type the editor refuses is known up front (polygons need Polygon or MultiPolygon).
  const geometryTypes = useDataStore((s) => s.geometryTypes)
  const geometryProcessing = useUIStore((s) => s.geometryProcessing)
  const setGeometryProcessing = useUIStore((s) => s.setGeometryProcessing)
  const emit = useEmit()
  const managed = useIsManaged()
  const toasterId = useToasterId()

  if (selectedIds.length < 2) return null

  const featuresById = new Map(features.map(f => [f.id, f]))
  const selectedFeatures = selectedIds.flatMap(id => {
    const f = featuresById.get(id)
    return f ? [f] : []
  })

  const allPolygons = selectedFeatures.every(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  const allLines = selectedFeatures.every(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
  const allPoints = selectedFeatures.every(f => f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint')

  if (allPoints) return null

  // The selected features become one new feature (the first one's properties, schema and group)
  // in a single store commit = one undo step. The result is no longer a drawn rectangle/circle/route.
  function commitResult(geometry: GeoJSONFeature['geometry']): boolean {
    return dataStore.getState().replaceFeatures(selectedIds, [{
      ...selectedFeatures[0],
      id: crypto.randomUUID(),
      ...freeGeometry(geometry),
    }])
  }

  function handlePointUnion() {
    const coordinates: number[][] = []
    for (const f of selectedFeatures) {
      if (f.geometry.type === 'Point') {
        coordinates.push(f.geometry.coordinates as number[])
      } else if (f.geometry.type === 'MultiPoint') {
        coordinates.push(...(f.geometry.coordinates as number[][]))
      }
    }

    if (commitResult({ type: 'MultiPoint', coordinates } as GeoJSONFeature['geometry'])) emit({ type: 'success', message: 'Union completed' })
  }

  function handleLineUnion() {
    const coordinates: number[][][] = []
    for (const f of selectedFeatures) {
      if (f.geometry.type === 'LineString') {
        coordinates.push(f.geometry.coordinates as number[][])
      } else if (f.geometry.type === 'MultiLineString') {
        coordinates.push(...(f.geometry.coordinates as number[][][]))
      }
    }

    if (commitResult({ type: 'MultiLineString', coordinates } as GeoJSONFeature['geometry'])) emit({ type: 'success', message: 'Union completed' })
  }

  async function handleOperation(type: 'union' | 'subtract' | 'intersect' | 'exclude') {
    if (type === 'union' && allPoints) {
      return handlePointUnion()
    }
    if (type === 'union' && allLines) {
      return handleLineUnion()
    }
    if (!allPolygons) {
      emit({ type: 'warning', message: 'These work on areas only. Select just areas and try again.' })
      return
    }
    if (geometryProcessing) return

    const toastId = managed ? undefined : toast.loading('Working…', { toasterId })
    setGeometryProcessing(true)
    try {
      const geometry = await runGeometryWorkerOperation({
        type: 'boolean',
        op: type,
        features: selectedFeatures as PolyFeature[],
      })

      // The worker is async: don't resurrect a shape deleted (or undone) meanwhile.
      const live = new Set(dataStore.getState().features.map((f) => f.id))
      if (!selectedIds.every((id) => live.has(id))) throw new Error('a selected shape was removed while it ran')
      // A refused result (`geometryTypes`) is reported by the store and changes nothing.
      const done = commitResult(geometry as GeoJSONFeature['geometry'])
      if (toastId !== undefined) toast.dismiss(toastId)
      if (done) emit({ type: 'success', message: `${type[0].toUpperCase()}${type.slice(1)} completed` })

    } catch (err: unknown) {
      if (toastId !== undefined) toast.dismiss(toastId)
      const msg = err instanceof Error ? err.message : undefined
      emit({
        type: 'error',
        code: err instanceof ElementEditorError ? err.code : 'geometry',
        source: 'geometry',
        message: msg ? `Failed to perform ${type}: ${msg}` : `Failed to perform ${type}`,
        cause: err,
      })
    } finally {
      setGeometryProcessing(false)
    }
  }

  const allowed = (t: string) => geometryTypes == null || geometryTypes.includes(t as (typeof geometryTypes)[number])
  const polygonOpsOk = allowed('Polygon') || allowed('MultiPolygon')
  const unionOk = allPolygons ? polygonOpsOk : allLines ? allowed('MultiLineString') : allowed('MultiPoint')

  // Labels say what each op does. Subtract keeps the FIRST selected shape (click order, Shift+click
  // adds) and nothing on screen marks which one that is, so its label names it.
  return (
    <div className="flex items-center gap-2 bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-2 py-2 pointer-events-auto antialiased">
      <EditToolbarBtn
        label="Union: join into one shape"
        onClick={() => handleOperation('union')}
        disabled={(!allPolygons && !allLines && !allPoints) || !unionOk || geometryProcessing}
      >
        {geometryProcessing ? <Spinner size={24} className="animate-spin" /> : <UniteSquare size={24} weight="duotone" />}
      </EditToolbarBtn>
      <EditToolbarBtn
        label="Subtract: cut the others out of the first selected"
        onClick={() => handleOperation('subtract')}
        disabled={!allPolygons || !polygonOpsOk || geometryProcessing}
      >
        <SubtractSquare size={24} weight="duotone" />
      </EditToolbarBtn>
      <EditToolbarBtn
        label="Intersect: keep only the overlap"
        onClick={() => handleOperation('intersect')}
        disabled={!allPolygons || !polygonOpsOk || geometryProcessing}
      >
        <IntersectSquare size={24} weight="duotone" />
      </EditToolbarBtn>
      <EditToolbarBtn
        label="Exclude: keep only what doesn't overlap"
        onClick={() => handleOperation('exclude')}
        disabled={!allPolygons || !polygonOpsOk || geometryProcessing}
      >
        <ExcludeSquare size={24} weight="duotone" />
      </EditToolbarBtn>
    </div>
  )
}
