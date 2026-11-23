import { Check, Crosshair, Trash } from '@phosphor-icons/react'
import L from 'leaflet'
import { divIcon, type LeafletEvent, type LeafletMouseEvent, type Marker as LMarker } from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Polygon as RLPolygon, Polyline as RLPolyline, Popup, useMap, useMapEvents } from 'react-leaflet'
import { ContextMenu, useEmit, useIsEventForEditor } from '@element-editor/ui'
import { useTouchInput } from '@element-editor/ui/internal'
import { useDataStore, useGeoStore } from '../../store/StoreContext'
import type { GeoJSONFeature } from '@element-editor/core'
import {
  findTopologicalNeighbors,
  groupNeighborsByFeature,
  applyTopoMove,
  neighbourPatch,
  commitTopoMove,
  commitTopoInsert,
  commitTopoDelete,
  insertedPosition,
  vertexEditPatch,
  withXY,
  attachLongPress,
  TOUCH_HANDLE_CSS,
  type NeighborVertex,
} from '@element-editor/core/internal'
import { toLeaflet } from '../../utils/geojson'
import { useHandleVars } from '../featureLayers/shared'
import { findSnapPoint } from '../../utils/snapping'
import { setFeatureDragActive } from '../../utils/featureTooltip'
import { rafThrottle } from '../../utils/rafThrottle'

type VertexEditorProps = {
  feature: GeoJSONFeature
  selectedIndices: number[]
  onExit: () => void
  onDeleteSelected: () => void
  /** Replace the point selection (FeatureInteractionLayer owns it). */
  onSelectIndices: (indices: number[]) => void
  onFeatureClick: () => void
  readonly: boolean
}

// --- Icons ---
// Hoisted as module constants — rebuilding divIcon per vertex on every render was
// the audit's #7 hot path (up to 500 vertices × every pan/zoom of a selected polygon).

let stylesInjected = false
function ensureStyles() {
  if (stylesInjected) return
  const s = document.createElement('style')
  s.textContent = [
    '.elm-midpoint-marker{pointer-events:auto!important}',
    '.elm-vertex:hover{background:var(--elm-handle-soft,var(--color-primary-100))!important}',
    '.elm-midpoint-marker:hover .elm-mid{background:var(--elm-handle-soft,var(--color-primary-100))!important}',
    TOUCH_HANDLE_CSS,
  ].join('')
  document.head.appendChild(s)
  stylesInjected = true
}

