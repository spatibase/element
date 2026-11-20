# @element-editor/adapter-leaflet

*Complete API reference for the Leaflet editing layer.*

---

## Install

```bash
npm install @element-editor/adapter-leaflet leaflet react-leaflet
```

### Peer dependencies

| Package | Version |
|---|---|
| `leaflet` | `^1.9` |
| `react-leaflet` | `^5` |
| `react` | `^19.2` |
| `react-dom` | `^19.2` |

React 18 is not supported. `@element-editor/core` and `@element-editor/ui` are installed as regular dependencies (not bundled). To import from them directly, add them to your own `package.json` at the same version. The geometry worker is inlined, so no bundler configuration is needed.

### CSS import

> **Warning:** Always import the adapter stylesheet. The JavaScript entry doesn't import any CSS; without it, map tiles, markers and the editor UI break silently.

```tsx
import '@element-editor/adapter-leaflet/style.css'
```

It includes Leaflet's CSS (`leaflet/dist/leaflet.css`) and the data table's CSS. It doesn't reset your page: Tailwind's base styles apply only inside `[data-elm-theme]` elements and the editor's own portals.

---

## Requirements

- `ElementEditorUIProvider` must be an ancestor of `ElementEditorControls`. It provides the error boundary, config, shortcut configuration, events and toasts, and the map controller. `ElementEditorControls` throws without the shortcut and event contexts.
- `GeoStoreProvider` must wrap `MapContainer` (or any ancestor thereof). It creates the isolated Zustand store. One per editor.
- The map and all Element UI must be inside an element with `data-elm-theme="light"` or `"dark"`. It scopes the editor's styles and its keyboard shortcuts.
- `ElementEditorControls` must be rendered as a **child** of `MapContainer`. It uses `useMap()` from react-leaflet internally.

