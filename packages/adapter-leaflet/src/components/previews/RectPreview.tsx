import { divIcon, type LatLngExpression } from 'leaflet'
import { useEffect, useState } from 'react'
import { Marker, Polygon, useMap, useMapEvents } from 'react-leaflet'
import { useAccentPalette } from '@element-editor/ui'
import { useDataStore, useUIStore } from '../../store/StoreContext'
import { makeRectCoords } from '@element-editor/core/internal'
import { toLeaflet } from '../../utils/geojson'
import { useCursorWhileMode } from '../../hooks/useCursorWhileMode'

function vertexIcon() {
  return divIcon({
    className: '',
    html: '<div class="w-2.5 h-2.5 rounded-full border-2 border-white shadow bg-emerald-500"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  })
}

export function RectPreview() {
  const accent500 = useAccentPalette(useMap().getContainer())[500]
  const rectCorner = useUIStore((s) => s.rectCorner)
  const editingMode = useUIStore((s) => s.editingMode)
  const snappedCoord = useUIStore((s) => s.snappedCoord)
  const mouse = useCursorWhileMode(editingMode, editingMode === 'draw-rect')
  const [isShiftDown, setIsShiftDown] = useState(false)

  useMapEvents({
    mousemove(e) {
      if (editingMode === 'draw-rect') setIsShiftDown(e.originalEvent.shiftKey)
    },
  })

  useEffect(() => {
    if (editingMode !== 'draw-rect') {
      setIsShiftDown(false)
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftDown(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftDown(false)
    }
    const targetWindow =
      (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
    targetWindow.addEventListener('keydown', handleKeyDown)
    targetWindow.addEventListener('keyup', handleKeyUp)
    return () => {
      targetWindow.removeEventListener('keydown', handleKeyDown)
      targetWindow.removeEventListener('keyup', handleKeyUp)
    }
  }, [editingMode])

  const mode = useDataStore((s) => s.geometryMode)

  if (editingMode !== 'draw-rect') return null

  const targetCoord = snappedCoord ?? mouse
  let positions: LatLngExpression[] | null = null
  if (rectCorner && targetCoord) {
    positions = makeRectCoords(rectCorner, targetCoord, mode, isShiftDown).map(toLeaflet)
  }

  return (
    <>
      {rectCorner && <Marker position={toLeaflet(rectCorner)} icon={vertexIcon()} interactive={false} />}
      {positions && (
        <Polygon
          positions={positions}
          pathOptions={{
            color: isShiftDown ? '#f472b6' : accent500,
            weight: 2,
            opacity: 0.8,
            dashArray: '6 4',
            fillOpacity: 0.1,
          }}
          interactive={false}
        />
      )}
    </>
  )
}
