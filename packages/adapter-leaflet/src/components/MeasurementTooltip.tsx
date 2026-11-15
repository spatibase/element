import { useEffect, useRef } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import { divIcon } from 'leaflet'
import type { Tooltip as LeafletTooltip } from 'leaflet'
import { useUIStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import { useCursorWhileMode } from '../hooks/useCursorWhileMode'
import { length } from '@turf/length'
import { area } from '@turf/area'
import { distance } from '@turf/distance'
import { polygon, lineString } from '@turf/helpers'
import { bbox } from '@turf/bbox'
import { formatLength, formatArea } from '@element-editor/core'
import { placeBox } from '@element-editor/core/internal'
import { useElementEditorConfig } from '@element-editor/ui'

const transparentIcon = divIcon({ className: 'hidden' })

export default function MeasurementTooltip() {
  const { units } = useElementEditorConfig()
  const lenOpts  = { unit: units.length, display: units.display, precision: units.precision }
  const areaOpts = { unit: units.area,   display: units.display, precision: units.precision }
  const formatDist = (km: number) => {
    const { value, unit } = formatLength(km * 1000, lenOpts)
    return `${value} ${unit}`
  }
  const fmtArea = (m2: number) => {
    const { value, unit } = formatArea(m2, areaOpts)
    return `${value} ${unit}`
  }
  const showMeasurements = useUIStore(s => s.showMeasurements)
  const editingMode = useUIStore(s => s.editingMode)
  const snappedCoord = useUIStore(s => s.snappedCoord)
  const mousePos = useCursorWhileMode(editingMode, editingMode !== 'none')

  const lineInProgress = useUIStore(s => s.lineInProgress)
  const polygonInProgress = useUIStore(s => s.polygonInProgress)
  const circleCenter = useUIStore(s => s.circleCenter)
  const rectCorner = useUIStore(s => s.rectCorner)
  const freehandPoints = useUIStore(s => s.freehandPoints)
  const freehandClosed = useUIStore(s => s.freehandClosed)
  const routeWaypoints = useUIStore(s => s.routeWaypoints)

  // Leaflet pins the tooltip right of the cursor and the map container clips
  // it. After every render, nudge it back inside (flip left near the right
  // edge, clamp vertically) via margins — Leaflet owns its transform.
  const map = useMap()
  const tooltipRef = useRef<LeafletTooltip>(null)
  useEffect(() => {
    const el = tooltipRef.current?.getElement()
    const cursor = snappedCoord ?? mousePos
    if (!el || !cursor) return
    el.style.margin = '0'
    const box = el.getBoundingClientRect()
    const c = map.getContainer().getBoundingClientRect()
    const p = map.latLngToContainerPoint(toLeaflet(cursor))
    const { left, top } = placeBox(c.left + p.x, c.top + p.y, box.width, box.height, { x: 'after', y: 'center', gapX: 20, bounds: c })
    el.style.marginLeft = `${left - box.left}px`
    el.style.marginTop = `${top - box.top}px`
  })

  if (!showMeasurements || editingMode === 'none') return null

  const cursorPos = snappedCoord ?? mousePos
  if (!cursorPos) return null

  const lines: { label: string, value: string }[] = []

  try {
    if (editingMode === 'place-point') {
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-line' || editingMode === 'slice-shape') {
      const pts = [...lineInProgress, cursorPos]
      if (pts.length >= 2) {
        const line = lineString(pts)
        lines.push({ label: 'Length', value: formatDist(length(line)) })
        lines.push({ label: 'Segment length', value: formatDist(distance(pts[pts.length - 2], pts[pts.length - 1])) })
      }
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-polygon' || editingMode === 'cut-hole') {
      const pts = [...polygonInProgress, cursorPos]
      if (pts.length >= 3) {
        const ring = [...pts, pts[0]]
        const poly = polygon([ring])
        lines.push({ label: 'Area', value: fmtArea(area(poly)) })
        lines.push({ label: 'Perimeter', value: formatDist(length(poly)) })

        const box = bbox(poly)
        lines.push({ label: 'Height', value: formatDist(distance([box[0], box[1]], [box[0], box[3]])) })
        lines.push({ label: 'Width', value: formatDist(distance([box[0], box[1]], [box[2], box[1]])) })
      } else if (pts.length === 2) {
        lines.push({ label: 'Segment length', value: formatDist(distance(pts[0], pts[1])) })
      }
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-circle') {
      if (circleCenter) {
        const rad = distance(circleCenter, cursorPos)
        lines.push({ label: 'Radius', value: formatDist(rad) })
        lines.push({ label: 'Area', value: fmtArea(Math.PI * (rad * 1000) * (rad * 1000)) })
      }
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-rect') {
      if (rectCorner) {
        const widthDist = distance([rectCorner[0], rectCorner[1]], [cursorPos[0], rectCorner[1]])
        const heightDist = distance([rectCorner[0], rectCorner[1]], [rectCorner[0], cursorPos[1]])
        const boxArea = widthDist * heightDist * 1000000
        lines.push({ label: 'Area', value: fmtArea(boxArea) })
        lines.push({ label: 'Width', value: formatDist(widthDist) })
        lines.push({ label: 'Height', value: formatDist(heightDist) })
      }
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-route') {
      const pts = [...routeWaypoints, cursorPos]
      if (pts.length >= 2) {
        lines.push({ label: 'Straight distance', value: formatDist(distance(pts[pts.length - 2], pts[pts.length - 1])) })
      }
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-freehand') {
      if (freehandPoints.length >= 3 && freehandClosed) {
        const ring = [...freehandPoints, freehandPoints[0]]
        const poly = polygon([ring])
        lines.push({ label: 'Area', value: fmtArea(area(poly)) })
        lines.push({ label: 'Perimeter', value: formatDist(length(poly)) })
      } else if (freehandPoints.length >= 2) {
        const line = lineString(freehandPoints)
        lines.push({ label: 'Length', value: formatDist(length(line)) })
      }
      lines.push({ label: '', value: `${cursorPos[1].toFixed(6)}, ${cursorPos[0].toFixed(6)}` })
    }
  } catch (e) {
    // Math threw, fallback safely
  }

  if (lines.length === 0) return null

  return (
    <Marker position={toLeaflet(cursorPos)} icon={transparentIcon} interactive={false} zIndexOffset={99999}>
      <Tooltip ref={tooltipRef} permanent direction="right" offset={[20, 0]} className="before:!hidden !bg-(--elm-surface,var(--color-white)) !border !border-(--elm-border,var(--color-gray-200)) !shadow-elm-control !rounded-elm-card !p-3 !text-xs !text-(--elm-text-secondary,var(--color-gray-600)) !font-elm pointer-events-none !whitespace-nowrap">
        <div className="space-y-1 text-left">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 items-center leading-snug">
              {l.label && <span className="font-semibold text-(--elm-text,var(--color-gray-900))">{l.label}:</span>}
              <span>{l.value}</span>
            </div>
          ))}
        </div>
      </Tooltip>
    </Marker>
  )
}

