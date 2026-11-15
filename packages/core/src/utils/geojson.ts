import type { FeatureCollection, GeoJSONFeature, Geometry, Schema } from '../types/geojson'

/** Shared 100 MB cap applied to text-form GeoJSON imports. */
export const DEFAULT_MAX_IMPORT_BYTES = 100 * 1024 * 1024

export interface ParseGeoJSONOptions {
  /** Maximum accepted byte length of the input text. Defaults to {@link DEFAULT_MAX_IMPORT_BYTES}. */
  maxBytes?: number
}

export type ParseGeoJSONError =
  | { kind: 'too-large'; bytes: number; maxBytes: number }
  | { kind: 'invalid-json'; cause: Error }
  | { kind: 'not-feature-collection'; received: string }

export type ParseGeoJSONResult =
  | { ok: true; fc: FeatureCollection }
  | { ok: false; error: ParseGeoJSONError }

/**
 * Parse and shape-validate a GeoJSON text blob. Does not mutate or filter features —
 * per-feature validation (unsupported geometry types, id dedup, schema resolution)
 * happens later inside {@link createDataStore}'s `importGeoJSON` store action.
 *
 * Central place that enforces the input size cap, so the Web Worker importer, the
 * store, and UI drop zones all agree on the same limits and error shape.
 */
export function parseGeoJSONText(text: string, opts?: ParseGeoJSONOptions): ParseGeoJSONResult {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_IMPORT_BYTES
  // text.length is UTF-16 code units, not bytes — multi-byte UTF-8 input can be
  // ~2× this number on the wire. Cap is intentionally loose; goal is "stop
  // pathological cases", not exact byte metering.
  if (text.length > maxBytes) {
    return { ok: false, error: { kind: 'too-large', bytes: text.length, maxBytes } }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'invalid-json', cause: err instanceof Error ? err : new Error(String(err)) },
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: { kind: 'not-feature-collection', received: parsed === null ? 'null' : typeof parsed } }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.type !== 'FeatureCollection') {
    return { ok: false, error: { kind: 'not-feature-collection', received: typeof obj.type === 'string' ? obj.type : typeof obj.type } }
  }
  if (!Array.isArray(obj.features)) {
    return { ok: false, error: { kind: 'not-feature-collection', received: 'FeatureCollection without features[]' } }
  }
  return { ok: true, fc: parsed as FeatureCollection }
}

/**
 * Accepts the union shape both adapters expose to consumers via
 * `mapController.fitBounds(target)` / `ref.fitBounds(target)`:
 *
 *   - bbox tuple `[minLng, minLat, maxLng, maxLat]`, or
 *   - array of `[lng, lat]` points (extracts the bbox).
 *
 * Returns `{ minLng, minLat, maxLng, maxLat }`. The adapters compose this
 * into their map-API-specific call (Leaflet wants `[[lat, lng], [lat, lng]]`,
 * MapLibre wants `[[lng, lat], [lng, lat]]`). Returns `null` when the input
 * is empty or contains no finite coordinates.
 */
export function normalizeFitBoundsTarget(
  target: [number, number][] | [number, number, number, number],
): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  if (!target || (target as unknown[]).length === 0) return null
  if (typeof (target as number[])[0] === 'number') {
    const [minLng, minLat, maxLng, maxLat] = target as [number, number, number, number]
    if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null
    return { minLng, minLat, maxLng, maxLat }
  }
  const pts = target as [number, number][]
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of pts) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLng)) return null
  return { minLng, minLat, maxLng, maxLat }
}

/** Returns [minLng, minLat, maxLng, maxLat] for an array of coordinates. */
export function getBBox(coords: [number, number][]): [number, number, number, number] {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  // Empty geometries (no rings / no positions, RFC 7946 §3.1) give the empty bbox
  // [Infinity, Infinity, -Infinity, -Infinity] instead of throwing.
  if (!Array.isArray(coords)) return [minLng, minLat, maxLng, maxLat]
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]
    if (!Array.isArray(c)) continue
    if (c[0] < minLng) minLng = c[0]
    if (c[0] > maxLng) maxLng = c[0]
    if (c[1] < minLat) minLat = c[1]
    if (c[1] > maxLat) maxLat = c[1]
  }
  return [minLng, minLat, maxLng, maxLat]
}

