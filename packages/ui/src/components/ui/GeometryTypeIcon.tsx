import { MapPin, LineSegment, Polygon, StackSimple } from '@phosphor-icons/react'

/** A geometry type's icon, as in the layers list (sized by the caller, coloured by currentColor). */
export function GeometryTypeIcon({ type, size = 20 }: { type: string; size?: number }) {
  if (type === 'Point' || type === 'MultiPoint') return <MapPin size={size} />
  if (type === 'Polygon' || type === 'MultiPolygon') return <Polygon size={size} weight="fill" />
  if (type === 'GeometryCollection') return <StackSimple size={size} />
  return <LineSegment size={size} weight="bold" />
}

/** A geometry type in plain words: Point, Line, Area (plural for Multi*), Mixed. */
export function geometryTypeLabel(type: string): string {
  switch (type) {
    case 'Point': return 'Point'
    case 'MultiPoint': return 'Points'
    case 'LineString': return 'Line'
    case 'MultiLineString': return 'Lines'
    case 'Polygon': return 'Area'
    case 'MultiPolygon': return 'Areas'
    case 'GeometryCollection': return 'Mixed'
    default: return type
  }
}