const VERTEX_ICON_DEFAULT = divIcon({
  className: '',
  html: `<div class="elm-vertex" style="width:12px;height:12px;background:#ffffff;border:2px solid var(--elm-handle,var(--color-primary-500));border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;transition:background 0.15s"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

const VERTEX_ICON_SELECTED = divIcon({
  className: '',
  html: `<div class="elm-vertex" style="width:12px;height:12px;background:var(--elm-handle,var(--color-primary-500));border:2px solid var(--elm-handle-strong,var(--color-primary-700));border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;transition:background 0.15s"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

const MIDPOINT_ICON = divIcon({
  className: 'elm-midpoint-marker',
  html: '<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer" class="group"><div class="elm-mid" style="width:12px;height:12px;transform:rotate(45deg);border-radius:3px;background:#fff;border:2px solid var(--elm-handle,var(--color-primary-500));box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:background 0.15s"></div></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

if (typeof document !== 'undefined') ensureStyles()

// --- Geometry helpers ---

const DEG = Math.PI / 180
const MAX_LAT = 85.0511287798 // Leaflet's SphericalMercator clamp

/** Web Mercator in radians. Leaflet's pixel space is this times `crs.scale(zoom) / 2π`,
 *  so distances (and arc-length strides) computed here match pixel-space ones exactly. */
function mercY(lat: number): number {
  const l = Math.max(Math.min(lat, MAX_LAT), -MAX_LAT)
  return Math.log(Math.tan(Math.PI / 4 + (l * DEG) / 2))
}

/** Picks up to `cap` items spaced evenly by arc length; `xy` holds each item's
 *  Mercator x,y (2 numbers per item). Returns items in their original order. */
function strideByDistance<T>(items: T[], xy: ArrayLike<number>, cap: number): T[] {
  if (items.length <= cap) return items
  const cumLen = new Float64Array(items.length)
  for (let i = 1; i < items.length; i++) {
    cumLen[i] = cumLen[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1])
  }
  const totalLen = cumLen[cumLen.length - 1]
  if (totalLen === 0) return items.slice(0, cap)
  const spacing = totalLen / cap
  const out: T[] = []
  let cursor = 0, last = -1
  for (let k = 0; k < cap; k++) {
    const target = k * spacing
    while (cursor < cumLen.length - 1 && cumLen[cursor + 1] < target) cursor++
    if (cursor !== last) { out.push(items[cursor]); last = cursor }
  }
  return out
}

function mercatorMidpoint(p1: [number, number], p2: [number, number]): [number, number] {
  const toY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
  const fromY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI
  return [(p1[0] + p2[0]) / 2, fromY((toY(p1[1]) + toY(p2[1])) / 2)]
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const ex = px - (ax + t * dx), ey = py - (ay + t * dy)
  return ex * ex + ey * ey
}

function hideMidpointMarkers() {
  document.querySelectorAll('.elm-midpoint-marker').forEach(el => {
    ;(el as HTMLElement).style.display = 'none'
  })
}

// --- Component ---

export function VertexEditor({
  feature,
  selectedIndices,
  onExit,
  onDeleteSelected,
  onSelectIndices,
  onFeatureClick,
  readonly,
}: VertexEditorProps) {
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const updateFeature = useDataStore((s) => s.updateFeature)
  const isPolygon = feature.geometry.type === 'Polygon'
  const coords: [number, number][] = isPolygon
    ? (feature.geometry.coordinates as [number, number][][])[0].slice(0, -1)
    : (feature.geometry.coordinates as [number, number][])

  // Mercator x,y per vertex, for hover hit-testing and marker striding.
  const merc = useMemo(() => {
    const out = new Float64Array(coords.length * 2)
    for (let i = 0; i < coords.length; i++) { out[2 * i] = coords[i][0] * DEG; out[2 * i + 1] = mercY(coords[i][1]) }
    return out
  }, [feature.geometry]) // eslint-disable-line react-hooks/exhaustive-deps -- coords derive from feature.geometry

  // O(1) `selected?` lookup per vertex instead of O(n) `selectedIndices.includes(i)`.
  const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices])

  const [activePopupIndex, setActivePopupIndex] = useState<number | null>(null)
  const [draftCoords, setDraftCoords] = useState<{ lng: string; lat: string }>({ lng: '', lat: '' })
  // Right-click menu on a point: screen position + the point's index.
  const [pointMenu, setPointMenu] = useState<{ index: number; x: number; y: number } | null>(null)
  const closePointMenu = useCallback(() => setPointMenu(null), [])
  // Index of the segment the cursor is closest to while hovering the edge
  // overlay — used to render only the midpoint of the hovered edge instead of
  // every midpoint at once. Cleaner mid-edit view; midpoints still appear the
  // moment the user hovers an edge to insert/drag a new vertex.
  const [hoveredEdgeIndex, setHoveredEdgeIndex] = useState<number | null>(null)
  // Locks `hoveredEdgeIndex` to the segment whose midpoint is currently being
  // dragged — without this the map-level mousemove handler below would hide
  // the dragging marker as soon as the cursor pulled away from the original
  // edge, leaving the user with a "stuck" half-finished drag.
  const midpointDragLockRef = useRef<number | null>(null)
  // True while a point handle is dragged: the hovered edge stays put (no re-render mid-drag).
  const pointDragRef = useRef(false)
  const originalLayerRef = useRef<L.Polygon | L.Polyline | null>(null)
  const suppressExitUntilRef = useRef(0)
  // Vertex / midpoint marker drags run snap + preview at most once per
  // animation frame. dragend flushes first, so the commit (which reads
  // snappedCoord) always sees the final position.
  const [dragFrame] = useState(() => rafThrottle((run: () => void) => run()))
  useEffect(() => () => dragFrame.cancel(), [dragFrame])

  // Topo editing: neighbor data computed at drag start, Leaflet layers cached for live preview
  const topoNeighborsRef = useRef<Map<string, NeighborVertex[]>>(new Map())
  const topoFeaturesRef = useRef<Map<string, GeoJSONFeature>>(new Map())
  const topoLayersRef = useRef<Map<string, L.Polygon>>(new Map())
  // Original coordinate of the dragged vertex — used to "freeze" neighbours
  // back to their starting position when Cmd/Ctrl is held during drag.
  const topoOriginalCoordRef = useRef<[number, number] | null>(null)
  // Global Cmd/Ctrl tracker. Leaflet's marker `drag`/`dragend` events don't
  // reliably surface modifier state on `originalEvent` (it can be absent or
  // stale at dragend). A window-level listener is the dependable source.
  const topoSuppressedRef = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      topoSuppressedRef.current = e.metaKey || e.ctrlKey
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  // Force re-render on pan/zoom so viewport-culled vertices update
  const [viewTick, setViewTick] = useState(0)
  const hoverMap = useMap()
  useHandleVars(feature, hoverMap.getContainer())

  // A finger can't hover: every midpoint shows, and handles get a 44 px hit area
  // (the `elm-touch` class, see TOUCH_HANDLE_CSS). A mouse keeps the hovered-edge midpoint.
  const touch = useTouchInput()
  useEffect(() => {
    const el = hoverMap.getContainer()
    el.classList.toggle('elm-touch', touch)
    return () => el.classList.remove('elm-touch')
  }, [hoverMap, touch])
  // Long-press on a point (finger) opens the right-click menu; one handle per marker.
  const longPressRef = useRef(new Map<LMarker, ReturnType<typeof attachLongPress>>())
  useEffect(() => {
    const lp = longPressRef.current
    return () => { lp.forEach((h) => h.detach()); lp.clear() }
  }, [])
  useMapEvents({
    click: () => { if (Date.now() < suppressExitUntilRef.current) return; onExit() },
    moveend: () => setViewTick((t) => t + 1),
    // Hover detection at the map level — Leaflet's per-path mousemove fires
    // unreliably (skipped for the right edge of a square in our probe) and a
    // map-level handler with a pixel-distance check is rock-solid by
    // comparison. Hysteresis (22 px enter, 36 px exit) prevents flicker as
    // the cursor approaches the midpoint marker.
    mousemove: (e) => {
      if (readonly) return
      // Don't update while the user is dragging a midpoint — the cursor moves
      // away from the source edge during the drag, and re-evaluating would
      // unmount the dragging marker mid-gesture.
      if (midpointDragLockRef.current !== null || pointDragRef.current) return
      const { idx: bestIdx, px: bestDist } = nearestEdge(e.latlng)
      const isHovered = lastReportedEdgeRef.current !== null
      const threshold = isHovered ? EDGE_HOVER_EXIT_PX : EDGE_HOVER_ENTER_PX
      if (bestDist <= threshold && bestIdx >= 0) setEdge(bestIdx)
      else setEdge(null)
    },
    mouseout: () => {
      if (midpointDragLockRef.current !== null || pointDragRef.current) return
      setEdge(null)
    },
  })

  useEffect(() => {
    document.querySelectorAll('.elm-midpoint-marker').forEach(el => {
      ;(el as HTMLElement).style.display = ''
    })
  }, [feature])

  useEffect(() => {
    if (selectedIndices.length === 0 || readonly) return
    function handleKey(e: KeyboardEvent) {
      if (document.activeElement?.tagName === 'INPUT') return
      if (!isForThisEditor(e)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDeleteSelected()
      }
    }
    const targetWindow =
      (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
    targetWindow.addEventListener('keydown', handleKey)
    return () => targetWindow.removeEventListener('keydown', handleKey)
  }, [selectedIndices.length, onDeleteSelected, readonly, isForThisEditor])

  // --- Shared drag helpers ---

  function findOriginalLayer(map: L.Map): L.Polygon | L.Polyline | null {
    const fc = isPolygon
      ? (feature.geometry.coordinates as [number, number][][])[0]
      : (feature.geometry.coordinates as [number, number][])
    if (fc.length < 2) return null
    let found: L.Polygon | L.Polyline | null = null
    map.eachLayer((layer: L.Layer) => {
      if (found) return
      if (isPolygon && layer instanceof L.Polygon) {
        const ring = (Array.isArray((layer.getLatLngs() as L.LatLng[][])[0]) ? (layer.getLatLngs() as L.LatLng[][])[0] : layer.getLatLngs()) as L.LatLng[]
        if (ring.length >= 2 &&
            Math.abs(ring[0].lng - fc[0][0]) < 1e-6 && Math.abs(ring[0].lat - fc[0][1]) < 1e-6 &&
            Math.abs(ring[1].lng - fc[1][0]) < 1e-6 && Math.abs(ring[1].lat - fc[1][1]) < 1e-6)
          found = layer
      } else if (!isPolygon && layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        if (((layer.options as L.PolylineOptions).opacity ?? 1) < 0.01) return
        const ll = layer.getLatLngs() as L.LatLng[]
        if (ll.length >= 2 &&
            Math.abs(ll[0].lng - fc[0][0]) < 1e-6 && Math.abs(ll[0].lat - fc[0][1]) < 1e-6 &&
            Math.abs(ll[1].lng - fc[1][0]) < 1e-6 && Math.abs(ll[1].lat - fc[1][1]) < 1e-6)
          found = layer
      }
    })
    return found
  }

  // --- Topo editing helpers ---

  /** Find the visible Leaflet polygon layer for a neighbor feature (for live imperative updates).
   *  Skips invisible interaction overlays (opacity ≈ 0) rendered by FeatureInteractionLayer. */
  function findNeighborLayer(map: L.Map, neighborFeature: GeoJSONFeature): L.Polygon | null {
    if (neighborFeature.geometry.type !== 'Polygon' && neighborFeature.geometry.type !== 'MultiPolygon') return null
    const firstRing = neighborFeature.geometry.type === 'Polygon'
      ? (neighborFeature.geometry.coordinates as [number, number][][])[0]
      : (neighborFeature.geometry.coordinates as [number, number][][][])[0][0]
    if (firstRing.length < 2) return null
    let found: L.Polygon | null = null
    map.eachLayer((layer: L.Layer) => {
      if (found) return
      if (!(layer instanceof L.Polygon)) return
      // Skip invisible interaction overlays (opacity ≈ 0)
      if (layer.options.opacity != null && layer.options.opacity < 0.01) return
      const ring = (Array.isArray((layer.getLatLngs() as L.LatLng[][])[0]?.[0]) ? (layer.getLatLngs() as L.LatLng[][])[0][0]
        : Array.isArray((layer.getLatLngs() as L.LatLng[][])[0]) ? (layer.getLatLngs() as L.LatLng[][])[0]
        : layer.getLatLngs()) as L.LatLng[]
      if (ring.length >= 2 &&
          Math.abs(ring[0].lng - firstRing[0][0]) < 1e-6 && Math.abs(ring[0].lat - firstRing[0][1]) < 1e-6 &&
          Math.abs(ring[1].lng - firstRing[1][0]) < 1e-6 && Math.abs(ring[1].lat - firstRing[1][1]) < 1e-6)
        found = layer
    })
    return found
  }

  /** Apply topo move to neighbor Leaflet layers for live preview. */
  function previewTopoNeighbors(map: L.Map, newCoord: [number, number]) {
    for (const [fid, nvs] of topoNeighborsRef.current) {
      const nf = topoFeaturesRef.current.get(fid)
      if (!nf) continue
      let layer = topoLayersRef.current.get(fid)
      if (!layer) {
        const found = findNeighborLayer(map, nf)
        if (!found) continue
        layer = found
        topoLayersRef.current.set(fid, layer)
      }
      const newGeom = applyTopoMove(nf.geometry, nvs, newCoord)
      if (newGeom.type === 'Polygon') {
        layer.setLatLngs((newGeom.coordinates as [number, number][][]).map(
          r => r.map(([lo, la]) => L.latLng(la, lo))
        ))
      } else if (newGeom.type === 'MultiPolygon') {
        layer.setLatLngs((newGeom.coordinates as [number, number][][][]).map(
          p => p.map(r => r.map(([lo, la]) => L.latLng(la, lo)))
        ))
      }
    }
  }

  /** Commit topo move to store for all neighbor features. */
  function commitTopoNeighborDrag(newCoord: [number, number]) {
    dataStore.getState().updateFeatures([...topoNeighborsRef.current].flatMap(([fid, nvs]) => {
      const nf = topoFeaturesRef.current.get(fid)
      return nf ? [{ id: fid, patch: neighbourPatch(nf, applyTopoMove(nf.geometry, nvs, newCoord)) }] : []
    }))
    topoNeighborsRef.current.clear()
    topoFeaturesRef.current.clear()
    topoLayersRef.current.clear()
  }

  /** Initialize topo neighbor data for a drag starting at the given coordinate. */
  function initTopoNeighbors(originalCoord: [number, number]) {
    if (!uiStore.getState().topoEditEnabled) return
    const allFeatures = dataStore.getState().features
    const neighbors = findTopologicalNeighbors(allFeatures, feature.id, [originalCoord])
    topoNeighborsRef.current = groupNeighborsByFeature(neighbors)
    // Cache features snapshot — they don't change during drag
    const featMap = new Map<string, GeoJSONFeature>()
    for (const fid of topoNeighborsRef.current.keys()) {
      const f = allFeatures.find(ff => ff.id === fid)
      if (f) featMap.set(fid, f)
    }
    topoFeaturesRef.current = featMap
    topoLayersRef.current.clear()
    topoOriginalCoordRef.current = originalCoord
  }

  function resolveSnap(e: LeafletEvent): { lng: number; lat: number } {
    const { lat, lng } = (e.target as LMarker).getLatLng()
    const nativeEvent = (e as any).originalEvent as MouseEvent | undefined
    const modKey = nativeEvent?.metaKey || nativeEvent?.ctrlKey
    if (!uiStore.getState().snapEnabled || modKey) return { lng, lat }
    const map = (e.target as L.Marker & { _map: L.Map })._map
    if (!map) return { lng, lat }
    const snap = findSnapPoint(lng, lat, map, dataStore.getState().features, 15, new Set([feature.id]))
    if (snap) {
      uiStore.getState().setSnappedCoord(snap.latlng)
      return { lng: snap.latlng[0], lat: snap.latlng[1] }
    }
    if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
    return { lng, lat }
  }

  function previewCoords(e: LeafletEvent, newCoords: [number, number][]) {
    const map = (e.target as L.Marker & { _map: L.Map })._map
    if (!map) return
    if (!originalLayerRef.current) originalLayerRef.current = findOriginalLayer(map)
    if (!originalLayerRef.current) return
    const latLngs = newCoords.map(([lo, la]) => L.latLng(la, lo))
    if (isPolygon) (originalLayerRef.current as L.Polygon).setLatLngs([latLngs])
    else (originalLayerRef.current as L.Polyline).setLatLngs(latLngs)
  }

  function finalizeDrag(e: LeafletEvent): { lng: number; lat: number } {
    originalLayerRef.current = null
    const snappedCoord = uiStore.getState().snappedCoord
    uiStore.getState().setSnappedCoord(null)
    const { lat, lng } = (e.target as LMarker).getLatLng()
    return snappedCoord ? { lng: snappedCoord[0], lat: snappedCoord[1] } : { lng, lat }
  }

  // --- Geometry commit helpers ---
  // A moved point keeps its altitude (withXY); an inserted one gets its edge's mean (insertedPosition).

  function buildRing(index: number, lng: number, lat: number): [number, number][] {
    const ring = [...(feature.geometry.coordinates as [number, number][][])[0]]
    ring[index] = withXY(ring[index], [lng, lat])
    if (index === 0) ring[ring.length - 1] = ring[0]
    return ring
  }

  function buildLineCoords(index: number, lng: number, lat: number): [number, number][] {
    const c = [...(feature.geometry.coordinates as [number, number][])]
    c[index] = withXY(c[index], [lng, lat])
    return c
  }

  function insertIntoRing(segmentIndex: number, lng: number, lat: number): [number, number][] {
    const ring = [...(feature.geometry.coordinates as [number, number][][])[0]]
    ring.splice(segmentIndex + 1, 0, insertedPosition(ring[segmentIndex], ring[segmentIndex + 1], [lng, lat]))
    ring[ring.length - 1] = ring[0]
    return ring
  }

  function insertIntoLine(segmentIndex: number, lng: number, lat: number): [number, number][] {
    const c = [...(feature.geometry.coordinates as [number, number][])]
    c.splice(segmentIndex + 1, 0, insertedPosition(c[segmentIndex], c[segmentIndex + 1], [lng, lat]))
    return c
  }

  // vertexEditPatch: the first committed change turns a circle / rectangle / route into a plain shape / line.
  function commitPolygon(ring: [number, number][]) {
    updateFeature(feature.id, vertexEditPatch(feature, { type: 'Polygon', coordinates: [ring] }))
  }

  function commitLine(coords: [number, number][]) {
    updateFeature(feature.id, vertexEditPatch(feature, { type: 'LineString', coordinates: coords }))
    onFeatureClick()
  }

  // --- Vertex drag ---

  function handleDrag(index: number, e: LeafletEvent) {
    const { lng, lat } = resolveSnap(e)
    if (isPolygon) previewCoords(e, buildRing(index, lng, lat))
    else previewCoords(e, buildLineCoords(index, lng, lat))
    // Live topo preview for neighbor polygons. While Cmd/Ctrl is held, freeze
    // neighbours at their original coord so the dragged vertex tears free.
    if (topoNeighborsRef.current.size > 0) {
      const map = (e.target as L.Marker & { _map: L.Map })._map
      if (map) {
        const orig = topoOriginalCoordRef.current
        const target: [number, number] = topoSuppressedRef.current && orig ? orig : [lng, lat]
        previewTopoNeighbors(map, target)
      }
    }
  }

  function handleDragEnd(index: number, e: LeafletEvent) {
    const { lng, lat } = finalizeDrag(e)
    if (isPolygon) commitPolygon(buildRing(index, lng, lat))
    else commitLine(buildLineCoords(index, lng, lat))
    if (topoNeighborsRef.current.size > 0) {
      if (topoSuppressedRef.current) {
        // Cmd held at drag-end → don't propagate to neighbours. Reset the
        // imperative layer previews so neighbours snap back to their original
        // shape; nothing is committed to the store.
        const map = (e.target as L.Marker & { _map: L.Map })._map
        const orig = topoOriginalCoordRef.current
        if (map && orig) previewTopoNeighbors(map, orig)
        topoNeighborsRef.current.clear()
        topoFeaturesRef.current.clear()
        topoLayersRef.current.clear()
        topoOriginalCoordRef.current = null
      } else {
        commitTopoNeighborDrag([lng, lat])
        topoOriginalCoordRef.current = null
      }
    }
  }

  // --- Midpoint drag ---

  function handleMidpointDrag(segmentIndex: number, e: LeafletEvent) {
    const { lng, lat } = resolveSnap(e)
    const ring = [...(feature.geometry.coordinates as [number, number][][])[0]]
    ring.splice(segmentIndex + 1, 0, [lng, lat])
    if (isPolygon) previewCoords(e, ring)
    else {
      const c = [...(feature.geometry.coordinates as [number, number][])]
      c.splice(segmentIndex + 1, 0, [lng, lat])
      previewCoords(e, c)
    }
  }

  function handleMidpointDragEnd(segmentIndex: number, e: LeafletEvent) {
    const { lng, lat } = finalizeDrag(e)
    if (isPolygon) commitPolygon(insertIntoRing(segmentIndex, lng, lat))
    else commitLine(insertIntoLine(segmentIndex, lng, lat))

    if (isPolygon && uiStore.getState().topoEditEnabled) {
      dataStore.getState().updateFeatures(commitTopoInsert(dataStore.getState().features, feature.id,
        coords[segmentIndex], coords[(segmentIndex + 1) % coords.length],
        [lng, lat]))
    }
  }

  // --- Other vertex operations ---

  function updateVertex(index: number, lng: number, lat: number) {
    const originalCoord = coords[index]
    dataStore.getState().takeSnapshot()
    if (isPolygon) commitPolygon(buildRing(index, lng, lat))
    else commitLine(buildLineCoords(index, lng, lat))

    if (isPolygon && uiStore.getState().topoEditEnabled) {
      dataStore.getState().updateFeatures(commitTopoMove(dataStore.getState().features, feature.id,
        originalCoord, [lng, lat]))
    }
  }

  function handleDeleteVertex(index: number) {
    if (readonly) return
    if (coords.length <= (isPolygon ? 3 : 2)) {
      emit({ type: 'warning', message: `Cannot delete: ${isPolygon ? 'an area needs at least 3' : 'a line needs at least 2'} points` })
      return
    }

    const deletedCoord = coords[index]
    dataStore.getState().takeSnapshot()
    // Indices shift after a delete, so any point selection is now stale.
    onSelectIndices([])

    if (isPolygon) {
      const ring = (feature.geometry.coordinates as [number, number][][])[0].filter((_, i) => i !== index)
      if (index === 0) ring[ring.length - 1] = ring[0]
      commitPolygon(ring)
    } else {
      commitLine((feature.geometry.coordinates as [number, number][]).filter((_, i) => i !== index))
    }

    if (isPolygon && uiStore.getState().topoEditEnabled) {
      dataStore.getState().updateFeatures(commitTopoDelete(dataStore.getState().features, feature.id,
        [deletedCoord]))
    }
  }

  function handleAddVertex(index: number, e: LeafletMouseEvent) {
    e.originalEvent.stopPropagation()
    if (readonly) return
    dataStore.getState().takeSnapshot()
    const { lat, lng } = e.latlng
    if (isPolygon) commitPolygon(insertIntoRing(index, lng, lat))
    else commitLine(insertIntoLine(index, lng, lat))

    if (isPolygon && uiStore.getState().topoEditEnabled) {
      dataStore.getState().updateFeatures(commitTopoInsert(dataStore.getState().features, feature.id,
        coords[index], coords[(index + 1) % coords.length],
        [lng, lat]))
    }
  }

  // The segment nearest to `latlng` (its start-vertex index) and its distance in
  // screen pixels. Mercator units (pre-projected once per geometry) scaled to
  // pixels: no per-vertex latLngToContainerPoint on a 50k ring. Used by the
  // hover-midpoint logic and edge drag-to-insert.
  function nearestEdge(latlng: L.LatLng): { idx: number; px: number } {
    const cx = latlng.lng * DEG, cy = mercY(latlng.lat)
    const n = coords.length
    const numSegments = isPolygon ? n : n - 1
    let idx = -1, bestSq = Infinity
    for (let i = 0; i < numSegments; i++) {
      const j = (i + 1) % n
      const d = pointToSegmentDist(cx, cy, merc[2 * i], merc[2 * i + 1], merc[2 * j], merc[2 * j + 1])
      if (d < bestSq) { bestSq = d; idx = i }
    }
    return { idx, px: Math.sqrt(bestSq) * hoverMap.options.crs!.scale(hoverMap.getZoom()) / (2 * Math.PI) }
  }

  // Tracks the currently-hovered edge in a ref so we only call setState when
  // the index actually flips — every cursor pixel triggers mousemove and
  // setState-on-each-pixel would re-render the entire VertexEditor tree.
  const lastReportedEdgeRef = useRef<number | null>(null)
  // Hysteresis on the hover band so the midpoint doesn't flicker as the
  // cursor approaches: 22 px to engage, 36 px to release. The wider release
  // threshold lets the user nudge toward the midpoint marker without the
  // edge "letting go" mid-approach.
  const EDGE_HOVER_ENTER_PX = 22
  const EDGE_HOVER_EXIT_PX = 36
  // Grab band for edge drag-to-insert: the edge-snap diamond's 15 px. The hit
  // overlay's stroke below is 2 × this wide.
  const EDGE_GRAB_PX = 15

  function setEdge(idx: number | null) {
    if (idx === lastReportedEdgeRef.current) return
    lastReportedEdgeRef.current = idx
    setHoveredEdgeIndex(idx)
  }

  function handleEdgeMouseDown(e: LeafletMouseEvent) {
    if (readonly) return
    const map = (e.target as L.Marker & { _map: L.Map })._map
    if (!map) return
    // The hit overlay's fill covers the whole body (it blocks Cmd-drag translate
    // there); only a grab within the edge band inserts, the rest pans the map.
    const { idx: bestIdx, px } = nearestEdge(e.latlng)
    if (bestIdx < 0 || px > EDGE_GRAB_PX) return
    e.originalEvent.stopPropagation()
    e.originalEvent.preventDefault()

    const snapped = uiStore.getState().snappedCoord
    let curLng = snapped ? snapped[0] : e.latlng.lng
    let curLat = snapped ? snapped[1] : e.latlng.lat
    if (snapped) uiStore.getState().setSnappedCoord(null)

    dataStore.getState().takeSnapshot()
    hideMidpointMarkers()
    map.dragging.disable()
    // Suppress hover-name tooltip for the duration of the edge-drag insert.
    setFeatureDragActive(true)

    const layer = findOriginalLayer(map)

    function onMove(ev: L.LeafletMouseEvent) {
      let lng = ev.latlng.lng, lat = ev.latlng.lat
      if (uiStore.getState().snapEnabled) {
        const snap = findSnapPoint(lng, lat, map, dataStore.getState().features, 15, new Set([feature.id]))
        if (snap) {
          uiStore.getState().setSnappedCoord(snap.latlng)
          lng = snap.latlng[0]; lat = snap.latlng[1]
        } else if (uiStore.getState().snappedCoord) {
          uiStore.getState().setSnappedCoord(null)
        }
      }
      curLng = lng; curLat = lat
      if (layer) {
        if (isPolygon) {
          const ring = [...(feature.geometry.coordinates as [number, number][][])[0]]
          ring.splice(bestIdx + 1, 0, [lng, lat])
          ;(layer as L.Polygon).setLatLngs([ring.map(([lo, la]) => L.latLng(la, lo))])
        } else {
          const c = [...(feature.geometry.coordinates as [number, number][])]
          c.splice(bestIdx + 1, 0, [lng, lat])
          ;(layer as L.Polyline).setLatLngs(c.map(([lo, la]) => L.latLng(la, lo)))
        }
      }
    }

    // One snap search + preview per frame; flushed on mouseup before commit.
    const moveFrame = rafThrottle(onMove)
    const scheduleMove = moveFrame.schedule as L.LeafletEventHandlerFn

    function onUp() {
      map.off('mousemove', scheduleMove)
      map.off('mouseup', onUp as L.LeafletEventHandlerFn)
      moveFrame.flush()
      map.dragging.enable()
      uiStore.getState().setSnappedCoord(null)
      suppressExitUntilRef.current = Date.now() + 200
      setFeatureDragActive(false)
      if (isPolygon) commitPolygon(insertIntoRing(bestIdx, curLng, curLat))
      else commitLine(insertIntoLine(bestIdx, curLng, curLat))

      if (isPolygon && uiStore.getState().topoEditEnabled) {
        dataStore.getState().updateFeatures(commitTopoInsert(dataStore.getState().features, feature.id,
          coords[bestIdx], coords[(bestIdx + 1) % coords.length],
          [curLng, curLat]))
      }
    }

    map.on('mousemove', scheduleMove)
    map.on('mouseup', onUp as L.LeafletEventHandlerFn)
  }

  // --- Context menu / precise coords ---

  // Click selects only this point; Shift+click toggles it. Never deletes.
  // Leaflet itself drops the click that follows a marker drag
  // (Map._draggableMoved), so a drag never lands here.
  function handleVertexClick(index: number, e: LeafletMouseEvent) {
    e.originalEvent.stopPropagation()
    if (readonly) return
    if (e.originalEvent.shiftKey) {
      onSelectIndices(selectedSet.has(index)
        ? selectedIndices.filter((i) => i !== index)
        : [...selectedIndices, index].sort((a, b) => a - b))
    } else {
      onSelectIndices([index])
    }
  }

  function handleContextMenu(index: number, e: LeafletMouseEvent) {
    e.originalEvent.preventDefault()
    e.originalEvent.stopPropagation()
    if (readonly) return
    setPointMenu({ index, x: e.originalEvent.clientX, y: e.originalEvent.clientY })
  }

  function openCoordEditor(index: number) {
    const [lng, lat] = coords[index]
    setDraftCoords({ lng: lng.toFixed(6), lat: lat.toFixed(6) })
    setActivePopupIndex(index)
  }

  function savePreciseCoords() {
    if (activePopupIndex === null) return
    const lng = parseFloat(draftCoords.lng)
    const lat = parseFloat(draftCoords.lat)
    if (!isNaN(lng) && !isNaN(lat)) {
      updateVertex(activePopupIndex, lng, lat)
      setActivePopupIndex(null)
      emit({ type: 'success', message: 'Coordinate updated' })
    } else {
      emit({ type: 'warning', message: 'Invalid coordinates' })
    }
  }

  // Map-level popup (not bound to the marker: a bound popup only opens on a
  // marker click). Memoised so react-leaflet doesn't reopen it every render.
  const popupLng = activePopupIndex !== null ? coords[activePopupIndex]?.[0] : undefined
  const popupLat = activePopupIndex !== null ? coords[activePopupIndex]?.[1] : undefined
  const popupPosition = useMemo<[number, number] | null>(
    () => (popupLng === undefined || popupLat === undefined ? null : [popupLat, popupLng]),
    [popupLng, popupLat],
  )

  // --- Derived data with viewport culling for large geometries ---

  const map = useMap()
  const MAX_VISIBLE_MARKERS = 500

  // Viewport-cull vertices: collect every in-bounds match (no early break — order-based
  // breaks left huge polygons showing only one geographic chunk because OSM rings start
  // from one corner). When the count exceeds the cap, stride by arc-length distance
  // (not array index) so spacing on screen is uniform regardless of source-data density.
  // OSM coastlines have ~10× more vertices per km than inland borders — index-striding
  // would give proportionally more markers in dense regions. Distance-striding fixes that.
  // Selected vertices are always force-included so they never disappear after striding.
  // Memoised on geometry + view: this walks every vertex (50k on a huge polygon)
  // and used to rerun on each hover/drag/selection re-render. `viewTick` bumps on moveend.
  const { visibleVertexIndices, midpoints } = useMemo(() => {
  const bounds = map.getBounds()
  // Cull in Mercator space (monotonic in lng/lat, so same result as bounds.contains)
  // without allocating a LatLng per vertex.
  const west = bounds.getWest() * DEG, east = bounds.getEast() * DEG
  const south = mercY(bounds.getSouth()), north = mercY(bounds.getNorth())
  const allVisible: number[] = []
  for (let i = 0; i < coords.length; i++) {
    const x = merc[2 * i], y = merc[2 * i + 1]
    if (x >= west && x <= east && y >= south && y <= north) allVisible.push(i)
  }

  let visibleVertexIndices = allVisible
  if (allVisible.length > MAX_VISIBLE_MARKERS) {
    const xy = new Float64Array(allVisible.length * 2)
    allVisible.forEach((v, k) => { xy[2 * k] = merc[2 * v]; xy[2 * k + 1] = merc[2 * v + 1] })
    visibleVertexIndices = strideByDistance(allVisible, xy, MAX_VISIBLE_MARKERS)
  }
  if (allVisible.length > MAX_VISIBLE_MARKERS) {
    // Force-include selected vertices that fall in the visible set
    const visibleSet = new Set(visibleVertexIndices)
    const allVisibleSet = new Set(allVisible)
    let added = false
    for (const i of selectedSet) {
      if (allVisibleSet.has(i) && !visibleSet.has(i)) {
        visibleVertexIndices.push(i)
        added = true
      }
    }
    if (added) visibleVertexIndices = [...visibleVertexIndices].sort((a, b) => a - b)
  }

  const midpoints: { index: number; coord: [number, number]; position: [number, number] }[] = []
  if (!readonly) {
    const n = isPolygon ? coords.length : coords.length - 1
    // A Mercator midpoint is the plain average of the endpoints' Mercator x,y, so cull
    // and stride in that space and only unproject the midpoints that survive.
    const inView: number[] = []
    const xyAll: number[] = []
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % coords.length
      const x = (merc[2 * i] + merc[2 * j]) / 2, y = (merc[2 * i + 1] + merc[2 * j + 1]) / 2
      if (x >= west && x <= east && y >= south && y <= north) { inView.push(i); xyAll.push(x, y) }
    }
    const picked = strideByDistance(inView, xyAll, MAX_VISIBLE_MARKERS)
    for (const i of picked) {
      const coord = mercatorMidpoint(coords[i], coords[(i + 1) % coords.length])
      midpoints.push({ index: i, coord, position: toLeaflet(coord) })
    }
  }
  return { visibleVertexIndices, midpoints }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- coords/isPolygon derive from feature.geometry
  }, [feature.geometry, merc, viewTick, readonly, selectedSet, map])

  // Marker positions must keep their identity between renders: react-leaflet calls setLatLng whenever
  // the `position` prop is a new array, and a re-render during a drag (hovered edge, drag flag, host
  // state) would put the dragged handle back on its old spot, so dragend read the old position and the
  // drag committed nothing (the trailing click then landed on the map and ended point editing).
  const leafletCoords = useMemo(() => coords.map(toLeaflet), [feature.geometry]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Render ---

  return (
    <>
      {!readonly && (isPolygon ? (
        <RLPolygon
          positions={[leafletCoords]}
          pathOptions={{ weight: 2 * EDGE_GRAB_PX, opacity: 0, fillOpacity: 0, className: 'cursor-pointer' }}
          bubblingMouseEvents={false}
          eventHandlers={{ mousedown: handleEdgeMouseDown }}
        />
      ) : (
        <RLPolyline
          positions={leafletCoords}
          pathOptions={{ weight: 2 * EDGE_GRAB_PX, opacity: 0, className: 'cursor-pointer' }}
          bubblingMouseEvents={false}
          eventHandlers={{ mousedown: handleEdgeMouseDown }}
        />
      ))}

      {!readonly && midpoints.filter((mp) => touch || mp.index === hoveredEdgeIndex).map((mp) => (
        <Marker
          key={`mid-${mp.coord[0].toFixed(8)},${mp.coord[1].toFixed(8)}`}
          position={mp.position}
          icon={MIDPOINT_ICON}
          draggable
          eventHandlers={{
            click: (e) => handleAddVertex(mp.index, e as unknown as LeafletMouseEvent),
            dragstart: () => {
              dataStore.getState().takeSnapshot()
              hideMidpointMarkers()
              // Pin hover to this segment so map mousemove can't yank the marker
              // out from under the active drag. Released on dragend.
              midpointDragLockRef.current = mp.index
              setFeatureDragActive(true)
            },
            drag: (e) => dragFrame.schedule(() => handleMidpointDrag(mp.index, e)),
            dragend: (e) => {
              suppressExitUntilRef.current = Date.now() + 200
              dragFrame.flush()
              handleMidpointDragEnd(mp.index, e)
              midpointDragLockRef.current = null
              setFeatureDragActive(false)
            },
          }}
        />
      ))}

      {visibleVertexIndices.map((i) => {
        const coord = coords[i]
        return (
        <Marker
          key={`v-${coord[0].toFixed(8)},${coord[1].toFixed(8)}-${i}`}
          position={leafletCoords[i]}
          icon={selectedSet.has(i) ? VERTEX_ICON_SELECTED : VERTEX_ICON_DEFAULT}
          draggable={!readonly}
          eventHandlers={{
            dragstart: () => {
              pointDragRef.current = true
              dataStore.getState().takeSnapshot()
              hideMidpointMarkers()
              initTopoNeighbors(coords[i])
              // Suppress the hover-name tooltip while the cursor sweeps over
              // the polygon during drag — otherwise it pops up at random.
              setFeatureDragActive(true)
            },
            drag: (e) => dragFrame.schedule(() => handleDrag(i, e)),
            dragend: (e) => {
              pointDragRef.current = false
              // The click after the drag may land beside the handle (snapping, a slow frame): it is
              // part of the drag, not a "click on the map" that ends point editing.
              suppressExitUntilRef.current = Date.now() + 200
              dragFrame.flush()
              handleDragEnd(i, e)
              setFeatureDragActive(false)
            },
            click: (e) => {
              if (longPressRef.current.get(e.target as LMarker)?.fired()) return // the long-press opened the menu
              handleVertexClick(i, e as unknown as LeafletMouseEvent)
            },
            contextmenu: (e) => handleContextMenu(i, e as unknown as LeafletMouseEvent),
            add: (e) => {
              const m = e.target as LMarker
              const el = m.getElement()
              if (!el || readonly) return
              longPressRef.current.get(m)?.detach()
              longPressRef.current.set(m, attachLongPress(el, (pe) => setPointMenu({ index: i, x: pe.clientX, y: pe.clientY })))
            },
            remove: (e) => {
              const m = e.target as LMarker
              longPressRef.current.get(m)?.detach()
              longPressRef.current.delete(m)
            },
          }}
        />
      )})}

      {activePopupIndex !== null && popupPosition && (
        <Popup position={popupPosition} eventHandlers={{ remove: () => setActivePopupIndex(null) }} autoClose={false} closeOnClick={false}>
          <div
            className="flex flex-col gap-2 min-w-[140px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') savePreciseCoords()
              if (e.key === 'Escape') setActivePopupIndex(null)
            }}
          >
            <p className="text-xs font-semibold text-(--elm-text-secondary,var(--color-gray-700)) m-0 leading-none">Precise coordinates</p>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-xs text-(--elm-text-muted,var(--color-gray-500))">
                Lat:
                <input
                  type="text"
                  value={draftCoords.lat}
                  onChange={(e) => setDraftCoords((c) => ({ ...c, lat: e.target.value }))}
                  className="flex-1 w-full min-w-0 border border-(--elm-border,var(--color-gray-200)) rounded-elm-chip px-1.5 py-0.5 text-xs outline-none focus-visible:border-elm-focus-ring"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-(--elm-text-muted,var(--color-gray-500))">
                Lng:
                <input
                  type="text"
                  value={draftCoords.lng}
                  onChange={(e) => setDraftCoords((c) => ({ ...c, lng: e.target.value }))}
                  className="flex-1 w-full min-w-0 border border-(--elm-border,var(--color-gray-200)) rounded-elm-chip px-1.5 py-0.5 text-xs outline-none focus-visible:border-elm-focus-ring"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-1 mt-1">
              <button
                onClick={() => setActivePopupIndex(null)}
                className="px-2 py-1 text-xs text-(--elm-text-muted,var(--color-gray-500)) hover:bg-(--elm-surface-hover,var(--color-gray-100)) rounded-elm-chip transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={savePreciseCoords}
                className="px-2 py-1 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-elm-chip transition-colors font-medium flex items-center gap-1"
              >
                <Check size={12} weight="bold" /> Save
              </button>
            </div>
          </div>
        </Popup>
      )}
      {pointMenu && (() => {
        const inMulti = selectedSet.has(pointMenu.index) && selectedIndices.length > 1
        return (
          <ContextMenu
            x={pointMenu.x}
            y={pointMenu.y}
            onClose={closePointMenu}
            items={[
              { label: 'Edit coordinates…', icon: <Crosshair size={16} />, onClick: () => openCoordEditor(pointMenu.index) },
              { separator: true },
              {
                label: inMulti ? `Delete ${selectedIndices.length} points` : 'Delete point',
                icon: <Trash size={16} />,
                onClick: () => inMulti ? onDeleteSelected() : handleDeleteVertex(pointMenu.index),
              },
            ]}
          />
        )
      })()}
    </>
  )
}
