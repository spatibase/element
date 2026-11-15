import { forwardRef, useCallback, useRef, useState, type ForwardedRef } from 'react'
import type { Map as MapLibreMap, MapOptions } from 'maplibre-gl'
import { BasemapControl, type FeatureStyleFn } from '@element-editor/adapter-maplibre'
import type { BasemapInput } from '@element-editor/adapter-maplibre/basemaps'
import { readStorage, writeStorage, type PersistScope } from '@element-editor/core'
import { warnOnce, isDevBuild } from '@element-editor/core/internal'
import { ElementEditorShell } from '../shell/ElementEditorShell'
import type { ElementEditorRef as ShellRef } from '../shell/ElementEditorShell'
import type { ElementEditorBaseProps } from '../shell/types'
import MapLibreMapView, { type MapSetup } from './MapLibreMapView'
import { pickMapOptions } from '../shell/savedView'
import { useBasemapState, type BasemapRefAPI } from '../shell/useBasemapState'

export type { ImportResult } from '../shell/ElementEditorShell'

/**
 * Imperative handle of `<ElementEditor ref>` (MapLibre); `getMap()` returns the `maplibregl.Map`,
 * `getBasemap()` / `setBasemap()` read and switch the basemap.
 */
export type ElementEditorRef = ShellRef<MapLibreMap> & BasemapRefAPI<BasemapInput>

/** `maplibregl.Map` options Element sets itself, with what to use instead (dev warning). */
const OWNED: Record<OwnedMapOption, string> = {
  container: 'Element creates the map container.',
  style: 'Use the `basemap` / `defaultBasemap` prop.',
  center: 'Use `initialView`.',
  zoom: 'Use `initialView`.',
  bounds: 'Use `initialView={{ bounds }}`.',
  fitBoundsOptions: 'Use `initialView`.',
  maxBounds: 'Use the `bounds` prop.',
  attributionControl: "Element shows the attribution (move it into the status bar with the 'attribution' layout control).",
  interactive: 'Element turns map interactions on and off while editing.',
  dragPan: 'Element turns dragPan on and off while editing.',
  boxZoom: 'Element turns boxZoom on and off while editing.',
  doubleClickZoom: 'Element turns doubleClickZoom on and off while editing.',
}

/** `maplibregl.Map` options that Element sets itself; not accepted in `mapOptions`. */
export type OwnedMapOption =
  | 'container' | 'style' | 'center' | 'zoom' | 'bounds' | 'fitBoundsOptions' | 'maxBounds'
  | 'attributionControl' | 'interactive' | 'dragPan' | 'boxZoom' | 'doubleClickZoom'

const BASEMAP_KEY = 'elm_basemap'
const BUILTIN: BasemapInput[] = ['auto', 'streets', 'terrain', 'light', 'dark', 'osm']

export interface ElementEditorProps extends ElementEditorBaseProps {
  /**
   * The basemap shown, controlled by your app: a built-in id (`'streets' | 'terrain' | 'light' |
   * 'dark' | 'osm'`), `'auto'` (light/dark follows the editor theme), a raster `{ url }` or a
   * MapLibre style. Update it from `onBasemapChange`, or the picker can't change it. Nothing is
   * remembered in localStorage. It doesn't have to be in `basemaps` (the picker then shows none
   * selected). Give a style object an `id` (or keep it stable): an id-less inline object counts as
   * a new basemap on every render. Leave it out to let Element keep the choice (`defaultBasemap`).
   */
  basemap?: BasemapInput
  /**
   * Starting basemap when `basemap` isn't set. The user's pick from the picker is remembered
   * (localStorage `elm_basemap`, namespaced by `config.persistKey`) and wins over it on reload.
   * Default `'auto'`.
   */
  defaultBasemap?: BasemapInput
  /**
   * Called with the newly chosen basemap, as it appears in `basemaps` (`'auto'` stays `'auto'`;
   * resolve it with `resolveBasemap(b, theme)`), when the user picks one or you call
   * `ref.setBasemap()`. Not called when `'auto'` follows a theme change or when `basemap` changes.
   */
  onBasemapChange?: (basemap: BasemapInput) => void
  /** Choices shown in the picker. Default: `'auto'` + all built-ins. `false` hides the picker. */
  basemaps?: BasemapInput[] | false
  /**
   * Per-feature style: return a `FeatureStyle` `{ color, fillColor, opacity, fillOpacity, weight }`
   * (any key optional; `fillColor` falls back to `color`) or `undefined`/`null` for the default look.
   * Applies to polygons, lines and points, including features drawn later. Wins over `featureColor`
   * per key; the selected / hovered looks win over both. Called for every feature whenever the
   * features change, so keep it fast, and keep it stable (module-level or `useCallback`): a new
   * function re-sends all features to the map.
   *
   * @example getFeatureStyle={() => ({ color: '#00a2f0', fillColor: '#00a2f0' })}
   */
  getFeatureStyle?: FeatureStyleFn
  /**
   * Extra `maplibregl.Map` options: `pitch`, `bearing`, `minZoom`, `maxZoom`, `hash`, `locale`,
   * `transformRequest`, … Read once, when the map is created; change them later on the map itself
   * (`onMapReady` / `ref.getMap()`, e.g. `map.setMaxZoom(18)`). Options Element sets itself
   * (`style`, `center`, `zoom`, `bounds`, `maxBounds`, `attributionControl`, the drag / box /
   * double-click zoom handlers, …) are left out; use `basemap`, `initialView` and `bounds`.
   * `hash: true` lets the URL's view win over `initialView`.
   */
  mapOptions?: Partial<Omit<MapOptions, OwnedMapOption>>
  /**
   * Called once per map, as soon as Element's sources and layers (`elm-*`) are on it: the place to
   * add your own sources and layers (pass an `elm-*` id as `beforeId` to put yours under
   * Element's). Basemap switches keep them. Your own `map.setStyle()` drops them: Element restores
   * its own, and a `style.load` listener added here runs after that. If the editor remounts, it is called again with the
   * new map (the old one is removed).
   */
  onMapReady?: (map: MapLibreMap) => void
}

