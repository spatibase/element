# Custom UI with adapters

*Build the full editor experience while keeping control of your layout.*

`@element-editor/react` gives you a complete editor in a single component. If you're using an adapter — because you already have a Leaflet or MapLibre map — and you want all the same UI (toolbars, panels, data table, modals), but placed where you decide, this guide shows the pattern.

The pattern uses your adapter, `@element-editor/ui`, and a small provider stack that wires them together.

---

## Install

```bash
npm install @element-editor/ui @element-editor/core
# plus your adapter:
npm install @element-editor/adapter-leaflet leaflet react-leaflet
# or
npm install @element-editor/adapter-maplibre maplibre-gl
```

The adapters already depend on `@element-editor/ui` and `@element-editor/core`. List them in your own `package.json` anyway, because your code imports from them and strict package managers (pnpm) only resolve packages you declare. `@element-editor/core` is only needed for types and helpers such as `FeatureCollection` and `getFeatureCollectionBBox`. Keep all `@element-editor/*` packages on the same version. Peer dependencies: React and React DOM `^19.2`.

Import the adapter's stylesheet once. The Leaflet one includes Leaflet's CSS; for MapLibre, also import `maplibre-gl/dist/maplibre-gl.css`:

```tsx
import '@element-editor/adapter-leaflet/style.css'
// or
import '@element-editor/adapter-maplibre/style.css'
```

---

## Only using the tools (no stock panels)

If you build your own toolbar and only drive tools through the `ElementEditorControls` ref, import nothing but the providers, `ElementEditorControls` and your own components. The inspector, data table, layers list and modals are never part of your bundle, and the editor doesn't download them in the background, unless you import and render them. Rendering any of them pulls in its chunk (CodeMirror for the GeoJSON inspector, react-data-grid for the table, drag-and-drop for the layers list), and from then on the editor fetches the panels you imported when the browser is idle, so they open instantly.

---

## The provider stack

Before rendering any UI components, wrap the editor in these, from outermost to innermost:

| Provider / element | From | Required | Purpose |
|---|---|---|---|
| `ElementEditorUIProvider` | your adapter package | Yes | Error boundary, `config`, keyboard shortcut configuration, events and toasts (`onEvent`, its own `<Toaster>`), and the map controller used by zoom-to actions |
| `GeoStoreProvider` | your adapter package (or `@element-editor/ui`) | Yes | Creates the isolated store shared between the adapter and all UI components. One per editor. |
| `ThemeContext.Provider` | `@element-editor/ui` | For dark mode | Passes the theme to portaled components (modals, tooltips, menus). Defaults to `'light'`. |
| `<div data-elm-theme="light">` | your markup | Yes | Scopes the editor's styles (the stylesheet doesn't reset your page, so UI outside this element is unstyled) and its keyboard shortcuts. It must contain the map and all editor UI. |

`ElementEditorUIProvider` wraps `ElementEditorErrorBoundary`, `ElementEditorConfigProvider`, `ShortcutConfigProvider`, `EventProvider` and `MapControllerProvider` from `@element-editor/ui`, in that order. You can use those individually instead, but `ElementEditorControls` needs at least `ShortcutConfigProvider` and `EventProvider` above it, or it throws.

`GeoStoreProvider` is re-exported by both adapter packages. Importing it from the adapter or from `@element-editor/ui` gives the same component.

### Toasts

`ElementEditorUIProvider` renders its own sonner `<Toaster>` and tags every toast with its id, so you don't need to add one, and a `<Toaster>` your app already renders won't show Element's toasts twice. Pass `toaster={false}` to send them to your own untagged `<Toaster>` instead. Pass `onEvent` to handle every message yourself; the editor then shows no toasts at all. See [Events](../reference/events.md#onevent).

### Keyboard shortcuts with several editors

Shortcuts are scoped to the editor they belong to: a key press acts on an editor only when focus is inside its `data-elm-theme` element, or focus is on the page body and your last click was inside it. Two editors on one page don't react to each other's keys, and your own inputs and modals keep their keys. If you render your own UI in a portal outside the `data-elm-theme` element (a menu or dialog attached to `body`), add a `data-elm-portal` attribute to its root. Element then treats it as part of the editor, styles it, and keeps shortcuts and Escape working while it has focus.

