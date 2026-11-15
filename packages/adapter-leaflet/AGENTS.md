# @element-editor/adapter-leaflet: guide for coding agents

Adds the Element editing layer (drawing, selection, vertex editing, transform, snapping) to a react-leaflet `MapContainer` you already render. It renders no buttons: toolbars and panels come from `@element-editor/ui`. It is also what the Leaflet drop-in (`@element-editor/react/leaflet`) is built on.

Use it when the app already has a Leaflet map. With no existing map, use the drop-in instead (`@element-editor/react`, MapLibre, or `@element-editor/react/leaflet`): it builds the map and the whole UI. The decision table, ref API, events and error codes are in `node_modules/@element-editor/react/AGENTS.md` (when that package is installed) and at https://elementeditor.dev/docs.

## Install and CSS

```bash
pnpm add @element-editor/adapter-leaflet @element-editor/ui leaflet react-leaflet
# types/helpers (FeatureCollection, getFeatureCollectionBBox): pnpm add @element-editor/core
```

Peers: `react`, `react-dom` `^19.2.0`; `leaflet` `^1.9.0`; `react-leaflet` `^5.0.0` (react-leaflet 4 does not work). Keep all `@element-editor/*` packages on one version and list every one you import from in your `package.json`.

```tsx
import '@element-editor/adapter-leaflet/style.css' // includes leaflet/dist/leaflet.css
```

## Example: your map, Element's toolbars

`ElementEditorControls` goes inside `MapContainer` (it uses `useMap()`). The `@element-editor/ui` panels go outside `MapContainer`, as siblings in the same positioned `data-elm-theme` wrapper; inside it, Leaflet would treat their clicks and scrolls as map gestures. `FloatingToolbar`, `LayersPanel` and `DataTablePanel` position themselves against that wrapper; `EditingToolbar` and `ActiveDrawingToolbar` render in place, so give them an absolutely positioned wrapper of your own (adding `--elm-table-offset` keeps them above the open table). `zIndex: 0` on the map keeps Leaflet's panes (z-index 400+) under the panels.

```tsx
import { Suspense, useRef } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import {
  ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls, type ElementEditorControlsRef,
} from '@element-editor/adapter-leaflet'
import type { FeatureCollection } from '@element-editor/core'
import { FloatingToolbar, EditingToolbar, ActiveDrawingToolbar, LayersPanel, DataTablePanel } from '@element-editor/ui'
import '@element-editor/adapter-leaflet/style.css'

export default function MyMap({ data }: { data: FeatureCollection | null }) {
  const editorRef = useRef<ElementEditorControlsRef>(null)

  return (
    <ElementEditorUIProvider config={{ persistKey: 'my-map' }}>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: 600, overflow: 'hidden' }}>
          {/* react-leaflet: center is [lat, lng] */}
          <MapContainer center={[48.86, 2.35]} zoom={5} style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <ElementEditorControls ref={editorRef} initialData={data} onChange={(fc) => console.log(fc)} />
          </MapContainer>
          <FloatingToolbar />
          {/* Not self-positioned: place them yourself (bottom centre here) */}
          <div style={{ position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 400, display: 'flex', gap: 8 }}>
            <EditingToolbar />
            <ActiveDrawingToolbar />
          </div>
          <LayersPanel />
          <Suspense fallback={null}><DataTablePanel /></Suspense>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

`editorRef.current` is an `ElementEditorControlsRef`: the same methods as the drop-in's `ElementEditorRef` (`getFeatureCollection`, `setFeatureCollection`, `addFeature`, `select`, `setTool`, `flyTo`, `fitBounds`, `submit`, `undo`, …) without `getBasemap`/`setBasemap`. `getMap()` returns the `L.Map`. All of them take `[lng, lat]`.

## `ElementEditorControls` props

`initialData` (the starting data: applied at mount, or once when it first arrives while the editor is empty and unedited; later changes are ignored, use `setFeatureCollection`; the adapter never moves the map), `schema`, `tools`, `maxFeatures`, `readonly`, `layout` (`'panel' | 'minimal' | 'split'`), `bounds` (bbox `[west, south, east, north]`, `null` clears), `renderer` (`'canvas'` default, or `'svg'`), `getFeatureStyle` (may return Leaflet `PathOptions`), `onReady(map)`, and the callbacks `onChange`, `onSubmit`, `onValidationError`, `onFeatureAdd`, `onFeatureUpdate`, `onFeatureDelete`, `onSelectionChange`, `onFeatureSelect`, `onZoomChange`, `onToolChange`, `onEvent`, `onError`. `routingApiKey` is deprecated (`config.network.routing.apiKey`). There is no `children` prop (unlike the MapLibre adapter).

Theme, accent, `config` (network, layout, units, `persistKey`), `onEvent` and `onError` also go on `ElementEditorUIProvider`.

## Gotchas

- `[lat, lng]` vs `[lng, lat]`: Leaflet and react-leaflet (`center`, `L.latLng`, `getBounds()`) use `[lat, lng]`; Element's data, `bounds` and ref methods use GeoJSON `[lng, lat]`. Convert at the boundary. `toLeaflet` / `toGeoJSON` are exported for that.
- `ElementEditorUIProvider` is required (`ElementEditorControls` throws without it). One `GeoStoreProvider` per editor, wrapping the `MapContainer`. Everything (map and panels) inside a `data-elm-theme="light" | "dark"` element; for dark mode also set `ThemeContext` from `@element-editor/ui` to the same value.
- Without the stylesheet, tiles and markers break silently and the UI is unstyled.
- react-leaflet's `MapContainer` ignores prop changes after mount (`center`, `zoom`, …). Move the map imperatively: `editorRef.current?.flyTo({ center: [lng, lat], zoom })`, `getMap()`, or `useMap()` in a child.
- Unselected features are drawn on one shared canvas by default; query feature data through the ref (`getFeatureCollection`, `getSelection`), not through `<path>` elements (or pass `renderer="svg"`).
- Lazy UI (`DataTablePanel`, `SchemaModal`, `GeoJSONModal`, `SettingsModal`, `ShortcutsModal`, `BooleanOperations`) needs its own `<Suspense>` each.
- Keep `getFeatureStyle` fast and stable (module level or `useCallback`).
- Next.js: Leaflet touches `window` on import. Load the whole module that imports `react-leaflet` with `next/dynamic` and `ssr: false`, not only `ElementEditorControls`.

Docs: https://elementeditor.dev/docs/quickstart/adapter-leaflet, https://elementeditor.dev/docs/reference/adapter-leaflet, https://elementeditor.dev/docs/guides/custom-ui-with-adapters, https://elementeditor.dev/docs/guides/nextjs. Markdown: append `.md`; everything at once: https://elementeditor.dev/llms-full.txt.
