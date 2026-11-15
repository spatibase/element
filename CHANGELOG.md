# Changelog

What changed in Element, release by release, and what it means for you and the people who draw on your maps. Each version starts with a short summary; the lists below it give the details you need when you upgrade.

---

## [Unreleased]

### Fixed

- **On narrow screens the toolbars wrap cleanly.** When the main toolbar or the toolbar for a selected shape wraps onto two rows, as it does on a phone, no row starts or ends with a stray divider.
- **Focus rings look the same everywhere: a quiet grey outline when you use the keyboard.** The basemap cards, the buttons in search results, the buffer and schema name fields, the point coordinate fields and the table's rename field used the accent colour (or green) for focus. The search box and the text label editor now show a subtle grey outline while you type in them, not just the cursor. Selected items and active tools keep the accent colour.
- In dark mode the selected basemap card now has a dark background, so its name is easy to read.
- **On MapLibre maps, hover stays with your cursor after you add a shape.** If you moved the mouse while the map was still loading, the editor could briefly show a name tooltip or a point handle where the cursor used to be, until you moved again.

---

## [0.2.2] — 2026-11-15

Drawing hints are easier to read at a glance, and AI coding agents that set Element up for you now write MapLibre code that works on MapLibre GL JS 6. Nothing to change on your side.

### Changed

- **Drawing hints are easier to scan.** While someone draws, each instruction ("Click to add points", "Double-click to finish", "Undo last ⌫") is its own item instead of one long sentence. On a narrow map whole items wrap to the next line, no row of the drawing toolbar starts or ends with a divider, and screen readers say "Backspace" for the ⌫ key.
- The data table's size column ("2 parts, 9 points") and the message after an export ("3 features, 1.2 KB") use commas instead of middle dots.

### Fixed

- **AI coding agents get working MapLibre 6 code.** If you ask an agent to add Element to your own MapLibre map, the `AGENTS.md` guides in `@element-editor/adapter-maplibre`, `@element-editor/react` and `@element-editor/ui` now include the `setWorkerUrl` call. Without it the map stays blank on MapLibre GL JS 6, which is what a plain `npm i maplibre-gl` installs. The guides also explain the drop-in's `config.network.maplibreWorker` setting and what it needs from your Content Security Policy.

---

## [0.2.1] — 2026-11-15

Element now works with MapLibre GL JS 6 as well as 5.5 and later. If `npm i maplibre-gl` gave you version 6 and your build failed, update to 0.2.1: the MapLibre drop-in renders with no extra setup. Keyboard users also get clearer focus rings.

### Added

