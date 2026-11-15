import type { GeoJSONFeature, Geometry, SimpleGeometry, PointGeometry, MultiPointGeometry, LineStringGeometry, MultiLineStringGeometry, PolygonGeometry, MultiPolygonGeometry, GeometryCollectionGeometry } from '../types/geojson'
import { getGeometryBBox } from './geojson'
import { translateGeometryVisually } from '../mercator'
import { withXY } from './positions'

/** Returns true if the geometry is a Multi* or GeometryCollection type. */
export function isMultiGeometry(geometry: Geometry): boolean {
  return geometry.type === 'MultiPoint' || geometry.type === 'MultiLineString' ||
    geometry.type === 'MultiPolygon' || geometry.type === 'GeometryCollection'
}

/** Returns the number of parts in a Multi* or GeometryCollection geometry. Returns 1 for simple geometries. */
export function getPartCount(geometry: Geometry): number {
  if (geometry.type === 'GeometryCollection') return geometry.geometries.length
  if (geometry.type === 'MultiPoint') return geometry.coordinates.length
  if (geometry.type === 'MultiLineString') return geometry.coordinates.length
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.length
  return 1
}

/** Extracts a single part's geometry from a Multi* or GeometryCollection. */
export function getPartGeometry(geometry: Geometry, index: number): SimpleGeometry {
  if (geometry.type === 'MultiPoint') {
    return { type: 'Point', coordinates: geometry.coordinates[index] }
  }
  if (geometry.type === 'MultiLineString') {
    return { type: 'LineString', coordinates: geometry.coordinates[index] }
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates[index] }
  }
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries[index]
  }
  // Simple geometry — return as-is (only valid for index 0)
  return geometry as SimpleGeometry
}

/** Returns a new parent geometry with one part replaced. */
export function setPartGeometry(parentGeometry: Geometry, index: number, partGeometry: SimpleGeometry): Geometry {
  if (parentGeometry.type === 'MultiPoint' && partGeometry.type === 'Point') {
    const coords = [...parentGeometry.coordinates]
    coords[index] = partGeometry.coordinates
    return { type: 'MultiPoint', coordinates: coords }
  }
  if (parentGeometry.type === 'MultiLineString' && partGeometry.type === 'LineString') {
    const coords = [...parentGeometry.coordinates]
    coords[index] = partGeometry.coordinates
    return { type: 'MultiLineString', coordinates: coords }
  }
  if (parentGeometry.type === 'MultiPolygon' && partGeometry.type === 'Polygon') {
    const coords = [...parentGeometry.coordinates]
    coords[index] = partGeometry.coordinates
    return { type: 'MultiPolygon', coordinates: coords }
  }
  if (parentGeometry.type === 'GeometryCollection') {
    const geometries = [...parentGeometry.geometries]
    geometries[index] = partGeometry
    return { type: 'GeometryCollection', geometries }
  }
  return partGeometry
}

/** Returns the bbox for a single part of a Multi* or GeometryCollection geometry. */
export function getPartBBox(geometry: Geometry, index: number): [number, number, number, number] {
  return getGeometryBBox(getPartGeometry(geometry, index))
}

/** Returns a label for a part within a Multi* or GeometryCollection. */
export function getPartLabel(geometry: Geometry, index: number): string {
  if (geometry.type === 'MultiPoint') return `Point ${index + 1}`
  if (geometry.type === 'MultiLineString') return `Line ${index + 1}`
  if (geometry.type === 'MultiPolygon') return `Polygon ${index + 1}`
  if (geometry.type === 'GeometryCollection') {
    const partType = geometry.geometries[index].type
    if (partType === 'Point') return `Point ${index + 1}`
    if (partType === 'LineString') return `Line ${index + 1}`
    if (partType === 'Polygon') return `Polygon ${index + 1}`
    if (partType === 'MultiPoint') return `MultiPoint ${index + 1}`
    if (partType === 'MultiLineString') return `MultiLine ${index + 1}`
    if (partType === 'MultiPolygon') return `MultiPolygon ${index + 1}`
  }
  return `Part ${index + 1}`
}

/**
 * Determines the base geometry type category for a feature.
 * Returns 'point', 'line', 'polygon', or 'mixed' for GeometryCollection.
 */
export function getBaseGeometryCategory(geometry: Geometry): 'point' | 'line' | 'polygon' | 'mixed' {
  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      return 'point'
    case 'LineString':
    case 'MultiLineString':
      return 'line'
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon'
    case 'GeometryCollection':
      return 'mixed'
  }
}

/**
 * Merges multiple features into a single Multi* or GeometryCollection feature.
 * If all features share the same base type, creates the corresponding Multi* type.
 * If mixed, creates a GeometryCollection.
 */