const optionId = (b: BasemapInput) => (typeof b === 'string' ? b : b.id)

const isAnonStyle = (b: BasemapInput | undefined): boolean =>
  typeof b === 'object' && !b.id && !b.label && 'style' in b && typeof b.style !== 'string'

/** Dev warning: a controlled id-less style object that is a new (but equal) object each render re-applies the style every time. */
function useAnonStyleWarning(basemap: BasemapInput | undefined) {
  const prev = useRef(basemap)
  if (isDevBuild() && basemap !== prev.current && isAnonStyle(basemap) && isAnonStyle(prev.current)
    && JSON.stringify(basemap) === JSON.stringify(prev.current)) {
    warnOnce('basemap-anon-style', '<ElementEditor basemap>: an id-less style object is passed as a new object on every render, so the style is re-applied each time. Give it an `id` or keep the object stable (module-level or useMemo).')
  }
  prev.current = basemap
}

/** The uncontrolled basemap the map starts with: a stored user choice (if still offered) else `defaultBasemap`. */
function initialChoice(basemap: BasemapInput, basemaps: BasemapInput[] | false, scope?: PersistScope): BasemapInput {
  if (basemaps === false) return basemap
  const saved = readStorage(BASEMAP_KEY, scope)
  return basemaps.find((b) => saved && optionId(b) === saved) ?? basemap
}

// Leaflet-only props a plain-JS caller may still pass after the default entry became MapLibre.
const LEAFLET_ONLY = ['tileLayer', 'renderer'] as const

export const ElementEditor = forwardRef<ElementEditorRef, ElementEditorProps>(
  ({ basemap, defaultBasemap = 'auto', onBasemapChange, basemaps, getFeatureStyle, mapOptions, onMapReady, ...rest }, ref) => {
    for (const p of LEAFLET_ONLY) {
      if ((rest as Record<string, unknown>)[p] !== undefined) {
        warnOnce(`maplibre-${p}`, `<ElementEditor ${p}> is a Leaflet prop and is ignored by the default (MapLibre) editor. Import ElementEditor from '@element-editor/react/leaflet' (and '@element-editor/react/leaflet/style.css') to keep using it.`)
      }
    }
    const choices = basemaps === undefined ? BUILTIN : basemaps
    // The current choice lives here (always mounted), not in the picker: MapLibreMapView applies it and
    // keeps 'auto' following the theme even while the picker is hidden or unmounted.
    const { current: choice, pick, api } = useBasemapState(
      basemap,
      () => initialChoice(defaultBasemap, choices, rest.config),
      onBasemapChange,
      (b) => { const id = optionId(b); if (id) writeStorage(BASEMAP_KEY, id, rest.config) },
      choices !== false,
    )
    useAnonStyleWarning(basemap)
    // Creation-time inputs: the first values only, in a stable object so the memoised map view
    // doesn't re-render for inline `mapOptions` / `initialView` objects.
    const [setup] = useState<MapSetup>(() => ({
      initialView: rest.initialView,
      initialData: rest.initialData,
      bounds: rest.bounds,
      mapOptions: pickMapOptions(mapOptions as Partial<MapOptions> | undefined, OWNED, 'maplibre'),
    }))
    // Latest callback, behind a stable function (same reason).
    const onMapReadyRef = useRef(onMapReady)
    onMapReadyRef.current = onMapReady
    const onReady = useCallback((map: MapLibreMap) => onMapReadyRef.current?.(map), [])

    return (
      <ElementEditorShell
        {...rest}
        ref={ref as ForwardedRef<ShellRef>}
        extraApi={api}
        engine="maplibre"
        // The shell renders the picker in its 'basemap' layout slot, outside the adapter's context, and
        // no `map` is passed: it is a plain value/onChange picker. The pick is remembered here (only
        // when uncontrolled), not by the picker's `storageKey`.
        basemapControl={choices === false ? undefined : (
          <BasemapControl
            basemaps={choices}
            value={choice}
            onChange={(b) => pick(b, true)}
          />
        )}
        renderMap={({ attributionTarget, attributionCorner, themeMode }) => (
          <MapLibreMapView
            basemap={choice}
            themeMode={themeMode}
            attributionTarget={attributionTarget}
            attributionCorner={attributionCorner}
            getFeatureStyle={getFeatureStyle}
            setup={setup}
            onReady={onReady}
          />
        )}
      />
    )
  },
)

ElementEditor.displayName = 'ElementEditor'
