/**
 * Leaflet snapping (src/utils/snapping.ts) against a fake map that implements Leaflet's EPSG:3857
 * pixel maths (256 px tiles) for latLngToLayerPoint / layerPointToLatLng / container points.
 */
import { describe, it, expect } from 'vitest'
import type { Map as LeafletMap } from 'leaflet'
import type { GeoJSONFeature, Geometry } from '@element-editor/core'
import { findSnapPoint, snapToAngle } from '../src/utils/snapping'

type LngLat = [number, number]
type Pt = { x: number; y: number }

function fakeMap(center: LngLat, zoom: number) {
  const world = 256 * 2 ** zoom
  const mx = (lng: number) => ((lng + 180) / 360) * world
  const my = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180)
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world
  }
  const ox = mx(center[0]) - 400, oy = my(center[1]) - 300
  const toLatLng = (p: [number, number] | Pt) => {
    const [x, y] = Array.isArray(p) ? p : [p.x, p.y]
    const wx = x + ox, wy = y + oy
    const n = Math.PI - (2 * Math.PI * wy) / world
    return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: (wx / world) * 360 - 180 }
  }
  const toPoint = (ll: [number, number] | { lat: number; lng: number }): Pt => {
    const [lat, lng] = Array.isArray(ll) ? ll : [ll.lat, ll.lng]
    return { x: mx(lng) - ox, y: my(lat) - oy }
  }
  return {
    latLngToLayerPoint: toPoint,
    layerPointToLatLng: toLatLng,
    latLngToContainerPoint: toPoint,
    containerPointToLatLng: toLatLng,
  } as unknown as LeafletMap
}

/** The lng/lat `dx, dy` screen px away from `ll`. */
function offset(map: LeafletMap, ll: LngLat, dx: number, dy: number): LngLat {
  const p = map.latLngToLayerPoint([ll[1], ll[0]])
  const r = map.layerPointToLatLng([p.x + dx, p.y + dy])
  return [r.lng, r.lat]
}
const proj = (map: LeafletMap, ll: LngLat) => map.latLngToLayerPoint([ll[1], ll[0]])

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

