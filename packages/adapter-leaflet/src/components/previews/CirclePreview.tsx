import { type LatLngExpression } from 'leaflet'
import { Marker, Polygon, useMap } from 'react-leaflet'
import { useAccentPalette } from '@element-editor/ui'
import { makeCircleCoords } from '@element-editor/core/internal'
import { useDataStore, useUIStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { divIcon } from 'leaflet'
import { useCursorWhileMode } from '../../hooks/useCursorWhileMode'

function vertexIcon() {
  return divIcon({
    className: '',
    html: '<div class="w-2.5 h-2.5 rounded-full border-2 border-white shadow bg-emerald-500"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  })
}

export function CirclePreview() {
  const accent500 = useAccentPalette(useMap().getContainer())[500]
  const circleCenter = useUIStore((s) => s.circleCenter)
  const editingMode = useUIStore((s) => s.editingMode)
  const snappedCoord = useUIStore((s) => s.snappedCoord)
  const mouse = useCursorWhileMode(editingMode, editingMode === 'draw-circle')

  const mode = useDataStore((s) => s.geometryMode)

  if (editingMode !== 'draw-circle') return null

  const targetCoord = snappedCoord ?? mouse
  const circlePositions: LatLngExpression[] | null =
    circleCenter && targetCoord ? makeCircleCoords(circleCenter, targetCoord, mode).map(toLeaflet) : null

  return (
    <>
      {circleCenter && <Marker position={toLeaflet(circleCenter)} icon={vertexIcon()} interactive={false} />}
      {circlePositions && (
        <Polygon
          positions={circlePositions}
          pathOptions={{ color: accent500, weight: 2, opacity: 0.8, dashArray: '6 4', fillOpacity: 0.1 }}
          interactive={false}
        />
      )}
    </>
  )
}
