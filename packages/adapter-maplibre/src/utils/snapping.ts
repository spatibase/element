import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GeoJSONFeature } from '@element-editor/core'

export interface SnapResult {
  lnglat: [number, number] // [lng, lat]
  isVertex: boolean
  /** Feature whose vertex/edge was snapped to. Absent for edge-only snaps when the feature can't be attributed. */
  featureId?: string
}

/**
 * Finds the closest snap point (vertex or edge) among all provided features.
 * MapLibre version: uses map.project([lng, lat]) for pixel conversion.
 *
 * Hot path (runs per mousemove frame): candidates are pre-rejected in lng/lat
 * against a box derived from the pixel threshold, so only vertices / segments
 * that could possibly be within `threshold` px get projected. Results are
 * identical to projecting everything.
 */
export function findSnapPoint(
  lng: number,
  lat: number,
  map: MapLibreMap,
  features: GeoJSONFeature[],
  threshold = 15,
  excludeFeatureIds: Set<string> = new Set(),
): SnapResult | null {
  // MapLibre: project takes [lng, lat] and returns {x, y}
  const p = map.project([lng, lat])
  const px = p.x
  const py = p.y

  let bestVertexDist = Infinity
  let bestVertexCoord: [number, number] | null = null
  let bestVertexFeatureId: string | null = null

  let bestEdgeDist = Infinity
  let bestEdgeX = 0
  let bestEdgeY = 0
  let hasEdge = false
  let bestEdgeFeatureId: string | null = null

  // Lng/lat box covering every point within `threshold` px of the cursor (+1px
  // slack for projection rounding). All four corners are unprojected so map
  // bearing / pitch are covered (a pixel square maps to a convex quad and
  // lng/lat are monotonic in Mercator x/y). Anything outside the box — or a
  // segment with both ends past the same side — can't snap, and is rejected
  // before the (allocating) map.project call.
  const pad = threshold + 1
  let boxW = Infinity, boxE = -Infinity, boxS = Infinity, boxN = -Infinity
  for (const [cx, cy] of [[px - pad, py - pad], [px + pad, py - pad], [px - pad, py + pad], [px + pad, py + pad]]) {
    const c = map.unproject([cx, cy])
    if (c.lng < boxW) boxW = c.lng
    if (c.lng > boxE) boxE = c.lng
    if (c.lat < boxS) boxS = c.lat
    if (c.lat > boxN) boxN = c.lat
  }

  let featureId = ''
  // `edges: false` scans the positions as separate points (MultiPoint): no
  // segments between consecutive positions, only vertex targets.
  function scanRing(ring: [number, number][], edges = true) {
    if (!ring || ring.length === 0) return
    // Projected point of ring[i], reused as the start of segment i..i+1.
    let prevIdx = -1
    let prevX = 0
    let prevY = 0

    for (let i = 0; i < ring.length; i++) {
      const c = ring[i]
      if (!(c[0] < boxW || c[0] > boxE || c[1] < boxS || c[1] > boxN)) {
        if (prevIdx !== i) {
          const pt = map.project(c)
          prevX = pt.x
          prevY = pt.y
          prevIdx = i
        }
        const d = Math.hypot(px - prevX, py - prevY)
        if (d < bestVertexDist) {
          bestVertexDist = d
          bestVertexCoord = c
          bestVertexFeatureId = featureId
        }
      }

      // Edge i..i+1; skip when both ends lie past the same box side.
      if (edges && i < ring.length - 1) {
        const n = ring[i + 1]
        if (
          (c[0] < boxW && n[0] < boxW) || (c[0] > boxE && n[0] > boxE) ||
          (c[1] < boxS && n[1] < boxS) || (c[1] > boxN && n[1] > boxN)
        ) continue
        if (prevIdx !== i) {
          const pt = map.project(c)
          prevX = pt.x
          prevY = pt.y
        }
        const vx = prevX
        const vy = prevY
        const w = map.project(n)
        prevIdx = i + 1
        prevX = w.x
        prevY = w.y

        // Distance from cursor to segment v..w (same maths as before, inlined).
        const l2 = (vx - w.x) ** 2 + (vy - w.y) ** 2
        let cx = vx
        let cy = vy
        if (l2 !== 0) {
          let t = ((px - vx) * (w.x - vx) + (py - vy) * (w.y - vy)) / l2
          t = Math.max(0, Math.min(1, t))
          cx = vx + t * (w.x - vx)
          cy = vy + t * (w.y - vy)
        }
        const distance = Math.hypot(px - cx, py - cy)
        if (distance < bestEdgeDist) {
          bestEdgeDist = distance
          bestEdgeX = cx
          bestEdgeY = cy
          hasEdge = true
          bestEdgeFeatureId = featureId
        }
      }
    }
  }

  // Every geometry type snaps (every renderer handles every type),
  // including MultiLineString parts and GeometryCollection members.
  function scanGeometry(geom: GeoJSONFeature['geometry']) {
    switch (geom.type) {
      case 'Point':
        scanRing([geom.coordinates as [number, number]])
        break
      case 'MultiPoint':
        // Points only: a MultiPoint has no edges to snap to.
        scanRing(geom.coordinates as [number, number][], false)
        break
      case 'LineString':
        scanRing(geom.coordinates as [number, number][])
        break
      case 'Polygon':
      case 'MultiLineString':
        for (const ring of geom.coordinates as [number, number][][]) scanRing(ring)
        break
      case 'MultiPolygon':
        for (const poly of geom.coordinates as [number, number][][][]) {
          for (const ring of poly) scanRing(ring)
        }
        break
      case 'GeometryCollection':
        for (const g of geom.geometries) scanGeometry(g)
        break
    }
  }

  for (const f of features) {
    if (excludeFeatureIds.has(f.id)) continue

    // BBox culling against the pixel-threshold box (exact: the box is unprojected
    // from pixels, so it is right at every latitude). Features without a cached
    // bbox take the exact checks.
    if (f.bbox) {
      const [w, s, e, n] = f.bbox
      if (e < boxW || w > boxE || n < boxS || s > boxN) continue
    }

    featureId = f.id
    scanGeometry(f.geometry)
  }

  if (bestVertexDist <= threshold && bestVertexCoord) {
    return {
      lnglat: bestVertexCoord,
      isVertex: true,
      featureId: bestVertexFeatureId ?? undefined,
    }
  }

  if (bestEdgeDist <= threshold && hasEdge) {
    const lngLat = map.unproject([bestEdgeX, bestEdgeY] as [number, number])
    return {
      lnglat: [lngLat.lng, lngLat.lat],
      isVertex: false,
      featureId: bestEdgeFeatureId ?? undefined,
    }
  }

  return null
}

/**
 * Snaps a cursor coordinate to 15-degree increments relative to the last point.
 * MapLibre version: map.project([lng, lat]) / map.unproject([x, y]).
 */
export function snapToAngle(
  map: MapLibreMap,
  lastCoord: [number, number], // [lng, lat]
  cursorCoord: [number, number], // [lng, lat]
  incrementDeg = 15,
): [number, number] {
  const p1 = map.project(lastCoord)
  const p2 = map.project(cursorCoord)

  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const distance = Math.hypot(dx, dy)

  if (distance < 1) return cursorCoord

  const angle = Math.atan2(dy, dx)
  const incrementRad = (incrementDeg * Math.PI) / 180
  const snappedAngle = Math.round(angle / incrementRad) * incrementRad

  const newX = p1.x + distance * Math.cos(snappedAngle)
  const newY = p1.y + distance * Math.sin(snappedAngle)

  const newLngLat = map.unproject([newX, newY] as [number, number])
  return [newLngLat.lng, newLngLat.lat]
}
