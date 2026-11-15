/**
 * Fetch a pedestrian route between waypoints.
 *
 * Uses OpenRouteService (excellent pedestrian routing) when an ORS API key is configured (or
 * `provider: 'ors'`). Otherwise OSRM: by default the public OSRM demo server, which is car-only
 * and not for production (a dev warning says so).
 *
 * Get a free ORS key (no credit card): https://openrouteservice.org/dev/#/signup
 *
 * Returns coordinates in GeoJSON order: [lng, lat].
 */

import { ElementEditorError, httpErrorCode } from './errors'
import { warnOnce } from './warnOnce'

export const ORS_DEFAULT_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'
export const OSRM_DEFAULT_URL = 'https://router.project-osrm.org/route/v1/foot'
export const ORS_ATTRIBUTION = 'Routing © <a href="https://openrouteservice.org/" target="_blank" rel="noopener">openrouteservice.org</a> by HeiGIT'

/** Where the Route tool snaps to roads (`config.network.routing`). */
export interface RoutingConfig {
  /** Default: `'ors'` when `apiKey` is set, else `'osrm'`. Set `'ors'` for a self-hosted ORS without a key. */
  provider?: 'ors' | 'osrm'
  /**
   * ORS: the directions endpoint (POSTed to), default `ORS_DEFAULT_URL`. OSRM: the route service
   * prefix including the profile, default `OSRM_DEFAULT_URL` (the public demo, car-only);
   * Element appends `/{lng,lat;…}?overview=full&geometries=geojson`.
   */
  url?: string
  /** OpenRouteService key (sent as the `Authorization` header). */
  apiKey?: string
  /** Credit shown in the attribution. Default: the ORS credit on the default ORS `url`, none otherwise. */
  attribution?: string
}

/** The routing credit to show for `routing`, if any. */
export function routingAttribution(routing: RoutingConfig | false | undefined): string | undefined {
  if (routing === false) return undefined
  if (routing?.attribution) return routing.attribution
  const provider = routing?.provider ?? (routing?.apiKey ? 'ors' : 'osrm')
  return provider === 'ors' && (!routing?.url || routing.url === ORS_DEFAULT_URL) ? ORS_ATTRIBUTION : undefined
}

let _orsApiKey: string | undefined

/**
 * Set a process-wide fallback ORS key.
 * @deprecated Module-global — two editors on one page clobber each other.
 * Pass `{ apiKey }` to `fetchRoute` instead (editors do this per instance).
 */
export function setRoutingApiKey(key: string | undefined) {
  _orsApiKey = key
}

/** Get the process-wide fallback ORS key set via `setRoutingApiKey`. */
export function getRoutingApiKey(): string | undefined {
  return _orsApiKey
}

export interface FetchRouteOptions extends Omit<RoutingConfig, 'attribution'> {
  /** `fetch` to use (proxy, auth headers, tests). Default: the global `fetch`. */
  fetch?: typeof fetch
  signal?: AbortSignal
}

/**
 * Second arg: options (per editor: provider, url, key, fetch), or a bare `AbortSignal` for the
 * legacy form that reads the `setRoutingApiKey` global. Options without a key do NOT read the global.
 */
export async function fetchRoute(
  waypoints: [number, number][],
  opts?: FetchRouteOptions | AbortSignal,
): Promise<[number, number][]> {
  if (waypoints.length < 2) throw new Error('Need at least 2 waypoints')

  const o: FetchRouteOptions = opts === undefined || opts instanceof AbortSignal ? { apiKey: _orsApiKey, signal: opts } : opts
  const provider = o.provider ?? (o.apiKey ? 'ors' : 'osrm')
  return provider === 'ors' ? fetchRouteORS(waypoints, o) : fetchRouteOSRM(waypoints, o)
}

async function fetchRouteORS(waypoints: [number, number][], { url = ORS_DEFAULT_URL, apiKey, fetch: f = fetch, signal }: FetchRouteOptions): Promise<[number, number][]> {
  const res = await f(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { 'Authorization': apiKey }),
    },
    body: JSON.stringify({ coordinates: waypoints }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ElementEditorError(httpErrorCode(res.status), 'routing', `ORS error ${res.status}: ${text}`)
  }

  const json = await res.json()
  const coords = json.features?.[0]?.geometry?.coordinates
  if (!coords?.length) throw new ElementEditorError('unknown', 'routing', 'ORS: no route in response')
  return coords as [number, number][]
}

async function fetchRouteOSRM(waypoints: [number, number][], { url = OSRM_DEFAULT_URL, fetch: f = fetch, signal }: FetchRouteOptions): Promise<[number, number][]> {
  if (url === OSRM_DEFAULT_URL) {
    warnOnce('routing-osrm-demo', 'The Route tool snaps through the public OSRM demo server (router.project-osrm.org): car-only, rate-limited and not for production. Set config.network.routing (an ORS `apiKey`, or your own OSRM `url`).')
  }
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const res = await f(`${url.replace(/\/$/, '')}/${coords}?overview=full&geometries=geojson`, { signal })
  if (!res.ok) throw new ElementEditorError(httpErrorCode(res.status), 'routing', `OSRM error: ${res.status}`)
  const json = await res.json()
  if (!json.routes?.length) throw new ElementEditorError('unknown', 'routing', 'OSRM: no route found')
  return json.routes[0].geometry.coordinates as [number, number][]
}

/**
 * The error to report when road snapping failed: the code of a `fetchRoute` failure (`network` for a
 * failed request) and a message that says the line stays straight. A refused key says so.
 */
export function routingError(err: unknown): ElementEditorError {
  const code = err instanceof ElementEditorError ? err.code : 'network'
  const message = code === 'unauthorized'
    ? 'Road snapping is off: the routing service refused the API key — using straight line'
    : code === 'rate-limited' || code === 'busy'
      ? 'Routing service is busy — using straight line. Try again in a moment'
      : "Couldn't snap to road — using straight line"
  return new ElementEditorError(code, 'routing', message, { cause: err })
}