- **You choose where MapLibre 6 loads its worker from.** MapLibre GL JS 6 needs a separate worker file. The MapLibre drop-in loads it from jsDelivr by default, pinned to the `maplibre-gl` version you installed. To serve it yourself (offline, intranet, strict CSP), point `config.network.maplibreWorker` at your copy; set it to `false` if your app calls `setWorkerUrl` itself. It has no effect on MapLibre 5, or when your app has already called `setWorkerUrl`. See [MapLibre GL JS 6 worker](./docs/guides/third-party-services.md#maplibre-gl-js-6-worker-maplibreworker).

### Changed

- **Install without pinning MapLibre again:** `npm i @element-editor/react maplibre-gl`. The `maplibre-gl` peer range of `@element-editor/react` and `@element-editor/adapter-maplibre` is now `^5.5.0 || ^6.0.0`.
- **On MapLibre 6 the MapLibre drop-in sets up the worker for you**, so the map renders behind Vite, webpack or Turbopack without app setup. If you use `@element-editor/adapter-maplibre` on your own map, call MapLibre's `setWorkerUrl` in your map setup, as shown in the [MapLibre adapter quick start](./docs/quickstart/adapter-maplibre.md).

### Fixed

- **Builds work on MapLibre GL JS 6.** They failed with `"default" is not exported by maplibre-gl/dist/maplibre-gl.mjs`. Element now loads MapLibre in a way that works on both 5.x and 6.x.
- **Next.js with webpack works on MapLibre GL JS 6.** webpack picked Element's CommonJS build, which can't load MapLibre 6. Bundlers now get the ES build. One limit remains: if you load Element with plain Node `require()`, you need `maplibre-gl` 5, because MapLibre 6 can't be loaded with `require()`.
- **Clicks that slip a few pixels still place a point on MapLibre 6**, instead of nudging the map. The click tools had lost their 8 px tolerance there.
- Floating windows no longer get an outline around them when opened with the mouse or a keyboard shortcut, even if your page styles `:focus-visible`.
- **Keyboard users can see where focus is on the toolbars.** The toolbar buttons show a focus ring, and form inputs use the same neutral ring instead of blue.

---

## [0.2.0] — 2026-11-15

**Element is on npm.** This is the first public release: a map editor you can drop into a React app in a few lines, or add to a MapLibre or Leaflet map you already have. It's MIT-licensed and free for any use, including commercial.

Compared with the 0.1 builds, Element handles large datasets without freezing the page, takes your brand colour and fonts, and gives your code far more control over the map, the data and the error messages your users see.

Five packages, all at 0.2.0:

- `@element-editor/react`: the drop-in `<ElementEditor />` on MapLibre GL, and on Leaflet at `@element-editor/react/leaflet`.
- `@element-editor/adapter-maplibre` and `@element-editor/adapter-leaflet`: editing for a map you already have.
- `@element-editor/ui`: the toolbars, panels, data table and GeoJSON inspector, for your own layout.
- `@element-editor/core`: stores, types and helpers shared by all of them.

New to Element? Start with the [quick start](./docs/quickstart/react.md). 0.1.0 was never published to npm, so **Breaking** and **Deprecated** below only matter if you built against one of those pre-release builds. If you did, follow [Migrating to 0.2](./docs/guides/migrating-to-0.2.md).

### Highlights

- **A map out of the box.** The drop-in now runs on MapLibre GL with five built-in basemaps (Streets, Terrain, Light, Dark, OpenStreetMap) and a picker. No API key needed.
- **Large datasets stay responsive.** With 5,000 features, Leaflet pans smoothly where it used to block for seconds, and entering point editing on a 50,000-point polygon takes a fraction of a second instead of freezing the page.
- **Your code is in charge.** A typed ref API to read and change data, selection, tools and the map; `initialView`, `mapOptions` and `onMapReady` to set the map up; `onError` to handle or translate every failure.
- **It looks like your app.** One accent colour recolours the whole editor; 23 design tokens restyle the rest.
- **Your servers, your call.** Every third-party service Element talks to is set in one place, `config.network`, where you can self-host it or turn it off.
- **Put controls where you want them** with `config.ui.layout` and `withLayout`.
- **Safer edits.** An import or a union is one undo step, `readonly` really is read-only, and `submit()` checks every feature.
- **Smaller downloads.** The JavaScript a fresh app loads up front is 26% smaller for the MapLibre drop-in and 35% smaller for Leaflet.

### Breaking

All of these come with step-by-step instructions in [Migrating to 0.2](./docs/guides/migrating-to-0.2.md).

- **The default drop-in runs on MapLibre GL.** `<ElementEditor />` from `@element-editor/react` now owns a MapLibre map instead of a Leaflet one, which is what gives you the built-in vector basemaps. Install `maplibre-gl` next to it (`npm i @element-editor/react maplibre-gl`; at 0.2.0 that is 5.5 or a later 5.x, and 0.2.1 adds 6). `@element-editor/react/style.css` now includes `maplibre-gl.css` instead of Leaflet's CSS. The package depends on `@element-editor/core`, `@element-editor/ui` and `@element-editor/adapter-maplibre` instead of bundling them.
- **Prefer Leaflet? It moved to `@element-editor/react/leaflet`**, with the same component, props and ref. Import `@element-editor/react/leaflet/style.css` and install its peers yourself, since they're no longer installed for you: `npm i @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet` (no `maplibre-gl` needed).
- **Each entry takes the props that fit its map.** `tileLayer`, `renderer` and raster-only `basemaps` are on `/leaflet`; the default entry takes vector or raster `basemaps`. `basemap`, `defaultBasemap` and `onBasemapChange` are on both, each with its own basemap type. Pass `tileLayer` or `renderer` to the default entry and it ignores them, with a development warning.
- **React 19.2 or later is required**; React 18 is no longer supported. Other peers: `react-leaflet` 5, `leaflet` 1.9, `maplibre-gl` 5.5 (was 4 or later; the Terrain basemap needs 5.5). Every peer of `@element-editor/react` except React is optional, so you install only what your entry uses. `maplibre-gl` is also an optional peer of `@element-editor/adapter-maplibre`.
- **Element's CSS no longer resets your page.** Tailwind's global preflight used to apply to the whole host page; base styles now apply only inside `[data-elm-theme]` elements and the editor's portals. If you use an adapter, render the map and all editor UI inside an element with `data-elm-theme="light"` or `"dark"`, and add `data-elm-portal` to any of your own UI that you portal out of it.
- **With `onEvent` set, you own every message.** All user-facing messages go through `onEvent`, and in that mode the editor shows no toasts of its own.
- **Drawing tools stay on after each shape,** so people can draw several in a row. "Return to select after each shape" (Settings, `Cmd+J`) is now off by default. Anyone who already chose a setting keeps it (`elm_autoExitAfterDraw`).
- **The GeoJSON inspector opens docked** beside the map instead of floating over it. A user's saved Dock / Undock choice still wins, and `config.ui.geojsonEditorOpen: 'docked'` now means the same as `true`.
- **Keyboard shortcuts:** `T` toggles the data table (was `V`) and `A` toggles the transform tool (was `T`). Bindings a user customised are kept.
- **If your code reads the stores:** `maxFeatures` and `setMaxFeatures` moved from `uiStore` to `dataStore` (`@element-editor/core`); the `maxFeatures` prop is unchanged. Actions that add features (`duplicateFeature`, paste, break apart, …) return `boolean`, so you can tell when the limit stopped them, and `dataStore.addFeature` returns the stored feature or `null`.
- **`onError` hears about every failure, not only crashes.** `ElementEditorUIProvider`'s `onError` now fires for every runtime failure with an `ElementEditorError` (still an `Error`); check `error.code === 'crash'` for render crashes. In `@element-editor/core`, `DataStoreOptions.onError`, `UIStoreOptions.onError` and `uiStore.reportError` take an `ElementEditorError` (plus `{ quiet }`) instead of a string, and `dataStore.copySelection()` returns `Promise<boolean>`. Messages that are really hints (a point that can't be deleted, an invalid zoom or coordinate, boolean operations on anything but polygons, nothing to export or fit) are now `warning` events instead of `error`.
- **`uiStore.bounds` is a GeoJSON bbox** `[west, south, east, north]` (was `[[south, west], [north, east]]`), whatever form you passed `bounds` in. This only affects code that reads the store.
- **No licence key.** The `licenseKey` prop and the evaluation-mode warning are gone: the community edition is MIT.
- **`theme` sets the mode only:** `'light' | 'dark' | 'auto'`. The object form (CSS variables for the editor root) is removed. Pass variables through `style` (`style={{ '--elm-accent': '#7c3aed' }}`) or use `accentColor`. An object passed to `theme` is ignored with a development warning.
- **Removed:**
  - The 0.1 `--elm-*` surface, border, text and shadow tokens, which no component read. Working design tokens replace them (see Added); `--elm-radius` and `--elm-font` keep their names and now take effect.
  - Self-intersection (`kinks`) checking: polygons with crossing edges are not flagged.
  - `@element-editor/core`: the unused `importWorker`, `exportWorker`, `validationWorker` and a duplicate `geometryWorker`. Import, export and validation run on the main thread. The `GeometryWorkerPayload` type (what `runGeometryWorkerOperation` takes) stays.
  - `@element-editor/adapter-maplibre`: `DrawingCursorHint`, which never rendered.
  - `config.ui.corners` and `config.toolbar.position` (and the `Corner` and `CornerItem` types). Place controls with `config.ui.layout` instead: `toolbar.position: 'top-left'` becomes `'toolbar'` in `topLeft`, and `ui.corners.<corner>: { items, direction }` becomes `<corner>: { items, direction }`. To keep the default and move a few controls, use `withLayout({ move: { … } })`. `toolbar.direction` stays. See [Migrating to 0.2](./docs/guides/migrating-to-0.2.md), section 9.

### Added

#### Maps and basemaps