---

## The drawing bar

While a drawing tool is on, `ElementEditorControls` shows the drawing bar itself, bottom centre of the map: the hint, and on a touch screen **Done**, **Undo point** and **Cancel**. A host that only mounts the controls (own toolbar, tools driven by `ref.setTool`) therefore needs nothing extra to finish a shape by touch. The bar sits inside the map container, above the phone's home indicator, and its presses never reach the map, so tapping **Done** adds no point.

### Look

- **Colour.** The bar uses the editor's accent: it is blue by default. Set [`accentColor`](./theming.md#approach-1--one-brand-colour) (or `--elm-accent`) to match your product.
- **Size.** `--elm-drawing-bar-height` (default `50px`) sets the bar's height and its buttons follow, so `40px` lines up with 40 px map controls. On a touch screen buttons stay at least 44 px.
- **Hints.** With `config.ui.hints: false` the hint text is hidden; the desktop bar then shows an Undo point button instead, so undoing the last point stays one click away.
- **Only while a tool is on.** `[data-elm-drawing-bar]` is in the DOM only while a drawing tool is active, so you can use it as a "tool is on" signal.

### Placement

- **Lift it.** The bar sits 16 px above the bottom of the map (plus the phone's safe area). Set `--elm-drawing-bar-bottom` on the editor root, on your wrapper or on any ancestor of the map to move it, for example above your own control cluster in the bottom-left corner. `--elm-drawing-bar-inset-x` sets the space it keeps from the left and right edges (default `1rem`).
- **Lift it only when it collides.** There is no avoid-zone API; a CSS container query does it. Make the element that wraps your map's container a size container, and set `--elm-drawing-bar-bottom` on the map container itself inside the query (a container query styles the container's descendants, not the container, which is why the variable goes on the map element and the query on its parent):

  ```css
  .map-shell { container-type: inline-size; }          /* the parent of the map container */

  @container (max-width: 640px) {
    .map-shell .my-map { --elm-drawing-bar-bottom: 72px; }  /* .my-map = the map container element */
  }
  ```

  The bar is portaled into the map container, so it inherits the variable from it. Wider maps keep the default 16 px. With a `drawingBar={{ container }}` slot the bar is not positioned, so this does not apply.
