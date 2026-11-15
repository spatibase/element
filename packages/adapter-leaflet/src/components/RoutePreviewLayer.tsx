import { Marker, Polyline, useMap } from 'react-leaflet'
import { useAccentPalette } from '@element-editor/ui'
import { divIcon } from 'leaflet'
import { useUIStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'

function waypointLabel(index: number): string {
  // A, B, C ... Z, AA, AB ...
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (index < 26) return letters[index]
  return letters[Math.floor(index / 26) - 1] + letters[index % 26]
}

function makeWaypointIcon(label: string, isLast: boolean) {
  const bg = isLast ? 'var(--color-primary-700)' : 'var(--color-primary-500)'
  return divIcon({
    className: '',
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${bg};border:2px solid white;
      box-shadow:0 1px 4px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;color:white;font-family:monospace;
      line-height:1;
    ">${label}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

export default function RoutePreviewLayer() {
  const accent = useAccentPalette(useMap().getContainer())
  const editingMode = useUIStore((s) => s.editingMode)
  const routeWaypoints = useUIStore((s) => s.routeWaypoints)
  const routePreview = useUIStore((s) => s.routePreview)
  const routeLoading = useUIStore((s) => s.routeLoading)
  const routeCursorPos = useUIStore((s) => s.routeCursorPos)
  const routeCursorPreview = useUIStore((s) => s.routeCursorPreview)

  if (editingMode !== 'draw-route' || routeWaypoints.length === 0) return null

  // Straight-line fallback shown while loading (or if only 1 waypoint)
  const previewCoords = routePreview ?? routeWaypoints

  // Ghost segment from last waypoint to cursor (snapped if available, straight line otherwise)
  const lastWp = routeWaypoints[routeWaypoints.length - 1]
  const ghostCoords = routeCursorPos
    ? (routeCursorPreview ?? [lastWp, routeCursorPos])
    : null

  return (
    <>
      {/* Committed route line — dashed while loading, solid once snapped */}
      {previewCoords.length >= 2 && (
        <Polyline
          positions={previewCoords.map(toLeaflet)}
          pathOptions={{
            color: accent[700],
            weight: 3,
            opacity: routeLoading ? 0.5 : 0.9,
            dashArray: routeLoading ? '6 6' : undefined,
          }}
        />
      )}

      {/* Ghost segment: last waypoint → cursor */}
      {ghostCoords && ghostCoords.length >= 2 && (
        <Polyline
          positions={ghostCoords.map(toLeaflet)}
          pathOptions={{
            color: accent[700],
            weight: 2,
            opacity: routeCursorPreview ? 0.55 : 0.3,
            dashArray: '6 5',
          }}
        />
      )}

      {/* Waypoint markers */}
      {routeWaypoints.map((wp, i) => (
        <Marker
          key={`wp-${wp[0].toFixed(8)},${wp[1].toFixed(8)}-${i}`}
          position={toLeaflet(wp)}
          icon={makeWaypointIcon(waypointLabel(i), i === routeWaypoints.length - 1)}
          interactive={false}
        />
      ))}
    </>
  )
}
