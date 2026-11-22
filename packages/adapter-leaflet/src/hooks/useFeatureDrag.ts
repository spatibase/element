import { useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import { type GeoJSONFeature } from '@element-editor/core'
import { project, translateGeometryVisually, translateGeometrySpatially } from '@element-editor/core/internal'
import { useDataStore, useGeoStore } from '../store/StoreContext'
import { useDuplicateDrag } from './useDuplicateDrag'
import { computeDragDisplay } from '../utils/dragUtils'
import type { MapInteractionMachine } from './useMapInteractionMachine'
import { canPlainDragSelected, markSelectedPress, pastSlop, setActiveFeatureDrag, MOVING_FEATURE_CLASS } from '../utils/selectedDrag'

/**
 * Cmd/Ctrl+drag (move) and Alt+drag (duplicate) for a single Point, LineString or
 * Polygon; a plain drag on an already-selected feature moves it too (past the click
 * slop, see utils/selectedDrag). The Multi* / GeometryCollection counterpart is `usePartDrag`.
 *
 * `dragDelta` state flips only at drag start/end — it toggles the ghost/visibility
 * renders. During mousemove `onLiveMove` gets the translated coordinates and moves
 * the Leaflet layer imperatively, skipping 60Hz React reconciliation. See audit #4.
 *
 * Returns the coordinates to render (`display`, plus `ghost` during a duplicate drag).
 */
export function useFeatureDrag<C extends unknown[]>(
  feature: GeoJSONFeature,
  type: 'Point' | 'LineString' | 'Polygon',
  coords: C,
  selected: boolean,
  isMultiSelected: boolean,
  multiDragDelta: [number, number] | null,
  multiDuplicateDrag: boolean,
  readonly: boolean,
  interaction: MapInteractionMachine,
  onLiveMove: (translated: C, isDuplicate: boolean) => void,
) {
  const { dataStore, uiStore } = useGeoStore()
  const updateFeature = useDataStore((s) => s.updateFeature)
  const map = useMap()

  const [dragDelta, setDragDelta] = useState<[number, number] | null>(null)
  const liveDeltaRef = useRef<[number, number] | null>(null)
  const dragStart = useRef<{ lng: number; lat: number } | null>(null)
  const dragged = useRef(false)
  const { isDupDrag, setDuplicateDrag, resetDuplicateDrag } = useDuplicateDrag(dragDelta, multiDuplicateDrag)

  // Prefer the live ref (current drag position) over the start/end state flag, so
  // any incidental re-render during drag computes positions at the right place.
  const renderedLocalDelta = liveDeltaRef.current ?? dragDelta
  const effectiveDelta = isMultiSelected && multiDragDelta ? multiDragDelta : renderedLocalDelta
  const { display, ghost } = computeDragDisplay(coords, effectiveDelta, isDupDrag, dataStore.getState().geometryMode)

  function handleMouseDown(e: LeafletMouseEvent) {
    if (readonly) return
    dragged.current = false
    const ev = e.originalEvent
    const isAlt = ev.altKey
    const isCtrl = ev.ctrlKey || ev.metaKey
    // No modifier: only a press on an already-selected feature moves it (past the click
    // slop); anywhere else a plain drag pans. Shift is toggle / box select.
    const plain = !isAlt && !isCtrl
    if (plain) {
      if (ev.shiftKey || ev.button !== 0 || !(selected || isMultiSelected)) return
      if (!canPlainDragSelected(uiStore.getState())) return
      markSelectedPress(ev)
    }
    if (isMultiSelected && dataStore.getState().selectedIds.length >= 2) return // let MultiDragHandler handle it
    ev.preventDefault()
    ev.stopPropagation()
    map.dragging.disable()
    const isDuplicate = isAlt
    const startPx = { x: ev.clientX, y: ev.clientY }
    const mode = dataStore.getState().geometryMode; if (mode === 'visual') { const startProj = project([e.latlng.lng, e.latlng.lat]); dragStart.current = { lng: startProj[0], lat: startProj[1] } } else { dragStart.current = { lng: e.latlng.lng, lat: e.latlng.lat } }
    if (!selected && !isMultiSelected) dataStore.getState().selectFeature(feature.id)
    // Single render to toggle ghost/visibility on. A plain press waits for the slop:
    // a click on the selected feature renders nothing extra.
    const begin = () => {
      setDuplicateDrag(isDuplicate)
      setDragDelta([0, 0])
      map.getContainer().classList.add(MOVING_FEATURE_CLASS)
    }
    if (!plain) begin()

    function onMove(ev: LeafletMouseEvent) {
      if (!dragStart.current) return
      if (plain && !dragged.current) {
        if (!pastSlop(startPx, ev.originalEvent)) return
        begin()
      }
      interaction.markDragStart()
      dragged.current = true
      const mode = dataStore.getState().geometryMode
      const delta: [number, number] = mode === 'visual'
        ? (() => { const p = project([ev.latlng.lng, ev.latlng.lat]); return [p[0] - dragStart.current!.lng, p[1] - dragStart.current!.lat] })()
        : [ev.latlng.lng - dragStart.current.lng, ev.latlng.lat - dragStart.current.lat]
      liveDeltaRef.current = delta
      onLiveMove(computeDragDisplay(coords, delta, false, mode).display, isDuplicate)
    }

    function end() {
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      map.dragging.enable()
      map.getContainer().classList.remove(MOVING_FEATURE_CLASS)
      setActiveFeatureDrag(null)
    }

    // A second finger: the gesture is a pinch. Put the shape back, commit nothing.
    function cancel() {
      const wasDragged = dragged.current
      end()
      dragStart.current = null
      resetDuplicateDrag()
      liveDeltaRef.current = null
      setDragDelta(null)
      if (wasDragged) {
        onLiveMove(coords, false)
        interaction.markDragEnd()
      }
    }

    function onUp(ev: LeafletMouseEvent) {
      end()
      if (!dragStart.current || !dragged.current) {
        dragStart.current = null
        resetDuplicateDrag()
        liveDeltaRef.current = null
        setDragDelta(null)
        return
      }
      const dragStartValue = dragStart.current
      const mode = dataStore.getState().geometryMode
      let dlng, dlat
      if (mode === 'visual') {
        const evProj = project([ev.latlng.lng, ev.latlng.lat])
        dlng = evProj[0] - dragStartValue.lng
        dlat = evProj[1] - dragStartValue.lat
      } else {
        dlng = ev.latlng.lng - dragStartValue.lng
        dlat = ev.latlng.lat - dragStartValue.lat
      }
      dragStart.current = null
      resetDuplicateDrag()
      liveDeltaRef.current = null
      setDragDelta(null)
      const newCoords =
        mode === 'visual'
          ? translateGeometryVisually(coords, dlng, dlat)
          : translateGeometrySpatially(coords, [dragStartValue.lng, dragStartValue.lat], [ev.latlng.lng, ev.latlng.lat])
      const geometry = { type, coordinates: newCoords } as GeoJSONFeature['geometry']
      if (isDuplicate) {
        dataStore.getState().duplicateFeaturesAtPosition([{ sourceId: feature.id, geometry }])
      } else {
        dataStore.getState().takeSnapshot()
        updateFeature(feature.id, { geometry })
      }
      interaction.markDragEnd()
    }

    setActiveFeatureDrag(cancel)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
  }

  return { effectiveDelta, display, ghost, dragged, handleMouseDown }
}
