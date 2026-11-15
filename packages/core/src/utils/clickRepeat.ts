/**
 * How far (CSS px) the pointer may move and still count as "the same spot": between the
 * mousedown and mouseup of one click in a click tool (above it the map pans and the click is
 * lost), and between the two clicks of a double-click.
 */
export const CLICK_SLOP_PX = 8

/** Tools that place something on each click; they get `CLICK_SLOP_PX` as the map's drag threshold. */
export const CLICK_TOOL_MODES: readonly string[] = [
  'place-point', 'draw-line', 'draw-polygon', 'draw-route', 'cut-hole', 'slice-shape', 'measure', 'pick-shape',
]

/**
 * Tells a real double-click from two fast clicks at different spots. Browsers count clicks
 * by time (macOS by time alone), so the 2nd of two quick clicks far apart can arrive with
 * `detail: 2` and fire `dblclick`. Guarding on `detail > 1` then drops that click (no point,
 * no vertex), and the `dblclick` finishes the shape early.
 *
 * Call `click(e)` on every map click: true only for the 2nd+ click of a same-spot double-click.
 * `isDouble()` in the `dblclick` handler: true only when that 2nd click was such a repeat.
 */
export function createClickRepeatGuard(tolerancePx = CLICK_SLOP_PX) {
  let last: { x: number; y: number } | null = null
  let repeat = false
  return {
    click(e: MouseEvent): boolean {
      repeat = e.detail > 1 && !!last && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= tolerancePx
      last = { x: e.clientX, y: e.clientY }
      return repeat
    },
    isDouble: () => repeat,
  }
}
