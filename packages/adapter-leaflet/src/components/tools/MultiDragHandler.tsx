import type { LeafletMouseEvent } from 'leaflet'
import { useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import { useGeoStore, useUIStore } from '../../store/StoreContext'
import { project } from '@element-editor/core/internal'
import { setFeatureDragActive } from '../../utils/featureTooltip'

type MultiDragHandlerProps = {
  onDragDelta: (delta: [number, number]) => void
  onDragEnd: (delta: [number, number], isDuplicate: boolean) => void
  onDuplicateDragChange: (isDuplicate: boolean) => void
  readonly: boolean
}

/** Handles Cmd/Ctrl+drag (move) or Alt+drag (duplicate) on multi-selected features. */
export function MultiDragHandler({ onDragDelta, onDragEnd, onDuplicateDragChange, readonly }: MultiDragHandlerProps) {
  const { dataStore } = useGeoStore()
  const map = useMap()
  const editingMode = useUIStore((s) => s.editingMode)
  const editingModeRef = useRef(editingMode)
  editingModeRef.current = editingMode

  useMapEvents({
    mousedown(e) {
      if (readonly) return
      const state = dataStore.getState()
      if (editingModeRef.current !== 'none') return
      const isAlt = e.originalEvent.altKey
      const isCtrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey
      if (!isAlt && !isCtrl) return
      if (state.selectedIds.length < 2) return

      const target = e.originalEvent.target as HTMLElement
      // SVG path, marker, or the idle-feature canvas while a feature is under the pointer.
      const isPath = target.closest('.leaflet-overlay-pane path') || target.closest('.leaflet-marker-icon') || target.matches('canvas.leaflet-interactive')
      if (!isPath) return

      e.originalEvent.preventDefault()
      e.originalEvent.stopPropagation()
      map.dragging.disable()
      const isDuplicate = isAlt
      if (isDuplicate) onDuplicateDragChange(true)

      const startProj = project([e.latlng.lng, e.latlng.lat])
      let dragged = false

      function onMove(ev: LeafletMouseEvent) {
        if (!dragged) setFeatureDragActive(true)
        dragged = true
        const evProj = project([ev.latlng.lng, ev.latlng.lat])
        onDragDelta([evProj[0] - startProj[0], evProj[1] - startProj[1]])
      }

      function onUp(ev: LeafletMouseEvent) {
        map.off('mousemove', onMove)
        map.off('mouseup', onUp)
        map.dragging.enable()
        setFeatureDragActive(false)
        if (!dragged) return
        const evProj = project([ev.latlng.lng, ev.latlng.lat])
        onDragEnd([evProj[0] - startProj[0], evProj[1] - startProj[1]], isDuplicate)
      }

      map.on('mousemove', onMove)
      map.on('mouseup', onUp)
    },
  })

  return null
}
