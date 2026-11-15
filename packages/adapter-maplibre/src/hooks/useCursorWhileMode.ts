import { useEffect, useState } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

/**
 * Tracks the latest map cursor lng/lat while a caller-specified mode is active
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
 *   const mouse = useCursorWhileMode(map, editingMode, editingMode === 'draw-rect')
 *
 * Pass a predicate that's true whenever cursor updates should flow into state.
 * On mouseout (cursor leaves the map canvas) the value resets to null, so
 * tooltips / previews that depend on it disappear.
 */
export function useCursorWhileMode(
  map: MapLibreMap,
  editingMode: string,
  isActive: boolean,
): [number, number] | null {
  const [pos, setPos] = useState<[number, number] | null>(null)
  const [lastSeenMode, setLastSeenMode] = useState(editingMode)
  if (lastSeenMode !== editingMode) {
    setLastSeenMode(editingMode)
    setPos(null)
  }

  useEffect(() => {
    const onMousemove = (e: MapMouseEvent) => {
      if (isActive) setPos([e.lngLat.lng, e.lngLat.lat])
    }
    const onMouseout = () => setPos(null)
    map.on('mousemove', onMousemove)
    map.on('mouseout', onMouseout)
    return () => {
      map.off('mousemove', onMousemove)
      map.off('mouseout', onMouseout)
    }
  }, [map, isActive])

  return pos
}
