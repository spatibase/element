/**
 * DrawingLayer — translates MapLibre map events into core store drawing actions.
 * Renders nothing; purely event-driven.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { useEmit, useIsEventForEditor, useIsToolKeyForEditor, useElementEditorConfig } from '@element-editor/ui'
import { useRouting } from '@element-editor/ui/internal'
import { useUIStore, useGeoStore } from '../store/StoreContext'
import { fetchRoute, type FetchRouteOptions } from '@element-editor/core'
import { routingError, createClickRepeatGuard, CLICK_SLOP_PX, CLICK_TOOL_MODES } from '@element-editor/core/internal'
import { snapToAngle } from '../utils/snapping'
import { isMeasureClickConsumed } from '../utils/measureClickFlag'
import { isModifierDragConsumed } from '../utils/modifierDragFlag'
import { markFreehandCommit, isFreehandCommitConsumed } from '../utils/freehandCommitFlag'
import { toolCursor } from '../utils/toolCursor'

const FREEHAND_PX_TOLERANCE = 3
const DRAG_DRAW_MIN_PX = 5 // minimum drag distance to commit a drag-to-draw shape

interface Props {
  map: MapLibreMap
  /** Deprecated `routingApiKey` prop of the controls (`config.network.routing.apiKey` wins). */
  routingApiKey?: string
}

