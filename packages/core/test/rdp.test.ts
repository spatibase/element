import { describe, it, expect } from 'vitest'
import { rdp } from '../src/utils/rdp'

type P = [number, number]

/** Distance from p to the closed segment a..b. */
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
/** Max distance of any input point from the simplified polyline (one-sided Hausdorff). */
function maxDeviation(input: P[], simplified: P[]): number {
  let worst = 0
  for (const p of input) {
    let best = Infinity
    for (let i = 0; i < simplified.length - 1; i++) best = Math.min(best, segDist(p, simplified[i], simplified[i + 1]))
    if (simplified.length === 1) best = Math.hypot(p[0] - simplified[0][0], p[1] - simplified[0][1])
    worst = Math.max(worst, best)
  }
  return worst
}

/** Deterministic noisy walk (LCG) so the property tests are reproducible. */
function walk(n: number, seed = 1): P[] {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const out: P[] = []
  let x = 0, y = 0
  for (let i = 0; i < n; i++) {
    x += 0.001 + rnd() * 0.002
    y += (rnd() - 0.5) * 0.004
    out.push([x, y])
  }
  return out
}

describe('rdp', () => {
  it('returns a copy (not the same array) for 0–2 points', () => {
    const two: P[] = [[0, 0], [1, 1]]
    const r = rdp(two, 1)
    expect(r).toEqual(two)
    expect(r).not.toBe(two)
    expect(rdp([], 1)).toEqual([])
    expect(rdp([[3, 3]], 1)).toEqual([[3, 3]])
  })

  it('collapses collinear interior points to the two endpoints', () => {
    const pts: P[] = Array.from({ length: 100 }, (_, i) => [i, 2 * i])
    expect(rdp(pts, 1e-9)).toEqual([[0, 0], [99, 198]])
  })

  it('keeps a spike larger than epsilon and drops one smaller', () => {
    const pts: P[] = [[0, 0], [1, 0], [2, 5], [3, 0], [4, 0]]
    expect(rdp(pts, 1)).toEqual([[0, 0], [2, 5], [4, 0]])
    expect(rdp(pts, 0.5)).toEqual(pts)
    expect(rdp([[0, 0], [2, 0.5], [4, 0]], 1)).toEqual([[0, 0], [4, 0]])
  })

  it('handles a closed ring (first === last) by measuring from the shared point', () => {
    const ringPts: P[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    const r = rdp(ringPts, 0.5)
    expect(r[0]).toEqual([0, 0])
    expect(r[r.length - 1]).toEqual([0, 0])
    expect(r.length).toBeGreaterThanOrEqual(4)
  })

  it('output is an ordered subset of the input that keeps both endpoints', () => {
    const pts = walk(2000)
    const r = rdp(pts, 0.002)
    expect(r[0]).toBe(pts[0])
    expect(r[r.length - 1]).toBe(pts[pts.length - 1])
    let j = 0
    for (const p of r) {
      while (j < pts.length && pts[j] !== p) j++
      expect(j).toBeLessThan(pts.length)
    }
    expect(r.length).toBeLessThan(pts.length)
  })

  it('larger epsilon never keeps more points', () => {
    const pts = walk(1500, 7)
    let prev = Infinity
    for (const eps of [0, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.1]) {
      const n = rdp(pts, eps).length
      expect(n).toBeLessThanOrEqual(prev)
      prev = n
    }
    expect(rdp(pts, 0).length).toBe(pts.length) // eps 0 keeps every non-collinear point
  })

  it('every dropped point of a forward-moving line lies within epsilon of the result', () => {
    for (const seed of [1, 2, 3]) {
      const pts = walk(800, seed)
      for (const eps of [0.0005, 0.002, 0.01]) {
        expect(maxDeviation(pts, rdp(pts, eps))).toBeLessThanOrEqual(eps + 1e-12)
      }
    }
  })

  it('10k points simplify in well under a second', () => {
    const pts = walk(10_000, 9)
    const t = performance.now()
    rdp(pts, 0.001)
    expect(performance.now() - t).toBeLessThan(1000) // generous: an O(n²) guard, not a benchmark
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): rdp measures distance to the infinite line through start..end, not to the segment
  // (rdp.ts:49, `t` is never clamped to [0, 1]; the Leaflet copy in adapter-leaflet FeatureInteractionLayer.tsx:50 has the same maths). A path that runs past an endpoint and comes
  // back (a freehand stroke that doubles back) has its turn-around point dropped: here the excursion
  // to x=20 disappears although it is 10 units (≫ epsilon) from the simplified line.
  it('keeps a point that overshoots past the end and comes back', () => {
    const pts: P[] = [[0, 0], [20, 0], [10, 0]]
    const r = rdp(pts, 0.5)
    expect(maxDeviation(pts, r)).toBeLessThanOrEqual(0.5)
  })
})
