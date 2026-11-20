import { useState, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import {
  project,
  offsetGeometry,
  offsetSimpleGeometry,
  getPartGeometry,
  setPartGeometry,
} from '@element-editor/core/internal'
import type { GeoJSONFeature } from '@element-editor/core'
import { useDataStore, useUIStore, useGeoStore } from '@element-editor/ui'
import type { MapInteractionMachine } from './useMapInteractionMachine'
import { canPlainDragSelected, markSelectedPress, pastSlop, setActiveFeatureDrag, MOVING_FEATURE_CLASS } from '../utils/selectedDrag'

/**
 * Shared drag logic for Multi* and GeometryCollection layers.
 *
 * Handles:
 * - Cmd/Ctrl+drag initiation, and a plain drag on an already-selected feature
 * - Visual vs spatial mode delta computation
 * - Per-part or whole-geometry offset on commit
 *
 * Returns state and handlers to wire into Leaflet event handlers.
 *
 * `dragDelta` state flips only at drag start/end; mousemove updates a ref and
 * invokes the optional `onLiveMove` callback so consumers can move their
 * Leaflet layers imperatively (skipping 60Hz React reconciliation). Consumers
 * that don't need the fast path can omit `onLiveMove`.
 */
export function usePartDrag(
  feature: GeoJSONFeature,
  selected: boolean,
  isMultiSelected: boolean,
  multiDragDelta: [number, number] | null,
  readonly: boolean,
  interaction: MapInteractionMachine,
  onLiveMove?: (delta: [number, number], mode: 'visual' | 'spatial', activePartIdx: number | null) => void,
) {
  const { dataStore, uiStore } = useGeoStore()
  const updateFeature = useDataStore((s) => s.updateFeature)
  const map = useMap()

  const [dragDelta, setDragDelta] = useState<[number, number] | null>(null)
  const liveDeltaRef = useRef<[number, number] | null>(null)
  const dragStart = useRef<{ lng: number; lat: number } | null>(null)
  const dragged = useRef(false)

  // Latest-ref for the callback so closures stay fresh without re-wiring listeners.
  const onLiveMoveRef = useRef(onLiveMove)
  onLiveMoveRef.current = onLiveMove

  const renderedLocalDelta = liveDeltaRef.current ?? dragDelta
  const effectiveDelta = isMultiSelected && multiDragDelta ? multiDragDelta : renderedLocalDelta

  function handleMouseDown(_partIndex: number, e: LeafletMouseEvent) {
    if (readonly) return
    dragged.current = false
    const ev = e.originalEvent
    // No modifier: only a press on an already-selected feature moves it (past the click slop).
    const plain = !ev.ctrlKey && !ev.metaKey
    if (plain) {
      if (ev.altKey || ev.shiftKey || ev.button !== 0 || !(selected || isMultiSelected)) return
      if (!canPlainDragSelected(uiStore.getState())) return
      markSelectedPress(ev)
    }
    if (isMultiSelected && dataStore.getState().selectedIds.length >= 2) return
    ev.preventDefault()
    ev.stopPropagation()
    map.dragging.disable()
    const startPx = { x: ev.clientX, y: ev.clientY }
    const mode = dataStore.getState().geometryMode
    if (mode === 'visual') {
      const startProj = project([e.latlng.lng, e.latlng.lat])
      dragStart.current = { lng: startProj[0], lat: startProj[1] }
    } else {
      dragStart.current = { lng: e.latlng.lng, lat: e.latlng.lat }
    }
    if (!selected && !isMultiSelected) dataStore.getState().selectFeature(feature.id)
    const begin = () => {
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
      const activePartIdx = selected ? uiStore.getState().selectedPartIndex : null
      if (onLiveMoveRef.current) {
        onLiveMoveRef.current(delta, mode, activePartIdx)
      } else {
        // Fallback path for consumers that haven't opted into the imperative API
        // (currently: GeometryCollectionLayer). Keeps live drag preview working
        // via the classic setState-per-frame render cycle.
        setDragDelta(delta)
      }
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
      liveDeltaRef.current = null
      setDragDelta(null)
      if (wasDragged) {
        onLiveMoveRef.current?.([0, 0], dataStore.getState().geometryMode, selected ? uiStore.getState().selectedPartIndex : null)
        interaction.markDragEnd()
      }
    }

    function onUp(ev: LeafletMouseEvent) {
      end()
      if (!dragStart.current || !dragged.current) {
        dragStart.current = null
        liveDeltaRef.current = null
        setDragDelta(null)
        return
      }
      const dragStartValue = dragStart.current
      const mode = dataStore.getState().geometryMode
      let dlng: number, dlat: number
      if (mode === 'visual') {
        const evProj = project([ev.latlng.lng, ev.latlng.lat])
        dlng = evProj[0] - dragStartValue.lng
        dlat = evProj[1] - dragStartValue.lat
      } else {
        dlng = ev.latlng.lng - dragStartValue.lng
        dlat = ev.latlng.lat - dragStartValue.lat
      }
      dragStart.current = null
      liveDeltaRef.current = null
      setDragDelta(null)
      dataStore.getState().takeSnapshot()

      const delta: [number, number] = [dlng, dlat]
      const visual = mode === 'visual'
      const partIdx = uiStore.getState().selectedPartIndex
      if (partIdx != null) {
        const partGeom = getPartGeometry(feature.geometry, partIdx)
        const newGeom = setPartGeometry(feature.geometry, partIdx, offsetSimpleGeometry(partGeom, delta, visual))
        updateFeature(feature.id, { geometry: newGeom })
      } else {
        updateFeature(feature.id, { geometry: offsetGeometry(feature.geometry, delta, visual) })
      }
      interaction.markDragEnd()
    }

    setActiveFeatureDrag(cancel)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
  }

  return { effectiveDelta, dragged, handleMouseDown }
}
