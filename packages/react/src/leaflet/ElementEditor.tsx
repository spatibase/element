import React, { forwardRef, useCallback, useMemo, useRef, useState, type ForwardedRef } from 'react'
import { TileLayer } from 'react-leaflet'
import { BasemapPicker } from '@element-editor/ui'
import type { RasterBasemap } from '@element-editor/ui'
import type { FeatureStyleFn } from '@element-editor/adapter-leaflet'
import type { Map as LeafletMap, MapOptions } from 'leaflet'
import { ElementEditorShell } from '../shell/ElementEditorShell'
import type { ElementEditorRef as ShellRef } from '../shell/ElementEditorShell'
import type { ElementEditorBaseProps } from '../shell/types'
import MapView, { type MapSetup } from './MapView'
import { pickMapOptions } from '../shell/savedView'
import { readStorage, writeStorage, type NetworkSource } from '@element-editor/core'
import { warnOnce, overrideSource } from '@element-editor/core/internal'
import { useBasemapState, type BasemapRefAPI } from '../shell/useBasemapState'
import osmThumb from './osm-thumb.webp'

export type { ImportResult } from '../shell/ElementEditorShell'

/** A Leaflet drop-in basemap: a raster entry or `'osm'` (OpenStreetMap). */
export type LeafletBasemap = RasterBasemap | 'osm'

/**
 * Imperative handle of the Leaflet `<ElementEditor ref>`; `getMap()` returns the `L.Map`,
 * `getBasemap()` / `setBasemap()` read and switch the basemap.
 */
export type ElementEditorRef = ShellRef<LeafletMap> & BasemapRefAPI<LeafletBasemap>

/** `L.Map` options Element sets itself; not accepted in `mapOptions`. */
export type OwnedMapOption =
  | 'center' | 'zoom' | 'maxBounds' | 'zoomControl' | 'attributionControl' | 'crs' | 'renderer'
  | 'preferCanvas' | 'dragging' | 'boxZoom' | 'doubleClickZoom'

/** `L.Map` options Element sets itself, with what to use instead (dev warning). */
const OWNED: Record<OwnedMapOption | 'bounds' | 'boundsOptions', string> = {
  center: 'Use `initialView`.',
  zoom: 'Use `initialView`.',
  bounds: 'Use `initialView={{ bounds }}`.',
  boundsOptions: 'Use `initialView`.',
  maxBounds: 'Use the `bounds` prop.',
  zoomControl: "Element has its own zoom control (the 'zoom' layout control).",
  attributionControl: "Element shows the attribution (move it into the status bar with the 'attribution' layout control).",
  crs: "Element's editing tools assume Web Mercator (EPSG:3857).",
  renderer: 'Use the `renderer` prop.',
  preferCanvas: 'Use the `renderer` prop.',
  dragging: 'Element turns dragging on and off while editing.',
  boxZoom: 'Element turns boxZoom on and off while editing.',
  doubleClickZoom: 'Element turns doubleClickZoom on and off while editing.',
}

const BASEMAP_KEY = 'elm_basemap_leaflet'
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
/** The `'osm'` entry, on `config.network.osmRaster` when set (a tile URL template: Leaflet can't read TileJSON). */
function osmBasemap(src: NetworkSource | undefined): RasterBasemap {
  const s = overrideSource<{ tiles?: string[]; url?: string; attribution?: string; maxzoom?: number }>(
    { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: OSM_ATTRIBUTION }, src, 'osmRaster', OSM_ATTRIBUTION)
  return { id: 'osm', label: 'OpenStreetMap', thumbnail: osmThumb, url: s.tiles?.[0] ?? s.url ?? '', attribution: s.attribution ?? '', ...(s.maxzoom !== undefined && { maxZoom: s.maxzoom }) }
}
/** Picker / remembered-pick key: `id`, else the tile URL. */
const keyOf = (b: LeafletBasemap) => (b === 'osm' ? 'osm' : b.id ?? b.url)