export function mergeGeometries(features: GeoJSONFeature[]): Geometry {
  if (features.length === 0) throw new Error('Cannot merge zero features')

  const categories = features.map(f => getBaseGeometryCategory(f.geometry))
  const allSame = categories.every(c => c === categories[0]) && categories[0] !== 'mixed'

  if (allSame) {
    const category = categories[0]
    if (category === 'point') {
      const coordinates: [number, number][] = []
      for (const f of features) {
        if (f.geometry.type === 'Point') coordinates.push(f.geometry.coordinates)
        else if (f.geometry.type === 'MultiPoint') coordinates.push(...f.geometry.coordinates)
      }
      return { type: 'MultiPoint', coordinates }
    }
    if (category === 'line') {
      const coordinates: [number, number][][] = []
      for (const f of features) {
        if (f.geometry.type === 'LineString') coordinates.push(f.geometry.coordinates)
        else if (f.geometry.type === 'MultiLineString') coordinates.push(...f.geometry.coordinates)
      }
      return { type: 'MultiLineString', coordinates }
    }
    if (category === 'polygon') {
      const coordinates: [number, number][][][] = []
      for (const f of features) {
        if (f.geometry.type === 'Polygon') coordinates.push(f.geometry.coordinates)
        else if (f.geometry.type === 'MultiPolygon') coordinates.push(...f.geometry.coordinates)
      }
      return { type: 'MultiPolygon', coordinates }
    }
  }

  // Mixed types or includes GeometryCollection → create GeometryCollection
  const geometries: SimpleGeometry[] = []
  for (const f of features) {
    if (f.geometry.type === 'GeometryCollection') {
      geometries.push(...f.geometry.geometries)
    } else {
      geometries.push(f.geometry as SimpleGeometry)
    }
  }
  return { type: 'GeometryCollection', geometries }
}

/**
 * Returns true if the geometry supports vertex editing.
 * Simple LineString/Polygon can always be vertex-edited.
 * Multi* and GeometryCollection require a selected part index.
 */
export function canVertexEdit(geometry: Geometry, selectedPartIndex: number | null): boolean {
  if (geometry.type === 'LineString' || geometry.type === 'Polygon') return true
  if ((geometry.type === 'MultiPolygon' || geometry.type === 'MultiLineString' || geometry.type === 'GeometryCollection') && selectedPartIndex != null) return true
  return false
}

/** Returns a reference latitude from the first coordinate of any geometry (for Mercator correction). */
export function getRefLat(geometry: Geometry): number {
  if (geometry.type === 'Point') return geometry.coordinates[1]
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) return geometry.coordinates[0][1]
  if (geometry.type === 'LineString' && geometry.coordinates.length > 0) return geometry.coordinates[0][1]
  if (geometry.type === 'MultiLineString' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0) return geometry.coordinates[0][0][1]
  if (geometry.type === 'Polygon' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0) return geometry.coordinates[0][0][1]
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0 && geometry.coordinates[0][0].length > 0) return geometry.coordinates[0][0][0][1]
  if (geometry.type === 'GeometryCollection' && geometry.geometries.length > 0) return getRefLat(geometry.geometries[0])
  return 0
}

/**
 * Offset a SimpleGeometry's coordinates by a delta.
 * When `visual` is true, uses Mercator-aware translation (delta is in projected coords).
 * When `visual` is false, delta is in [lng, lat] degrees.
 */
export function offsetSimpleGeometry(geom: SimpleGeometry, delta: [number, number], visual: boolean): SimpleGeometry {
  const [dx, dy] = delta
  if (visual) {
    if (geom.type === 'Point') {
      return { type: 'Point', coordinates: translateGeometryVisually([geom.coordinates], dx, dy)[0] as [number, number] }
    }
    // translateGeometryVisually traverses nested arrays automatically
    if (geom.type === 'MultiPoint') return { type: 'MultiPoint', coordinates: translateGeometryVisually(geom.coordinates, dx, dy) }
    if (geom.type === 'LineString') return { type: 'LineString', coordinates: translateGeometryVisually(geom.coordinates, dx, dy) }
    if (geom.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: translateGeometryVisually(geom.coordinates, dx, dy) }
    if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: translateGeometryVisually(geom.coordinates, dx, dy) }
    if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: translateGeometryVisually(geom.coordinates, dx, dy) }
    return geom
  }
  const oc = (c: [number, number]): [number, number] => withXY(c, [c[0] + dx, c[1] + dy])
  const ol = (line: [number, number][]) => line.map(oc)
  if (geom.type === 'Point') return { type: 'Point', coordinates: oc(geom.coordinates) }
  if (geom.type === 'MultiPoint') return { type: 'MultiPoint', coordinates: geom.coordinates.map(oc) }
  if (geom.type === 'LineString') return { type: 'LineString', coordinates: geom.coordinates.map(oc) }
  if (geom.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: geom.coordinates.map(ol) }
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(ol) }
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map(p => p.map(ol)) }
  return geom
}

/**
 * Offset any Geometry (including GeometryCollection) by a delta.
 * Delegates to offsetSimpleGeometry for each sub-geometry in a collection.
 */
export function offsetGeometry(geom: Geometry, delta: [number, number], visual: boolean): Geometry {
  if (geom.type === 'GeometryCollection') {
    return { type: 'GeometryCollection', geometries: geom.geometries.map(sub => offsetSimpleGeometry(sub, delta, visual)) }
  }
  return offsetSimpleGeometry(geom as SimpleGeometry, delta, visual)
}
