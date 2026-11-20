# @element-editor/ui

*UI components for building custom editor layouts with adapter packages.*

---

## Purpose

`@element-editor/ui` is not needed when using `@element-editor/react` (either entry) — the full editor UI is included there. Install `@element-editor/ui` when using `@element-editor/adapter-leaflet` or `@element-editor/adapter-maplibre` and you want toolbars, panels, and modals with control over their placement in your layout.

```bash
npm install @element-editor/ui
```

Peer dependencies: `react` and `react-dom` `^19.2` (React 18 is not supported; the data table needs React 19.2). `@element-editor/ui` has no stylesheet export of its own: the old `@element-editor/ui/style.css` is gone. Its styles ship inside each adapter's stylesheet, so import `@element-editor/adapter-leaflet/style.css` or `@element-editor/adapter-maplibre/style.css` (or `@element-editor/react/style.css`).

Render every component inside an element with `data-elm-theme="light"` or `"dark"`. The stylesheet applies Tailwind's base styles only there (and in the editor's own portals), so it never restyles your page; components outside it look unstyled.

The geometry worker is inlined and loaded lazily on the first geometry operation, so no bundler configuration (worker plugins, `optimizeDeps` exclusions) is needed.

Every entry point (`@element-editor/ui`, `/primitives`, `/internal`) starts with a `'use client'` directive, so a Next.js App Router Server Component can import it (the components still run only in the browser).

---

## Store / Context

### `GeoStoreProvider`

```tsx
import { GeoStoreProvider } from '@element-editor/ui'
```

Creates an isolated Zustand store instance shared between `ElementEditorControls` and all `@element-editor/ui` components in the same tree. Must be an ancestor of both the adapter `ElementEditorControls` and any UI components.

Also re-exported by `@element-editor/adapter-leaflet` and `@element-editor/adapter-maplibre` for convenience. All three are the same component.

### `StoreContext`

The React context object holding the store instances. Advanced use only — prefer `useDataStore` and `useUIStore` hooks.

---

## Providers

`ElementEditorUIProvider` (exported here and re-exported by both adapters) sets up `ElementEditorErrorBoundary`, `ElementEditorConfigProvider`, `ShortcutConfigProvider`, `EventProvider` (with its own `<Toaster>`) and `MapControllerProvider` in one component. Use the providers below individually only if you need finer control.

### `ShortcutConfigProvider`

```tsx
import { ShortcutConfigProvider } from '@element-editor/ui'
```

Required for keyboard shortcut display and the `useShortcutConfig` hook. Wrap the component tree that contains any UI component displaying shortcut keys.

### `EventProvider`

```tsx
import { EventProvider } from '@element-editor/ui'
```

Routes every user-facing message (errors, warnings, confirmations, undo) to toasts or to your `onEvent` handler. Required by `ElementEditorControls` and most UI components (`useEmit` throws without it).