- **Built-in basemaps on the MapLibre drop-in:** Streets, Terrain, Light and Dark (OpenFreeMap vector tiles; Streets and Terrain with Mapterhorn hillshade) and OpenStreetMap (raster), plus `'auto'`, which follows the editor theme (Streets in light mode, Dark in dark mode). See [Basemaps](./docs/guides/basemaps.md).
- **A basemap picker with thumbnails**, as the `'basemap'` layout control (first in `bottomLeft` by default, hidden when there's nothing to pick, can't go in a group). The thumbnails are inlined, so the picker makes no requests of its own.
- **Basemap props on the MapLibre drop-in.** `defaultBasemap` sets the starting basemap (default `'auto'`); the user's pick is remembered in `localStorage` (`elm_basemap`) and wins on reload. `basemap` lets your app control it: changing it switches the basemap, nothing is read from or written to `localStorage`, and it may be off the picker's list. `onBasemapChange` reports the user's pick or `ref.setBasemap()`, as the `basemaps` entry (`'auto'` stays `'auto'`); it isn't called for theme flips or prop changes. `basemaps` sets the picker's choices, `false` hides it. Development warnings flag a controlled `basemap` with a visible picker but no `onBasemapChange`, and a style object without an id passed anew on every render.
- **Your own basemaps:** a vector style URL or `StyleSpecification`, or raster `{ url, attribution }`. Give each an `id` so the picker can tell them apart and remember the pick. The sprite comes from jsDelivr at the package version; self-host it with `config.network.sprite`.
- `ref.getBasemap()` returns the current choice, and `ref.setBasemap(b)` switches like a user pick (fires `onBasemapChange`, isn't remembered; with a controlled `basemap` it only fires `onBasemapChange`). On both drop-ins.
- **Basemaps on the Leaflet drop-in:** `basemaps?: (RasterBasemap | 'osm')[]`. One entry replaces OpenStreetMap; two or more add a picker, with the choice remembered in `elm_basemap_leaflet` (entries told apart by `id`, else `url`). `basemap`, `defaultBasemap` and `onBasemapChange` work as on the MapLibre drop-in. `tileLayer` overrides them all, with a development warning. New `RasterBasemap` type (from `@element-editor/ui` and both react entries) and `LeafletBasemap` (`RasterBasemap | 'osm'`, from `/leaflet`).
- **Basemaps for your own MapLibre map:** the `@element-editor/adapter-maplibre/basemaps` entry (`BASEMAPS`, `BasemapInput`, `BuiltinBasemapId`, `resolveBasemap`, `loadBasemapStyle`, `setBasemap`, `DEFAULT_SPRITE_URL`, `DEFAULT_GLYPHS_URL`, `BasemapNetwork`), plus `BasemapControl` and `useBasemap` in the main entry. `setBasemap` switches the style and keeps Element's layers and images; the latest call wins.
- **Switching basemaps keeps your own layers.** `setBasemap` and `BasemapControl` (and so the drop-in's picker and `'auto'` following the theme) carry over Element's layers and every source and layer you added, in the same order and above the new basemap. A layer or source whose id the new basemap also uses gives way to the basemap's. Images you added with `map.addImage` are still dropped by the style switch.
- **Element survives `map.setStyle` on MapLibre.** After any style replacement (your own basemap switcher, MapTiler SDK style switching, `setStyle` with or without `diff`, a URL or an object), Element puts its sources, layers, images and the selection highlight back on top and refills them. Your own layers are yours to restore: re-add them from a `style.load` listener added in `onMapReady` / `onReady` (it runs after Element's repair, so an `elm-*` `beforeId` works), and your images from a `styleimagemissing` listener. A style without `glyphs` gets every Element layer except the text one, with a development warning.
- **Set the map up from props:** `initialView` (`{ center: [lng, lat], zoom }`, `{ bounds }` or `'data'`; wins over the remembered view), `mapOptions` (extra `maplibregl.Map` / `L.Map` options, typed per entry; options Element sets itself are dropped with a development warning) and `onMapReady(map)` (once per map, after Element's layers are on it, so add your own layers there). Without `initialView` the map starts at the remembered view, else fitted to `initialData` (first visit), else fitted to `bounds`, else over Europe. Adapters get `onReady(map)` on both `ElementEditorControls`.
- **Lines stay readable over busy maps** with a thin light or dark casing under the stroke, chosen by basemap (MapLibre layer `elm-features-line-casing`).
- **The Picker on MapLibre keeps working when the public Overpass server is busy:** it reads shapes from the basemap's vector tiles first, joining pieces split across tiles, and falls back to Overpass.

#### Your data

- **Data that arrives after mount just works.** The usual fetch-then-render (`initialData` going from `null`, `undefined` or an empty collection to data) is applied once while the editor is still empty and unedited, and the drop-ins fit the map to it as on mount. Later changes are ignored with a development warning: replace data with `ref.setFeatureCollection()` or remount with a new `key`.
- **`ref.setFeatureCollection(data, { silent, undoable })`.** `silent: true` loads without firing `onChange` / `onFeature*`, so data you just fetched isn't saved straight back. `undoable: false` loads without an undo step and clears the history, like `initialData`.
- **Drop a file to import it.** Dropping a `.geojson` or `.json` file anywhere on either drop-in imports it like `Cmd/Ctrl+O`: it replaces the data in one undo step, fits the map and reports skipped features. Turn it off with `fileDrop={false}`; it's off in `readonly`.
- **Data table:** a **Type** column shows each shape's icon, kind (Point, Line, Area) and size; Lat / Lng columns appear only while the table lists a point. You can paste text from the clipboard into a selected editable cell, and headers have sort arrows and truncate cleanly.
- **Layers panel:** right-click a feature row and choose **Zoom to feature**.

#### Control from your code

- **More of the editor is reachable from the ref:** `getMap()` (a typed `maplibregl.Map` on the default entry and adapter-maplibre, `L.Map` on `/leaflet` and adapter-leaflet; `null` until mounted), `getSelection()`, `select(ids, { fit })`, `setTool(tool | null)`, `addFeature(f)` (returns the stored feature or `null`), `updateFeature(id, patch)` and `removeFeatures(ids)` (returns the count). Changes behave like user edits: validation, `maxFeatures`, undo and `onChange` / `onFeature*` all apply. `{ undoable: false }` (also on `updateFeatures`) applies a change without an undo step and keeps it when the user undoes earlier edits. Bad input returns `null`, `false` or `0` with a development warning.
- `getFeature(id)`, `getTool()`, `canUndo()`, `canRedo()` and `validate()` (`{ valid, errors }` for every feature, changes nothing) on the ref, and an `onToolChange(tool | null)` prop on both drop-ins and both adapters' `ElementEditorControls`.
- `ref.flyTo({ center: [lng, lat], zoom? })`, and `bounds` (both drop-ins, adapter-leaflet's `ElementEditorControls`) and adapter-maplibre's `maxBounds` take a GeoJSON bbox `[west, south, east, north]`. New types `BBox`, `BoundsInput`, `FlyToOptions` (core and both react entries), `ElementEditorBaseProps` (both react entries), and `BasemapInput` / `BuiltinBasemapId` from `@element-editor/react`.
- **Handle, silence or translate any error with `onError`**, on `<ElementEditor>` (both entries), `ElementEditorControls` (both adapters), `ElementEditorUIProvider` and `EventProvider`. It's called first for every runtime failure, including quiet ones that show no toast and with `onEvent` set, and receives an `ElementEditorError`: a `code` (such as `'rate-limited'`, `'timeout'`, `'invalid-data'`, `'limit-reached'`, `'crash'`), a `source` (such as `'basemap'`, `'picker'`, `'routing'`, `'search'`, `'import'`), an honest English `message`, `cause` and `featureId`. Return `false` to stop the built-in toast and the `onEvent` error event, or a string to show that text instead. The `onEvent` `error` event carries `code` and `source`. `OverpassError` is an `ElementEditorError`, with the new code `'invalid-data'`. See [Events](./docs/reference/events.md#onerror).

#### Look and layout

- **One colour brands the whole editor.** Set `<ElementEditor accentColor>`, `config.accentColor`, `<ElementEditorUIProvider accentColor>` or the CSS variable `--elm-accent`, and the whole primary scale (buttons, selection, map highlights, handles, previews) follows, live. Helpers: `accentPalette`, `readAccentPalette`, `resolveColor`, `parseColor`, `mixOklab`, `DEFAULT_ACCENT`, `DEFAULT_FEATURE_COLOR`, `ACCENT_STEPS`, `AccentPalette`, `AccentShade` (`@element-editor/core`), and `useAccentPalette`, `useAccentStyle` / `accentStyle`, `useApplyAccentToRoot` (`@element-editor/ui`).
- **Design tokens for a full custom theme.** 23 CSS variables restyle the editor's fonts, corners, shadows, surfaces, text, borders, focus ring and tooltips, per mode and per editor: `--elm-font`, `--elm-font-mono`, `--elm-radius`, `--elm-radius-control`, `--elm-shadow`, `--elm-shadow-raised`, `--elm-shadow-control`, `--elm-surface`, `--elm-surface-raised`, `--elm-surface-sunken`, `--elm-surface-hover`, `--elm-control-hover`, `--elm-text`, `--elm-text-secondary`, `--elm-text-muted`, `--elm-text-subtle`, `--elm-text-disabled`, `--elm-border`, `--elm-border-subtle`, `--elm-border-strong`, `--elm-focus-ring`, `--elm-tooltip`, `--elm-tooltip-text`. Set them in a stylesheet (on `[data-elm-theme="light"]` / `"dark"`, a class on the editor root, or `:root`) or through `style`. The defaults keep the previous look. Modals, menus and tooltips rendered outside the editor follow them too, as do `--elm-accent` and `--elm-primary-N` set in a stylesheet. See [Theming](./docs/guides/theming.md#approach-2--design-tokens).
- **Colour features your way on every entry point.** `featureColor` (a prop on both drop-ins and both adapters' `<ElementEditorUIProvider>`, or `config.featureColor`; the prop wins) sets the default outline, fill and point colour. `getFeatureStyle` is now a prop of both drop-ins too, and `FeatureStyle` is exported from `@element-editor/react` and `/leaflet`. Order: selected, then `getFeatureStyle` per key, then `featureColor`, then the default slate; a hovered feature keeps its colour. On Leaflet, `getFeatureStyle` also colours point pins, `fillColor` falls back to `color` as on MapLibre, and it may return `undefined` or `null`. adapter-leaflet gains `FeatureStyleProvider`, `useFeatureStyle` and `FeatureStyle`, like adapter-maplibre.
- **Put every control where you want it** with `config.ui.layout`. Ten slots around the map and in an optional status bar below it (`topLeft`, `topCenter`, `topRight`, `leftCenter`, `rightCenter`, `bottomLeft`, `bottomCenter`, `bottomRight`, `statusLeft`, `statusRight`) take ordered control ids (`'toolbar'`, `'undo'`, `'redo'`, `'fitBounds'`, `'locate'`, `'zoomIndicator'`, `'table'`, `'schema'`, `'geojson'`, `'settings'`, `'keyboard'`, `'applyChanges'`, `'attribution'`, `'basemap'`), `'separator'` or `{ group: [...] }`. Controls you don't list are hidden, except the map attribution. Slots on the same edge never overlap, and putting a control in a slot where it can't go is a compile error. To move or hide a few controls and keep the rest: `layout: withLayout({ move: { table: 'topRight' }, hide: ['keyboard'] })`. Development warnings catch a control listed twice, and a layout that leaves out the toolbar while drawing is possible, `'applyChanges'` while you use `onSubmit`, or undo / redo while keyboard shortcuts are off. The new types and components (`withLayout`, `DEFAULT_LAYOUT`, `LayoutConfig`, `LayoutPatch`, `UndoButton`, `RedoButton`, `ControlGroup`, …) are listed in the [`@element-editor/react` reference](./docs/reference/element-editor-react.md#layout-types); `IconButton`, `FitBoundsButton`, `LocateButton` and `ZoomIndicator` take `size?: 'md' | 'sm' | 'group'` and `tooltipSide`. Style hooks: `data-elm-slot`, `data-elm-group`, `data-elm-separator`. See [Configuring the layout](./docs/guides/configuring-layout.md).
- `slots` covers all eight map slots (adds `topCenter`, `leftCenter`, `rightCenter`, `bottomCenter`), and the `tools` prop takes any `DrawTool`, including `'picker'`, `'measure'` and `'search'`.
- **The editor works in small spaces.** Below 640 px (the editor's own width, not the viewport) the layers panel and docked inspector overlay the map and start collapsed, rows wrap their buttons, the search box collapses to an icon and the editing toolbars stay inside the map.
- **The GeoJSON inspector can sit docked beside the map** (dock toggle in its title bar; remembered in `elm_code_docked`), and `config.ui.geojsonEditorOpen?: boolean | 'docked'` opens it on mount (a user's saved Dock / Undock choice wins). New `@element-editor/ui` export `GeoJSONDockPlaceholder` (a Suspense fallback).
- `--elm-bottom-stack-offset` on the `<ElementEditor>` root tells you where the bottom-centre editing toolbars end, so you can place your own UI above them.
- adapter-leaflet and the Leaflet drop-in: `renderer?: 'canvas' | 'svg'`. The default `'canvas'` draws unselected polygons and lines on one shared canvas, which is much faster with many features; `'svg'` keeps one `<path>` per feature.

#### Third-party services

- **Every third-party server in one place, per editor:** `config.network` on both drop-ins and on `ElementEditorUIProvider` for the adapters. `vectorTiles`, `dem` (with `encoding`), `osmRaster`, `glyphs` and `sprite` point the built-in basemaps at your servers (a URL, or MapLibre source fields merged over the built-in ones). `overpass` (`endpoint`, `timeoutMs`), `routing` (`provider: 'ors' | 'osrm'`, `url`, `apiKey`, `attribution`) and `nominatim` (`url`, `email`, `attribution`) set the servers of the Picker, the Route tool and the search box. `fetch` is used for every request Element makes itself. Set a service to `false` to turn it off and hide what needs it (`routing: false` hides the Route tool, `nominatim: false` the search box, `overpass: false` the Leaflet Picker; on MapLibre the Picker then reads only the vector tiles). Headers for map resources go through `mapOptions.transformRequest`. Two editors on one page no longer share any of these. Types `NetworkConfig`, `NetworkSource`, `RoutingConfig`, `NominatimConfig` (`@element-editor/core`). See [Third-party services](./docs/guides/third-party-services.md).
- **Credits follow the services in use.** "Geocoding by Nominatim" shows only while the search box is offered (with your `nominatim.attribution` on your own server), "© openrouteservice.org by HeiGIT" while the Route tool routes through ORS, and a development warning tells you when a tile source points at another server without an `attribution` (the default provider's credit is then dropped; the OpenStreetMap data credit stays).
- A development warning the first time the Route tool uses the public OSRM demo server (the default): it is car-only, rate-limited and not meant for production.
- `@element-editor/core`: `fetchRoute(waypoints, { provider, url, apiKey, fetch, signal })` and `fetchOverpassFeatures(lat, lon, radius, click, { endpoint, timeoutMs, fetch, signal })` take the per-editor settings on each call (a bare `AbortSignal` still works). Failed lookups reject with `OverpassError` (`code`: `'rate-limited' | 'busy' | 'timeout' | 'network'`). Types `FetchRouteOptions`, `OverpassOptions`, `OverpassErrorCode`. `uiStore.unavailableTools` and `isToolAvailable(tool)` tell you which tools `config.network` turned off.

#### Keyboard

- **`Escape` closes windows** (shortcuts, settings, schema editor, the floating GeoJSON inspector) and puts focus back on the button that opened them. On the map, `Escape` first cancels the active tool or selection.
- `Enter` finishes a line, polygon, route, slice or cut even with `ui.keyboardShortcuts: false`.

#### Several editors, frameworks and coding agents

- **Several editors on one site keep their own settings.** `config.persistKey` namespaces everything an editor remembers in `localStorage` (`elm_theme` becomes `elm_<persistKey>_theme`, and so on); `config.persist: false` reads and writes nothing. Works on both drop-ins and through `ElementEditorUIProvider config`. `@element-editor/core`: `PersistScope`, `scopedKey`, and an optional scope argument on `readStorage` / `writeStorage` / `readPersisted` / `writePersisted`.
- **Toasts work without setup.** Each `ElementEditorUIProvider` (exported from `@element-editor/ui`, re-exported by both adapters) and `<ElementEditor>` renders its own toaster, so adapter users don't add one and a second editor never shows a toast twice. Turn it off with `toaster={false}`. Also `useToasterId()`, `useIsEventForEditor()`, `EmittedEvent`; `error`, `warning` and `success` events may carry a `description`.
- **Next.js App Router:** both `@element-editor/react` entries, `@element-editor/ui` and both adapters start with `'use client'`, so Server Components can import them. `@element-editor/core` and `adapter-maplibre/basemaps` stay importable on the server.
- **AGENTS.md in every package:** a guide for AI coding agents (which entry to pick, installs, minimal examples, Next.js, loading data, the ref API, error codes, common mistakes), type-checked in CI.
- `@element-editor/core`: `readStorage` / `writeStorage` (they never throw), `dataStore.canAddFeatures(n)`, `dataStore.deleteFeatures(ids, { undoable })` (one undo step, returns the count) and `isGeometry`.

### Changed

#### Data in and out

- **Plain GeoJSON in, strict GeoJSON out.** `initialData`, `ref.setFeatureCollection()`, `ref.importGeoJSON()` and `ref.addFeature()` (both drop-ins and both adapters) accept GeoJSON as most tools write it, typed as the new `FeatureCollectionInput` / `GeoJSONFeatureInput` (from `@element-editor/core` and both react entries): `metadata` and feature `id` optional (`id` may be a number), `properties` may be `null`, and `@types/geojson` values fit as they are (3D positions, 6-value `bbox`, `GeometryCollection`). Element stores them normalised (a UUID for a missing id, numbers as strings, `{}` properties, the default schema). A feature with `geometry: null` is skipped and reported through `onError` (`code: 'invalid-data'`). `getFeatureCollection()`, `onChange` and events still return the strict `FeatureCollection` / `GeoJSONFeature`.
- **Loading `initialData` no longer fires `onChange` / `onFeature*`** (it did, twice under StrictMode). You already have that data.
- **`submit()` and `validate()` check every feature.** Imported data with a missing required field used to pass `submit()`.
- **Invalid `initialData` no longer crashes the editor:** it reports an `error` event and starts empty. A single `Feature` is wrapped in a `FeatureCollection`.
- **Replacing the data is one undo step** (Cmd/Ctrl+O, `ref.importGeoJSON`, `setFeatureCollection`) instead of writing a file backup: one undo brings back the previous features, schemas and groups.

#### Editing

- **`readonly` closes every way to change data,** not only the drawing tools: data table edits and paste, renaming and reordering layers, the schema editor, typing in the GeoJSON inspector, editing shortcuts, import (`Cmd+O`, file drop) and undo / redo. Selecting, measuring, search, copy, export and the panels still work; the ref API is not restricted.
- **One action, one undo step:** boolean operations (union, subtract, intersect, exclude), duplicate, reordering layers and renaming a group. Union of many features used to add one step per input, so the first `Cmd+Z` emptied the map.
- **Undo and redo keep the selection** (and an open point edit or transform) for the features that still exist.
- **Simplify, Smooth and Buffer work on lines.** Simplify and smooth keep the line open with its endpoints; buffer turns it into a corridor polygon.
- **Circles, rectangles and routes become plain shapes on the first point edit.** Entering point editing shows a notice, and the first change to a point drops `_drawType` (and a route's `_waypoints`) in the same undo step. A rectangle's corners can now be deleted like any point (it used to refuse with "Convert to polygon first.", pointing to an action that didn't exist).
- **Transform is easier to use:** clicking a feature stays in transform, and `Escape`, `A` or a click on empty map exits. Dragging anywhere inside the box moves the whole selection, the same on both engines.
- **The GeoJSON inspector shows you where the JSON breaks.** Invalid text is underlined, a status line says where ("Invalid JSON at line 42 — no changes apply until it's fixed") and jumps there on click, and text that isn't applied yet is kept as a draft when the inspector closes or docks.

#### Map and view

- **Zooming to something centres it in the map you can actually see.** Every fit, fly-to and pan (selection, search, zoom to feature, `ref.flyTo` / `fitBounds`, `select(ids, { fit: true })`) centres the target in the part of the map the open panels leave visible, so `map.getCenter()` can differ from the target while a panel is open.
- **The MapLibre adapter no longer moves your map on mount.** `ElementEditorControls` used to fit the map to the features when it mounted, which in practice overrode the remembered view on every load of the MapLibre drop-in. The drop-ins now choose the start view (see `initialView`); adapter users fit with `ref.fitBounds`. `FitBounds` stays exported.
- **`bounds` sets the start view when nothing else does** (no `initialView`, no remembered view, no `initialData`): the map opens fitted to it instead of over Europe.
- On MapLibre, features are easier to see on dark basemaps (a lighter default slate, `#94a3b8`), and lines are drawn 3.5 px wide by default.
- **Map credits follow the [OSM Foundation attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)** on both drop-ins: shown in full at load, folded into the "i" button on the first map interaction or after five seconds. Leaflet used to start folded; MapLibre folded only on a drag.

#### Words and look

- **Plain words in the UI.** The Polygon tool is called **Area** everywhere people see it (toolbar, shortcuts panel "Draw area", messages); its id stays `'polygon'` in `tools` and `setTool`, and GeoJSON types are unchanged. Unnamed features are labelled Point / Points, Line / Lines, Area / Areas or Mixed instead of "Polygon", "MultiPolygon", "MultiLine" or "Collection". The Measure tool's buttons read "Measure distance" and "Measure area"; Settings → Geometry drawing mode reads "Visual" / "Spatial".
- **A calmer interface.** Toasts are compact and quiet (no icons or per-type colours, inverted against the editor theme; new `ElementToaster` export) and follow the editor's theme. Delete and remove actions are no longer red. Buttons that open a window or panel show a filled icon while it's open. Tooltips flip and shift to stay on screen. The layers-panel toggle sits in the panel header. Panels, table, inspector and attribution move together when a panel opens or closes. The feature panel's source JSON is syntax-highlighted. Every zoom-to action flies on Leaflet too, and `Enter` in the search box goes to the highlighted (or first) result.

#### Several editors, servers and frameworks

- **Keyboard shortcuts reach only the editor you're using** (the one with focus or the last pointer press). Two editors on a page, and your own inputs and modals, no longer receive each other's keys.
- `config.mode` and the `theme` prop no longer write the theme to `localStorage`, so one editor's config doesn't leak into others.
- `routingApiKey` is per editor instead of shared by every editor on the page (and now deprecated, see below).
- **The search box no longer sends a `User-Agent` header** (browsers drop or preflight it). Identify your app to Nominatim with `config.network.nominatim.email`.
- **The Picker copes with a busy Overpass server:** a busy or rate-limited answer (429, 502, 503, 504) is retried twice, honouring `Retry-After` up to 10 s. Each attempt times out after 15 s, network errors aren't retried, and `Escape` cancels a lookup in progress.
- **The MapLibre drop-in renders on the server without errors:** it outputs its loading shell and doesn't touch `window`, `document` or `localStorage` there. Keep `ssr: false` in Next.js anyway (see the [Next.js guide](./docs/guides/nextjs.md)); the Leaflet drop-in can't render on the server at all.
- **Heavy geometry work no longer blocks the page.** Buffer, Simplify and Smooth previews, Cut hole and Slice run in a background worker that loads on first use and needs no bundler setup (a cut on a 50,000-point polygon used to block the page for over 2 seconds). Where no worker can start, they fall back to the main thread. The latest slider value wins, and a job times out after 30 s.
- **Packaging that works with every TypeScript and bundler setup.** CommonJS entries are `.cjs` files, and types resolve under `moduleResolution: node16` / `nodenext`, for `require`, and (for the `/leaflet`, `/basemaps`, `/primitives` and `/internal` subpaths) under `node10`. The packages no longer bundle each other: `@element-editor/react` went from 4.2 MB to 152 KB on disk.
- **Licence:** the community edition is MIT (all packages).
- **npm metadata:** every package has `repository`, `homepage`, `bugs` and `keywords`, publishes with provenance, and ships `LICENSE`, `README.md` and `AGENTS.md`.
- `@element-editor/core`: the `react` peer is `^19.2.0` like the other packages, and the `GeometryWorkerPayload` type covers the buffer, simplify and smooth payloads.

### Removed

**Each package's main entry now exports only its documented API.** Nothing here was ever published, so there's no deprecation period. If you used one of these from a pre-release build: helpers the packages share among themselves moved to `@element-editor/core/internal` (new) and `@element-editor/ui/internal`, which are **not covered by semver** and not meant for application code.

- `@element-editor/core`, moved to `/internal`: the Mercator and geometry math (`project`, `unproject`, `toRadians`, `getMercatorLatCorrectionRatio`, `applyVisualTransform`, `translateGeometryVisually`, `translateGeometrySpatially`, `mapPositions`, `rdp`), multi-geometry parts (`isMultiGeometry`, `getPartCount`, `getPartGeometry`, `setPartGeometry`, `getPartBBox`, `getPartLabel`, `offsetGeometry`, `offsetSimpleGeometry`), topology (`findTopologicalNeighbors`, `groupNeighborsByFeature`, `applyTopoMove`, `commitTopoMove`, `commitTopoInsert`, `commitTopoDelete`, `transformUpdates`, `NeighborVertex`, `TopoUpdate`), `placeBox` / `PlaceMode` / `PlaceBounds`, `createClickRepeatGuard`, `CLICK_SLOP_PX`, `CLICK_TOOL_MODES`, `normalizeBounds`, `normalizeFlyToTarget`, `normalizeFitBoundsTarget`, `warnOnce`, `isDevBuild`, `httpErrorCode`, `loadErrorCode`, `routingError`, `routingAttribution`, `overrideSource`, `OSM_ATTRIBUTION`, the picker helpers (`tileCandidates`, `tileCandidateResult`, `unionPieces`, `overpassRadiusForZoom`, `addPickedFeature`, `OSM_PICK_MIN_ZOOM`, `OSM_PICK_OVERLAY_COLORS`, `TileFeature`, `TileCandidate`), schema defaults (`DEFAULT_SCHEMAS`, `BOUNDARIES_SCHEMA_ID`, `FIELD_TYPES`, `slugify`, `uniqueKey`), shortcut bindings (`CUSTOMIZABLE_SHORTCUTS`, `FIXED_SHORTCUTS`, `CustomizableShortcut`, `loadCustomBindings`, `saveCustomBindings`, `getEffectiveKey`, `getCurrentKey`, `findConflict`, `syncShortcutCache`), `GeometryWorkerRequest`, `GeometryWorkerResponse`, `setGeometryRunner`, `GeometryRunner`, `featureLimitMessage`, `freeGeometry`, `canProcessShape`, `isLineGeometryType`, `countShapeVertices`, `makeCircleCoords`, `makeRectCoords`, `resolveUnitSystem`.
- `@element-editor/core`, no longer exported: `getBBox`, `exportLayerGeoJSON`, `getBaseGeometryCategory`, `mergeGeometries`, `canVertexEdit`, `findSharedEdgeNeighbors`, `applyTopoInsert`, `applyTopoDelete`, `SharedEdgeNeighbor`, `clearOverpassCache`, `OVERPASS_DEFAULTS`, `tileFeatureToResult`, `overpassResultToFeature`, `DEFAULT_SCHEMA`, `getRoutingApiKey`, `ORS_DEFAULT_URL`, `OSRM_DEFAULT_URL`, `ORS_ATTRIBUTION`, `STORAGE_KEY`, `FixedShortcut`, `AnyShortcut`, `getGeometryRunner`.
- `@element-editor/core`, kept and now documented as public: the store state types `DataStore`, `UIStore`, `UndoEntry` (new export), `PanelPrefs` (new export), `StoreFeaturePatch` (new export: what the store's `updateFeature(s)` take), `DialogState`, `CompletedMeasurement`, `DataStoreOptions`, `UIStoreOptions`, `FeaturePatch`. `GeoJSONFeature._validation` is marked `@internal`.
- `@element-editor/ui`: `useContextMenu` moved to `/internal`; `useDragWindow`, `useResizablePanel` and `useSearchState` are no longer exported. New: the `DataStore` and `UIStore` types, next to `useDataStore` / `useUIStore` / `useGeoStore`.
- `@element-editor/adapter-leaflet`: `FeatureLayer` (it was deprecated, never mounted and ignored `featureColor`; use `ElementEditorControls`) and the `FitBoundsInteraction` alias. `FitBounds` now fits the map to the features once on mount, like the MapLibre one (the old one re-fitted on every change).
- `@element-editor/adapter-maplibre`: the `FitBoundsInteraction` alias (use `FitBounds`), `initFeatureLayers` / `cleanupFeatureLayers`, `initPreviewLayers` / `cleanupPreviewLayers`, `initSnapLayers` / `cleanupSnapLayers`, `initProcessingPreviewLayers` / `cleanupProcessingPreviewLayers`, `initMeasurePreviewLayers` / `cleanupMeasurePreviewLayers`, `INTERACTIVE_FEATURE_LAYERS` (`ElementEditorControls` now adds and removes Element's sources and layers itself, also after style changes), `emptyFC`, `bboxToMapLibre`, `useCursorWhileMode`, `useModifierDragCursor`. `@element-editor/adapter-maplibre/basemaps`: `finishStyle`, `carryOverElm`.

### Deprecated

These still work in 0.2. The first three log a one-time development warning that tells you what to use instead.

- `bounds={[[south, west], [north, east]]}` (`[lat, lng]` pairs) on both drop-ins and adapter-leaflet: pass a bbox `[west, south, east, north]`. The warning prints the converted value. Type `LegacyLatLngBounds`.
- `ref.flyTo([lat, lng], zoom)`: use `ref.flyTo({ center: [lng, lat], zoom })`.
- The `routingApiKey` prop (both drop-ins and both adapters' `ElementEditorControls`): use `config.network.routing.apiKey`, which wins when both are set.
- `@element-editor/core`: `setRoutingApiKey()`, which is shared by every editor on the page, so two editors overwrite each other's key. Use `config.network.routing.apiKey`, or pass `{ apiKey }` to `fetchRoute`. `fetchRoute(waypoints, signal)` with a bare `AbortSignal` still reads the shared key.

### Fixed

#### Drawing and editing

- **Snapping works everywhere.** On MapLibre it now works above about 60° latitude, and every geometry type is a snap target on both engines (`MultiLineString` and `GeometryCollection` weren't). A `MultiPoint` offers only its points; the cursor no longer snaps to imaginary lines between them.
- **Altitude (Z) is kept** when you move, scale or rotate, drag points, edit shared points or type coordinates; a point inserted on an edge takes the mean altitude of its neighbours. Transforms used to drop it.
- **Shapes keep their true size when moved in Spatial drawing mode**, even at high latitudes, where they used to drift.
- **Transform works the same on both engines.** Shift scales evenly from every handle (MapLibre ignored it on edge handles; on Leaflet, Shift on an edge handle could only grow the shape). Alt / Option scales from the centre of the box (it did nothing on Leaflet) and combines with Shift. Rotation turns around the centre of the box, so uneven shapes no longer drift while rotating. Pressing or releasing Shift or Alt mid-drag updates the preview at once, and the box's centre and side handles sit where you'd expect.
- **Shared edges follow along.** With shared-edge editing on, a transform moved a neighbour only at the last shared point; it now follows at all of them. A transform, a multi-feature drag and a shared-point edit each fire one `onChange` instead of one per feature.
- **Slice tells the truth.** A line that doesn't split the shape (it stops inside it or misses it) no longer notches it while also reporting a failure. Nothing changes, and the message says what to do: "The line didn't cut the shape apart, so nothing changed. Draw it all the way across the shape." A multi-part shape counts as sliced only when it gains a part.
- **Boolean operation buttons say what they do.** Subtract's tooltip said "bottom minus top", but it cuts every other selected shape out of the one selected first; its tooltip and accessible name now say "Subtract: cut the others out of the first selected". Union, Intersect and Exclude got short descriptions too.
- Simplify on Leaflet can be undone, and Measure no longer leaves a "0 m" label behind.
- Switching drawing tools discards the previous tool's route waypoints, freehand and measure points (they could linger).
- On MapLibre, closing a freehand loop on its start point, or placing a circle by clicking, keeps the new shape selected; `Escape` clears a multi-selection on both engines whatever has focus; and in point editing only the hovered edge's midpoint handle shows, as on Leaflet.
- **Every edit can be undone:** data table cells, the side panel's Save, renames, map label edits, and adding, renaming or deleting schemas and fields (one step each). `deleteSchema` refuses to remove the last schema, and `addSchema(name, fields?)` returns the new id.
- **Undo right after loading no longer empties the map:** loading `initialData` isn't an undo step. `importGeoJSON(raw, 'replace', { undoable: false })` loads without one and clears the history.

#### Import, export and data

- **One broken feature no longer stops an import.** A feature with a malformed geometry (an unknown type, or `coordinates` missing or not an array) is skipped and counted; an empty geometry (`coordinates: []`) loads without crashing. Empty geometries no longer export a `[null, null, null, null]` bbox, and a merge import that adds nothing no longer creates an undo step.
- **Circles and rectangles survive a round trip.** `hidden` and `_drawType` were exported but dropped on import (`initialData`, `importGeoJSON`, file import). A numeric feature id `0` was replaced by a UUID; it's now `'0'`.
- `importGeoJSON('replace')` (and `setFeatureCollection`, and `initialData` under StrictMode) no longer drops incoming features whose ids already existed in the editor.
- **`maxFeatures` holds for every way of adding features:** drawing, duplicate, Alt-drag, paste, break apart, slice, buffer-as-new, Picker, GeoJSON editor and import (which is cut short and reports `truncated: true`).
- **Fewer spurious `onChange` calls.** `updateFeature` / `updateFeatureValidation` with an unknown id, or validation results that change nothing, no longer fire it; `dataStore.deleteFeature` with an unknown id no longer adds an empty undo step. `onChange` reuses the same object for unchanged features, so you can compare by reference.
- **GeoJSON inspector:** edits that removed features now reach the map, in real time, and the selection follows the code cursor. Undo inside the inspector can no longer wipe every feature, and features without a valid geometry are never committed from it.
- **Data table:** pasting into a cell works; the selected-cell ring clears on an outside or header click; no focus outline around the whole grid. Boolean fields show a toggle in each row instead of a text input: click it, or press `Space` / `Enter` on the selected cell (one undo step each). Values are stored as `true` / `false`; pasting `yes` / `no`, `true` / `false` or `1` / `0` sets it and other text is ignored; boolean columns sort off before on; `readonly` disables the toggle. The feature panel's toggle no longer shows a value stored as the text `"false"` as on.
- **Large layer lists behave:** with thousands of features the list no longer goes blank deep inside a large group, and selecting a feature scrolls its row into view inside groups.

#### Maps and basemaps

- **The MapLibre drop-in always gives you a map.** A basemap style that fails to load (network, bad URL) used to leave the editor without one; it now mounts on a blank map and reports an `error` event. No `setStyle` race on mount (also under StrictMode), and `maplibre-gl.css` no longer squeezes the map to 400 px.
- A basemap or theme change while the first basemap was still loading is no longer lost (MapLibre).
- The selected feature's highlight no longer disappears after a full style rebuild, such as a basemap switch MapLibre can't diff or a WebGL context restore.
- `'auto'` keeps following the theme when the basemap picker is hidden.
- Text features (map labels) render on the built-in basemaps; their font used to fail to load. They now use Noto Sans.
- The default entry imports under plain Node ESM and works with the MapTiler SDK's `maplibre-gl` build.
- **Leaflet drop-in:** a single `basemaps` entry now replaces OpenStreetMap instead of being ignored, and an entry without `maxZoom` no longer breaks fitting (`select(ids, { fit: true })` threw).
- `bounds` is applied on mount, not only when it changes (both engines).
- Inside the drop-in, fit-bounds, locate, zoom and the ref's `flyTo` / `fitBounds` no longer silently do nothing when a map-controller provider is nested in another.
- **Picker:** leaving the tool cancels its lookup and removes its overlay (Leaflet), and a cancelled lookup no longer removes a newer one's pulse.

#### Hover, cursors, focus and keyboard

- **Hover feedback you can trust.** The pointer cursor no longer sticks after you hover a feature, and a quick exit no longer leaves a Leaflet feature looking hovered. Lines can be hovered, named and clicked within about 8 px on both engines (MapLibre adds a transparent hit layer, `elm-features-line-hit`). No name tooltip in point editing. A feature just added under a still cursor shows no name and isn't a snap target until the cursor leaves it; a point placed that way is drawn one accent shade darker instead of under a snap ring.
- On MapLibre, the hover tooltip no longer names a different feature after you finish a shape under a still cursor; on Leaflet, a pin's hover colour no longer sticks after the cursor leaves (also for MultiPoint and GeometryCollection pins).
- **Cursors:** a grabbing hand while you pan during a tool, and the crosshair comes back after a Picker candidate pick and after a Cmd/Alt-drag mid-tool.
- **Shortcuts show what they did.** Pressing a shortcut briefly shows its button pressed (about 140 ms), as if clicked: undo / redo, the drawing tools, measure, transform, cut hole, slice, break apart, duplicate, delete, and the table, GeoJSON, schema, layers panel, shortcuts and zoom toggles. Only the editor that handled the key flashes. Your own buttons can join in with `data-elm-shortcut="<shortcut id>"` (the `shortcutId` prop on `ToolButton`, `IconButton`, `EditToolbarBtn`).
- No blue focus outline around the whole map after you click it and press a shortcut key.
- Pressing `I` or `T` no longer types the letter into the GeoJSON inspector it just opened.
- `Enter` on a focused button activates it instead of toggling point editing.
- **Basemap picker:** `Escape` closes it without deselecting features, focus moves into the panel and back, and it announces its state to screen readers (`aria-expanded`, `aria-controls`). The panel opens next to its button.

#### Errors and messages

- **Failures no longer pass silently or under the wrong name.** A failed basemap switch, a style URL that fails after a switch, and a basemap catalog that doesn't load are reported. A refused system clipboard no longer says "Copied selection" (it says the copy works in this editor only). A refused routing API key (401 / 403) says so instead of "Couldn't snap to road", and Leaflet reports routing failures as errors like MapLibre. A Nominatim 429 says to wait instead of "check your connection". Overpass answering with HTML is `invalid-data` instead of a network error. Preview failures and worker timeouts reach `onError` quietly. `Cmd/Ctrl+O` reports features skipped for a missing or unsupported geometry or a repeated id, applies the 100 MB import limit, and says "Not valid JSON" instead of the raw parser message.
- **Development warnings reach you.** They were stripped from the published build; they now follow your bundler's `process.env.NODE_ENV` and stay silent in production builds. New ones catch a missing Element stylesheet, an editor with zero width or height, and adapter UI outside a `data-elm-theme` element.
- Storage access in sandboxed or storage-blocked iframes no longer crashes the editor.

#### Layout and theming

- The top and bottom control rows and the editing toolbars end at the right-hand panels (layers panel and docked GeoJSON inspector), so the toolbar no longer covers the docked inspector's header and centres on the visible map.
- `<ElementEditor layout="split">` stays split after mounting (it was reset to `'panel'`), and prop changes no longer trigger React's "Cannot update a component while rendering a different component" warning.
- **Your accent reaches everything.** `--elm-primary-*` passed through `style` (or set on any editor root) takes effect, and map highlights honour per-shade overrides and stylesheet-only accent changes. CSS variables in `<ElementEditor style>` (`--elm-accent`, `--elm-primary-N`, …) also reach modals, context menus, tooltips, the basemap picker and the Picker's candidate list, which used to stay blue unless the accent came from `accentColor`. TypeScript accepts `--*` keys in `style` without a cast.
- **Dark mode everywhere:** the OSM trace candidate list rendered light in dark mode, and dragged rows and groups in the layers list now keep the editor's mode too.
- Smaller layout fixes: dragged windows no longer trail the cursor; the attribution "i" no longer touches the last `bottomRight` button; bottom-left buttons no longer cover the editing toolbar on narrow editors; the Schema window is at least 450 px wide.

### Performance

Large datasets no longer freeze the page. Measured with the repository's benchmark (`pnpm test:perf`: 5,000 mixed features and one 50,000-point polygon), first run of this cycle against the release candidate:

- **Leaflet, 5,000 features:** the longest task while loading went from 4,471 ms to 69 ms (features appear progressively, all of them by about 0.9 s). Panning no longer blocks (8,160 ms of blocking time down to 0; median frame 200 ms down to 17 ms). Zoom blocking went from 1,298 ms to 58 ms, and box-select from 972 ms to 31 ms.
- **MapLibre, 50,000-point polygon:** entering point editing froze the page for 42 s; it now takes 159 ms (at most 500 point handles per ring, sampled in view).
- **GeoJSON inspector with 5,000 features:** opening it went from a 316 ms task to 64 ms on Leaflet, and from 278 ms to no long task on MapLibre. Typing re-parses only the feature you edit.
- **Resizing panels with 5,000 features:** each frame's style work dropped from about 65 ms to 9 ms. Blocking time while resizing went from 2,180 ms to 28 ms on Leaflet and from 314 ms to 0 on MapLibre.
- **Saving an edit no longer touches every feature:** dragging with 5,000 features on MapLibre blocks for 14 ms instead of 69 ms. Layers-panel rows are a fixed 36 px and no longer re-measure while scrolling.

Outside the benchmark:

- **Smaller downloads.** The gzipped JavaScript a fresh Vite app loads up front went from 669 KB to 495 KB for the MapLibre drop-in (−26%) and from 419 KB to 272 KB for Leaflet (−35%). The data table, layers list and schema editor now load only when opened, the clipping and buffer code on first use, the basemap thumbnails separately, and Settings and Shortcuts mount only while open.

### Changes since the 0.2 pre-releases

Only matters if you built against a pre-release of `main`; none of these APIs were in 0.1.0.

- `@element-editor/ui`: `resolveLayout`, `LAYOUT_SLOTS`, `isControlVisible` and `visibleLayoutEntries` moved to `@element-editor/ui/internal`, which is **not** covered by semver. `resolveConfig()` and `DEFAULT_LAYOUT` stay in the main entry.
- `DEFAULT_LAYOUT` is deep-frozen, so mutating it throws in strict mode. Change it with `withLayout({ move: { attribution: 'statusRight' } })`.
- `LayoutConfig` is slot-specific: map slots take `MapEntry`s and status slots `StatusEntry`s, so `'attribution'` or a bare `'separator'` in a map slot, `'toolbar'` / `'applyChanges'` in the status bar and `{ items, direction }` on a status slot are compile errors (they used to be dropped at runtime with a warning).
- `ResolvedConfig['ui']` has `layout` instead of `corners`, and `ResolvedConfig['toolbar'].position` reflects the toolbar's layout slot.
- `@element-editor/ui`: removed `danger` from `ContextMenu` items, the `danger` prop of `EditToolbarBtn`, `Button`'s `'danger'` variant, the `ToolBar` export and the `@element-editor/ui/style.css` export (import the stylesheet of `@element-editor/react`, `/leaflet` or an adapter; each includes the UI styles).
- Third-party servers moved to `config.network` (per editor): `configureOverpass()` and its `OverpassConfig` type are removed (use `config.network.overpass` and `fetch`, or the options of `fetchOverpassFeatures`). The `spriteUrl` prop of the MapLibre drop-in and of `BasemapControl`, and the `spriteUrl` option of `useBasemap` / `loadBasemapStyle` / `setBasemap`, are removed (use `config.network.sprite`, or the `{ network }` option). `uiStore.routingApiKey` and the store's `setRoutingApiKey` are removed.
- `BasemapControl` on your own map leaves your style alone until there's a real choice: with no `value`, no explicit `defaultValue` and nothing remembered under `storageKey`, it shows `'auto'` selected but applies nothing until the user picks. Pass `defaultValue` (or `value`) to apply a basemap on mount.

---

## [0.1.0] — 2026-04-12 (pre-release, not published)

Where Element started: the first build of the editor, made from the repository only. It was never published to npm; the first npm release is 0.2.0.

### Packages

- `@element-editor/react` `0.1.0`: the full editor that owns its map
- `@element-editor/adapter-leaflet` `0.1.0`: an editing layer for an existing Leaflet map
- `@element-editor/adapter-maplibre` `0.1.0`: an editing layer for an existing MapLibre GL map
- `@element-editor/core` `0.1.0`: shared stores, geometry workers, types and utilities

### Features

- Drawing tools: point, line, polygon, rectangle, circle, freehand, road-snapped route
- Point editing: drag points, insert new ones from edge midpoints, delete with a right-click
- Transform: scale and rotate with bounding-box handles
- Snapping to points and edges, with a visual indicator
- Boolean operations (union, difference, intersection) and buffer, in a web worker
- Schemas: named data models with typed fields and validation
- Data table: a spreadsheet view of features and their properties
- GeoJSON inspector: view and edit the raw GeoJSON
- Import: GeoJSON, replace or merge, or fetch from a URL
- Export: GeoJSON download, SVG export
- Undo / redo: a 25-step history, with actions in the toasts
- Groups: collapsible named groups with their own visibility and export
- Dark mode: `theme="light" | "dark" | "auto"`
- Keyboard shortcuts for drawing, editing and navigation
- Box selection: Shift+drag to select several features
- Ref API: `getFeatureCollection`, `setFeatureCollection`, `undo`, `redo`, `clearSelection`
- Granular events: `onFeatureAdd`, `onFeatureUpdate`, `onFeatureDelete`, `onSelectionChange`
- Licence key validation (`elm_live_` prefix, evaluation-mode warning); removed in 0.2.0
- A pnpm workspaces monorepo with a shared `@element-editor/core`

[0.2.0]: https://github.com/spatibase/element/releases/tag/v0.2.0
[0.1.0]: https://github.com/spatibase/element/commits/main
