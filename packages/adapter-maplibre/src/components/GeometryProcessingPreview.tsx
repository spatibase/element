/**
 * GeometryProcessingPreview — renders uiStore.geometryPreview (a polygon, or a
 * line for Simplify / Smooth of a line; the fill layer skips lines) on the map while the user is in simplify/smooth/buffer mode. The buffer mode
 * also optionally shows the original geometry behind the preview when creating
 * a new feature rather than replacing the existing one.
 */
import { useEffect } from 'react'
import { useStyleEpoch } from '../contexts/StyleEpochContext'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useUIStore, useDataStore } from '../store/StoreContext'
import { emptyFC } from '../utils/geojson'
import { type Geometry } from '@element-editor/core'
import { canProcessShape } from '@element-editor/core/internal'
import { paintAccent, useAccentPaint, type AccentPaint } from '../utils/accentPaint'

const SOURCE = 'elm-processing-preview'

const ACCENT_PAINT: AccentPaint = [
  ['elm-processing-preview-fill', 'fill-color', (p) => p[500]],
  ['elm-processing-preview-line', 'line-color', (p) => p[500]],
]

export function initProcessingPreviewLayers(map: MapLibreMap) {
  if (map.getSource(SOURCE)) return

  map.addSource(SOURCE, { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection })

  // Original (ghost behind preview when buffer-create-new)
  map.addLayer({
    id: 'elm-processing-preview-ghost',
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['get', '_ghost'], true],
    paint: {
      'fill-color': '#6b7280',
      'fill-opacity': 0.07,
    },
  })
  map.addLayer({
    id: 'elm-processing-preview-ghost-line',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', '_ghost'], true],
    paint: {
      'line-color': '#6b7280',
      'line-opacity': 0.35,
      'line-width': 1.5,
      'line-dasharray': [4, 4],
    },
  })

  // Active preview
  map.addLayer({
    id: 'elm-processing-preview-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['!=', ['get', '_ghost'], true],
    paint: {
      'fill-opacity': [
        'case',
        ['boolean', ['get', '_bufferNew'], false], 0.12,
        0.2,
      ],
    },
  })
  map.addLayer({
    id: 'elm-processing-preview-line',
    type: 'line',
    source: SOURCE,
    filter: ['!=', ['get', '_ghost'], true],
    paint: {
      'line-width': [
        'case',
        ['boolean', ['get', '_bufferNew'], false], 2,
        2.5,
      ],
      'line-dasharray': [
        'case',
        ['boolean', ['get', '_bufferNew'], false], ['literal', [8, 5]],
        ['literal', [1, 0]],
      ],
    },
  })
  paintAccent(map, ACCENT_PAINT)
}

export function cleanupProcessingPreviewLayers(map: MapLibreMap) {
  for (const id of [
    'elm-processing-preview-line',
    'elm-processing-preview-fill',
    'elm-processing-preview-ghost-line',
    'elm-processing-preview-ghost',
  ]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

function toGeoJSONFeature(geom: Geometry, props: Record<string, unknown>): GeoJSON.Feature {
  return { type: 'Feature', properties: props, geometry: geom as unknown as GeoJSON.Geometry }
}

interface Props {
  map: MapLibreMap
}

export default function GeometryProcessingPreview({ map }: Props) {
  useAccentPaint(map, ACCENT_PAINT)
  const styleEpoch = useStyleEpoch()
  const editingMode = useUIStore((s) => s.editingMode)
  const preview = useUIStore((s) => s.geometryPreview)
  const bufferCreateNew = useUIStore((s) => s.bufferCreateNew)

  const selectedId = useDataStore((s) => s.selectedIds[0] ?? null)
  const originalGeom = useDataStore((s) => {
    if (!selectedId) return null
    return s.features.find((f) => f.id === selectedId)?.geometry ?? null
  })

  useEffect(() => {
    const src = map.getSource(SOURCE) as
      | { setData: (d: GeoJSON.FeatureCollection) => void }
      | undefined
    if (!src) return

    const isActive =
      editingMode === 'simplify-shape' ||
      editingMode === 'smooth-shape' ||
      editingMode === 'buffer-shape'

    if (!isActive || !preview) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    if (!canProcessShape(preview.type)) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    const isBuffer = editingMode === 'buffer-shape'
    const showGhost =
      isBuffer &&
      !bufferCreateNew &&
      originalGeom &&
      canProcessShape(originalGeom.type)

    const features: GeoJSON.Feature[] = []
    if (showGhost) {
      features.push(toGeoJSONFeature(originalGeom as Geometry, { _ghost: true }))
    }
    features.push(
      toGeoJSONFeature(preview as Geometry, {
        _bufferNew: isBuffer && bufferCreateNew,
      }),
    )

    src.setData({ type: 'FeatureCollection', features })
  }, [editingMode, preview, bufferCreateNew, originalGeom, map, styleEpoch])

  return null
}
