// Leaflet coordinate convention: [lat, lng]
// GeoJSON coordinate convention: [lng, lat]
// Always convert at the Leaflet boundary — never mix internally

import type { Position } from 'geojson'

// Accept the wider geojson `Position` (number[]) so these compose cleanly with
// `Position[].map(toLeaflet)` — internally we treat the first two entries as [lng, lat].
export function toLeaflet(coord: Position | [number, number]): [number, number] {
  return [coord[1], coord[0]]
}

export function toGeoJSON(coord: Position | [number, number]): [number, number] {
  return [coord[1], coord[0]]
}
