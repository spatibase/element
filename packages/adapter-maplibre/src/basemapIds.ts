import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

/** Layer and source ids that belong to the map's current basemap (not Element's, not the host's). */
export interface BasemapIds { layers: Set<string>; sources: Set<string> }

// A global-registry symbol on the map, not a module WeakMap: this file is shared by the main entry
// and the lazy `basemaps` entry, which a consumer may load as separate module instances.
const KEY = Symbol.for('elm.basemapIds')
const isElm = (id: string) => id.startsWith('elm-')

/** The recorded basemap ids of `map`, or undefined when none were recorded. */
export const getBasemapIds = (map: MapLibreMap): BasemapIds | undefined =>
  (map as unknown as Record<symbol, BasemapIds | undefined>)[KEY]

/** Records the non-`elm-*` layers and sources of `style` as the basemap of `map`. */
export function rememberBasemap(map: MapLibreMap, style: Pick<StyleSpecification, 'layers' | 'sources'> | undefined) {
  if (!style) return
  ;(map as unknown as Record<symbol, BasemapIds>)[KEY] = {
    layers: new Set((style.layers ?? []).map((l) => l.id).filter((id) => !isElm(id))),
    sources: new Set(Object.keys(style.sources ?? {}).filter((id) => !isElm(id))),
  }
}
