/** Mercator helpers, geographic translation (utils/spatial.ts) and placeBox. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { distance } from '@turf/distance'
import { area } from '@turf/area'
import { project, unproject, toRadians, translateGeometryVisually, applyVisualTransform } from '../src/mercator'
import { translateGeometrySpatially } from '../src/utils/spatial'
import { placeBox } from '../src/utils/placeBox'

describe('project / unproject', () => {
  it('origin and known points', () => {
    expect(project([0, 0])[0]).toBe(0)
    expect(project([0, 0])[1]).toBeCloseTo(0, 12)
    expect(project([13, 0])[0]).toBe(13)
    // Web Mercator y at 85.0511° (the square-world latitude) is 180 in these units.
    expect(project([0, 85.0511287798])[1]).toBeCloseTo(180, 6)
    expect(toRadians(180)).toBeCloseTo(Math.PI, 15)
  })

  it('unproject(project(p)) round-trips across the usable latitude range', () => {
    for (let lat = -85; lat <= 85; lat += 5) {
      for (const lng of [-180, -97.3, 0, 14.42, 179.99]) {
        const [x, lat2] = unproject(project([lng, lat]))
        expect(x).toBe(lng)
        expect(lat2).toBeCloseTo(lat, 9)
      }
    }
  })

  it('is monotonic in latitude and symmetric around the equator', () => {
    let prev = -Infinity
    for (let lat = -89; lat <= 89; lat += 1) {
      const y = project([0, lat])[1]
      expect(y).toBeGreaterThan(prev)
      expect(project([0, -lat])[1]).toBeCloseTo(-y, 9)
      prev = y
    }
  })

  it('clamps the poles to finite values', () => {
    expect(Number.isFinite(project([0, 90])[1])).toBe(true)
    expect(Number.isFinite(project([0, -90])[1])).toBe(true)
    expect(project([0, 95])).toEqual(project([0, 90]))
  })
})

describe('translateGeometryVisually', () => {
  it('preserves nesting and moves every position by the projected delta', () => {
    const coords: [number, number][][][] = [[[[10, 50], [11, 50], [11, 51], [10, 50]]], [[[0, 0], [1, 0], [1, 1], [0, 0]]]]
    const moved = translateGeometryVisually(coords, 2, -3)
    expect(moved).toHaveLength(2)
    expect(moved[0][0]).toHaveLength(4)
    moved.flat(2).forEach((c, i) => {
      const o = coords.flat(2)[i]
      const [x0, y0] = project(o)
      const [x1, y1] = project(c)
      expect(x1 - x0).toBeCloseTo(2, 9)
      expect(y1 - y0).toBeCloseTo(-3, 9)
    })
  })

  it('does not mutate its input', () => {
    const coords: [number, number][] = [[1, 2], [3, 4]]
    translateGeometryVisually(coords, 5, 5)
    expect(coords).toEqual([[1, 2], [3, 4]])
  })
})

describe('applyVisualTransform', () => {
  it('a 90° rotation keeps the ground area of a small square at 50°N', () => {
    const d = 0.01
    const ring: [number, number][] = [[14, 50], [14 + d / Math.cos(toRadians(50)), 50], [14 + d / Math.cos(toRadians(50)), 50 + d], [14, 50 + d], [14, 50]]
    const f = { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: {} }
    const r = applyVisualTransform(f, [14, 50], 1, 1, 90)
    expect(area(r)).toBeCloseTo(area(f), -1) // within ~5 m² of ~1.2 km²
  })

  it('scale 2×2 quadruples a small polygon’s area', () => {
    const ring: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]
    const f = { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: {} }
    const r = applyVisualTransform(f, [0.005, 0.005], 2, 2, 0)
    expect(area(r) / area(f)).toBeCloseTo(4, 3)
  })
})

describe('translateGeometrySpatially', () => {
  it('moves a vertex at the drag start to the drag end', () => {
    const start: [number, number] = [14.42, 50.08]
    const end: [number, number] = [14.5, 50.0]
    const [moved] = translateGeometrySpatially([start], start, end)
    expect(distance(moved, end, { units: 'meters' })).toBeLessThan(0.01)
  })

  it('keeps edge lengths for a 1 km shape moved 5 km (local moves)', () => {
    const ring: [number, number][] = [[10, 45], [10.0127, 45], [10.0127, 45.009], [10, 45.009], [10, 45]]
    const moved = translateGeometrySpatially([ring], [10, 45], [10.03, 45.03])[0]
    for (let i = 0; i < ring.length - 1; i++) {
      const before = distance(ring[i], ring[i + 1], { units: 'meters' })
      const after = distance(moved[i], moved[i + 1], { units: 'meters' })
      expect(Math.abs(after - before) / before).toBeLessThan(0.002)
    }
  })

  // Regression: translateGeometrySpatially used to move every vertex by the same distance + initial
  // bearing, so a shape moved north kept its east-west width in degrees and shrank on the ground
  // (cos(lat) factor): a 1 km-wide square dragged 500 km north (45°→49.5°) lost ~8% of its width.
  // Each vertex now keeps its ground distance and bearing from the drag anchor.
  it('keeps edge lengths (true ground size) for a 1 km shape moved 500 km north', () => {
    const ring: [number, number][] = [[10, 45], [10.0127, 45], [10.0127, 45.009], [10, 45.009], [10, 45]]
    const moved = translateGeometrySpatially([ring], [10, 45], [10, 49.5])[0]
    for (let i = 0; i < ring.length - 1; i++) {
      const before = distance(ring[i], ring[i + 1], { units: 'meters' })
      const after = distance(moved[i], moved[i + 1], { units: 'meters' })
      expect(Math.abs(after - before) / before).toBeLessThan(0.01)
    }
    expect(moved[0]).not.toBe(ring[0])
    expect(ring[0]).toEqual([10, 45])
  })

  it('keeps edge lengths and north-up orientation for a 1 km shape moved 1500 km east at 60°N', () => {
    const ring: [number, number][] = [[10, 60], [10.018, 60], [10.018, 60.009], [10, 60.009], [10, 60]]
    const moved = translateGeometrySpatially([ring], [10.009, 60.0045], [37, 60.0045])[0]
    for (let i = 0; i < ring.length - 1; i++) {
      const before = distance(ring[i], ring[i + 1], { units: 'meters' })
      const after = distance(moved[i], moved[i + 1], { units: 'meters' })
      expect(Math.abs(after - before) / before).toBeLessThan(0.001)
    }
    // the bottom edge stays (almost) east-west: no rotation from the great-circle path
    expect(Math.abs(moved[1][1] - moved[0][1])).toBeLessThan(1e-4)
  })

  it('a zero-length drag is the identity', () => {
    const coords: [number, number][] = [[1, 2], [3, 4]]
    const moved = translateGeometrySpatially(coords, [5, 5], [5, 5])
    moved.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(coords[i][0], 9)
      expect(c[1]).toBeCloseTo(coords[i][1], 9)
    })
  })
})

describe('placeBox', () => {
  const bounds = { left: 0, top: 0, right: 800, bottom: 600 }
  afterEach(() => { vi.unstubAllGlobals() })

  it('after / before / center on each axis when there is room', () => {
    expect(placeBox(100, 100, 50, 20, { x: 'after', y: 'after', gapX: 10, gapY: 4, bounds })).toEqual({ left: 110, top: 104 })
    expect(placeBox(400, 300, 50, 20, { x: 'before', y: 'before', gapX: 10, gapY: 4, bounds })).toEqual({ left: 340, top: 276 })
    expect(placeBox(400, 300, 50, 20, { x: 'center', y: 'center', bounds })).toEqual({ left: 375, top: 290 })
  })

  it('flips "before" to after the point near the top-left edge', () => {
    expect(placeBox(20, 10, 50, 20, { x: 'before', y: 'before', gapX: 6, gapY: 6, bounds })).toEqual({ left: 26, top: 16 })
  })

  it('flips "after" to before the point near the bottom-right edge', () => {
    expect(placeBox(790, 590, 50, 20, { x: 'after', y: 'after', gapX: 6, gapY: 6, bounds })).toEqual({ left: 734, top: 564 })
  })

  it('a box larger than the bounds pins to the start margin', () => {
    expect(placeBox(400, 300, 1000, 900, { x: 'center', y: 'after', bounds, margin: 12 })).toEqual({ left: 12, top: 12 })
  })

  it('never leaves the bounds minus margin for any anchor (fuzz)', () => {
    const modes = ['before', 'center', 'after'] as const
    const b = { left: 100, top: 50, right: 900, bottom: 650 }
    for (let x = 80; x <= 920; x += 37) {
      for (let y = 30; y <= 670; y += 41) {
        for (const mx of modes) for (const my of modes) {
          const { left, top } = placeBox(x, y, 120, 40, { x: mx, y: my, gapX: 8, gapY: 8, margin: 8, bounds: b })
          expect(left).toBeGreaterThanOrEqual(b.left + 8)
          expect(left + 120).toBeLessThanOrEqual(b.right - 8)
          expect(top).toBeGreaterThanOrEqual(b.top + 8)
          expect(top + 40).toBeLessThanOrEqual(b.bottom - 8)
        }
      }
    }
  })

  it('rounds to whole pixels', () => {
    const r = placeBox(100.4, 100.6, 33, 21, { x: 'center', y: 'center', bounds })
    expect(Number.isInteger(r.left) && Number.isInteger(r.top)).toBe(true)
  })

  it('defaults to the window viewport', () => {
    vi.stubGlobal('window', { innerWidth: 300, innerHeight: 200 })
    expect(placeBox(295, 195, 50, 20, { x: 'after', y: 'after' })).toEqual({ left: 242, top: 172 })
  })
})
