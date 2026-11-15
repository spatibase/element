import { area } from '@turf/area'
import { distance } from '@turf/distance'
import { feature as turfFeature, featureCollection, point, polygon as turfPolygon } from '@turf/helpers'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { GeoJSONFeature } from '../types/geojson'
import type { DataStore } from '../store/dataStore'
import type { UIStore } from '../store/uiStore'
import { ElementEditorError } from './errors'

// --- Types ---

export interface OverpassResult {
  osmId: number
  name: string | null
  /** Human-readable category label */
  type: string
  /** Area in square meters, for sorting smallest→largest */
  areaM2: number
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

interface OverpassNode { lat: number; lon: number }

interface OverpassElement {
  type: 'way' | 'relation' | 'node'
  id: number
  tags?: Record<string, string>
  geometry?: OverpassNode[]
  members?: Array<{
    type: string
    ref: number
    role: string
    geometry?: OverpassNode[]
  }>
}

// --- Query builder ---

const OSM_TAGS = [
  '["building"]',
  '["landuse"]',
  '["leisure"]',
  '["natural"="water"]',
  '["amenity"="parking"]',
]

function buildOverpassQuery(lat: number, lon: number, radiusM: number): string {
  const ways = OSM_TAGS.map(tag => `way${tag}(around:${radiusM},${lat},${lon});`).join('\n      ')
  const rels = OSM_TAGS.map(tag => `relation${tag}(around:${radiusM},${lat},${lon});`).join('\n      ')
  return `[out:json][timeout:10];
    (
      ${ways}
      ${rels}
    );
    out geom;`
}

// --- OSM → GeoJSON conversion ---

function categoryLabel(tags: Record<string, string>): string {
  if (tags.building) return tags.building === 'yes' ? 'Building' : `Building (${tags.building})`
  if (tags.leisure) return tags.leisure.charAt(0).toUpperCase() + tags.leisure.slice(1).replace(/_/g, ' ')
  if (tags.natural === 'water') return 'Water'
  if (tags.amenity === 'parking') return 'Parking'
  if (tags.landuse) return tags.landuse.charAt(0).toUpperCase() + tags.landuse.slice(1).replace(/_/g, ' ')
  return 'Area'
}

function nodesToRing(nodes: OverpassNode[]): [number, number][] {
  const ring: [number, number][] = nodes.map(n => [n.lon, n.lat])
  // Ensure ring is closed
  if (ring.length >= 2) {
    const first = ring[0], last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
  }
  return ring
}

function buildResult(
  id: number,
  tags: Record<string, string>,
  coords: [number, number][][]
): OverpassResult | null {
  let areaM2 = 0
  try { areaM2 = area(turfPolygon(coords)) } catch { return null }
  if (areaM2 <= 0) return null
  return {
    osmId: id,
    name: tags.name ?? null,
    type: categoryLabel(tags),
    areaM2,
    geometry: { type: 'Polygon', coordinates: coords },
  }
}

function wayToResult(el: OverpassElement): OverpassResult | null {
  if (!el.geometry || el.geometry.length < 4) return null
  return buildResult(el.id, el.tags ?? {}, [nodesToRing(el.geometry)])
}

function relationToResult(el: OverpassElement): OverpassResult | null {
  if (!el.members) return null

  const outerRings: [number, number][][] = []
  const innerRings: [number, number][][] = []

  for (const member of el.members) {
    if (member.type !== 'way' || !member.geometry || member.geometry.length < 2) continue
    const ring = nodesToRing(member.geometry)
    if (ring.length < 4) continue
    if (member.role === 'outer') outerRings.push(ring)
    else if (member.role === 'inner') innerRings.push(ring)
  }

  // Merge split outer segments (ways split at intersections)
  const mergedOuter = outerRings.length === 1 ? outerRings[0]
    : outerRings.length > 1 ? mergeOuterRings(outerRings)
    : null
  if (!mergedOuter || mergedOuter.length < 4) return null

  return buildResult(el.id, el.tags ?? {}, [mergedOuter, ...innerRings])
}

/** Merge multiple open way segments into a single closed ring. */
function mergeOuterRings(segments: [number, number][][]): [number, number][] | null {
  // Remove closing vertex from each segment (we'll re-close at the end)
  const open = segments.map(seg => {
    const s = [...seg]
    if (s.length > 1 && s[0][0] === s[s.length - 1][0] && s[0][1] === s[s.length - 1][1]) s.pop()
    return s
  })

  const result = [...open[0]]
  const used = new Set([0])

  for (let iter = 0; iter < open.length; iter++) {
    const tail = result[result.length - 1]
    let found = false
    for (let i = 0; i < open.length; i++) {
      if (used.has(i)) continue
      const seg = open[i]
      // Check if this segment connects to the tail (forward)
      if (Math.abs(seg[0][0] - tail[0]) < 1e-7 && Math.abs(seg[0][1] - tail[1]) < 1e-7) {
        result.push(...seg.slice(1))
        used.add(i)
        found = true
        break
      }
      // Check reverse
      if (Math.abs(seg[seg.length - 1][0] - tail[0]) < 1e-7 && Math.abs(seg[seg.length - 1][1] - tail[1]) < 1e-7) {
        result.push(...[...seg].reverse().slice(1))
        used.add(i)
        found = true
        break
      }
    }
    if (!found) break
  }

  // Close the ring
  if (result.length >= 3) {
    const first = result[0], last = result[result.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) result.push(first)
  }

  return result.length >= 4 ? result : null
}

// --- Cache + debounce ---

let _cache: {
  endpoint: string
  lat: number
  lon: number
  radiusM: number
  results: OverpassResult[]
} | null = null

/** In-flight requests keyed by location + radius, so a repeat click on the
 *  same spot joins the running request instead of firing another one. The
 *  request is aborted once every caller that joined with a signal aborted
 *  (a caller without a signal keeps it alive). */
const _pending = new Map<string, { promise: Promise<OverpassResult[]>; controller: AbortController; callers: number }>()

/** ~11 m at 4 decimals — same granularity as the cache-reuse distance. */
function pendingKey(endpoint: string, lat: number, lon: number, radiusM: number): string {
  return `${endpoint} ${lat.toFixed(4)},${lon.toFixed(4)},${radiusM}`
}

const abortError = () => new DOMException('Aborted', 'AbortError')

/** Reject on this caller's abort only; the shared promise keeps running for other callers. */
function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Only reuse cache if new click is very close to original center.
 *  Using full radius would miss features near the new click but outside the old query. */
const CACHE_REUSE_DISTANCE_M = 15

function isWithinCachedRadius(endpoint: string, lat: number, lon: number): boolean {
  if (!_cache || _cache.endpoint !== endpoint) return false
  const d = distance(point([lon, lat]), point([_cache.lon, _cache.lat]), { units: 'meters' })
  return d <= CACHE_REUSE_DISTANCE_M
}

// --- Public API ---

/**
 * Fetch OSM polygon features near a point. Returns results sorted smallest→largest.
 * Includes caching (reuse if click within same radius) and in-flight de-dupe per location.
 * Pass `clickLngLat` to filter results to only polygons containing the click point.
 * Last arg: options (per editor: `endpoint`, `timeoutMs`, `fetch`, `signal`), or a bare `AbortSignal`.
 */
export async function fetchOverpassFeatures(
  lat: number,
  lon: number,
  radiusM = 50,
  clickLngLat?: [number, number],
  opts?: OverpassOptions | AbortSignal,
): Promise<OverpassResult[]> {
  const o: OverpassOptions = opts instanceof AbortSignal ? { signal: opts } : opts ?? {}
  const signal = o.signal
  const endpoint = o.endpoint ?? OVERPASS_DEFAULTS.endpoint
  // Cache hit
  if (isWithinCachedRadius(endpoint, lat, lon) && _cache) {
    return filterAndSort(_cache.results, clickLngLat)
  }

  if (signal?.aborted) throw abortError()
  // De-dupe: join an in-flight request for the same spot. One caller aborting
  // rejects only its own promise; the fetch stops when the last one leaves.
  const key = pendingKey(endpoint, lat, lon, radiusM)
  let entry = _pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    const promise = doFetch(lat, lon, radiusM, controller.signal, { ...o, endpoint })
      .then((results) => {
        _cache = { endpoint, lat, lon, radiusM, results }
        return results
      })
      .finally(() => { if (_pending.get(key)?.promise === promise) _pending.delete(key) })
    entry = { promise, controller, callers: 0 }
    _pending.set(key, entry)
  }
  const joined = entry
  joined.callers++
  const leave = () => {
    if (--joined.callers > 0) return
    joined.controller.abort()
    if (_pending.get(key) === joined) _pending.delete(key)
  }
  signal?.addEventListener('abort', leave, { once: true })
  try {
    return filterAndSort(await withAbort(joined.promise, signal), clickLngLat)
  } finally {
    signal?.removeEventListener('abort', leave)
  }
}

