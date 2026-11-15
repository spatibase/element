# @element-editor/adapter-maplibre

*Complete API reference for the MapLibre GL editing layer.*

---

## Install

```bash
npm install @element-editor/adapter-maplibre maplibre-gl@^5
```

### Peer dependencies

| Package | Version |
|---|---|
| `maplibre-gl` | `^5.5` |
| `react` | `^19.2` |
| `react-dom` | `^19.2` |

React 18 is not supported. `@element-editor/core` and `@element-editor/ui` are installed as regular dependencies (not bundled). To import from them directly, add them to your own `package.json` at the same version. The geometry worker is inlined, so no bundler configuration is needed.

### CSS imports

Import the MapLibre GL stylesheet and the adapter stylesheet. The JavaScript entry doesn't import any CSS:

```tsx
import 'maplibre-gl/dist/maplibre-gl.css'
import '@element-editor/adapter-maplibre/style.css'
```

The adapter stylesheet doesn't include MapLibre's CSS. It doesn't reset your page: Tailwind's base styles apply only inside `[data-elm-theme]` elements and the editor's own portals.

---

## Requirements

- `ElementEditorUIProvider` must be an ancestor of `ElementEditorControls`. It provides the error boundary, config, shortcut configuration, and events and toasts. `ElementEditorControls` throws without the shortcut and event contexts.
- `GeoStoreProvider` must wrap `ElementEditorControls`. One per editor.
- The map container and all Element UI must be inside an element with `data-elm-theme="light"` or `"dark"`. It scopes the editor's styles and its keyboard shortcuts.
- The `map` prop takes a `maplibregl.Map` instance. `ElementEditorControls` waits until the style can accept sources before it adds its layers (it retries on `styledata` and `load`), so you can render it as soon as the map exists.
- `ElementEditorControls` renders no visible DOM elements. It adds GL sources and layers to the map.