/** Returns [minLng, minLat, maxLng, maxLat] for any GeoJSON geometry. */
export function getGeometryBBox(geometry: Geometry): [number, number, number, number] {
  const { type } = geometry
  const coordinates = 'coordinates' in geometry ? geometry.coordinates : undefined
  if (type === 'Point') {
    return getBBox([coordinates as [number, number]])
  }
  if (type === 'MultiPoint') {
    return getBBox(coordinates as [number, number][])
  }
  if (type === 'LineString') {
    return getBBox(coordinates as [number, number][])
  }
  if (type === 'Polygon') {
    return getBBox((coordinates as [number, number][][])[0] ?? [])
  }
  if (type === 'MultiLineString') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const line of (coordinates as [number, number][][])) {
      const [w, s, e, n] = getBBox(line)
      if (w < minX) minX = w
      if (s < minY) minY = s
      if (e > maxX) maxX = e
      if (n > maxY) maxY = n
    }
    return [minX, minY, maxX, maxY]
  }
  if (type === 'MultiPolygon') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const poly of (coordinates as [number, number][][][])) {
      const [w, s, e, n] = getBBox(poly?.[0] ?? [])
      if (w < minX) minX = w
      if (s < minY) minY = s
      if (e > maxX) maxX = e
      if (n > maxY) maxY = n
    }
    return [minX, minY, maxX, maxY]
  }
  if (type === 'GeometryCollection') {
    const geom = geometry as import('../types/geojson').GeometryCollectionGeometry
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const sub of geom.geometries) {
      const [w, s, e, n] = getGeometryBBox(sub)
      if (w < minX) minX = w
      if (s < minY) minY = s
      if (e > maxX) maxX = e
      if (n > maxY) maxY = n
    }
    return [minX, minY, maxX, maxY]
  }
  return [0, 0, 0, 0]
}

/**
 * `geometry`'s bbox, or `undefined` for an empty geometry (no positions): its bbox is
 * [Infinity, Infinity, -Infinity, -Infinity], which JSON.stringify writes as
 * `[null, null, null, null]` (invalid GeoJSON). Use this for the stored `feature.bbox`.
 */
export function storedBBox(geometry: Geometry): [number, number, number, number] | undefined {
  const b = getGeometryBBox(geometry)
  return Number.isFinite(b[0]) && Number.isFinite(b[1]) && Number.isFinite(b[2]) && Number.isFinite(b[3]) ? b : undefined
}

/** `f` without a non-finite `bbox` (one stored before `storedBBox`, or set by the host). */
export function withFiniteBBox<T extends { bbox?: number[] }>(f: T): T {
  if (!f.bbox || f.bbox.every(Number.isFinite)) return f
  const { bbox: _drop, ...rest } = f
  return rest as T
}

/**
 * Returns the combined [minLng, minLat, maxLng, maxLat] bbox across every feature in
 * a `FeatureCollection`, or `null` when the collection has no features. Used by
 * demos to call `ref.fitBounds(...)` after importing GeoJSON so the user sees
 * what they just loaded.
 */
export function getFeatureCollectionBBox(fc: FeatureCollection): [number, number, number, number] | null {
  if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let any = false
  for (const f of fc.features) {
    if (!f?.geometry) continue
    const [w, s, e, n] = getGeometryBBox(f.geometry)
    if (!Number.isFinite(w) || !Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(n)) continue
    if (w < minX) minX = w
    if (s < minY) minY = s
    if (e > maxX) maxX = e
    if (n > maxY) maxY = n
    any = true
  }
  return any ? [minX, minY, maxX, maxY] : null
}

/** WeakMap bbox cache — entries are GC'd automatically when feature objects are replaced. */
const _featureBBoxCache = new WeakMap<object, [number, number, number, number]>()

/** Returns [minLng, minLat, maxLng, maxLat] for a feature, cached on the object reference. */
export function getFeatureBBox(f: GeoJSONFeature): [number, number, number, number] {
  const cached = _featureBBoxCache.get(f)
  if (cached) return cached
  const bbox = getGeometryBBox(f.geometry)
  _featureBBoxCache.set(f, bbox)
  return bbox
}

/**
 * Export features to a GeoJSON FeatureCollection string. A non-finite `bbox` is
 * dropped rather than written as `[null, null, null, null]`.
 */
export function exportLayerGeoJSON(
  features: GeoJSONFeature[],
  schemas: Schema[],
): string {
  return JSON.stringify(
    { type: 'FeatureCollection', metadata: { schemas }, features: features.map(withFiniteBBox) },
    null,
    2,
  )
}

