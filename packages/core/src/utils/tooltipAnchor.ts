import area from '@turf/area'
import along from '@turf/along'
import length from '@turf/length'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import pointOnFeature from '@turf/point-on-feature'
import { lineString, polygon, point } from '@turf/helpers'
import type { Position } from 'geojson'
import type { GeoJSONFeature, Geometry } from '../types/geojson'

/** Where a hover tooltip anchors on a feature, in lng/lat. */
export interface TooltipAnchor {
  /** `point`: the feature's own marker (the adapter offsets by the marker's height). `line`/`area`: a spot on the shape. */
  kind: 'point' | 'line' | 'area'
  lngLat: [number, number]
}

type Part =
  | { kind: 'point'; coords: Position }
  | { kind: 'line'; coords: Position[] }
  | { kind: 'area'; rings: Position[][] }

function collectParts(g: Geometry | null | undefined, out: Part[]) {
  if (!g) return
  switch (g.type) {
    case 'Point': out.push({ kind: 'point', coords: g.coordinates }); break
    case 'MultiPoint': for (const c of g.coordinates) out.push({ kind: 'point', coords: c }); break
    case 'LineString': out.push({ kind: 'line', coords: g.coordinates }); break
    case 'MultiLineString': for (const c of g.coordinates) out.push({ kind: 'line', coords: c }); break
    case 'Polygon': out.push({ kind: 'area', rings: g.coordinates }); break
    case 'MultiPolygon': for (const rings of g.coordinates) out.push({ kind: 'area', rings }); break
    case 'GeometryCollection': for (const m of g.geometries) collectParts(m, out); break
  }
}

/** Squared planar distance (in degrees) from `p` to segment `a`-`b`. Only used to rank parts. */
function segDist2(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]
  return x * x + y * y
}

function ringDist2(p: Position, ring: Position[]): number {
  let d = Infinity
  for (let i = 1; i < ring.length; i++) d = Math.min(d, segDist2(p, ring[i - 1], ring[i]))
  return d
}

function partDist2(part: Part, hit: Position): number {
  if (part.kind === 'point') return (part.coords[0] - hit[0]) ** 2 + (part.coords[1] - hit[1]) ** 2
  if (part.kind === 'line') return ringDist2(hit, part.coords)
  if (booleanPointInPolygon(point(hit), polygon(part.rings))) return 0
  return Math.min(...part.rings.map((r) => ringDist2(hit, r)))
}

function partSize(part: Part): number {
  if (part.kind === 'point') return 0
  if (part.kind === 'line') return part.coords.length > 1 ? length(lineString(part.coords)) : 0
  return area(polygon(part.rings))
}

/**
 * The spot a hover tooltip anchors to. Points: the point itself. Lines: halfway along their
 * length. Areas: a point guaranteed inside the shape (a C-shape's centroid can fall outside).
 * Multi-part and collection features use the part under `hit` (a lng/lat) when given, else the
 * largest one. Compute it once per hover, not per mouse move.
 */
export function tooltipAnchor(feature: Pick<GeoJSONFeature, 'geometry'>, hit?: [number, number] | null): TooltipAnchor | null {
  const parts: Part[] = []
  collectParts(feature.geometry as unknown as Geometry, parts)
  if (parts.length === 0) return null
  let best = parts[0]
  if (parts.length > 1) {
    if (hit) {
      let bestD = Infinity
      for (const p of parts) { const d = partDist2(p, hit); if (d < bestD) { bestD = d; best = p } }
    } else {
      let bestS = -1
      for (const p of parts) { const s = partSize(p); if (s > bestS) { bestS = s; best = p } }
    }
  }
  if (best.kind === 'point') return { kind: 'point', lngLat: [best.coords[0], best.coords[1]] }
  if (best.kind === 'line') {
    if (best.coords.length < 2) return { kind: 'line', lngLat: [best.coords[0][0], best.coords[0][1]] }
    const line = lineString(best.coords)
    const c = along(line, length(line) / 2).geometry.coordinates
    return { kind: 'line', lngLat: [c[0], c[1]] }
  }
  const c = pointOnFeature(polygon(best.rings)).geometry.coordinates
  return { kind: 'area', lngLat: [c[0], c[1]] }
}
