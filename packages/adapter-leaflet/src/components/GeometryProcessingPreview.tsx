import { Polygon, Polyline, useMap } from 'react-leaflet'
import { useAccentPalette } from '@element-editor/ui'
import { canProcessShape, isLineGeometryType } from '@element-editor/core/internal'
import { useUIStore, useDataStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import type { LatLngExpression, PathOptions } from 'leaflet'
import type { PolygonGeometry, MultiPolygonGeometry, LineStringGeometry, MultiLineStringGeometry, Geometry } from '@element-editor/core'

/** Polygon / MultiPolygon as a `<Polygon>`, LineString / MultiLineString as a `<Polyline>` (lines have no fill). */
function PreviewShape({ geom, pathOptions }: { geom: Geometry; pathOptions: PathOptions }) {
  switch (geom.type) {
    case 'Polygon':
      return <Polygon positions={(geom as PolygonGeometry).coordinates.map(ring => ring.map(toLeaflet))} pathOptions={pathOptions} />
    case 'MultiPolygon':
      return <Polygon positions={(geom as MultiPolygonGeometry).coordinates.map(poly => poly.map(ring => ring.map(toLeaflet))) as LatLngExpression[][][]} pathOptions={pathOptions} />
    case 'LineString':
      return <Polyline positions={(geom as LineStringGeometry).coordinates.map(toLeaflet)} pathOptions={{ ...pathOptions, fill: false }} />
    case 'MultiLineString':
      return <Polyline positions={(geom as MultiLineStringGeometry).coordinates.map(line => line.map(toLeaflet))} pathOptions={{ ...pathOptions, fill: false }} />
    default:
      return null
  }
}

export default function GeometryProcessingPreview() {
  const accent500 = useAccentPalette(useMap().getContainer())[500]
  const editingMode = useUIStore((s) => s.editingMode)
  const preview = useUIStore((s) => s.geometryPreview)
  const bufferCreateNew = useUIStore((s) => s.bufferCreateNew)

  const selectedId = useDataStore((s) => s.selectedIds[0] ?? null)
  const originalGeom = useDataStore((s) => {
    if (!selectedId) return null
    return s.features.find(f => f.id === selectedId)?.geometry ?? null
  })

  const isActive = editingMode === 'simplify-shape' || editingMode === 'smooth-shape' || editingMode === 'buffer-shape'
  if (!isActive || !preview) return null
  if (!canProcessShape(preview.type)) return null

  const isBuffer = editingMode === 'buffer-shape'
  const showGhost = isBuffer && !bufferCreateNew && originalGeom && canProcessShape(originalGeom.type)
  const isLine = isLineGeometryType(preview.type)

  return (
    <>
      {showGhost && (
        <PreviewShape
          geom={originalGeom as Geometry}
          pathOptions={{
            color: '#6b7280',
            fillColor: '#6b7280',
            fillOpacity: 0.07,
            weight: 1.5,
            opacity: 0.35,
            dashArray: '4 4',
            interactive: false,
          }}
        />
      )}
      <PreviewShape
        geom={preview as Geometry}
        pathOptions={{
          color: accent500,
          fillColor: accent500,
          fillOpacity: isBuffer && bufferCreateNew ? 0.12 : 0.2,
          // A line preview is the whole shape: draw it at line-feature weight.
          weight: isLine ? 3 : isBuffer && bufferCreateNew ? 2 : 2.5,
          opacity: 1,
          dashArray: isBuffer && bufferCreateNew ? '8 5' : undefined,
          interactive: false,
        }}
      />
    </>
  )
}
