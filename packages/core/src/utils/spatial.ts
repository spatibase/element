import { mapCoordinates } from './positions'

const RAD = Math.PI / 180

/**
 * Translates a nested array of coordinates by a physical geographic delta: the
 * point under the cursor goes from `startLngLat` to `endLngLat`, and every vertex
 * keeps its true ground distance and compass bearing from that point (each vertex
 * is re-placed on the sphere around the new anchor). Size and shape on the globe
 * are preserved on long moves too; edges stay true to within the (tiny, for
 * shapes much smaller than the Earth) distortion of an azimuthal-equidistant
 * frame around the anchor. Longitudes are not wrapped.
 */
export function translateGeometrySpatially<T extends unknown[]>(coords: T, startLngLat: [number, number], endLngLat: [number, number]): T {
  const lng1 = startLngLat[0] * RAD
  const lat1 = startLngLat[1] * RAD
  const lng2 = endLngLat[0] * RAD
  const lat2 = endLngLat[1] * RAD
  const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1)
  const sinLat2 = Math.sin(lat2), cosLat2 = Math.cos(lat2)

  return mapCoordinates(coords, (c) => {
    const lng = c[0] * RAD
    const lat = c[1] * RAD
    const dLng = lng - lng1
    const sinLat = Math.sin(lat), cosLat = Math.cos(lat)
    // Central angle (haversine) and initial bearing from the start anchor to the vertex.
    const h = Math.sin((lat - lat1) / 2) ** 2 + cosLat1 * cosLat * Math.sin(dLng / 2) ** 2
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
    const brg = Math.atan2(Math.sin(dLng) * cosLat, cosLat1 * sinLat - sinLat1 * cosLat * Math.cos(dLng))
    // Same distance and bearing from the end anchor.
    const sinD = Math.sin(d), cosD = Math.cos(d)
    const latOut = Math.asin(Math.max(-1, Math.min(1, sinLat2 * cosD + cosLat2 * sinD * Math.cos(brg))))
    const lngOut = lng2 + Math.atan2(Math.sin(brg) * sinD * cosLat2, cosD - sinLat2 * Math.sin(latOut))
    return [lngOut / RAD, latOut / RAD]
  })
}
