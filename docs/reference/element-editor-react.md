# @element-editor/react

*Complete API reference for the self-contained map editor component.*

`@element-editor/react` is the MapLibre drop-in. The Leaflet version is the same component imported from `@element-editor/react/leaflet`; differences are called out [below](#leaflet-drop-in).

---

## Install

```bash
npm install @element-editor/react maplibre-gl
```

### Peer dependencies

| Package | Version | Notes |
|---|---|---|
| `react` | `^19.2` | required |
| `react-dom` | `^19.2` | required |
| `maplibre-gl` | 5.5 or 6 | optional peer, but required for the default (MapLibre) entry; the Leaflet entry never loads it |
| `@element-editor/adapter-leaflet`, `leaflet` (`^1.9`), `react-leaflet` (`^5`) | | optional, only for `@element-editor/react/leaflet` |

React 18 is not supported: the data table (`react-data-grid`) requires React 19.2 or newer.

On MapLibre GL JS 6 the drop-in loads MapLibre's worker from jsDelivr (the installed version) unless your app calls MapLibre's `setWorkerUrl` first; MapLibre 5 has the worker built in. See [MapLibre GL JS 6 worker](../guides/third-party-services.md#maplibre-gl-js-6-worker).

`@element-editor/react` installs `@element-editor/core`, `@element-editor/ui` and `@element-editor/adapter-maplibre` as regular dependencies (they are not bundled into it), so there is one copy of each store and context. The background geometry worker is inlined into the package, so no bundler configuration is needed. CommonJS builds are `.cjs` files; type declarations reference the other packages by name.

### Entry points

| Import | What |
|---|---|
| `@element-editor/react` | MapLibre drop-in |
| `@element-editor/react/style.css` | its stylesheet (bundles `maplibre-gl.css`) |
| `@element-editor/react/leaflet` | Leaflet drop-in |
| `@element-editor/react/leaflet/style.css` | its stylesheet (bundles Leaflet's CSS) |

Both entries export the same engine-neutral types and helpers (see [Exports](#exports)).

### CSS import

> **Warning:** This import is required. Without it, the map's controls and the editor panels are unstyled. The JavaScript entry doesn't import any CSS.

```tsx
import '@element-editor/react/style.css'
```

Place this import once, near your application entry point. The stylesheet already includes MapLibre's CSS and the data table's CSS, so you don't need to import `maplibre-gl/dist/maplibre-gl.css` separately.

The stylesheet doesn't reset your page. Tailwind's base styles (preflight) apply only inside the editor (elements under `[data-elm-theme]`, which `<ElementEditor>` sets on its root), so your own headings, buttons and SVGs keep their styles.

---

## `<ElementEditor>`

```tsx
import { ElementEditor } from '@element-editor/react'
```

The component fills its container element. The parent element must have an explicit height. In development, the editor warns in the console when it has no height (a blank map) or when its stylesheet isn't loaded.

```tsx
<div style={{ width: '100%', height: '600px' }}>
  <ElementEditor onChange={(data) => console.log(data)} />
</div>
```

---

## `ElementEditorProps`

| Prop | Type | Default | Required | Description |
|---|---|---|---|---|
| `initialData` | `FeatureCollectionInput \| GeoJSONFeatureInput \| null` | — | No | The starting data: any GeoJSON `FeatureCollection` (a `GeoJSON.FeatureCollection` from `@types/geojson` type-checks as is) or a single `Feature`. Applied on mount, with no undo step and no `onChange`. Data that arrives later (`null`/`undefined` → data, e.g. after a fetch) is applied once too, while the editor is still empty and the user hasn't edited, and the map fits it as it would on mount (see `initialView`). Any other later change is ignored, with a development warning: to replace the data call `ref.setFeatureCollection(data, { silent: true })`, or remount with a new `key`. Invalid data doesn't crash the editor: it reports an `error` event and starts empty; features with `geometry: null` are left out and reported the same way (`code: 'invalid-data'`, `source: 'import'`). |
| `initialView` | `{ center: [lng, lat]; zoom: number } \| { bounds: BBox } \| 'data'` | see below | No | Where the map starts: a centre and zoom, a GeoJSON bbox `[west, south, east, north]` to fit, or `'data'` to fit `initialData`. Wins over the view remembered from the last visit. Read once, when the map is created. Without it the map starts at, in order: the remembered view (`elm_mapView`; none with `config.persist: false`), a fit of `initialData` when it has features (so a first visit shows your data), a fit of `bounds`, Europe at zoom 5. `'data'` with no features falls back the same way. With MapLibre's `mapOptions.hash`, the URL's view wins. See [Setting up the map](#setting-up-the-map). |
| `schema` | `Schema` | — | No | A schema added on mount (and when a schema with a new `id` is passed later): the fields the feature panel and data table show. Features follow the schema their `schemaId` names, else the first one. Users can add more schemas in the editor; schemas in `initialData.metadata.schemas` load too. |
| `basemap` | `BasemapInput` | — | No | The basemap shown, **controlled** by your app: a built-in id (`'streets' \| 'terrain' \| 'light' \| 'dark' \| 'osm'`), `'auto'` (Streets in a light editor, Dark in a dark one), a vector style (`{ style: url \| StyleSpecification }`) or a raster source (`{ url, attribution }`). Changing it switches the basemap; update it from `onBasemapChange` or the picker can't change it (dev warning). Reads and writes no `localStorage`. May be off the `basemaps` list (the picker shows none selected). Give a style object an `id` or keep it stable. Leave it out for an uncontrolled editor (`defaultBasemap`). See [Basemaps](../guides/basemaps.md#controlling-the-basemap-from-your-app). |
| `defaultBasemap` | `BasemapInput` | `'auto'` | No | Starting basemap when `basemap` isn't set. The user's pick in the picker is remembered in `localStorage` (`elm_basemap`, namespaced by `config.persistKey`) and wins over it on reload. Custom entries take an optional `id` (used to tell them apart and to remember the pick). |
| `onBasemapChange` | `(basemap: BasemapInput) => void` | — | No | Called with the chosen entry (as in `basemaps`; `'auto'` stays `'auto'`) when the user picks a basemap or you call `ref.setBasemap()`. Not called when `'auto'` follows a theme change or when `basemap` changes. |
| `basemaps` | `BasemapInput[] \| false` | `'auto'` + all built-ins | No | Choices offered in the basemap picker. `false` hides the picker. |
| `tools` | `DrawTool[]` | all tools | No | Restrict which tools appear (drawing tools plus `'picker'`, `'measure'`, `'search'`). Keyboard shortcuts for excluded tools are suppressed automatically. |
| `maxFeatures` | `number` | — | No | Maximum number of features. Enforced by the store for every way of adding features: drawing tools and their shortcuts are disabled at the limit, duplicate, paste and break apart are refused, and imports are truncated (`ImportResult.truncated`). Each refusal reports an `error` event. Undo and redo are never blocked. |
| `bounds` | `BBox` (`[west, south, east, north]`) | — | No | Maximum map bounds: the user can't pan outside this box. The map starts fitted to it only when nothing else gives a start view (see `initialView`). A GeoJSON bbox in `[lng, lat]` order, on both engines, e.g. `bounds={[14.2, 49.9, 14.7, 50.2]}`. Reactive. *Deprecated:* the nested `[[south, west], [north, east]]` (`[lat, lng]`) form still works and logs a one-time dev warning with the bbox equivalent. |
| `theme` | `'light' \| 'dark' \| 'auto'` | follows the OS (`config.mode`, default `'system'`) | No | Light or dark mode only. `'light'` / `'dark'`: that mode (never saved to `localStorage`). `'auto'`: follows the OS preference. Colours go through `accentColor` or CSS variables in `style` (see [Theming](../guides/theming.md)). |
| `accentColor` | `string` | `config.accentColor`, else blue (`#3b82f6`) | No | Brand accent: any CSS colour. The whole primary 50–950 scale (buttons, active tools, selection, checkboxes, map highlights, portals) is generated from it. Wins over `config.accentColor`; updates live. See [Theming](../guides/theming.md#approach-1--one-brand-colour). |
| `featureColor` | `string` | `config.featureColor`, else slate (`#475569`; `#94a3b8` on a dark MapLibre basemap) | No | Default colour of every feature: polygon outline and fill, lines, points, including features drawn later. Any CSS colour; opacity and weight keep their defaults. Wins over `config.featureColor`; `getFeatureStyle` and the selected look win over it, hover keeps it. Updates live. See [Colouring features](../guides/theming.md#colouring-features). |
| `getFeatureStyle` | `(feature: GeoJSONFeature) => FeatureStyle \| undefined \| null` | — | No | Per-feature colours for data-driven styling. Return `{ color, fillColor, opacity, fillOpacity, weight }` (any key optional; `fillColor` falls back to `color`) or `null` for the default look. Wins over `featureColor` per key; the selected look wins over it, hover keeps it. Same signature as the adapters' `getFeatureStyle`. Keep it fast and stable (module-level or `useCallback`): a new function re-sends every feature to the map. Leaflet drop-in: may also return any Leaflet `PathOptions`. See [Colouring features](../guides/theming.md#colouring-features). |
| `layout` | `'panel' \| 'minimal' \| 'split'` | `'panel'` | No | Where feature details and the list live. `'panel'`: a layers sidebar on the right of the map (list + selected feature's properties). `'minimal'`: no sidebar; a selected feature's properties open in a floating window. `'split'`: no sidebar; the bottom third of the editor is a panel with the data table on the left and the layers panel (320 px wide) on its right; map controls sit above it. `config.ui.dataTable: false` / `layerList: false` leave either part out. |
| `readonly` | `boolean` | `false` | No | View-only for the user: drawing and editing tools, editing shortcuts and drag handles are off; features stay visible and selectable, and `'measure'` and search still work. Reactive. Your app stays in charge: the ref's data methods (`addFeature`, `updateFeature`, `setFeatureCollection`, …) keep working; only `ref.setTool` is refused (except `'measure'`). What stays available and what is off: [Restricting tools](../guides/restricting-tools.md#disabling-all-editing). |
| `fileDrop` | `boolean` | `true` | No | Dropping a `.geojson` / `.json` file on the editor imports it like `Cmd+O`: replaces the data (one undo step), fits the map. Off in `readonly`. |
| `renderer` | `'canvas' \| 'svg'` | `'canvas'` | No | **Leaflet drop-in only**; not accepted by the MapLibre drop-in (MapLibre renders features in one GeoJSON source). How unselected polygons and lines are drawn. `'canvas'` paints them on one shared `<canvas>`, so panning and zooming stay smooth with thousands of features. `'svg'` gives each feature its own `<path>` (for apps that style or query feature paths through CSS or the DOM). Selected features and editing handles are always SVG. |
| `className` | `string` | — | No | CSS class applied to the root element. |
| `style` | `React.CSSProperties` (plus `--*` CSS variables) | — | No | Inline styles on the root element, applied after Element's own and after `accentColor`, so they win. The place for CSS variables: `{ '--elm-accent': '#7c3aed' }` recolours the whole primary scale, `'--elm-primary-N'` one shade, and the design tokens (`'--elm-surface'`, `'--elm-text'`, `'--elm-radius'`, `'--elm-font'`, …) restyle the chrome. Its CSS variables are also copied onto Element's body-level portals (modals, menus, tooltips). See [Theming](../guides/theming.md). |
| `onChange` | `(data: FeatureCollection) => void` | — | No | Fires after every committed change (an add, a finished drag, a property edit, an undo, an import, the ref's data methods) with the full current `FeatureCollection`, ready to store and pass back as `initialData`. Not during a drag, and not for the `initialData` load. `ref.setFeatureCollection()` fires it unless you pass `{ silent: true }`. |
| `onSubmit` | `(data: FeatureCollection) => void` | — | No | Called by the "Apply changes" button or `ref.submit()` when every feature passes validation (`ref.validate()`), with the full current data. Shows the "Apply changes" button (bottom-left by default; place it with `'applyChanges'` in `config.ui.layout`). |
| `onValidationError` | `(errors: Record<string, string[]>) => void` | — | No | Called instead of `onSubmit` when a submit finds validation errors (missing required fields, numbers out of range, zero-area polygons). Keys are feature IDs; values are arrays of error messages. To check without submitting, use `ref.validate()`. |
| `onFeatureSelect` | `(feature: GeoJSONFeature \| null) => void` | — | No | Called with the selected feature when exactly one is selected, and with `null` when that ends (deselected, or a second feature joins the selection). Called again when that feature is edited, so it suits a one-feature details panel. For the full selection (multi-select, lasso), use `onSelectionChange`. |
| `onZoomChange` | `(zoom: number) => void` | — | No | Fires when the map zoom level changes. |
| `onEvent` | `(event: ElementEditorEvent) => void` | — | No | Receives every message the editor would show the user. When provided, the editor is fully silent: no toasts, and the host application surfaces notifications. Without it, `<ElementEditor>` renders its own `<Toaster>`, so you don't need to add one. Read once at mount. See [Events](./events.md#onevent). |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | — | No | Called first for every runtime failure (also with `onEvent` set, for quiet failures without a toast, and for a render crash, `code: 'crash'`), with a stable `code`, a `source` and an honest English `message`. Return `false` to stop the built-in toast and the `onEvent` error event, or a string to show that text instead. See [Events](./events.md#onerror). |
| `onFeatureAdd` | `(feature: GeoJSONFeature) => void` | — | No | Fires once per newly added feature. |
| `onFeatureUpdate` | `(id: string, feature: GeoJSONFeature) => void` | — | No | Fires when a feature's geometry or properties change (on commit, not during a drag). |
| `onFeatureDelete` | `(id: string) => void` | — | No | Fires once per deleted feature, including bulk and group deletions. |
| `onSelectionChange` | `(ids: string[]) => void` | — | No | Fires with the selected ids whenever the selection changes, including multi-select and lasso (`[]` when cleared). |
| `onToolChange` | `(tool: DrawTool \| null) => void` | — | No | Fires with the tool that turned on (as `ref.getTool()` reports it), or `null` when the active tool turned off, whether the user or your app changed it. |
| `routingApiKey` | `string` | — | No | **Deprecated** (dev warning): use `config.network.routing.apiKey`, which wins when both are set. OpenRouteService key for the Route tool, per editor. |
| `mapOptions` | `Partial<Omit<maplibregl.MapOptions, OwnedMapOption>>` | — | No | Extra `maplibregl.Map` options: `pitch`, `bearing`, `minZoom`, `maxZoom`, `hash`, `locale`, `transformRequest`, … Read once, when the map is created; change them later on the map (`onMapReady` / `ref.getMap()`, e.g. `map.setMaxZoom(18)`). Options Element sets itself are left out of the type and, if passed anyway, dropped with a dev warning: `container`, `style` (use `basemap`), `center` / `zoom` / `bounds` / `fitBoundsOptions` (use `initialView`), `maxBounds` (use `bounds`), `attributionControl`, `interactive`, `dragPan`, `boxZoom`, `doubleClickZoom` (Element turns these on and off while editing). `transformRequest` covers every tile, glyph and sprite request MapLibre makes: use it for headers on the servers you set in `config.network` (the built-in styles themselves are bundled, not fetched). |
| `onMapReady` | `(map: maplibregl.Map) => void` | — | No | Called once per map, as soon as Element's sources and layers (`elm-*`) are on it: the place to add your own sources and layers (pass an `elm-*` layer id as `beforeId` to put yours under Element's). Basemap switches (the picker, `'auto'` following the theme) keep them. Your own `map.setStyle(...)` drops them and Element's: Element restores its own (on top, with the current features and selection) by itself, and a `map.on('style.load', ...)` listener added here runs after that, so it can re-add yours. `map.addImage` images are dropped by every style switch: re-add them on `styleimagemissing`. If the editor remounts, it is called again with the new map. Saves polling `ref.getMap()`. |
| `slots` | `{ toolbar?, mapOverlay?, panelFooter?, topLeft?, topCenter?, topRight?, leftCenter?, rightCenter?, bottomLeft?, bottomCenter?, bottomRight? }` | — | No | JSX slots. Map slots (`topLeft` … `bottomRight`, the eight `config.ui.layout` map slots) render first in that slot, before the built-in controls placed there via `config.ui.layout`. `mapOverlay` is a full-map absolute layer (`pointer-events: none`); `panelFooter` renders under the layers panel; `toolbar` renders in the map area with no positioning of its own (position it yourself). Wrap custom buttons with the re-exported `IconButton` to match the editor's visual. |
| `config` | `ElementEditorConfig` | — | No | Structured configuration object. Controls theme, tools, UI panel visibility, and units. Flat props (`tools`, `theme`, `accentColor`, `featureColor`) take precedence over `config` when both are provided. |

Colouring features: one colour for all, then data-driven overrides.

```tsx
import { ElementEditor, type FeatureStyle, type GeoJSONFeature } from '@element-editor/react'

// Module-level, so it stays stable across renders.
const byStatus = (f: GeoJSONFeature): FeatureStyle | null =>
  f.properties.status === 'done' ? { color: '#16a34a' } : null

<ElementEditor featureColor="#00a2f0" getFeatureStyle={byStatus} />
```

---

## `ElementEditorRef`

The imperative handle exposed via `ref`. Same surface across `@element-editor/react`, `@element-editor/react/leaflet`, `@element-editor/adapter-leaflet` and `@element-editor/adapter-maplibre`: all are `ElementEditorImperativeAPI<TMap>` from `@element-editor/ui`, where `TMap` is the entry's map type (`maplibregl.Map` on the default entry and adapter-maplibre, `L.Map` on `/leaflet` and adapter-leaflet; TypeScript users of the Leaflet entry need `@types/leaflet`).

Data-changing methods go through the same store actions as the UI, so `maxFeatures`, schema validation, undo and the `onChange` / `onFeature*` / `onSelectionChange` callbacks behave as for the user's own edits (callbacks fire synchronously, before the method returns). They also work in `readonly` mode: the host app is in charge, only `setTool` is refused there. Bad input (unknown ids, invalid geometry, unknown tools) never throws: the method returns `null` / `false` / `0` or skips the entry, with a one-time `console.warn` in development.

```ts
interface ElementEditorRef {
  /** Returns the current FeatureCollection. `_validation` is stripped. */
  getFeatureCollection: () => FeatureCollection
  /** One feature by id, as getFeatureCollection() would return it (hidden ones too); null if unknown. */
  getFeature: (id: string) => GeoJSONFeature | null
  /**
   * Replaces all data (like importGeoJSON(data, 'replace')). Fires onChange (and onFeatureAdd /
   * onFeatureDelete) and is one undo step, unless options say otherwise: { silent: true } for
   * data loaded from your backend, { undoable: false } to also clear the undo history.
   */
  setFeatureCollection: (data: FeatureCollectionInput, options?: SetFeatureCollectionOptions) => void
  /** Returns the current FeatureCollection serialised as GeoJSON text. */
  exportGeoJSON: () => string
  /** Triggers a `features.geojson` file download. */
  exportAs: (format: 'geojson') => void
  /**
   * Imperatively load a FeatureCollection. `mode` defaults to `'replace'`.
   * One undo step: undo restores the previous features, schemas and groups (no file backup).
   * Returns counts of skipped (unsupported geometry) / duplicate (repeated id) /
   * truncated (capped by the internal 50,000-feature limit) features.
   */
  importGeoJSON: (
    raw: FeatureCollectionInput | unknown,
    mode?: 'replace' | 'merge',
  ) => ImportResult
  /**
   * Adds a feature; returns it as stored (with its `id`: a missing one gets a UUID), or `null`
   * when nothing was added (invalid geometry, id already used, `maxFeatures` reached). Goes on
   * top of the layer list; the selection is left alone; `groupId` is kept if the group exists.
   */
  addFeature: (feature: GeoJSONFeatureInput, options?: MutationOptions) => GeoJSONFeature | null
  /**
   * Updates one feature. A patch may set `properties` (replaces the object), `geometry`,
   * `schemaId` or `hidden`; other keys are ignored; the feature is re-validated.
   * Returns `false` (nothing changed) for an unknown id or a malformed patch.
   */
  updateFeature: (id: string, patch: FeaturePatch, options?: MutationOptions) => boolean
  /**
   * `updateFeature` for many features in one commit: one store update, one onChange,
   * onFeatureUpdate once per feature whose geometry or properties changed, one undo step.
   * Unknown ids and malformed patches are skipped.
   */
  updateFeatures: (updates: { id: string; patch: FeaturePatch }[], options?: MutationOptions) => void
  /** Removes features in one undo step; returns how many were removed (unknown ids are skipped). */
  removeFeatures: (ids: string[], options?: MutationOptions) => number
  /** Ids of the selected features (a copy). */
  getSelection: () => string[]
  /**
   * Replaces the selection (`[]` clears it) and fires onSelectionChange. Unknown ids, group ids
   * and hidden features are left out. `fit: true` fits the map to the selected features.
   */
  select: (ids: string[], options?: { fit?: boolean }) => void
  /**
   * Turns a drawing tool on, like its toolbar button (another tool's unfinished shape is
   * discarded); `null` turns the active tool off. Returns `false` when the tool isn't available:
   * unknown or 'search', left out by `tools`, `maxFeatures` reached, or `readonly`
   * (every tool but 'measure').
   */
  setTool: (tool: DrawTool | null) => boolean
  /** The tool that is on (as setTool takes it), or null. Shape operations (cut, buffer, …) aren't tools: null. */
  getTool: () => DrawTool | null
  /** Whether undo() / redo() would change something. */
  canUndo: () => boolean
  canRedo: () => boolean
  /**
   * Validates every feature against its schema (required fields, number min / max) and its
   * geometry (zero-area polygons). Changes nothing, calls no callback. submit() runs the same check.
   */
  validate: () => ValidationReport
  /**
   * The map instance (`maplibregl.Map` / `L.Map`), or `null` until it has mounted (the MapLibre
   * drop-in creates it once its basemap style has loaded). Prefer the `basemap` prop or
   * `setBasemap()` to switch styles: they keep your layers. After your own `map.setStyle()`
   * Element restores its own layers.
   */
  getMap: () => maplibregl.Map | null   // L.Map | null on '@element-editor/react/leaflet'
  /** The current basemap, as passed in `basemap` / `basemaps` (`'auto'` stays `'auto'`). */
  getBasemap: () => BasemapInput         // RasterBasemap | 'osm' on '/leaflet'
  /**
   * Switches the basemap like a user pick, except that it isn't remembered for the next visit.
   * Fires `onBasemapChange`. With a controlled `basemap` it only fires `onBasemapChange`.
   */
  setBasemap: (basemap: BasemapInput) => void
  /**
   * Flies the map to `center` (`[lng, lat]`, GeoJSON order). Defaults `zoom` to 15.
   * The older `flyTo([lat, lng], zoom?)` tuple form is deprecated: it still works and
   * logs a one-time dev warning.
   */
  flyTo: (options: { center: [number, number]; zoom?: number }) => void
  /** Sets the map zoom (no animation, clamped to min/max), keeping the current center. Returns `false` if the map isn't ready yet (nothing happened). */
  setZoom: (zoom: number) => boolean
  /**
   * Fits the map to a bbox tuple `[minLng, minLat, maxLng, maxLat]` or a list
   * of `[lng, lat]` points. No-op when the map controller isn't ready yet.
   */
  fitBounds: (target: [number, number][] | [number, number, number, number]) => void
  /**
   * Validates all features (as validate() does). Invalid: calls onValidationError with the errors
   * keyed by feature id and returns false (onSubmit is not called). Valid: calls onSubmit and returns true.
   */
  submit: () => boolean
  undo: () => void
  redo: () => void
  clearSelection: () => void
}

// What updateFeature(s) may change on a feature (exported from @element-editor/core).
type FeaturePatch = Partial<Pick<GeoJSONFeature, 'properties' | 'geometry' | 'schemaId' | 'hidden'>>

interface MutationOptions {
  // Default true: one undo step, like the same edit by the user. false (e.g. applying a change
  // from your server): no undo step, and the change is also written into the undo/redo history,
  // so the user undoing an earlier edit doesn't revert it.
  undoable?: boolean
}

interface SetFeatureCollectionOptions {
  // Default false: the load fires onChange / onFeatureAdd / onFeatureUpdate / onFeatureDelete like any
  // change. true: it doesn't (load-from-backend → save-in-onChange won't write the data straight
  // back). onSelectionChange still fires when the load clears a selection.
  silent?: boolean
  // Default true: one undo step. false: no undo step, and the undo/redo history is cleared.
  undoable?: boolean
}

interface ValidationReport {
  valid: boolean                     // no feature has an error
  errors: Record<string, string[]>   // messages per feature id (only features with errors), as onValidationError gets them
}

interface ImportResult {
  skipped: number      // features with unsupported geometry types (or geometry: null)
  duplicates: number   // features whose `id` repeated an earlier one (in 'merge' mode, also ids already in the editor)
  truncated: boolean   // import was capped by the internal 50,000-feature safety limit
}
```

> **Note:** `getFeatureCollection()` returns an object, `exportGeoJSON()` returns a string. Use the former to work with the data in-memory, the latter when you need to send raw text to an API or write it to a file.

Usage:

```tsx
import { useRef } from 'react'
import { ElementEditor, type ElementEditorRef } from '@element-editor/react'

const ref = useRef<ElementEditorRef>(null)

<ElementEditor ref={ref} />

// Read:
const data = ref.current?.getFeatureCollection()
const text = ref.current?.exportGeoJSON()
ref.current?.exportAs('geojson')          // triggers file download

// Write:
ref.current?.setFeatureCollection(newData)             // replace, no merge; fires onChange
ref.current?.setFeatureCollection(fromServer, { silent: true })  // no onChange: don't save it straight back
ref.current?.importGeoJSON(newData)                    // replace
const result = ref.current?.importGeoJSON(extra, 'merge')
console.log(result)  // { skipped, duplicates, truncated }

// Single features:
const f = ref.current?.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.86] }, properties: { name: 'Paris' } })
ref.current?.updateFeature(f!.id, { properties: { name: 'Paris, FR' } })
ref.current?.removeFeatures([f!.id])                   // → 1

// Batch edits: one commit and one undo step for the lot, instead of one per
// feature (and a 25-step undo that would only reach the last 25).
ref.current?.updateFeatures(ids.map((id) => ({ id, patch: { properties: { ...propsOf(id), status: 'done' } } })))

// Changes from your server: not undoable, and kept when the user undoes their own edits.
ref.current?.updateFeature(id, { properties: serverProps }, { undoable: false })

// Map:
ref.current?.flyTo({ center: [2.35, 48.86], zoom: 12 })  // [lng, lat]
ref.current?.setZoom(15)
ref.current?.fitBounds([2.17, 48.70, 2.50, 48.90])     // bbox tuple
ref.current?.fitBounds([[2.35, 48.85], [-0.1, 51.5]])  // or [lng, lat] points
// flyTo, fitBounds and select({ fit: true }) frame the target in the part of the map that panels
// (layers sidebar, docked GeoJSON inspector, data table) leave visible, so map.getCenter() can differ.

// History / selection / tools:
ref.current?.undo()
ref.current?.redo()
ref.current?.canUndo()                                 // false when there is nothing to undo
ref.current?.getFeature('a')                           // the feature, or null
ref.current?.getTool()                                 // 'polygon' | … | null
ref.current?.select(['a', 'b'], { fit: true })        // select and zoom to them
ref.current?.getSelection()                            // ['a', 'b']
ref.current?.clearSelection()
ref.current?.setTool('polygon')                        // false if unavailable
ref.current?.setTool(null)                             // exit the tool

// The map itself (null until mounted):
ref.current?.getMap()?.on('moveend', save)

// Check without submitting (no callbacks):
const { valid, errors } = ref.current!.validate()      // errors: { [featureId]: string[] }
if (!valid) ref.current?.select(Object.keys(errors), { fit: true })

// Validation gate:
if (ref.current?.submit()) {
  // onSubmit fired
} else {
  // onValidationError fired
}
```

Tip: pair `fitBounds` with the `getFeatureCollectionBBox(fc)` helper from
`@element-editor/core` to zoom to whatever the user just imported. `@element-editor/core` is
installed with `@element-editor/react`; add it to your own `package.json` to import it
directly (pnpm won't resolve undeclared packages):

```ts
import { getFeatureCollectionBBox } from '@element-editor/core'

function onImport(fc) {
  ref.current?.importGeoJSON(fc, 'replace')
  const bbox = getFeatureCollectionBBox(fc)
  if (bbox) ref.current?.fitBounds(bbox)
}
```

---

## Basemaps

The MapLibre drop-in ships five built-in basemaps (Streets, Terrain, Light, Dark on OpenFreeMap vector tiles, plus raster OpenStreetMap), an `'auto'` mode that follows the editor theme, and a picker in the `'basemap'` layout slot (bottom-left by default).

```tsx
<ElementEditor defaultBasemap="terrain" />                // start on Terrain
<ElementEditor basemap={bm} onBasemapChange={setBm} />    // controlled by your app
<ElementEditor basemaps={['auto', 'dark', 'osm']} />      // fewer choices
<ElementEditor basemaps={false} basemap={{ style: 'https://example.com/style.json' }} />  // your own style, no picker
```

Full details (custom styles, attribution requirements) are in the [Basemaps guide](../guides/basemaps.md). The built-ins' tile, font, elevation and sprite servers are set in `config.network` ([Third-party services and self-hosting](../guides/third-party-services.md)).

The map shows the attribution expanded at load and folds it into a small "i" button on the first map interaction or after five seconds ([Basemaps → Attribution](../guides/basemaps.md#attribution)). The credits are the active basemap's, plus the services in use: "Geocoding by Nominatim" while the search box is offered and the OpenRouteService credit while the Route tool routes through ORS (or the `attribution` you give them in `config.network`). With `'attribution'` in a status slot, the credits sit in the status bar instead.

---

## Leaflet drop-in

```bash
npm install @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet
```

`maplibre-gl` isn't needed here: `@element-editor/react/leaflet` never imports it, and it is an optional peer. (`@element-editor/adapter-maplibre` still gets installed as a dependency of `@element-editor/react`, but it is never loaded.)

```tsx
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css'
```

Same component, props and ref as above (`ElementEditorRef` from `/leaflet` types `getMap()` as `L.Map | null`), with these differences:

| Prop | Type | Default | Description |
|---|---|---|---|
| `tileLayer` | `React.ReactNode` | OpenStreetMap | Any react-leaflet tile component (`<TileLayer />`, `<MapboxTileLayer />`, ...). Disables the picker. |
| `basemaps` | `(RasterBasemap \| 'osm')[]` | none (single OpenStreetMap layer, no picker) | Raster basemaps to choose from, told apart by `id`, else `url`. With two or more entries a picker appears; the first is the default and the user's pick is remembered (`localStorage` key `elm_basemap_leaflet`, namespaced by `config.persistKey`). Ignored when `tileLayer` is set. |
| `basemap` / `defaultBasemap` / `onBasemapChange` | `RasterBasemap \| 'osm'` | first `basemaps` entry | Same as on the MapLibre drop-in (controlled / starting basemap / pick callback), with raster entries; `ref.getBasemap()` / `ref.setBasemap()` too. Ignored when `tileLayer` is set (dev warning). |
| `renderer` | `'canvas' \| 'svg'` | `'canvas'` | How unselected polygons and lines are drawn (see the prop table above). |
| `mapOptions` | `Omit<L.MapOptions, OwnedMapOption>` | — | Extra `L.Map` options (`minZoom`, `maxZoom`, `zoomSnap`, `scrollWheelZoom`, `worldCopyJump`, `maxBoundsViscosity`, …). Read once. Left out (dropped with a dev warning if passed): `center`, `zoom` (use `initialView`), `maxBounds` (use `bounds`), `zoomControl`, `attributionControl`, `crs` (Element assumes Web Mercator), `renderer` / `preferCanvas` (use `renderer`), `dragging`, `boxZoom`, `doubleClickZoom`. |
| `onMapReady` | `(map: L.Map) => void` | — | Called once per map, as soon as Element's layers and panes are on it. Again after a remount, with the new map. |
| `getFeatureStyle` | `(feature: GeoJSONFeature) => (FeatureStyle & PathOptions) \| undefined \| null` | — | Same as above; Leaflet `PathOptions` is a superset of `FeatureStyle`, so the same function works on both drop-ins, and extra keys such as `dashArray` apply here only. Point pins take `fillColor`, then `color`. |

Vector basemaps do not exist on the Leaflet drop-in (of `config.network`'s tile keys only `osmRaster` applies, for the `'osm'` entry). The other way round, `tileLayer` and `renderer` don't exist on the default (MapLibre) `ElementEditor`: passing them there is ignored, with a dev-mode warning pointing to `@element-editor/react/leaflet`. `RasterBasemap` is `{ id?, label?, thumbnail?, url, attribution, maxZoom? }`.

```tsx
<ElementEditor
  basemaps={[
    'osm',
    { id: 'esri', label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri' },
  ]}
/>
```

---

## Setting up the map

```tsx
<ElementEditor
  initialData={parcels}
  initialView="data"                       // or { center: [14.42, 50.09], zoom: 12 } / { bounds: [w, s, e, n] }
  mapOptions={{ maxZoom: 19, pitch: 30 }}  // MapLibre options; L.MapOptions on /leaflet
  onMapReady={(map) => {
    map.addSource('districts', { type: 'geojson', data: '/districts.geojson' })
    map.addLayer({ id: 'districts', type: 'line', source: 'districts' }, 'elm-features-fill') // under Element's features
  }}
/>
```

Start view, first that applies: `initialView` → the remembered view (`elm_mapView`, skipped with `config.persist: false`) → a fit of `initialData` (only on a first visit, as there's no remembered view yet) → a fit of `bounds` → Europe at zoom 5. `bounds` still restricts panning, so a start view outside it is moved inside. `initialData` that arrives after mount (from `null`, while the editor is empty and unedited) is fitted by the same rules: with `initialView="data"`, or with no `initialView` on a first visit. `initialView` and `mapOptions` are not applied to an existing map, nor are other later changes to `initialData`: call `ref.fitBounds(getFeatureCollectionBBox(fc))` or use the map from `onMapReady` / `ref.getMap()`.

`onMapReady` runs once per map instance (not twice under React StrictMode). If the editor remounts (a new `key`), you get the new map; the old one has been removed with everything you added to it.

---

## `ElementEditorConfig`

A structured configuration object accepted by the `config` prop. All fields are optional — omit any to keep the default.

```ts
interface ElementEditorConfig {
  /** Color theme. Default: 'system' (follows OS preference). */
  mode?: 'light' | 'dark' | 'system'

  /**
   * Brand accent: any CSS colour ('#ea580c', 'rebeccapurple', 'oklch(…)').
   * The whole primary 50…950 scale is derived from it. Applied as
   * `--elm-accent` on the editor root and on ElementEditor's portals; updates live.
   * Default: undefined (blue). `<ElementEditor accentColor>` wins over this.
   */
  accentColor?: string

  /**
   * Default colour of every feature (polygon outline + fill, line, point): any
   * CSS colour. Opacity and weight keep their defaults. `getFeatureStyle` (per
   * key) and the selected look win over it, hover keeps it. Updates live.
   * Default: undefined (slate #475569). `<ElementEditor featureColor>` wins over this.
   */
  featureColor?: string

  /** Which drawing tools are available. Default: 'all'. */
  tools?: DrawTool[] | 'all'

  /**
   * Namespace for everything this editor remembers in localStorage: `elm_theme`
   * becomes `elm_<persistKey>_theme`, and so on. Give each editor on an origin
   * its own key. Default: undefined (the shared `elm_*` keys).
   */
  persistKey?: string

  /** false: read and write nothing in localStorage. Default: true. */
  persist?: boolean

  /**
   * Every third-party server this editor talks to, per editor. Omitted keys keep the default;
   * `false` turns a service off (and hides what needs it). See the
   * [Third-party services and self-hosting](../guides/third-party-services.md) guide.
   */
  network?: {
    vectorTiles?: NetworkSource   // built-in vector basemaps (OpenMapTiles schema). Default: OpenFreeMap
    dem?: NetworkSource           // hillshade elevation (terrarium). Default: Mapterhorn
    osmRaster?: NetworkSource     // the 'osm' raster basemap (both engines). Default: tile.openstreetmap.org
    glyphs?: string               // glyph URL template (Noto Sans Regular/Bold/Italic). Default: OpenFreeMap
    sprite?: string               // absolute sprite URL prefix. Default: jsDelivr copy of the adapter's
    overpass?: false | { endpoint?: string; timeoutMs?: number }          // the Picker's OSM lookups
    routing?: false | { provider?: 'ors' | 'osrm'; url?: string; apiKey?: string; attribution?: string } // Route tool. Default: OSRM demo (car-only, not for production)
    nominatim?: false | { url?: string; email?: string; attribution?: string } // search box
    fetch?: typeof fetch          // every request Element makes itself (Overpass, routing, search)
  }
  // NetworkSource: a URL (tile template with {z}, else TileJSON) or MapLibre source fields
  // merged over the built-in source ({ tiles?, url?, attribution?, encoding?, maxzoom?, … }).

  /** UI element visibility. All default to true. */
  ui?: {
    /** Drawing hints in the active toolbar (e.g. "Click and drag to size"). */
    hints?: boolean
    /** Data table panel (spreadsheet view of all features). */
    dataTable?: boolean
    /** Layers / features list panel. */
    layerList?: boolean
    /** Schema editor button. */
    schemaEditor?: boolean
    /** GeoJSON editor button. */
    geojsonEditor?: boolean
    /**
     * Open the GeoJSON inspector on mount, in the user's last Dock/Undock
     * mode (docked beside the map by default; 'docked' means the same as
     * true). Initial state only: the user's toggles win afterwards. Doesn't
     * take keyboard focus. Ignored when geojsonEditor is false. Default: false.
     */
    geojsonEditorOpen?: boolean | 'docked'
    /** Editor settings button. */
    settings?: boolean
    /** "Fit all features" zoom button. */
    zoomToAll?: boolean
    /** Click-to-edit zoom level indicator. Default: true. */
    zoomIndicator?: boolean
    /** "Fly to my location" geolocation button. Default: true. */
    locateButton?: boolean
    /**
     * Keyboard shortcuts.
     * `false` — disable shortcuts entirely and hide the shortcuts button.
     * `{ enabled, show, mapZoom }` — fine-grained.
     * Default: `{ enabled: true, show: true, mapZoom: false }`.
     *
     * `mapZoom`: when true, intercepts Cmd/Ctrl + (`+`/`=`) and Cmd/Ctrl + (`-`)
     * to zoom the map in/out by one level. Only fires while the cursor is over
     * the editor and no input is focused, so it doesn't hijack the host page's
     * browser-zoom shortcut. Off by default (opt-in).
     */
    keyboardShortcuts?: boolean | { enabled?: boolean; show?: boolean; mapZoom?: boolean }

    /**
     * Where every built-in control goes: slots → ordered entries. See the
     * "Configuring the layout" guide. Map slots: topLeft, topCenter,
     * topRight, leftCenter, rightCenter, bottomLeft, bottomCenter,
     * bottomRight; status bar slots: statusLeft, statusRight. A map slot is
     * an array or `{ items, direction }`; a status slot is an array. Unlisted
     * controls are hidden (except 'attribution', which then stays on the
     * map). First place wins for a control listed twice. Visibility flags
     * still apply. 'separator' goes inside a group or in a status slot.
     * To change a few controls and keep the rest: `withLayout({ move, hide })`.
     * Default: DEFAULT_LAYOUT.
     */
    layout?: LayoutConfig
  }

  /** Floating toolbar (drawing tools) layout. Its place is the 'toolbar' entry in `ui.layout`. */
  toolbar?: {
    /**
     * `'horizontal'` (default) lays the tool buttons in a row with the
     * place-search input inline. `'vertical'` stacks tools top-to-bottom and
     * collapses the search into an icon button.
     */
    direction?: 'horizontal' | 'vertical'
  }

  /** Measurement and number display. */
  units?: {
    /** Length unit. `'auto'` picks metric/imperial from the browser locale. Default: `'auto'`. */
    length?: 'metric' | 'imperial' | 'auto'
    /** Area unit. Default: `'auto'`. */
    area?: 'metric' | 'imperial' | 'auto'
    /** Number format. `'human'` = `"1.2 km"`, `'raw'` = `"1234.56 m"`. Default: `'human'`. */
    display?: 'human' | 'raw'
    /** Decimal places in `'raw'` display mode. Default: 2. */
    precision?: number
  }
}
```

### Layout types

Each slot only takes the entries it can show, so a misplaced control is a compile error.

```ts
type MapSlot =
  | 'topLeft' | 'topCenter' | 'topRight'
  | 'leftCenter' | 'rightCenter'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight'
type StatusSlot = 'statusLeft' | 'statusRight'
type LayoutSlot = MapSlot | StatusSlot

type LayoutControl =
  | 'toolbar' | 'undo' | 'redo'
  | 'fitBounds' | 'locate' | 'zoomIndicator'
  | 'table' | 'schema' | 'geojson' | 'settings' | 'keyboard'
  | 'applyChanges'
  | 'attribution'        // status bar slots only
  | 'basemap'            // basemap picker; hidden when the editor has no picker; never in a group

type MapControl = Exclude<LayoutControl, 'attribution'>
type StatusControl = Exclude<LayoutControl, 'toolbar' | 'applyChanges'>
type MapGroup = { group: ReadonlyArray<Exclude<MapControl, 'toolbar' | 'basemap'> | 'separator'> }
type StatusGroup = { group: ReadonlyArray<Exclude<StatusControl, 'basemap'> | 'separator'> }
type MapEntry = MapControl | MapGroup                        // no bare 'separator' over the map
type StatusEntry = StatusControl | 'separator' | StatusGroup
type MapSlotConfig = readonly MapEntry[] | { items: readonly MapEntry[]; direction?: 'horizontal' | 'vertical' }
type StatusSlotConfig = readonly StatusEntry[]               // always horizontal
type LayoutConfig = { [S in MapSlot]?: MapSlotConfig } & { [S in StatusSlot]?: StatusSlotConfig }
// Unions of the two: LayoutGroup, LayoutEntry, LayoutSlotConfig.

// Changes for withLayout(patch, base = DEFAULT_LAYOUT): LayoutConfig
type SlotFor<C extends LayoutControl> =
  C extends 'attribution' ? StatusSlot : C extends 'toolbar' | 'applyChanges' ? MapSlot : LayoutSlot
interface LayoutPatch {
  /** Put a control in a slot wherever it was (or add it): at the end, or first with at: 'start'. */
  move?: { [C in LayoutControl]?: SlotFor<C> | { slot: SlotFor<C>; at?: 'start' | 'end' } }
  /** Take controls off the layout (wins over move). */
  hide?: readonly LayoutControl[]
}

const DEFAULT_LAYOUT: LayoutConfig = {
  topCenter:  ['toolbar'],
  leftCenter: [{ group: ['undo', 'redo'] }],
  bottomLeft: ['basemap', 'fitBounds', 'locate', 'zoomIndicator', 'table', 'schema', 'geojson', 'settings', 'keyboard', 'applyChanges'],
}
```

Rules (enforced by the types; JS callers get them as development warnings, and the entry is skipped): `'toolbar'` can't go in the status bar or a group; `'basemap'` can't go in a group; `'applyChanges'` can't go in the status bar; `'attribution'` only in the status bar; no nested groups; no bare `'separator'` in a map slot. In development the editor also warns when a layout leaves the toolbar unplaced while drawing is possible, `'applyChanges'` unplaced while `onSubmit` is set, or undo/redo unplaced while keyboard shortcuts are off.

### Example — custom layout with groups and a status bar

```tsx
<ElementEditor
  config={{
    ui: {
      layout: {
        topCenter:   ['toolbar'],
        leftCenter:  [{ group: ['fitBounds', 'separator', 'locate'] }],
        bottomLeft:  [{ group: ['table', 'schema', 'geojson', 'separator', 'settings'] }],
        bottomRight: ['applyChanges'],
        statusLeft:  [{ group: ['undo', 'redo'] }, 'separator', 'keyboard'],
        statusRight: ['zoomIndicator', 'separator', 'attribution'],
      },
    },
  }}
  slots={{ bottomLeft: <MyAdminButton /> }}
/>
```

### Example — start with the GeoJSON inspector docked

```tsx
<ElementEditor layout="minimal" config={{ ui: { geojsonEditorOpen: 'docked' } }} />
```

The inspector opens docked on the right on every fresh mount, without taking the page's focus; map controls, the toolbar and the data table clear it from the first paint. Once a visitor clicks Dock / Undock, their choice (saved in `localStorage`, see [`persistKey`](../guides/persisting-data.md#elements-own-saved-state-persistkey--persist)) wins.

### Example — embed with reduced UI

```tsx
<ElementEditor
  config={{
    mode: 'dark',
    tools: ['polygon', 'point'],
    ui: {
      dataTable: false,
      schemaEditor: false,
      keyboardShortcuts: false,
    },
  }}
/>
```

---

## `DrawTool`

```ts
type DrawTool =
  | 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route' | 'picker'
  | 'measure' | 'search'
```

`'polygon'` is the **Area** tool in the toolbar (the id keeps the GeoJSON name). Both the `tools` flat prop on `<ElementEditor>` and `config.tools` accept `DrawTool[]` (`config.tools` also takes `'all'`).

---

## `ToolbarPosition`

`ResolvedConfig.toolbar.position`: the toolbar's layout slot as a position (tooltip and popup sides, standalone toolbar placement).

```ts
type ToolbarPosition =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'left-center' | 'right-center'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
```

---

## Exports

| Export | Kind | Description |
|---|---|---|
| `ElementEditor` | Component | The main editor component (MapLibre; the Leaflet one is exported from `@element-editor/react/leaflet`). |
| `DEFAULT_LAYOUT` | Const | Re-exported from `@element-editor/ui`. The layout used when `config.ui.layout` isn't set. Deep-frozen: change it with `withLayout` instead of mutating it. |
| `withLayout(patch, base?)` | Function | Re-exported from `@element-editor/ui`. A copy of `base` (default `DEFAULT_LAYOUT`) with `patch.move` / `patch.hide` applied: `layout: withLayout({ move: { table: 'topRight' } })`. |
| `LayoutConfig`, `LayoutSlot`, `MapSlot`, `StatusSlot`, `LayoutControl`, `LayoutEntry`, `MapEntry`, `StatusEntry`, `LayoutGroup`, `MapGroup`, `StatusGroup`, `LayoutSlotConfig`, `MapSlotConfig`, `StatusSlotConfig`, `LayoutPatch`, `SlotFor` | Types | Re-exported from `@element-editor/ui`. `config.ui.layout` and `withLayout` types. |
| `IconButton` | Component | Re-exported from `@element-editor/ui`. 48×48 card-style icon button matching the editor's visual language. Wrap your own icons with it inside `slots.<corner>` to get a consistent toolbar look. |
| `Tooltip` | Component | Re-exported from `@element-editor/ui`. Editor-styled tooltip wrapper. |
| `ElementEditorProps` | Type | Props interface for `<ElementEditor>`. |
| `FeatureStyle` | Type | Return shape of `getFeatureStyle`: `{ color?, fillColor?, opacity?, fillOpacity?, weight? }`. Also exported from `@element-editor/react/leaflet`. |
| `RasterBasemap` | Type | Re-exported from `@element-editor/ui`. Entry of the Leaflet drop-in's `basemaps` list. |
| `ElementEditorRef` | Type | Ref interface for `<ElementEditor>`: `ElementEditorImperativeAPI<maplibregl.Map>` (`<L.Map>` from `/leaflet`). |
| `ImportResult` | Type | Return value of `ref.importGeoJSON()` — `{ skipped, duplicates, truncated }`. |
| `MutationOptions`, `SetFeatureCollectionOptions`, `ValidationReport` | Types | Re-exported from `@element-editor/ui`. Options of the ref's data methods (`{ undoable }`), of `setFeatureCollection` (`{ silent, undoable }`), and what `ref.validate()` returns (`{ valid, errors }`). |
| `FeatureCollection` | Type | Re-exported from `@element-editor/core`. |
| `FeatureCollectionInput`, `GeoJSONFeatureInput`, `GeometryInput` | Types | Re-exported from `@element-editor/core`. What `initialData`, `setFeatureCollection`, `importGeoJSON` and `addFeature` accept: any RFC 7946 GeoJSON, so `@types/geojson` data type-checks as is (`id` optional, `properties` may be `null`, `metadata` optional, `geometry: null`, 3D positions and bboxes). |
| `GeoJSONFeature` | Type | Re-exported from `@element-editor/core`. |
| `Schema` | Type | Re-exported from `@element-editor/core`. |
| `SchemaField` | Type | Re-exported from `@element-editor/core`. |
| `Group` | Type | Re-exported from `@element-editor/core`. |
| `Geometry` | Type | Re-exported from `@element-editor/core`. |
| `EditingMode` | Type | Re-exported from `@element-editor/core`. |
| `ElementEditorEvent` | Type | Re-exported from `@element-editor/ui`. |
| `ElementEditorError` | Class | Re-exported from `@element-editor/core`. What `onError` receives: an `Error` with `code`, `source`, `featureId?`, `cause?`. |
| `ElementEditorErrorHandler`, `ErrorCode`, `ErrorSource` | Types | The `onError` signature and its closed `code` / `source` unions (see [Events](./events.md#onerror)). |
| `InitialView` | Type | What `initialView` accepts. |
| `accentPalette`, `DEFAULT_ACCENT`, `ACCENT_STEPS`, `AccentShade` | Function / consts / type | Re-exported from `@element-editor/core`. The 50–950 scale Element generates from an accent colour (see [Theming](../guides/theming.md#matching-your-own-layers-and-ui)). |
| `ElementEditorConfig` | Type | Re-exported from `@element-editor/ui`. Configuration object for the `config` prop. |
| `DrawTool` | Type | Re-exported from `@element-editor/ui`. Union of drawing tool names. |
| `ElementEditorBaseProps` | Type | Engine-neutral props shared by both drop-ins (`ElementEditorProps` extends it). Also exported from `@element-editor/react/leaflet`. |
| `BBox`, `BoundsInput`, `FlyToOptions` | Types | Re-exported from `@element-editor/core`. `BBox` = `[west, south, east, north]`; `BoundsInput` = what `bounds` accepts (`BBox` or the deprecated nested form); `FlyToOptions` = `{ center: [lng, lat], zoom? }`. Also exported from `/leaflet`. |
| `BasemapInput`, `BuiltinBasemapId` | Types | Re-exported from `@element-editor/adapter-maplibre/basemaps` (MapLibre entry only). Types of the `basemap` / `basemaps` props. |
| `LeafletBasemap` | Type | `/leaflet` only: `RasterBasemap \| 'osm'`, the Leaflet drop-in's basemap entries. |
