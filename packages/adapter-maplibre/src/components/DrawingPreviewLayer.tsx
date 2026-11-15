/**
 * DrawingPreviewLayer — renders in-progress drawing geometry into the
 * elm-preview GeoJSON source. Reacts to UIStore drawing state changes and
 * mouse cursor position to show a live preview of the shape being drawn.
 */
import { useEffect, useRef } from 'react'
import { paintAccent, useAccentPaint, type AccentPaint } from '../utils/accentPaint'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { useUIStore, useGeoStore } from '../store/StoreContext'
import { makeCircleCoords, makeRectCoords } from '@element-editor/core/internal'
import type { UIStore } from '@element-editor/core'
import { emptyFC } from '../utils/geojson'
import { snapToAngle } from '../utils/snapping'
import { useDataStore } from '../store/StoreContext'

/** Return a stable key that changes only when drawing-related state changes. */
function drawingSnapshot(s: UIStore): string {
  return `${s.editingMode}|${s.lineInProgress.length}|${s.polygonInProgress.length}|${s.circleCenter}|${s.rectCorner}|${s.routeWaypoints.length}|${s.routePreview?.length ?? 0}|${s.routeCursorPreview?.length ?? 0}|${s.freehandPoints.length}`
}

const SOURCE = 'elm-preview'

const ACCENT_PAINT: AccentPaint = [
  ['elm-preview-fill', 'fill-color', (p) => p[500]],
  ['elm-preview-line', 'line-color', (p) => p[500]],
  ['elm-preview-vertex', 'circle-color', (p) => p[500]],
]

export function initPreviewLayers(map: MapLibreMap) {
  if (map.getSource(SOURCE)) return

  map.addSource(SOURCE, { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection })

  map.addLayer({
    id: 'elm-preview-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-opacity': 0.13 },
  })

  map.addLayer({
    id: 'elm-preview-line',
    type: 'line',
    source: SOURCE,
    filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
    paint: { 'line-width': 2, 'line-dasharray': [4, 3] },
  })

  map.addLayer({
    id: 'elm-preview-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', '_isFirst'], true]],
    paint: {
      'circle-radius': 5,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })

  // First vertex gets a green accent
  map.addLayer({
    id: 'elm-preview-first-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', '_isFirst'], true],
    paint: {
      'circle-radius': 7,
      'circle-color': '#22c55e',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
  paintAccent(map, ACCENT_PAINT)
}

export function cleanupPreviewLayers(map: MapLibreMap) {
  for (const id of ['elm-preview-first-vertex', 'elm-preview-vertex', 'elm-preview-line', 'elm-preview-fill']) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

function setPreviewData(map: MapLibreMap, features: GeoJSON.Feature[]) {
  const src = map.getSource(SOURCE) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined
  if (src) src.setData({ type: 'FeatureCollection', features })
}

interface Props {
  map: MapLibreMap
}

export default function DrawingPreviewLayer({ map }: Props) {
  useAccentPaint(map, ACCENT_PAINT)
  const { uiStore, dataStore } = useGeoStore()
  const editingMode = useUIStore((s) => s.editingMode)
  const geometryMode = useDataStore((s) => s.geometryMode)
  const geometryModeRef = useRef(geometryMode)
  useEffect(() => { geometryModeRef.current = geometryMode }, [geometryMode])
  const cursorRef = useRef<[number, number] | null>(null)
  const isShiftRef = useRef(false)

  // Track cursor position and shift key via map events
  useEffect(() => {
    const onMousemove = (e: MapMouseEvent) => {
      cursorRef.current = [e.lngLat.lng, e.lngLat.lat]
      buildPreview()
    }
    const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftRef.current = true }
    const onKeyup = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftRef.current = false }

    map.on('mousemove', onMousemove)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('keyup', onKeyup)

    return () => {
      map.off('mousemove', onMousemove)
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Rebuild preview only when drawing-related state changes
  useEffect(() => {
    let prev = drawingSnapshot(uiStore.getState())
    const unsub = uiStore.subscribe((state) => {
      const next = drawingSnapshot(state)
      if (next !== prev) {
        prev = next
        buildPreview()
      }
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiStore])

  // Clear when drawing mode ends. Also invalidate the cached cursor on *any*
  // mode change so an exit-then-re-enter (e.g. press R after drawing a rect)
  // doesn't render the preview at the previous session's cursor before the
  // next mousemove fires.
  useEffect(() => {
    cursorRef.current = null
    if (editingMode === 'none') {
      setPreviewData(map, [])
    }
  }, [editingMode, map])

  function buildPreview() {
    const s = uiStore.getState()
    const cursor = cursorRef.current
    const features: GeoJSON.Feature[] = []

    if (s.editingMode === 'draw-line' || s.editingMode === 'slice-shape') {
      const verts = s.lineInProgress
      if (verts.length === 0) return setPreviewData(map, [])
      let tail = cursor ?? verts[verts.length - 1]
      if (isShiftRef.current && verts.length >= 1) {
        tail = snapToAngle(map, verts[verts.length - 1], tail)
      }
      const coords = [...verts, tail]
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
      verts.forEach((v, i) => {
        features.push({ type: 'Feature', properties: { _isFirst: i === 0 }, geometry: { type: 'Point', coordinates: v } })
      })
    }

    if (s.editingMode === 'draw-polygon' || s.editingMode === 'cut-hole') {
      const verts = s.polygonInProgress
      if (verts.length === 0) return setPreviewData(map, [])
      let tail = cursor ?? verts[verts.length - 1]
      if (isShiftRef.current && verts.length >= 1) {
        tail = snapToAngle(map, verts[verts.length - 1], tail)
      }
      const ring = [...verts, tail, verts[0]]
      if (verts.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })
      } else {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } })
      }
      verts.forEach((v, i) => {
        features.push({ type: 'Feature', properties: { _isFirst: i === 0 }, geometry: { type: 'Point', coordinates: v } })
      })
    }

    if (s.editingMode === 'draw-circle') {
      const center = s.circleCenter
      if (!center) return setPreviewData(map, [])
      const edge = cursor ?? center
      const circleCoords = makeCircleCoords(center, edge, geometryModeRef.current, 64)
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleCoords] } })
      features.push({ type: 'Feature', properties: { _isFirst: true }, geometry: { type: 'Point', coordinates: center } })
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: edge } })
    }

    if (s.editingMode === 'draw-rect') {
      const corner = s.rectCorner
      if (!corner) return setPreviewData(map, [])
      const opp = cursor ?? corner
      const ring = makeRectCoords(corner, opp, geometryModeRef.current, isShiftRef.current)
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })
    }

    if (s.editingMode === 'draw-route') {
      const wps = s.routeWaypoints
      if (wps.length === 0) return setPreviewData(map, [])
      const routeCoords = s.routePreview ?? wps
      if (routeCoords.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } })
      }
      const cursorSeg = s.routeCursorPreview ?? (cursor ? [wps[wps.length - 1], cursor] : null)
      if (cursorSeg && cursorSeg.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: cursorSeg } })
      }
      wps.forEach((v, i) => {
        features.push({ type: 'Feature', properties: { _isFirst: i === 0 }, geometry: { type: 'Point', coordinates: v } })
      })
    }

    if (s.editingMode === 'draw-freehand') {
      const pts = s.freehandPoints
      if (pts.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } })
      }
    }

    setPreviewData(map, features)
  }

  return null
}
