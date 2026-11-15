/**
 * MeasurePreviewLayer — renders in-progress + completed measurements into the
 * elm-measure-preview GeoJSON source. Reacts to uiStore measure state and
 * cursor position to show dashed segments, area fill, vertex dots and
 * labels. Label pills (distance/area value + close button) are React portals
 * into the map container anchored to the last placed point / anchor coord.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent, type MapLayerMouseEvent } from 'maplibre-gl'
import { length } from '@turf/length'
import { area } from '@turf/area'
import { lineString, polygon } from '@turf/helpers'
import type { CompletedMeasurement, FormatOpts } from '@element-editor/core'
import { formatLength as fmtLen, formatArea as fmtArea } from '@element-editor/core'
import { useElementEditorConfig } from '@element-editor/ui'
import { useUIStore } from '../store/StoreContext'
import { useStyleEpoch } from '../contexts/StyleEpochContext'
import { emptyFC } from '../utils/geojson'
import { useCursorWhileMode } from '../hooks/useCursorWhileMode'
import { markMeasureClick } from '../utils/measureClickFlag'

const COLOR = '#e74c3c'
const COLOR_HOVER = '#ff2d1a'
const COLOR_SELECTED = '#c0392b'

const SOURCE = 'elm-measure-preview'

// Interactive hit layers — segments (distance mode) + fill (area mode) are hit-tested
// for click/hover on completed measurements
export const MEASURE_INTERACTIVE_LAYERS = [
  'elm-measure-hit-line',
  'elm-measure-hit-fill',
]

export function initMeasurePreviewLayers(map: MapLibreMap) {
  if (map.getSource(SOURCE)) return
  map.addSource(SOURCE, { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection })

  // Completed area fill (semi-transparent)
  map.addLayer({
    id: 'elm-measure-area-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['all', ['==', ['get', '_kind'], 'area'], ['==', ['geometry-type'], 'Polygon']],
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['get', '_selected'], false], COLOR_SELECTED,
        ['boolean', ['get', '_hovered'], false], COLOR_HOVER,
        COLOR,
      ],
      'fill-opacity': [
        'case',
        ['boolean', ['get', '_selected'], false], 0.15,
        ['boolean', ['get', '_hovered'], false], 0.12,
        0.08,
      ],
    },
  })

  // Live in-progress area fill (distinct from completed so state stays simple)
  map.addLayer({
    id: 'elm-measure-live-area',
    type: 'fill',
    source: SOURCE,
    filter: ['all', ['==', ['get', '_kind'], 'live-area'], ['==', ['geometry-type'], 'Polygon']],
    paint: { 'fill-color': COLOR, 'fill-opacity': 0.08 },
  })

  // Solid line (committed segments — including area perimeter and live preview)
  map.addLayer({
    id: 'elm-measure-line',
    type: 'line',
    source: SOURCE,
    filter: ['all',
      ['in', ['get', '_kind'], ['literal', ['segment', 'live-line', 'live-perimeter', 'live-area']]],
      ['==', ['geometry-type'], 'LineString'],
    ],
    paint: {
      'line-color': [
        'case',
        ['boolean', ['get', '_selected'], false], COLOR_SELECTED,
        ['boolean', ['get', '_hovered'], false], COLOR_HOVER,
        COLOR,
      ],
      'line-width': 3,
      'line-opacity': [
        'case',
        ['boolean', ['get', '_selected'], false], 1,
        ['boolean', ['get', '_hovered'], false], 1,
        0.9,
      ],
      // MapLibre dash values are MULTIPLES of line-width (not pixels). At
      // line-width 3, [10, 6] would render as 30px dash / 18px gap — way
      // longer than Leaflet's pixel-based "10 6". Divide by 3 to match.
      'line-dasharray': [3.33, 2],
    },
  })

  // Ghost line from last-placed point to cursor
  map.addLayer({
    id: 'elm-measure-ghost',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', '_kind'], 'ghost'],
    paint: {
      'line-color': COLOR,
      'line-width': 3,
      'line-opacity': 0.45,
      // MapLibre dash values are MULTIPLES of line-width (not pixels). At
      // line-width 3, [10, 6] would render as 30px dash / 18px gap — way
      // longer than Leaflet's pixel-based "10 6". Divide by 3 to match.
      'line-dasharray': [3.33, 2],
    },
  })

  // Closing hint for area mode (cursor → first vertex)
  map.addLayer({
    id: 'elm-measure-close-hint',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', '_kind'], 'close-hint'],
    paint: {
      'line-color': COLOR,
      'line-width': 2,
      'line-opacity': 0.25,
      // line-width is 2 here; pixel-equivalent of leaflet's "6 6" → [3, 3].
      'line-dasharray': [3, 3],
    },
  })

  // Wide invisible hit target on completed segments (distance mode)
  map.addLayer({
    id: 'elm-measure-hit-line',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', '_kind'], 'segment'],
    paint: {
      'line-color': COLOR,
      'line-width': 16,
      'line-opacity': 0,
    },
  })

  // Wide invisible hit target on completed area fills
  map.addLayer({
    id: 'elm-measure-hit-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['all', ['==', ['get', '_kind'], 'area'], ['==', ['geometry-type'], 'Polygon']],
    paint: { 'fill-color': COLOR, 'fill-opacity': 0 },
  })

  // Vertex dots
  map.addLayer({
    id: 'elm-measure-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['all',
      ['==', ['geometry-type'], 'Point'],
      ['!=', ['get', '_isFirst'], true],
    ],
    paint: {
      'circle-radius': 5,
      'circle-color': COLOR,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })

  // First vertex — hollow dot
  map.addLayer({
    id: 'elm-measure-first-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['all',
      ['==', ['geometry-type'], 'Point'],
      ['==', ['get', '_isFirst'], true],
    ],
    paint: {
      'circle-radius': 5,
      'circle-color': '#ffffff',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': COLOR,
    },
  })
}

export function cleanupMeasurePreviewLayers(map: MapLibreMap) {
  for (const id of [
    'elm-measure-first-vertex',
    'elm-measure-vertex',
    'elm-measure-hit-fill',
    'elm-measure-hit-line',
    'elm-measure-close-hint',
    'elm-measure-ghost',
    'elm-measure-line',
    'elm-measure-live-area',
    'elm-measure-area-fill',
  ]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

function setData(map: MapLibreMap, features: GeoJSON.Feature[]) {
  const src = map.getSource(SOURCE) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined
  if (src) src.setData({ type: 'FeatureCollection', features })
}

// Shared DOM segment-distance tooltip (same singleton pattern as feature-name
// tooltip). Exists only while shown: hide removes it, so nothing is left in
// <body> after the layer unmounts.
let _segTipEl: HTMLDivElement | null = null
function showSegTip(text: string, x: number, y: number) {
  if (!_segTipEl) {
    _segTipEl = document.createElement('div')
    _segTipEl.className = 'elm-feature-tooltip'
    _segTipEl.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;transform:translate(-50%,-100%);margin-top:-12px'
    document.body.appendChild(_segTipEl)
  }
  _segTipEl.textContent = text
  moveSegTip(x, y)
}
/** Follow the cursor; no-op when hidden (e.g. hovering an area-mode segment). */
function moveSegTip(x: number, y: number) {
  if (!_segTipEl) return
  _segTipEl.style.left = x + 'px'
  _segTipEl.style.top = y + 'px'
}
function hideSegTip() { _segTipEl?.remove(); _segTipEl = null }

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

