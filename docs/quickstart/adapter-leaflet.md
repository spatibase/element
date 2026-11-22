# Quick start: Leaflet adapter

*Add Element drawing tools to your existing Leaflet map. Estimated time: ~10 minutes.*

Use `@element-editor/adapter-leaflet` when you already have a Leaflet or react-leaflet map in your application and want to add editing to it — without replacing your map setup. Element attaches as an editing layer; your map, tile provider, and controls stay exactly as they are.

> **Configure visually first?** [Open the playground](https://elementeditor.dev/playground) to tweak every setting and copy the resulting config. Pass the same `config` object to `<ElementEditorUIProvider config={...}>`.

---

## Step 1 — Install

```bash
npm install @element-editor/adapter-leaflet @element-editor/ui leaflet react-leaflet
npm install -D @types/leaflet # TypeScript: leaflet ships no types of its own
```

If `leaflet` and `react-leaflet` are already in your project, you don't need to reinstall them. Peer dependencies: `react` and `react-dom` `^19.2`, `react-leaflet` `^5`, `leaflet` `^1.9`. React 18 is not supported. If your app is on an older React 19, upgrade it first; npm otherwise stops with a peer dependency conflict (`ERESOLVE`). Apps made with Next.js 15's `create-next-app` pin React 19.1:

```bash
npm install react@^19.2 react-dom@^19.2
```

`@element-editor/ui` provides the toolbars and panels. The adapter already depends on it, but list it in your own `package.json` so you can import from it (pnpm and other strict package managers only resolve packages you declare). The same applies to `@element-editor/core` if you want its types and helpers, such as `FeatureCollection` or `getFeatureCollectionBBox`. Keep all `@element-editor/*` packages on the same version.

---

## Step 2 — Import the CSS

Add this import once, near your app entry point:

```tsx
import '@element-editor/adapter-leaflet/style.css'
```

The stylesheet includes Leaflet's CSS (`leaflet/dist/leaflet.css`), so you don't need to import that separately. Importing it again is harmless.

> **Warning:** The JavaScript entry doesn't import any CSS. Without this import, tiles vanish, markers disappear, and the editor UI is unstyled.

The stylesheet doesn't reset your page. Tailwind's base styles apply only inside an element with a `data-elm-theme` attribute, so all editor UI must be rendered inside one (Step 3 shows how).

The stylesheet is plain CSS, so the import works in any CSS setup: Vite, webpack, Next.js, with or without Tailwind (including Tailwind v3), or a CSS `@import`. It has no `@layer`, `@tailwind` or `@apply` directives for your build to reinterpret, and its rules are scoped to the `data-elm-theme` element and Element's portals.

---

## Step 3 — Build the component

Wrap your map in `ElementEditorUIProvider` and `GeoStoreProvider`, put it inside a `data-elm-theme` element, then place `ElementEditorControls` inside the `MapContainer` alongside your existing layers:

```tsx
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import '@element-editor/adapter-leaflet/style.css'

export default function MyMap() {
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: '600px' }}>
          <MapContainer
            center={[48.86, 2.35]}
            zoom={5}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ElementEditorControls onChange={(data) => console.log(data)} />
          </MapContainer>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

> **Note:** Placement rules:
> - `ElementEditorUIProvider` provides the contexts the editor needs: an error boundary, config, keyboard shortcuts, events and toasts, and the map controller used by zoom-to actions. `ElementEditorControls` throws without it. It also renders Element's own toast `<Toaster>`, so you don't need to add one.
> - `GeoStoreProvider` must wrap `MapContainer` (or any ancestor of it). It creates the store that `ElementEditorControls` and any `@element-editor/ui` components share. Use one per editor.
> - The `data-elm-theme` element (`"light"` or `"dark"`) scopes the editor's styles and its keyboard shortcuts: a key press only acts on this editor when focus or your last click is inside it.
> - `ElementEditorControls` must be a **child of `MapContainer`**. It uses `useMap()` from react-leaflet internally.

---

## What you get

Your existing Leaflet map now has Element editing attached:

- Drawing tools for areas, lines, points, rectangles, circles, freehand paths, and routes — plus a picker (`X`) that imports shapes from OpenStreetMap
- Drag-to-draw rectangles and circles; spacebar pans during drawing without leaving the tool; `⌘ J` keeps the tool active after a shape commits
- Click-to-select, multi-select, box-select; right-click context menu on features
- Vertex editing, transform (scale/rotate), boolean operations, simplify/smooth/buffer
- Group / ungroup with `⌘ G` / `⌘ ⇧ G`; groups carry through to `metadata.groups`
- 25-step undo/redo
- `onChange` fires after every committed change with the full `FeatureCollection`

`ElementEditorControls` renders no visible UI by default — it attaches invisible interaction overlays to the map. To add toolbars and panels, see [Adding the full UI](#adding-the-full-ui) below.

---

## Step 4 — Wire up data

`onChange` delivers a complete GeoJSON `FeatureCollection` after each committed change. Load existing data with `initialData`. The types come from `@element-editor/core` (see Step 1):

```tsx
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import type { FeatureCollection } from '@element-editor/core'
import '@element-editor/adapter-leaflet/style.css'

export default function MyMap() {
  const savedData: FeatureCollection | null =
    JSON.parse(localStorage.getItem('my-map') ?? 'null')

  function handleChange(data: FeatureCollection) {
    localStorage.setItem('my-map', JSON.stringify(data))
  }

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: '600px' }}>
          <MapContainer
            center={[48.86, 2.35]}
            zoom={5}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ElementEditorControls
              initialData={savedData ?? undefined}
              onChange={handleChange}
            />
          </MapContainer>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

