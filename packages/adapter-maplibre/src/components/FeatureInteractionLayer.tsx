/**
 * FeatureInteractionLayer — handles selection, hover highlight, drag-to-translate,
 * double-click to enter vertex edit, and manages VertexEditor / TransformControls.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point, Map as MapLibreMap, MapMouseEvent, MapLayerMouseEvent, MapTouchEvent } from 'maplibre-gl'
import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import type { GeoJSONFeature, Geometry } from '@element-editor/core'
import { offsetGeometry, project, isMultiGeometry, withXY, vertexEditNotice, isTouchEvent, canVertexEdit, CLICK_SLOP_PX } from '@element-editor/core/internal'
import { findPartAtPoint } from '../utils/findPartAtPoint'
import { INTERACTIVE_FEATURE_LAYERS, setHoverState } from './FeatureLayer'
import VertexEditor from './VertexEditor'
import TransformControls from './TransformControls'
import TextEditOverlay from './TextEditOverlay'
import PreciseCoordsOverlay from './PreciseCoordsOverlay'
import BoxSelectHandler from './BoxSelectHandler'
import { bindFeatureTooltip, unbindFeatureTooltip, setFeatureDragActive } from '../utils/featureTooltip'
import { freshFeatureId, setFreshFeature } from '../utils/freshFeature'
import { markModifierDragEnd } from '../utils/modifierDragFlag'
import { isFreehandCommitConsumed } from '../utils/freehandCommitFlag'
import { toolCursor } from '../utils/toolCursor'
import { useModifierDragCursor } from '../hooks/useModifierDragCursor'
import { getLastPointer } from '../hooks/lastPointer'
import { rafThrottle } from '../utils/rafThrottle'
import { paintLiveGeometries } from '../utils/liveFeatureSource'
import { paintAccent, useAccentPaint, type AccentPaint } from '../utils/accentPaint'
import { FeatureMapContextMenu, useEmit, type FeatureContextMenuData } from '@element-editor/ui'
import { useContextMenu } from '@element-editor/ui/internal'

/**
 * `queryRenderedFeatures` throws "layer does not exist" during StrictMode
 * double-mount / `map.remove()` races if the layer was cleaned up between
 * the React effect scheduling and the user event firing. We wrap every call
 * site so those races don't spam the console.
 */
function safeQueryRendered(
  map: MapLibreMap,
  // Only a maplibre `Point` or an [x, y] array is a point: a plain `{ x, y }`
  // is silently read as "no geometry" and queries the whole viewport.
  point: Point | [number, number],
  layers: string[],
): ReturnType<MapLibreMap['queryRenderedFeatures']> {
  // Between a `setStyle` and Element's repair the layers are missing; MapLibre would fire an error event.
  if (!layers.every((id) => map.getLayer(id))) return []
  try {
    return map.queryRenderedFeatures(point, { layers })
  } catch {
    return []
  }
}

// ── Drag-ghost source (Alt+drag duplicate preview) ───────────────────────────