```tsx
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import '@element-editor/adapter-leaflet/style.css'

export default function MyMap() {
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ width: '100%', height: '600px' }}>
          <MapContainer center={[48.86, 2.35]} zoom={5} style={{ width: '100%', height: '100%' }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ElementEditorControls onChange={(data) => console.log(data)} />
          </MapContainer>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

---

## `<ElementEditorControls>`

```tsx
import { ElementEditorControls } from '@element-editor/adapter-leaflet'
```

Renders no visible HTML. Mounts the Element editing layer into the Leaflet map. Also mounts the shared keyboard-shortcut listeners — do not call `useKeyboardShortcuts()` again in your tree or every shortcut will fire twice.

---

## `ElementEditorControlsProps`

| Prop | Type | Default | Required | Description |
|---|---|---|---|---|
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
| `geometryTypes` | `GeometryType[]` | — | No | The geometry types the editor accepts, as GeoJSON type names (`'Point'`, `'MultiPoint'`, `'LineString'`, `'MultiLineString'`, `'Polygon'`, `'MultiPolygon'`, `'GeometryCollection'`). Omit to allow all. Enforced by the store for every way a geometry gets in (drawing, paste, imports, `initialData`, merge, break apart, boolean operations, buffer, the ref API): a refusal changes nothing and reports an `error` event with code `'geometry-type-not-allowed'`. Drawing tools that can't draw an allowed type leave the toolbar, and menu actions whose result would be refused are hidden. Imports skip the refused features (`ImportResult.refused`). See [Restricting tools](../guides/restricting-tools.md#allowed-geometry-types). |
| `replaceAtLimit` | `boolean` | `false` | No | With `maxFeatures={1}`: drawing tools (point, line, area, rectangle, circle, freehand, route, picker) replace the only feature's geometry instead of being refused, keeping its `id`, properties, schema and group (`_drawType` follows the new shape). One undo step, one `onFeatureUpdate`. Paste, duplicate, import merge and `addFeature` still refuse. Ignored for any other limit. |
| `coordinates` | `CoordinateOptions` | — | No | Opt-in clean-up of every committed coordinate (drawing, vertex edits, transforms, import, paste, undo and redo, `initialData`, ref methods), so the store, `onChange` and undo history hold the same values. `{ wrap?: boolean; precision?: number }`, both off by default. `wrap: true` shifts a feature as a whole by a multiple of 360° so the centre of its longitude range lies in [-180, 180] (vertices stay continuous; a shape crossing the antimeridian may keep one side beyond ±180; latitudes beyond ±90 are clamped). `precision: n` rounds x and y to `n` decimals (integer 0 to 15) and keeps altitude as is. Not the same as `config.units.precision`, which only formats displayed values. See [Clean coordinates](../guides/persisting-data.md#clean-coordinates). |
| `readonly` | `boolean` | `false` | No | Disable all editing interactions. Features remain visible. |
| `onFeatureAdd` | `(feature: GeoJSONFeature) => void` | — | No | Fires when a feature is added. Fires after `onChange` for the same operation. |
| `onFeatureUpdate` | `(id: string, feature: GeoJSONFeature) => void` | — | No | Fires when a feature's geometry or properties change. Fires after `onChange`. |
| `onFeatureDelete` | `(id: string) => void` | — | No | Fires when a feature is deleted. Fires after `onChange`. |
| `onSelectionChange` | `(ids: string[]) => void` | — | No | Fires when selection changes. Fires independently of feature data changes. |
| `onFeatureSelect` | `(feature: GeoJSONFeature \| null) => void` | — | No | Fires with the single selected feature, or `null` when nothing or several features are selected. |
| `onZoomChange` | `(zoom: number) => void` | — | No | Fires when the map zoom changes. |
| `onToolChange` | `(tool: DrawingTool \| null) => void` | — | No | Fires with the tool that turned on (as `ref.getTool()` reports it), or `null` when it turned off. |
| `onVertexEditChange` | `(id: string \| null) => void` | — | No | Fires with the id of the feature that entered point editing (as `ref.getVertexEdit()` reports it), or `null` when it ended, by the user or by `ref.setVertexEdit`. |
| `routingApiKey` | `string` | — | No | **Deprecated** (dev warning): set `config.network.routing.apiKey` on the surrounding `ElementEditorUIProvider`, which wins when both are set. All servers the controls use (routing, Overpass, search) come from `config.network`: see [Third-party services and self-hosting](../guides/third-party-services.md). |
| `bounds` | `[number, number, number, number] \| null` | — | No | Leaflet max bounds: the user can't pan outside this box. A GeoJSON bbox `[west, south, east, north]` (`[lng, lat]` order, like your data). `null` clears. *Deprecated:* the nested `[[south, west], [north, east]]` Leaflet-order form still works and logs a one-time dev warning with the bbox equivalent. |
| `getFeatureStyle` | `(feature: GeoJSONFeature) => (FeatureStyle & PathOptions) \| undefined \| null` | — | No | `FeatureStyle` plus any Leaflet `PathOptions` per feature (`null`/`undefined` = default look), applied to polygons, lines and point pins (pins take `fillColor`, then `color`). `fillColor` falls back to `color`, as on MapLibre, so a `FeatureStyle` callback works unchanged. Wins over `config.featureColor` per key; the selected look wins over it, hover keeps the colour. Called on every render; keep it fast. See [Colouring features](../guides/theming.md#colouring-features). |
| `renderer` | `'canvas' \| 'svg'` | `'canvas'` | No | How unselected polygons and lines are drawn. `'canvas'` paints them on one shared `<canvas>` (in a pane named `elmIdleFeatures`, just below `overlayPane`), so panning and zooming stay smooth with thousands of features. `'svg'` gives each feature its own `<path>`; use it if your app styles or queries feature paths through CSS or the DOM. Selected features, editing handles and drawing previews are always SVG. Points are markers in both modes. |
| `onReady` | `(map: L.Map) => void` | — | No | Called once per map, as soon as Element's layers and panes are on it. |

---

## `ElementEditorControlsRef`

The imperative handle exposed via `ref`: `ElementEditorImperativeAPI<L.Map>` from `@element-editor/ui`, the same surface as `ElementEditorRef` in `@element-editor/react`. Data-changing methods behave like the user's own edits (validation, `maxFeatures`, undo, `onChange` / `onFeature*` callbacks) and also work in `readonly` mode.

```ts
interface ElementEditorControlsRef {
  /** Returns the current FeatureCollection. `_validation` is stripped. */
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
  /** Puts a LineString / Polygon in point editing (selects it, tool off); null leaves. False for unknown, hidden, other geometries, readonly. */
  setVertexEdit: (id: string | null) => boolean
  /** Id of the feature in point editing, or null. */
  getVertexEdit: () => string | null
  /** Whether undo() / redo() would change something. */
  canUndo: () => boolean
  canRedo: () => boolean
  /** Validates every feature against its schema and geometry; changes nothing, calls no callback. */
  validate: () => { valid: boolean; errors: Record<string, string[]> }
  /** The L.Map you passed in (null only before the controls have mounted). */
  getMap: () => L.Map | null
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
  /** Redo the last undone change. */
  redo: () => void
  /** Clears the current selection. */
  clearSelection: () => void
}