export interface ElementEditorProps extends ElementEditorBaseProps {
  /**
   * Tile layer to render under the features. Pass any react-leaflet tile
   * component (`<TileLayer />`, `<MapboxTileLayer />`, vector tiles, etc.).
   * If omitted, defaults to OpenStreetMap.
   *
   * Example:
   *   tileLayer={<TileLayer url="https://tiles.example.com/{z}/{x}/{y}.png" attribution="..." />}
   */
  tileLayer?: React.ReactNode
  /**
   * Raster basemaps to choose from. The first entry is the default (a single entry is simply
   * used as the basemap); with two or more entries a basemap picker appears and the user's pick
   * is remembered (localStorage `elm_basemap_leaflet`, namespaced by `config.persistKey`). `'osm'` is OpenStreetMap. Off by default
   * (a single OpenStreetMap layer). Entries are told apart by `id`, else by `url`. Ignored when `tileLayer` is set.
   */
  basemaps?: LeafletBasemap[]
  /**
   * The basemap shown, controlled by your app: an entry of `basemaps` (matched by `id`, else
   * `url`), `'osm'`, or any other raster basemap (the picker then shows none selected). Update it
   * from `onBasemapChange`, or the picker can't change it. Nothing is remembered in localStorage.
   * Leave it out to let Element keep the choice (`defaultBasemap`). Ignored when `tileLayer` is set.
   */
  basemap?: LeafletBasemap
  /**
   * Starting basemap when `basemap` isn't set. Default: the first `basemaps` entry. The user's
   * remembered pick wins over it on reload.
   */
  defaultBasemap?: LeafletBasemap
  /** Called with the newly chosen basemap (as it appears in `basemaps`) when the user picks one or you call `ref.setBasemap()`. Not called when `basemap` changes. */
  onBasemapChange?: (basemap: LeafletBasemap) => void
  /**
   * How unselected features are drawn. `'canvas'` (default) paints them on one
   * shared `<canvas>`, which keeps panning and zooming smooth with thousands of
   * features. `'svg'` gives every feature its own `<path>` element. Selected
   * features and editing handles are always SVG.
   */
  renderer?: 'canvas' | 'svg'
  /**
   * Per-feature style: return a `FeatureStyle` `{ color, fillColor, opacity, fillOpacity, weight }`
   * or any Leaflet `PathOptions` (`dashArray`, …); `fillColor` falls back to `color`; `undefined`/`null`
   * = default look. Applies to polygons, lines and point pins (pins take `fillColor`, then `color`).
   * Wins over `featureColor` per key; the selected / hovered looks win over both. Called on every
   * render of each feature, so keep it fast and stable (module-level or `useCallback`).
   *
   * @example getFeatureStyle={(f) => ({ color: f.properties.status === 'done' ? '#16a34a' : '#00a2f0' })}
   */
  getFeatureStyle?: FeatureStyleFn
  /**
   * Extra `L.Map` options: `minZoom`, `maxZoom`, `zoomSnap`, `scrollWheelZoom`, `worldCopyJump`,
   * `maxBoundsViscosity`, … Read once, when the map is created; change them later on the map
   * itself (`onMapReady` / `ref.getMap()`, e.g. `map.setMaxZoom(18)`). Options Element sets itself
   * (`center`, `zoom`, `maxBounds`, `crs`, `renderer`, the zoom / attribution controls, the drag /
   * box / double-click zoom handlers) are left out; use `initialView`, `bounds` and `renderer`.
   */
  mapOptions?: Omit<MapOptions, OwnedMapOption>
  /**
   * Called once per map, as soon as Element's layers and panes are on it: the place to add your
   * own layers. If the editor remounts, it is called again with the new map (the old one is
   * removed).
   */
  onMapReady?: (map: LeafletMap) => void
}

export const ElementEditor = forwardRef<ElementEditorRef, ElementEditorProps>(({ tileLayer, basemaps, basemap, defaultBasemap, onBasemapChange, renderer, getFeatureStyle, mapOptions, onMapReady, ...rest }, ref) => {
  // Creation-time inputs: the first values only, in a stable object so the memoised map view
  // doesn't re-render for inline `mapOptions` / `initialView` objects.
  const [setup] = useState<MapSetup>(() => ({
    initialView: rest.initialView,
    initialData: rest.initialData,
    bounds: rest.bounds,
    mapOptions: pickMapOptions(mapOptions as Partial<MapOptions> | undefined, OWNED, 'leaflet'),
  }))
  // Latest callback, behind a stable function (same reason).
  const onMapReadyRef = useRef(onMapReady)
  onMapReadyRef.current = onMapReady
  const onReady = useCallback((map: LeafletMap) => onMapReadyRef.current?.(map), [])
  if (tileLayer && (basemaps || basemap || defaultBasemap || onBasemapChange)) {
    warnOnce('leaflet-tileLayer-basemaps', '<ElementEditor tileLayer> overrides `basemaps`, `basemap`, `defaultBasemap` and `onBasemapChange`: they are ignored (and no basemap picker is shown).')
  }
  const osmSrc = rest.config?.network?.osmRaster
  const osm = useMemo(() => osmBasemap(osmSrc), [JSON.stringify(osmSrc)]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on content (inline config)
  const toRaster = (b: LeafletBasemap): RasterBasemap => (b === 'osm' ? osm : b)
  // No list = OpenStreetMap only.
  const list = basemaps ?? ['osm' as const]
  const pickerShown = !tileLayer && list.length >= 2
  // Any list picks the layer (first entry by default); the picker only adds the UI to switch.
  const { current, pick, api } = useBasemapState<LeafletBasemap>(
    tileLayer ? undefined : basemap,
    () => {
      const saved = readStorage(BASEMAP_KEY, rest.config)
      return list.find((b) => keyOf(b) === saved) ?? defaultBasemap ?? list[0]
    },
    onBasemapChange,
    (b) => writeStorage(BASEMAP_KEY, keyOf(b), rest.config),
    pickerShown,
  )
  // Memoised on the basemap's values: `basemaps` is often an inline array (new objects every render).
  const { url, attribution, maxZoom } = toRaster(current)
  const layer = useMemo(() => tileLayer ?? (
    // No `maxZoom={undefined}`: Leaflet would copy it over the default and the map's max zoom becomes NaN (fitBounds breaks).
    <TileLayer key={url} url={url} attribution={attribution} {...(maxZoom !== undefined && { maxZoom })} />
  ), [tileLayer, url, attribution, maxZoom])
  return (
    <ElementEditorShell
      {...rest}
      ref={ref as ForwardedRef<ShellRef>}
      extraApi={api}
      engine="leaflet"
      basemapControl={pickerShown && (
        <BasemapPicker
          options={list.map((b) => { const r = toRaster(b); return { id: keyOf(b), label: r.label ?? keyOf(b), thumbnail: r.thumbnail } })}
          value={keyOf(current)}
          onChange={(id) => { const b = list.find((x) => keyOf(x) === id); if (b) pick(b, true) }}
        />
      )}
      renderMap={({ attributionTarget, attributionCorner }) => <MapView tileLayer={layer} renderer={renderer} getFeatureStyle={getFeatureStyle} attributionTarget={attributionTarget} attributionCorner={attributionCorner} setup={setup} onReady={onReady} />}
    />
  )
})

ElementEditor.displayName = 'ElementEditor'
