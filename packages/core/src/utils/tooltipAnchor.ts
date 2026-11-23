import area from '@turf/area'
import along from '@turf/along'
import length from '@turf/length'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
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
  return { kind: 'area', lngLat: pointInside(best.rings) }
}

/** Area centroid (shoelace) of the outer ring. */
function centroid(ring: Position[]): [number, number] {
  let a = 0, cx = 0, cy = 0
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1], [x1, y1] = ring[i]
    const f = x0 * y1 - x1 * y0
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : [ring[0][0], ring[0][1]]
}

/** The middle of the widest stretch of the shape along the horizontal line `y` (even-odd over every ring), or null. */
function widestSpan(rings: Position[][], y: number): [number, number] | null {
  const xs: number[] = []
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1], [x1, y1] = ring[i]
      if ((y0 <= y) !== (y1 <= y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
    }
  }
  xs.sort((a, b) => a - b)
  let best: [number, number] | null = null, bestW = 0
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1] - xs[i]
    if (w > bestW) { bestW = w; best = [(xs[i] + xs[i + 1]) / 2, y] }
  }
  return best
}

/**
 * A point strictly inside the polygon: its centroid when that is inside, else (C and L shapes,
 * rings with holes) the middle of the widest horizontal stretch through the centroid's height.
 */
function pointInside(rings: Position[][]): [number, number] {
  const c = centroid(rings[0])
  const poly = polygon(rings)
  if (booleanPointInPolygon(point(c), poly, { ignoreBoundary: true })) return c
  // A plain loop: spreading a very large ring into Math.min/max throws a RangeError.
  let lo = Infinity, hi = -Infinity
  for (const p of rings[0]) {
    if (p[1] < lo) lo = p[1]
    if (p[1] > hi) hi = p[1]
  }
  for (const f of [c[1], (lo + hi) / 2, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75]) {
    const span = widestSpan(rings, f)
    if (span) return span
  }
  return [rings[0][0][0], rings[0][0][1]]
}
