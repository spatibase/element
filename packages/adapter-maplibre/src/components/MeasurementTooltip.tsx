/**
 * MeasurementTooltip — absolute-positioned overlay that follows the cursor
 * while the user is drawing, showing the live dimensions (length, area,
 * segment size, coords) of the in-progress geometry. Rendered as a React
 * portal into the map container so z-index stacks above the canvas without
 * relying on a MapLibre popup.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { length } from '@turf/length'
import { area } from '@turf/area'
import { distance } from '@turf/distance'
import { polygon, lineString } from '@turf/helpers'
import { bbox } from '@turf/bbox'
import { formatLength, formatArea } from '@element-editor/core'
import { placeBox } from '@element-editor/core/internal'
import { useElementEditorConfig } from '@element-editor/ui'
import { useUIStore } from '../store/StoreContext'
import { useCursorWhileMode } from '../hooks/useCursorWhileMode'

interface Props {
  map: MapLibreMap
}

export default function MeasurementTooltip({ map }: Props) {
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
  const lineInProgress = useUIStore(s => s.lineInProgress)
  const polygonInProgress = useUIStore(s => s.polygonInProgress)
  const circleCenter = useUIStore(s => s.circleCenter)
  const rectCorner = useUIStore(s => s.rectCorner)
  const freehandPoints = useUIStore(s => s.freehandPoints)
  const freehandClosed = useUIStore(s => s.freehandClosed)
  const routeWaypoints = useUIStore(s => s.routeWaypoints)

  const mousePos = useCursorWhileMode(map, editingMode, editingMode !== 'none')

  // Screen-space tracking — updates on cursor move + map move
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null)
  const cursorLngLat = snappedCoord ?? mousePos

  useEffect(() => {
    if (!cursorLngLat) { setPt(null); return }
    setPt(map.project(cursorLngLat))
    const update = () => setPt(cursorLngLat ? map.project(cursorLngLat) : null)
    map.on('move', update)
    map.on('zoom', update)
    return () => {
      map.off('move', update)
      map.off('zoom', update)
    }
  }, [map, cursorLngLat?.[0], cursorLngLat?.[1]])

  // Measured size of the rendered box, so it can be flipped/clamped inside the
  // map container (which clips it) instead of running off the edge.
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = boxRef.current
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight })
  })

  if (!showMeasurements || editingMode === 'none') return null
  if (!cursorLngLat || !pt) return null

  const lines: { label: string, value: string }[] = []

  try {
    if (editingMode === 'place-point') {
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-line' || editingMode === 'slice-shape') {
      const pts = [...lineInProgress, cursorLngLat]
      if (pts.length >= 2) {
        const line = lineString(pts)
        lines.push({ label: 'Length', value: formatDist(length(line)) })
        lines.push({ label: 'Segment length', value: formatDist(distance(pts[pts.length - 2], pts[pts.length - 1])) })
      }
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-polygon' || editingMode === 'cut-hole') {
      const pts = [...polygonInProgress, cursorLngLat]
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
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-circle') {
      if (circleCenter) {
        const rad = distance(circleCenter, cursorLngLat)
        lines.push({ label: 'Radius', value: formatDist(rad) })
        lines.push({ label: 'Area', value: fmtArea(Math.PI * (rad * 1000) * (rad * 1000)) })
      }
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-rect') {
      if (rectCorner) {
        const widthDist = distance([rectCorner[0], rectCorner[1]], [cursorLngLat[0], rectCorner[1]])
        const heightDist = distance([rectCorner[0], rectCorner[1]], [rectCorner[0], cursorLngLat[1]])
        const boxArea = widthDist * heightDist * 1000000
        lines.push({ label: 'Area', value: fmtArea(boxArea) })
        lines.push({ label: 'Width', value: formatDist(widthDist) })
        lines.push({ label: 'Height', value: formatDist(heightDist) })
      }
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
    }
    else if (editingMode === 'draw-route') {
      const pts = [...routeWaypoints, cursorLngLat]
      if (pts.length >= 2) {
        lines.push({ label: 'Straight distance', value: formatDist(distance(pts[pts.length - 2], pts[pts.length - 1])) })
      }
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
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
      lines.push({ label: '', value: `${cursorLngLat[1].toFixed(6)}, ${cursorLngLat[0].toFixed(6)}` })
    }
  } catch {
    /* Turf threw — fallback safely */
  }

  if (lines.length === 0) return null

  return createPortal(
    <div
      ref={boxRef}
      className="elm-measurement-tooltip"
      style={{
        position: 'absolute',
        ...placeBox(pt.x, pt.y, size.w, size.h, {
          x: 'after', y: 'center', gapX: 20,
          bounds: { left: 0, top: 0, right: map.getContainer().clientWidth, bottom: map.getContainer().clientHeight },
        }),
        zIndex: 700,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        // Light in both modes by default (an on-map label); follows the design tokens once set.
        background: 'var(--elm-surface, white)',
        border: '1px solid var(--elm-border, rgb(229, 231, 235))',
        boxShadow: 'var(--elm-shadow-control, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1))',
        borderRadius: 'calc(var(--elm-radius-control, 6px) + 2px)',
        padding: 12,
        fontSize: 12,
        color: 'var(--elm-text-secondary, rgb(75, 85, 99))',
        fontFamily: 'var(--elm-font, ui-sans-serif, system-ui, sans-serif)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', lineHeight: 1.3 }}>
            {l.label && <span style={{ fontWeight: 600, color: 'var(--elm-text, rgb(17, 24, 39))' }}>{l.label}:</span>}
            <span>{l.value}</span>
          </div>
        ))}
      </div>
    </div>,
    map.getContainer(),
  )
}