export default function DrawingLayer({ map, routingApiKey }: Props) {
  const { uiStore, dataStore } = useGeoStore()
  // This editor's routing (`config.network.routing`, `fetch`); null when routing is off.
  const routing = useRouting(routingApiKey)
  const netFetch = useElementEditorConfig().network.fetch
  const routeOptsRef = useRef<FetchRouteOptions | null>(null)
  routeOptsRef.current = routing === false ? null : { ...routing, fetch: netFetch }
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const isToolKey = useIsToolKeyForEditor()
  const editingMode = useUIStore((s) => s.editingMode)
  const cancelDrawing = useUIStore((s) => s.cancelDrawing)
  const routeWaypoints = useUIStore((s) => s.routeWaypoints)

  const routeWaypointsRef = useRef(routeWaypoints)
  useEffect(() => { routeWaypointsRef.current = routeWaypoints }, [routeWaypoints])

  // Snapshot of route state before each click, so dblclick can restore it
  const preClickRouteRef = useRef<{ waypoints: [number, number][], preview: [number, number][] | null } | null>(null)

  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursorAbortRef = useRef<AbortController | null>(null)
  const isDraggingFreehand = useRef(false)
  const isShiftDownRef = useRef(false)
  // Drag-to-draw bookkeeping for rect/circle (parity with adapter-leaflet)
  const isDragDrawingRef = useRef(false)
  const dragStartPxRef = useRef<{ x: number; y: number } | null>(null)
  const clickGuard = useRef(createClickRepeatGuard()).current
  // Spacebar-to-pan: while held, drawing clicks/mousedowns are suppressed and
  // map pan stays enabled so the user can re-frame the map without exiting
  // the active tool. Mirrors adapter-leaflet's `isSpacePanningRef`.
  const isSpacePanningRef = useRef(false)

  const snapRoute = useCallback(
    async (waypoints: [number, number][]) => {
      if (waypoints.length < 2) return
      uiStore.getState().setRoutePreview(null, true)
      try {
        if (!routeOptsRef.current) throw new Error('routing is off')
      const path = await fetchRoute(waypoints, routeOptsRef.current)
        if (routeWaypointsRef.current.length >= 2) {
          uiStore.getState().setRoutePreview(path, false)
        }
      } catch (err) {
        const e = routingError(err)
        emit({ type: 'error', code: e.code, source: 'routing', message: e.message, error: e })
        uiStore.getState().setRoutePreview(waypoints, false)
      }
    },
    [uiStore, emit],
  )

  // Keyboard: Escape to cancel, Shift for angle snapping, Space to pan,
  // measure-specific Enter/Backspace/Delete handled here so we don't fight
  // with the shared ui keyboard-shortcuts hook (which also handles Enter but
  // not for measure).
  useEffect(() => {
    const canvas = map.getCanvas()
    function activateSpacePan() {
      if (isSpacePanningRef.current) return
      isSpacePanningRef.current = true
      // Re-enable dragPan in case drag-to-draw or freehand disabled it.
      map.dragPan.enable()
      canvas.style.cursor = 'grab'
    }
    function deactivateSpacePan() {
      if (!isSpacePanningRef.current) return
      isSpacePanningRef.current = false
      // Restore the drawing-mode cursor that the editingMode effect normally
      // owns. Default to crosshair if a tool is active; otherwise blank.
      const mode = uiStore.getState().editingMode
      canvas.style.cursor = toolCursor(mode)
      // If the active tool wants dragPan disabled (drag-to-draw / freehand),
      // turn it back off. The mousedown for those tools also disables it
      // defensively; this is the keyup path.
      if (mode === 'draw-rect' || mode === 'draw-circle' || mode === 'draw-freehand') {
        map.dragPan.disable()
      }
    }

    const onKeydown = (e: KeyboardEvent) => {
      // Shift tracking stays page-wide (physical key state); Space pan,
      // Escape, Enter, Backspace only for keys that belong to this editor.
      if (e.key === 'Shift') isShiftDownRef.current = true
      // Escape/Backspace/Delete also belong to us while a tool is on and focus is on a host element.
      if (!isForThisEditor(e) && !isToolKey(e)) return
      if (e.code === 'Space') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        e.preventDefault() // prevent page scroll
        if (uiStore.getState().editingMode !== 'none') activateSpacePan()
        return
      }
      if (e.key === 'Escape') {
        const { selectedMeasurementId, setSelectedMeasurementId } = uiStore.getState()
        if (selectedMeasurementId) { e.preventDefault(); setSelectedMeasurementId(null); return }
        if (uiStore.getState().editingMode !== 'none') e.preventDefault()
        cancelDrawing()
        return
      }
      if (e.key === 'Enter') {
        const ui = uiStore.getState()
        if (ui.editingMode === 'measure') { ui.completeMeasure(); return }
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const ui = uiStore.getState()
        if (ui.selectedMeasurementId) { e.preventDefault(); ui.removeMeasurement(ui.selectedMeasurementId); return }
        const mode = ui.editingMode
        if (mode === 'measure') { e.preventDefault(); ui.removeLastMeasurePoint(); return }
        if (mode === 'draw-line' || mode === 'slice-shape') { e.preventDefault(); ui.removeLastLineVertex(); return }
        if (mode === 'draw-polygon' || mode === 'cut-hole') { e.preventDefault(); ui.removeLastPolygonVertex(); return }
        if (mode === 'draw-route') { e.preventDefault(); ui.removeLastRouteWaypoint(); return }
      }
    }
    const onKeyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') { deactivateSpacePan(); return }
      if (e.key === 'Shift') isShiftDownRef.current = false
    }
    const onBlur = () => deactivateSpacePan()
    // Panning the map shows a grabbing hand, not the tool's crosshair.
    const onDragStart = () => { canvas.style.cursor = 'grabbing' }
    const onDragEnd = () => {
      canvas.style.cursor = isSpacePanningRef.current ? 'grab'
        : toolCursor(uiStore.getState().editingMode)
    }
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('keyup', onKeyup)
    window.addEventListener('blur', onBlur)
    map.on('dragstart', onDragStart)
    map.on('dragend', onDragEnd)
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
      window.removeEventListener('blur', onBlur)
      map.off('dragstart', onDragStart)
      map.off('dragend', onDragEnd)
    }
  }, [cancelDrawing, uiStore, map, isForThisEditor, isToolKey])

  // Cursor style
  useEffect(() => {
    map.getCanvas().style.cursor = toolCursor(editingMode)
  }, [editingMode, map])

  // Freehand: disable map panning while drawing
  useEffect(() => {
    if (editingMode === 'draw-freehand') {
      map.dragPan.disable()
    } else {
      map.dragPan.enable()
      isDraggingFreehand.current = false
    }
  }, [editingMode, map])

  // Disable MapLibre's dblclick-to-zoom while any tool is active (as Leaflet's
  // FeatureInteractionLayer does) — dblclick commits the shape, and fast
  // clicks at different spots (points too) can fire a dblclick that would
  // zoom the map. We re-enable on exit so normal map dblclick zooming still
  // works outside drawing.
  useEffect(() => {
    if (editingMode !== 'none') {
      map.doubleClickZoom.disable()
    } else {
      map.doubleClickZoom.enable()
    }
    return () => { map.doubleClickZoom.enable() }
  }, [editingMode, map])

  // Fast clicking: the hand is often still moving when the button goes down, and MapLibre's
  // 3 px click tolerance turns that click into a tiny pan (no click, no point). Click tools get
  // CLICK_SLOP_PX. ponytail: these handler fields are MapLibre-private (the handler manager is
  // `map.handlers` on 5.x, `map._handlerManager` on 6.x); a no-op if absent.
  useEffect(() => {
    if (!CLICK_TOOL_MODES.includes(editingMode)) return
    type Handlers = { _handlersById?: Record<string, { _clickTolerance?: number }> }
    const m = map as unknown as { handlers?: Handlers; _handlerManager?: Handlers }
    const byId = (m.handlers ?? m._handlerManager)?._handlersById
    const targets = [byId?.mapEvent, byId?.mousePan].filter((h): h is { _clickTolerance?: number } => typeof h?._clickTolerance === 'number')
    const prev = targets.map((h) => h._clickTolerance)
    for (const h of targets) h._clickTolerance = CLICK_SLOP_PX
    return () => targets.forEach((h, i) => { h._clickTolerance = prev[i] })
  }, [editingMode, map])

  // Disable MapLibre's Shift+drag box-zoom while any tool is active —
  // a drag in drawing mode should never trigger a zoom-to-box.
  useEffect(() => {
    if (editingMode !== 'none') {
      map.boxZoom.disable()
    } else {
      map.boxZoom.enable()
    }
    return () => { map.boxZoom.enable() }
  }, [editingMode, map])

  // Route cursor preview debounce cleanup
  useEffect(() => {
    return () => {
      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current)
      if (cursorAbortRef.current) cursorAbortRef.current.abort()
    }
  }, [])

  useEffect(() => {
    // Modifier-held mousedown/click should yield to FIL's translate/duplicate
    // drag (Cmd/Ctrl = move, Alt = duplicate). Without this, e.g. Cmd-clicking
    // an existing polygon while in polygon-draw mode adds a vertex instead of
    // letting the user translate the polygon. Mirrors adapter-leaflet's
    // `isModifierHeldRef` guard in its DrawingLayer.
    const isModifierHeld = (e: MouseEvent) =>
      e.metaKey || e.ctrlKey || e.altKey

    const onMousedown = (e: MapMouseEvent) => {
      if (isModifierHeld(e.originalEvent)) return
      if (isSpacePanningRef.current) return
      if (editingMode === 'draw-freehand') {
        isDraggingFreehand.current = true
        uiStore.getState().clearFreehandPoints()
        uiStore.getState().addFreehandPoint([e.lngLat.lng, e.lngLat.lat])
        return
      }
      // Drag-to-draw for rect/circle: mousedown sets the anchor, mouseup commits.
      // Disable map pan so the drag is captured by us, not by maplibre's pan.
      if (editingMode === 'draw-rect') {
        map.dragPan.disable()
        if (dataStore.getState().selectedIds.length > 0) dataStore.setState({ selectedIds: [] })
        const coord: [number, number] = uiStore.getState().snappedCoord ?? [e.lngLat.lng, e.lngLat.lat]
        uiStore.getState().setRectCorner(coord)
        isDragDrawingRef.current = true
        dragStartPxRef.current = { x: e.point.x, y: e.point.y }
        return
      }
      if (editingMode === 'draw-circle') {
        map.dragPan.disable()
        if (dataStore.getState().selectedIds.length > 0) dataStore.setState({ selectedIds: [] })
        const coord: [number, number] = uiStore.getState().snappedCoord ?? [e.lngLat.lng, e.lngLat.lat]
        uiStore.getState().setCircleCenter(coord)
        isDragDrawingRef.current = true
        dragStartPxRef.current = { x: e.point.x, y: e.point.y }
        return
      }
    }

    const onMouseup = (e: MapMouseEvent) => {
      if (editingMode === 'draw-freehand' && isDraggingFreehand.current) {
        isDraggingFreehand.current = false
        const zoom = map.getZoom()
        const metersPerPx =
          (156543.03392 * Math.cos((e.lngLat.lat * Math.PI) / 180)) / Math.pow(2, zoom)
        const epsilonDeg = (FREEHAND_PX_TOLERANCE * metersPerPx) / 111320
        uiStore.getState().commitFreehand(epsilonDeg)
        markFreehandCommit()
        return
      }
      if (!isDragDrawingRef.current) return
      isDragDrawingRef.current = false
      // Re-enable map pan now that the drag is over.
      map.dragPan.enable()
      const start = dragStartPxRef.current
      const dragPx = start ? Math.hypot(e.point.x - start.x, e.point.y - start.y) : 0
      dragStartPxRef.current = null
      const fresh = uiStore.getState()
      if (editingMode === 'draw-rect') {
        const corner = fresh.rectCorner
        if (!corner) return
        // No drag at all → discard so a stray click doesn't drop a default rect.
        if (dragPx < DRAG_DRAW_MIN_PX) {
          uiStore.setState({ rectCorner: null })
          return
        }
        const coord: [number, number] = fresh.snappedCoord ?? [e.lngLat.lng, e.lngLat.lat]
        const forceSquare = isShiftDownRef.current || e.originalEvent.shiftKey
        fresh.commitRect(corner, coord, {}, forceSquare)
        markFreehandCommit()
        return
      }
      if (editingMode === 'draw-circle') {
        const center = fresh.circleCenter
        if (!center) return
        let coord: [number, number]
        if (dragPx < DRAG_DRAW_MIN_PX) {
          // Click without drag → default-sized circle (25 px radius).
          const ll = map.unproject([e.point.x + 25, e.point.y])
          coord = [ll.lng, ll.lat]
        } else {
          coord = fresh.snappedCoord ?? [e.lngLat.lng, e.lngLat.lat]
        }
        const dx = coord[0] - center[0], dy = coord[1] - center[1]
        if (Math.hypot(dx, dy) >= 1e-6) { fresh.commitCircle(center, coord, {}); markFreehandCommit() }
        return
      }
    }

    const onMousemove = (e: MapMouseEvent) => {
      const s = uiStore.getState()
      if (editingMode === 'draw-freehand' && isDraggingFreehand.current) {
        s.addFreehandPoint([e.lngLat.lng, e.lngLat.lat])
        return
      }

      if (editingMode === 'draw-route' && routeWaypointsRef.current.length > 0) {
        const coord: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        s.setRouteCursorPos(coord)
        s.setRouteCursorPreview(null)

        if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current)
        if (cursorAbortRef.current) cursorAbortRef.current.abort()

        const lastWp = routeWaypointsRef.current[routeWaypointsRef.current.length - 1]
        cursorDebounceRef.current = setTimeout(async () => {
          const ac = new AbortController()
          cursorAbortRef.current = ac
          try {
            if (!routeOptsRef.current) return
            const path = await fetchRoute([lastWp, coord], { ...routeOptsRef.current, signal: ac.signal })
            if (!ac.signal.aborted) uiStore.getState().setRouteCursorPreview(path)
          } catch {
            // aborted or error — straight-line ghost already shown
          }
        }, 400)
      }

      // Polygon closing cursor feedback
      if (
        (editingMode === 'draw-polygon' || editingMode === 'cut-hole') &&
        s.polygonInProgress.length >= 3
      ) {
        const firstPt = s.polygonInProgress[0]
        const firstPtPx = map.project(firstPt as [number, number])
        const d = Math.hypot(e.point.x - firstPtPx.x, e.point.y - firstPtPx.y)
        map.getCanvas().style.cursor = d <= 48 ? 'pointer' : 'crosshair'
      }
    }

    const onClick = (e: MapMouseEvent) => {
      // The 2nd click of a same-spot double-click. Not `detail > 1`: fast clicks at different
      // spots can carry detail 2 too, and dropping them lost points/vertices.
      const isRepeat = clickGuard.click(e.originalEvent)
      // Suppress drawing clicks when any modifier is held — Cmd/Ctrl/Alt are
      // reserved for translate/duplicate gestures that FIL handles. The flag
      // covers the trailing click after a modifier-drag mouseup when the user
      // released the modifier *before* the mouse: by then `metaKey/altKey` is
      // already false on the synthesised click, so the live guard misses it.
      if (isModifierHeld(e.originalEvent)) return
      if (isModifierDragConsumed()) return
      if (isSpacePanningRef.current) return
      // The trailing click of a circle / rectangle / freehand committed on mouseup: it would
      // clear the new shape's selection (Leaflet keeps it selected too).
      if (isFreehandCommitConsumed()) return
      const fresh = uiStore.getState()

      if (editingMode === 'measure') {
        if (isRepeat) return
        if (isMeasureClickConsumed()) return
        // Empty-map click: if a completed measurement is selected, deselect it and
        // start a new in-progress measurement in the same click (natural flow after
        // auto-select on commit — Enter/dblclick selects so Delete works immediately).
        if (fresh.selectedMeasurementId) fresh.setSelectedMeasurementId(null)
        const coord: [number, number] = fresh.snappedCoord ?? [e.lngLat.lng, e.lngLat.lat]
        fresh.addMeasurePoint(coord)
        return
      }

      // Clear selection when starting to draw
      if (
        ['place-point', 'draw-line', 'draw-polygon', 'draw-route', 'draw-circle', 'draw-rect'].includes(editingMode)
      ) {
        // Bypass `clearSelection` so we don't drop `lastActiveGroupId` — the new
        // feature should inherit the currently-selected group via addFeature.
        if (dataStore.getState().selectedIds.length > 0) dataStore.setState({ selectedIds: [] })
      }

      const snapped = fresh.snappedCoord
      const coord: [number, number] = snapped ?? [e.lngLat.lng, e.lngLat.lat]

      if (editingMode === 'place-point') {
        // A double-click places one point, not two stacked ones (as on Leaflet).
        if (isRepeat) return
        fresh.commitPoint(coord)
        return
      }

      if (
        editingMode === 'draw-line' ||
        editingMode === 'draw-polygon' ||
        editingMode === 'draw-route' ||
        editingMode === 'cut-hole' ||
        editingMode === 'slice-shape'
      ) {
        let finalCoord = coord
        if (isShiftDownRef.current || e.originalEvent.shiftKey) {
          const lineVerts = editingMode === 'draw-line' || editingMode === 'slice-shape'
            ? fresh.lineInProgress
            : fresh.polygonInProgress
          if (lineVerts.length >= 1) {
            finalCoord = snapToAngle(map, lineVerts[lineVerts.length - 1], finalCoord)
          }
        }

        // Smart polygon closing
        if (
          (editingMode === 'draw-polygon' || editingMode === 'cut-hole') &&
          fresh.polygonInProgress.length >= 2
        ) {
          const firstPt = fresh.polygonInProgress[0]
          const firstPtPx = map.project(firstPt as [number, number])
          const d = Math.hypot(e.point.x - firstPtPx.x, e.point.y - firstPtPx.y)
          if (d <= 48) {
            if (editingMode === 'draw-polygon') fresh.commitPolygon({})
            else fresh.commitCutHole()
            return
          }
        }

        if (isRepeat) return // ignore dblclick second click

        if (editingMode === 'draw-line' || editingMode === 'slice-shape') fresh.addLineVertex(finalCoord)
        else if (editingMode === 'draw-polygon' || editingMode === 'cut-hole') fresh.addPolygonVertex(finalCoord)
        else if (editingMode === 'draw-route') {
          // Save state before this click so dblclick can restore and commit cleanly
          preClickRouteRef.current = { waypoints: [...routeWaypointsRef.current], preview: fresh.routePreview }
          if (cursorDebounceRef.current) { clearTimeout(cursorDebounceRef.current); cursorDebounceRef.current = null }
          if (cursorAbortRef.current) { cursorAbortRef.current.abort(); cursorAbortRef.current = null }
          fresh.setRouteCursorPos(null)
          fresh.setRouteCursorPreview(null)
          fresh.addRouteWaypoint(finalCoord)
          const next = [...routeWaypointsRef.current, finalCoord]
          snapRoute(next)
        }
        return
      }

      // Note: draw-circle / draw-rect are handled in mousedown/mouseup
      // (drag-to-draw). The trailing click that maplibre fires after a
      // mousedown+mouseup at the same point is a no-op here — mouseup already
      // committed (or discarded) the shape.
    }

    const onDblclick = () => {
      // MapLibre's dblclick-zoom is disabled for the whole session while a
      // drawing mode is active (see the `doubleClickZoom.disable()` effect
      // above) — we don't need per-event preventDefault here.
      // Two fast clicks at different spots: both were placed, nothing to finish.
      if (!clickGuard.isDouble()) return
      const st = uiStore.getState()
      if (editingMode === 'measure') { st.completeMeasure(); return }
      if (editingMode === 'draw-line') st.commitLine({})
      else if (editingMode === 'draw-polygon') st.commitPolygon({})
      else if (editingMode === 'cut-hole') st.commitCutHole()
      else if (editingMode === 'slice-shape') st.commitSliceShape()
      else if (editingMode === 'draw-route') {
        // Restore route state from before the first click of the double-click
        if (preClickRouteRef.current) {
          uiStore.setState({
            routeWaypoints: preClickRouteRef.current.waypoints,
            routePreview: preClickRouteRef.current.preview,
            routeLoading: false,
          })
          preClickRouteRef.current = null
        }
        st.commitRoute()
      }
    }

    map.on('mousedown', onMousedown)
    map.on('mouseup', onMouseup)
    map.on('mousemove', onMousemove)
    map.on('click', onClick)
    map.on('dblclick', onDblclick)

    return () => {
      map.off('mousedown', onMousedown)
      map.off('mouseup', onMouseup)
      map.off('mousemove', onMousemove)
      map.off('click', onClick)
      map.off('dblclick', onDblclick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMode, map, snapRoute, uiStore, dataStore])

  return null
}
