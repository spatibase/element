# Migrating to 0.2

*Upgrade an app from Element 0.1 to 0.2.*

> **New to Element?** You don't need this page. 0.2.0 is the first release on npm; this guide is only for apps built against a 0.1 pre-release build (from the repository, before the npm release). Start with the [quick start](../quickstart/react.md).

The biggest change: `@element-editor/react` now renders a **MapLibre GL** map. The Leaflet editor you used in 0.1 is still there, at `@element-editor/react/leaflet`. Decide which engine you want, then work through the sections that apply. The full list of changes is in the [changelog](../../CHANGELOG.md).

Quick checklist:

- [ ] Pick an engine and install its peers ([Install](#1-install))
- [ ] Fix the import and stylesheet paths ([Imports and CSS](#2-imports-and-css))
- [ ] Move engine-specific props to the right entry ([Props per entry](#3-props-that-exist-on-only-one-entry))
- [ ] `bounds` → bbox, `flyTo` → object form ([Coordinates](#4-bounds-and-flyto-use-lng-lat))
- [ ] Tell users about the `T` / `A` shortcut swap ([Shortcuts](#5-keyboard-shortcuts))
- [ ] Several editors on one origin? Add `persistKey` ([persistKey](#6-several-editors-on-one-origin-persistkey))
- [ ] Production traffic? Your own servers and keys in `config.network`; `routingApiKey` → `config.network.routing.apiKey` ([Third-party services](#7-third-party-services-confignetwork))
- [ ] Adapter users: `data-elm-theme` wrapper and the other adapter changes ([Adapters](#8-adapter-users))
- [ ] `config.ui.corners` / `config.toolbar.position` → `config.ui.layout` ([Layout](#9-layout))
- [ ] Next.js App Router ([Next.js](#10-nextjs-app-router))
- [ ] The rest: licence key, CSS tokens, `onEvent` ([Smaller breaking changes](#11-smaller-breaking-changes))

---

## 1. Install

React and React DOM **`^19.2`** are required for both engines (React 18 is no longer supported). Every other peer of `@element-editor/react` is optional, so you install only the ones for the entry you import.

**MapLibre (the default entry):**

```bash
npm install @element-editor/react maplibre-gl
```

`maplibre-gl` must be **`^5.5`** (the built-in Terrain basemap uses 5.5 hillshade options). `@element-editor/core`, `@element-editor/ui` and `@element-editor/adapter-maplibre` come in as regular dependencies.

**Leaflet (`/leaflet`):**

```bash
npm install @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet
```

`leaflet` `^1.9`, `react-leaflet` `^5` (react-leaflet 4 is no longer supported). These peers are optional, so your package manager won't install them for you. You don't need `maplibre-gl`: the Leaflet entry never loads it.

**Adapter packages:** `@element-editor/adapter-maplibre` needs `maplibre-gl` `^5.5` (was `>=4`); `@element-editor/adapter-leaflet` needs `leaflet` `^1.9` and `react-leaflet` `^5`.

## 2. Imports and CSS

**Stay on Leaflet** (smallest upgrade: the component API is the same):

```tsx check=false
// 0.1
import { ElementEditor } from '@element-editor/react'
import '@element-editor/react/style.css'

// 0.2
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css'
```

**Switch to MapLibre:** keep the 0.1 import paths; they now load the MapLibre editor. `@element-editor/react/style.css` bundles `maplibre-gl.css` instead of Leaflet's CSS.

```tsx
import { ElementEditor } from '@element-editor/react'
import '@element-editor/react/style.css'
```

Import the stylesheet that matches the entry. Mixing them (MapLibre component with the Leaflet stylesheet, or the other way round) gives a broken map with no error.

Types and helpers (`ElementEditorRef`, `ElementEditorProps`, `FeatureCollection`, `GeoJSONFeature`, `Schema`, `DEFAULT_LAYOUT`, `IconButton`, `FeatureStyle`, `BBox`, …) are exported from both entries.

## 3. Props that exist on only one entry

Everything else (data, schema, tools, theme, layout, events, ref) is shared.

| Prop | Default entry (MapLibre) | `/leaflet` |
|---|---|---|
| `basemaps` | Picker choices (`BasemapInput[]`, vector or raster); `false` hides the picker | Raster only: `(RasterBasemap \| 'osm')[]`. One entry replaces OpenStreetMap, two or more add a picker |
| `defaultBasemap` / `basemap` / `onBasemapChange` | Starting basemap (`'auto'`, `'streets'`, `'terrain'`, `'light'`, `'dark'`, `'osm'` or a custom style / raster source) / the basemap controlled by your app / pick callback | Same, with raster entries or `'osm'` |
| `tileLayer` | — (ignored, with a dev warning) | Any react-leaflet tile layer; disables the picker |
| `renderer` | — (ignored, with a dev warning) | `'canvas'` (default) or `'svg'` |

If you pass `tileLayer` to the default entry, the browser console says so in development: either switch the import to `/leaflet` or replace the tile layer with a basemap:

```tsx check=false
// 0.1 (Leaflet)
<ElementEditor tileLayer={<TileLayer url="https://tiles.example.com/{z}/{x}/{y}.png" attribution="© Example" />} />

// 0.2, MapLibre: a raster basemap
<ElementEditor defaultBasemap={{ id: 'example', url: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: '© Example' }} />
```

Give every custom basemap an `id`: the picker tells entries apart by it, and only entries with an `id` (plus the built-ins and `'auto'`) are remembered. `defaultBasemap` is a starting value (the user's remembered pick wins on reload); `basemap` is controlled: pair it with `onBasemapChange`, and nothing is remembered. See [Basemaps](./basemaps.md#controlling-the-basemap-from-your-app).

## 4. `bounds` and `flyTo` use `[lng, lat]`

The public API now uses GeoJSON order everywhere. The old forms still work in 0.2 and print a one-time development warning (with the converted value).

**`bounds`** (both drop-ins and `@element-editor/adapter-leaflet`'s `ElementEditorControls`) takes a bbox `[west, south, east, north]`:

```tsx
// 0.1: [[south, west], [north, east]]
<ElementEditor bounds={[[49.9, 14.2], [50.2, 14.7]]} />

// 0.2: [west, south, east, north]
<ElementEditor bounds={[14.2, 49.9, 14.7, 50.2]} />
```

`bounds` restricts panning. Set the start view with the new `initialView` prop; with nothing else to go on (no `initialView`, remembered view or `initialData`) the map now opens fitted to `bounds`. In 0.2 it is applied on mount too, not only when it changes. `@element-editor/adapter-maplibre` keeps its `maxBounds` prop, which now also accepts a bbox. Code that reads `uiStore.bounds` directly now always gets a bbox.

**Start view.** The MapLibre drop-in used to fit the map to `initialData` on every load, over the view the user left it at. It now fits `initialData` only on a first visit (no remembered view); pass `initialView="data"` to keep fitting on every load. `@element-editor/adapter-maplibre`'s `ElementEditorControls` no longer fits the map on mount; call `ref.fitBounds(getFeatureCollectionBBox(fc))` yourself.

**`ref.flyTo`** takes an object:

```tsx
const ref = useRef<ElementEditorRef>(null)

// 0.1
ref.current?.flyTo([48.86, 2.35], 12)          // [lat, lng]

// 0.2
ref.current?.flyTo({ center: [2.35, 48.86], zoom: 12 })   // [lng, lat]; zoom defaults to 15
```

`ref.fitBounds` already took `[lng, lat]` and is unchanged. Types: `BBox`, `BoundsInput`, `FlyToOptions` from either react entry or `@element-editor/core`.

## 5. Keyboard shortcuts

| Action | 0.1 | 0.2 |
|---|---|---|
| Toggle data table | `V` | `T` |
| Toggle transform tool | `T` | `A` |

If your docs, onboarding or support material mention these keys, update them. Bindings a user customised in the shortcuts dialog are kept.

## 6. Several editors on one origin: `persistKey`

Element remembers UI choices in `localStorage` (theme, settings toggles, units, custom shortcuts, window positions and sizes, panel widths, map view, basemap pick, last schema). By default every editor on the origin shares the same `elm_*` keys, so two editors, on one page or on two pages of one app, overwrite each other's choices. Give each its own key:

```tsx
<ElementEditor config={{ persistKey: 'parcels' }} />   // elm_theme → elm_parcels_theme, …
<ElementEditor config={{ persistKey: 'routes' }} />
<ElementEditor config={{ persist: false }} />          // reads and writes nothing
```

Adapter setups pass the same config to the provider: `<ElementEditorUIProvider config={{ persistKey: 'parcels' }}>`. `BasemapControl`'s `storageKey` is namespaced the same way.

Set it once at mount. Adding a `persistKey` to an editor that already has users moves its keys, so returning visitors start from your defaults once (their old `elm_*` values aren't migrated). Details: [Persisting data](./persisting-data.md#elements-own-saved-state-persistkey--persist).

## 7. Third-party services: `config.network`

Element calls public services by default: basemap tiles and fonts (OpenFreeMap, Mapterhorn, OpenStreetMap), the Picker's Overpass lookups, the Route tool's router (the **OSRM demo server: car-only, not for production**) and the search box's geocoder (Nominatim). For production, point them at your own servers or paid plans in one place, per editor:

```tsx
<ElementEditor
  config={{
    network: {
      routing: { apiKey: ORS_KEY },                                         // was routingApiKey
      overpass: { endpoint: 'https://overpass.example.com/api/interpreter' },
      nominatim: { url: 'https://geocode.example.com/search', email: 'maps@example.com' },
      fetch: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, Authorization: 'Bearer …' } }),
    },
  }}
/>
```

- **`routingApiKey`** still works (deprecated, dev warning); `config.network.routing.apiKey` wins when both are set.
- `false` turns a service off and hides what needs it: `routing: false` (Route tool), `nominatim: false` (search box), `overpass: false` (the Picker reads only the vector tiles; hidden on Leaflet).
- Swapped servers need their own credits: give `attribution`. The Nominatim credit now shows only while the search box is offered; ORS gets its credit.
- If you built against a 0.2 pre-release: `configureOverpass()` (page-wide) is gone, use `config.network.overpass` + `fetch`; the `spriteUrl` prop and the `spriteUrl` option of `BasemapControl` / `useBasemap` / `loadBasemapStyle` / `setBasemap` are gone, use `config.network.sprite` (`{ network }` option).

Every service, its licence and how to self-host it: [Third-party services and self-hosting](./third-party-services.md). A failed Picker lookup still rejects with an `OverpassError` whose `code` is `'rate-limited' | 'busy' | 'timeout' | 'network'`.

## 8. Adapter users

These apply if you use `@element-editor/adapter-leaflet` or `@element-editor/adapter-maplibre` with your own map.

**Wrap the editor in `data-elm-theme`.** The stylesheets no longer apply Tailwind's preflight to your whole page; base styles apply only inside `[data-elm-theme]`. Render the map and all editor UI inside such an element, or the UI renders unstyled:

```tsx
<ElementEditorUIProvider>
  <GeoStoreProvider>
    <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: '600px' }}>
      {/* your map + <ElementEditorControls /> + any @element-editor/ui panels */}
    </div>
  </GeoStoreProvider>
</ElementEditorUIProvider>
```

Use `"light"` or `"dark"`. The same element scopes keyboard shortcuts: a key acts on this editor only when focus or the last click is inside it. Portaled UI of your own should carry a `data-elm-portal` attribute. The drop-ins do all of this for you.

**Toasts.** `ElementEditorUIProvider` renders its own `<Toaster>` now; remove the one you added for Element (or pass `toaster={false}` to keep yours). With `onEvent` set, the editor shows no toasts at all; every message goes to your handler.

**Errors (`onError`).** `ElementEditorUIProvider`'s `onError` used to fire only for render crashes; it now fires for every runtime failure (rate limits, a failed basemap, an invalid import, `maxFeatures`, …) with an `ElementEditorError`. It is still an `Error`, so `(error: Error) => void` handlers keep compiling; if yours means "the editor crashed", check `error.code === 'crash'`. The `onEvent` `error` event now carries `code` and `source`. Hint-like messages (a vertex that can't be deleted, an invalid zoom value, nothing to export) are `warning` events now, not `error`. See [Events → onError](../reference/events.md#onerror).

If you build on `@element-editor/core` directly:

```ts
// 0.1: a string
createDataStore({ onError: (message) => toast(message) })
uiStore.getState().reportError('Something failed')
// 0.2: an ElementEditorError, plus { quiet } for failures that should not be toasted
createDataStore({ onError: (error, opts) => { if (!opts?.quiet) toast(error.message) } })
uiStore.getState().reportError(new ElementEditorError('network', 'basemap', 'Something failed'))
```

`dataStore.copySelection()` now returns a `Promise<boolean>` (true when the system clipboard was written too).

**`maxFeatures` in the store.** `maxFeatures` / `setMaxFeatures` moved from the UI store to the data store:

```ts check=false
// 0.1
const max = useUIStore((s) => s.maxFeatures)
// 0.2
const max = useDataStore((s) => s.maxFeatures)
```

Adding actions (`duplicateFeature`, paste, …) return `false` when the limit refuses them, `addFeature` returns `null` (otherwise the stored feature); `canAddFeatures(n)` checks ahead.

If you built against a 0.2 pre-release: **`BasemapControl`** (MapLibre adapter) no longer restyles your map on mount unless you pass `value` or `defaultValue`, or a pick was remembered under `storageKey`. Pass `defaultValue="auto"` to keep the old behaviour.

## 9. Layout

**`config.ui.corners` and `config.toolbar.position` are removed.** Place every control with `config.ui.layout` ([Configuring layout](./configuring-layout.md)). `toolbar.direction` stays.

| 0.1 | 0.2 |
|---|---|
| `toolbar: { position: 'top-left' }` (… `'bottom-right'`, `'left-center'`, …) | `ui: { layout: withLayout({ move: { toolbar: 'topLeft' } }) }` |
| `ui.corners.<corner>: { items, direction }` | `ui.layout.<corner>: { items, direction }` (list `toolbar` and `leftCenter: [{ group: ['undo', 'redo'] }]` too: unlisted controls are hidden) |
| `'toolbar'` in a corner's `items` | the same, `'toolbar'` in that slot |

```ts check=false
import { withLayout } from '@element-editor/react'

// 0.1
config={{ toolbar: { position: 'bottom-right' } }}
// 0.2
config={{ ui: { layout: withLayout({ move: { toolbar: 'bottomRight' } }) } }}

// 0.1 (once any corner was given, the other corners were empty)
config={{ ui: { corners: { topRight: { items: ['table', 'settings'] } } } }}
// 0.2
config={{ ui: { layout: { topCenter: ['toolbar'], leftCenter: [{ group: ['undo', 'redo'] }], topRight: ['table', 'settings'] } } }}
```

The rest of this section only matters if you built against a 0.2 pre-release (`DEFAULT_LAYOUT` and the layout types are new in 0.2).

**`DEFAULT_LAYOUT` is frozen** (every editor on the page shares it). Don't mutate or re-list it; change it with `withLayout`:

```ts check=false
// before
const layout = { ...DEFAULT_LAYOUT, statusRight: ['attribution'] }
// 0.2 (the spread still works when the slots you add don't repeat a default control)
const layout = withLayout({ move: { attribution: 'statusRight' } })
```

**Layout types are slot-specific.** A control in a slot it can't go to (`'attribution'` or a bare `'separator'` on the map, `'toolbar'` / `'applyChanges'` in the status bar, `{ items, direction }` on a status slot) is now a compile error instead of a runtime warning. Build a layout in a variable with `satisfies LayoutConfig` (or a `LayoutConfig` annotation) so the strings stay literal.

**Layout helpers.** `resolveLayout`, `LAYOUT_SLOTS`, `isControlVisible` and `visibleLayoutEntries` are no longer public. Use `resolveConfig(config).ui.layout` for the resolved layout, and `DEFAULT_LAYOUT` / `withLayout` to build one.

## 10. Next.js App Router

Both `@element-editor/react` entries, `@element-editor/ui` and both adapters now start with `'use client'`, so importing them from a Server Component no longer throws. That only marks the client boundary: Next.js still server-renders client components, and Leaflet touches `window` as soon as it is imported. Keep loading the editor with `dynamic(..., { ssr: false })` from a client wrapper, for either entry:

```tsx
// app/components/MapEditor.tsx
'use client'

import dynamic from 'next/dynamic'

const ElementEditor = dynamic(
  () => import('@element-editor/react/leaflet').then((m) => m.ElementEditor), // or '@element-editor/react'
  { ssr: false },
)

export default function MapEditor() {
  return (
    <div style={{ width: '100%', height: 600 }}>
      <ElementEditor onChange={console.log} />
    </div>
  )
}
```

Import the matching stylesheet in your root layout. No `transpilePackages` or worker configuration is needed. More in [Using Element with Next.js](./nextjs.md).

## 11. Smaller breaking changes

- The `licenseKey` prop is gone: the community edition is MIT.
- `theme` sets only the mode: `'light' | 'dark' | 'auto'`. Its object form (CSS variables for the root) is gone; pass them through `style` instead, `theme={{ '--elm-accent': '#7c3aed' }}` → `style={{ '--elm-accent': '#7c3aed' }}` (or `accentColor="#7c3aed"`). An object passed to `theme` is ignored with a development warning.
- The unused 0.1 CSS tokens (surface/border/text/shadow) were removed. 0.2 has working design tokens instead (`--elm-surface`, `--elm-text`, `--elm-border`, `--elm-radius`, `--elm-font`, `--elm-shadow`, …): see [Theming](./theming.md#approach-2--design-tokens).
- Polygons with self-intersecting edges are no longer flagged.
- `@element-editor/core` no longer exports the unused import/export/validation workers; `@element-editor/adapter-maplibre` no longer exports `DrawingCursorHint`.
- The packages export a smaller, documented API. Helpers the packages share among themselves (Mercator and topology math, click guards, the shortcut-binding cache, picker tile helpers, schema defaults, …) left the `@element-editor/core` root; the adapters dropped duplicate and plumbing exports (`FitBoundsInteraction`, the Leaflet `FeatureLayer`, the MapLibre `init*Layers` / `cleanup*Layers` functions, …). The full list is in the [changelog](../../CHANGELOG.md) under 0.2.0, "Removed from the public API".
- `onEvent` now receives every user-facing message, and with it set the editor shows no toasts at all.
- If you built against a 0.2 pre-release: `@element-editor/ui` dropped `danger` from `ContextMenu` items, `EditToolbarBtn` and `Button` (delete actions are no longer red), and the `ToolBar` export and `@element-editor/ui/style.css` (import the stylesheet of the entry or adapter you use).
- `setRoutingApiKey()` and the `routingApiKey` prop are deprecated; use `config.network.routing.apiKey`.