```tsx
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86],
      zoom: 5,
    })
    setMap(m)
    return () => { m.remove(); setMap(null) }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: '600px' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          {map && (
            <ElementEditorControls
              map={map}
              onChange={(data) => console.log(data)}
            />
          )}
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

---

## `<ElementEditorControls>`

```tsx
import { ElementEditorControls } from '@element-editor/adapter-maplibre'
```

Renders no visible HTML. Adds GL sources and layers to the map instance. Unmounting removes those GL resources.

`ElementEditorControls` wraps its children in `MapControllerProvider`, so UI components placed as `children` can call `useMapController()` for `fitBounds` and `flyTo` operations.

---

## `ElementEditorControlsProps`

| Prop | Type | Default | Required | Description |
|---|---|---|---|---|
| `map` | `maplibregl.Map` | — | **Yes** | The MapLibre GL map instance. Pass it as soon as it exists: Element waits until the style can take sources before it adds its layers, and puts them back after every `map.setStyle()`. |
| `children` | `React.ReactNode` | — | No | UI components rendered inside the adapter's `MapControllerProvider`. Use to place `@element-editor/ui` panels so they have access to `useMapController`. |
| `initialData` | `FeatureCollectionInput \| GeoJSONFeatureInput \| null` | — | No | The starting data: any GeoJSON `FeatureCollection` (`@types/geojson`'s type-checks) or a single `Feature`. Applied on mount, with no undo step and no `onChange`. Data that arrives later (`null` → data) is applied once too, while the editor is empty and unedited (the controls don't move the map: fit it with `ref.fitBounds`). Other later changes are ignored, with a development warning: use `ref.setFeatureCollection(data, { silent: true })`. Invalid data reports an `error` event and the editor starts empty; features with `geometry: null` are left out and reported. |
| `schema` | `Schema` | — | No | A schema added to the store on mount. Re-renders that keep the same `schema.id` are no-ops. |
| `onChange` | `(data: FeatureCollection) => void` | — | No | Fires on every committed change with the full current `FeatureCollection`. |
| `onSubmit` | `(data: FeatureCollection) => void` | — | No | Called by `ref.submit()` when all features pass validation. Receives the collection with `_validation` stripped. The adapter renders no submit button. |
| `onValidationError` | `(errors: Record<string, string[]>) => void` | — | No | Called by `ref.submit()` when features have validation errors. Keys are feature IDs. Blocks `onSubmit`. |
| `onEvent` | `(event: ElementEditorEvent) => void` | — | No | Receives every message the editor would show the user; when set, no toasts are shown. Wraps a local `EventProvider`, so you don't need `ElementEditorUIProvider onEvent` too. Read once at mount. See [Events](./events.md#onevent). |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | — | No | Called first for every runtime failure, with a stable `code`, `source` and English `message`; return `false` to stop the toast, or a string to replace its text. Runs before the enclosing `ElementEditorUIProvider`'s handlers. See [Events](./events.md#onerror). |
| `layout` | `'panel' \| 'minimal' \| 'split'` | `'panel'` | No | Layout hint read by the `@element-editor/ui` panels. |
| `tools` | `DrawingTool[]` | all tools | No | Restrict which drawing tools are available. Keyboard shortcuts for excluded tools are suppressed. |
| `maxFeatures` | `number` | — | No | Maximum number of features. Enforced by the store for every way of adding features: drawing tools and their shortcuts are disabled at the limit, duplicate, paste and break apart are refused, and imports are truncated (`ImportResult.truncated`). Each refusal reports an `error` event. Undo and redo are never blocked. |
| `readonly` | `boolean` | `false` | No | Disable all editing interactions. Features remain visible. |
| `onFeatureAdd` | `(feature: GeoJSONFeature) => void` | — | No | Fires when a feature is added. Fires after `onChange` for the same operation. |
| `onFeatureUpdate` | `(id: string, feature: GeoJSONFeature) => void` | — | No | Fires when a feature's geometry or properties change. Fires after `onChange`. |
| `onFeatureDelete` | `(id: string) => void` | — | No | Fires when a feature is deleted. Fires after `onChange`. |
| `onSelectionChange` | `(ids: string[]) => void` | — | No | Fires when selection changes. Fires independently of feature data changes. |
| `onFeatureSelect` | `(feature: GeoJSONFeature \| null) => void` | — | No | Fires with the single selected feature, or `null` when nothing or several features are selected. |
| `onZoomChange` | `(zoom: number) => void` | — | No | Fires when the map zoom changes. |
| `onToolChange` | `(tool: DrawingTool \| null) => void` | — | No | Fires with the tool that turned on (as `ref.getTool()` reports it), or `null` when it turned off. |
| `routingApiKey` | `string` | — | No | **Deprecated** (dev warning): set `config.network.routing.apiKey` on the surrounding `ElementEditorUIProvider`, which wins when both are set. All servers the controls use (routing, Overpass, search, the built-in basemaps' tiles) come from `config.network`: see [Third-party services and self-hosting](../guides/third-party-services.md). |
| `onReady` | `(map: maplibregl.Map) => void` | — | No | Called once per map, as soon as Element's sources and layers (`elm-*`) are on it: the place to add your own layers (pass an `elm-*` layer id as `beforeId` to put yours under Element's). `setBasemap` / `BasemapControl` keep them. Your own `map.setStyle(...)` drops them, and Element's too: Element puts its own back (on top, with the current features, selection and images) by itself; re-add yours from a `map.on('style.load', ...)` listener added here, which runs after Element's repair, so an `elm-*` `beforeId` works. Images you added with `map.addImage` are dropped by every style switch, `setBasemap` included: re-add them from a `styleimagemissing` listener. `ElementEditorControls` doesn't move the map: fit your data with `ref.fitBounds` if you want that. |
| `maxBounds` | `[number, number, number, number] \| [[number, number], [number, number]] \| null` | — | No | MapLibre `maxBounds`: restricts panning. A GeoJSON bbox `[west, south, east, north]` or MapLibre's `[[west, south], [east, north]]`, both `[lng, lat]` order (the Leaflet adapter's prop is `bounds` and takes the same bbox). |
| `getFeatureStyle` | `(feature: GeoJSONFeature) => FeatureStyle \| undefined \| null` | — | No | Per-feature paint override: `{ color, fillColor, opacity, fillOpacity, weight }` (`fillColor` falls back to `color`) for polygons, lines and points. Wins over `config.featureColor` per key; the selected state still takes precedence, hover keeps the colour. Re-applied when features change and when the function identity changes, so keep it stable (module-level or `useCallback`). See [Colouring features](../guides/theming.md#colouring-features). |

### `children` and `@element-editor/ui`

```tsx
import { ElementEditorControls } from '@element-editor/adapter-maplibre'
{map && (
  <ElementEditorControls map={map} onChange={handleChange}>
    <FloatingToolbar />
    <LayersPanel />
    {/* DataTablePanel and the modals are lazy-loaded: give each its own Suspense */}
    <Suspense fallback={null}><DataTablePanel /></Suspense>
    <Suspense fallback={null}><ShortcutsModal /></Suspense>
    <Suspense fallback={null}><SettingsModal /></Suspense>
  </ElementEditorControls>
)}
```

---

## `ElementEditorControlsRef`

The imperative handle exposed via `ref`: `ElementEditorImperativeAPI<maplibregl.Map>` from `@element-editor/ui`, the same surface as `ElementEditorRef` in `@element-editor/react`. Data-changing methods behave like the user's own edits (validation, `maxFeatures`, undo, `onChange` / `onFeature*` callbacks) and also work in `readonly` mode.

```ts
interface ElementEditorControlsRef {
  getFeatureCollection: () => FeatureCollection
  /** One feature by id (hidden ones too), or null for an unknown id. */
  getFeature: (id: string) => GeoJSONFeature | null
  /**
   * Replaces all features (like importGeoJSON(data, 'replace')). Fires onChange and is one undo
   * step unless `{ silent: true }` (no data callbacks) / `{ undoable: false }` (clears the history).
   */
  setFeatureCollection: (data: FeatureCollectionInput, options?: { silent?: boolean; undoable?: boolean }) => void
  /** Returns the current FeatureCollection serialised as GeoJSON text. */
  exportGeoJSON: () => string
  /** Triggers a `features.geojson` file download. */
  exportAs: (format: 'geojson') => void
  /** Loads a FeatureCollection. `mode` defaults to 'replace'. */
  importGeoJSON: (raw: FeatureCollectionInput | unknown, mode?: 'replace' | 'merge') => ImportResult
  /** Adds a feature; returns it as stored (with its id), or null (invalid geometry, id taken, maxFeatures). Leaves the selection alone. */
  addFeature: (feature: GeoJSONFeatureInput, options?: { undoable?: boolean }) => GeoJSONFeature | null
  /** Patches one feature (`properties` / `geometry` / `schemaId` / `hidden`). False for an unknown id or a malformed patch. */
  updateFeature: (id: string, patch: FeaturePatch, options?: { undoable?: boolean }) => boolean
  /** Updates many features in one commit and one undo step. See ElementEditorRef. */
  updateFeatures: (updates: { id: string; patch: FeaturePatch }[], options?: { undoable?: boolean }) => void
  /** Removes features in one undo step; returns how many were removed. */
  removeFeatures: (ids: string[], options?: { undoable?: boolean }) => number
  /** Ids of the selected features. */
  getSelection: () => string[]
  /** Replaces the selection (unknown / hidden ids left out); `fit` zooms to it. Fires onSelectionChange. */
  select: (ids: string[], options?: { fit?: boolean }) => void
  /** Turns a drawing tool on (`null`: off). False when unavailable (unknown, `tools`, maxFeatures, readonly). */
  setTool: (tool: DrawingTool | null) => boolean
  /** The tool that is on, or null (also while a shape operation such as cut or buffer runs). */
  getTool: () => DrawingTool | null
  /** Whether undo() / redo() would change something. */
  canUndo: () => boolean
  canRedo: () => boolean
  /** Validates every feature against its schema and geometry; changes nothing, calls no callback. */
  validate: () => { valid: boolean; errors: Record<string, string[]> }
  /** The maplibregl.Map you passed in (null only before the controls have mounted). After your own setStyle(), Element restores its own layers; yours are up to you (see onReady). */
  getMap: () => maplibregl.Map | null
  /** Flies the map to `center` (`[lng, lat]`). `zoom` defaults to 15. The `([lat, lng], zoom?)` tuple form is deprecated (dev warning). */
  flyTo: (options: { center: [number, number]; zoom?: number }) => void
  /** Sets the zoom, keeping the center. Returns false if the map isn't ready or the zoom is invalid. */
  setZoom: (zoom: number) => boolean
  /**
   * Fits the map to a bbox tuple `[minLng, minLat, maxLng, maxLat]` or a list
   * of `[lng, lat]` points. No-op when the map controller isn't ready yet.
   */
  fitBounds: (target: [number, number][] | [number, number, number, number]) => void
  /** Validates all features, then calls onSubmit or onValidationError. Returns true when valid. */
  submit: () => boolean
  /** Undo the last committed change. */
  undo: () => void
  redo: () => void
  clearSelection: () => void
}
```

Same methods as `ElementEditorRef` in `@element-editor/react` (both are `ElementEditorImperativeAPI` from `@element-editor/ui`; here `getMap()` is typed `maplibregl.Map`). See [`ElementEditorRef`](./element-editor-react.md#elementeditorref) for `ImportResult`, `MutationOptions` and the details of each method.

Pair `fitBounds` with the `getFeatureCollectionBBox(fc)` helper from
`@element-editor/core` to zoom to whatever the user just imported:

```ts
import { getFeatureCollectionBBox } from '@element-editor/core' // add @element-editor/core to your package.json

