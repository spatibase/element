# Quick start: MapLibre adapter

*Add Element drawing tools to your existing MapLibre GL, MapTiler SDK, or Mapbox GL JS map. Estimated time: ~10 minutes.*

Use `@element-editor/adapter-maplibre` when you already have a MapLibre GL (or compatible) map in your application. Element attaches as an editing layer over your existing map instance — your basemap, style, camera controls, and custom layers are untouched.

This adapter also works with **MapTiler SDK** (which extends MapLibre GL directly) and **Mapbox GL JS** (same runtime API surface). See [Using with MapTiler SDK](#using-with-maptiler-sdk) and [Using with Mapbox GL JS](#using-with-mapbox-gl-js) below.

> **Configure visually first?** [Open the playground](https://elementeditor.dev/playground) to tweak every setting and copy the resulting config. Pass the same `config` object to `<ElementEditorUIProvider config={...}>`.

---

## Step 1 — Install

```bash
npm install @element-editor/adapter-maplibre @element-editor/ui maplibre-gl
```

If `maplibre-gl` is already in your project, you don't need to reinstall it. Peer dependencies: `react` and `react-dom` `^19.2`, `maplibre-gl` 5.5 or 6. React 18 is not supported.

`@element-editor/ui` provides the toolbars and panels. The adapter already depends on it, but list it in your own `package.json` so you can import from it (pnpm and other strict package managers only resolve packages you declare). The same applies to `@element-editor/core` if you want its types and helpers, such as `FeatureCollection` or `getFeatureCollectionBBox`. Keep all `@element-editor/*` packages on the same version.

---

## Step 2 — Import the CSS

Add these imports once, near your app entry point:

```tsx
import 'maplibre-gl/dist/maplibre-gl.css'
import '@element-editor/adapter-maplibre/style.css'
```

The Element stylesheet doesn't include MapLibre's CSS, so import both. The JavaScript entry doesn't import any CSS.

The stylesheet doesn't reset your page. Tailwind's base styles apply only inside an element with a `data-elm-theme` attribute, so all editor UI must be rendered inside one (Step 3 shows how).

On MapLibre GL JS 6 your map also needs MapLibre's worker URL, set once before the first map (MapLibre 5 has the worker built in). With Vite:

```ts
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
```

For other bundlers see MapLibre's [installation notes](https://maplibre.org/maplibre-gl-js/docs/) and [MapLibre GL JS 6 worker](../guides/third-party-services.md#maplibre-gl-js-6-worker-maplibreworker).

---

## Step 3 — Build the component

MapLibre GL maps are initialised imperatively via `new maplibregl.Map(...)`. Create the map in a `useEffect`, then render `ElementEditorControls` with the map instance, inside `ElementEditorUIProvider`, `GeoStoreProvider` and a `data-elm-theme` element:

```tsx
import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86],
      zoom: 5,
    })
    mapRef.current = map
    if (map.isStyleLoaded()) {
      setMapReady(true)
    } else {
      map.on('load', () => setMapReady(true))
    }
    return () => { map.remove(); mapRef.current = null }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: '600px' }}>
          {/* Map canvas */}
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

          {mapReady && mapRef.current && (
            <ElementEditorControls
              map={mapRef.current}
              onChange={(data) => console.log(data)}
            />
          )}
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

> **Note:** `ElementEditorControls` waits until the map's style can accept sources before it adds its layers, so it's safe to render it as soon as the map exists. The `mapReady` state is still needed: changing `mapRef.current` doesn't re-render the component, so the state change is what makes `ElementEditorControls` appear.

> **Note:** Placement rules:
> - `ElementEditorUIProvider` provides the contexts the editor needs: an error boundary, config, keyboard shortcuts, and events and toasts. `ElementEditorControls` throws without it. It also renders Element's own toast `<Toaster>`, so you don't need to add one.
> - `GeoStoreProvider` must wrap `ElementEditorControls`. It creates the store. Use one per editor.
> - The `data-elm-theme` element (`"light"` or `"dark"`) scopes the editor's styles and its keyboard shortcuts: a key press only acts on this editor when focus or your last click is inside it. It must contain the map container.

---

## What you get

Your existing MapLibre GL map now has Element editing attached:

- Drawing tools for areas, lines, points, rectangles, circles, freehand paths, and routes — plus a picker (`X`) that imports shapes from OpenStreetMap
- Drag-to-draw rectangles and circles; spacebar pans during drawing without leaving the tool; `⌘ J` keeps the tool active after a shape commits
- Click-to-select, multi-select, box-select; right-click context menu on features
- Vertex editing, transform (scale/rotate), boolean operations, simplify/smooth/buffer
- Group / ungroup with `⌘ G` / `⌘ ⇧ G`; groups carry through to `metadata.groups`
- 25-step undo/redo
- `onChange` fires after every committed change with the full `FeatureCollection`

`ElementEditorControls` adds GL sources and layers to your map for rendering features and interactions. It renders no visible HTML DOM elements by default. To add toolbars and panels, see [Adding the full UI](#adding-the-full-ui) below.

---

## Step 4 — Wire up data

Pass `initialData` to pre-populate the editor. `onChange` delivers the full `FeatureCollection` after each committed change. The types come from `@element-editor/core` (see Step 1):

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import type { FeatureCollection } from '@element-editor/core'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const savedData: FeatureCollection | null =
    JSON.parse(localStorage.getItem('my-map') ?? 'null')

  const handleChange = useCallback((data: FeatureCollection) => {
    localStorage.setItem('my-map', JSON.stringify(data))
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86],
      zoom: 5,
    })
    mapRef.current = map
    if (map.isStyleLoaded()) {
      setMapReady(true)
    } else {
      map.on('load', () => setMapReady(true))
    }
    return () => { map.remove(); mapRef.current = null }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: '600px' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          {mapReady && mapRef.current && (
            <ElementEditorControls
              map={mapRef.current}
              initialData={savedData ?? undefined}
              onChange={handleChange}
            />
          )}
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

If `initialData` isn't a valid `FeatureCollection`, the editor reports an `error` event and starts empty instead of crashing. A single `Feature` is wrapped in a collection.

---

## Adding the full UI

`ElementEditorControls` handles the editing layer. Toolbars and panels come from `@element-editor/ui` and are passed as `children` of `ElementEditorControls`. They render inside the adapter's own `MapControllerProvider`, which gives them `flyTo`, `fitBounds` and the other map-controller actions. `FloatingToolbar`, `LayersPanel` and `DataTablePanel` position themselves over the map, against the `data-elm-theme` element (give it `position: relative`). `EditingToolbar`, `ActiveDrawingToolbar` and single buttons such as `FitBoundsButton` render in place, so put them in an absolutely positioned wrapper of your own, as below. `DataTablePanel` writes its open height to `--elm-table-offset` on the `data-elm-theme` element; add it to a bottom-anchored wrapper's `bottom` and the wrapper rides above the open table. The data table and the modals are lazy-loaded, so they must be wrapped in `<Suspense>`. Give each its own boundary: a shared one unmounts the already-loaded siblings while a new one loads.

```tsx
import { Suspense, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import {
  ThemeContext,
  FloatingToolbar,
  EditingToolbar,
  ActiveDrawingToolbar,
  FitBoundsButton,
  LayersPanel,
  DataTablePanel,
  ShortcutsModal,
  SettingsModal,
  SchemaModal,
  GeoJSONModal,
  useUIStore,
} from '@element-editor/ui'
import '@element-editor/adapter-maplibre/style.css'

// Schema and GeoJSON modals render whenever mounted, so mount them only while open.
function ConditionalModals() {
  const schemaOpen = useUIStore((s) => s.schemaModalOpen)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const codeOpen = useUIStore((s) => s.codeModalOpen)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)
  return (
    <>
      {schemaOpen && <Suspense fallback={null}><SchemaModal onClose={toggleSchema} /></Suspense>}
      {codeOpen && <Suspense fallback={null}><GeoJSONModal onClose={toggleCode} /></Suspense>}
    </>
  )
}

export default function MyMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86],
      zoom: 5,
    })
    mapRef.current = map
    if (map.isStyleLoaded()) {
      setMapReady(true)
    } else {
      map.on('load', () => setMapReady(true))
    }
    return () => { map.remove(); mapRef.current = null }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <ThemeContext.Provider value="light">
          <div
            data-elm-theme="light"
            // overflow: hidden: the collapsed layers panel waits just outside the right edge.
            style={{ position: 'relative', width: '100%', height: '600px', overflow: 'hidden' }}
          >
            {/* Map canvas */}
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

            {/* ElementEditor + UI — children of ElementEditorControls get the map controller */}
            {mapReady && mapRef.current && (
              <ElementEditorControls
                map={mapRef.current}
                onChange={(data) => console.log(data)}
              >
                {/* Drawing tool selector: positions itself, top center */}
                <FloatingToolbar />

                {/* Edit actions and finish / cancel drawing: you place these (bottom center here) */}
                <div style={{ position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 400, display: 'flex', gap: 8 }}>
                  <EditingToolbar />
                  <ActiveDrawingToolbar />
                </div>

                {/* Fly to fit all features: you place it (bottom left here) */}
                <div style={{ position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)', left: 16, zIndex: 400 }}>
                  <FitBoundsButton />
                </div>

                <LayersPanel />                {/* Feature list sidebar: positions itself, right */}
                <Suspense fallback={null}><DataTablePanel /></Suspense>  {/* Spreadsheet view */}
                <Suspense fallback={null}><ShortcutsModal /></Suspense>
                <Suspense fallback={null}><SettingsModal /></Suspense>
                <ConditionalModals />
              </ElementEditorControls>
            )}
          </div>
        </ThemeContext.Provider>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

`ThemeContext` tells portaled UI (tooltips, menus, modals) which theme to use. Keep its value in sync with `data-elm-theme`. Any UI you portal elsewhere yourself should carry a `data-elm-portal` attribute on its root, so Element styles it and keyboard shortcuts keep working while it has focus.

For a complete working example with buttons that open each panel, see [Custom UI with adapters](../guides/custom-ui-with-adapters.md).

---

## Using with MapTiler SDK

MapTiler SDK extends `maplibregl.Map` directly. Pass your MapTiler map instance to `ElementEditorControls` as-is — no cast is needed. Keep `maplibre-gl` installed next to it (Step 1): the adapter imports it at runtime for its map markers, and as an optional peer dependency it isn't installed for you.

```bash
npm install @maptiler/sdk
```

```tsx check=false
import { Map } from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'
import { ElementEditorControls } from '@element-editor/adapter-maplibre'

// Render inside ElementEditorUIProvider, GeoStoreProvider and a data-elm-theme element, as in Step 3.
// Initialise MapTiler map in a useEffect (same pattern as MapLibre):
const map = new Map({
  container: containerRef.current,
  style: `https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY`,
  center: [2.35, 48.86],
  zoom: 5,
})

// MapTiler SDK extends maplibregl.Map directly — pass it as-is, no cast needed.
{mapReady && mapRef.current && (
  <ElementEditorControls
    map={mapRef.current}
    onChange={handleChange}
  />
)}
```

---

## Using with Mapbox GL JS

Mapbox GL JS shares the same API surface as MapLibre GL at runtime. TypeScript requires a cast because the type names differ between packages. `maplibre-gl` must stay installed as well (Step 1): the adapter imports it at runtime for its map markers (vertex and transform handles, measure labels).

```bash
npm install mapbox-gl
```

```tsx check=false
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ElementEditorControls } from '@element-editor/adapter-maplibre'

// Render inside ElementEditorUIProvider, GeoStoreProvider and a data-elm-theme element, as in Step 3.
mapboxgl.accessToken = 'YOUR_MAPBOX_TOKEN'

// Initialise your Mapbox map in a useEffect (same pattern as MapLibre).
// Then, when mapReady:
{mapReady && mapRef.current && (
  <ElementEditorControls
    map={mapRef.current as unknown as MapLibreMap}  /* TypeScript cast only */
    onChange={handleChange}
  />
)}
```

The cast changes nothing at runtime. The TypeScript declarations of `mapbox-gl` and `maplibre-gl` are incompatible at the type level, but both implement the map methods Element calls.

---

## Optional: built-in basemaps

Instead of your own style, you can use Element's basemaps (Streets, Terrain, Light, Dark, OpenStreetMap, and an `'auto'` mode that follows the editor theme) with the `BasemapControl` picker. See the [Basemaps guide](../guides/basemaps.md#with-the-maplibre-adapter).

---

## What's next

- [Adapter reference](../reference/adapter-maplibre.md) — every prop, event, ref method, and the `useMapLibre()` hook
- [Custom UI with adapters](../guides/custom-ui-with-adapters.md) — full `@element-editor/ui` integration pattern with proper modal state management
- [Persisting data](../guides/persisting-data.md) — localStorage, REST APIs, granular events, and the ref API