interface ImportResult {
  skipped: number
  duplicates: number
  truncated: boolean
  refused: number
}
```

Same methods as `ElementEditorRef` in `@element-editor/react` (both are `ElementEditorImperativeAPI` from `@element-editor/ui`; here `getMap()` is typed `L.Map`). See [`ElementEditorRef`](./element-editor-react.md#elementeditorref) for `ImportResult`, `MutationOptions` and the details of each method.

Usage:

```tsx
import { useRef } from 'react'
import { ElementEditorControls, type ElementEditorControlsRef } from '@element-editor/adapter-leaflet'
import { getFeatureCollectionBBox } from '@element-editor/core' // add @element-editor/core to your package.json

const ref = useRef<ElementEditorControlsRef>(null)

<ElementEditorControls ref={ref} />

// Later:
const data = ref.current?.getFeatureCollection()
ref.current?.setFeatureCollection(newData)
ref.current?.undo()
ref.current?.redo()
ref.current?.clearSelection()
ref.current?.select(['a', 'b'], { fit: true })
ref.current?.setTool('polygon')
const added = ref.current?.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [14.42, 50.09] }, properties: {} })
ref.current?.updateFeature(id, { properties: serverProps }, { undoable: false }) // e.g. a server push: not undoable, survives the user's undo

// Zoom-to-fit after an import:
const bbox = getFeatureCollectionBBox(newData)
if (bbox) ref.current?.fitBounds(bbox)
```

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
import { GeoStoreProvider } from '@element-editor/adapter-leaflet'
```

Creates an isolated Zustand store instance. All `@element-editor/ui` components and `ElementEditorControls` within the same provider share this store. Re-exported from `@element-editor/ui` for convenience — both are the same component.

---

## `ElementEditorUIProvider`

```tsx
import { ElementEditorUIProvider } from '@element-editor/adapter-leaflet'
```

The same component as `@element-editor/adapter-maplibre`'s and `@element-editor/ui`'s (it lives in `@element-editor/ui`; both adapters re-export it).

Bundles the full UI context stack — `ElementEditorErrorBoundary`, `ElementEditorConfigProvider`, `ShortcutConfigProvider`, `EventProvider`, `MapControllerProvider` — in the order `@element-editor/ui` panels expect. Wrap your map component with this when you want toolbars / panels / modals from `@element-editor/ui` outside the `MapContainer`. `ElementEditorControls` needs it too.