/** Why a `fetchOverpassFeatures` call failed (an abort rejects with a DOMException `AbortError` instead). */
export type OverpassErrorCode = 'rate-limited' | 'busy' | 'timeout' | 'network' | 'invalid-data'

/** A failed Overpass lookup: an {@link ElementEditorError} with `source: 'picker'`. */
export class OverpassError extends ElementEditorError {
  declare readonly code: OverpassErrorCode
  constructor(code: OverpassErrorCode, message: string = code) {
    super(code, 'picker', message)
    this.name = 'OverpassError'
  }
}

/** User-facing message for a failed `fetchOverpassFeatures`. */
export function overpassErrorMessage(err: unknown): string {
  const code = err instanceof OverpassError ? err.code : (err as Error)?.message
  if (code === 'rate-limited') return 'Too many requests — wait a moment and try again'
  if (code === 'busy') return 'Map data server is busy — try again in a moment'
  if (code === 'timeout') return 'Map data server took too long to answer — try again'
  if (code === 'invalid-data') return 'Map data server sent an answer that could not be read — try again'
  return 'Could not reach map data service — try again'
}

export interface OverpassOptions {
  /** Overpass API interpreter URL (your own instance or a mirror). Default: `https://overpass-api.de/api/interpreter`. */
  endpoint?: string
  /** Per-attempt timeout in ms (request + response body). Default: 15000. */
  timeoutMs?: number
  /** `fetch` to use (proxy, auth headers, tests). Default: the global `fetch`. */
  fetch?: typeof fetch
  signal?: AbortSignal
}