- **A slot of your own.** Pass `drawingBar={{ container }}` with an element you own (a strip under a small form-field map, say) and the bar renders there instead of over the map: static, the full width of that element, with the same theme and dark mode. While `container` is `null` (your ref isn't set yet) nothing shows, so the bar never flashes in the map first. Presses on it never reach the map or your own handlers up the tree.
- **Narrow maps.** When the map container (or your slot) is narrower than 420 px, the bar switches to a compact layout on its own: the hint on one line, cut with an ellipsis (the full text is in its `title`), the buttons on one row and, for a finger, 44 px tall. Wider maps are unchanged.

```tsx check=false
const [slot, setSlot] = useState<HTMLDivElement | null>(null)

// ...in the render:
<ElementEditorControls map={map} drawingBar={{ container: slot }} />
<div ref={setSlot} /> {/* the bar renders here */}
```

To replace it, pass `drawingBar={false}` and render `<ActiveDrawingToolbar />` in your layout (as the examples below do) or build your own. A bar of your own over the map needs to stop `mousedown`, `touchstart`, `click` and `dblclick` from reaching it, or taps on it become map clicks.

---

## Leaflet pattern

With react-leaflet, `ElementEditorControls` must be a **child of `MapContainer`** (it uses `useMap()` internally). The `@element-editor/ui` panels are ordinary HTML overlays, so render them **outside `MapContainer`**, as siblings of the map inside one positioning wrapper. Inside `MapContainer` they would sit in Leaflet's map container, where Leaflet handles their clicks, drags and scrolls as map gestures.

The data table and the modals are lazy-loaded, so they must be wrapped in `<Suspense>`. Give each its own boundary: a shared one unmounts the already-loaded siblings while a new one loads.

```tsx
import { Suspense, useCallback, useRef, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import type { ElementEditorControlsRef } from '@element-editor/adapter-leaflet'
import type { FeatureCollection } from '@element-editor/core'
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
  useShortcutConfig,
} from '@element-editor/ui'
import '@element-editor/adapter-leaflet/style.css'

// Store-connected bottom bar: reads and toggles modal and panel state
function BottomBar() {
  const toggleTable = useUIStore((s) => s.toggleTable)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)
  const settingsOpen = useUIStore((s) => s.settingsModalOpen)
  const setSettingsOpen = useUIStore((s) => s.setSettingsModalOpen)
  const { getKey } = useShortcutConfig()

  return (
    <div style={{ position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)', left: 16, zIndex: 400, display: 'flex', gap: 8 }}>
      <FitBoundsButton />
      <button onClick={toggleTable}>
        Table ({getKey('toggle-table').toUpperCase()})
      </button>
      <button onClick={toggleSchema}>Schema</button>
      <button onClick={toggleCode}>GeoJSON</button>
      <button onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button>
    </div>
  )
}

// The schema and GeoJSON modals render whenever they're mounted, so mount them only while open
function Modals() {
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

export default function MyLeafletMap() {
  const controlsRef = useRef<ElementEditorControlsRef>(null)
  const [mapReady, setMapReady] = useState(false)

  const handleChange = useCallback((data: FeatureCollection) => {
    console.log('changed', data)
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <ThemeContext.Provider value="light">
          {/* data-elm-theme scopes ElementEditor's styles and keyboard shortcuts */}
          <div
            data-elm-theme="light"
            // overflow: hidden: the collapsed layers panel waits just outside the right edge.
            style={{ position: 'relative', width: '100%', height: '600px', overflow: 'hidden' }}
          >
            {/* The map — fills the container via position:absolute */}
            <MapContainer
              center={[48.86, 2.35]}
              zoom={5}
              style={{ position: 'absolute', inset: 0, zIndex: 0 }}
              zoomControl={false}
              whenReady={() => setMapReady(true)}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {/* ElementEditorControls MUST be inside MapContainer. */}
              {mapReady && (
                <ElementEditorControls
                  drawingBar={false} // the layout below mounts its own <ActiveDrawingToolbar />
                  ref={controlsRef}
                  onChange={handleChange}
                />
              )}
            </MapContainer>

            {/*
              All UI panels live OUTSIDE MapContainer, positioned absolutely
              over the map. They read state from GeoStoreProvider, not from
              the Leaflet map context.
            */}
            {mapReady && (
              <>
                {/* Drawing tool selector — top-center */}
                <FloatingToolbar />

                {/* Edit actions (boolean ops, transform, delete) — bottom-center */}
                <div style={{
                  position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)',
                  left: '50%', transform: 'translateX(-50%)',
                  zIndex: 400, display: 'flex', gap: 8,
                }}>
                  <EditingToolbar />
                  <ActiveDrawingToolbar />
                </div>

                {/* Custom bottom-left bar */}
                <BottomBar />

                {/* Right sidebar — feature list, groups, schema selector */}
                <LayersPanel />

                {/* Lazy-loaded: data table and modals */}
                <Suspense fallback={null}><DataTablePanel /></Suspense>
                <Suspense fallback={null}><ShortcutsModal /></Suspense>
                <Suspense fallback={null}><SettingsModal /></Suspense>
                <Modals />
              </>
            )}
          </div>
        </ThemeContext.Provider>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

---

## MapLibre pattern

With the MapLibre adapter, `ElementEditorControls` renders no HTML to the DOM — it only adds GL sources and layers to the map canvas. Its `children` render in place in the React tree, inside the adapter's own `MapControllerProvider`, which gives them fly-to and fit-bounds.

Pass `@element-editor/ui` components as `children` of `ElementEditorControls`:

```tsx
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import type { ElementEditorControlsRef } from '@element-editor/adapter-maplibre'
import type { FeatureCollection } from '@element-editor/core'
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
  useShortcutConfig,
} from '@element-editor/ui'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@element-editor/adapter-maplibre/style.css'

