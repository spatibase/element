import type { Map as LeafletMap } from 'leaflet'
import type { GeoJSONFeature } from '@element-editor/core'

interface Point { x: number; y: number }

function dist(p1: Point, p2: Point) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y)
}

function distToSegment(p: Point, v: Point, w: Point): { distance: number; closest: Point } {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
  if (l2 === 0) return { distance: dist(p, v), closest: v }
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  const closest = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) }
  return { distance: dist(p, closest), closest }
}

export interface SnapResult {
  latlng: [number, number] // [lng, lat] to match GeoJSON standard throughout the app
  isVertex: boolean
}

/**
 * Finds the closest snap point (vertex or edge) among all provided features.
 * Priority is given to vertices over edges if both are within the threshold.
 * 
 * @param lng target longitude
 * @param lat target latitude
 * @param map Leaflet map instance (for pixel conversions)
 * @param features All features to snap against
 * @param threshold Pixel distance threshold for snapping
 * @param excludeFeatureIds Feature IDs to ignore (e.g. the one being dragged)
 */
export function findSnapPoint(
  lng: number,
  lat: number,
  map: LeafletMap,
  features: GeoJSONFeature[],
  threshold = 15,
  excludeFeatureIds: Set<string> = new Set()
): SnapResult | null {
  // map.latLngToLayerPoint needs [lat, lng]
  const p = map.latLngToLayerPoint([lat, lng])
  
  let bestVertexDist = Infinity
  let bestVertexCoord: [number, number] | null = null
  
  let bestEdgeDist = Infinity
  let bestEdgePoint: Point | null = null

  // Lng/lat box covering every point within `threshold` px of the cursor (+1px
  // slack for projection rounding). Mercator is monotonic per axis, so anything
  // outside it — or a segment with both ends past the same side — can't snap,
  // and is rejected before the (allocating) latLngToLayerPoint projection.
  const pad = threshold + 1
  const c1 = map.layerPointToLatLng([p.x - pad, p.y - pad])
  const c2 = map.layerPointToLatLng([p.x + pad, p.y + pad])
  const boxW = Math.min(c1.lng, c2.lng)
  const boxE = Math.max(c1.lng, c2.lng)
  const boxS = Math.min(c1.lat, c2.lat)
  const boxN = Math.max(c1.lat, c2.lat)
  const outside = (c: [number, number]) =>
    c[0] < boxW || c[0] > boxE || c[1] < boxS || c[1] > boxN

  // `edges: false` scans the positions as separate points (MultiPoint): no
  // segments between consecutive positions, only vertex targets.
  function scanRing(ring: [number, number][], edges = true) {
    if (!ring || ring.length === 0) return
    // Projects lazily; the previous vertex's point is reused for the next segment.
    let prevIdx = -1
    let prevPt: Point | null = null
    const project = (i: number): Point => {
      if (i === prevIdx) return prevPt!
      const c = ring[i]
      return map.latLngToLayerPoint([c[1], c[0]])
    }

    for (let i = 0; i < ring.length; i++) {
      const c = ring[i]
      const cOut = outside(c)
      let pt: Point | null = null
      if (!cOut) {
        pt = project(i)
        const d = dist(p, pt)
        if (d < bestVertexDist) {
          bestVertexDist = d
          bestVertexCoord = c // return exact [lng, lat]
        }
      }

      // Edge i..i+1 (only if > 1 vertex); skip when both ends lie past the same box side
      if (edges && i < ring.length - 1) {
        const n = ring[i + 1]
        if (
          (c[0] < boxW && n[0] < boxW) || (c[0] > boxE && n[0] > boxE) ||
          (c[1] < boxS && n[1] < boxS) || (c[1] > boxN && n[1] > boxN)
        ) continue
        const v = pt ?? project(i)
        const w = map.latLngToLayerPoint([n[1], n[0]])
        prevIdx = i + 1
        prevPt = w
        const { distance, closest } = distToSegment(p, v, w)
        if (distance < bestEdgeDist) {
          bestEdgeDist = distance
          bestEdgePoint = closest
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
    
    // BBox culling: a feature whose bbox misses the snap box has no vertex or
    // edge within reach. Features without a cached bbox take the exact checks.
    if (f.bbox) {
      const [w, s, e, n] = f.bbox
      if (e < boxW || w > boxE || n < boxS || s > boxN) continue
    }

    scanGeometry(f.geometry)
  }

  // Always prefer a vertex over an edge if within threshold
  if (bestVertexDist <= threshold && bestVertexCoord) {
    return { latlng: bestVertexCoord, isVertex: true }
  }

  if (bestEdgeDist <= threshold && bestEdgePoint) {
    const unprojected = map.layerPointToLatLng(bestEdgePoint as L.PointExpression)
    return { latlng: [unprojected.lng, unprojected.lat], isVertex: false }
  }

  return null
}

/**
 * Snaps a cursor coordinate to a 15-degree increment relative to the last point.
 * Uses screen pixels for visual accuracy in vector editors.
 */
export function snapToAngle(
  map: LeafletMap,
  lastCoord: [number, number], // [lng, lat]
  cursorCoord: [number, number], // [lng, lat]
  incrementDeg = 15
): [number, number] {
  const p1 = map.latLngToContainerPoint([lastCoord[1], lastCoord[0]])
  const p2 = map.latLngToContainerPoint([cursorCoord[1], cursorCoord[0]])

  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const distance = Math.hypot(dx, dy)
  
  if (distance < 1) return cursorCoord

  const angle = Math.atan2(dy, dx)
  const incrementRad = (incrementDeg * Math.PI) / 180
  const snappedAngle = Math.round(angle / incrementRad) * incrementRad

  const newX = p1.x + distance * Math.cos(snappedAngle)
  const newY = p1.y + distance * Math.sin(snappedAngle)

  const newLatLng = map.containerPointToLatLng([newX, newY])
  return [newLatLng.lng, newLatLng.lat]
}