If `initialData` isn't a valid `FeatureCollection`, the editor reports an `error` event and starts empty instead of crashing. A single `Feature` is wrapped in a collection.

---

## Adding the full UI

`ElementEditorControls` handles the editing layer. The toolbars, sidebar, data table, and modals are separate `@element-editor/ui` components that you position in your own layout.

> **Tip:** With the full UI stack you get exactly the same experience as `@element-editor/react` — but with full control over where each panel lives in your layout.

UI components go **outside** `MapContainer`, positioned absolutely over the map div, and inside the same `data-elm-theme` element. They share the same `GeoStoreProvider` store as `ElementEditorControls`. `FloatingToolbar`, `LayersPanel` and `DataTablePanel` position themselves over the map, against the `data-elm-theme` element (give it `position: relative`). `EditingToolbar`, `ActiveDrawingToolbar` and single buttons such as `FitBoundsButton` render in place, so put them in an absolutely positioned wrapper of your own, as below. `DataTablePanel` writes its open height to `--elm-table-offset` on the `data-elm-theme` element; add it to a bottom-anchored wrapper's `bottom` and the wrapper rides above the open table. The data table and the modals are lazy-loaded, so they must be wrapped in `<Suspense>`. Give each its own boundary: a shared one unmounts the already-loaded siblings while a new one loads.

```tsx
import { Suspense, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
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
import '@element-editor/adapter-leaflet/style.css'

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
  const [mapReady, setMapReady] = useState(false)

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <ThemeContext.Provider value="light">
          <div
            data-elm-theme="light"
            // overflow: hidden: the collapsed layers panel waits just outside the right edge.
            style={{ position: 'relative', width: '100%', height: '600px', overflow: 'hidden' }}
          >
            {/* Map — fills the container */}
            <MapContainer
              center={[48.86, 2.35]}
              zoom={5}
              // zIndex: 0 keeps Leaflet's panes (z-index 400+) under the editor's panels.
              style={{ position: 'absolute', inset: 0, zIndex: 0 }}
              whenReady={() => setMapReady(true)}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {mapReady && <ElementEditorControls drawingBar={false} onChange={(data) => console.log(data)} />}
            </MapContainer>

            {/* UI panels — outside MapContainer, positioned absolutely over the map */}
            {mapReady && (
              <>
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
              </>
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

## What's next

- [Adapter reference](../reference/adapter-leaflet.md) — every prop, event, and ref method for `ElementEditorControls`
- [Custom UI with adapters](../guides/custom-ui-with-adapters.md) — build the full editor experience with `@element-editor/ui`
- [Persisting data](../guides/persisting-data.md) — localStorage, REST APIs, granular events, and the ref API
