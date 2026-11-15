import { useState } from 'react'
import { useMapEvents } from 'react-leaflet'

/**
 * Tracks the latest map cursor lat/lng while a caller-specified mode is active
 * and resets on every `editingMode` transition so exiting-and-re-entering the
 * same tool (e.g. press R → off → R from a new cursor position) doesn't leak
 * the previous session's coordinates on the first frame.
 *
 * React's "set state during render" reset pattern is used intentionally — it
 * produces a synchronous re-render with cleared state before the browser
 * paints, so there's no stale-coord flash.
 *
 * Usage:
 *
 *   const mouse = useCursorWhileMode(editingMode, editingMode === 'draw-rect')
 *
 * Pass a predicate that's true whenever cursor updates should flow into state.
 * On mouseout (cursor leaves the map container) the value resets to null, so
 * tooltips / previews that depend on it disappear.
 *
 * Any component that captures cursor position during a drawing mode should use
 * this hook rather than re-implementing the pattern — see
 * `feedback_mode_gated_cursor_state.md` for the history of that bug class.
 */
export function useCursorWhileMode(editingMode: string, isActive: boolean): [number, number] | null {
  const [pos, setPos] = useState<[number, number] | null>(null)
  const [lastSeenMode, setLastSeenMode] = useState(editingMode)
  if (lastSeenMode !== editingMode) {
    setLastSeenMode(editingMode)
    setPos(null)
  }
  useMapEvents({
    mousemove(e) {
      if (isActive) setPos([e.latlng.lng, e.latlng.lat])
    },
    mouseout() {
      setPos(null)
    },
  })
  return pos
}