function MeasureLabelPortal({
  map,
  position,
  parts,
  onRemove,
}: {
  map: MapLibreMap
  position: [number, number]  // [lng, lat]
  parts: { value: string; unit: string }
  onRemove?: () => void
}) {
  // Anchor the pill via maplibre's own Marker so it rides with the map's
  // camera (smooth during zoom in/out, fixes issue #10). React renders the
  // pill content into the marker's element via createPortal.
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [host] = useState(() => {
    const el = document.createElement('div')
    // Allow the inner close button to receive clicks; the outer host stays
    // pointer-events:none unless onRemove is set (re-applied via the inline
    // style below on each render).
    return el
  })

  useEffect(() => {
    const m = new maplibregl.Marker({
      element: host,
      // 'left' anchor → the host's LEFT edge sits on the latlng. Combined
      // with the offset, the pill begins 12px right of the underlying point.
      anchor: 'left',
      offset: [12, 0],
    })
      .setLngLat(position)
      .addTo(map)
    markerRef.current = m
    return () => { m.remove(); markerRef.current = null }
  }, [map, host])

  // Re-position when the lng/lat changes without rebuilding the marker.
  useEffect(() => {
    markerRef.current?.setLngLat(position)
  }, [position[0], position[1]])

  return createPortal(
    <div
      className="elm-measure-label"
      style={{
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

const CompletedMeasurementLabel = memo(function CompletedMeasurementLabel({
  map, m,
}: {
  map: MapLibreMap
  m: CompletedMeasurement
}) {
  const removeMeasurement = useUIStore(s => s.removeMeasurement)
  const { units } = useElementEditorConfig()
  const lenOpts  = { unit: units.length, display: units.display, precision: units.precision }
  const areaOpts = { unit: units.area,   display: units.display, precision: units.precision }

  const labelParts = useMemo(() => {
    try {
      if (m.mode === 'distance' && m.points.length >= 2)
        return fmtLen(length(lineString(m.points)) * 1000, lenOpts)
      if (m.mode === 'area' && m.points.length >= 3)
        return fmtArea(area(polygon([m.points])), areaOpts)
    } catch { /* suppress turf errors */ }
    return null
  }, [m, lenOpts.unit, lenOpts.display, lenOpts.precision, areaOpts.unit, areaOpts.display, areaOpts.precision])

  const anchorPt = m.mode === 'area' ? m.points[m.points.length - 2] : m.points[m.points.length - 1]

  if (!labelParts || !anchorPt) return null

  return (
    <MeasureLabelPortal
      map={map}
      position={anchorPt}
      parts={labelParts}
      onRemove={() => removeMeasurement(m.id)}
    />
  )
})

interface Props {
  map: MapLibreMap
}

export default function MeasurePreviewLayer({ map }: Props) {
  const styleEpoch = useStyleEpoch()
  const editingMode = useUIStore((s) => s.editingMode)
  const measurePoints = useUIStore((s) => s.measurePoints)
  const measureMode = useUIStore((s) => s.measureMode)
  const completedMeasurements = useUIStore((s) => s.completedMeasurements)
  const selectedMeasurementId = useUIStore((s) => s.selectedMeasurementId)
  const snappedCoord = useUIStore((s) => s.snappedCoord)
  const toggleMeasurementSelection = useUIStore((s) => s.toggleMeasurementSelection)
  const setSelectedMeasurementId = useUIStore((s) => s.setSelectedMeasurementId)

  const mousePos = useCursorWhileMode(map, editingMode, editingMode === 'measure')

  const { units } = useElementEditorConfig()
  const lenOpts  = { unit: units.length, display: units.display, precision: units.precision }
  const areaOpts = { unit: units.area,   display: units.display, precision: units.precision }

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const isActive = editingMode === 'measure'
  const cursorPos = isActive ? (snappedCoord ?? mousePos) : null
  const lastPlaced = measurePoints.length > 0 ? measurePoints[measurePoints.length - 1] : null

  // Rebuild source data whenever any input changes
  useEffect(() => {
    const features: GeoJSON.Feature[] = []

    // Completed measurements
    for (const m of completedMeasurements) {
      const hovered = hoveredId === m.id
      const selected = selectedMeasurementId === m.id

      if (m.mode === 'distance') {
        // Individual segments for per-segment hit + tooltip
        for (let i = 0; i < m.points.length - 1; i++) {
          features.push({
            type: 'Feature',
            properties: { _kind: 'segment', _id: m.id, _segIdx: i, _hovered: hovered, _selected: selected },
            geometry: { type: 'LineString', coordinates: [m.points[i], m.points[i + 1]] },
          })
        }
        const dotPoints = m.points
        dotPoints.forEach((pt, i) => {
          features.push({
            type: 'Feature',
            properties: { _kind: 'dot', _id: m.id, _isFirst: i === 0 },
            geometry: { type: 'Point', coordinates: pt },
          })
        })
      } else {
        // Area mode: closed polygon (m.points already includes closing duplicate)
        features.push({
          type: 'Feature',
          properties: { _kind: 'area', _id: m.id, _hovered: hovered, _selected: selected },
          geometry: { type: 'Polygon', coordinates: [m.points] },
        })
        // Perimeter line
        features.push({
          type: 'Feature',
          properties: { _kind: 'segment', _id: m.id, _hovered: hovered, _selected: selected },
          geometry: { type: 'LineString', coordinates: m.points },
        })
        // Dots (strip closing duplicate)
        const dotPoints = m.points.slice(0, -1)
        dotPoints.forEach((pt, i) => {
          features.push({
            type: 'Feature',
            properties: { _kind: 'dot', _id: m.id, _isFirst: i === 0 },
            geometry: { type: 'Point', coordinates: pt },
          })
        })
      }
    }

    // In-progress
    if (isActive && measurePoints.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { _kind: 'live-line' },
        geometry: { type: 'LineString', coordinates: measurePoints },
      })
    }
    if (isActive && measureMode === 'area' && measurePoints.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { _kind: 'live-area' },
        geometry: { type: 'Polygon', coordinates: [[...measurePoints, measurePoints[0]]] },
      })
    }
    if (isActive && cursorPos && lastPlaced) {
      features.push({
        type: 'Feature',
        properties: { _kind: 'ghost' },
        geometry: { type: 'LineString', coordinates: [lastPlaced, cursorPos] },
      })
    }
    if (isActive && measureMode === 'area' && cursorPos && measurePoints.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { _kind: 'close-hint' },
        geometry: { type: 'LineString', coordinates: [cursorPos, measurePoints[0]] },
      })
    }
    if (isActive) {
      measurePoints.forEach((pt, i) => {
        features.push({
          type: 'Feature',
          properties: { _kind: 'live-dot', _isFirst: i === 0 },
          geometry: { type: 'Point', coordinates: pt },
        })
      })
    }

    setData(map, features)
  }, [
    map,
    isActive,
    measurePoints,
    measureMode,
    completedMeasurements,
    hoveredId,
    selectedMeasurementId,
    cursorPos,
    lastPlaced,
    styleEpoch,
  ])

  // Click / hover on completed measurements
  useEffect(() => {
    const onSegmentClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const id = f.properties?._id as string | undefined
      if (!id) return
      markMeasureClick()
      e.originalEvent.stopPropagation()
      toggleMeasurementSelection(id)
    }

    const onSegmentEnter = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const id = f.properties?._id as string | undefined
      if (!id) return
      setHoveredId(id)

      // Segment distance tooltip — only for distance-mode segments
      const kind = f.properties?._kind as string | undefined
      const segIdx = f.properties?._segIdx
      if (kind === 'segment' && typeof segIdx === 'number') {
        const m = completedMeasurements.find((mm) => mm.id === id)
        if (m && m.mode === 'distance') {
          const a = m.points[segIdx]
          const b = m.points[segIdx + 1]
          if (a && b) {
            const seg = fmtLen(length(lineString([a, b])) * 1000, lenOpts)
            showSegTip(`${seg.value} ${seg.unit}`, e.originalEvent.clientX, e.originalEvent.clientY)
          }
        }
      }
    }

    const onSegmentMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const kind = f.properties?._kind as string | undefined
      if (kind === 'segment') {
        moveSegTip(e.originalEvent.clientX, e.originalEvent.clientY)
      }
    }

    const onSegmentLeave = () => {
      setHoveredId(null)
      hideSegTip()
    }

    const onMapClick = (e: MapMouseEvent) => {
      // Empty-map click deselects. Guarded: during HMR / first-mount race the
      // interactive layers may not exist yet — queryRenderedFeatures throws.
      try {
        const features = map.queryRenderedFeatures(e.point, { layers: MEASURE_INTERACTIVE_LAYERS })
        if (features.length === 0) setSelectedMeasurementId(null)
      } catch { /* layers not yet in style */ }
    }

    for (const layerId of MEASURE_INTERACTIVE_LAYERS) {
      map.on('click', layerId, onSegmentClick)
      map.on('mouseenter', layerId, onSegmentEnter)
      map.on('mousemove', layerId, onSegmentMove)
      map.on('mouseleave', layerId, onSegmentLeave)
    }
    map.on('click', onMapClick)

    return () => {
      for (const layerId of MEASURE_INTERACTIVE_LAYERS) {
        map.off('click', layerId, onSegmentClick)
        map.off('mouseenter', layerId, onSegmentEnter)
        map.off('mousemove', layerId, onSegmentMove)
        map.off('mouseleave', layerId, onSegmentLeave)
      }
      map.off('click', onMapClick)
      hideSegTip()
    }
  }, [map, toggleMeasurementSelection, setSelectedMeasurementId, completedMeasurements, lenOpts.unit, lenOpts.display, lenOpts.precision])

  // Live label (in-progress)
  const minPtsForPreview = measureMode === 'distance' ? 1 : 2
  const livePoints = cursorPos && measurePoints.length >= minPtsForPreview
    ? [...measurePoints, cursorPos]
    : measurePoints
  const liveLabel = calcLabel(livePoints, measureMode, lenOpts, areaOpts)
  const liveLabelAnchor = cursorPos ?? lastPlaced

  return (
    <>
      {completedMeasurements.map((m) => (
        <CompletedMeasurementLabel key={m.id} map={map} m={m} />
      ))}

      {liveLabel && liveLabelAnchor && (
        <MeasureLabelPortal map={map} position={liveLabelAnchor} parts={liveLabel} />
      )}
    </>
  )
}

