import { memo, useMemo, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Polyline, Polygon, Marker, useMapEvents, useMap } from 'react-leaflet'
import { divIcon, marker as leafletMarker } from 'leaflet'
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import { useUIStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import { length } from '@turf/length'
import { area } from '@turf/area'
import { lineString, polygon } from '@turf/helpers'
import type { CompletedMeasurement } from '@element-editor/core'
import { formatLength as fmtLen, formatArea as fmtArea } from '@element-editor/core'
import { useElementEditorConfig } from '@element-editor/ui'
import { markMeasureClick } from '../utils/measureClickFlag'
import { useCursorWhileMode } from '../hooks/useCursorWhileMode'

const COLOR = '#e74c3c'
const COLOR_HOVER = '#ff2d1a'
const COLOR_SELECTED = '#c0392b'

// Pre-computed Leaflet icons — avoids allocating new DivIcon objects on every render
const ICON_HOLLOW = divIcon({
  className: '',
  html: `<div style="width:10px;height:10px;border-radius:50%;border:2.5px solid ${COLOR};background:white;box-shadow:0 1px 4px rgba(0,0,0,0.25)"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
})
const ICON_SOLID = divIcon({
  className: '',
  html: `<div style="width:10px;height:10px;border-radius:50%;background:${COLOR};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25)"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
})

// Formatters live in @element-editor/core; this layer reads units config below
// inside the component so the hook can run.

// Shared DOM tooltip element (same singleton pattern as feature-name tooltip).
// Exists only while shown: hide removes the element and its mousemove listener.
let _segTipEl: HTMLDivElement | null = null

function followCursor(ev: MouseEvent) {
  if (!_segTipEl) return
  _segTipEl.style.left = ev.clientX + 'px'
  _segTipEl.style.top = ev.clientY + 'px'
}

function showSegTip(text: string, x: number, y: number) {
  if (!_segTipEl) {
    _segTipEl = document.createElement('div')
    _segTipEl.className = 'elm-feature-tooltip'
    _segTipEl.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;transform:translate(-50%,-100%);margin-top:-12px'
    document.body.appendChild(_segTipEl)
    document.addEventListener('mousemove', followCursor, { passive: true })
  }
  _segTipEl.textContent = text
  _segTipEl.style.left = x + 'px'
  _segTipEl.style.top = y + 'px'
}

function hideSegTip() {
  if (!_segTipEl) return
  _segTipEl.remove()
  _segTipEl = null
  document.removeEventListener('mousemove', followCursor)
}

import type { FormatOpts } from '@element-editor/core'

// Computes label for in-progress (open) point arrays.
// For area, pts must NOT include the closing point — this function adds it.
// For completed measurements use labelParts computed from m.points directly.
function calcLabel(
  pts: [number, number][],
  mode: 'distance' | 'area',
  lenOpts: FormatOpts,
  areaOpts: FormatOpts,
): { value: string; unit: string } | null {
  try {
    if (mode === 'distance' && pts.length >= 2) return fmtLen(length(lineString(pts)) * 1000, lenOpts)
    if (mode === 'area' && pts.length >= 3) return fmtArea(area(polygon([[...pts, pts[0]]])), areaOpts)
  } catch { /* suppress turf math errors */ }
  return null
}

// Empty divIcon used as a positioning host for the pill. Leaflet's marker
// machinery handles all latLng → pixel conversion AND zoom-animation, so the
// pill rides smoothly with the underlying line during zoom in/out instead of
// jumping to the new position only after the animation completes (issue #10).
// The 12px right offset / vertical centering is encoded as `iconAnchor`.
const PILL_HOST_ICON = divIcon({
  className: 'elm-measure-label-host',
  html: '',
  iconSize: [0, 0],
  iconAnchor: [-12, 0],  // shifts the host's anchor 12px LEFT, so the content sits 12px RIGHT of the latlng
})

function MeasureLabelPortal({
  map,
  position,
  parts,
  onRemove,
}: {
  map: LeafletMap
  position: [number, number]  // [lng, lat]
  parts: { value: string; unit: string }
  onRemove?: () => void
}) {
  const markerRef = useRef<LeafletMarker | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const m = leafletMarker([position[1], position[0]], {
      icon: PILL_HOST_ICON,
      // Always interactive=false on the marker itself; the close button below
      // gets pointer-events:auto via CSS so it can still be clicked.
      interactive: false,
      keyboard: false,
      zIndexOffset: 700,
    }).addTo(map)
    markerRef.current = m
    setHost(m.getElement() ?? null)
    return () => {
      m.remove()
      markerRef.current = null
      setHost(null)
    }
  }, [map])

  // Re-position when the latLng prop changes without rebuilding the marker.
  useEffect(() => {
    markerRef.current?.setLatLng([position[1], position[0]])
  }, [position[0], position[1]])

  if (!host) return null

  return createPortal(
    <div
      className="elm-measure-label"
      style={{
        // Vertically centre the pill on the latLng. Horizontal offset comes
        // from the icon's iconAnchor (-12,0).
        transform: 'translateY(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        pointerEvents: onRemove ? 'auto' : 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span>
        <span style={{ fontWeight: 600 }}>{parts.value}</span>
        <span style={{ fontWeight: 400, opacity: 0.85 }}> {parts.unit}</span>
      </span>
      {onRemove && (
        <button
          className="elm-measure-close"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Clear measurement"
          style={{ marginRight: '-5px' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/>
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/>
          </svg>
        </button>
      )}
    </div>,
    host,
  )
}

/** Renders one completed measurement. Subscribes to its own Zustand slices so
 *  it only re-renders when its own selection state changes, not on cursor move. */
const CompletedMeasurementLayer = memo(function CompletedMeasurementLayer({
  map, m,
}: {
  map: LeafletMap
  m: CompletedMeasurement
}) {
  const removeMeasurement = useUIStore(s => s.removeMeasurement)
  const toggleMeasurementSelection = useUIStore(s => s.toggleMeasurementSelection)
  const selected = useUIStore(s => s.selectedMeasurementId === m.id)
  const [hovered, setHovered] = useState(false)
  const { units } = useElementEditorConfig()
  const lenOpts  = { unit: units.length, display: units.display, precision: units.precision }
  const areaOpts = { unit: units.area,   display: units.display, precision: units.precision }

  // Hide segment tooltip if this measurement is unmounted while hovered
  useEffect(() => () => hideSegTip(), [])

  const labelParts = useMemo(() => {
    try {
      if (m.mode === 'distance' && m.points.length >= 2)
        return fmtLen(length(lineString(m.points)) * 1000, lenOpts)
      // m.points for area already includes the closing coord (added by completeMeasure)
      if (m.mode === 'area' && m.points.length >= 3)
        return fmtArea(area(polygon([m.points])), areaOpts)
    } catch { /* suppress turf errors */ }
    return null
  }, [m, lenOpts.unit, lenOpts.display, lenOpts.precision, areaOpts.unit, areaOpts.display, areaOpts.precision])

  // For area, last point is the closing duplicate — anchor label to second-to-last
  const anchorPt = m.mode === 'area' ? m.points[m.points.length - 2] : m.points[m.points.length - 1]
  const dotPoints = m.mode === 'area' ? m.points.slice(0, -1) : m.points

  const strokeColor = selected ? COLOR_SELECTED : hovered ? COLOR_HOVER : COLOR
  const strokeOpacity = selected || hovered ? 1 : 0.9

  const handleClick = (e: { originalEvent: Event }) => {
    markMeasureClick()
    e.originalEvent.stopPropagation()
    toggleMeasurementSelection(m.id)
  }

  return (
    <>
      {/* Invisible wide hit area (weight:16) — generously catchs clicks/hover */}
      {m.mode === 'distance'
        ? m.points.slice(0, -1).map((pt, i) => {
            const next = m.points[i + 1]
            const seg = fmtLen(length(lineString([pt, next])) * 1000, lenOpts)
            const tipText = `${seg.value} ${seg.unit}`
            return (
              <Polyline
                key={`seg-${i}`}
                positions={[toLeaflet(pt), toLeaflet(next)]}
                pathOptions={{ color: COLOR, weight: 16, opacity: 0, className: 'elm-measure-segment' } as object}
                interactive={true}
                eventHandlers={{
                  mouseover: (e) => { setHovered(true); showSegTip(tipText, (e.originalEvent as MouseEvent).clientX, (e.originalEvent as MouseEvent).clientY) },
                  mouseout: () => { setHovered(false); hideSegTip() },
                  click: handleClick,
                }}
              />
            )
          })
        : (
          <Polyline
            positions={m.points.map(toLeaflet)}
            pathOptions={{ color: COLOR, weight: 16, opacity: 0 } as object}
            interactive={true}
            eventHandlers={{
              mouseover: () => setHovered(true),
              mouseout: () => setHovered(false),
              click: handleClick,
            }}
          />
        )
      }

      {/* Visible decorative line */}
      <Polyline
        positions={m.points.map(toLeaflet)}
        pathOptions={{ color: strokeColor, weight: 3, opacity: strokeOpacity, dashArray: '10 6' } as object}
        interactive={false}
      />

      {m.mode === 'area' && m.points.length >= 3 && (
        <Polygon
          positions={m.points.map(toLeaflet)}
          pathOptions={{ color: strokeColor, weight: 0, fillColor: strokeColor, fillOpacity: selected ? 0.15 : hovered ? 0.12 : 0.08 }}
          interactive={true}
          eventHandlers={{
            click: handleClick,
            mouseover: () => setHovered(true),
            mouseout: () => setHovered(false),
          }}
        />
      )}

      {dotPoints.map((pt, i) => (
        <Marker
          key={i}
          position={toLeaflet(pt)}
          icon={i === 0 ? ICON_HOLLOW : ICON_SOLID}
          interactive={false}
          zIndexOffset={1000 + i}
        />
      ))}

      {labelParts && anchorPt && (
        <MeasureLabelPortal
          map={map}
          position={anchorPt}
          parts={labelParts}
          onRemove={() => removeMeasurement(m.id)}
        />
      )}
    </>
  )
})

export default function MeasurePreviewLayer() {
  const map = useMap()
  const editingMode = useUIStore((s) => s.editingMode)
  const measurePoints = useUIStore((s) => s.measurePoints)
  const measureMode = useUIStore((s) => s.measureMode)
  const completedMeasurements = useUIStore((s) => s.completedMeasurements)
  const snappedCoord = useUIStore((s) => s.snappedCoord)
  const setSelectedMeasurementId = useUIStore((s) => s.setSelectedMeasurementId)
  const mousePos = useCursorWhileMode(editingMode, editingMode === 'measure')
  const { units } = useElementEditorConfig()
  const lenOpts  = { unit: units.length, display: units.display, precision: units.precision }
  const areaOpts = { unit: units.area,   display: units.display, precision: units.precision }

  useMapEvents({
    click(e) {
      // Clicking on empty map deselects; path clicks are handled by CompletedMeasurementLayer
      if ((e.originalEvent.target as Element)?.closest?.('path')) return
      setSelectedMeasurementId(null)
    },
  })

  const isActive = editingMode === 'measure'
  if (!isActive && measurePoints.length === 0 && completedMeasurements.length === 0) return null

  const cursorPos = isActive ? (snappedCoord ?? mousePos) : null
  const lastPlaced = measurePoints.length > 0 ? measurePoints[measurePoints.length - 1] : null

  const minPtsForPreview = measureMode === 'distance' ? 1 : 2
  const livePoints = cursorPos && measurePoints.length >= minPtsForPreview
    ? [...measurePoints, cursorPos]
    : measurePoints
  const liveLabel = calcLabel(livePoints, measureMode, lenOpts, areaOpts)
  const liveLabelAnchor = cursorPos ?? lastPlaced

  return (
    <>
      {completedMeasurements.map((m) => (
        <CompletedMeasurementLayer key={m.id} map={map} m={m} />
      ))}

      {measurePoints.length >= 2 && (
        <Polyline
          positions={measurePoints.map(toLeaflet)}
          pathOptions={{ color: COLOR, weight: 3, opacity: 0.9, dashArray: '10 6' } as object}
          interactive={false}
        />
      )}

      {measureMode === 'area' && measurePoints.length >= 3 && (
        <Polygon
          positions={measurePoints.map(toLeaflet)}
          pathOptions={{ color: COLOR, weight: 0, fillColor: COLOR, fillOpacity: 0.08 }}
          interactive={false}
        />
      )}

      {cursorPos && lastPlaced && (
        <Polyline
          positions={[toLeaflet(lastPlaced), toLeaflet(cursorPos)]}
          pathOptions={{ color: COLOR, weight: 3, opacity: 0.45, dashArray: '10 6' } as object}
          interactive={false}
        />
      )}

      {measureMode === 'area' && cursorPos && measurePoints.length >= 2 && (
        <Polyline
          positions={[toLeaflet(cursorPos), toLeaflet(measurePoints[0])]}
          pathOptions={{ color: COLOR, weight: 2, opacity: 0.25, dashArray: '6 6' }}
          interactive={false}
        />
      )}

      {measurePoints.map((pt, i) => (
        <Marker
          key={i}
          position={toLeaflet(pt)}
          icon={i === 0 ? ICON_HOLLOW : ICON_SOLID}
          interactive={false}
          zIndexOffset={1000 + i}
        />
      ))}

      {liveLabel && liveLabelAnchor && (
        <MeasureLabelPortal map={map} position={liveLabelAnchor} parts={liveLabel} />
      )}
    </>
  )
}