| Prop | Type | Default | Description |
|---|---|---|---|
| `config` | `ElementEditorConfig` | — | Theme mode, tools, UI visibility, toolbar layout, units. See [`ElementEditorConfig`](./element-editor-react.md#elementeditorconfig). `ui.geojsonEditorOpen` opens the inspector on mount (it sets `codeModalOpen`), so it shows when you render `GeoJSONModal` from that flag as in the quickstart; pass `fallback={<GeoJSONDockPlaceholder />}` to its `<Suspense>` so the controls don't jump while its chunk loads. |
| `accentColor` | `string` | — | Brand accent: any CSS colour. Wins over `config.accentColor`. `<ElementEditorControls>` writes it as `--elm-accent` onto the nearest `[data-elm-theme]` ancestor of the map container; Element's portals get it too. Updates live. See [Theming](../guides/theming.md#approach-1--one-brand-colour). |
| `featureColor` | `string` | — | Default colour of every feature (polygon outline + fill, lines, points). Wins over `config.featureColor`; `getFeatureStyle` and the selected look win over it, hover keeps it. Opacity and weight keep their defaults. Updates live. See [Colouring features](../guides/theming.md#colouring-features). |
| `onEvent` | `(event: ElementEditorEvent) => void` | — | Receives every user-facing message; when set, no toasts are shown. |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | — | Called first for every runtime failure (code, source, English message), including a render crash caught by the error boundary (`code: 'crash'`, the original error is `cause`). Return `false` to stop the toast, or a string to replace its text. See [Events](./events.md#onerror). |
| `toaster` | `boolean` | `true` | Render Element's own sonner `<Toaster>`. Its toasts carry a per-instance id, so a `<Toaster>` your app renders, or a second editor, never shows them twice. Pass `false` to send toasts to your own untagged `<Toaster>`. |
| `children` | `ReactNode` | — | Your map, `GeoStoreProvider` and UI. |

It doesn't set `data-elm-theme` or `ThemeContext`; render those yourself (see [Theming](../guides/theming.md#adapter-theming)).

---

## Exports

| Export | Kind | Description |
|---|---|---|
| `ElementEditorControls` | Component | The editing layer component. |
| `ElementEditorUIProvider` | Component | Context stack for the editor and the `@element-editor/ui` components. |
| `GeoStoreProvider`, `StoreContext` | Component / context | Store provider. Also exported by `@element-editor/ui`. |
| `MapControllerProvider`, `useMapController`, `useSetMapController` | Component / hooks | Map controller context (fly-to, fit-bounds). Re-exported from `@element-editor/ui`. |
| `useMapInteractionMachine` | Hook | The interaction state machine (draw/select/vertex/transform modes). |
| `FloatingToolbar`, `EditingToolbar`, `ActiveDrawingToolbar`, `useKeyboardShortcuts` | Components / hook | Re-exported from `@element-editor/ui`. Don't call `useKeyboardShortcuts` yourself: `ElementEditorControls` already mounts it. |
| `FeatureStyleProvider`, `useFeatureStyle` | Component / hook | Per-feature style context (what `getFeatureStyle` feeds). |
| `FitBounds`, `DrawingLayer`, `FeatureInteractionLayer`, `DrawingPreviewLayer`, `SnapController`, `TransformControls`, `RoutePreviewLayer`, `BoundaryLayer`, `MeasurementTooltip` | Components | Individual map layers, for advanced use. `ElementEditorControls` renders them for you, except `FitBounds` (fits the map to the store's features once on mount; mount it inside the `MapContainer` if you want that). `FeatureInteractionLayer` draws every feature once (unselected ones on a shared canvas unless `renderer="svg"`). |
| `toLeaflet`, `toGeoJSON`, `findSnapPoint`, `snapToAngle` | Functions | Coordinate conversion and snapping utilities. |
| `useDataStore` | Hook | Access the data store (features, schemas, groups). |
| `useUIStore` | Hook | Access the UI store (modal state, tool selection, etc.). |
| `useGeoStore` | Hook | Access the raw store instances (`dataStore`, `uiStore`). |
| `ElementEditorError` | Class | Re-exported from `@element-editor/core`. What `onError` receives (see [Events](./events.md#onerror)). |
| `ElementEditorEvent`, `ElementEditorErrorHandler`, `ErrorCode`, `ErrorSource` | Types | `onEvent` / `onError` types. |
| `ElementEditorControlsProps`, `ElementEditorControlsRef`, `DrawingTool`, `FeatureRenderer`, `ElementEditorUIProviderProps`, `MapController`, `FeatureStyle`, `FeatureStyleFn`, `MapInteractionMachine`, `InteractionPhase`, `ElementEditorConfig`, `ResolvedConfig`, `ToolbarPosition` | Types | |

The data types (`FeatureCollection`, `GeoJSONFeature`, `Schema`, …) are not re-exported. Import them from `@element-editor/core`.