| Prop | Type | Default | Description |
|---|---|---|---|
| `onEvent` | `(e: ElementEditorEvent) => void` | — | Receive every event yourself. When set, the editor shows no toasts at all. Read once at mount. |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | — | Called first for every runtime failure; return `false` to stop the toast / `onEvent` error event, or a string to replace the toast text. A nested `EventProvider` with only `onError` runs it, then hands the event to the enclosing provider. See [Events](./events.md#onerror). |
| `toaster` | `boolean` | `false` | Render this instance's own sonner `<Toaster>` and tag its toasts with a per-instance id, so a host `<Toaster>` or a second editor never shows them twice. Ignored when `onEvent` is set. With the default `false`, toasts go to an untagged `<Toaster>` your app renders. (`ElementEditorUIProvider` passes `true`.) |

```tsx
<EventProvider onEvent={(e) => handleEvent(e)}>
  {children}
</EventProvider>
```

Store-level errors (for example a failed cut or slice, or invalid `initialData`) reach the same `EventProvider` whether it sits above or below `GeoStoreProvider`.

### `ThemeContext.Provider`

```tsx
import { ThemeContext } from '@element-editor/ui'

<ThemeContext.Provider value="dark">
  {children}
</ThemeContext.Provider>
```

Passes the resolved theme (`'light'` or `'dark'`) to portaled components that render outside the normal DOM hierarchy. Required for correct dark mode in modals.

### `MapControllerProvider`

```tsx
import { MapControllerProvider } from '@element-editor/ui'
```

Provides the `MapController` context to descendants. Required for `FitBoundsButton` and any component that calls `useMapController()`. Included in the adapters' `ElementEditorUIProvider`, and also provided by `@element-editor/adapter-maplibre`'s `ElementEditorControls` for its `children`. With `@element-editor/adapter-leaflet`, use `ElementEditorUIProvider` or add it yourself above both `MapContainer` and the UI. Zoom-to actions (fit bounds, zoom to a feature) fly to their target.

---

## Toolbars

| Component | Description |
|---|---|
| `FloatingToolbar` | Drawing tool selector. Reads enabled tools from the store. Typically positioned top-center above the map. |
| `EditingToolbar` | Editing action buttons (boolean operations, transform, delete, duplicate). Appears when features are selected. |
| `ActiveDrawingToolbar` | "Finish drawing" and "Cancel" buttons. Appears while actively drawing. |
| `FitBoundsButton` | Button that flies the map to fit all visible features. Requires `MapControllerProvider` in the tree. |
| `ZoomIndicator` | Click-to-edit current zoom level badge. Reads `currentZoom` from the store, calls `mapController.flyTo` on commit. A click opens the input with the caret at the end; the `Z` shortcut opens it with the number selected. Validation errors emit via `EventProvider`. Optional `minZoom`/`maxZoom` props (default 1–22). |
| `LocateButton` | Geolocation button — calls `navigator.geolocation` and flies the map to the user's location. Errors emit via `EventProvider`. Optional `zoom` prop (default 15). |
| `ReadonlyBanner` | "View-only mode" pill rendered at the bottom-center when `readonly` is on. Replaces the empty space where editing toolbars would normally sit. No props. |
| `BooleanOperations` | Boolean operation buttons (union, intersect, subtract, exclude, cut hole, slice) as a standalone component. Lazy-loaded: render it inside `<Suspense>`. |

```tsx
import {
  FloatingToolbar, EditingToolbar, ActiveDrawingToolbar, UndoRedoToolbar,
  FitBoundsButton, ZoomIndicator, LocateButton, ReadonlyBanner,
  BooleanOperations, SimplifyPanel, SmoothPanel, BufferPanel,
  FeatureMapContextMenu,
} from '@element-editor/ui'
```

---

## Panels

| Component | Description |
|---|---|
| `LayersPanel` | Feature list sidebar with layer visibility toggles, group management, and schema selector. Its open/close toggle sits in the panel header, left of the "Layers" label, while the panel is open; when it's closed, the toggle is a floating button at the top-right edge of the map, level with the header. Shortcut `/` by default. Right-click a feature row for its menu, which starts with **Zoom to feature**. |
| `FeatureSidePanel` | Property editing panel for the currently selected feature. Used in split layout. Requires a `dialogState` prop. Its **Source** section shows the feature's GeoJSON with syntax highlighting. |
| `FeatureEditModal` | Property form for a selected feature, rendered as a floating modal. Requires a `dialogState` prop. Lazy-loaded: render it inside `<Suspense>`. |
| `FeatureList` | The feature list as a standalone component (without the panel chrome). Lazy-loaded (it carries the drag-and-drop library): render it inside `<Suspense>`. |
| `FeatureRow` | Single row in the feature list. `featureLabel(feature)` is exported alongside as a labelling helper. |
| `GroupRow` | Group row in the feature list. |
| `PartSubRow` | Sub-row for individual parts of a multi-geometry feature. |
| `SchemaEditor` | Schema field management UI as a standalone component. Lazy-loaded: render it inside `<Suspense>`. |
| `DataTablePanel` | Full spreadsheet view of all features and their properties, rendered in a resizable panel. Lazy-loaded: render it inside `<Suspense>`. |
| `DataTable` | The data grid as a standalone component (without the panel chrome). Lazy-loaded (it carries the data grid library): render it inside `<Suspense>`. |
| `BasemapPicker` | Engine-neutral basemap switcher: an icon button opening a panel of thumbnail tiles. Props: `options: { id, label, thumbnail?: string \| [string, string] }[]`, `value`, `onChange(id)`, `label?` (default `'Basemap'`), `size?`, `tooltipSide?`. It applies nothing; the host reacts to `onChange`. The panel stays open while the user picks basemaps or works on the map; only the button again or Escape closes it. `label` is the button label and the panel's accessible name (no visible title). The drop-ins and `BasemapControl` (adapter-maplibre) use it. Types `BasemapPickerOption`, `BasemapPickerProps`. |

```tsx
import {
  LayersPanel, FeatureSidePanel, FeatureEditModal,
  FeatureList, FeatureRow, featureLabel,
  GroupRow, PartSubRow,
  SchemaEditor, DataTablePanel, DataTable, BasemapPicker,
} from '@element-editor/ui'
```

> **Note:** `FeatureEditModal`, `DataTablePanel`, `DataTable`, `FeatureList`, `SchemaEditor`, `BooleanOperations`, `SchemaModal`, `GeoJSONModal`, `ShortcutsModal`, and `SettingsModal` are exported as `lazy()` components. Each call site must be wrapped in its own `<Suspense>` — sharing one boundary across multiple lazy siblings causes already-loaded ones to unmount when a new sibling suspends.

---

## Modals

| Component | Description |
|---|---|
| `ShortcutsModal` | Keyboard shortcut reference panel. Lazy-loaded. |
| `SettingsModal` | Editor settings — snap toggle, basemap picker, geometry mode, units. Lazy-loaded. |
| `SchemaModal` | Schema editor — add, edit, and remove schemas and fields. Lazy-loaded. Accepts an `onClose` callback. |
| `GeoJSONModal` | Raw GeoJSON inspector and inline editor. Lazy-loaded. Accepts an `onClose` callback. Opens docked beside the map unless the user last undocked it (floating window). |
| `GeoJSONDockPlaceholder` | Not lazy. Use it as the `GeoJSONModal` Suspense fallback: an empty dock frame while the chunk loads (nothing when the inspector opens floating), so the controls don't jump. |

All four are lazy-loaded (`React.lazy`), so their dependencies (CodeMirror, the data grid) load in separate chunks. Render each inside its own `<Suspense>` (React throws without one; a boundary shared by several lazy components unmounts the loaded ones whenever another starts loading). `ShortcutsModal` and `SettingsModal` render nothing while closed; `SchemaModal` and `GeoJSONModal` render whenever mounted, so mount them only while open:

```tsx
import { Suspense } from 'react'
import {
  ShortcutsModal,
  SettingsModal,
  SchemaModal,
  GeoJSONModal,
  useUIStore,
} from '@element-editor/ui'

function Modals() {
  const schemaOpen = useUIStore((s) => s.schemaModalOpen)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const codeOpen = useUIStore((s) => s.codeModalOpen)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)

  return (
    <>
      <Suspense fallback={null}><ShortcutsModal /></Suspense>
      <Suspense fallback={null}><SettingsModal /></Suspense>
      {schemaOpen && <Suspense fallback={null}><SchemaModal onClose={toggleSchema} /></Suspense>}
      {codeOpen && <Suspense fallback={null}><GeoJSONModal onClose={toggleCode} /></Suspense>}
    </>
  )
}
```

---

## Error boundary

### `ElementEditorErrorBoundary`

```tsx
import { ElementEditorErrorBoundary } from '@element-editor/ui'

<ElementEditorErrorBoundary onError={(err) => console.error(err)}>
  {children}
</ElementEditorErrorBoundary>
```

Catches render/runtime errors in the editor tree and shows a minimal recovery UI. `onError` gets the caught error wrapped as an `ElementEditorError` with `code: 'crash'`, `source: 'editor'` (the original error is its `cause`). Mounted automatically by `@element-editor/react`'s `<ElementEditor>` and by both adapters' `ElementEditorUIProvider`.

---

## Primitives

| Export | Kind | Description |
|---|---|---|
| `Button` | Component | Standard button with `variant` prop (`'primary'`, `'secondary'`, etc.). |
| `Input` | Component | Single-line text input. |
| `Textarea` | Component | Multi-line text input. |
| `SelectInput` | Component | Styled select element. |
| `Kbd` | Component | Keyboard key display (light background). |
| `KbdDark` | Component | Keyboard key display (dark background). |
| `KbdInvert` | Component | Keyboard key display (inverted). |
| `Tooltip` | Component | Accessible tooltip wrapper. Accepts `content`, `shortcut`, and `side` props. It flips to the other side and is clamped so it stays on screen. |
| `IconButton` | Component | 48×48 card-style icon button matching the editor visual. Tooltip-wrapped, supports `active`/`disabled` states. While `active`, a Phosphor icon child is drawn filled in the accent colour (`aria-pressed` is set). Use for custom controls slotted via `slots.<corner>` so they line up with built-in buttons. `shortcutId` (also on `ToolButton` / `EditToolbarBtn`) names the shortcut that triggers the same action (`data-elm-shortcut`), so pressing the key flashes the button pressed. |
| `ToolButton` | Component | Icon button for toolbars. |
| `EditToolbarBtn` | Component | Button styled for the editing toolbar. |
| `ToolbarDivider` | Component | Visual divider between toolbar sections. |
| `ContextMenu` | Component | Right-click context menu. Pairs with `isContextMenuOpen()` and the `CONTEXT_MENU_MARKER_ATTR` data-attribute marker. |
| `SearchDropdown` | Component | Searchable dropdown input. |
| `SearchDropdownHandle` | Type | Ref type for `SearchDropdown`. |

```tsx
import {
  Button, Input, Textarea, SelectInput,
  Kbd, KbdDark, KbdInvert,
  Tooltip, IconButton, ToolButton, EditToolbarBtn, ToolbarDivider,
  ContextMenu, isContextMenuOpen, CONTEXT_MENU_MARKER_ATTR,
  SearchDropdown,
} from '@element-editor/ui'
import type { SearchDropdownHandle } from '@element-editor/ui'
```

---

## Hooks

### `useDataStore(selector)`

```ts
const features = useDataStore((s) => s.features)
const selectedIds = useDataStore((s) => s.selectedIds)
```

Subscribes to the data Zustand store. See `DataStore` in the [Types reference](./types.md).

### `useUIStore(selector)`

```ts
const tableOpen = useUIStore((s) => s.tableOpen)
const toggleTable = useUIStore((s) => s.toggleTable)
```

Subscribes to the UI Zustand store (modal state, tool state, panel visibility).

### `useGeoStore()`

```ts
const { dataStore, uiStore } = useGeoStore()
```

Returns the raw Zustand store instances for imperative access. Their state types, `DataStore` and `UIStore`, are exported as types from `@element-editor/ui` and `@element-editor/core` (see [`DataStore`](./types.md#datastore) and [`UIStore`](./types.md#uistore)):

```ts
import type { DataStore } from '@element-editor/ui'

const selectCount = (s: DataStore) => s.features.length
```

### `useShortcutConfig()`

```ts
const { getKey } = useShortcutConfig()
const key = getKey('draw-polygon') // returns current binding, e.g. 'g'
```

Returns the current key binding for any `ShortcutId`. Reflects custom bindings saved by the user. Must be called inside `ShortcutConfigProvider`.

### `useElementEditorConfig()`

```ts
const cfg = useElementEditorConfig()
cfg.mode            // 'light' | 'dark' | 'system'
cfg.toolbar.position  // the toolbar's ui.layout slot as a ToolbarPosition
cfg.ui.dataTable
cfg.units.length
```

Returns the resolved config (with defaults applied and the user's persisted units override merged in). Must be called inside `ElementEditorConfigProvider`.

### `useUnitsOverride()`

```ts
const { override, setUnits, resetUnits } = useUnitsOverride()
setUnits({ length: 'metric' })
```

Read/write the user's persisted units override. Persists to `localStorage`. Use this from settings UIs; consumers reading current values should prefer `useElementEditorConfig().units`.

### `resolveConfig(config?)`

```ts
import { resolveConfig } from '@element-editor/ui'
const resolved = resolveConfig({ mode: 'dark' })
```

Pure helper that applies defaults to a `ElementEditorConfig` and returns a `ResolvedConfig`. Useful for previewing a config object without rendering a provider.

### `useMapController()`

```ts
const controller = useMapController()
controller.flyTo?.([48.86, 2.35], 12)
controller.fitBounds?.([0, 0, 1, 1])
controller.panTo?.([48.86, 2.35])
controller.getCenter?.()           // returns [lng, lat]
controller.setZoom?.(15)
controller.getZoomBounds?.()       // { min, max }
controller.getMap?.()              // the engine's map (backs ref.getMap())
```

Returns the `MapController` object. Methods may be `null` if no map controller has been registered yet. A custom map bridge should set `getMap: () => map` so `ref.getMap()` works.

### `useEmit()`

```ts
const emit = useEmit()
emit({ type: 'success', message: 'Saved.' })
```

Returns a stable function to emit a `ElementEditorEvent`. Must be called inside `EventProvider`. When `onEvent` is provided to `EventProvider`, emitted events are forwarded to that handler instead of firing sonner toasts. Use it instead of calling sonner's `toast()` directly, so `onEvent` sees every message and toasts land in the right editor's `<Toaster>`.

The argument is an `EmittedEvent`: a `ElementEditorEvent` that may also carry `description`, a second line the default toast shows under the message:

```ts
emit({ type: 'error', message: 'Save failed.', description: 'The server returned 503. Try again.' })
```

### `useToasterId()`

```ts
import { useToasterId } from '@element-editor/ui'
import { toast } from 'sonner'

const toasterId = useToasterId()
toast.loading('Uploading…', { toasterId })
```

Returns the sonner toaster id of this editor's own `<Toaster>`, or `undefined` when toasts go to your app's untagged `<Toaster>`. Pass it to direct sonner calls that have no `ElementEditorEvent` equivalent (such as `toast.loading`), so the toast shows in the right place. Skip such toasts when `useIsManaged()` is true.

### `useTheme()`

```ts
const theme = useTheme() // 'light' | 'dark'
```

Returns the current resolved theme from `ThemeContext`.

### `useAccentPalette(el)`

```ts
import { useAccentPalette } from '@element-editor/ui'

const accent = useAccentPalette(map.getContainer()) // { 50: '#…', …, 950: '#…' }
```

Returns the accent palette (shades 50–950 as hex strings) in effect for `el`, read from the inherited `--elm-accent`. For map layers that need concrete colours (Leaflet SVG paths, MapLibre paint). Re-reads when the `style` or `class` attribute of the nearest `[data-elm-theme]` ancestor or of `<html>` changes, and returns the same object while the colour is unchanged. HTML inside the editor can use `var(--color-primary-N)` instead. Same math as `accentPalette()` in `@element-editor/core`; see [Theming](../guides/theming.md#matching-your-own-layers-and-ui).

### `useAccentStyle()` / `accentStyle(color)`

```tsx
import { useAccentStyle } from '@element-editor/ui'

const accentStyle = useAccentStyle()
createPortal(<div data-elm-portal style={accentStyle}>…</div>, document.body)
```

`useAccentStyle()` returns `{ '--elm-accent': config.accentColor }`, or `undefined` when no accent is configured. It also carries the accent and [design tokens](../guides/theming.md#approach-2--design-tokens) the editor root resolves (`--elm-surface`, `--elm-radius`, …, from your stylesheet or `style`; under adapters, from the `[data-elm-theme]` wrapper of the map), and inside `<ElementEditor>` the CSS variables of its `style` prop, which win as they do on the root. Spread it into the `style` of your own body-level portal roots so they match the editor; the root must also carry `data-elm-theme` (the editor's mode, from `useTheme()`) or `data-elm-portal`. `accentStyle(color)` is the accent alone, without the hook.

### `useApplyAccentToRoot(container)`

Writes `config.accentColor` as `--elm-accent` onto the nearest `[data-elm-theme]` ancestor of `container` (else onto `container`). Both adapters' `ElementEditorControls` already call it with the map container; call it only in a fully custom integration that doesn't use `ElementEditorControls`.

### `useIsManaged()`

```ts
const managed = useIsManaged() // true when onEvent was provided to EventProvider
```

Returns `true` when the host application provided an `onEvent` handler. Use to skip toasts that have no `ElementEditorEvent` equivalent.

### `useKeyboardShortcuts()`

```ts
import { useKeyboardShortcuts } from '@element-editor/ui'

useKeyboardShortcuts(map.getContainer())
```

Registers keyboard listeners for drawing modes, undo/redo, delete, and finish-drawing. Already mounted by both adapters' `ElementEditorControls` (and so by `@element-editor/react`); calling it again makes every shortcut fire twice. Call it only in a fully custom integration that doesn't use `ElementEditorControls`.

Pass the map container. Shortcuts are then scoped to this editor: a key acts only when the event comes from inside the editor's root (the nearest `[data-elm-theme]` ancestor of the container), or when focus is neutral (the page body, or an Element portal) and the last pointer press was inside the root. A single editor on the page also handles body-focused keys before any click. Without a container, the listeners act page-wide.

### `useIsEventForEditor()`

```ts
import { useIsEventForEditor } from '@element-editor/ui'

const isForThisEditor = useIsEventForEditor()
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (!isForThisEditor(e)) return
    // act on this editor
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [isForThisEditor])
```

Returns a function that tells whether a DOM event belongs to this editor, using the same scope as `useKeyboardShortcuts`. Use it to gate your own `window` or `document` keyboard listeners that act on editor state, so a second editor or your host page doesn't trigger them. Must be called inside `GeoStoreProvider`.

### Portals

Any UI you render with `createPortal` outside the editor's `data-elm-theme` element (a menu, picker or modal attached to `body`) should carry a `data-elm-portal` attribute on its root. ElementEditor then applies its base styles inside it, and focus or clicks inside it still count as inside the editor, so shortcuts and Escape keep working there. Spread `useAccentStyle()` into its `style` so it uses the editor's accent colour.

### `useAdapterControls(opts)`

```ts
import { useAdapterControls } from '@element-editor/ui'

const api = useAdapterControls({ initialData, schema, readonly, onChange, /* … */ })
useImperativeHandle(ref, () => api, [api])
```

The shared editor-shell wiring used by `<ElementEditor>` and both adapter `ElementEditorControls`. It owns prop→store sync (readonly / tools / maxFeatures / coordinates / layout; with `engine` set, as the adapters do, the tools `config.network` turns off go to `uiStore.unavailableTools`), the initialData load (on mount, and once more for data that arrives late while the editor is empty and unedited; no undo step, no `onChange`) and schema mount, the data-change subscription (onChange / per-feature callbacks / selection), `onZoomChange` / `onFeatureSelect` / `onToolChange` subscriptions, and returns the `ElementEditorImperativeAPI`. Pass the map type to get a typed `getMap()`: `useAdapterControls<maplibregl.Map>(…)`.

Most consumers do not need this hook directly — use `<ElementEditor>` or the adapter `ElementEditorControls`. Reach for it when building a fully custom layout that wraps neither.

### `useDataChangeSubscription(store, callbacks)`

Granular per-feature subscription primitive used internally by `useAdapterControls`. Exposed for advanced cases that need to react to add / update / delete / selection changes outside the imperative-API surface.

### `useNominatim()`

```ts
const { results, loading, error } = useNominatim(query)
```

Debounced (400 ms) geocoding of `query` (2+ characters) against the editor's `config.network.nominatim` server (default `nominatim.openstreetmap.org/search`; `email` is sent as a query parameter) through `config.network.fetch`. A failure sets `error` and reaches `onError` quietly (`source: 'search'`).

### `useGeoJSONDrop(opts)`

Headless file-drop + file-picker primitive for importing GeoJSON. Returns spread-friendly prop getters and a programmatic `open()` trigger — no opinions about styling. The hook parses + validates the file and hands the resulting `FeatureCollection` back via `onImport`; the caller decides what to do with it.

```tsx
const { getRootProps, getInputProps, isDragActive, open } = useGeoJSONDrop({
  onImport: (fc, file) => {
    ref.current?.importGeoJSON(fc, 'replace')
    toast.success(`Loaded ${file.name}`)
  },
  onError: (err) => toast.error(describe(err)),
})

return (
  <div {...getRootProps()}>
    <input {...getInputProps()} />
    <button onClick={open}>Import…</button>
    {isDragActive && <div className="overlay">Drop to import</div>}
  </div>
)
```

**Options**

| Option | Type | Default | Description |
|---|---|---|---|
| `onImport` | `(fc, file) => void` | — | Called once the file parses to a valid `FeatureCollection`. |
| `onError` | `(err: GeoJSONDropError) => void` | — | Called for wrong-type, too-large, malformed-JSON, or not-a-FeatureCollection inputs. |
| `maxBytes` | `number` | `100 * 1024 * 1024` | Maximum accepted byte length. Matches the default import cap (`DEFAULT_MAX_IMPORT_BYTES`). |
| `accept` | `string[]` | `['.geojson', '.json', 'application/geo+json', 'application/json']` | File extensions and/or MIME types to accept. |
| `disabled` | `boolean` | `false` | When true, drag/drop + file picker become no-ops. |

**Error shape (`GeoJSONDropError`)**

- `{ kind: 'wrong-type', file }`
- `{ kind: 'too-large', bytes, maxBytes }`
- `{ kind: 'invalid-json', cause }`
- `{ kind: 'not-feature-collection', received }`

> **Note:** Spread `getRootProps()` on a container with `pointer-events: auto`. A `pointer-events: none` host silently swallows drag events.

### `useGeoJSONExport(opts)`

Symmetric counterpart to `useGeoJSONDrop` — headless primitive for saving the current ElementEditor state as GeoJSON. Three entry points: trigger a download, fetch the text to POST to a backend, or build a `Blob` to stream elsewhere.

```tsx
const { exportToFile, exportToString, exportToBlob, isExporting } = useGeoJSONExport({
  getFeatureCollection: () => ref.current?.getFeatureCollection(),
  filename: (fc) => `element-editor-${fc.features.length}-features`,
  onExport: (_fc, file) => toast.success(`Exported ${file.name}`),
  onError: (err) => toast.error(describeExportError(err)),
})

return <button onClick={exportToFile} disabled={isExporting}>Export</button>
```

**Options**

| Option | Type | Default | Description |
|---|---|---|---|
| `getFeatureCollection` | `() => FeatureCollection \| null \| undefined` | — | Reads the FC lazily on every call. |
| `filename` | `string \| (fc) => string` | `'features'` | `.geojson` appended automatically if missing. |
| `indent` | `number` | `2` | Pretty-print indent. Pass `0` for compact. |
| `onExport` | `(fc, { name, bytes }) => void` | — | Fires after a successful file download. |
| `onError` | `(err: GeoJSONExportError) => void` | — | Fires on empty FC or serialization error. |
| `disabled` | `boolean` | `false` | Makes every method a no-op. |

**Returned methods**

- `exportToFile(): string \| null` — triggers the browser download. Returns the resolved filename, or `null` when empty.
- `exportToString(): string \| null` — synchronous, returns serialized JSON text.
- `exportToBlob(): Blob \| null` — returns a `Blob` typed `application/geo+json`.

**Error shape (`GeoJSONExportError`)**

- `{ kind: 'empty' }` — FC was null/empty/zero features.
- `{ kind: 'serialization-error', cause }` — `JSON.stringify` threw.

---

## Types

### `ElementEditorConfig` / `ResolvedConfig`

Exported from `@element-editor/ui` (re-exported by adapters and `@element-editor/react`). See the [ElementEditor React reference](./element-editor-react.md#elementeditorconfig) for the full shape. `ResolvedConfig` is what `useElementEditorConfig()` returns — same shape with all defaults applied.

### `DrawTool`

```ts
type DrawTool =
  | 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route'
  | 'picker'  | 'measure'   | 'search'
```

### Layout types and `withLayout`

`LayoutConfig` and its parts (`MapSlot`, `StatusSlot`, `MapEntry`, `StatusEntry`, `LayoutPatch`, …) and `withLayout(patch, base = DEFAULT_LAYOUT)` are documented in the [ElementEditor React reference](./element-editor-react.md#layout-types).

### `ToolbarPosition`

`ResolvedConfig.toolbar.position`, derived from the toolbar's `ui.layout` slot.

```ts
type ToolbarPosition =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'left-center' | 'right-center'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
```

### `UnitsOverride`

```ts
type UnitsOverride = Partial<{
  length: 'metric' | 'imperial' | 'auto'
  area: 'metric' | 'imperial' | 'auto'
  display: 'human' | 'raw'
  precision: number
}>
```

### `MapController`

```ts
interface MapController {
  flyTo: ((latlng: [number, number], zoom: number) => void) | null
  panTo: ((latlng: [number, number]) => void) | null
  fitBounds: ((target: [number, number][] | [number, number, number, number]) => void) | null
  getCenter: (() => [number, number]) | null  // returns [lng, lat]
  setZoom: ((zoom: number) => number) | null
  getZoomBounds: (() => { min: number; max: number }) | null
  getMap?: () => unknown  // the engine's map (maplibregl.Map / L.Map), behind the public ref.getMap()
}
```

### `ElementEditorImperativeAPI` / `ImportResult`

The shape returned by `useAdapterControls()` and the ref type of every `ElementEditorControls`. See the [ElementEditor React reference](./element-editor-react.md#elementeditorref) for the full shape.

### `ElementEditorEvent`

See the [Events reference](./events.md) for the full union type.

### `NominatimResult`

Result object from the Nominatim geocoding API.

### `FeatureContextMenuData`

Data shape passed to `FeatureMapContextMenu`.

---

## Geometry utilities

These are re-exported from `@element-editor/ui` for use in custom integrations.

| Export | Description |
|---|---|
| `runGeometryWorkerOperation` | Run a geometry operation in the background worker: polygon boolean ops (`union`, `intersect`, `subtract`, `exclude`), `cut-hole`, `slice-shape`, `buffer`, `simplify`, `smooth`. Returns a `Promise<Geometry>`. Rejects after 30 s (`{ timeoutMs }` option) or if the worker fails. The payload type is `GeometryWorkerPayload` from `@element-editor/core`. |
| `disposeGeometryWorker` | Terminate the geometry worker instance. Call on unmount if using `runGeometryWorkerOperation` directly. |
| `triggerGeoJSONDownload(text, filename?)` | Trigger a browser download of a GeoJSON string. The download primitive used by `exportAs` and `useGeoJSONExport`. |

This is the only worker ElementEditor uses. It's inlined into the package and loaded on the first call. The editor uses it for polygon boolean operations, cut hole, slice and the buffer, simplify and smooth previews. Import, export and validation run on the main thread.

```ts
import { runGeometryWorkerOperation, disposeGeometryWorker } from '@element-editor/ui'
```

---

## Full export list

```ts
// Store / context
export { GeoStoreProvider, StoreContext, useDataStore, useUIStore, useGeoStore }
export type { DataStore, UIStore }   // re-exported from @element-editor/core
export { MapControllerProvider, useMapController, useSetMapController }
export type { MapController }
export { ThemeContext, useTheme, ThemeReportingProvider, useReportThemeFromRoot }
export type { ResolvedTheme }
export { EventProvider, useEmit, useIsManaged, useToasterId }
export type { EmittedEvent }
export { ShortcutConfigProvider, useShortcutConfig }
export { ElementEditorConfigProvider, useElementEditorConfig, useUnitsOverride, resolveConfig, DEFAULT_LAYOUT, withLayout }
export type { ElementEditorConfig, ResolvedConfig, DrawTool, ToolbarPosition, UnitsOverride, RasterBasemap }
export type { LayoutConfig, LayoutSlot, MapSlot, StatusSlot, LayoutControl, LayoutEntry, MapEntry, StatusEntry, LayoutGroup, MapGroup, StatusGroup, LayoutSlotConfig, MapSlotConfig, StatusSlotConfig, LayoutPatch, SlotFor, ResolvedLayout }

// Events and errors
export type { ElementEditorEvent, ElementEditorErrorHandler, ErrorCode, ErrorSource }
export { ElementEditorError }   // re-exported from @element-editor/core

// Panels & modals (lazy: GeoJSONModal, SchemaModal, FeatureEditModal, DataTablePanel, SettingsModal, ShortcutsModal)
export { LayersPanel, FeatureSidePanel, FeatureEditModal }
export { FeatureList, FeatureRow, featureLabel, GroupRow, PartSubRow }
export { SchemaEditor, SchemaModal, GeoJSONModal, GeoJSONDockPlaceholder }
export { DataTable, DataTablePanel, ShortcutsModal, SettingsModal }
export { preloadEditorPanelsWhenIdle }

// Toolbars (lazy: BooleanOperations)
export { FloatingToolbar, EditingToolbar, UndoRedoToolbar, UndoButton, RedoButton, ControlGroup, ActiveDrawingToolbar }
export { VertexSelectionBar }
export { FitBoundsButton, ZoomIndicator, LocateButton, ReadonlyBanner, BooleanOperations }
export { SimplifyPanel, SmoothPanel, BufferPanel }
export { FeatureMapContextMenu }
export type { FeatureContextMenuData }

// Primitives
export { Button, ContextMenu, isContextMenuOpen, CONTEXT_MENU_MARKER_ATTR, Input, Textarea, SelectInput }
export { Kbd, KbdDark, KbdInvert }
export { SearchDropdown }
export type { SearchDropdownHandle }
export { ToolButton, IconButton, Tooltip, EditToolbarBtn, ToolbarDivider, ElementToaster }
export type { IconButtonSize, TooltipSide }
export { BasemapPicker }
export type { BasemapPickerOption, BasemapPickerProps }

// Hooks
export { useKeyboardShortcuts, useIsEventForEditor, useDataChangeSubscription }
export { useNominatim }
export type { NominatimResult }
export { useGeoJSONDrop }
export type { UseGeoJSONDropOptions, UseGeoJSONDropReturn, GeoJSONDropError }
export { useGeoJSONExport }
export type { UseGeoJSONExportOptions, UseGeoJSONExportReturn, GeoJSONExportError }
export { useAccentPalette, useAccentStyle, useApplyAccentToRoot, accentStyle }
export { useAdapterControls }
export type { UseAdapterControlsOptions, ElementEditorImperativeAPI, MutationOptions, SetFeatureCollectionOptions, ValidationReport, ImportResult }
export { triggerGeoJSONDownload, saveGeoJSONFile }

// Geometry utilities
export { runGeometryWorkerOperation, disposeGeometryWorker }

// Error boundary (mounted by ElementEditorUIProvider)
export { ElementEditorErrorBoundary }

// Full UI context stack for adapter setups (re-exported by both adapters)
export { ElementEditorUIProvider }
export type { ElementEditorUIProviderProps }
```

`@element-editor/ui/primitives` is a second entry point with the base UI components.

`@element-editor/ui/internal` is plumbing shared with the adapters and the `@element-editor/react` drop-in shell. **It is not public API and not covered by semver:** anything in it can change or disappear in any release. Don't import it from your app; for layout, `resolveConfig()`, `DEFAULT_LAYOUT` and `withLayout` are in the main entry.

`DEFAULT_LAYOUT` is deep-frozen, because every editor on the page shares it. Change it with `withLayout` instead of mutating it: `withLayout({ move: { attribution: 'statusRight' } })`.