ref.current?.setFeatureCollection(fc)
const bbox = getFeatureCollectionBBox(fc)
if (bbox) ref.current?.fitBounds(bbox)
```

Selection, tools and single-feature edits:

```ts
ref.current?.select(['a', 'b'], { fit: true })
ref.current?.setTool('polygon')          // false if unavailable
const added = ref.current?.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [14.42, 50.09] }, properties: {} })
ref.current?.updateFeature(id, { properties: serverProps }, { undoable: false }) // e.g. a server push: not undoable, survives the user's undo
```

---

## `useMapLibre()`

```ts
import { useMapLibre } from '@element-editor/adapter-maplibre'

function useMapLibre(): maplibregl.Map
```

Returns the `maplibregl.Map` instance provided to the enclosing `ElementEditorControls`. Must be called inside a descendant of `ElementEditorControls`. Throws if called outside.

---

## `DrawingTool`

```ts
type DrawingTool =
  | 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route'
  | 'picker' | 'measure' | 'search'
```

---

## `GeoStoreProvider`

```tsx
import { GeoStoreProvider } from '@element-editor/adapter-maplibre'
```

Creates an isolated Zustand store instance. Re-exported from `@element-editor/ui` for convenience.

---

## `ElementEditorUIProvider`

```tsx
import { ElementEditorUIProvider } from '@element-editor/adapter-maplibre'
```

Bundles the full UI context stack — `ElementEditorErrorBoundary`, `ElementEditorConfigProvider`, `ShortcutConfigProvider`, `EventProvider`, `MapControllerProvider` — for `@element-editor/ui` panels and modals. The same component as the [Leaflet adapter's `ElementEditorUIProvider`](./adapter-leaflet.md#elementeditoruiprovider) (it lives in `@element-editor/ui`; both adapters re-export it), with the same props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `config` | `ElementEditorConfig` | — | Theme mode, tools, UI visibility, toolbar layout, units. `ui.geojsonEditorOpen` opens the inspector on mount (it sets `codeModalOpen`), so it shows when you render `GeoJSONModal` from that flag as in the quickstart; pass `fallback={<GeoJSONDockPlaceholder />}` to its `<Suspense>` so the controls don't jump while its chunk loads. |
| `accentColor` | `string` | — | Brand accent: any CSS colour. Wins over `config.accentColor`. `<ElementEditorControls>` writes it as `--elm-accent` onto the nearest `[data-elm-theme]` ancestor of the map container; Element's portals get it too. Updates live. See [Theming](../guides/theming.md#approach-1--one-brand-colour). |
| `featureColor` | `string` | — | Default colour of every feature (polygon outline + fill, lines, points). Wins over `config.featureColor`; `getFeatureStyle` and the selected look win over it, hover keeps it. Opacity and weight keep their defaults. Updates live. See [Colouring features](../guides/theming.md#colouring-features). |
| `onEvent` | `(event: ElementEditorEvent) => void` | — | Receives every user-facing message; when set, no toasts are shown. |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | — | Called first for every runtime failure (code, source, English message), including a render crash caught by the error boundary (`code: 'crash'`, the original error is `cause`). Return `false` to stop the toast, or a string to replace its text. See [Events](./events.md#onerror). |
| `toaster` | `boolean` | `true` | Render Element's own sonner `<Toaster>`, tagged with a per-instance id. Pass `false` to send toasts to your own untagged `<Toaster>`. |
| `children` | `ReactNode` | — | Your map, `GeoStoreProvider` and UI. |

It doesn't set `data-elm-theme` or `ThemeContext`; render those yourself.

---

## Compatibility with MapTiler SDK and Mapbox GL JS

Keep `maplibre-gl` (`^5.5`) installed with either of them. The adapter imports it at runtime (map markers for vertex and transform handles, measure labels), and it is an optional peer dependency, so the package manager won't add it for you.

**MapTiler SDK** extends `maplibregl.Map` directly. Pass the instance as-is:

```tsx
import { Map } from '@maptiler/sdk'
import { ElementEditorControls } from '@element-editor/adapter-maplibre'
<ElementEditorControls map={maptilerMapInstance} onChange={handleChange} />
```

**Mapbox GL JS** shares the same API surface at runtime. A TypeScript cast is required because the type names differ:

```tsx
import mapboxgl from 'mapbox-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ElementEditorControls } from '@element-editor/adapter-maplibre'
<ElementEditorControls map={mapboxMapInstance as unknown as MapLibreMap} onChange={handleChange} />
```

In both cases, render `ElementEditorControls` inside `ElementEditorUIProvider`, `GeoStoreProvider` and a `data-elm-theme` element, as above.

---

## Basemaps

The package ships a built-in basemap catalog (OpenFreeMap vector styles, OpenStreetMap raster) and a picker. See the [Basemaps guide](../guides/basemaps.md) for the full story.

```tsx
import { BasemapControl } from '@element-editor/adapter-maplibre'
import { setBasemap, loadBasemapStyle, BASEMAPS } from '@element-editor/adapter-maplibre/basemaps'
```

`BasemapControl` props: `map?` (defaults to the map of the surrounding `ElementEditorControls`), `basemaps?: BasemapInput[]` (default `'auto'` + all built-ins), `value?`, `defaultValue?` (`'auto'`), `onChange?`, `storageKey?` (persist the choice in `localStorage`, namespaced by `config.persistKey`; nothing is stored with `config.persist: false`), `initialApplied?` (the map was created with the initial basemap already). The built-ins load from the servers in the editor's `config.network` (`vectorTiles`, `dem`, `osmRaster`, `glyphs`, `sprite`). Without a `map` (and outside `ElementEditorControls`) it is a plain `value`/`onChange` picker. With a map it doesn't touch your style on mount unless you pass `value` or an explicit `defaultValue`, or a pick was remembered under `storageKey`; the implicit `'auto'` default is only shown as selected until the user picks.

Custom entries (`{ style }` / `{ url, attribution }`) take an optional `id`: the picker keys entries on it and a custom pick is remembered only with one. Give every custom style object a unique `id`; two without one (or two with the same id/label) get a dev-mode warning.

`useBasemap(map, basemap, { theme, initialApplied? })` keeps `map` on `basemap` (re-applying `'auto'` when `theme` flips). `BasemapControl` uses it; call it yourself in an always-mounted component when the picker can be hidden. `initialApplied: true` means the map was created with the first `basemap` (and `theme`) the hook was called with: that one isn't re-applied, but a different value by the time `map` arrives (e.g. while the style was still loading) is.

The `/basemaps` entry exports `BASEMAPS`, `BasemapInput`, `BuiltinBasemapId`, `resolveBasemap(input, theme)`, `loadBasemapStyle(input, { theme?, network? })`, `setBasemap(map, input, { theme?, network? })` (`network`: the tile part of `config.network`, type `BasemapNetwork`) (switches style while keeping Element's layers and your own sources and layers: everything that wasn't part of the previous basemap; not your `addImage` images) `DEFAULT_SPRITE_URL` and `DEFAULT_GLYPHS_URL`.

---

## Exports

| Export | Kind | Description |
|---|---|---|
| `ElementEditorControls` | Component | The editing layer component. |
| `useMapLibre` | Hook | Access the `maplibregl.Map` instance from descendants. |
| `ElementEditorUIProvider` | Component | Context stack for the editor and the `@element-editor/ui` components. |
| `GeoStoreProvider`, `StoreContext` | Component / context | Store provider. Also exported by `@element-editor/ui`. |
| `MapControllerProvider`, `useMapController`, `useSetMapController` | Component / hooks | Map controller context (fly-to, fit-bounds). |
| `FeatureStyleProvider`, `useFeatureStyle` | Component / hook | Per-feature style context (what `getFeatureStyle` feeds). |
| `FloatingToolbar`, `EditingToolbar`, `ActiveDrawingToolbar`, `useKeyboardShortcuts` | Components / hook | Re-exported from `@element-editor/ui`. Don't call `useKeyboardShortcuts` yourself: `ElementEditorControls` already mounts it. |
| `FeatureLayer`, `DrawingLayer`, `DrawingPreviewLayer`, `FeatureInteractionLayer`, `FitBounds`, `VertexEditor`, `TransformControls`, `SnapController`, `BoundaryLayer`, `GeometryProcessingPreview`, `MeasurePreviewLayer`, `MeasurementTooltip`, `OsmTraceHandler`, `BoxSelectHandler` | Components | Individual layers, for advanced use. `ElementEditorControls` renders them for you and adds their GL sources and layers, except `FitBounds` (fits the map to the store's features on mount; mount it yourself, inside `ElementEditorControls`' providers, if you want that). |
| `findSnapPoint`, `snapToAngle` | Functions | Snapping utilities. |
| `useDataStore`, `useUIStore`, `useGeoStore` | Hooks | Access the stores. |
| `BasemapControl`, `BasemapControlProps`, `useBasemap` | Component / type / hook | Basemap picker that applies the choice with `setBasemap`; `useBasemap` is the applying hook on its own. The catalog itself is in `@element-editor/adapter-maplibre/basemaps`. |
| `ElementEditorError` | Class | Re-exported from `@element-editor/core`. What `onError` receives (see [Events](./events.md#onerror)). |
| `ElementEditorEvent`, `ElementEditorErrorHandler`, `ErrorCode`, `ErrorSource` | Types | `onEvent` / `onError` types. |
| `ElementEditorControlsProps`, `ElementEditorControlsRef`, `DrawingTool`, `ElementEditorUIProviderProps`, `MapController`, `FeatureStyle`, `FeatureStyleFn`, `ElementEditorConfig`, `ResolvedConfig`, `ToolbarPosition` | Types | |

`DrawingCursorHint` is no longer exported. The data types (`FeatureCollection`, `GeoJSONFeature`, `Schema`, …) are not re-exported; import them from `@element-editor/core`.
