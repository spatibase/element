import type { Geometry } from '../types/geojson'

/**
 * Geometry types the Simplify / Smooth / Buffer tools accept. One predicate for
 * every entry point (editing toolbar, map context menu, panels, preview layers)
 * so they can't drift apart.
 */
export function canProcessShape(type: string | null | undefined): boolean {
  return type === 'Polygon' || type === 'MultiPolygon' || type === 'LineString' || type === 'MultiLineString'
}

/** `LineString` / `MultiLineString`: open paths (Smooth keeps them open, Buffer turns them into polygons). */
export function isLineGeometryType(type: string | null | undefined): boolean {
  return type === 'LineString' || type === 'MultiLineString'
}

/**
 * Vertex count shown in the Simplify / Smooth panels. Polygon rings don't count
 * their closing point twice; lines count every point. Other types → 0.
 */
export function countShapeVertices(geom: Geometry): number {
  switch (geom.type) {
    case 'LineString': return geom.coordinates.length
    case 'MultiLineString': return geom.coordinates.reduce((s, l) => s + l.length, 0)
    case 'Polygon': return geom.coordinates.reduce((s, r) => s + r.length - 1, 0)
    case 'MultiPolygon': return geom.coordinates.reduce((s, p) => s + p.reduce((ps, r) => ps + r.length - 1, 0), 0)
    default: return 0
  }
}
