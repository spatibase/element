/**
 * VertexEditor — renders draggable vertex handles for selected features using
 * maplibregl.Marker instances. Supports drag to reposition, click to select,
 * right-click menu (Edit coordinates… / Delete point), and midpoint insertion.
 *
 * Multi-geometry support: for MultiPolygon / MultiLineString / GeometryCollection
 * features, the editor operates on the `selectedPartIndex` sub-part. The
 * mutation is then wrapped back into the parent Multi* geometry before commit.
 *
 * Point selection: click selects only that point, shift+click toggles it.
 * When ≥ 1 vertex is selected, a floating action bar appears at the bottom of
 * the map with Simplify + bulk Delete actions (keyed "Del"/"Backspace").
 * Mirrors the adapter-leaflet behavior.
 *
 * Topology: when `topoEditEnabled` is on, vertex moves / deletes / inserts
 * apply to neighboring features that share the edited coordinate via the
 * `commitTopoMove` / `commitTopoDelete` helpers.
 */
import { useHandleVars } from '../utils/stateStyle'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import { Crosshair, Trash } from '@phosphor-icons/react'
import { ContextMenu, VertexSelectionBar, useEmit, useIsEventForEditor } from '@element-editor/ui'
import { useTouchInput } from '@element-editor/ui/internal'
import PreciseCoordsOverlay from './PreciseCoordsOverlay'
import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { setFeatureDragActive } from '../utils/featureTooltip'
import { rafThrottle } from '../utils/rafThrottle'
import { paintLiveGeometries } from '../utils/liveFeatureSource'
import { findSnapPoint } from '../utils/snapping'
import type { GeoJSONFeature, Geometry, SimpleGeometry } from '@element-editor/core'
import {
  getPartGeometry,
  setPartGeometry,
  isMultiGeometry,
  rdp,
  commitTopoMove,
  commitTopoInsert,
  commitTopoDelete,
  insertedPosition,
  vertexEditPatch,
  withXY,
  attachLongPress,
  TOUCH_HANDLE_CSS,
} from '@element-editor/core/internal'

/**
 * Returns the Simple geometry the editor should operate on. For Multi* / GC
 * features with a `partIndex`, extracts the selected sub-part. For simple
 * geometries, returns the geometry itself. Returns null if a Multi* has no
 * part selected (nothing to edit in that case).
 */
function getActivePart(geometry: Geometry, partIndex: number | null): SimpleGeometry | null {
  if (isMultiGeometry(geometry)) {
    if (partIndex == null) return null
    return getPartGeometry(geometry, partIndex)
  }
  return geometry as SimpleGeometry
}

/**
 * Wraps a mutated simple part back into the parent Multi* geometry. For simple
 * features, returns the mutated geometry directly.
 */
function wrapPart(parent: Geometry, partIndex: number | null, mutated: SimpleGeometry): Geometry {
  if (isMultiGeometry(parent) && partIndex != null) {
    return setPartGeometry(parent, partIndex, mutated)
  }
  return mutated
}

function getVertexRings(geometry: SimpleGeometry): [number, number][][] {
  if (geometry.type === 'Point') return [[geometry.coordinates as [number, number]]]
  if (geometry.type === 'MultiPoint') return [geometry.coordinates as [number, number][]]
  if (geometry.type === 'LineString') return [geometry.coordinates as [number, number][]]
  if (geometry.type === 'Polygon') return geometry.coordinates as [number, number][][]
  return []
}

/**
 * Applies selected vs unselected styling to an existing vertex element. Kept
 * as a function on the element so we can retoggle without rebuilding markers.
 */
function paintVertex(el: HTMLElement, selected: boolean) {
  el.style.background = selected ? 'var(--elm-handle,var(--color-primary-500))' : '#ffffff'
  el.style.borderColor = selected ? 'var(--elm-handle-strong,var(--color-primary-700))' : 'var(--elm-handle,var(--color-primary-500))'
  el.dataset.elmSelected = selected ? '1' : '0'
}

let _stylesInjected = false
function ensureStyles() {
  if (_stylesInjected) return
  const s = document.createElement('style')
  s.textContent = '.elm-midpoint-marker{pointer-events:auto!important}' + TOUCH_HANDLE_CSS
  document.head.appendChild(s)
  _stylesInjected = true
}

