/** How a floating box sits relative to its anchor point on one axis. */
export type PlaceMode = 'before' | 'center' | 'after'

export interface PlaceBounds { left: number; top: number; right: number; bottom: number }

function placeAxis(p: number, size: number, mode: PlaceMode, gap: number, min: number, max: number, margin: number): number {
  let start = mode === 'center' ? p - size / 2 : mode === 'after' ? p + gap : p - gap - size
  // Flip to the other side of the point when the preferred side overflows.
  if (mode === 'after' && start + size > max - margin) start = p - gap - size
  else if (mode === 'before' && start < min + margin) start = p + gap
  return Math.max(min + margin, Math.min(start, max - margin - size))
}

/**
 * Position a `w`×`h` floating box (tooltip, cursor hint) next to point `x,y`
 * so it is never cut off: overflowing sides flip across the point, then the
 * box is clamped inside `bounds` (default: the viewport) with `margin` px.
 * Returns the box's top-left corner in the same coordinate space as `x,y`.
 */
export function placeBox(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { x: PlaceMode; y: PlaceMode; gapX?: number; gapY?: number; margin?: number; bounds?: PlaceBounds },
): { left: number; top: number } {
  const b = opts.bounds ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const m = opts.margin ?? 8
  return {
    left: Math.round(placeAxis(x, w, opts.x, opts.gapX ?? 0, b.left, b.right, m)),
    top: Math.round(placeAxis(y, h, opts.y, opts.gapY ?? 0, b.top, b.bottom, m)),
  }
}
