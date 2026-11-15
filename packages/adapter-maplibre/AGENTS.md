# @element-editor/adapter-maplibre: guide for coding agents

Adds the Element editing layer (drawing, selection, vertex editing, transform, snapping) to a `maplibregl.Map` you already create. It renders no buttons: toolbars and panels come from `@element-editor/ui`. It also ships the built-in basemap catalog (`@element-editor/adapter-maplibre/basemaps`) and the `BasemapControl` picker.

Use it when the app already owns a MapLibre GL map (or a MapTiler SDK map, which extends it; Mapbox GL JS works with a `map as unknown as maplibregl.Map` cast). Keep `maplibre-gl` installed in every case: the adapter imports it at runtime (markers, handles), and it is an optional peer, so nothing installs it for you. With no existing map, use the drop-in `@element-editor/react` instead: it builds the map and the whole UI. The decision table, ref API, events and error codes are in `node_modules/@element-editor/react/AGENTS.md` (when that package is installed) and at https://elementeditor.dev/docs.

## Install and CSS

```bash
pnpm add @element-editor/adapter-maplibre @element-editor/ui maplibre-gl
# types/helpers (FeatureCollection, getFeatureCollectionBBox): pnpm add @element-editor/core
```

Peers: `react`, `react-dom` `^19.2.0`; `maplibre-gl` `^5.5.0 || ^6.0.0`. Keep all `@element-editor/*` packages on one version and list every one you import from in your `package.json`.

```tsx
import 'maplibre-gl/dist/maplibre-gl.css' // not included in Element's stylesheet
import '@element-editor/adapter-maplibre/style.css'
```

## Example: your map, Element's toolbars

The `@element-editor/ui` components go in `ElementEditorControls`' `children`. `FloatingToolbar`, `LayersPanel` and `DataTablePanel` position themselves against the positioned `data-elm-theme` wrapper; `EditingToolbar` and `ActiveDrawingToolbar` render in place, so give them an absolutely positioned wrapper of your own (adding `--elm-table-offset` keeps them above the open table).