function makeVertexEl(selected: boolean, isMidpoint = false): HTMLElement {
  if (isMidpoint) {
    const el = document.createElement('div')
    el.classList.add('elm-midpoint-marker')
    el.style.cssText = 'width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,0.001)'
    const diamond = document.createElement('div')
    diamond.style.cssText = [
      'width:12px', 'height:12px',
      'background:#ffffff',
      'border:2px solid var(--elm-handle,var(--color-primary-500))',
      'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
      'transform:rotate(45deg)',
      'border-radius:3px',
      'transition:all 0.1s',
    ].join(';')
    el.appendChild(diamond)
    el.addEventListener('mouseenter', () => { diamond.style.background = 'var(--elm-handle-soft,var(--color-primary-100))' })
    el.addEventListener('mouseleave', () => { diamond.style.background = '#ffffff' })
    return el
  }

  const el = document.createElement('div')
  el.classList.add('elm-vertex') // same hook as the Leaflet adapter's vertex handles
  el.style.cssText = [
    'width:12px', 'height:12px',
    `background:${selected ? 'var(--elm-handle,var(--color-primary-500))' : '#ffffff'}`,
    `border:2px solid ${selected ? 'var(--elm-handle-strong,var(--color-primary-700))' : 'var(--elm-handle,var(--color-primary-500))'}`,
    'border-radius:3px',
    'cursor:pointer',
    'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
    'transition:background 0.15s',
  ].join(';')
  el.dataset.elmSelected = selected ? '1' : '0'
  // Hover stays grounded in current selected state, which is reflected on the
  // element via data-elm-selected (updated by paintVertex).
  el.addEventListener('mouseenter', () => { el.style.background = 'var(--elm-handle-soft,var(--color-primary-100))' })
  el.addEventListener('mouseleave', () => {
    el.style.background = el.dataset.elmSelected === '1' ? 'var(--elm-handle,var(--color-primary-500))' : '#ffffff'
  })
  return el
}

/** DOM-marker ceiling per ring (vertices and midpoints each). A 50k-vertex
 *  boundary used to create 100k maplibregl.Markers on vertex-edit entry — a
 *  multi-minute main-thread freeze. Same cap and sampling as adapter-leaflet. */
const MAX_VISIBLE_MARKERS = 500

/** Grab band around an edge for drag-to-insert: the edge-snap diamond's 15 px. */
const EDGE_GRAB_PX = 15

/**
 * Which of `pts` get a marker. Small rings: all of them (no viewport
 * dependency). Over the cap: the in-viewport ones, sampled evenly by on-screen
 * arc length (not array index — OSM vertex density varies ~10x along one
 * boundary), plus `forced` (selected) indices so a selection never vanishes.
 */
function pickMarkerIndices(map: MapLibreMap, pts: [number, number][], forced: (i: number) => boolean): { indices: number[]; capped: boolean } {
  const all = pts.map((_, i) => i)
  if (pts.length <= MAX_VISIBLE_MARKERS) return { indices: all, capped: false }
  const b = map.getBounds()
  const inView = all.filter((i) => b.contains(pts[i]))
  if (inView.length <= MAX_VISIBLE_MARKERS) return { indices: inView, capped: true }
  const cum = [0]
  let prev = map.project(pts[inView[0]])
  for (let k = 1; k < inView.length; k++) {
    const p = map.project(pts[inView[k]])
    cum.push(cum[k - 1] + Math.hypot(p.x - prev.x, p.y - prev.y))
    prev = p
  }
  const total = cum[cum.length - 1]
  const picked = new Set<number>()
  let cursor = 0
  for (let k = 0; k < MAX_VISIBLE_MARKERS; k++) {
    const target = total === 0 ? k : (k * total) / MAX_VISIBLE_MARKERS
    while (cursor < cum.length - 1 && cum[cursor + 1] < target) cursor++
    picked.add(inView[cursor])
  }
  for (const i of inView) if (forced(i)) picked.add(i)
  return { indices: [...picked].sort((x, y) => x - y), capped: true }
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  const midLng = (a[0] + b[0]) / 2
  const toY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
  const fromY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI
  const midLat = fromY((toY(a[1]) + toY(b[1])) / 2)
  return [midLng, midLat]
}

interface Props {
  map: MapLibreMap
  feature: GeoJSONFeature
  /**
   * Pre-selected vertex indices (ring 0 only) — used by box-select-while-
   * a-feature-is-selected to drop the user straight into vertex edit with
   * those vertices ready for bulk delete/simplify. Parent is responsible
   * for clearing this the turn after we consume it.
   */
  initialSelectedIndices?: number[]
}

