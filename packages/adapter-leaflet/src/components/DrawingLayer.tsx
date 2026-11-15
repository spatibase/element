import { useMap, useMapEvents } from 'react-leaflet'
import { useCallback, useEffect, useRef } from 'react'
import { useUIStore, useGeoStore } from '../store/StoreContext'
import { useEmit, useIsEventForEditor, useElementEditorConfig } from '@element-editor/ui'
import { useRouting } from '@element-editor/ui/internal'
import { fetchRoute, type FetchRouteOptions } from '@element-editor/core'
import { routingError, createClickRepeatGuard, CLICK_SLOP_PX, CLICK_TOOL_MODES } from '@element-editor/core/internal'
import { snapToAngle } from '../utils/snapping'
import { isMeasureClickConsumed } from '../utils/measureClickFlag'
import { markFreehandCommit } from '../utils/freehandCommitFlag'
import { markModifierDragEnd, isModifierDragConsumed } from '../utils/modifierDragFlag'

const FREEHAND_PX_TOLERANCE = 3 // pixels of perpendicular tolerance for RDP simplification
const DRAG_DRAW_MIN_PX = 5 // minimum drag distance to commit a drag-to-draw shape

export default function DrawingLayer({ routingApiKey }: { routingApiKey?: string } = {}) {
  const { uiStore, dataStore } = useGeoStore()
  // This editor's routing (`config.network.routing`, `fetch`); null when routing is off.
  const routing = useRouting(routingApiKey)
  const netFetch = useElementEditorConfig().network.fetch
  const routeOptsRef = useRef<FetchRouteOptions | null>(null)
  routeOptsRef.current = routing === false ? null : { ...routing, fetch: netFetch }
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const map = useMap()
  const editingMode = useUIStore((s) => s.editingMode)
  const commitPoint = useUIStore((s) => s.commitPoint)
  const addLineVertex = useUIStore((s) => s.addLineVertex)
  const addPolygonVertex = useUIStore((s) => s.addPolygonVertex)
  const setCircleCenter = useUIStore((s) => s.setCircleCenter)
  const commitCircle = useUIStore((s) => s.commitCircle)
  const setRectCorner = useUIStore((s) => s.setRectCorner)
  const commitRect = useUIStore((s) => s.commitRect)
  const cancelDrawing = useUIStore((s) => s.cancelDrawing)
  const addRouteWaypoint = useUIStore((s) => s.addRouteWaypoint)
  const setRoutePreview = useUIStore((s) => s.setRoutePreview)
  const setRouteCursorPos = useUIStore((s) => s.setRouteCursorPos)
  const setRouteCursorPreview = useUIStore((s) => s.setRouteCursorPreview)
  const routeWaypoints = useUIStore((s) => s.routeWaypoints)

  const removeLastLineVertex = useUIStore((s) => s.removeLastLineVertex)
  const removeLastPolygonVertex = useUIStore((s) => s.removeLastPolygonVertex)
  const removeLastRouteWaypoint = useUIStore((s) => s.removeLastRouteWaypoint)
  const removeLastMeasurePoint = useUIStore((s) => s.removeLastMeasurePoint)

  const addFreehandPoint = useUIStore((s) => s.addFreehandPoint)
  const clearFreehandPoints = useUIStore((s) => s.clearFreehandPoints)
  const commitFreehand = useUIStore((s) => s.commitFreehand)

  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursorAbortRef = useRef<AbortController | null>(null)
  const isDraggingFreehand = useRef(false)
  const isShiftDownRef = useRef(false)
  const isSpacePanningRef = useRef(false)
  const isModifierHeldRef = useRef(false)
  const isDragDrawingRef = useRef(false)
  const dragStartPixelRef = useRef<{ x: number; y: number } | null>(null)
  const clickGuard = useRef(createClickRepeatGuard()).current

  // Fast clicking: the hand is often still moving when the button goes down, and Leaflet's
  // 3 px drag threshold turns that click into a tiny pan (no click, no point). Click tools get
  // CLICK_SLOP_PX. ponytail: `_draggable` is Leaflet-private (stable in 1.x); a no-op if absent.
  useEffect(() => {
    if (!CLICK_TOOL_MODES.includes(editingMode)) return
    const d = (map.dragging as unknown as { _draggable?: { options: { clickTolerance: number } } })._draggable
    if (!d) return
    const prev = d.options.clickTolerance
    d.options.clickTolerance = CLICK_SLOP_PX
    return () => { d.options.clickTolerance = prev }
  }, [editingMode, map])

  useEffect(() => {
    const container = map.getContainer()

    function activateSpacePan() {
      if (isSpacePanningRef.current) return
      isSpacePanningRef.current = true
      map.dragging.enable()
      // Inline !important wins over class-based rules, and over the drawing-mode
      // inline cursor set by the editingMode effect — same technique as useModifierDragCursor.
      container.style.setProperty('cursor', 'grab', 'important')
    }

    function deactivateSpacePan() {
      if (!isSpacePanningRef.current) return
      isSpacePanningRef.current = false
      container.style.removeProperty('cursor')
      const mode = uiStore.getState().editingMode
      // Restore drawing cursor that the editingMode effect normally owns
      if (mode !== 'none' && !isModifierHeldRef.current) {
        container.style.cursor = mode === 'pick-shape' ? 'pointer' : 'crosshair'
      }
      if (['draw-freehand', 'draw-rect', 'draw-circle'].includes(mode)) {
        map.dragging.disable()
      }
    }

    function activateModifier() {
      if (isModifierHeldRef.current || isSpacePanningRef.current) return
      isModifierHeldRef.current = true
      // Revert to default cursor so drawing doesn't appear active
      container.style.removeProperty('cursor')
    }

    function deactivateModifier() {
      if (!isModifierHeldRef.current) return
      // Only deactivate if no modifier key remains held
      isModifierHeldRef.current = false
      // Suppress any trailing Leaflet click that fires after the modifier is released
      markModifierDragEnd()
      const mode = uiStore.getState().editingMode
      if (mode !== 'none' && !isSpacePanningRef.current) {
        container.style.cursor = mode === 'pick-shape' ? 'pointer' : 'crosshair'
      }
    }

    const handleContainerMouseDown = () => {
      if (isSpacePanningRef.current) container.style.setProperty('cursor', 'grabbing', 'important')
    }
    const handleContainerMouseUp = () => {
      if (isSpacePanningRef.current) container.style.setProperty('cursor', 'grab', 'important')
    }
    container.addEventListener('mousedown', handleContainerMouseDown)
    container.addEventListener('mouseup', handleContainerMouseUp)

    const handleKeyDown = (e: KeyboardEvent) => {
      // Modifier tracking stays page-wide (it mirrors physical key state);
      // everything that acts — Space pan, Escape, Enter, Backspace — only
      // for keys that belong to this editor.
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') { activateModifier(); return }
      if (e.key === 'Shift') isShiftDownRef.current = true
      if (!isForThisEditor(e)) return
      if (e.code === 'Space') {
        const target = e.target as Element
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable) return
        e.preventDefault() // prevent page scroll
        activateSpacePan()
        return
      }
      if (e.key === 'Escape') {
        const { selectedMeasurementId, setSelectedMeasurementId } = uiStore.getState()
        if (selectedMeasurementId) { setSelectedMeasurementId(null); return }
        cancelDrawing()
      }
      if (e.key === 'Enter') {
        const mode = uiStore.getState().editingMode
        if (mode === 'measure') { uiStore.getState().completeMeasure(); return }
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const state = uiStore.getState()
        if (state.selectedMeasurementId) { state.removeMeasurement(state.selectedMeasurementId); return }
        const mode = state.editingMode
        if (mode === 'measure') { removeLastMeasurePoint(); return }
        if (mode === 'draw-line' || mode === 'slice-shape') { removeLastLineVertex(); return }
        if (mode === 'draw-polygon' || mode === 'cut-hole') { removeLastPolygonVertex(); return }
        if (mode === 'draw-route') { removeLastRouteWaypoint(); return }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { deactivateSpacePan(); return }
      if (e.key === 'Shift') isShiftDownRef.current = false
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') {
        // Only deactivate if no other modifier is still held
        if (!e.metaKey && !e.ctrlKey && !e.altKey) deactivateModifier()
      }
    }
    // Clean up on focus loss (e.g. alt-tab while holding a key)
    const handleBlur = () => { deactivateSpacePan(); deactivateModifier() }

    const targetWindow = (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
    targetWindow.addEventListener('keydown', handleKeyDown)
    targetWindow.addEventListener('keyup', handleKeyUp)
    targetWindow.addEventListener('blur', handleBlur)
    return () => {
      targetWindow.removeEventListener('keydown', handleKeyDown)
      targetWindow.removeEventListener('keyup', handleKeyUp)
      targetWindow.removeEventListener('blur', handleBlur)
      container.removeEventListener('mousedown', handleContainerMouseDown)
      container.removeEventListener('mouseup', handleContainerMouseUp)
      deactivateSpacePan()
    }
  }, [cancelDrawing, removeLastLineVertex, removeLastPolygonVertex, removeLastRouteWaypoint, removeLastMeasurePoint, uiStore, map, isForThisEditor])

  // Keep a ref so the async OSRM callback always sees the latest waypoints
  const routeWaypointsRef = useRef(routeWaypoints)
  useEffect(() => { routeWaypointsRef.current = routeWaypoints }, [routeWaypoints])

  // Snapshot of route state before each click, so dblclick can restore it
  const preClickRouteRef = useRef<{ waypoints: [number, number][], preview: [number, number][] | null } | null>(null)

  const snapRoute = useCallback(async (waypoints: [number, number][]) => {
    if (waypoints.length < 2) return
    setRoutePreview(null, true)
    try {
      if (!routeOptsRef.current) throw new Error('routing is off')
      const path = await fetchRoute(waypoints, routeOptsRef.current)
      if (routeWaypointsRef.current.length >= 2) {
        setRoutePreview(path, false)
      }
    } catch (err) {
      const e = routingError(err)
      emit({ type: 'error', code: e.code, source: 'routing', message: e.message, error: e })
      setRoutePreview(waypoints, false)
    }
  }, [setRoutePreview, emit, uiStore])

  useMapEvents({
    mousedown(e) {
      if (editingMode === 'draw-freehand') {
        isDraggingFreehand.current = true
        clearFreehandPoints()
        addFreehandPoint([e.latlng.lng, e.latlng.lat])
        return
      }
      // Drag-to-draw: rect and circle start on mousedown so the user can drag to define the shape
      if (isSpacePanningRef.current || isModifierHeldRef.current) return
      if (editingMode === 'draw-rect') {
        // Re-disable map dragging in case FIL's onUp re-enabled it after a modifier drag.
        // The useEffect only fires on editingMode change, so it won't catch this.
        map.dragging.disable()
        // Clear selection here (not in click) — after drag-to-draw the tool stays active and a
        // trailing click would otherwise wipe the just-committed feature's selection.
        // Bypass `clearSelection` so we don't drop `lastActiveGroupId` — the new
// feature should inherit the currently-selected group via addFeature.
if (dataStore.getState().selectedIds.length > 0) dataStore.setState({ selectedIds: [] })
        const coord: [number, number] = uiStore.getState().snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        setRectCorner(coord)
        isDragDrawingRef.current = true
        dragStartPixelRef.current = { x: e.containerPoint.x, y: e.containerPoint.y }
        return
      }
      if (editingMode === 'draw-circle') {
        map.dragging.disable()
        // Bypass `clearSelection` so we don't drop `lastActiveGroupId` — the new
// feature should inherit the currently-selected group via addFeature.
if (dataStore.getState().selectedIds.length > 0) dataStore.setState({ selectedIds: [] })
        const coord: [number, number] = uiStore.getState().snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        setCircleCenter(coord)
        isDragDrawingRef.current = true
        dragStartPixelRef.current = { x: e.containerPoint.x, y: e.containerPoint.y }
        return
      }
    },
    mouseup(e) {
      if (editingMode === 'draw-freehand' && isDraggingFreehand.current) {
        isDraggingFreehand.current = false
        // Compute RDP epsilon from current zoom: FREEHAND_PX_TOLERANCE pixels → degrees
        const zoom = map.getZoom()
        const metersPerPx = 156543.03392 * Math.cos(e.latlng.lat * Math.PI / 180) / Math.pow(2, zoom)
        const epsilonDeg = (FREEHAND_PX_TOLERANCE * metersPerPx) / 111320
        commitFreehand(epsilonDeg)
        // Leaflet fires a trailing `click` after mousedown+mouseup at (near-)same
        // point. Without this flag the click would run MapClickHandler with
        // editingMode='none' and wipe the selection we just set in addFeature.
        markFreehandCommit()
        return
      }
      if (!isDragDrawingRef.current) {
        // mousedown was suppressed by modifier — mark so trailing click is consumed
        if (isModifierHeldRef.current || e.originalEvent.metaKey || e.originalEvent.ctrlKey || e.originalEvent.altKey) {
          markModifierDragEnd()
        }
        return
      }
      isDragDrawingRef.current = false
      const start = dragStartPixelRef.current
      const dragPx = start ? Math.hypot(e.containerPoint.x - start.x, e.containerPoint.y - start.y) : 0
      dragStartPixelRef.current = null
      if (editingMode === 'draw-rect') {
        const corner = uiStore.getState().rectCorner
        if (!corner) return
        // No drag at all — discard so a stray click doesn't drop a default
        // shape in place of nothing. The previous "default 50×50 square"
        // behavior surprised users who expected drawing-as-shown.
        if (dragPx < DRAG_DRAW_MIN_PX) {
          uiStore.setState({ rectCorner: null })
          return
        }
        const coord: [number, number] = uiStore.getState().snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        // Square only when the user explicitly holds Shift during the drag.
        const forceSquare = isShiftDownRef.current || e.originalEvent.shiftKey
        commitRect(corner, coord, {}, forceSquare)
        // Same trailing-click problem as freehand: dragging is disabled, so
        // Leaflet still fires `click` after this mouseup, and with auto-exit
        // (mode → 'none') MapClickHandler would wipe the new selection.
        markFreehandCommit()
        return
      }
      if (editingMode === 'draw-circle') {
        const center = uiStore.getState().circleCenter
        if (!center) return
        let coord: [number, number]
        if (dragPx < DRAG_DRAW_MIN_PX) {
          // Single click — create a default circle (25px radius in screen space)
          const p = e.containerPoint
          const ll = map.containerPointToLatLng([p.x + 25, p.y])
          coord = [ll.lng, ll.lat]
        } else {
          coord = uiStore.getState().snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        }
        const dx = coord[0] - center[0], dy = coord[1] - center[1]
        if (Math.hypot(dx, dy) >= 1e-6) { commitCircle(center, coord, {}); markFreehandCommit() }
        return
      }
    },
    mousemove(e) {
      if (editingMode === 'draw-freehand' && isDraggingFreehand.current) {
        addFreehandPoint([e.latlng.lng, e.latlng.lat])
        return
      }

      // Polygon-closing tolerance: pointer cursor when within 48px of the first node.
      if ((editingMode === 'draw-polygon' || editingMode === 'cut-hole')
          && uiStore.getState().polygonInProgress.length >= 3) {
        const firstPt = uiStore.getState().polygonInProgress[0]
        const firstPtPx = map.latLngToLayerPoint([firstPt[1], firstPt[0]])
        const dist = Math.hypot(e.layerPoint.x - firstPtPx.x, e.layerPoint.y - firstPtPx.y)
        map.getContainer().style.cursor = dist <= 48 ? 'pointer' : 'crosshair'
        return
      }

      if (editingMode !== 'draw-route' || routeWaypointsRef.current.length === 0) return
      const coord: [number, number] = [e.latlng.lng, e.latlng.lat]
      setRouteCursorPos(coord)
      setRouteCursorPreview(null)

      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current)
      if (cursorAbortRef.current) cursorAbortRef.current.abort()

      const lastWp = routeWaypointsRef.current[routeWaypointsRef.current.length - 1]
      cursorDebounceRef.current = setTimeout(async () => {
        const ac = new AbortController()
        cursorAbortRef.current = ac
        try {
          if (!routeOptsRef.current) return
            const path = await fetchRoute([lastWp, coord], { ...routeOptsRef.current, signal: ac.signal })
          if (!ac.signal.aborted) setRouteCursorPreview(path)
        } catch {
          // aborted or error — straight-line ghost already shown
        }
      }, 400)
    },
    click(e) {
      // The 2nd click of a same-spot double-click. Not `detail > 1`: fast clicks at different
      // spots can carry detail 2 too, and dropping them lost points/vertices.
      const isRepeat = clickGuard.click(e.originalEvent)
      // Prevent drawing if the user clicked on an existing interactive tooltip (like a text label)
      if ((e.originalEvent.target as HTMLElement)?.closest('.leaflet-tooltip')) return

      if (editingMode === 'measure') {
        if (isRepeat) return
        if (isMeasureClickConsumed()) return // measurement SVG path was clicked this tick
        const target = e.originalEvent.target as Element
        if (target?.closest?.('path')) return // click on SVG path
        if (target?.closest?.('.elm-measure-label')) return // click on label pill or × button
        const s = uiStore.getState()
        // Empty-map click: if a completed measurement is selected, deselect it and
        // start a new in-progress measurement in the same click (natural flow after
        // auto-select on commit — Enter/dblclick selects so Delete works immediately).
        if (s.selectedMeasurementId) s.setSelectedMeasurementId(null)
        const coord: [number, number] = s.snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        s.addMeasurePoint(coord)
        return
      }

      // If a modifier key is held, or was just released (trailing click after modifier drag),
      // let the selection/action layer handle it — don't place drawing vertices.
      if (e.originalEvent.metaKey || e.originalEvent.ctrlKey || e.originalEvent.altKey) return
      if (isModifierDragConsumed()) return

      if (['place-point', 'draw-line', 'draw-polygon', 'draw-route'].includes(editingMode)) {
        // Bypass `clearSelection` so we don't drop `lastActiveGroupId` — the new
// feature should inherit the currently-selected group via addFeature.
if (dataStore.getState().selectedIds.length > 0) dataStore.setState({ selectedIds: [] })
      }

      if (editingMode === 'place-point') {
        // Ignore the 2nd click of a double-click so users don't accidentally
        // stack two points at the exact same location.
        if (isRepeat) return
        const coord: [number, number] = uiStore.getState().snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        commitPoint(coord)
        return
      }
      if (editingMode === 'draw-line' || editingMode === 'draw-polygon' || editingMode === 'draw-route' || editingMode === 'cut-hole' || editingMode === 'slice-shape') {
        let coord: [number, number] = uiStore.getState().snappedCoord ?? [e.latlng.lng, e.latlng.lat]
        
        if (isShiftDownRef.current || e.originalEvent.shiftKey) {
          const s = uiStore.getState()
          let lastPoint: [number, number] | null = null
          if ((editingMode === 'draw-line' || editingMode === 'slice-shape') && s.lineInProgress.length >= 1) {
            lastPoint = s.lineInProgress[s.lineInProgress.length - 1]
          } else if ((editingMode === 'draw-polygon' || editingMode === 'cut-hole') && s.polygonInProgress.length >= 1) {
            lastPoint = s.polygonInProgress[s.polygonInProgress.length - 1]
          }
          if (lastPoint) {
            coord = snapToAngle(map, lastPoint, coord, 15)
          }
        }

        
          // Smart-closing polygon if clicking near the first node (tolerance: 48px)
          if ((editingMode === 'draw-polygon' || editingMode === 'cut-hole') && uiStore.getState().polygonInProgress.length >= 2) {
            const s = uiStore.getState()
            const firstPt = s.polygonInProgress[0]
            const firstPtPx = map.latLngToLayerPoint([firstPt[1], firstPt[0]]) // Leaflet expects [lat, lng]
            const dist = Math.hypot(e.layerPoint.x - firstPtPx.x, e.layerPoint.y - firstPtPx.y)
if (dist <= 48) {
              // User clicked near the start node! Close the shape instead of adding a node.
              if (editingMode === 'draw-polygon') s.commitPolygon({})
              else if (editingMode === 'cut-hole') s.commitCutHole()
              return
            }
          }

        if (isRepeat) return
        if (editingMode === 'draw-line' || editingMode === 'slice-shape') addLineVertex(coord)
        else if (editingMode === 'draw-polygon' || editingMode === 'cut-hole') addPolygonVertex(coord)
        else if (editingMode === 'draw-route') {
          // Save state before this click so dblclick can restore and commit cleanly
          preClickRouteRef.current = { waypoints: [...routeWaypointsRef.current], preview: uiStore.getState().routePreview }
          // Clear cursor preview — the committed snap will take over
          if (cursorDebounceRef.current) { clearTimeout(cursorDebounceRef.current); cursorDebounceRef.current = null }
          if (cursorAbortRef.current) { cursorAbortRef.current.abort(); cursorAbortRef.current = null }
          setRouteCursorPos(null)
          setRouteCursorPreview(null)
          addRouteWaypoint(coord)
          const next = [...routeWaypointsRef.current, coord]
          snapRoute(next)
        }
      }
      // draw-rect and draw-circle are committed via mouseup (drag-to-draw); click is unused for them
    },
    dblclick() {
      // Two fast clicks at different spots: both were placed, nothing to finish.
      if (!clickGuard.isDouble()) return
      const s = uiStore.getState()
      if (editingMode === 'measure') { s.completeMeasure(); return }
      if (editingMode === 'draw-line') s.commitLine({})
      else if (editingMode === 'draw-polygon') s.commitPolygon({})
      else if (editingMode === 'cut-hole') s.commitCutHole()
      else if (editingMode === 'slice-shape') s.commitSliceShape()
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
        s.commitRoute()
      }
    },
  })

    useEffect(() => {
      const container = map.getContainer()
      if (editingMode !== 'none') {
        container.style.cursor = editingMode === 'pick-shape' ? 'pointer' : 'crosshair'
        container.classList.add('drawing-mode')
      } else {
        container.style.cursor = ''
        container.classList.remove('drawing-mode')
      }
    }, [editingMode, map])

  useEffect(() => {
    return () => {
      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current)
      if (cursorAbortRef.current) cursorAbortRef.current.abort()
    }
  }, [])

  // Disable map panning during drag-to-draw modes so the mouse drag draws, not pans.
  // Spacebar overrides this by calling map.dragging.enable() directly.
  useEffect(() => {
    if (['draw-freehand', 'draw-rect', 'draw-circle'].includes(editingMode)) {
      if (!isSpacePanningRef.current) map.dragging.disable()
    } else {
      map.dragging.enable()
      isDraggingFreehand.current = false
    }
  }, [editingMode, map])

  return null
}
