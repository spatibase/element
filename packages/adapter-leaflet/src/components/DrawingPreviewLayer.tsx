import { useState, useEffect } from 'react'
import { Polyline, useMap } from 'react-leaflet'
import { useMapEvents } from 'react-leaflet'
import { useUIStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import { snapToAngle } from '../utils/snapping'
import { useAccentPalette } from '@element-editor/ui'

export default function DrawingPreviewLayer() {
  const map = useMap()
  const accent500 = useAccentPalette(map.getContainer())[500]
  const editingMode = useUIStore((s) => s.editingMode)
  const lineInProgress = useUIStore((s) => s.lineInProgress)
  const polygonInProgress = useUIStore((s) => s.polygonInProgress)
  const freehandPoints = useUIStore((s) => s.freehandPoints)
  const freehandClosed = useUIStore((s) => s.freehandClosed)
  const snappedCoord = useUIStore((s) => s.snappedCoord)
  const [mousePos, setMousePos] = useState<[number, number] | null>(null)
  const [isShiftDown, setIsShiftDown] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setIsShiftDown(true) }
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setIsShiftDown(false) }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useMapEvents({
    mousemove(e) {
      if (editingMode === 'draw-line' || editingMode === 'draw-polygon' || editingMode === 'slice-shape' || editingMode === 'cut-hole') {
        setMousePos([e.latlng.lng, e.latlng.lat])
        setIsShiftDown(e.originalEvent.shiftKey)
      } else if (mousePos) {
        setMousePos(null)
      }
    },
    mouseout() { setMousePos(null) },
  })

  let cursorPos = snappedCoord ?? mousePos
  let lastPoint: [number, number] | null = null

  if ((editingMode === 'draw-line' || editingMode === 'slice-shape') && lineInProgress.length >= 1) {
    lastPoint = lineInProgress[lineInProgress.length - 1]
  } else if ((editingMode === 'draw-polygon' || editingMode === 'cut-hole') && polygonInProgress.length >= 1) {
    lastPoint = polygonInProgress[polygonInProgress.length - 1]
  }

  const isAngleSnapping = isShiftDown && lastPoint !== null && cursorPos !== null
  if (isAngleSnapping && lastPoint && cursorPos) {
    cursorPos = snapToAngle(map, lastPoint, cursorPos, 15)
  }

    if (editingMode === 'draw-freehand' && freehandPoints.length >= 2) {
      const first = freehandPoints[0]
      const last = freehandPoints[freehandPoints.length - 1]
      return (
        <>
          {/* Drawn path */}
          <Polyline
            positions={freehandPoints.map(toLeaflet)}
            pathOptions={{ color: accent500, weight: 2, opacity: 0.8 }}
            interactive={false}
          />
          {/* Closing edge: last point → first point */}
          {freehandClosed && (
            <Polyline
              positions={[toLeaflet(last), toLeaflet(first)]}
              pathOptions={{ color: accent500, weight: 2, opacity: 0.4, dashArray: '6 5' }}
              interactive={false}
            />
          )}
        </>
      )
    }

  if (!cursorPos) return null

  // Use a vibrant pink/fuchsia to clearly indicate the 15-deg constraint is active
  const previewColor = isAngleSnapping ? '#db2777' : accent500
  const polyPreviewColor = isAngleSnapping ? '#db2777' : accent500

  if ((editingMode === 'draw-line' || editingMode === 'slice-shape') && lastPoint) {
    return (
      <Polyline
        positions={[toLeaflet(lastPoint), toLeaflet(cursorPos)]}
        pathOptions={{ color: previewColor, weight: 2, opacity: 0.4, dashArray: '6 5' }}
          interactive={false}
      />
    )
  }

  if ((editingMode === 'draw-polygon' || editingMode === 'cut-hole') && lastPoint) {
    const first = polygonInProgress[0]
    return (
      <>
        {/* Forward edge: last vertex → cursor */}
        <Polyline
          positions={[toLeaflet(lastPoint), toLeaflet(cursorPos)]}
          pathOptions={{ color: polyPreviewColor, weight: 2, opacity: 0.4, dashArray: '6 5' }}
            interactive={false}
        />
        {/* Closing edge: cursor → first vertex (shown once shape has ≥2 points) */}
        {polygonInProgress.length >= 2 && (
          <Polyline
            positions={[toLeaflet(cursorPos), toLeaflet(first)]}
            pathOptions={{ color: polyPreviewColor, weight: 2, opacity: 0.25, dashArray: '4 6' }}
              interactive={false}
          />
        )}
      </>
    )
  }

  return null
}
