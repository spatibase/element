/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Operates in [lng, lat] degree space — latitude distortion is acceptable for simplification.
 * @param points - array of [lng, lat] coordinates
 * @param epsilon - tolerance in degrees (use pixel-based conversion at caller for zoom-aware results)
 */
export function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return [...points]

  const start = points[0]
  const end = points[points.length - 1]

  let maxDist = 0
  let maxIdx = 0

  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], start, end)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIdx + 1), epsilon)
    const right = rdp(points.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  return [start, end]
}

/**
 * Distance from `point` to the segment start..end (not the infinite line through them:
 * a stroke that runs past an endpoint and comes back must keep its turn-around point).
 */
function segmentDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): number {
  const [x, y] = point
  const [x1, y1] = lineStart
  const [x2, y2] = lineEnd

  const dx = x2 - x1
  const dy = y2 - y1

  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1)
  }

  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
  const px = x1 + t * dx
  const py = y1 + t * dy

  return Math.hypot(x - px, y - py)
}