export default function VertexEditor({ map, feature, initialSelectedIndices }: Props) {
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const selectedIds = useDataStore((s) => s.selectedIds)
  const selectedPartIndex = useUIStore((s) => s.selectedPartIndex)
  const markersRef = useRef<maplibregl.Marker[]>([])
  useHandleVars(feature, map.getContainer())

  // A finger can't hover: every midpoint shows, and handles get a 44 px hit area
  // (the `elm-touch` class, see TOUCH_HANDLE_CSS). A mouse keeps the hovered-edge midpoint.
  const touch = useTouchInput()
  const touchRef = useRef(touch)
  touchRef.current = touch
  useEffect(() => {
    const el = map.getContainer()
    el.classList.toggle('elm-touch', touch)
    if (!hoverLockRef.current) {
      midsRef.current.forEach((m) => { m.el.style.display = touch ? 'flex' : 'none' })
      hoveredMidRef.current = null
    }
    return () => el.classList.remove('elm-touch')
  }, [map, touch])

  // Multi-vertex selection. Keys are "${ringIdx}:${vertIdx}" — stable across
  // rebuilds as long as indices don't shift. Stored as state so the floating
  // action bar re-renders on toggle; stored in a ref too so marker DOM handlers
  // (created once per rebuild) can read the current set without a stale closure.
  const [selectedVertexKeys, setSelectedVertexKeys] = useState<Set<string>>(() => {
    if (initialSelectedIndices && initialSelectedIndices.length > 0) {
      return new Set(initialSelectedIndices.map((i) => `0:${i}`))
    }
    return new Set()
  })
  const selectedVertexKeysRef = useRef(selectedVertexKeys)
  useEffect(() => { selectedVertexKeysRef.current = selectedVertexKeys }, [selectedVertexKeys])

  // Track per-vertex DOM elements so shift+click can repaint without a full rebuild.
  const vertexElsRef = useRef<Map<string, HTMLElement>>(new Map())

  // Right-click menu on a point, and the coordinate editor it can open.
  type PointRef = { ringIdx: number; vertIdx: number }
  const [pointMenu, setPointMenu] = useState<(PointRef & { x: number; y: number }) | null>(null)
  const closePointMenu = useCallback(() => setPointMenu(null), [])
  const [coordEdit, setCoordEdit] = useState<PointRef | null>(null)

  // Clear selection whenever the feature or the active sub-part changes — the
  // indices become meaningless across such transitions.
  useEffect(() => {
    setSelectedVertexKeys(new Set())
    setPointMenu(null)
    setCoordEdit(null)
  }, [feature.id, selectedPartIndex])

  // Post-mount additive merge of `initialSelectedIndices`. Lazy useState above
  // already handles mount with a pre-selected set; this hook covers the new
  // case of a shift+drag firing another box-select *while we're already in
  // vertex edit*. Init to the mount-time prop reference so the first render is
  // a no-op (prevents double-application on top of the lazy init).
  const lastInitialIndicesRef = useRef(initialSelectedIndices)
  useEffect(() => {
    if (initialSelectedIndices === lastInitialIndicesRef.current) return
    lastInitialIndicesRef.current = initialSelectedIndices
    if (!initialSelectedIndices || initialSelectedIndices.length === 0) return
    setSelectedVertexKeys((prev) => {
      const next = new Set(prev)
      for (const i of initialSelectedIndices) next.add(`0:${i}`)
      for (const i of initialSelectedIndices) {
        const el = vertexElsRef.current.get(`0:${i}`)
        if (el) paintVertex(el, true)
      }
      return next
    })
  }, [initialSelectedIndices])

  // Patch just this feature's geometry in elm-features (updateData diff).
  function paintLiveSource(fullGeometry: Geometry) {
    paintLiveGeometries(map, new Map([[feature.id, fullGeometry]]))
  }

  // vertexEditPatch: the first committed change turns a circle / rectangle / route into a plain shape / line.
  function commit(newSimple: SimpleGeometry) {
    const wrapped = wrapPart(feature.geometry, selectedPartIndex, newSimple)
    dataStore.getState().updateFeature(feature.id, vertexEditPatch(feature, wrapped))
  }

  // Global Cmd/Ctrl tracker — maplibre marker drag events don't expose
  // keyboard modifiers, so we mirror them via window listeners. Read at
  // dragend to skip topology propagation when the user wants to "tear free".
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

  function rebuildMarkers() {
    ensureStyles()
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    vertexElsRef.current = new Map()
    midsRef.current = []
    hoveredMidRef.current = null
    hoverLockRef.current = false

    const activePart = getActivePart(feature.geometry, selectedPartIndex)
    if (!activePart) return // Multi* with no part selected — nothing to edit

    // Circles / rectangles / routes: every point edit is allowed (the notice was shown on
    // enter); the first committed change makes them plain (vertexEditPatch in commit).
    const rings = getVertexRings(activePart)
    const selectedSet = selectedVertexKeysRef.current
    cappedRef.current = false

    rings.forEach((ring, ringIdx) => {
      const verts = activePart.type === 'Polygon' ? ring.slice(0, -1) : ring
      const picked = pickMarkerIndices(map, verts, (i) => selectedSet.has(`${ringIdx}:${i}`))
      if (picked.capped) cappedRef.current = true

      for (const vertIdx of picked.indices) {
        const coord = verts[vertIdx]
        const key = `${ringIdx}:${vertIdx}`
        const el = makeVertexEl(selectedSet.has(key))
        vertexElsRef.current.set(key, el)

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(coord as [number, number])
          .addTo(map)

        // Click selects only this point; shift+click toggles it. Never deletes.
        // The browser still fires `click` after a marker drag (mousedown and
        // mouseup land on the same element), so `dragged` swallows that one.
        let dragged = false
        // Long-press (finger) opens the right-click menu.
        const longPress = attachLongPress(el, (pe) => setPointMenu({ ringIdx, vertIdx, x: pe.clientX, y: pe.clientY }))
        el.addEventListener('click', (e) => {
          // Keep the map from seeing it (would exit vertex edit / reselect).
          e.stopPropagation()
          e.preventDefault()
          if (dragged) { dragged = false; return }
          if (longPress.fired()) return
          if (e.shiftKey) {
            setSelectedVertexKeys((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              // Repaint just this vertex — avoids rebuilding markers mid-drag.
              const cur = vertexElsRef.current.get(key)
              if (cur) paintVertex(cur, next.has(key))
              return next
            })
          } else {
            setSelectedVertexKeys(new Set([key]))
            vertexElsRef.current.forEach((v, k) => paintVertex(v, k === key))
          }
        })

        marker.on('dragstart', () => {
          dragged = true
          hoverLockRef.current = true
          dataStore.getState().takeSnapshot()
          document.querySelectorAll('.elm-midpoint-marker').forEach((e) => {
            ;(e as HTMLElement).style.display = 'none'
          })
          // Suppress hover-name tooltip during vertex drag — the cursor sweeps
          // over the polygon body otherwise.
          setFeatureDragActive(true)
        })

        const originalCoord: [number, number] = [coord[0], coord[1]]

        // One live repaint per frame; dragend commits from the marker itself.
        const dragPaint = rafThrottle(() => {
          const ll = marker.getLngLat()
          const newCoord: [number, number] = [ll.lng, ll.lat]
          const mutated = applyVertexMove(activePart, ringIdx, vertIdx, newCoord)
          paintLiveSource(wrapPart(feature.geometry, selectedPartIndex, mutated))
        })
        marker.on('drag', () => dragPaint.schedule())

        marker.on('dragend', () => {
          dragPaint.cancel()
          const ll = marker.getLngLat()
          const newCoord: [number, number] = [ll.lng, ll.lat]
          const mutated = applyVertexMove(activePart, ringIdx, vertIdx, newCoord)
          commit(mutated)
          // Topology: if enabled, move neighboring features' shared vertex too.
          if (uiStore.getState().topoEditEnabled && !topoSuppressedRef.current) {
            const ds = dataStore.getState()
            ds.updateFeatures(commitTopoMove(
              ds.features,
              feature.id,
              originalCoord,
              newCoord))
          }
          setFeatureDragActive(false)
          hoverLockRef.current = false
          // Safety net if the browser fires no click after this drag.
          setTimeout(() => { dragged = false }, 50)
        })

        el.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          // Stop the canvas-container listener from opening the feature menu.
          e.stopPropagation()
          setPointMenu({ ringIdx, vertIdx, x: e.clientX, y: e.clientY })
        })

        markersRef.current.push(marker)
      }

      if (verts.length >= 2) {
        const segmentCount = activePart.type === 'Polygon' ? verts.length : verts.length - 1
        const mids: [number, number][] = []
        for (let i = 0; i < segmentCount; i++) mids.push(midpoint(verts[i], verts[(i + 1) % verts.length]))
        const pickedMids = pickMarkerIndices(map, mids, () => false)
        if (pickedMids.capped) cappedRef.current = true
        for (const i of pickedMids.indices) {
          const a = verts[i]
          const b = verts[(i + 1) % verts.length]
          const mid = mids[i]
          const midEl = makeVertexEl(false, true)
          // Shown only while its edge is hovered (see the mousemove effect); always for a finger.
          midEl.style.display = touchRef.current ? 'flex' : 'none'
          midsRef.current.push({ el: midEl, a, b })

          const midMarker = new maplibregl.Marker({ element: midEl, draggable: true })
            .setLngLat(mid)
            .addTo(map)

          let midDragged = false

          midMarker.on('dragstart', () => {
            midDragged = true
            hoverLockRef.current = true // keep this midpoint shown while it's dragged off its edge
            dataStore.getState().takeSnapshot()
            setFeatureDragActive(true)
          })

          const midDragPaint = rafThrottle(() => {
            const ll = midMarker.getLngLat()
            const newCoord: [number, number] = [ll.lng, ll.lat]
            const mutated = applyVertexInsert(activePart, ringIdx, i + 1, newCoord)
            paintLiveSource(wrapPart(feature.geometry, selectedPartIndex, mutated))
          })
          midMarker.on('drag', () => midDragPaint.schedule())

          midMarker.on('dragend', () => {
            midDragPaint.cancel()
            const ll = midMarker.getLngLat()
            const newCoord: [number, number] = [ll.lng, ll.lat]
            const mutated = applyVertexInsert(activePart, ringIdx, i + 1, newCoord)
            commit(mutated)
            if (uiStore.getState().topoEditEnabled) {
              const ds = dataStore.getState()
              ds.updateFeatures(commitTopoInsert(
                ds.features,
                feature.id,
                a,
                b,
                newCoord))
            }
            // Don't reset midDragged synchronously — browsers may fire a
            // synthetic `click` after dragend on the same element. If that
            // happens, the click handler below will consume the flag and bail.
            // The timeout is the safety net for browsers that don't fire click.
            setTimeout(() => { midDragged = false }, 50)
            setFeatureDragActive(false)
            hoverLockRef.current = false
          })

          midEl.addEventListener('click', (e) => {
            e.stopPropagation()
            if (midDragged) { midDragged = false; return }
            dataStore.getState().takeSnapshot()
            const mutated = applyVertexInsert(activePart, ringIdx, i + 1, mid)
            commit(mutated)
            if (uiStore.getState().topoEditEnabled) {
              const ds = dataStore.getState()
              ds.updateFeatures(commitTopoInsert(
                ds.features,
                feature.id,
                a,
                b,
                mid))
            }
          })

          markersRef.current.push(midMarker)
        }
      }
    })
  }

  // Midpoints show only on the hovered edge (as on Leaflet): the nearest segment
  // within 22 px of the cursor (36 px to let go, so it doesn't flicker on approach).
  const midsRef = useRef<{ el: HTMLElement; a: [number, number]; b: [number, number] }[]>([])
  const hoveredMidRef = useRef<number | null>(null)
  const hoverLockRef = useRef(false) // a vertex or midpoint drag is in progress
  useEffect(() => {
    const show = (idx: number | null) => {
      if (idx === hoveredMidRef.current) return
      const mids = midsRef.current
      if (hoveredMidRef.current !== null && mids[hoveredMidRef.current]) mids[hoveredMidRef.current].el.style.display = 'none'
      if (idx !== null) mids[idx].el.style.display = 'flex'
      hoveredMidRef.current = idx
    }
    const onMove = (e: MapMouseEvent) => {
      if (hoverLockRef.current || touchRef.current) return
      const { x, y } = e.point
      let best = -1, bestSq = Infinity
      midsRef.current.forEach(({ a, b }, i) => {
        const p = map.project(a), q = map.project(b)
        const dx = q.x - p.x, dy = q.y - p.y
        const len = dx * dx + dy * dy
        const t = len ? Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len)) : 0
        const d = (p.x + t * dx - x) ** 2 + (p.y + t * dy - y) ** 2
        if (d < bestSq) { bestSq = d; best = i }
      })
      const limit = hoveredMidRef.current === null ? 22 : 36
      show(best >= 0 && bestSq <= limit * limit ? best : null)
    }
    // Fires also when the cursor moves onto a marker inside the map: only a real exit hides.
    const onOut = (e: MapMouseEvent) => {
      const to = e.originalEvent.relatedTarget
      if (!hoverLockRef.current && !touchRef.current && !(to instanceof Node && map.getContainer().contains(to))) show(null)
    }
    map.on('mousemove', onMove)
    map.on('mouseout', onOut)
    return () => { map.off('mousemove', onMove); map.off('mouseout', onOut) }
  }, [map])

  // Grab an edge anywhere along it (where the snap diamond shows) and drag: a new
  // point is inserted at the drop position. Same gesture as dragging the midpoint,
  // which before was the only handle, so a mousedown beside it panned the map.
  const edgeDownRef = useRef<(e: MapMouseEvent) => void>(() => {})
  edgeDownRef.current = (e: MapMouseEvent) => {
    const ev = e.originalEvent
    if (hoverLockRef.current || ev.button !== 0 || ev.shiftKey) return
    if ((ev.target as Element | null)?.closest?.('.maplibregl-marker')) return // vertex / midpoint handle
    const activePart = getActivePart(feature.geometry, selectedPartIndex)
    if (!activePart || (activePart.type !== 'Polygon' && activePart.type !== 'LineString')) return
    const isPoly = activePart.type === 'Polygon'
    // Nearest segment in screen pixels, across all rings.
    let best: { ringIdx: number; seg: number; a: [number, number]; b: [number, number] } | null = null
    let bestSq = EDGE_GRAB_PX * EDGE_GRAB_PX
    getVertexRings(activePart).forEach((ring, ringIdx) => {
      const verts = isPoly ? ring.slice(0, -1) : ring
      const n = isPoly ? verts.length : verts.length - 1
      if (verts.length < 2) return
      let p = map.project(verts[0])
      for (let i = 0; i < n; i++) {
        const b = verts[(i + 1) % verts.length]
        const q = map.project(b)
        const dx = q.x - p.x, dy = q.y - p.y
        const len = dx * dx + dy * dy
        const t = len ? Math.max(0, Math.min(1, ((e.point.x - p.x) * dx + (e.point.y - p.y) * dy) / len)) : 0
        const d = (p.x + t * dx - e.point.x) ** 2 + (p.y + t * dy - e.point.y) ** 2
        if (d < bestSq) { bestSq = d; best = { ringIdx, seg: i, a: verts[i], b } }
        p = q
      }
    })
    if (!best) return
    const { ringIdx, seg, a, b } = best as { ringIdx: number; seg: number; a: [number, number]; b: [number, number] }
    e.preventDefault() // no drag-pan / box-zoom for this gesture

    const start = e.point
    let coord: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    let started = false
    const paint = rafThrottle(() => {
      paintLiveSource(wrapPart(feature.geometry, selectedPartIndex, applyVertexInsert(activePart, ringIdx, seg + 1, coord)))
    })
    const onMove = (me: MapMouseEvent) => {
      if (!started) {
        if (Math.hypot(me.point.x - start.x, me.point.y - start.y) < 3) return // a click, not a drag
        started = true
        hoverLockRef.current = true
        dataStore.getState().takeSnapshot()
        document.querySelectorAll('.elm-midpoint-marker').forEach((el) => { (el as HTMLElement).style.display = 'none' })
        hoveredMidRef.current = null
        setFeatureDragActive(true)
      }
      coord = [me.lngLat.lng, me.lngLat.lat]
      const mod = me.originalEvent.metaKey || me.originalEvent.ctrlKey
      if (uiStore.getState().snapEnabled && !mod) {
        const snap = findSnapPoint(coord[0], coord[1], map, dataStore.getState().features, 15, new Set([feature.id]))
        if (snap) coord = snap.lnglat
      }
      paint.schedule()
    }
    const onUp = () => {
      map.off('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      paint.cancel()
      if (!started) return
      commit(applyVertexInsert(activePart, ringIdx, seg + 1, coord))
      if (isPoly && uiStore.getState().topoEditEnabled) {
        const ds = dataStore.getState()
        ds.updateFeatures(commitTopoInsert(ds.features, feature.id, a, b, coord))
      }
      setFeatureDragActive(false)
      hoverLockRef.current = false
    }
    map.on('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  useEffect(() => {
    const onDown = (e: MapMouseEvent) => edgeDownRef.current(e)
    map.on('mousedown', onDown)
    return () => { map.off('mousedown', onDown) }
  }, [map])

  // Over the marker cap only the in-view part has markers, so rebuild after a pan/zoom.
  const cappedRef = useRef(false)
  const rebuildRef = useRef(rebuildMarkers)
  rebuildRef.current = rebuildMarkers
  useEffect(() => {
    const onMoveEnd = () => { if (cappedRef.current) rebuildRef.current() }
    map.on('moveend', onMoveEnd)
    return () => { map.off('moveend', onMoveEnd) }
  }, [map])

  useEffect(() => {
    rebuildMarkers()
    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      vertexElsRef.current = new Map()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, map, selectedIds, selectedPartIndex])

  // ─── Single delete (right-click menu) ────────────────────────────────────
  function deleteVertex(ringIdx: number, vertIdx: number) {
    const activePart = getActivePart(feature.geometry, selectedPartIndex)
    if (!activePart) return
    const mutated = applyVertexDelete(activePart, ringIdx, vertIdx)
    if (!mutated) {
      emit({ type: 'warning', message: `Cannot delete: ${activePart.type === 'Polygon' ? 'an area needs at least 3' : activePart.type === 'LineString' ? 'a line needs at least 2' : 'at least 1'} points` })
      return
    }
    const deletedCoord = getVertexRings(activePart)[ringIdx][vertIdx]
    dataStore.getState().takeSnapshot()
    commit(mutated)
    // Indices shift after a delete, so any point selection is now stale.
    setSelectedVertexKeys(new Set())
    if (activePart.type === 'Polygon' && uiStore.getState().topoEditEnabled) {
      const ds = dataStore.getState()
      ds.updateFeatures(commitTopoDelete(ds.features, feature.id, [deletedCoord]))
    }
  }

  // ─── Bulk delete ─────────────────────────────────────────────────────────
  //
  // Deletes every selected vertex in a single commit. Honors the same min-vertex
  // rules as the single-delete path. Runs descending so
  // later deletions in the same ring don't shift earlier indices.
  function handleDeleteSelected() {
    const keys = selectedVertexKeysRef.current
    if (keys.size === 0) return

    const activePart = getActivePart(feature.geometry, selectedPartIndex)
    if (!activePart) return

    // Group selected vertex indices by ring.
    const perRing = new Map<number, number[]>()
    for (const key of keys) {
      const [rs, vs] = key.split(':')
      const ringIdx = Number(rs)
      const vertIdx = Number(vs)
      const list = perRing.get(ringIdx) ?? []
      list.push(vertIdx)
      perRing.set(ringIdx, list)
    }

    // LineString / MultiPoint: single "ring" at index 0.
    if (activePart.type === 'LineString') {
      const coords = activePart.coordinates as [number, number][]
      const toDrop = new Set(perRing.get(0) ?? [])
      const remaining = coords.filter((_, i) => !toDrop.has(i))
      if (remaining.length < 2) {
        emit({ type: 'warning', message: 'Cannot delete: a line needs at least 2 points' })
        return
      }
      dataStore.getState().takeSnapshot()
      commit({ type: 'LineString', coordinates: remaining })
      setSelectedVertexKeys(new Set())
      return
    }

    if (activePart.type === 'MultiPoint') {
      const coords = activePart.coordinates as [number, number][]
      const toDrop = new Set(perRing.get(0) ?? [])
      const remaining = coords.filter((_, i) => !toDrop.has(i))
      if (remaining.length < 1) {
        emit({ type: 'warning', message: 'Cannot delete: at least 1 point required' })
        return
      }
      dataStore.getState().takeSnapshot()
      commit({ type: 'MultiPoint', coordinates: remaining })
      setSelectedVertexKeys(new Set())
      return
    }

    if (activePart.type === 'Polygon') {
      const rings = activePart.coordinates as [number, number][][]
      const newRings: [number, number][][] = []
      for (let ri = 0; ri < rings.length; ri++) {
        const ring = rings[ri]
        const verts = ring.slice(0, -1)
        const toDrop = new Set(perRing.get(ri) ?? [])
        if (toDrop.size === 0) {
          newRings.push(ring)
          continue
        }
        const remaining = verts.filter((_, i) => !toDrop.has(i))
        if (remaining.length < 3) {
          emit({ type: 'warning', message: 'Cannot delete: an area needs at least 3 points' })
          return
        }
        newRings.push([...remaining, remaining[0]])
      }
      dataStore.getState().takeSnapshot()
      commit({ type: 'Polygon', coordinates: newRings })
      setSelectedVertexKeys(new Set())
      if (uiStore.getState().topoEditEnabled) {
        const deletedCoords = [...perRing].flatMap(([ri, vis]) => vis.map((vi) => rings[ri][vi]))
        const ds = dataStore.getState()
        ds.updateFeatures(commitTopoDelete(ds.features, feature.id, deletedCoords))
      }
      return
    }
  }

  /**
   * Simplify-to-selected: reduces the LineString/Polygon between the min and
   * max selected vertex index down to just the non-redundant selected points
   * (via RDP at 1e-5 tolerance). Ring/line vertices outside the selection's
   * [min..max] span are left untouched. Matches adapter-leaflet's
   * `handleSimplifySelected`.
   *
   * Requires at least 3 selected vertices and operates only on LineString /
   * Polygon (not MultiPoint / MultiLineString sub-parts — consistent with
   * leaflet which scopes to the feature's active geometry).
   */
  function handleSimplifySelected() {
    if (selectedVertexKeysRef.current.size < 3) {
      emit({ type: 'warning', message: 'Select at least 3 points to simplify' })
      return
    }
    const activePart = getActivePart(feature.geometry, selectedPartIndex)
    if (!activePart) return
    if (activePart.type !== 'LineString' && activePart.type !== 'Polygon') return

    // Collect indices of selected vertices within a single ring. Multi-ring
    // polygons: all selected must share the same ring; otherwise we bail.
    const byRing = new Map<number, number[]>()
    for (const key of selectedVertexKeysRef.current) {
      const [ringStr, vertStr] = key.split(':')
      const ringIdx = Number(ringStr)
      const vertIdx = Number(vertStr)
      const list = byRing.get(ringIdx) ?? []
      list.push(vertIdx)
      byRing.set(ringIdx, list)
    }
    if (byRing.size !== 1) {
      emit({ type: 'warning', message: 'Selection must stay within one ring/line to simplify' })
      return
    }
    const [ringIdx, indicesRaw] = Array.from(byRing.entries())[0]
    const indices = indicesRaw.sort((a, b) => a - b)
    const minIdx = indices[0]
    const maxIdx = indices[indices.length - 1]

    const isPolygon = activePart.type === 'Polygon'
    const coords: [number, number][] = isPolygon
      ? (activePart.coordinates as [number, number][][])[ringIdx].slice(0, -1)
      : (activePart.coordinates as [number, number][])
    const segment = coords.slice(minIdx, maxIdx + 1)
    const simplified = rdp(segment, 1e-5)
    const removed = segment.length - simplified.length
    if (removed === 0) {
      emit({ type: 'warning', message: 'Nothing to remove: no selected point sits on a straight line' })
      return
    }

    const newCoords = [...coords.slice(0, minIdx), ...simplified, ...coords.slice(maxIdx + 1)]
    const minVerts = isPolygon ? 3 : 2
    if (newCoords.length < minVerts) {
      emit({ type: 'warning', message: `Cannot simplify: ${isPolygon ? 'an area needs at least 3' : 'a line needs at least 2'} points` })
      return
    }

    dataStore.getState().takeSnapshot()
    if (isPolygon) {
      const rings = (activePart.coordinates as [number, number][][]).map((r, ri) =>
        ri === ringIdx ? [...newCoords, newCoords[0]] : r,
      )
      commit({ type: 'Polygon', coordinates: rings })
    } else {
      commit({ type: 'LineString', coordinates: newCoords })
    }
    setSelectedVertexKeys(new Set())
    emit({ type: 'success', message: `Removed ${removed} extra point${removed !== 1 ? 's' : ''}` })
  }

  // ─── Keyboard listener (only active while the bar is visible) ────────────
  //
  // Capture phase so this runs before any global Delete-selected-features
  // handler can claim the event. The bar is only mounted while selection is
  // non-empty, so guards keep this surgical.
  useEffect(() => {
    if (selectedVertexKeys.size === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!isForThisEditor(e)) return
      e.preventDefault()
      e.stopPropagation()
      handleDeleteSelected()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVertexKeys])

  const showBar = selectedVertexKeys.size > 0

  const menuEl = pointMenu && (() => {
    const key = `${pointMenu.ringIdx}:${pointMenu.vertIdx}`
    const inMulti = selectedVertexKeys.has(key) && selectedVertexKeys.size > 1
    return (
      <ContextMenu
        x={pointMenu.x}
        y={pointMenu.y}
        onClose={closePointMenu}
        items={[
          { label: 'Edit coordinates…', icon: <Crosshair size={16} />, onClick: () => setCoordEdit({ ringIdx: pointMenu.ringIdx, vertIdx: pointMenu.vertIdx }) },
          { separator: true },
          {
            label: inMulti ? `Delete ${selectedVertexKeys.size} points` : 'Delete point',
            icon: <Trash size={16} />,
            onClick: () => inMulti ? handleDeleteSelected() : deleteVertex(pointMenu.ringIdx, pointMenu.vertIdx),
          },
        ]}
      />
    )
  })()

  const editPart = coordEdit && getActivePart(feature.geometry, selectedPartIndex)
  const editCoord = editPart && coordEdit ? getVertexRings(editPart)[coordEdit.ringIdx]?.[coordEdit.vertIdx] : undefined
  const coordEl = coordEdit && editPart && editCoord && (
    <PreciseCoordsOverlay
      key={`${coordEdit.ringIdx}:${coordEdit.vertIdx}`}
      map={map}
      coords={editCoord}
      onSave={(newCoord) => {
        dataStore.getState().takeSnapshot()
        commit(applyVertexMove(editPart, coordEdit.ringIdx, coordEdit.vertIdx, newCoord))
        if (editPart.type === 'Polygon' && uiStore.getState().topoEditEnabled) {
          const ds = dataStore.getState()
          ds.updateFeatures(commitTopoMove(ds.features, feature.id, editCoord, newCoord))
        }
      }}
      onClose={() => setCoordEdit(null)}
    />
  )

  return <>
    {menuEl}
    {coordEl}
    {showBar && (
      <VertexSelectionBar
        mapContainer={map.getContainer()}
        count={selectedVertexKeys.size}
        onSimplify={handleSimplifySelected}
        onDelete={handleDeleteSelected}
      />
    )}
  </>
}