export const OVERPASS_DEFAULTS = { endpoint: 'https://overpass-api.de/api/interpreter', timeoutMs: 15_000 }

/** A polygon feature read from vector tiles (e.g. MapLibre's queryRenderedFeatures / querySourceFeatures). */
export interface TileFeature {
  /** The tile source (needed by `tileCandidates`). */
  source?: string
  sourceLayer?: string
  /** The feature id (needed by `tileCandidates`; features without one aren't picked). */
  id?: string | number
  properties: Record<string, unknown>
  geometry: { type: string; coordinates?: unknown }
}

type PolyFeature = Feature<Polygon | MultiPolygon>

/**
 * A shape under a pick click read from vector tiles, not merged yet. Tiles clip
 * shapes at their edges, so a park arrives as several `pieces`; only the one the
 * user chooses is merged (`tileCandidateResult`), off the main thread when the
 * caller can.
 */
export interface TileCandidate {
  /** Unique per shape: the same id in two source layers of one group (landuse/landcover/park) is one candidate. */
  key: string
  osmId: number
  name: string | null
  type: string
  /** Sum of the pieces' areas (tile buffers overlap a little): an estimate, for ordering. */
  areaM2: number
  /** All pieces as one MultiPolygon: the outline shown while choosing (seams at tile edges included). */
  geometry: { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  /** The pieces to merge once chosen. */
  pieces: PolyFeature[]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

// Source layers that can hold the same OSM object (a park is often in `park` and `landcover`).
const LAYER_GROUP: Record<string, string> = { landuse: 'area', landcover: 'area', park: 'area' }

function tileLabel(f: TileFeature): { name: string | null; type: string } {
  const { sourceLayer, properties: props } = f
  const cls = typeof props.class === 'string' ? props.class : null
  const sub = typeof props.subclass === 'string' ? props.subclass : null
  const type = sourceLayer === 'building' ? 'Building'
    : sourceLayer === 'water' ? 'Water'
    : sub ? capitalize(sub) : cls ? capitalize(cls) : capitalize(sourceLayer ?? 'Area')
  const name = typeof props.name === 'string' && props.name ? props.name : null
  return { name, type }
}

const polygonsOf = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as [number, number][][][]

function candidateOf(key: string, first: TileFeature, pieceFeatures: TileFeature[]): TileCandidate | null {
  const pieces = pieceFeatures
    .filter((p) => p.geometry.type === 'Polygon' || p.geometry.type === 'MultiPolygon')
    .map((p) => turfFeature(p.geometry as Polygon | MultiPolygon))
  if (!pieces.length) return null
  const coordinates: [number, number][][][] = []
  let areaM2 = 0
  for (const p of pieces) {
    for (const c of polygonsOf(p.geometry)) coordinates.push(c)
    try { areaM2 += area(p) } catch { /* degenerate piece */ }
  }
  if (areaM2 <= 0) return null
  return { key, osmId: Number(first.id), ...tileLabel(first), areaM2, geometry: { type: 'MultiPolygon', coordinates }, pieces }
}

/**
 * The shape picker's candidates from vector tiles, smallest first — cheap: no
 * union, just grouping and area sums. `rendered` are the polygons under the
 * click (top first), `pieces` every loaded piece of those features (any order;
 * a feature with none uses its rendered piece). Duplicates — the same feature
 * from two tiles, or the same id in two source layers of one group — collapse
 * into one candidate, keyed by `key`.
 */
export function tileCandidates(rendered: readonly TileFeature[], pieces: readonly TileFeature[]): TileCandidate[] {
  const keyOf = (f: TileFeature) => `${f.source ?? ''}/${LAYER_GROUP[f.sourceLayer ?? ''] ?? f.sourceLayer}/${f.id}`
  const byKey = new Map<string, TileFeature[]>()
  for (const p of pieces) {
    if (p.id == null) continue
    const k = `${keyOf(p)}/${p.sourceLayer}` // a shape's pieces come from one source layer
    const list = byKey.get(k)
    if (list) list.push(p); else byKey.set(k, [p])
  }
  const seen = new Set<string>()
  const out: TileCandidate[] = []
  for (const f of rendered) {
    if (f.id == null) continue
    const key = keyOf(f)
    if (seen.has(key)) continue
    seen.add(key)
    const c = candidateOf(key, f, byKey.get(`${key}/${f.sourceLayer}`) ?? [f])
    if (c) out.push(c)
  }
  return out.sort((a, b) => a.areaM2 - b.areaM2)
}

/**
 * The chosen candidate as a pick result, given its pieces merged into
 * `merged` (null: merging failed — the piece under the click is used). A
 * multipolygon keeps the part under the click (else the largest).
 */
export function tileCandidateResult(c: TileCandidate, merged: Polygon | MultiPolygon | null, clickLngLat: [number, number]): OverpassResult | null {
  const parts = polygonsOf(merged ?? c.geometry)
  const pt = point(clickLngLat)
  const part = parts.find((p) => booleanPointInPolygon(pt, turfPolygon(p)))
    ?? parts.reduce((a, b) => (area(turfPolygon(b)) > area(turfPolygon(a)) ? b : a))
  const result = buildResult(c.osmId, {}, part)
  return result && { ...result, name: c.name, type: c.type }
}

/**
 * Merges a candidate's pieces on this thread (`@turf/union`, loaded on first use: the polygon
 * clipper is ~30 KB gzip that the editor's first paint doesn't need); one piece needs none.
 */
export async function unionPieces(pieces: readonly PolyFeature[]): Promise<Polygon | MultiPolygon | null> {
  if (pieces.length === 1) return pieces[0].geometry
  try {
    const { union } = await import('@turf/union')
    return union(featureCollection(pieces as PolyFeature[]))?.geometry ?? null
  } catch { return null }
}

/**
 * Turn the tile pieces of ONE map feature into a pick result, merging them on
 * this thread. The pickers use `tileCandidates` + `tileCandidateResult`
 * instead, which merge only the chosen shape.
 */
export async function tileFeatureToResult(
  pieces: TileFeature[],
  osmId: number,
  clickLngLat: [number, number]
): Promise<OverpassResult | null> {
  const c = candidateOf(String(osmId), { ...pieces[0], id: osmId }, pieces)
  return c && tileCandidateResult(c, await unionPieces(c.pieces), clickLngLat)
}

// --- Shape picker (both adapters' OsmTraceHandler) ---

/** Below this zoom the shape picker refuses to look up (a click covers too much ground). */
export const OSM_PICK_MIN_ZOOM = 15

/** Outline/fill/dot colours of the candidates when one click finds several shapes (cycled). */
export const OSM_PICK_OVERLAY_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444']

/** Overpass search radius in metres: at lower zoom the visible features span more ground. */
export function overpassRadiusForZoom(zoom: number): number {
  return zoom >= 18 ? 80 : zoom >= 17 ? 150 : zoom >= 16 ? 250 : 400
}

/** A picked shape as an Element feature in `schemaId`, named after the OSM feature. */
export function overpassResultToFeature(result: OverpassResult, schemaId: string): GeoJSONFeature {
  return {
    type: 'Feature',
    id: crypto.randomUUID(),
    schemaId,
    geometry: result.geometry,
    properties: { name: result.name ?? '' },
  }
}

/**
 * Commit a picked shape in the default schema, like any drawing tool's commit:
 * one undo step (addFeature's own), the new feature selected, `autoExitAfterDraw`
 * honoured. No-op when the feature limit is reached (addFeature reports it).
 */
export function addPickedFeature(data: DataStore, ui: UIStore, result: OverpassResult): void {
  if (!data.addFeature(overpassResultToFeature(result, data.getDefaultSchema().id))) return
  if (ui.autoExitAfterDraw) ui.setEditingMode('none')
}

/** Clear the cache (e.g. when map moves significantly). */
export function clearOverpassCache(): void {
  _cache = null
  _pending.clear()
}

// --- Internals ---

/** Waits before each retry. The public server answers 429 / 502-504 when its queue is full. */
const RETRY_DELAYS_MS = [1000, 2500]
/** A `Retry-After` longer than this isn't waited out: the error is reported instead. */
const RETRY_AFTER_MAX_MS = 10_000
const RETRY_STATUS = new Set([429, 502, 503, 504])

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const onAbort = () => { clearTimeout(timer); reject(abortError()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** One POST with its own timeout (covering the body too), also cancelled by `signal`. */
async function attempt(body: string, signal: AbortSignal, o: OverpassOptions): Promise<{ res: Response; data?: { elements?: OverpassElement[] } }> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, o.timeoutMs ?? OVERPASS_DEFAULTS.timeoutMs)
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await (o.fetch ?? fetch)(o.endpoint ?? OVERPASS_DEFAULTS.endpoint, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    })
    return { res, data: res.ok ? await res.json() : undefined }
  } catch (err) {
    if (signal.aborted) throw abortError()
    if (timedOut) throw new OverpassError('timeout')
    // The server answered, but not with JSON (an HTML error page, a cut-off body).
    if (err instanceof SyntaxError) throw new OverpassError('invalid-data', err.message)
    throw new OverpassError('network', (err as Error)?.message || 'network')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

async function doFetch(lat: number, lon: number, radiusM: number, signal: AbortSignal, o: OverpassOptions): Promise<OverpassResult[]> {
  const body = `data=${encodeURIComponent(buildOverpassQuery(lat, lon, radiusM))}`
  for (let i = 0; ; i++) {
    const { res, data } = await attempt(body, signal, o)
    if (res.ok) {
      return (data?.elements ?? [])
        .map(el => el.type === 'way' ? wayToResult(el) : el.type === 'relation' ? relationToResult(el) : null)
        .filter((r): r is OverpassResult => r !== null)
    }
    // Other statuses (bad query, 404 endpoint) won't change on retry.
    if (!RETRY_STATUS.has(res.status)) throw new OverpassError('network', `Overpass API error: ${res.status}`)
    const code = res.status === 429 ? 'rate-limited' : 'busy'
    const retryAfterMs = Number(res.headers.get('Retry-After')) * 1000 // NaN/0 when absent or an HTTP date
    const wait = retryAfterMs > 0 ? retryAfterMs : RETRY_DELAYS_MS[i]
    if (i >= RETRY_DELAYS_MS.length || wait > RETRY_AFTER_MAX_MS) throw new OverpassError(code)
    await sleep(wait, signal)
  }
}

function filterAndSort(
  results: OverpassResult[],
  clickLngLat?: [number, number]
): OverpassResult[] {
  if (clickLngLat && results.length > 0) {
    // Prefer polygons that contain the click point
    const pt = point(clickLngLat)
    const containing = results.filter(r => {
      try { return booleanPointInPolygon(pt, turfPolygon(r.geometry.coordinates)) }
      catch { return false }
    })
    // If any contain the click, use those; otherwise return all nearby results
    if (containing.length > 0) return containing.sort((a, b) => a.areaM2 - b.areaM2)
  }
  return results.sort((a, b) => a.areaM2 - b.areaM2)
}
