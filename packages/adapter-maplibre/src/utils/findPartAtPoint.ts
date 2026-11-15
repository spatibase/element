/**
 * Given a Multi* / GeometryCollection feature and a click lng/lat, return the
 * part index that contains (or is closest to) the click. Returns null for
 * simple geometries or when no part matches.
 */
import type { Geometry } from '@element-editor/core'
import { getPartCount, getPartGeometry, isMultiGeometry } from '@element-editor/core/internal'

/** Ray-casting point-in-ring test. */
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  const [x, y] = pt
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-20) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(pt: [number, number], coords: [number, number][][]): boolean {
  if (coords.length === 0 || !pointInRing(pt, coords[0])) return false
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(pt, coords[i])) return false // hole
  }
  return true
}

function sqDistPointToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) {
    const ddx = p[0] - a[0]
    const ddy = p[1] - a[1]
    return ddx * ddx + ddy * ddy
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  const projx = a[0] + t * dx
  const projy = a[1] + t * dy
  const ddx = p[0] - projx
  const ddy = p[1] - projy
  return ddx * ddx + ddy * ddy
}

function minDistToLineString(pt: [number, number], line: [number, number][]): number {
  let min = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const d = sqDistPointToSegment(pt, line[i], line[i + 1])
    if (d < min) min = d
  }
  return min
}

export function findPartAtPoint(
  geometry: Geometry,
  clickLngLat: [number, number],
): number | null {
  if (!isMultiGeometry(geometry)) return null
  const n = getPartCount(geometry)
  if (n === 0) return null

  // For MultiPolygon / GeometryCollection-polygons: exact containment test wins.
  if (geometry.type === 'MultiPolygon') {
    for (let i = 0; i < n; i++) {
      if (pointInPolygon(clickLngLat, (geometry.coordinates as [number, number][][][])[i])) {
        return i
      }
    }
    // Fall back to nearest polygon outline — rare but covers edge-of-ring clicks.
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < n; i++) {
      const d = minDistToLineString(clickLngLat, (geometry.coordinates as [number, number][][][])[i][0])
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  if (geometry.type === 'MultiLineString') {
    let best = 0
    let bestDist = Infinity
    const lines = geometry.coordinates as [number, number][][]
    for (let i = 0; i < n; i++) {
      const d = minDistToLineString(clickLngLat, lines[i])
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  if (geometry.type === 'MultiPoint') {
    let best = 0
    let bestDist = Infinity
    const pts = geometry.coordinates as [number, number][]
    for (let i = 0; i < n; i++) {
      const dx = clickLngLat[0] - pts[i][0]
      const dy = clickLngLat[1] - pts[i][1]
      const d = dx * dx + dy * dy
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  if (geometry.type === 'GeometryCollection') {
    // First try parts containing the click (polygons); otherwise nearest.
    for (let i = 0; i < n; i++) {
      const part = getPartGeometry(geometry, i)
      if (part.type === 'Polygon') {
        if (pointInPolygon(clickLngLat, part.coordinates as [number, number][][])) return i
      }
    }
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < n; i++) {
      const part = getPartGeometry(geometry, i)
      let d = Infinity
      if (part.type === 'Point') {
        const dx = clickLngLat[0] - part.coordinates[0]
        const dy = clickLngLat[1] - part.coordinates[1]
        d = dx * dx + dy * dy
      } else if (part.type === 'LineString') {
        d = minDistToLineString(clickLngLat, part.coordinates as [number, number][])
      } else if (part.type === 'Polygon') {
        d = minDistToLineString(clickLngLat, (part.coordinates as [number, number][][])[0])
      }
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  return null
}
