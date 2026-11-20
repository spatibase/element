# Quick start: @element-editor/react

*A complete map editor in your React app — no map setup required. Estimated time: ~5 minutes.*

`@element-editor/react` is the self-contained package. It owns its own MapLibre map and brings everything: built-in basemaps with a picker, drawing tools, sidebar, data table, import/export, and keyboard shortcuts. Drop it in, give it a container, wire up `onChange`.

> **Configure visually first?** [Open the playground](https://elementeditor.dev/playground) — tweak every setting in a sidebar, watch the editor update live, copy the resulting `<ElementEditor>` snippet straight into your app.

---

## Step 1 — Install

```bash
npm install @element-editor/react maplibre-gl
```

`@element-editor/react` is built on MapLibre GL JS. Install `maplibre-gl` next to it: it is marked as an optional peer dependency only so that Leaflet-only apps can skip it, but the default entry needs it. You also need React.

| Package | Supported versions |
|---|---|
| `react` | `^19.2` |
| `react-dom` | `^19.2` |
| `maplibre-gl` | 5.5 or 6 |

React 18 is not supported. If your app is on an older React 19, upgrade it first; npm otherwise stops with a peer dependency conflict (`ERESOLVE`). Apps made with Next.js 15's `create-next-app` pin React 19.1:

```bash
npm install react@^19.2 react-dom@^19.2
```

---

## Step 2 — Import the CSS

Add this import once, near your app entry point (`main.tsx`, `App.tsx`, or your global CSS file):

```tsx
import '@element-editor/react/style.css'
```

> **Warning:** If you skip this import, the map renders without its controls and panels are unstyled. The stylesheet bundles `maplibre-gl.css`, so you don't need to import that yourself.

The stylesheet only styles the editor. It doesn't reset your page's headings, buttons or other elements.

---

## Step 3 — Add the component

The component fills its container. The parent element needs an explicit height. (In Next.js or any SSR framework, render it client-only; see [Using Element with Next.js](../guides/nextjs.md).)

```tsx
import { ElementEditor } from '@element-editor/react'
import '@element-editor/react/style.css'

export default function App() {
  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ElementEditor onChange={(data) => console.log(data)} />
    </div>
  )
}
```

That's it. You now have a working map editor: drawing tools (point, line, area, rectangle, circle, freehand, route, and a picker that imports shapes from OpenStreetMap), vertex editing, transform, snapping, boolean operations, schema-driven property forms, a spreadsheet-style data table, a two-way GeoJSON inspector, 25-step undo/redo, and keyboard shortcuts. Every drawing tool is keyed: `P` point, `L` line, `G` area, `R` rectangle, `O` circle, `F` freehand, `C` route, `X` picker, `M` measure. Other shortcuts include `T` (data table), `A` (transform), `S` (schema), `I` (GeoJSON) and `/` (layers panel). Press `K` to see the full list.

---

## Step 4 — Wire up data persistence

`onChange` fires after every committed change and delivers the full `FeatureCollection`. Connect it to wherever you store data:

```tsx
import { ElementEditor } from '@element-editor/react'
import type { FeatureCollection } from '@element-editor/react'
import '@element-editor/react/style.css'

export default function App() {
  function handleChange(data: FeatureCollection) {
    // data is a valid GeoJSON FeatureCollection.
    // Send it to your API, store it in state, or write it to localStorage.
    localStorage.setItem('my-map', JSON.stringify(data))
  }

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ElementEditor onChange={handleChange} />
    </div>
  )
}
```

---

## Common variations

### Loading existing data

Pass a GeoJSON `FeatureCollection` to `initialData`. It is the starting data: applied on mount (or, if it is still `null` then, once when it arrives, as long as the user hasn't edited), without an undo step and without firing `onChange`. Later changes to the prop are ignored; replace the data with `ref.setFeatureCollection()`.

```tsx
import { ElementEditor } from '@element-editor/react'

const savedData = JSON.parse(localStorage.getItem('my-map') ?? 'null')

<ElementEditor
  initialData={savedData}
  onChange={(data) => localStorage.setItem('my-map', JSON.stringify(data))}
/>
```

### Where the map starts

On a first visit the map fits `initialData`; after that it reopens where the user left it. Set `initialView` to choose yourself, `mapOptions` for extra map options and `onMapReady` to add your own layers once the map exists:

```tsx
import { ElementEditor } from '@element-editor/react'

<ElementEditor
  initialView={{ center: [14.42, 50.09], zoom: 12 }}  // or { bounds: [w, s, e, n] } or 'data'
  mapOptions={{ maxZoom: 19 }}
  onMapReady={(map) => {
    map.addSource('districts', { type: 'geojson', data: '/districts.geojson' })
    map.addLayer({ id: 'districts', type: 'line', source: 'districts' })
  }}
/>
```

See [Setting up the map](../reference/element-editor-react.md#setting-up-the-map).

### Restricting which tools are available

Pass a `tools` array. Only the listed tools appear in the toolbar, and keyboard shortcuts for the others are suppressed.

```tsx
import { ElementEditor } from '@element-editor/react'

<ElementEditor
  tools={['polygon', 'line', 'point']}
  onChange={(data) => console.log(data)}
/>
```

The tool names (`DrawTool`; `'polygon'` is the **Area** tool):

```ts
type DrawTool =
  | 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route'
  | 'picker' | 'measure' | 'search'
```

Everything you don't list is hidden, including the picker, measure and the search box (see [Restricting tools](../guides/restricting-tools.md)).

### Read-only mode

`readonly` disables all drawing and editing. Features remain visible and selectable — useful for displaying saved data without allowing modifications.

```tsx
import { ElementEditor } from '@element-editor/react'

const savedData = JSON.parse(localStorage.getItem('my-map') ?? 'null')

<ElementEditor
  readonly
  initialData={savedData}
/>
```

### Layout

`layout` chooses how the panels arrange around the map.

```tsx
import { ElementEditor } from '@element-editor/react'

<ElementEditor layout="panel" />    // default — sidebar docked on the right
<ElementEditor layout="minimal" />  // edit form opens in a modal on selection
<ElementEditor layout="split" />    // data table and layers panel side by side in a bottom panel
```

### Basemaps

The default basemap is `'auto'`: light Streets in a light editor, Dark in a dark editor. A picker in the bottom-left corner lets users switch between Streets, Terrain, Light, Dark and OpenStreetMap, and their choice is remembered.

```tsx
import { ElementEditor } from '@element-editor/react'

<ElementEditor defaultBasemap="terrain" />  // starting basemap
<ElementEditor basemaps={false} />          // no picker
```

See the [Basemaps guide](../guides/basemaps.md) for custom styles and self-hosting.

### Moving a control

Every button has a place in `config.ui.layout`. `withLayout` moves or hides a few and keeps the rest of the default layout:

```tsx
import { ElementEditor, withLayout } from '@element-editor/react'

<ElementEditor config={{ ui: { layout: withLayout({ move: { table: 'topRight' }, hide: ['keyboard'] }) } }} />
```

See [Configuring layout](../guides/configuring-layout.md).

### Going to production

Out of the box the editor uses free public services: OpenFreeMap and Mapterhorn for basemaps, Overpass for the picker, the OSRM demo server for the Route tool (car-only, not for production) and Nominatim for search. Point them at your own servers or keys with `config.network`, and send failures to your error tracking with `onError`:

```tsx
import { ElementEditor } from '@element-editor/react'

<ElementEditor
  config={{ network: { routing: { apiKey: 'your-openrouteservice-key' }, nominatim: { email: 'maps@example.com' } } }}
  onError={(e) => console.error(e.code, e.source, e.message)}
/>
```

See [Third-party services and self-hosting](../guides/third-party-services.md) and [`onError`](../reference/events.md#onerror).

### Leaflet drop-in

Prefer Leaflet? The same component is available from `@element-editor/react/leaflet`. Its peers are optional, so install them yourself (no `maplibre-gl` needed):

```bash
npm install @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet
npm install -D @types/leaflet # TypeScript: leaflet ships no types of its own
```

```tsx
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css' // includes Leaflet's CSS
```

The API is the same, except that `tileLayer` and `renderer` are Leaflet-only and basemaps are raster-only (an optional `basemaps` list). Both entries share the same types (`import type { FeatureCollection } from '@element-editor/react'` works for either).

### Using the ref API

If you need to trigger actions imperatively — saving on a button click, flying to a location, or exporting a file — attach a ref:

```tsx
import { useRef } from 'react'
import { ElementEditor } from '@element-editor/react'
import type { ElementEditorRef } from '@element-editor/react'

export default function App() {
  const ref = useRef<ElementEditorRef>(null)

  function handleSave() {
    const data = ref.current?.getFeatureCollection()
    if (data) localStorage.setItem('my-map', JSON.stringify(data)) // or send it to your API
  }

  function addHome() {
    const f = ref.current?.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.86] }, properties: { name: 'Home' } })
    if (f) ref.current?.select([f.id], { fit: true })
  }

  return (
    <>
      <div style={{ width: '100%', height: '600px' }}>
        <ElementEditor ref={ref} />
      </div>
      <button onClick={handleSave}>Save</button>
      <button onClick={addHome}>Add home</button>
      <button onClick={() => ref.current?.setTool('polygon')}>Draw an area</button>
    </>
  )
}
```

The `ElementEditorRef` interface (see the [reference](../reference/element-editor-react.md#elementeditorref) for details):

```ts
interface ElementEditorRef {
  getFeatureCollection: () => FeatureCollection                       // current data as an object
  setFeatureCollection: (data: FeatureCollectionInput) => void             // replace the dataset
  exportGeoJSON: () => string                                         // current data as GeoJSON text
  exportAs: (format: 'geojson') => void                               // trigger a file download
  importGeoJSON: (raw: unknown, mode?: 'replace' | 'merge') => ImportResult
  addFeature: (feature: GeoJSONFeatureInput, options?) => GeoJSONFeature | null  // the stored feature (with id), or null
  updateFeature: (id: string, patch: FeaturePatch, options?) => boolean
  updateFeatures: (updates: { id: string; patch: FeaturePatch }[], options?) => void  // one commit, one undo step
  removeFeatures: (ids: string[], options?) => number                 // how many were removed
  getSelection: () => string[]
  select: (ids: string[], options?: { fit?: boolean }) => void        // fit: zoom to the selection
  setTool: (tool: DrawTool | null) => boolean                         // null exits; false if unavailable
  setVertexEdit: (id: string | null) => boolean                       // edit a line's / area's points; null leaves
  getMap: () => maplibregl.Map | null                                 // L.Map on /leaflet; null until mounted
  getBasemap: () => BasemapInput                                      // the current basemap choice
  setBasemap: (basemap: BasemapInput) => void                         // switch like a user pick
  flyTo: (options: { center: [number, number]; zoom?: number }) => void  // center is [lng, lat]
  setZoom: (zoom: number) => boolean                                  // false if the map isn't ready
  fitBounds: (target: [number, number][] | [number, number, number, number]) => void
  submit: () => boolean                                               // validate, then onSubmit or onValidationError
  undo: () => void
  redo: () => void
  clearSelection: () => void
}
```

Use `importGeoJSON` to swap datasets at runtime without remounting the editor (which would reset zoom, selection, and undo history). `mode` defaults to `'replace'`; pass `'merge'` to append. `submit()` runs validation and either calls `onSubmit` with a clean FeatureCollection or fires `onValidationError`.

---

## What's next

- [Component reference](../reference/element-editor-react.md) — every prop, event, and ref method documented
- [Events guide](../reference/events.md) — when to use `onChange` vs granular events vs the ref API
- [Theming](../guides/theming.md) — match the editor to your product's visual identity
- [Persisting data](../guides/persisting-data.md) — patterns for localStorage, REST APIs, and real-time sync
- [Restricting tools](../guides/restricting-tools.md) — control the full editor surface, including `maxFeatures` and `readonly`
