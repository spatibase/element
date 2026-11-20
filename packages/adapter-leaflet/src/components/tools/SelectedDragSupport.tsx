import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { useUIStore } from '../../store/StoreContext'
import {
  canPlainDragSelected, cancelActiveFeatureDrag,
  CAN_MOVE_SELECTED_CLASS, SELECTED_FEATURE_CLASS,
} from '../../utils/selectedDrag'

/**
 * Plain drag on a selected feature (see utils/selectedDrag):
 * - keeps `elm-can-move-selected` on the map container while it is possible, which gives
 *   selected features the move cursor (index.css);
 * - lets one finger do it. Leaflet's feature layers only get mouse events, so a touch that
 *   starts on a selected feature is replayed as mousedown / mousemove / mouseup through the
 *   same layer handlers a mouse uses. The layer handler disables map dragging on that
 *   mousedown, before Leaflet's own pointerdown listener (bubble phase) sees the touch, so
 *   the map doesn't pan. A tap stays a tap (the browser's own click follows). A second
 *   finger cancels the move and leaves the gesture to pinch zoom.
 */
export function SelectedDragSupport({ readonly }: { readonly: boolean }) {
  const map = useMap()
  const can = useUIStore((s) => canPlainDragSelected({ ...s, readonly }))

  useEffect(() => {
    const c = map.getContainer()
    c.classList.toggle(CAN_MOVE_SELECTED_CLASS, can)
    return () => c.classList.remove(CAN_MOVE_SELECTED_CLASS)
  }, [map, can])

  useEffect(() => {
    if (!can) return
    const c = map.getContainer()
    let active: number | null = null // the replayed finger's pointerId
    const fire = (target: EventTarget, type: string, e: PointerEvent) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
    }))
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      // A second finger, anywhere on the page (it may land on a toolbar): a pinch, not a move.
      if (active !== null) { active = null; cancelActiveFeatureDrag(); return }
      if (!e.isPrimary) return
      const t = e.target as Element | null
      if (!t || !c.contains(t) || !t.closest?.(`.${SELECTED_FEATURE_CLASS}`)) return
      // Not cancelled: no handler took it (e.g. the press hit an overlay), let the map pan.
      if (!fire(t, 'mousedown', e)) active = e.pointerId
    }
    const move = (e: PointerEvent) => { if (e.pointerId === active) fire(c, 'mousemove', e) }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      active = null
      fire(c, 'mouseup', e)
    }
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      active = null
      cancelActiveFeatureDrag()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', cancel, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', cancel, true)
      if (active !== null) cancelActiveFeatureDrag()
    }
  }, [map, can])

  return null
}
