// Basemap loading and switching for the MapLibre adapter (`@element-editor/adapter-maplibre/basemaps`
// re-exports it with the `BASEMAPS` catalog from ./catalog).
// Only types are imported from maplibre-gl (it is a peer).
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { version } from '../../package.json'
import { getBasemapIds, rememberBasemap, type BasemapIds } from '../basemapIds'
import { type NetworkConfig } from '@element-editor/core'
import { overrideSource, OSM_ATTRIBUTION as OSM_DATA } from '@element-editor/core/internal'

/** The map-tile part of `config.network` (what the basemap styles read). */
export type BasemapNetwork = Pick<NetworkConfig, 'vectorTiles' | 'dem' | 'osmRaster' | 'glyphs' | 'sprite'>

export type BuiltinBasemapId = 'streets' | 'terrain' | 'light' | 'dark' | 'osm'

/**
 * A built-in id, `'auto'`, a MapLibre style (URL or object) or a raster `{ url }`. `id` names a
 * custom entry in the picker and in the remembered pick; give every style object one (two
 * id-less style objects can't be told apart).
 */
export type BasemapInput =
  | BuiltinBasemapId
  | 'auto'
  | { style: string | StyleSpecification; id?: string; label?: string; thumbnail?: string }
  | { url: string; attribution: string; maxZoom?: number; id?: string; label?: string; thumbnail?: string }

type Theme = 'light' | 'dark'
type Resolved = Exclude<BasemapInput, 'auto'>

/** Only `'auto'` changes: light theme -> streets, dark theme -> dark. */
export function resolveBasemap(input: BasemapInput, theme: Theme): Resolved {
  return input === 'auto' ? (theme === 'dark' ? 'dark' : 'streets') : input
}

const STYLE_FILES: Record<string, () => Promise<{ default: unknown }>> = {
  streets: () => import('./styles/streets.json'),
  terrain: () => import('./styles/terrain.json'),
  light: () => import('./styles/light.json'),
  dark: () => import('./styles/dark.json'),
}

export const DEFAULT_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

/** Default sprite (custom `*-badge` icons OpenFreeMap lacks), served from jsDelivr at the package's own version. */
export const DEFAULT_SPRITE_URL = `https://cdn.jsdelivr.net/npm/@element-editor/adapter-maplibre@${version}/basemaps/sprite`

// OpenFreeMap glyphs only have Noto Sans Regular/Bold/Italic; map each "Inter ..." font to the same weight.
const noto = (font: string) =>
  `Noto Sans ${/bold|medium|black|heavy/i.test(font) ? 'Bold' : /italic/i.test(font) ? 'Italic' : 'Regular'}`
const toNoto = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(toNoto) : typeof v === 'string' && v.startsWith('Inter ') ? noto(v) : v

/**
 * Raw style JSON (sources + layers) -> full MapLibre style, on the servers `network` names
 * (`vectorTiles` → the `openmaptiles` source, `dem` → `terrain-dem`, `glyphs`, `sprite`). Exported for tests.
 */
export function finishStyle(json: any, network: BasemapNetwork = {}): StyleSpecification {
  const sources = { ...json.sources }
  if (sources.openmaptiles) {
    // A new vector tile host: the OpenFreeMap credit goes, the OpenStreetMap data credit stays.
    sources.openmaptiles = overrideSource({ attribution: OFM_ATTRIBUTION, ...sources.openmaptiles }, network.vectorTiles, 'vectorTiles', OSM_DATA)
  }
  if (sources['terrain-dem']) sources['terrain-dem'] = overrideSource(sources['terrain-dem'], network.dem, 'dem')
  return {
    ...json,
    sources,
    glyphs: network.glyphs ?? DEFAULT_GLYPHS_URL,
    sprite: network.sprite ?? DEFAULT_SPRITE_URL,
    layers: json.layers.map((l: any) =>
      l.layout?.['text-font'] ? { ...l, layout: { ...l.layout, 'text-font': toNoto(l.layout['text-font']) } } : l,
    ),
  }
}

