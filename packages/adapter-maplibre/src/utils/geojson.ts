/** Empty GeoJSON FeatureCollection for initializing MapLibre sources. */
export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

/**
 * MapLibre uses [lng, lat] natively — same as GeoJSON.
 * No coordinate swapping needed. These helpers are provided for API symmetry.
 */
export function toMapLibre(coord: [number, number]): [number, number] {
  return coord // [lng, lat] — already correct for MapLibre
}

export function toGeoJSON(coord: [number, number]): [number, number] {
  return coord // [lng, lat] — already correct
}

/** Convert [lng, lat, lng, lat] bbox to MapLibre LngLatBoundsLike */
export function bboxToMapLibre(bbox: [number, number, number, number]): [[number, number], [number, number]] {
  return [[bbox[0], bbox[1]], [bbox[2], bbox[3]]]
}
