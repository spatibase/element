/**
 * MapLibre snapping (src/utils/snapping.ts) against a fake map that implements MapLibre's real
 * Web Mercator maths (512 px tiles, no bearing / pitch).
 */
import { describe, it, expect } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GeoJSONFeature, Geometry } from '@element-editor/core'
import { findSnapPoint, snapToAngle } from '../src/utils/snapping'

type LngLat = [number, number]

/** A MapLibre-shaped map: world is 512·2^zoom px wide, origin at the view centre. */
function fakeMap(center: LngLat, zoom: number) {
  const world = 512 * 2 ** zoom
  const mx = (lng: number) => ((lng + 180) / 360) * world
  const my = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180)
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world
  }
  const cx = mx(center[0]), cy = my(center[1])
  let projections = 0
  const map = {
    project: (ll: LngLat | { lng: number; lat: number }) => {
      projections++
      const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat]
      return { x: mx(lng) - cx + 400, y: my(lat) - cy + 300 }
    },
    unproject: (p: [number, number] | { x: number; y: number }) => {
      const [x, y] = Array.isArray(p) ? p : [p.x, p.y]
      const wx = x - 400 + cx, wy = y - 300 + cy
      const lng = (wx / world) * 360 - 180
      const n = Math.PI - (2 * Math.PI * wy) / world
      const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
      return { lng, lat }
    },
    getZoom: () => zoom,
    getCenter: () => ({ lng: center[0], lat: center[1] }),
    get projections() { return projections },
  }
  return map as unknown as MapLibreMap & { projections: number }
}

/** The lng/lat `dx, dy` screen px away from `ll`. */
function offset(map: MapLibreMap, ll: LngLat, dx: number, dy: number): LngLat {
  const p = map.project(ll)
  const r = map.unproject([p.x + dx, p.y + dy])
  return [r.lng, r.lat]
}
function px(map: MapLibreMap, a: LngLat, b: LngLat) {
  const p = map.project(a), q = map.project(b)
  return Math.hypot(p.x - q.x, p.y - q.y)
}

function bboxOf(g: Geometry): [number, number, number, number] {
  const pts = JSON.stringify(g).match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number)
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    w = Math.min(w, pts[i]); e = Math.max(e, pts[i]); s = Math.min(s, pts[i + 1]); n = Math.max(n, pts[i + 1])
  }
  return [w, s, e, n]
}
const feat = (id: string, geometry: Geometry, withBbox = true): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry, properties: {}, ...(withBbox && { bbox: bboxOf(geometry) }) })

const C: LngLat = [14.42, 50.08]

