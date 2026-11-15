import { divIcon, type LatLngExpression } from 'leaflet'
import { Marker, Polygon, Polyline } from 'react-leaflet'
import { useUIStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { DEFAULT_FEATURE_COLOR } from '@element-editor/core'

function vertexIcon(isFirst: boolean) {
  return divIcon({
    className: '',
    html: `<div class="w-2.5 h-2.5 rounded-full border-2 border-white shadow ${isFirst ? 'bg-emerald-500' : 'bg-primary-500'}"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  })
}

function closingVertexIcon() {
  return divIcon({
    className: 'closing-node',
    html: '<div class="flex items-center justify-center w-full h-full group"><div class="w-4 h-4 rounded-full border-[3px] border-white shadow-lg bg-emerald-500 group-hover:scale-[1.5] group-hover:bg-emerald-400 transition-transform duration-200"></div></div>',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  })
}

export function PolygonPreview() {
  const polygonInProgress = useUIStore((s) => s.polygonInProgress)
  const commitPolygon = useUIStore((s) => s.commitPolygon)
  if (polygonInProgress.length === 0) return null
  const positions: LatLngExpression[] = polygonInProgress.map(toLeaflet)

  return (
    <>
      {polygonInProgress.length >= 3 && (
        <Polygon
          positions={positions}
          pathOptions={{ color: DEFAULT_FEATURE_COLOR, weight: 2, opacity: 0.7, dashArray: '6 4', fillOpacity: 0.1 }}
          interactive={false}
        />
      )}
      {polygonInProgress.length >= 2 && (
        <Polyline
          positions={positions}
          pathOptions={{ color: DEFAULT_FEATURE_COLOR, weight: 2, opacity: 0.7, dashArray: '6 4' }}
          interactive={false}
        />
      )}
      {polygonInProgress.map((coord, i) => {
        const isClosingNode = i === 0 && polygonInProgress.length >= 3
        return (
          <Marker
            key={isClosingNode ? 'closing-node' : `point-${i}`}
            position={toLeaflet(coord)}
            icon={isClosingNode ? closingVertexIcon() : vertexIcon(i === 0)}
            interactive={isClosingNode}
            eventHandlers={
              isClosingNode
                ? {
                    click: (e) => {
                      e.originalEvent.stopPropagation()
                      commitPolygon({})
                    },
                  }
                : undefined
            }
          />
        )
      })}
    </>
  )
}
