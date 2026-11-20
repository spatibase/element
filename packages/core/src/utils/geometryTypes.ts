import type { Geometry } from '../types/geojson'

/** A GeoJSON geometry type name: what the `geometryTypes` prop lists. */
export type GeometryType = Geometry['type']

/** Every geometry type, in the order the docs list them. */
export const ALL_GEOMETRY_TYPES: readonly GeometryType[] = [
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection',
]

/**
 * The geometry types each drawing tool can commit; the tool is offered when at least one of them is
 * allowed (`geometryTypes`). `measure` and `search` add no feature of their own, so they aren't listed.
 */
export const TOOL_GEOMETRY_TYPES: Readonly<Record<string, readonly GeometryType[]>> = {
  point: ['Point'],
  line: ['LineString'],
  route: ['LineString'],
  polygon: ['Polygon'],
  circle: ['Polygon'],
  rectangle: ['Polygon'],
  freehand: ['LineString', 'Polygon'],
  picker: ['Polygon', 'MultiPolygon'],
}

/** User-facing message when `refused` geometry types aren't in the editor's allowed list. */
export function geometryTypeMessage(allowed: readonly GeometryType[], refused: Iterable<string>): string {
  const list = [...new Set(refused)]
  const accepts = allowed.length > 0 ? `only ${allowed.join(', ')}` : 'no geometry types'
  return `${list.join(', ')} ${list.length === 1 ? 'isn\'t' : 'aren\'t'} allowed here: this editor accepts ${accepts}.`
}

/** The type `mergeGeometries` gives a merge of features with these geometry types. */
export function mergeResultType(types: readonly string[]): GeometryType {
  const base = (t: string) => t.replace(/^Multi/, '')
  const first = types[0]
  if (first && first !== 'GeometryCollection' && types.every((t) => t !== 'GeometryCollection' && base(t) === base(first))) {
    return ('Multi' + base(first)) as GeometryType
  }
  return 'GeometryCollection'
}

/** The types "break apart" turns a geometry into (its parts), without building them. */
export function breakResultTypes(geometry: Geometry): GeometryType[] {
  switch (geometry.type) {
    case 'MultiPoint': return ['Point']
    case 'MultiLineString': return ['LineString']
    case 'MultiPolygon': return ['Polygon']
    case 'GeometryCollection': return [...new Set(geometry.geometries.map((g) => g.type))]
    default: return []
  }
}
