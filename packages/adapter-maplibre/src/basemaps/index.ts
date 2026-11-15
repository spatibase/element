// Framework-neutral basemap catalog for the MapLibre adapter (`@element-editor/adapter-maplibre/basemaps`).
// Only types are imported from maplibre-gl (it is a peer).
export { resolveBasemap, loadBasemapStyle, setBasemap, DEFAULT_GLYPHS_URL, DEFAULT_SPRITE_URL } from './style'
export type { BasemapInput, BuiltinBasemapId, BasemapNetwork } from './style'
export { BASEMAPS } from './catalog'