// ─── Pure vertex-mutation helpers on a SimpleGeometry ────────────────────────

function applyVertexMove(
  geom: SimpleGeometry,
  ringIdx: number,
  vertIdx: number,
  newCoord: [number, number],
): SimpleGeometry {
  // withXY: the moved point keeps its altitude (and any other extra members).
  if (geom.type === 'Point') return { type: 'Point', coordinates: withXY(geom.coordinates as number[], newCoord) }
  if (geom.type === 'MultiPoint') {
    const coords = [...(geom.coordinates as [number, number][])]
    coords[vertIdx] = withXY(coords[vertIdx], newCoord)
    return { type: 'MultiPoint', coordinates: coords }
  }
  if (geom.type === 'LineString') {
    const coords = [...(geom.coordinates as [number, number][])]
    coords[vertIdx] = withXY(coords[vertIdx], newCoord)
    return { type: 'LineString', coordinates: coords }
  }
  if (geom.type === 'Polygon') {
    const coords = (geom.coordinates as [number, number][][]).map((r, ri) => {
      if (ri !== ringIdx) return r
      const updated = [...r]
      updated[vertIdx] = withXY(updated[vertIdx], newCoord)
      if (vertIdx === 0) updated[updated.length - 1] = updated[0]
      return updated
    })
    return { type: 'Polygon', coordinates: coords }
  }
  return geom
}