describe('findSnapPoint (MapLibre)', () => {
  const map = fakeMap(C, 16)
  const v: LngLat = offset(map, C, 40, 0)
  const w: LngLat = offset(map, C, 40, 200)
  const line = feat('line', { type: 'LineString', coordinates: [v, w] })

  it('snaps to a vertex within the threshold and returns its exact coordinates', () => {
    const r = findSnapPoint(...offset(map, v, 6, 5), map, [line])
    expect(r).toEqual({ lnglat: v, isVertex: true, featureId: 'line' })
  })

  it('snaps to the closest point on an edge when no vertex is near', () => {
    const cursor = offset(map, C, 50, 100)
    const r = findSnapPoint(...cursor, map, [line])!
    expect(r.isVertex).toBe(false)
    expect(r.featureId).toBe('line')
    const p = map.project(r.lnglat)
    const pv = map.project(v)
    expect(p.x).toBeCloseTo(pv.x, 6) // on the vertical segment
    expect(p.y).toBeCloseTo(map.project(cursor).y, 6) // foot of the perpendicular
  })

  it('prefers a vertex over a closer edge when both are within the threshold', () => {
    const corner = feat('corner', { type: 'LineString', coordinates: [offset(map, C, -100, 0), C, offset(map, C, 0, -100)] })
    const cursor = offset(map, C, 10, -2) // 2 px from the edge, ~10 px from the vertex
    const r = findSnapPoint(...cursor, map, [corner])!
    expect(r).toMatchObject({ lnglat: C, isVertex: true })
  })

  it('returns null outside the threshold; the threshold is in screen px', () => {
    expect(findSnapPoint(...offset(map, v, 16, 0), map, [line])).toBeNull()
    expect(findSnapPoint(...offset(map, v, 16, 0), map, [line], 20)).toMatchObject({ isVertex: true })
  })

  it('skips excluded features', () => {
    const r = findSnapPoint(...offset(map, v, 3, 0), map, [line], 15, new Set(['line']))
    expect(r).toBeNull()
  })

  it('snaps to points, multipoints, polygon holes and every MultiPolygon part', () => {
    const hole = [offset(map, C, -20, -20), offset(map, C, 20, -20), offset(map, C, 20, 20), offset(map, C, -20, 20), offset(map, C, -20, -20)]
    const outer = [offset(map, C, -200, -200), offset(map, C, 200, -200), offset(map, C, 200, 200), offset(map, C, -200, 200), offset(map, C, -200, -200)]
    const poly = feat('poly', { type: 'Polygon', coordinates: [outer, hole] })
    expect(findSnapPoint(...offset(map, hole[1], -2, 3), map, [poly])).toMatchObject({ lnglat: hole[1], isVertex: true, featureId: 'poly' })

    const far = offset(map, C, 300, 300)
    const mp = feat('mp', { type: 'MultiPolygon', coordinates: [[outer], [[far, offset(map, far, 30, 0), offset(map, far, 0, 30), far]]] })
    expect(findSnapPoint(...offset(map, far, 1, 1), map, [mp])).toMatchObject({ lnglat: far, isVertex: true, featureId: 'mp' })

    const p = feat('p', { type: 'Point', coordinates: C })
    expect(findSnapPoint(...offset(map, C, 4, 4), map, [p])).toMatchObject({ lnglat: C, isVertex: true, featureId: 'p' })

    const mpt = feat('mpt', { type: 'MultiPoint', coordinates: [offset(map, C, -500, 0), far] })
    expect(findSnapPoint(...offset(map, far, -4, 0), map, [mpt])).toMatchObject({ lnglat: far, isVertex: true })
  })

  // A MultiPoint is separate points, not a line, so no edge runs between its positions.
  it('MultiPoint offers only its points: no edge snap between consecutive points', () => {
    const a = offset(map, C, -100, 0)
    const b = offset(map, C, 100, 0)
    const points = { type: 'MultiPoint' as const, coordinates: [a, b] }
    const mpt = feat('mpt', points)
    // Midpoint of a..b (and a few px off it) is 100 px from either point: no snap.
    expect(findSnapPoint(...C, map, [mpt])).toBeNull()
    expect(findSnapPoint(...offset(map, C, 20, 3), map, [mpt])).toBeNull()
    // Same feature without a bbox takes the exact path: still no edge.
    expect(findSnapPoint(...C, map, [feat('mpt', mpt.geometry, false)])).toBeNull()
    // Near a point it snaps to that point.
    expect(findSnapPoint(...offset(map, b, -3, 4), map, [mpt])).toMatchObject({ lnglat: b, isVertex: true, featureId: 'mpt' })
    // A MultiPoint inside a GeometryCollection behaves the same.
    const gc = feat('gc', { type: 'GeometryCollection', geometries: [points] })
    expect(findSnapPoint(...C, map, [gc])).toBeNull()
    // A LineString through the same positions still snaps to its edge.
    expect(findSnapPoint(...C, map, [feat('ls', { type: 'LineString', coordinates: [a, b] })])).toMatchObject({ isVertex: false })
  })

  it('picks the nearest of several features', () => {
    const a = feat('a', { type: 'Point', coordinates: offset(map, C, 8, 0) })
    const b = feat('b', { type: 'Point', coordinates: offset(map, C, -3, 0) })
    expect(findSnapPoint(...C, map, [a, b])!.featureId).toBe('b')
  })

  it('bbox culling never changes the answer at mid latitudes (vs no bbox), and only projects candidates near the cursor', () => {
    const m = fakeMap([10, 45], 15)
    const lines: GeoJSONFeature[] = []
    for (let i = 0; i < 200; i++) {
      const a = offset(m, [10, 45], (i * 37) % 800 - 400, (i * 53) % 600 - 300)
      lines.push(feat(`l${i}`, { type: 'LineString', coordinates: [a, offset(m, a, 25, 10), offset(m, a, 40, -20)] }))
    }
    const bare = lines.map((f) => ({ ...f, bbox: undefined }))
    let hits = 0, culledCost = 0, bareCost = 0
    for (let q = 0; q < 400; q++) {
      const cur = offset(m, [10, 45], (q * 29) % 800 - 400, (q * 41) % 600 - 300)
      let before = m.projections
      const culled = findSnapPoint(...cur, m, lines)
      culledCost += m.projections - before
      before = m.projections
      const exact = findSnapPoint(...cur, m, bare)
      bareCost += m.projections - before
      expect(culled).toEqual(exact)
      if (exact) hits++
    }
    expect(hits).toBeGreaterThan(10)
    expect(culledCost).toBeLessThanOrEqual(bareCost)
    // 200 features × 3 vertices × 400 queries would be 240k projections without the lng/lat box
    expect(bareCost).toBeLessThan(400 * 20)
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): at latitudes above ~60° MapLibre snapping misses edges/vertices that are within the pixel
  // threshold. The first bbox pre-filter (snapping.ts:45-47 + 134-142) converts the px threshold to
  // degrees with `metersPerPixel / 111320` using cos(centerLat) and 256-px tiles; for longitude that
  // is threshold·2·cos(lat) px, < threshold once cos(lat) < 0.5. The second, pixel-box check right
  // after it is already exact, so the first one can simply go. (The same bug was fixed in the Leaflet
  // adapter earlier.)
  it('snaps to an edge 12 px east of a vertical line at 70°N (Tromsø)', () => {
    const m = fakeMap([18.95, 70], 14)
    const top = offset(m, [18.95, 70], 0, -150)
    const bottom = offset(m, [18.95, 70], 0, 150)
    const f = feat('meridian', { type: 'LineString', coordinates: [top, bottom] })
    const cursor = offset(m, [18.95, 70], 12, 0)
    const r = findSnapPoint(...cursor, m, [f])
    expect(r).toMatchObject({ isVertex: false, featureId: 'meridian' })
  })

  it('the same 70°N snap works when the feature has no bbox (proves the pre-filter is the cause)', () => {
    const m = fakeMap([18.95, 70], 14)
    const f = feat('meridian', { type: 'LineString', coordinates: [offset(m, [18.95, 70], 0, -150), offset(m, [18.95, 70], 0, 150)] }, false)
    expect(findSnapPoint(...offset(m, [18.95, 70], 12, 0), m, [f])).toMatchObject({ isVertex: false, featureId: 'meridian' })
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): MultiLineString (and GeometryCollection) features are never snapped to: findSnapPoint
  // (snapping.ts:149-160) handles Point / MultiPoint / LineString / Polygon / MultiPolygon only.
  // Merging two lines (mergeFeatures) or importing a MultiLineString makes them unsnappable.
  it('snaps to a MultiLineString vertex', () => {
    const a = offset(map, C, 0, 0)
    const f = feat('mls', { type: 'MultiLineString', coordinates: [[a, offset(map, a, 100, 0)], [offset(map, a, 0, 100), offset(map, a, 100, 100)]] })
    expect(findSnapPoint(...offset(map, a, 3, 3), map, [f])).toMatchObject({ lnglat: a, isVertex: true })
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): see above — GeometryCollection members are not snapped to either.
  it('snaps to a vertex inside a GeometryCollection', () => {
    const f = feat('gc', { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: C }] })
    expect(findSnapPoint(...offset(map, C, 3, 3), map, [f])).toMatchObject({ lnglat: C, isVertex: true })
  })
})

describe('snapToAngle (MapLibre)', () => {
  const map = fakeMap(C, 15)

  it('rounds the screen angle to 15° steps and keeps the screen distance', () => {
    for (const [dx, dy] of [[100, 7], [100, 30], [-40, 90], [3, -200], [-120, -118]]) {
      const cursor = offset(map, C, dx, dy)
      const r = snapToAngle(map, C, cursor)
      const p0 = map.project(C), p1 = map.project(r)
      const ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI
      expect(Math.abs(ang / 15 - Math.round(ang / 15))).toBeLessThan(1e-6)
      expect(px(map, C, r)).toBeCloseTo(Math.hypot(dx, dy), 4)
      // never more than half a step away from the cursor direction
      const want = (Math.atan2(dy, dx) * 180) / Math.PI
      expect(Math.abs(((ang - want + 540) % 360) - 180)).toBeLessThanOrEqual(7.5 + 1e-9)
    }
  })

  it('a cursor within 1 px of the last point is returned unchanged', () => {
    const cursor = offset(map, C, 0.5, 0.3)
    expect(snapToAngle(map, C, cursor)).toBe(cursor)
  })

  it('honours a custom increment (45°)', () => {
    const r = snapToAngle(map, C, offset(map, C, 100, 30), 45)
    const p0 = map.project(C), p1 = map.project(r)
    expect(p1.y - p0.y).toBeCloseTo(0, 6)
  })
})
