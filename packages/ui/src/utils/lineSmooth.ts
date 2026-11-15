/**
 * Chaikin corner cutting for an open line: each pass replaces every segment
 * with its ¼ and ¾ points, keeping the first and last point where they are.
 * The same scheme (and ratios) as `@turf/polygon-smooth`, which only handles
 * closed rings. Pure; used by the geometry worker for Smooth on LineStrings.
 */
export function smoothLine(coords: number[][], iterations: number): number[][] {
  let pts = coords
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts
    const out: number[][] = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dims = Math.min(a.length, b.length)
      const q: number[] = []
      const r: number[] = []
      for (let d = 0; d < dims; d++) {
        q.push(0.75 * a[d] + 0.25 * b[d])
        r.push(0.25 * a[d] + 0.75 * b[d])
      }
      out.push(q, r)
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}