const rasterStyle = (url: string, attribution: string, maxzoom = 19): StyleSpecification => rasterSourceStyle({ tiles: [url], attribution, maxzoom })
const rasterSourceStyle = (src: Record<string, unknown>): StyleSpecification => ({
  version: 8,
  sources: { basemap: { type: 'raster', tileSize: 256, ...src } as StyleSpecification['sources'][string] },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
})

const cache = new Map<string, Promise<any>>()

/**
 * The MapLibre style for `input`. Built-ins use the servers `opts.network` names (the editor's
 * `config.network`: `vectorTiles`, `dem`, `glyphs`, `sprite`, `osmRaster`); a style URL is returned as-is.
 */
export async function loadBasemapStyle(
  input: BasemapInput,
  opts: { theme?: Theme; network?: BasemapNetwork } = {},
): Promise<StyleSpecification | string> {
  const network = opts.network ?? {}
  const r = resolveBasemap(input, opts.theme ?? 'light')
  if (typeof r === 'object') {
    if ('url' in r) return rasterStyle(r.url, r.attribution, r.maxZoom)
    return typeof r.style === 'string' ? r.style : structuredClone(r.style)
  }
  if (r === 'osm') return rasterSourceStyle(overrideSource({ tiles: [OSM_TILES], attribution: OSM_ATTRIBUTION, maxzoom: 19 }, network.osmRaster, 'osmRaster', OSM_ATTRIBUTION))
  if (!cache.has(r)) {
    const p = STYLE_FILES[r]().then((m) => m.default)
    p.catch(() => cache.delete(r)) // retry a failed chunk load next time
    cache.set(r, p)
  }
  return finishStyle(structuredClone(await cache.get(r)), network)
}

const isElm = (id: string) => id.startsWith('elm-')

/**
 * Carries everything that isn't the old basemap from the previous style over to the new one:
 * Element's `elm-*` sources and layers and, when `basemap` (the previous basemap's ids) is known,
 * the host's own sources and layers too. Carried layers keep their order relative to each other
 * and sit above the new basemap's layers. A carried source whose id the new basemap also uses is
 * dropped (the new basemap's wins). Without `basemap` only `elm-*` is carried.
 */
export function carryOverElm(prev: StyleSpecification | undefined, next: StyleSpecification, basemap?: BasemapIds): StyleSpecification {
  if (!prev) return next
  const keepSource = (id: string) => isElm(id) || (!!basemap && !basemap.sources.has(id) && !(id in next.sources))
  const sources = { ...next.sources }
  const carried = new Set<string>()
  for (const [id, s] of Object.entries(prev.sources ?? {})) if (keepSource(id)) { sources[id] = s; carried.add(id) }
  const layers = (prev.layers ?? []).filter((l) => {
    const src = 'source' in l && typeof l.source === 'string' ? l.source : undefined
    if (isElm(l.id) || (src && isElm(src))) return true
    if (!basemap || basemap.layers.has(l.id)) return false
    if (next.layers.some((n) => n.id === l.id)) return false // id clash with the new basemap
    return !src || carried.has(src)
  })
  return { ...next, sources, layers: [...next.layers, ...layers] }
}

const latest = new WeakMap<MapLibreMap, number>()

/**
 * Loads the basemap and applies it, keeping Element's layers and the host's own layers and sources
 * (those that weren't part of the previous basemap). The latest call wins.
 */
export async function setBasemap(
  map: MapLibreMap,
  input: BasemapInput,
  opts?: { theme?: Theme; network?: BasemapNetwork },
): Promise<void> {
  const ticket = (latest.get(map) ?? 0) + 1
  latest.set(map, ticket)
  const style = await loadBasemapStyle(input, opts)
  if (latest.get(map) !== ticket) return
  // Element's images (and, after a full rebuild, the selection's feature-state) are put back by
  // ElementEditorControls itself, as after any `setStyle`. The host's `addImage` images are not
  // carried: re-add them from a `styleimagemissing` listener.
  map.setStyle(style, {
    transformStyle: (prev, next) => {
      const out = carryOverElm(prev, next, getBasemapIds(map))
      rememberBasemap(map, next)
      return out
    },
  })
}