// Store-connected bottom bar: reads and toggles modal and panel state
function BottomBar() {
  const toggleTable = useUIStore((s) => s.toggleTable)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)
  const settingsOpen = useUIStore((s) => s.settingsModalOpen)
  const setSettingsOpen = useUIStore((s) => s.setSettingsModalOpen)
  const { getKey } = useShortcutConfig()

  return (
    <div style={{ position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)', left: 16, zIndex: 400, display: 'flex', gap: 8 }}>
      <FitBoundsButton />
      <button onClick={toggleTable}>
        Table ({getKey('toggle-table').toUpperCase()})
      </button>
      <button onClick={toggleSchema}>Schema</button>
      <button onClick={toggleCode}>GeoJSON</button>
      <button onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button>
    </div>
  )
}

// The schema and GeoJSON modals render whenever they're mounted, so mount them only while open
function Modals() {
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

export default function MyMapLibreMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const controlsRef = useRef<ElementEditorControlsRef>(null)
  const [mapReady, setMapReady] = useState(false)

  const handleChange = useCallback((data: FeatureCollection) => {
    console.log('changed', data)
  }, [])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
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

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
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
            {/* The MapLibre canvas fills the container */}
            <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

            {/*
              ElementEditorControls adds GL sources/layers to the map.
              It renders no HTML itself — its children render in place,
              inside the adapter's MapControllerProvider.
            */}
            {mapReady && mapRef.current && (
              <ElementEditorControls
                drawingBar={false}
                ref={controlsRef}
                map={mapRef.current}
                onChange={handleChange}
              >
                {/* Drawing tool selector */}
                <FloatingToolbar />

                {/* Edit action buttons */}
                <div style={{
                  position: 'absolute', bottom: 'calc(var(--elm-table-offset, 0px) + 16px)',
                  left: '50%', transform: 'translateX(-50%)',
                  zIndex: 400, display: 'flex', gap: 8,
                }}>
                  <EditingToolbar />
                  <ActiveDrawingToolbar />
                </div>

                <BottomBar />
                <LayersPanel />
                <Suspense fallback={null}><DataTablePanel /></Suspense>
                <Suspense fallback={null}><ShortcutsModal /></Suspense>
                <Suspense fallback={null}><SettingsModal /></Suspense>
                <Modals />
              </ElementEditorControls>
            )}
          </div>
        </ThemeContext.Provider>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

---

## Why the patterns differ

react-leaflet gives components inside `MapContainer` access to the map through React context, and renders them inside the map's own container element. `ElementEditorControls` needs that context, so it goes inside. HTML panels are better outside, where Leaflet doesn't treat their clicks, drags and scrolls as map gestures. They get everything they need from `GeoStoreProvider` and `ElementEditorUIProvider`.

MapLibre GL has no React integration at all. `ElementEditorControls` holds a reference to the raw `maplibregl.Map` instance and passes it around imperatively. There's no React context conflict, so `children` work as you'd expect.

---

## Reading store state from your own UI

Any component inside `GeoStoreProvider` can read Element's two stores: `useDataStore` holds features, schemas, groups, and the current selection; `useUIStore` holds panel state, editing mode, and modal flags.

```tsx
import { useDataStore, useUIStore } from '@element-editor/ui'

function SaveButton({ onSave }: { onSave: () => void }) {
  // Features and selection both live in the data store
  const count = useDataStore((s) => s.features.length)
  const selectedIds = useDataStore((s) => s.selectedIds)
  // Panel/modal state lives in the UI store
  const tableOpen = useUIStore((s) => s.tableOpen)

  return (
    <button onClick={onSave}>
      Save {count} {count === 1 ? 'feature' : 'features'}
      {selectedIds.length > 0 && ` (${selectedIds.length} selected)`}
      {tableOpen && ' • table open'}
    </button>
  )
}
```

Both stores are typed — selectors get full autocomplete on every field.

---

## Reading keyboard shortcut bindings

Display the current key binding for any action using `useShortcutConfig`:

```tsx
import { useShortcutConfig } from '@element-editor/ui'

function TableButton() {
  const { getKey } = useShortcutConfig()
  const key = getKey('toggle-table').toUpperCase()

  return <button>Data table ({key})</button>
}
```

This reflects the user's current binding — including any custom remapping they've done via the shortcuts panel.

---

## Matching the editor's button style

The bottom-bar examples above use raw `<button>` elements for brevity. To get the same 48×48 card look as `FitBoundsButton`, wrap your icons with `IconButton`:

```tsx
import { IconButton, FitBoundsButton, ZoomIndicator, LocateButton } from '@element-editor/ui'
import { Table } from '@phosphor-icons/react'

<div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
  <FitBoundsButton />
  <LocateButton />        {/* "Fly to my location" — uses navigator.geolocation */}
  <ZoomIndicator />        {/* Click-to-edit current zoom level */}
  <IconButton label="Table" onClick={toggleTable} active={tableOpen}>
    <Table size={24} />
  </IconButton>
</div>
```

`IconButton` is Tooltip-wrapped, supports `active`/`disabled` states, and accepts any children (icon, SVG, emoji, or text). While `active`, a Phosphor icon child is drawn with its filled weight in the accent colour, which is how the editor marks buttons whose window or panel is open. `ZoomIndicator` and `LocateButton` route their errors through the event channel. Pass `onEvent` to `ElementEditorUIProvider` if you need to surface them somewhere other than the editor's default toast.

Clicking `ZoomIndicator` opens the zoom input with the caret at the end; the `Z` shortcut opens it with the number selected, so typing replaces it.

Use inline styles or your own CSS for your layout wrappers. Element's stylesheet only contains the utility classes its own components use, so Tailwind classes in your code aren't guaranteed to exist unless your app compiles Tailwind itself.

---

## Headless export and drop hooks

Two hooks let you build your own import/export UI without touching the built-in modals.

`useGeoJSONExport` returns three callbacks: `exportToFile()` triggers a browser download, `exportToString()` returns the serialized GeoJSON, `exportToBlob()` returns a `Blob` you can pipe to `fetch`, `navigator.share`, or a Worker.

```tsx
import type { RefObject } from 'react'
import { useGeoJSONExport } from '@element-editor/ui'
import { toast } from 'sonner' // your app's own sonner, with your own <Toaster />
import type { ElementEditorControlsRef } from '@element-editor/adapter-leaflet'

function ExportButton({ controlsRef }: { controlsRef: RefObject<ElementEditorControlsRef | null> }) {
  const { exportToFile } = useGeoJSONExport({
    getFeatureCollection: () => controlsRef.current?.getFeatureCollection(),
    filename: (fc) => `map-${fc.features.length}-features`,
    onExport: (_fc, file) => toast.success(`Saved ${file.name}`),
    onError: (err) => toast.error(err.kind === 'empty' ? 'Nothing to export' : 'Export failed'),
  })

  return <button onClick={exportToFile}>Download GeoJSON</button>
}
```

`useGeoJSONDrop` returns react-dropzone-style prop getters plus a programmatic `open()` to trigger the native file picker. Spread `getRootProps()` onto any host element and `getInputProps()` onto a hidden `<input type="file">` to accept dropped or picked `.geojson` / `.json` files. The hook parses the file but never imports it — route the parsed `FeatureCollection` wherever you want.

```tsx
import type { RefObject } from 'react'
import { useGeoJSONDrop } from '@element-editor/ui'
import { toast } from 'sonner'
import type { ElementEditorControlsRef } from '@element-editor/adapter-leaflet'

function DropZone({ controlsRef }: { controlsRef: RefObject<ElementEditorControlsRef | null> }) {
  const { getRootProps, getInputProps, isDragActive, open } = useGeoJSONDrop({
    onImport: (fc) => controlsRef.current?.importGeoJSON(fc, 'merge'),
    onError: (err) => toast.error(err.kind === 'wrong-type' ? 'Need .geojson' : 'Could not parse'),
  })

  return (
    <div {...getRootProps()} style={{ outline: isDragActive ? '2px solid #3b82f6' : undefined }}>
      Drop a .geojson file here, or <button onClick={open}>browse</button>
      <input {...getInputProps()} />
    </div>
  )
}
```

The host element must keep `pointer-events: auto` — `pointer-events: none` blocks `dragenter`/`dragover` too.

---

## What's next

- [Reference: @element-editor/ui](../reference/element-editor-ui.md) — full component, provider, and hook reference
- [Reference: adapter-leaflet](../reference/adapter-leaflet.md)
- [Reference: adapter-maplibre](../reference/adapter-maplibre.md)
- [Theming](./theming.md) — applying dark mode and brand colors with `ThemeContext`