function applyVertexDelete(
  geom: SimpleGeometry,
  ringIdx: number,
  vertIdx: number,
): SimpleGeometry | null {
  if (geom.type === 'LineString') {
    const coords = (geom.coordinates as [number, number][]).filter((_, i) => i !== vertIdx)
    if (coords.length < 2) return null
    return { type: 'LineString', coordinates: coords }
  }
  if (geom.type === 'Polygon') {
    const ring = (geom.coordinates as [number, number][][])[ringIdx]
    const verts = ring.slice(0, -1)
    if (verts.length <= 3) return null
    const newVerts = verts.filter((_, i) => i !== vertIdx)
    const newRings = (geom.coordinates as [number, number][][]).map((r, ri) =>
      ri === ringIdx ? [...newVerts, newVerts[0]] : r,
    )
    return { type: 'Polygon', coordinates: newRings }
  }
  if (geom.type === 'MultiPoint') {
    const coords = (geom.coordinates as [number, number][]).filter((_, i) => i !== vertIdx)
    if (coords.length < 1) return null
    return { type: 'MultiPoint', coordinates: coords }
  }
  return null
}

function applyVertexInsert(
  geom: SimpleGeometry,
  ringIdx: number,
  insertIdx: number,
  newCoord: [number, number],
): SimpleGeometry {
  // insertedPosition: a new point between two 3D points gets their mean altitude.
  if (geom.type === 'LineString') {
    const coords = [...(geom.coordinates as [number, number][])]
    coords.splice(insertIdx, 0, insertedPosition(coords[insertIdx - 1], coords[insertIdx], newCoord))
    return { type: 'LineString', coordinates: coords }
  }
  if (geom.type === 'Polygon') {
    const ring = (geom.coordinates as [number, number][][])[ringIdx]
    const verts = ring.slice(0, -1)
    verts.splice(insertIdx, 0, insertedPosition(verts[insertIdx - 1], verts[insertIdx % verts.length], newCoord))
    const newRings = (geom.coordinates as [number, number][][]).map((r, ri) =>
      ri === ringIdx ? [...verts, verts[0]] : r,
    )
    return { type: 'Polygon', coordinates: newRings }
  }
  return geom
}