describe('findSnapPoint (Leaflet)', () => {
  const map = fakeMap(C, 17)
  const v = offset(map, C, 40, 0)
  const w = offset(map, C, 40, 200)
  const line = feat('line', { type: 'LineString', coordinates: [v, w] })

  it('snaps to a vertex within the threshold and returns its exact coordinates', () => {
    expect(findSnapPoint(...offset(map, v, -5, 6), map, [line])).toEqual({ latlng: v, isVertex: true })
  })

  it('snaps to the foot of the perpendicular on an edge', () => {
    const cursor = offset(map, C, 52, 120)
    const r = findSnapPoint(...cursor, map, [line])!
    expect(r.isVertex).toBe(false)
    expect(proj(map, r.latlng).x).toBeCloseTo(proj(map, v).x, 6)
    expect(proj(map, r.latlng).y).toBeCloseTo(proj(map, cursor).y, 6)
  })

  it('prefers a vertex over a closer edge when both are within the threshold', () => {
    const corner = feat('corner', { type: 'LineString', coordinates: [offset(map, C, -100, 0), C, offset(map, C, 0, -100)] })
    expect(findSnapPoint(...offset(map, C, 10, -2), map, [corner])).toEqual({ latlng: C, isVertex: true })
  })

  it('null beyond the threshold; custom threshold; excluded ids are ignored', () => {
    expect(findSnapPoint(...offset(map, v, 16, 0), map, [line])).toBeNull()
    expect(findSnapPoint(...offset(map, v, 16, 0), map, [line], 20)).toMatchObject({ isVertex: true })
    expect(findSnapPoint(...offset(map, v, 2, 0), map, [line], 15, new Set(['line']))).toBeNull()
  })

  it('snaps to polygon holes, MultiPolygon parts, points and multipoints', () => {
    const ring = (o: LngLat, s: number) => [o, offset(map, o, s, 0), offset(map, o, s, s), offset(map, o, 0, s), o]
    const poly = feat('poly', { type: 'Polygon', coordinates: [ring(offset(map, C, -200, -200), 400), ring(offset(map, C, -10, -10), 20)] })
    const holeCorner = offset(map, C, -10, -10)
    expect(findSnapPoint(...offset(map, holeCorner, 2, -2), map, [poly])).toMatchObject({ isVertex: true })
    expect(findSnapPoint(...offset(map, holeCorner, 2, -2), map, [poly])!.latlng[0]).toBeCloseTo(holeCorner[0], 12)

    const far = offset(map, C, 300, 300)
    const mp = feat('mp', { type: 'MultiPolygon', coordinates: [[ring(C, 50)], [ring(far, 30)]] })
    expect(findSnapPoint(...offset(map, far, 1, 1), map, [mp])).toEqual({ latlng: far, isVertex: true })

    expect(findSnapPoint(...offset(map, C, 4, 4), map, [feat('p', { type: 'Point', coordinates: C })])).toEqual({ latlng: C, isVertex: true })
    const mpt = feat('mpt', { type: 'MultiPoint', coordinates: [offset(map, C, -500, 0), far] })
    expect(findSnapPoint(...offset(map, far, -4, 0), map, [mpt])).toEqual({ latlng: far, isVertex: true })
  })

  it('bbox culling never changes the answer, including at 70°N and 78°N (the fixed high-latitude cull bug)', () => {
    for (const [center, zoom] of [[[10, 45], 15], [[18.95, 70], 14], [[15.6, 78.2], 16]] as Array<[LngLat, number]>) {
      const m = fakeMap(center, zoom)
      const feats: GeoJSONFeature[] = []
      for (let i = 0; i < 150; i++) {
        const a = offset(m, center, (i * 37) % 800 - 400, (i * 53) % 600 - 300)
        feats.push(feat(`l${i}`, { type: 'LineString', coordinates: [a, offset(m, a, 0, 40), offset(m, a, 30, 60)] }))
      }
      const bare = feats.map((f) => ({ ...f, bbox: undefined }))
      let hits = 0
      for (let q = 0; q < 400; q++) {
        const cur = offset(m, center, (q * 29) % 800 - 400, (q * 41) % 600 - 300)
        const culled = findSnapPoint(...cur, m, feats)
        expect(culled).toEqual(findSnapPoint(...cur, m, bare))
        if (culled) hits++
      }
      expect(hits).toBeGreaterThan(10)
    }
  })

  it('a vertical line 12 px west of the cursor at 70°N snaps (regression)', () => {
    const m = fakeMap([18.95, 70], 14)
    const f = feat('meridian', { type: 'LineString', coordinates: [offset(m, [18.95, 70], 0, -150), offset(m, [18.95, 70], 0, 150)] })
    expect(findSnapPoint(...offset(m, [18.95, 70], 12, 0), m, [f])).toMatchObject({ isVertex: false })
  })

  // A MultiPoint is separate points, not a line, so no edge runs between its positions.
  it('MultiPoint offers only its points: no edge snap between consecutive points', () => {
    const a = offset(map, C, -100, 0), b = offset(map, C, 100, 0)
    const points = { type: 'MultiPoint' as const, coordinates: [a, b] }
    const mpt = feat('mpt', points)
    // Midpoint of a..b (and a few px off it) is 100 px from either point: no snap.
    expect(findSnapPoint(...C, map, [mpt])).toBeNull()
    expect(findSnapPoint(...offset(map, C, 20, 3), map, [mpt])).toBeNull()
    // Same feature without a bbox takes the exact path: still no edge.
    expect(findSnapPoint(...C, map, [feat('mpt', mpt.geometry, false)])).toBeNull()
    // Near a point it snaps to that point.
    expect(findSnapPoint(...offset(map, b, -3, 4), map, [mpt])).toEqual({ latlng: b, isVertex: true })
    // A MultiPoint inside a GeometryCollection behaves the same.
    const gc = feat('gc', { type: 'GeometryCollection', geometries: [points] })
    expect(findSnapPoint(...C, map, [gc])).toBeNull()
    // A LineString through the same positions still snaps to its edge.
    expect(findSnapPoint(...C, map, [feat('ls', { type: 'LineString', coordinates: [a, b] })])).toMatchObject({ isVertex: false })
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): MultiLineString and GeometryCollection features are never snapped to: findSnapPoint
  // (adapter-leaflet snapping.ts:120-131) handles Point / MultiPoint / LineString / Polygon /
  // MultiPolygon only. Same gap in adapter-maplibre.
  it('snaps to a MultiLineString vertex', () => {
    const f = feat('mls', { type: 'MultiLineString', coordinates: [[C, offset(map, C, 100, 0)], [offset(map, C, 0, 100), offset(map, C, 100, 100)]] })
    expect(findSnapPoint(...offset(map, C, 3, 3), map, [f])).toEqual({ latlng: C, isVertex: true })
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): see above.
  it('snaps to a vertex inside a GeometryCollection', () => {
    const f = feat('gc', { type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [C, offset(map, C, 100, 0)] }] })
    expect(findSnapPoint(...offset(map, C, 3, 3), map, [f])).toEqual({ latlng: C, isVertex: true })
  })
})

describe('snapToAngle (Leaflet)', () => {
  const map = fakeMap(C, 16)

  it('rounds the screen angle to 15° steps and keeps the screen distance', () => {
    for (const [dx, dy] of [[100, 7], [100, 30], [-40, 90], [3, -200], [-120, -118]]) {
      const r = snapToAngle(map, C, offset(map, C, dx, dy))
      const p0 = proj(map, C), p1 = proj(map, r)
      const ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI
      expect(Math.abs(ang / 15 - Math.round(ang / 15))).toBeLessThan(1e-6)
      expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(Math.hypot(dx, dy), 4)
    }
  })

  it('a cursor within 1 px of the last point is returned unchanged', () => {
    const cursor = offset(map, C, 0.4, 0.4)
    expect(snapToAngle(map, C, cursor)).toBe(cursor)
  })
})
