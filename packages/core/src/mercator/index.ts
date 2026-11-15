import type { Feature, Geometry } from 'geojson'
import { mapCoordinates, mapPositions } from '../utils/positions'

/** Converts [lng, lat] degrees to Web Mercator projected units [x, y] */
export function project([lng, lat]: [number, number]): [number, number] {
  const clampedLat = Math.max(-89.9999, Math.min(89.9999, lat))
  const x = lng
  const y = Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360)) * (180 / Math.PI)
  return [x, y]
}

/** Converts Web Mercator projected units [x, y] back to [lng, lat] degrees */
export function unproject([x, y]: [number, number]): [number, number] {
  const lng = x
  const lat = (2 * Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 2) * (180 / Math.PI)
  return [lng, lat]
}

/** Converts degrees to radians. */
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Web Mercator east-west correction ratio at a latitude.
 * Clamped to avoid instability near the poles.
 */
export function getMercatorLatCorrectionRatio(lat: number, minRatio = 0.001): number {
  return Math.max(Math.abs(Math.cos(toRadians(lat))), minRatio)
}

export function applyVisualTransform(
  feature: Feature<Geometry>,
  centerPt: [number, number],
  scaleX: number,
  scaleY: number,
  angleDeg: number,
): Feature<Geometry> {
  const [cx, cy] = centerPt
  const angleRad = toRadians(angleDeg)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  const latRatio = getMercatorLatCorrectionRatio(cy)

  function transformCoord(coord: [number, number]): [number, number] {
    const dx = (coord[0] - cx) * latRatio
    const dy = coord[1] - cy

    const scaledDx = dx * scaleX
    const scaledDy = dy * scaleY

    const rx = scaledDx * cosA - scaledDy * sinA
    const ry = scaledDx * sinA + scaledDy * cosA

    return [cx + rx / latRatio, cy + ry]
  }

  // Every geometry type (GeometryCollection members too); altitude is kept.
  return { ...feature, geometry: mapPositions(feature.geometry, transformCoord) }
}

/** 
 * Visually translates a nested array of coordinates by a projected delta [dx, dy].
 * This preserves the shape's on-screen appearance (aspect ratio and size) on a 
 * Web Mercator map, preventing it from squishing or stretching near the poles.
 */
export function translateGeometryVisually<T extends unknown[]>(coords: T, dx: number, dy: number): T {
  return mapCoordinates(coords, (c) => {
    const [px, py] = project(c)
    return unproject([px + dx, py + dy])
  })
}
