import { divIcon, type LatLngExpression } from 'leaflet'
import { Marker, Polyline, useMap } from 'react-leaflet'
import { useAccentPalette } from '@element-editor/ui'
import { useUIStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'

function linePreviewVertexIcon(isFirst: boolean) {
  return divIcon({
    className: '',
    html: `<div class="w-2.5 h-2.5 rounded-full border-2 border-white shadow ${isFirst ? 'bg-emerald-500' : 'bg-primary-500'}"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  })
}

export function LinePreview() {
  const accent500 = useAccentPalette(useMap().getContainer())[500]
  const lineInProgress = useUIStore((s) => s.lineInProgress)
  if (lineInProgress.length === 0) return null
  const positions: LatLngExpression[] = lineInProgress.map(toLeaflet)

  return (
    <>
      {lineInProgress.length >= 2 && (
        <Polyline
          positions={positions}
          pathOptions={{ color: accent500, weight: 2, opacity: 0.7, dashArray: '6 4' }}
          interactive={false}
        />
      )}
      {lineInProgress.map((coord, i) => (
        <Marker key={i} position={toLeaflet(coord)} icon={linePreviewVertexIcon(i === 0)} interactive={false} />
      ))}
    </>
  )
}