export function initDragGhostLayers(map: MapLibreMap) {
  const SRC = 'elm-drag-ghost'
  if (map.getSource(SRC)) return
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'elm-drag-ghost-fill',
    type: 'fill',
    source: SRC,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: { 'fill-opacity': 0.18 },
  })
  map.addLayer({
    id: 'elm-drag-ghost-line',
    type: 'line',
    source: SRC,
    filter: [
      'in',
      ['geometry-type'],
      ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']],
    ],
    paint: { 'line-opacity': 0.6, 'line-width': 2, 'line-dasharray': [3, 3] },
  })
  map.addLayer({
    id: 'elm-drag-ghost-point',
    type: 'circle',
    source: SRC,
    filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
    paint: {
      'circle-radius': 7,
      'circle-opacity': 0.6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
  paintAccent(map, GHOST_ACCENT_PAINT)
}

export function cleanupDragGhostLayers(map: MapLibreMap) {
  for (const id of ['elm-drag-ghost-point', 'elm-drag-ghost-line', 'elm-drag-ghost-fill']) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource('elm-drag-ghost')) map.removeSource('elm-drag-ghost')
}

interface Props {
  map: MapLibreMap
}

const GHOST_ACCENT_PAINT: AccentPaint = [
  ['elm-drag-ghost-fill', 'fill-color', (p) => p[500]],
  ['elm-drag-ghost-line', 'line-color', (p) => p[500]],
  ['elm-drag-ghost-point', 'circle-color', (p) => p[500]],
]

export default function FeatureInteractionLayer({ map }: Props) {
  useAccentPaint(map, GHOST_ACCENT_PAINT)
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const features = useDataStore((s) => s.features)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const vertexEditActive = useUIStore((s) => s.vertexEditActive)
  const transformActive = useUIStore((s) => s.transformActive)
  const editingMode = useUIStore((s) => s.editingMode)
  const readonly = useUIStore((s) => s.readonly)

  // A feature deleted under a still cursor fires no mouseleave — drop its name tooltip.
  // Vertex edit shows no names at all.
  useEffect(() => {
    unbindFeatureTooltip()
  }, [features.length, vertexEditActive])

  // Entering vertex edit on a circle / rectangle / route, however it was entered (double-click,
  // Enter, Shift+drag box), says what an edit will do. Nothing converts yet: the first committed
  // point change does (vertexEditPatch in VertexEditor), as on Leaflet.
  useEffect(() => {
    if (!vertexEditActive) return
    const ds = dataStore.getState()
    const feature = ds.selectedIds.length === 1 ? ds.features.find((f) => f.id === ds.selectedIds[0]) : undefined
    const notice = vertexEditNotice(feature)
    if (notice) emit({ type: 'warning', message: notice })
  }, [vertexEditActive, dataStore, emit])

  // Vertex edit stays on while the user clicks another feature: the editor moves to it
  // (it renders the single selected feature). Keep the store's id on that feature too, so
  // ref.getVertexEdit / onVertexEditChange report it.
  useEffect(() => {
    const us = uiStore.getState()
    if (us.vertexEditFeatureId && selectedIds.length === 1 && selectedIds[0] !== us.vertexEditFeatureId) {
      us.setVertexEditFeature(selectedIds[0])
    }
  }, [selectedIds, uiStore])

  // Warn once (per editor) when the transform box opens on a route, as on Leaflet.
  const shownRouteTransformWarnRef = useRef(false)
  useEffect(() => {
    if (!transformActive || shownRouteTransformWarnRef.current) return
    const ds = dataStore.getState()
    const feature = ds.selectedIds.length === 1 ? ds.features.find((f) => f.id === ds.selectedIds[0]) : undefined
    if (feature?._drawType === 'route') {
      emit({ type: 'warning', message: 'Transforming may break road alignment.' })
      shownRouteTransformWarnRef.current = true
    }
  }, [transformActive, selectedIds, dataStore, emit])

  const hoveredIdRef = useRef<string | null>(null)
  const dragRef = useRef<{
    featureIds: string[]
    startLngLat: [number, number]
    startProjected: [number, number]
    geometryMode: 'visual' | 'spatial'
    startCoords: Map<string, Geometry>
    dragging: boolean
    duplicate: boolean
  } | null>(null)

  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [preciseCoordsId, setPreciseCoordsId] = useState<string | null>(null)
  const [pendingVertexSelection, setPendingVertexSelection] = useState<number[] | null>(null)

  // Consume the pending vertex selection on the first render after vertex-edit
  // exits — prevents next Enter-to-vertex from resurrecting a stale set.
  useEffect(() => {
    if (!vertexEditActive && pendingVertexSelection) setPendingVertexSelection(null)
  }, [vertexEditActive, pendingVertexSelection])

  const modifierCursor = useModifierDragCursor(readonly)

  const featureCtxMenu = useContextMenu<FeatureContextMenuData>()

  // ── Right-click context menu ───────────────────────────────────────────────
  useEffect(() => {
    if (readonly) return

    const canvas = map.getCanvasContainer()
    const onNativeContextMenu = (e: MouseEvent) => {
      // Suppress the browser's native menu anywhere on the map. MapLibre's
      // 'contextmenu' event doesn't cover this — it only fires for map-internal
      // gestures, not the browser chrome.
      e.preventDefault()

      const rect = canvas.getBoundingClientRect()
      const point: [number, number] = [e.clientX - rect.left, e.clientY - rect.top]
      const hits = safeQueryRendered(map, point, INTERACTIVE_FEATURE_LAYERS)
      if (hits.length === 0) return

      const id = String(hits[0].id ?? hits[0].properties?.id ?? '')
      if (!id) return

      const ds = dataStore.getState()
      const feature = ds.features.find((f) => f.id === id)
      if (!feature) return

      // Select the clicked feature unless it's already part of a 2+ multi-selection.
      const sel = ds.selectedIds
      if (!(sel.length >= 2 && sel.includes(id))) {
        ds.selectFeature(id)
      }

      // Point features (not text labels) can open the "precise coordinates" popup.
      const isPoint = feature.geometry.type === 'Point' && feature.properties?._isText !== 'true'
      featureCtxMenu.open(e.clientX, e.clientY, {
        feature,
        requestPreciseCoords: isPoint ? () => setPreciseCoordsId(id) : undefined,
      })
    }

    canvas.addEventListener('contextmenu', onNativeContextMenu)
    return () => { canvas.removeEventListener('contextmenu', onNativeContextMenu) }
  }, [readonly, dataStore, map, featureCtxMenu])

  // Over a feature with no tool: `move` on a selected one (a plain drag moves it, see the
  // drag effect below), `pointer` on the rest. The transform box keeps its own cursors.
  const hoverCursor = useCallback((id: string) => {
    const ui = uiStore.getState()
    const movable = !ui.transformActive && !ui.vertexEditActive && dataStore.getState().selectedIds.includes(id)
    return movable ? 'move' : 'pointer'
  }, [uiStore, dataStore])
  // Selecting (a click) or deselecting under a still cursor changes that cursor at once
  // (hoverCursor reads the stores: selectedIds / transformActive / vertexEditActive re-run this).
  useEffect(() => {
    const id = hoveredIdRef.current
    if (!id || editingMode !== 'none' || dragRef.current?.dragging) return
    modifierCursor.enter(map.getCanvas(), getLastPointer(), hoverCursor(id))
  }, [selectedIds, transformActive, vertexEditActive, editingMode, map, modifierCursor, hoverCursor])

  // ── Hover ──────────────────────────────────────────────────────────────────
  // The hover hit test below is the only thing that decides "over a feature" (so the
  // cursor, hover paint and name tooltip always agree), and modifierCursor is the only
  // writer of the canvas cursor for it: with no tool, `pointer` over a feature and ''
  // (MapLibre's grab / grabbing) elsewhere; with a tool, the tool's cursor stays the
  // base (DrawingLayer owns it). Writing `pointer` here and letting the hook capture it
  // as its "restore" cursor is what used to leave the pointer stuck after a hover.
  useEffect(() => {
    const drawing = editingMode !== 'none'
    const clearHover = (left = true) => {
      setHoverState(map, null, hoveredIdRef.current)
      hoveredIdRef.current = null
      if (left) setFreshFeature(map, null)
      unbindFeatureTooltip()
      modifierCursor.leave(drawing ? undefined : '')
    }
    const onMousemove = (e: MapMouseEvent) => {
      // A pan or a feature drag owns the cursor (grabbing) until it ends.
      if (map.dragPan.isActive() || dragRef.current?.dragging) return
      // During drawing we still need modifier-cursor affordances (users expect
      // Cmd/Alt to show move/copy on existing features even while the draw
      // tool is active), but we skip the generic 'pointer' cursor and the
      // hover outline so they don't compete with the tool's own visuals. The
      // hover-name tooltip stays on — knowing what you're about to overlap is
      // useful context while drawing.
      const hits = safeQueryRendered(map, e.point, INTERACTIVE_FEATURE_LAYERS)
      const id = hits.length > 0 ? String(hits[0].id ?? hits[0].properties?.id) : null
      if (id === hoveredIdRef.current) return
      if (!id) { clearHover(); return }
      // Off the feature just added under the cursor: it's an ordinary feature again.
      if (freshFeatureId() !== id) setFreshFeature(map, null)
      if (!drawing) setHoverState(map, id, hoveredIdRef.current)
      hoveredIdRef.current = id
      const feature = dataStore.getState().features.find((f) => f.id === id)
      if (feature) bindFeatureTooltip(feature, uiStore, e.originalEvent)
      else unbindFeatureTooltip()
      modifierCursor.enter(map.getCanvas(), e.originalEvent, drawing ? undefined : hoverCursor(id))
    }

    map.on('mousemove', onMousemove)
    const onMouseout = () => clearHover()
    map.on('mouseout', onMouseout)
    return () => {
      map.off('mousemove', onMousemove)
      map.off('mouseout', onMouseout)
      // Mode switch under a still cursor: re-hit-test on the next move (no stale hover).
      // On unmount the map may already be removed (getSource throws then).
      try { clearHover(false) } catch { /* map torn down */ }
    }
  }, [editingMode, map, dataStore, uiStore, modifierCursor, hoverCursor])

  // When a new feature is placed under a stationary cursor (e.g. the user
  // clicked with the point tool and hasn't moved yet), MapLibre's hover
  // pipeline doesn't re-hit-test on its own — nothing fires until mousemove.
  // So the modifier-cursor affordance (Cmd/Alt over an existing feature)
  // stays inactive even though the cursor is visually over the fresh point.
  // Fire a synthetic `mousemove` at the last-known cursor position whenever
  // the feature count increases, forcing the existing hover handler to
  // re-evaluate with the new render state.
  //
  // The added feature that ends up under the cursor becomes "fresh" (utils/freshFeature.ts):
  // no name tooltip and no snap ring on it until the cursor leaves it.
  const prevFeaturesRef = useRef(features)
  useEffect(() => {
    const prev = prevFeaturesRef.current
    prevFeaturesRef.current = features
    if (features.length <= prev.length) return
    // Where the cursor is, or null when it is off the map.
    const pointer = () => {
      const rect = map.getCanvas().getBoundingClientRect()
      const p = getLastPointer()
      if (p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom) return null
      return { p, local: [p.x - rect.left, p.y - rect.top] as [number, number] }
    }
    if (!pointer()) return
    const before = new Set(prev.map((f) => f.id))
    const added = new Set(features.filter((f) => !before.has(f.id)).map((f) => f.id))
    // Wait for maplibre to finish re-rendering with the new feature before
    // firing the synthetic hover — otherwise queryRenderedFeatures at the
    // cursor position will miss the feature that hasn't made it into the
    // interactive layers yet. `'idle'` fires when all sources + style are
    // done loading and nothing is animating.
    // That can be seconds later (tiles still loading), so read the cursor when it
    // fires: a position taken now would re-run hover where the cursor used to be
    // (a midpoint on the wrong edge in point editing, a stale tooltip) after it moved.
    const fire = () => {
      const at = pointer()
      if (!at) return
      const { p, local } = at
      try {
        const lngLat = map.unproject(local)
        const hit = safeQueryRendered(map, map.project(lngLat), INTERACTIVE_FEATURE_LAYERS)[0]
        const hitId = hit ? String(hit.id ?? hit.properties?.id) : null
        if (hitId && added.has(hitId)) setFreshFeature(map, hitId)
        map.fire('mousemove', {
          // A real Point: a plain { x, y } makes every listener's
          // queryRenderedFeatures(e.point) hit the whole viewport, so the
          // hover tooltip named whichever feature was on top (not under the cursor).
          // `map.project` returns the map's own Point class (a `new Point` from the
          // peer copy fails maplibre's instanceof check when the host bundles its own
          // maplibre, e.g. MapTiler SDK) and avoids a named import from CJS maplibre-gl.
          point: map.project(lngLat),
          lngLat,
          originalEvent: new MouseEvent('mousemove', {
            clientX: p.x,
            clientY: p.y,
            ctrlKey: p.ctrlKey,
            metaKey: p.metaKey,
            altKey: p.altKey,
          }),
        } as unknown as MapLayerMouseEvent)
      } catch { /* map torn down */ }
    }
    let cancelled = false
    const onIdle = () => { if (!cancelled) fire() }
    // `idle` fires once the style + sources are done loading and no render is
    // pending — the fresh feature is guaranteed to be in the interactive layer
    // by then, so queryRenderedFeatures at the cursor position will find it.
    map.once('idle', onIdle)
    return () => { cancelled = true; map.off('idle', onIdle) }
    // Only a count change can add features; `features` is read for the id diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features.length, map])

  // ── Click to select / deselect ─────────────────────────────────────────────
  useEffect(() => {
    if (readonly || editingMode !== 'none') return

    const onClick = (e: MapMouseEvent) => {
      if (isFreehandCommitConsumed()) return // the trailing click of a drag-drawn shape's commit
      const hits = safeQueryRendered(map, e.point, INTERACTIVE_FEATURE_LAYERS)
      const ds = dataStore.getState()

      if (hits.length === 0) {
        // Click on empty map
        if (vertexEditActive) {
          uiStore.getState().setVertexEditActive(false)
        } else {
          ds.clearSelection()
        }
        return
      }

      const hit = hits[0]
      const id = String(hit.id ?? hit.properties?.id ?? '')
      if (!id) return

      if (e.originalEvent.shiftKey) {
        const current = ds.selectedIds
        if (current.includes(id)) {
          ds.setSelection(current.filter((x) => x !== id))
        } else {
          ds.setSelection([...current, id])
        }
      } else {
        if (ds.selectedIds.length === 1 && ds.selectedIds[0] === id) {
          // Second click on already-selected: do nothing (vertex edit via dblclick). A finger has
          // no double-click: its second tap on a selected line / area edits the points.
          if (isTouchEvent(e.originalEvent) && !vertexEditActive) {
            const feature = ds.features.find((f) => f.id === id)
            if (canVertexEdit(feature)) {
              uiStore.getState().setSelectedPartIndex(null)
              uiStore.getState().setVertexEditFeature(id)
            }
          }
        } else {
          ds.selectFeature(id)
        }
      }
    }

    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [readonly, editingMode, vertexEditActive, dataStore, uiStore, map])

  // ── Double-click to enter vertex edit ──────────────────────────────────────
  useEffect(() => {
    if (readonly || editingMode !== 'none') return

    const onDblclick = (e: MapMouseEvent) => {
      const hits = safeQueryRendered(map, e.point, INTERACTIVE_FEATURE_LAYERS)
      if (hits.length === 0) return
      e.preventDefault() // prevent zoom

      const id = String(hits[0].id ?? hits[0].properties?.id ?? '')
      if (!id) return

      const feature = dataStore.getState().features.find((f) => f.id === id)
      if (!feature) return

      // Text labels get the edit overlay instead of vertex-edit (Point geometry
      // has a single vertex — vertex editing would be meaningless).
      if (feature.properties?._isText === 'true') {
        dataStore.getState().selectFeature(id)
        setEditingTextId(id)
        return
      }

      dataStore.getState().selectFeature(id)
      // Multi* / GeometryCollection: figure out which sub-part was clicked so
      // the VertexEditor can scope its handles to just that part.
      if (isMultiGeometry(feature.geometry)) {
        const partIdx = findPartAtPoint(feature.geometry, [e.lngLat.lng, e.lngLat.lat])
        uiStore.getState().setSelectedPartIndex(partIdx)
      } else {
        uiStore.getState().setSelectedPartIndex(null)
      }
      uiStore.getState().setVertexEditActive(true)
    }

    map.on('dblclick', onDblclick)
    return () => { map.off('dblclick', onDblclick) }
  }, [readonly, editingMode, dataStore, uiStore, map])

  // ── Drag to translate ──────────────────────────────────────────────────────
  useEffect(() => {
    if (readonly) return
    // Drawing modes still need modifier-drag-to-translate (Cmd) and modifier-
    // drag-to-duplicate (Alt) on existing features. Without this, Cmd-clicking
    // a polygon in draw-polygon mode would just add a vertex. So we keep the
    // mousedown listener attached and gate per-event on the modifier state.
    //
    // Vertex edit mode: translate/duplicate are completely blocked. Leaflet
    // achieves this via an invisible overlay polygon (bubblingMouseEvents=false)
    // that intercepts all polygon-body mousedowns. MapLibre achieves the same
    // result by returning early here (VertexEditor owns edge drag-to-insert).
    if (vertexEditActive) return

    const drawingActive = editingMode !== 'none'

    /**
     * A press on a feature. Cmd/Ctrl (move) or Alt (duplicate) on any feature drags at once;
     * with no modifier only a press on an already-selected feature moves it (the whole
     * selection), and only past the click slop, so a click or a jittery tap stays a click.
     * Anything else (an unselected feature, a tool, the transform box) leaves the drag to
     * the map (pan) or the tool. Returns whether a drag was armed.
     */
    const startDrag = (e: { point: Point; lngLat: { lng: number; lat: number } }, isAlt: boolean, isCtrl: boolean, touch: boolean): boolean => {
      const plain = !isAlt && !isCtrl
      // In drawing mode require a modifier — without it the click belongs to
      // the drawing tool.
      if (drawingActive && plain) return false
      // The transform box moves the selection on a plain press itself (TransformControls).
      if (plain && uiStore.getState().transformActive) return false

      const hits = safeQueryRendered(map, e.point, INTERACTIVE_FEATURE_LAYERS)
      if (hits.length === 0) return false

      const clickedId = String(hits[0].id ?? hits[0].properties?.id ?? '')
      if (!clickedId) return false

      const ds = dataStore.getState()
      if (plain && !ds.selectedIds.includes(clickedId)) return false

      // Cmd/Alt on a feature that isn't selected: select it first (and move only it).
      if (!ds.selectedIds.includes(clickedId)) {
        ds.selectFeature(clickedId)
      }

      // After potential selection update, re-read what's selected.
      const freshSel = dataStore.getState().selectedIds
      const idsToMove = freshSel.includes(clickedId) ? freshSel : [clickedId]
      const startCoords = new Map<string, Geometry>(
        idsToMove.flatMap((id) => {
          const f = ds.features.find((x) => x.id === id)
          return f ? [[id, f.geometry] as [string, Geometry]] : []
        }),
      )

      const isDuplicate = isAlt
      const mode = ds.geometryMode
      const startLngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      const startProjected: [number, number] = mode === 'visual'
        ? (project(startLngLat) as [number, number])
        : startLngLat
      const startPoint = { x: e.point.x, y: e.point.y }

      // Disable map pan immediately (not after the first move) — otherwise
      // maplibre's built-in dragPan starts panning the map at mousedown and
      // subsequent `e.lngLat` values arrive *map-relative*, masking the true
      // cursor delta. This is what was making Cmd-drag in draw mode look
      // broken: lng/lat barely changed, dragging never started, and the
      // trailing click was the only thing that registered.
      // (Touch: this runs from MapLibre's own touchstart event, before its touch-pan
      // handler sees the touch, so one finger on a selected feature doesn't pan either.)
      map.dragPan.disable()
      // MapLibre also rotates the map on Ctrl+left-drag (Windows/Linux). A Ctrl-drag that
      // starts on a feature belongs to Element, so rotate is off for the gesture too.
      const rotateWasOn = map.dragRotate.isEnabled()
      if (rotateWasOn) map.dragRotate.disable()
      const restoreRotate = () => { if (rotateWasOn) map.dragRotate.enable() }

      dragRef.current = {
        featureIds: idsToMove,
        startLngLat,
        startProjected,
        geometryMode: mode,
        startCoords,
        dragging: false,
        duplicate: isDuplicate,
      }

      // Live-drag geometries held in a ref so we can commit them on mouseup.
      // Rendered imperatively via the 'elm-features' source to avoid the
      // N × mousemove setState cascade the audit flagged (#3).
      const liveGeomsRef = new Map<string, Geometry>()

      // Recompute + repaint at most once per animation frame with the latest
      // cursor position; mouseup flushes so the commit sees the final one.
      const paintFrame = rafThrottle((lng: number, lat: number) => {
        const dr = dragRef.current
        if (!dr) return
        const dLng = lng - dr.startLngLat[0]
        const dLat = lat - dr.startLngLat[1]

        // Build a [dx, dy] delta in the right coord system for offsetGeometry.
        // offsetGeometry handles GeometryCollection (iterates .geometries) —
        // that's the reason we use it here instead of translate*/coord-slicing.
        let delta: [number, number]
        if (dr.geometryMode === 'visual') {
          const endLngLat: [number, number] = [dr.startLngLat[0] + dLng, dr.startLngLat[1] + dLat]
          const endProjected = project(endLngLat) as [number, number]
          delta = [endProjected[0] - dr.startProjected[0], endProjected[1] - dr.startProjected[1]]
        } else {
          delta = [dLng, dLat]
        }
        for (const id of dr.featureIds) {
          const origGeom = dr.startCoords.get(id)
          if (!origGeom) continue
          liveGeomsRef.set(id, offsetGeometry(origGeom, delta, dr.geometryMode === 'visual'))
        }

        if (dr.duplicate) {
          // Originals stay put; paint translated copies into the ghost source.
          const ghostSrc = map.getSource('elm-drag-ghost') as
            | { setData: (d: GeoJSON.FeatureCollection) => void }
            | undefined
          if (ghostSrc) {
            const ds2 = dataStore.getState()
            const ghostFeats: GeoJSON.Feature[] = []
            for (const id of dr.featureIds) {
              const src = ds2.features.find((f) => f.id === id)
              const live = liveGeomsRef.get(id)
              if (src && live) {
                ghostFeats.push({
                  type: 'Feature',
                  properties: {},
                  geometry: live as unknown as GeoJSON.Geometry,
                } as GeoJSON.Feature)
              }
            }
            try { ghostSrc.setData({ type: 'FeatureCollection', features: ghostFeats }) }
            catch { /* source removed mid-drag */ }
          }
        } else {
          // Patch only the dragged features (updateData diff), no setState cascade.
          paintLiveGeometries(map, liveGeomsRef)
        }
      })

      const onMove = (me: { point: Point; lngLat: { lng: number; lat: number } }) => {
        const dr = dragRef.current
        if (!dr) return

        if (!dr.dragging) {
          if (plain) {
            if (Math.hypot(me.point.x - startPoint.x, me.point.y - startPoint.y) < CLICK_SLOP_PX) return
          } else {
            const d = Math.hypot(me.lngLat.lng - dr.startLngLat[0], me.lngLat.lat - dr.startLngLat[1])
            if (d < 0.00001) return
          }
          dr.dragging = true
          map.getCanvas().style.cursor = 'grabbing'
          setFeatureDragActive(true)
        }

        paintFrame.schedule(me.lngLat.lng, me.lngLat.lat)
      }

      const detach = () => {
        map.off('mousemove', onMove)
        map.off('mouseup', onUp)
        map.off('touchmove', onTouchMove)
        map.off('touchend', onUp)
        map.off('touchcancel', onCancel)
        map.off('touchstart', onSecondTouch)
      }

      // After a drag: drop the frozen hover and give the canvas its cursor back.
      const restoreCursor = () => {
        // A Cmd/Alt drag can run while a drawing tool is active: keep its crosshair.
        const tc = toolCursor(uiStore.getState().editingMode)
        // Hover was frozen during the drag: drop it and re-hit-test on the next move.
        modifierCursor.leave(tc)
        map.getCanvas().style.cursor = tc
        setHoverState(map, null, hoveredIdRef.current)
        hoveredIdRef.current = null
        setFeatureDragActive(false)
      }

      const onUp = () => {
        paintFrame.flush()
        const dr = dragRef.current
        dragRef.current = null
        detach()
        // Always re-enable dragPan, even if the drag threshold was never
        // crossed (i.e. plain Cmd-click on a feature with no movement).
        map.dragPan.enable()
        restoreRotate()

        if (dr?.dragging) {
          restoreCursor()
          // Issue the modifier-drag flag so any trailing `click` that maplibre
          // synthesises (with metaKey/altKey already false because the user
          // released the modifier first) is suppressed by DrawingLayer.
          markModifierDragEnd()
          dataStore.getState().takeSnapshot()
          if (dr.duplicate) {
            // Commit duplicates at the translated positions and clear the ghost source.
            const entries: { sourceId: string; geometry: GeoJSONFeature['geometry'] }[] = []
            for (const id of dr.featureIds) {
              const geom = liveGeomsRef.get(id)
              if (geom) entries.push({ sourceId: id, geometry: geom as unknown as GeoJSONFeature['geometry'] })
            }
            dataStore.getState().duplicateFeaturesAtPosition(entries)
            const ghostSrc = map.getSource('elm-drag-ghost') as
              | { setData: (d: GeoJSON.FeatureCollection) => void }
              | undefined
            ghostSrc?.setData({ type: 'FeatureCollection', features: [] })
          } else {
            dataStore.getState().updateFeatures(dr.featureIds.flatMap((id) => {
              const geom = liveGeomsRef.get(id)
              return geom ? [{ id, patch: { geometry: geom as unknown as GeoJSONFeature['geometry'] } }] : []
            }))
          }
        }
      }

      // A second finger (pinch) or a cancelled touch: put the shapes back, commit nothing,
      // and hand the gesture to the map (touch zoom / rotate is never disabled).
      const onCancel = () => {
        paintFrame.cancel()
        const dr = dragRef.current
        dragRef.current = null
        detach()
        map.dragPan.enable()
        restoreRotate()
        if (dr?.dragging) {
          paintLiveGeometries(map, dr.startCoords)
          restoreCursor()
        }
      }
      const onTouchMove = (te: MapTouchEvent) => {
        if (te.originalEvent.touches.length > 1) { onCancel(); return }
        // The finger owns this gesture: no page scroll / browser pan.
        if (te.originalEvent.cancelable) te.originalEvent.preventDefault()
        onMove(te)
      }
      const onSecondTouch = (te: MapTouchEvent) => { if (te.originalEvent.touches.length > 1) onCancel() }

      if (touch) {
        map.on('touchmove', onTouchMove)
        map.on('touchend', onUp)
        map.on('touchcancel', onCancel)
        // MapLibre copies the listener list before firing: this sees only the next finger.
        map.on('touchstart', onSecondTouch)
      } else {
        map.on('mousemove', onMove)
        map.on('mouseup', onUp)
      }
      return true
    }

    const onMousedown = (e: MapMouseEvent) => {
      // Shift is toggle-select (click) / box-select (drag), never a translate: selecting the
      // feature here would replace the selection before the click handler can extend it.
      if (e.originalEvent.shiftKey || e.originalEvent.button !== 0) return
      if (dragRef.current) return
      startDrag(e, e.originalEvent.altKey, e.originalEvent.ctrlKey || e.originalEvent.metaKey, false)
    }

    // One finger on a selected feature moves it (no modifiers on touch). Two fingers stay
    // a pinch: MapLibre's touch zoom / rotate is never disabled here.
    const onTouchstart = (e: MapTouchEvent) => {
      if (dragRef.current || e.originalEvent.touches.length !== 1) return
      startDrag(e, false, false, true)
    }

    map.on('mousedown', onMousedown)
    map.on('touchstart', onTouchstart)
    return () => {
      map.off('mousedown', onMousedown)
      map.off('touchstart', onTouchstart)
    }
  }, [readonly, editingMode, vertexEditActive, dataStore, uiStore, map, modifierCursor])

  // ── Vertex editor & Transform controls ────────────────────────────────────
  const singleSelected = selectedIds.length === 1
    ? features.find((f) => f.id === selectedIds[0]) ?? null
    : null
  const selectedFeatures = features.filter((f) => selectedIds.includes(f.id))

  const menuEl = featureCtxMenu.state && (
    <FeatureMapContextMenu
      x={featureCtxMenu.state.x}
      y={featureCtxMenu.state.y}
      data={featureCtxMenu.state.data}
      onClose={featureCtxMenu.close}
    />
  )

  const editingTextFeature = editingTextId
    ? features.find((f) => f.id === editingTextId) ?? null
    : null

  const textEditEl = editingTextFeature && (
    <TextEditOverlay
      map={map}
      feature={editingTextFeature}
      onDone={() => setEditingTextId(null)}
    />
  )

  const preciseCoordsFeature = preciseCoordsId
    ? features.find((f) => f.id === preciseCoordsId) ?? null
    : null

  const preciseCoordsEl = preciseCoordsFeature && preciseCoordsFeature.geometry.type === 'Point' && (
    <PreciseCoordsOverlay
      map={map}
      coords={preciseCoordsFeature.geometry.coordinates as [number, number]}
      onSave={(coord) => {
        dataStore.getState().takeSnapshot()
        dataStore.getState().updateFeature(preciseCoordsFeature.id, { geometry: { type: 'Point', coordinates: withXY(preciseCoordsFeature.geometry.coordinates as number[], coord) } })
      }}
      onClose={() => setPreciseCoordsId(null)}
    />
  )

  if (readonly || editingMode !== 'none') return <>{menuEl}{textEditEl}{preciseCoordsEl}</>

  return (
    <>
      {vertexEditActive && singleSelected && (
        <VertexEditor
          map={map}
          feature={singleSelected}
          initialSelectedIndices={pendingVertexSelection ?? undefined}
        />
      )}
      <BoxSelectHandler
        map={map}
        onVertexBoxSelect={(featureId, indices) => {
          // Already in vertex edit on this feature → just push the new indices
          // through; the editor's effect merges them additively.
          if (vertexEditActive && selectedIds.length === 1 && selectedIds[0] === featureId) {
            setPendingVertexSelection(indices)
            return
          }
          dataStore.getState().selectFeature(featureId)
          uiStore.getState().setSelectedPartIndex(null)
          setPendingVertexSelection(indices)
          uiStore.getState().setVertexEditActive(true)
        }}
      />
      {transformActive && !vertexEditActive && selectedFeatures.length >= 1 && (
        <TransformControls map={map} features={selectedFeatures} />
      )}
      {menuEl}
      {textEditEl}
      {preciseCoordsEl}
    </>
  )
}
