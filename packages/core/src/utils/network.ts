import { warnOnce } from './warnOnce'
import type { RoutingConfig } from './routing'
import type { OverpassOptions } from './overpass'

/**
 * A map tile source: a URL (a tile template with `{z}`, else a TileJSON URL), or MapLibre source
 * fields merged over the built-in source (`tiles`, `url`, `attribution`, `encoding`, `tileSize`,
 * `maxzoom`, …).
 */
export type NetworkSource = string | ({ tiles?: string[]; url?: string; attribution?: string } & Record<string, unknown>)

/**
 * Every server Element talks to, per editor (`config.network`). Omitted keys keep the default
 * service; `false` turns a service off (its tool or box is hidden). See the
 * "Third-party services and self-hosting" guide.
 */
export interface NetworkConfig {
  /** Vector tiles of the built-in vector basemaps (OpenMapTiles schema). Default: OpenFreeMap. */
  vectorTiles?: NetworkSource
  /** Elevation tiles of Streets / Terrain (hillshade). Default: Mapterhorn (terrarium encoding). */
  dem?: NetworkSource
  /** Raster tiles of the `'osm'` basemap (both engines). Default: tile.openstreetmap.org. */
  osmRaster?: NetworkSource
  /** Glyph URL template (`{fontstack}`, `{range}`); must serve Noto Sans Regular / Bold / Italic. Default: OpenFreeMap. */
  glyphs?: string
  /** Absolute URL prefix of the sprite files (without extension). Default: jsDelivr copy of the adapter's own. */
  sprite?: string
  /**
   * MapLibre GL JS 6's worker script (`maplibre-gl-worker.mjs`), which the MapLibre drop-in passes to
   * MapLibre's `setWorkerUrl` before creating its map. Default: jsDelivr copy of the installed
   * maplibre-gl version. `false`: leave it to the app (it calls `setWorkerUrl` itself). Not used on
   * MapLibre 5 (worker built in), nor when the app already called `setWorkerUrl`. MapLibre has one
   * worker URL per page, so the first editor that creates a map sets it.
   */
  maplibreWorker?: string | false
  /** The Picker's OpenStreetMap lookups. `false`: the Picker uses the basemap's vector tiles only (hidden on Leaflet). */
  overpass?: false | Omit<OverpassOptions, 'fetch' | 'signal'>
  /** The Route tool's road snapping. `false`: the Route tool is hidden. */
  routing?: false | RoutingConfig
  /** The search box's geocoder. `false`: the search box is hidden. */
  nominatim?: false | NominatimConfig
  /** `fetch` for every request Element makes itself (Overpass, routing, search): proxy, auth headers, tests. */
  fetch?: typeof fetch
}

export interface NominatimConfig {
  /** Search endpoint. Default: `https://nominatim.openstreetmap.org/search`. */
  url?: string
  /** Sent as the `email` query parameter (Nominatim's usage policy asks heavy users for one). */
  email?: string
  /** Credit shown in the attribution. Default: "Geocoding by Nominatim" on the default `url`, none otherwise. */
  attribution?: string
}

export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'

/**
 * `src` over the built-in source `base`. A string or object that names a new host (`tiles` / `url`)
 * without an `attribution` gets `fallbackAttribution` (the data credit that stays true, or none) and
 * a dev warning: the default provider's credit no longer applies.
 */
export function overrideSource<T extends Record<string, unknown>>(base: T, src: NetworkSource | undefined, key: string, fallbackAttribution?: string): T {
  if (src === undefined) return base
  const o: Record<string, unknown> = typeof src === 'string' ? (src.includes('{z}') ? { tiles: [src] } : { url: src }) : src
  const out: Record<string, unknown> = { ...base, ...o }
  if (o.tiles && !o.url) delete out.url
  if (o.url && !o.tiles) delete out.tiles
  if ((o.tiles || o.url) && !('attribution' in o)) {
    warnOnce(`network-attribution-${key}`, `config.network.${key} points at another server but sets no \`attribution\`: give it the provider's credit (pass an object, e.g. { tiles: [...], attribution: '© …' }).`)
    if (fallbackAttribution) out.attribution = fallbackAttribution
    else delete out.attribution
  }
  return out as T
}
