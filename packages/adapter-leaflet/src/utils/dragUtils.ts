import type { PathOptions } from 'leaflet'
import { translateGeometryVisually } from '@element-editor/core/internal'

// ─── Ghost path options for Alt+drag duplicate preview ────────────────────────

export const GHOST_LINE_OPTIONS: PathOptions = {
  weight: 3,
  opacity: 0.5,
  dashArray: '6 4',
  interactive: false,
}

export const GHOST_FILL_OPTIONS: PathOptions = {
  weight: 2,
  opacity: 0.5,
  fillOpacity: 0.15,
  dashArray: '6 4',
  interactive: false,
}

// ─── Coordinate translation helpers ───────────────────────────────────────────

/** Recursively offsets all [lng, lat] coordinate pairs by [dx, dy]. Works for any nesting depth. */
function offsetCoords<T>(coords: T, dx: number, dy: number): T {
  if (typeof (coords as number[])[0] === 'number') {
    return [(coords as number[])[0] + dx, (coords as number[])[1] + dy] as T
  }
  return (coords as unknown[]).map((c) => offsetCoords(c, dx, dy)) as T
}

/**
 * Computes display and ghost coordinates for drag / duplicate-drag.
 * - Normal drag: display = translated, ghost = null (feature moves)
 * - Duplicate drag: display = original, ghost = translated (ghost follows cursor)
 */
export function computeDragDisplay<T>(
  coords: T,
  effectiveDelta: [number, number] | null,
  isDupDrag: boolean,
  geometryMode: 'visual' | 'spatial',
): { display: T; ghost: T | null } {
  if (!effectiveDelta) return { display: coords, ghost: null }
  const translated = geometryMode === 'visual'
    ? translateGeometryVisually(coords as unknown[], effectiveDelta[0], effectiveDelta[1]) as T
    : offsetCoords(coords, effectiveDelta[0], effectiveDelta[1])
  if (isDupDrag) return { display: coords, ghost: translated }
  return { display: translated, ghost: null }
}