```tsx
import { Suspense, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls, type ElementEditorControlsRef,
} from '@element-editor/adapter-maplibre'
import { getFeatureCollectionBBox, type FeatureCollection } from '@element-editor/core'
import { ThemeContext, FloatingToolbar, EditingToolbar, ActiveDrawingToolbar, LayersPanel, DataTablePanel } from '@element-editor/ui'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap({ data }: { data: FeatureCollection | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ElementEditorControlsRef>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86], // [lng, lat]
      zoom: 5,
    })
    m.on('load', () => setMap(m))
    return () => { setMap(null); m.remove() }
  }, [])

  return (
    <ElementEditorUIProvider config={{ persistKey: 'my-map' }}>
      <GeoStoreProvider>
        <ThemeContext.Provider value="light">
          <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: 600, overflow: 'hidden' }}>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            {map && (
              <ElementEditorControls
                ref={editorRef}
                map={map}
                initialData={data}
                onChange={(fc) => console.log(fc)}
                onReady={(m) => {
                  const bbox = data && getFeatureCollectionBBox(data) // the adapter never moves the map itself
                  if (bbox) m.fitBounds(bbox, { padding: 40, maxZoom: 16 })
                }}
              >
                <FloatingToolbar />
                {/* Not self-positioned: place them yourself (bottom centre here) */}
                <div style={{ position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 400, display: 'flex', gap: 8 }}>
                  <EditingToolbar />
                  <ActiveDrawingToolbar />
                </div>
                <LayersPanel />
                <Suspense fallback={null}><DataTablePanel /></Suspense>
              </ElementEditorControls>
            )}
          </div>
        </ThemeContext.Provider>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

`editorRef.current` is an `ElementEditorControlsRef`: the same methods as the drop-in's `ElementEditorRef` (`getFeatureCollection`, `setFeatureCollection`, `addFeature`, `select`, `setTool`, `fitBounds`, `submit`, `undo`, …) without `getBasemap`/`setBasemap`. `getMap()` returns the `maplibregl.Map`.

## `ElementEditorControls` props

`map` (required), `initialData` (the starting data: applied at mount, or once when it first arrives while the editor is empty and unedited; later changes are ignored, use `setFeatureCollection`; the adapter never moves the map), `schema`, `tools`, `maxFeatures`, `readonly`, `layout` (`'panel' | 'minimal' | 'split'`), `maxBounds` (`[w, s, e, n]` or `[[w, s], [e, n]]`, `null` clears), `getFeatureStyle`, `onReady(map)`, `children`, and the callbacks `onChange`, `onSubmit`, `onValidationError`, `onFeatureAdd`, `onFeatureUpdate`, `onFeatureDelete`, `onSelectionChange`, `onFeatureSelect`, `onZoomChange`, `onToolChange`, `onEvent`, `onError`. `routingApiKey` is deprecated (`config.network.routing.apiKey`).

Names differ from the drop-in: `maxBounds` (not `bounds`), `onReady` (not `onMapReady`), no `initialView`, `theme`, `basemap` or `config` props. Theme, accent, `config` (network, layout, units, `persistKey`), `onEvent` and `onError` go on `ElementEditorUIProvider`.

## Basemaps

```tsx
import { BasemapControl } from '@element-editor/adapter-maplibre'                 // picker, inside ElementEditorControls' children
import { setBasemap, loadBasemapStyle, BASEMAPS } from '@element-editor/adapter-maplibre/basemaps'
```

- `setBasemap(map, input, { theme?, network? })` switches style and keeps Element's layers and your own sources/layers. `input` is `'streets' | 'terrain' | 'light' | 'dark' | 'osm' | 'auto'`, `{ style, id? }` or a raster `{ url, attribution, id? }`.
- `loadBasemapStyle(input, { theme?, network? })` returns a style for `new maplibregl.Map({ style })`.
- `BasemapControl` leaves your style alone until the user picks, unless you pass `value` or `defaultValue`.

## Gotchas

- `ElementEditorUIProvider` is required (`ElementEditorControls` throws without it). One `GeoStoreProvider` per editor. All editor UI and the map must sit inside a `data-elm-theme="light" | "dark"` element, or the UI renders unstyled and shortcuts don't reach it. For dark mode set `ThemeContext` to the same value (portaled menus and modals read it).
- Render `ElementEditorControls` after the map exists; waiting for `load` (as above) is the safe pattern. A `useRef` holding the map does not re-render, so keep the map in state.
- The adapter never fits the map on mount. Fit yourself (`map.fitBounds` in `onReady`, or `ref.fitBounds(getFeatureCollectionBBox(fc))`).
- Your own `map.setStyle()` removes your layers; Element re-adds its own `elm-*` sources/layers. Re-add yours from a `style.load` listener registered in `onReady` (it runs after Element's repair). `setBasemap` / `BasemapControl` keep your layers. Images from `map.addImage` are never carried over: re-add them on `style.load`.
- Add your own layers in `onReady`; pass an `elm-*` layer id as `beforeId` to put them under Element's.
- `DataTablePanel`, `SchemaModal`, `GeoJSONModal`, `SettingsModal`, `ShortcutsModal` and `BooleanOperations` are lazy: give each its own `<Suspense>`.
- Keep `getFeatureStyle` stable (module level or `useCallback`).
- Coordinates in Element's API are `[lng, lat]` (same as MapLibre).
- Next.js: load the component that creates the map with `next/dynamic` and `ssr: false`.

Docs: https://elementeditor.dev/docs/quickstart/adapter-maplibre, https://elementeditor.dev/docs/reference/adapter-maplibre, https://elementeditor.dev/docs/guides/custom-ui-with-adapters, https://elementeditor.dev/docs/guides/basemaps. Markdown: append `.md`; everything at once: https://elementeditor.dev/llms-full.txt.
