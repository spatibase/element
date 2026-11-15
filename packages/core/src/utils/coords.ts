import { warnOnce } from './warnOnce'

/**
 * Public-API coordinate shapes. Element's public API uses GeoJSON order, `[lng, lat]`,
 * everywhere; the older `[lat, lng]` forms still work but warn once in development.
 */

/** GeoJSON bbox: `[west, south, east, north]` (degrees). */
export type BBox = [number, number, number, number]

/** @deprecated `[[south, west], [north, east]]` (`[lat, lng]` pairs). Use a {@link BBox}. */
export type LegacyLatLngBounds = [[number, number], [number, number]]

/** What the `bounds` props accept: a {@link BBox} (preferred) or the deprecated nested form. */
export type BoundsInput = BBox | LegacyLatLngBounds

/** Object form of `ref.flyTo`. */
export interface FlyToOptions {
  /** Target centre, GeoJSON order `[lng, lat]`. */
  center: [number, number]
  /** Target zoom. Default 15. */
  zoom?: number
}

/**
 * The one place `bounds` input is normalised: returns a {@link BBox}, or `undefined` for
 * `null` / `undefined` / anything that is not one of the two accepted shapes. The nested
 * `[[south, west], [north, east]]` form is converted and warns once (dev only).
 */
export function normalizeBounds(input: BoundsInput | null | undefined): BBox | undefined {
  if (!Array.isArray(input)) return undefined
  if (input.length === 4 && input.every((n) => typeof n === 'number')) return input as BBox
  const [sw, ne] = input as LegacyLatLngBounds
  if (input.length !== 2 || !Array.isArray(sw) || !Array.isArray(ne)) return undefined
  const bbox: BBox = [sw[1], sw[0], ne[1], ne[0]]
  warnOnce('bounds:nested',
    `bounds={[[south, west], [north, east]]} is deprecated. Pass a GeoJSON bbox [west, south, east, north] instead: bounds={${JSON.stringify(bbox)}}.`)
  return bbox
}

/**
 * Normalises `ref.flyTo` arguments to `{ center: [lng, lat], zoom }`. Accepts the object form
 * `{ center: [lng, lat], zoom? }` or the deprecated `([lat, lng], zoom?)` tuple form (warns once,
 * dev only). Zoom defaults to 15. Returns `null` for unusable input.
 */
export function normalizeFlyToTarget(
  target: FlyToOptions | [number, number],
  zoom?: number,
): { center: [number, number]; zoom: number } | null {
  if (Array.isArray(target)) {
    if (target.length !== 2) return null
    const [lat, lng] = target
    warnOnce('flyTo:tuple',
      `flyTo([lat, lng], zoom) is deprecated. Use flyTo({ center: [lng, lat], zoom }) instead: flyTo({ center: [${lng}, ${lat}]${zoom === undefined ? '' : `, zoom: ${zoom}`} }).`)
    return { center: [lng, lat], zoom: zoom ?? 15 }
  }
  if (!target || !Array.isArray(target.center) || target.center.length !== 2) return null
  return { center: target.center, zoom: target.zoom ?? 15 }
}
