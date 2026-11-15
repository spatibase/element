# @element-editor/react: guide for coding agents

Element is a React map editor for GeoJSON: drawing tools, vertex editing, snapping, boolean ops, a schema-driven property form, a data table and a GeoJSON inspector. This package is the drop-in `<ElementEditor />`: it creates and owns the map. Everything below is checked against the types in `dist/*.d.ts`; when in doubt, those win.

Full docs: https://elementeditor.dev/docs. For agents: https://elementeditor.dev/llms.txt (index) and https://elementeditor.dev/llms-full.txt (all docs in one file). Every docs page is also served as markdown at the same URL plus `.md` (e.g. https://elementeditor.dev/docs/guides/basemaps.md).

## Pick the package

| Situation | Import from | Map engine |
|---|---|---|
| No map yet, want a complete editor (default choice) | `@element-editor/react` | MapLibre GL, created by Element |
| No map yet, must be Leaflet | `@element-editor/react/leaflet` | Leaflet, created by Element |
| Existing `maplibregl.Map` (also MapTiler SDK; Mapbox GL with an `as any` cast) | `@element-editor/adapter-maplibre` + `@element-editor/ui` | yours |
| Existing react-leaflet `MapContainer` | `@element-editor/adapter-leaflet` + `@element-editor/ui` | yours |
| Types, stores, helpers only (no UI) | `@element-editor/core` | none |

The adapters render no buttons; you place toolbars and panels from `@element-editor/ui` yourself. Each adapter package has its own `AGENTS.md`. Pick MapLibre unless you need Leaflet: the Leaflet drop-in has raster basemaps only.

## Install

React and React DOM `^19.2` are required everywhere (React 18 is not supported). The engine peers are optional peers, so npm/pnpm will not install them for you.

| Entry | pnpm | npm |
|---|---|---|
| `@element-editor/react` | `pnpm add @element-editor/react maplibre-gl` | `npm install @element-editor/react maplibre-gl` |
| `@element-editor/react/leaflet` | `pnpm add @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet` | `npm install @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet` |
| MapLibre adapter | `pnpm add @element-editor/adapter-maplibre @element-editor/ui maplibre-gl` | `npm install @element-editor/adapter-maplibre @element-editor/ui maplibre-gl` |
| Leaflet adapter | `pnpm add @element-editor/adapter-leaflet @element-editor/ui leaflet react-leaflet` | `npm install @element-editor/adapter-leaflet @element-editor/ui leaflet react-leaflet` |

| Peer | Range |
|---|---|
| `react`, `react-dom` | `^19.2.0` |
| `maplibre-gl` | `^5.5.0` (default entry, MapLibre adapter) |
| `leaflet` | `^1.9.0` (`/leaflet` entry, Leaflet adapter) |
| `react-leaflet` | `^5.0.0` (`/leaflet` entry, Leaflet adapter) |

`@element-editor/react` brings `@element-editor/core`, `@element-editor/ui` and `@element-editor/adapter-maplibre` as dependencies and re-exports the common types, so you rarely import those directly. With pnpm, add any `@element-editor/*` package you import from to your own `package.json`, on the same version.

## CSS

Import exactly one stylesheet, once (app entry or root layout). The JS entries import no CSS.

| Entry | Stylesheet | Includes the engine's CSS |
|---|---|---|
| `@element-editor/react` | `@element-editor/react/style.css` | yes (`maplibre-gl.css`) |
| `@element-editor/react/leaflet` | `@element-editor/react/leaflet/style.css` | yes (`leaflet.css`) |
| `@element-editor/adapter-maplibre` | `@element-editor/adapter-maplibre/style.css` | no: also import `maplibre-gl/dist/maplibre-gl.css` |
| `@element-editor/adapter-leaflet` | `@element-editor/adapter-leaflet/style.css` | yes (`leaflet.css`) |

The stylesheets do not reset your page; base styles apply only inside `[data-elm-theme]` (the drop-ins set it on their root). Mixing them up (MapLibre component + Leaflet stylesheet) gives a broken map with no error.

## Theming

`theme` is the mode only. Everything visual is CSS variables on the editor root (`[data-elm-theme]`), per mode, through your stylesheet or `style`; Element copies them onto its portals (modals, menus, tooltips, toasts) itself. Never restyle Tailwind class names.

- Brand: `--elm-accent` (or the `accentColor` prop) derives every accent shade; `--elm-primary-50…950` pins one.
- Design tokens: `--elm-font`, `--elm-font-mono`, `--elm-radius` (containers, 12px), `--elm-radius-control` (buttons/inputs, 6px), `--elm-shadow`, `--elm-shadow-raised`, `--elm-shadow-control`, `--elm-surface`, `--elm-surface-raised`, `--elm-surface-sunken`, `--elm-surface-hover`, `--elm-control-hover`, `--elm-text`, `--elm-text-secondary`, `--elm-text-muted`, `--elm-text-subtle`, `--elm-text-disabled`, `--elm-border`, `--elm-border-subtle`, `--elm-border-strong`, `--elm-focus-ring`, `--elm-tooltip`, `--elm-tooltip-text`.
- Rows (layers list + data table, opaque): `--elm-row-hover`, `--elm-row-selected`, `--elm-row-selected-hover`, `--elm-row-checked`, `--elm-row-checked-hover`.
- Map features are props, not tokens: `featureColor`, `getFeatureStyle`.

```css
.brand-editor[data-elm-theme] { --elm-accent: #c0582b; --elm-radius: 16px; --elm-font: "Inter", sans-serif; }
.brand-editor[data-elm-theme="light"] { --elm-surface: #fbf6ee; --elm-text: #3b2a1e; --elm-border: #e5d6c0; }
.brand-editor[data-elm-theme="dark"] { --elm-surface: #2a211b; --elm-text: #f6ece0; --elm-border: #4a3b30; }
```

```tsx
import { ElementEditor } from '@element-editor/react'

<ElementEditor className="brand-editor" />
// or inline, one value for both modes:
<ElementEditor style={{ '--elm-surface': '#fbf6ee', '--elm-text': '#3b2a1e' }} />
```

Defaults and roles: https://elementeditor.dev/docs/guides/theming

## Minimal examples

The editor root is `width: 100%; height: 100%` of its parent: the parent needs a real height.

### MapLibre drop-in (default)

```tsx
import { ElementEditor, type FeatureCollection } from '@element-editor/react'
import '@element-editor/react/style.css'

const saved = localStorage.getItem('my-map')

export default function App() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ElementEditor
        initialData={saved ? (JSON.parse(saved) as FeatureCollection) : null}
        initialView={{ center: [14.42, 50.09], zoom: 12 }} // [lng, lat]
        onChange={(data) => localStorage.setItem('my-map', JSON.stringify(data))}
      />
    </div>
  )
}
```

### Leaflet drop-in

Same component API; `tileLayer`, `renderer` and raster-only `basemaps` are Leaflet-specific.

```tsx
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css'

export default function App() {
  return (
    <div style={{ width: '100%', height: 600 }}>
      <ElementEditor
        initialView={{ center: [2.35, 48.86], zoom: 11 }} // still [lng, lat]
        onChange={(data) => console.log(data.features.length)}
      />
    </div>
  )
}
```

### Existing MapLibre map (adapter)

Needs `ElementEditorUIProvider` (throws without it), one `GeoStoreProvider` per editor, and a `data-elm-theme` element around the map. `ElementEditorControls` adds layers to your map and renders no visible UI; pass `@element-editor/ui` components as its `children` to get toolbars and panels (see `node_modules/@element-editor/adapter-maplibre/AGENTS.md`).

```tsx
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86],
      zoom: 5,
    })
    m.on('load', () => setMap(m))
    return () => { setMap(null); m.remove() }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', width: '100%', height: 600 }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          {map && <ElementEditorControls map={map} onChange={(data) => console.log(data)} />}
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

### Existing Leaflet map (adapter)

Same three wrappers (`ElementEditorUIProvider`, `GeoStoreProvider`, `data-elm-theme` element), imported from `@element-editor/adapter-leaflet`, with `@element-editor/adapter-leaflet/style.css` (includes Leaflet's CSS). `ElementEditorControls` takes no `map` prop: render it as a child of react-leaflet's `MapContainer` (it calls `useMap()`), and render `@element-editor/ui` panels outside `MapContainer`. `MapContainer center` is `[lat, lng]`. Full example: `node_modules/@element-editor/adapter-leaflet/AGENTS.md`.

## Next.js (App Router)

All entries start with `'use client'`, but the map libraries still need the DOM (Leaflet touches `window` on import). Rules:

1. Load the editor with `next/dynamic` and `ssr: false`, inside a `'use client'` component (`ssr: false` is not allowed in Server Components).
2. Import the stylesheet in `app/layout.tsx`, not in the dynamically loaded component.
3. `react`/`react-dom` `^19.2`; works with Next.js 15 and 16. No `transpilePackages`, worker or webpack config needed. Do not override `react-data-grid` (pinned to `7.0.0-beta.57` for Next.js 15).

```tsx
// app/components/MapEditor.tsx
'use client'

import dynamic from 'next/dynamic'

const ElementEditor = dynamic(
  () => import('@element-editor/react').then((m) => m.ElementEditor), // or '@element-editor/react/leaflet'
  { ssr: false, loading: () => <div style={{ height: '100vh' }}>Loading map...</div> },
)

export default function MapEditor() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ElementEditor onChange={console.log} />
    </div>
  )
}
```

```tsx
// app/layout.tsx
import '@element-editor/react/style.css' // '@element-editor/react/leaflet/style.css' for the Leaflet entry

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

If you need a ref, `onMapReady`, or an adapter, write your own client component that imports Element statically and load that whole module with `dynamic(() => import('./ProjectEditor'), { ssr: false })`. Pages Router: same `dynamic` call, CSS in `pages/_app.tsx`.

## Loading and saving data

- `initialData` (`FeatureCollectionInput | GeoJSONFeatureInput | null`) is applied once: at mount, or, if it is `null`/`undefined`/empty at mount, the first time it becomes data while the editor is still empty and unedited (so `fetch` → `setState` → `initialData={data}` works). Later changes are ignored, with a dev warning. Loading it never fires `onChange`. Standard `@types/geojson` data type-checks (3D positions, 6-number bbox, `GeometryCollection`; null-geometry features are skipped and reported via `onError`). A plain RFC 7946 collection is fine: missing ids get UUIDs, a single Feature is wrapped. Invalid input reports an `'invalid-data'` error and the editor starts empty.
- Data that arrives after mount: render the editor once it has loaded (`data ? <ElementEditor initialData={data} /> : <Spinner />`), pass it as `initialData` once it arrives (see above), or call `ref.current?.setFeatureCollection(data, { silent: true })` (replace; keeps zoom; one undo step, or `undoable: false` to start a fresh history; `silent` skips `onChange`/`onFeature*` so loading from your backend doesn't echo a save). `ref.current?.importGeoJSON(data, 'merge')` appends.
- Clean slate for another project: remount with `key={projectId}`.
- Saving: `onChange(data: FeatureCollection)` fires after every committed edit (once at the end of a drag, not during it) with the full collection, including `metadata.schemas` / `metadata.groups`. Store it as is and pass it back as `initialData`.
- Large datasets: `onFeatureAdd` / `onFeatureUpdate` / `onFeatureDelete` give per-feature deltas.
- Save button instead of autosave: pass `onSubmit` (renders an "Apply changes" button; `onValidationError` gets schema errors keyed by feature id), or read `ref.current?.getFeatureCollection()` from your own button.

```tsx
import { useRef } from 'react'
import { ElementEditor, type ElementEditorRef, type FeatureCollectionInput } from '@element-editor/react'
import '@element-editor/react/style.css'

export function ProjectEditor({ initial }: { initial: FeatureCollectionInput | null }) {
  const ref = useRef<ElementEditorRef>(null)

  async function openProject(id: string) {
    const res = await fetch(`/api/projects/${id}`)
    ref.current?.setFeatureCollection((await res.json()) as FeatureCollectionInput, { silent: true })
  }

  async function save() {
    const data = ref.current?.getFeatureCollection()
    if (data) await fetch('/api/projects/current', { method: 'PUT', body: JSON.stringify(data) })
  }

  return (
    <>
      <div style={{ height: 600 }}>
        <ElementEditor ref={ref} initialData={initial} />
      </div>
      <button onClick={() => openProject('42')}>Open</button>
      <button onClick={save}>Save</button>
    </>
  )
}
```

## Ref API

`ElementEditorRef` from `@element-editor/react` (`getMap()` returns `maplibregl.Map`) or from `@element-editor/react/leaflet` (`L.Map`, basemap type `LeafletBasemap`). The adapters' `ElementEditorControlsRef` has the same methods minus `getBasemap`/`setBasemap`. Coordinates are `[lng, lat]`. `flyTo`, `fitBounds` and `select(ids, { fit: true })` frame the target in the part of the map the panels leave visible, so `map.getCenter()` can differ from the requested centre. Data methods work in `readonly` too, run the same store actions as user edits (undo, `maxFeatures`, validation) and fire the callbacks synchronously before returning. Map methods do nothing until the map has mounted.

```ts
interface ElementEditorRef {
  getFeatureCollection: () => FeatureCollection
  getFeature: (id: string) => GeoJSONFeature | null
  setFeatureCollection: (data: FeatureCollectionInput, options?: SetFeatureCollectionOptions) => void // replace
  exportGeoJSON: () => string
  exportAs: (format: 'geojson') => void                                  // browser download
  importGeoJSON: (raw: FeatureCollectionInput | unknown, mode?: 'replace' | 'merge') => ImportResult
  updateFeatures: (updates: ReadonlyArray<{ id: string; patch: FeaturePatch }>, options?: MutationOptions) => void
  addFeature: (feature: GeoJSONFeatureInput, options?: MutationOptions) => GeoJSONFeature | null
  updateFeature: (id: string, patch: FeaturePatch, options?: MutationOptions) => boolean
  removeFeatures: (ids: string[], options?: MutationOptions) => number
  getSelection: () => string[]
  select: (ids: string[], options?: { fit?: boolean }) => void
  setTool: (tool: DrawTool | null) => boolean                            // false if unavailable / readonly
  getTool: () => DrawTool | null                                         // also: onToolChange prop
  getMap: () => TMap | null                                              // null until mounted
  flyTo: {
    (options: FlyToOptions): void                                        // { center: [lng, lat], zoom? }, zoom default 15
    /** @deprecated [lat, lng] tuple */
    (latlng: [number, number], zoom?: number): void
  }
  setZoom: (zoom: number) => boolean                                     // false if the map isn't mounted
  fitBounds: (target: [number, number][] | [number, number, number, number]) => void
  validate: () => ValidationReport                                       // schema check of every feature, no submit
  submit: () => boolean                                                  // validate, then onSubmit or onValidationError
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  clearSelection: () => void
  // drop-ins only:
  getBasemap: () => BasemapInput                                         // LeafletBasemap on /leaflet
  setBasemap: (basemap: BasemapInput) => void                            // fires onBasemapChange
}

type FeaturePatch = Partial<Pick<GeoJSONFeature, 'properties' | 'geometry' | 'schemaId' | 'hidden'>> // properties replaces the whole object
interface MutationOptions { undoable?: boolean }  // default true; false = no undo step, applied to history too (server sync)
interface SetFeatureCollectionOptions { silent?: boolean; undoable?: boolean } // silent default false; undoable default true (false clears history)
interface ValidationReport { valid: boolean; errors: Record<string, string[]> }  // errors keyed by feature id
interface ImportResult { skipped: number; duplicates: number; truncated: boolean }
```

`FeaturePatch` is exported from `@element-editor/core`, not from `@element-editor/react`. `ImportResult`, `MutationOptions`, `SetFeatureCollectionOptions`, `ValidationReport`, `FeatureCollection`, `FeatureCollectionInput`, `GeoJSONFeature`, `GeoJSONFeatureInput`, `GeometryInput`, `Schema`, `DrawTool`, `FlyToOptions`, `BBox` and `BasemapInput` are.

## Events and errors

| Prop | Signature | Fires |
|---|---|---|
| `onChange` | `(data: FeatureCollection) => void` | after every committed change (add, update, delete, undo/redo) |
| `onFeatureAdd` | `(feature: GeoJSONFeature) => void` | once per new feature, after `onChange` |
| `onFeatureUpdate` | `(id: string, feature: GeoJSONFeature) => void` | geometry or properties changed (on commit) |
| `onFeatureDelete` | `(id: string) => void` | once per deleted feature |
| `onSelectionChange` | `(ids: string[]) => void` | selection changed (no `onChange`) |
| `onFeatureSelect` | `(feature: GeoJSONFeature \| null) => void` | single selection; `null` when none or several |
| `onZoomChange` | `(zoom: number) => void` | zoom changed |
| `onSubmit` | `(data: FeatureCollection) => void` | Apply changes / `ref.submit()` with valid data |
| `onValidationError` | `(errors: Record<string, string[]>) => void` | submit blocked by schema errors |
| `onEvent` | `(event: ElementEditorEvent) => void` | every user-facing message; when set, Element shows no toasts. Read once at mount |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | every runtime failure, first |
| `onBasemapChange` | `(basemap) => void` | user picked a basemap or `ref.setBasemap()` |
| `onMapReady` | `(map) => void` | once per map, after Element's layers are on it |
| `onToolChange` | `(tool: DrawTool \| null) => void` | a drawing tool turned on (`null`: off), as `ref.getTool()` reports it |

`ElementEditorEvent['type']`: `'feature:deleted' | 'features:deleted' | 'feature:duplicated' | 'features:duplicated' | 'feature:broken' | 'selection:copied' | 'selection:pasted' | 'undo' | 'redo' | 'error' | 'warning' | 'success'`.

`onError` return value: nothing keeps the built-in toast, `false` suppresses it (and the `onEvent` error event), a string replaces the toast text. `ElementEditorError extends Error` with `code`, `source`, optional `featureId` and `cause`.

| `ErrorCode` | Meaning |
|---|---|
| `network` | request failed (offline, CORS, non-retryable HTTP status, lazy chunk) |
| `rate-limited` | HTTP 429 |
| `busy` | HTTP 502–504 |
| `timeout` | no answer in time (Overpass, geometry worker) |
| `unauthorized` | HTTP 401/403 (bad routing or style key) |
| `invalid-data` | unreadable input/response (bad JSON, not a FeatureCollection, broken style) |
| `too-large` | import file over the size cap |
| `limit-reached` | `maxFeatures` refused or truncated an add |
| `geometry` | geometry operation failed or produced an empty shape |
| `permission-denied` | browser refused geolocation / clipboard / file save |
| `unsupported` | missing browser or map capability |
| `crash` | render crash; the error boundary shows its fallback |
| `unknown` | anything else |

`ErrorSource`: `'basemap' | 'picker' | 'routing' | 'search' | 'import' | 'export' | 'clipboard' | 'geometry' | 'locate' | 'editor'`.

```tsx
import { ElementEditor, type ElementEditorError } from '@element-editor/react'

export function Editor() {
  function handleError(e: ElementEditorError) {
    console.error(e.code, e.source, e.message)
    if (e.code === 'limit-reached') return false // show your own UI instead of the toast
  }
  return <div style={{ height: 600 }}><ElementEditor maxFeatures={100} onError={handleError} /></div>
}
```

Docs: https://elementeditor.dev/docs/reference/events

## Props

Shared by both drop-ins (`ElementEditorBaseProps`):

| Prop | Type | Notes |
|---|---|---|
| `initialData` | `FeatureCollectionInput \| GeoJSONFeatureInput \| null` | starting data: at mount, or once when it first arrives while the editor is empty and unedited; later changes ignored (see Loading and saving data) |
| `initialView` | `{ center: [lng, lat]; zoom: number } \| { bounds: BBox } \| 'data'` | read once; wins over the remembered view |
| `schema` | `Schema` | `{ id, name, fields: SchemaField[] }` |
| `tools` | `DrawTool[]` | omit for all: `'polygon' (Area tool) \| 'rectangle' \| 'circle' \| 'line' \| 'point' \| 'freehand' \| 'route' \| 'picker' \| 'measure' \| 'search'` |
| `maxFeatures` | `number` | enforced for every way of adding |
| `bounds` | `BoundsInput` | restricts panning; bbox `[west, south, east, north]`; reactive |
| `theme` | `'light' \| 'dark' \| 'auto'` | mode only; colours via `accentColor` or CSS variables in `style` (an object is ignored with a dev warning) |
| `accentColor` | `string` | any CSS colour; derives the primary scale |
| `featureColor` | `string` | default feature colour (slate `#475569`; `#94a3b8` on dark MapLibre basemaps) |
| `layout` | `'panel' \| 'minimal' \| 'split'` | default `'panel'` |
| `readonly` | `boolean` | default `false`; ref data methods still work |
| `fileDrop` | `boolean` | default `true`: dropping a `.geojson` / `.json` file imports it like `Cmd+O` (replace, one undo step, fits); off in `readonly` |
| `className`, `style` | `string`, `React.CSSProperties` | on the editor root; `style` takes CSS variables (`{ '--elm-accent': '#7c3aed' }`, `'--elm-primary-N'`, design tokens like `'--elm-surface'`; see Theming), also copied onto Element's portals |
| `slots` | `{ toolbar?, mapOverlay?, panelFooter?, topLeft?, topCenter?, topRight?, leftCenter?, rightCenter?, bottomLeft?, bottomCenter?, bottomRight? }` (all `React.ReactNode`) | your own UI |
| `config` | `ElementEditorConfig` | see below; flat props win over it |
| `routingApiKey` | `string` | deprecated: use `config.network.routing.apiKey` |
| callbacks | see Events | |

MapLibre entry only: `basemap?: BasemapInput` (controlled; pair with `onBasemapChange`), `defaultBasemap?: BasemapInput` (default `'auto'`), `basemaps?: BasemapInput[] | false` (picker choices; `false` hides it), `onBasemapChange`, `getFeatureStyle?: FeatureStyleFn`, `mapOptions?` (extra `maplibregl.MapOptions` minus the ones Element owns), `onMapReady?: (map: maplibregl.Map) => void`. `BasemapInput` = `'streets' | 'terrain' | 'light' | 'dark' | 'osm' | 'auto' | { style, id?, label?, thumbnail? } | { url, attribution, maxZoom?, id?, label?, thumbnail? }`.

Leaflet entry only: `tileLayer?: React.ReactNode` (any react-leaflet tile layer; disables the picker), `basemaps?: LeafletBasemap[]`, `basemap?`, `defaultBasemap?`, `onBasemapChange?` (`LeafletBasemap = RasterBasemap | 'osm'`), `renderer?: 'canvas' | 'svg'` (default `'canvas'`), `getFeatureStyle?`, `mapOptions?` (`L.MapOptions` minus owned ones), `onMapReady?: (map: L.Map) => void`.

`ElementEditorConfig` keys: `mode` (`'light' | 'dark' | 'system'`), `accentColor`, `featureColor`, `tools`, `persistKey` (namespace for localStorage; give each editor on an origin its own), `persist` (`false` = no localStorage), `network` (every third-party server: `vectorTiles`, `dem`, `osmRaster`, `glyphs`, `sprite`, `overpass`, `routing`, `nominatim`, `fetch`; `false` on a service hides what needs it), `ui` (visibility flags `hints`, `dataTable`, `layerList`, `schemaEditor`, `geojsonEditor`, `geojsonEditorOpen`, `settings`, `zoomToAll`, `zoomIndicator`, `locateButton`, plus `layout` and `keyboardShortcuts`), `toolbar.direction`, `units`. Move controls with `withLayout` (exported here): `config={{ ui: { layout: withLayout({ move: { table: 'topRight' }, hide: ['keyboard'] }) } }}`.

Removed or renamed in 0.2 (https://elementeditor.dev/docs/guides/migrating-to-0.2):

- The default entry is MapLibre now; the 0.1 Leaflet editor is `@element-editor/react/leaflet` with `/leaflet/style.css`.
- `tileLayer` / `renderer` on the default entry are ignored (dev warning).
- `spriteUrl` is gone: use `config.network.sprite`.
- `licenseKey` is gone (MIT).
- `routingApiKey` is deprecated: `config.network.routing.apiKey`.
- `config.ui.corners` and `config.toolbar.position` are removed: use `config.ui.layout` / `withLayout`.
- `bounds` takes a bbox `[west, south, east, north]` and `ref.flyTo` takes `{ center: [lng, lat], zoom }`; the old `[lat, lng]` forms still work with a dev warning.
- Shortcuts: data table `T` (was `V`), transform `A` (was `T`).

## Common mistakes

- **No stylesheet, or the wrong one.** Unstyled panels, missing controls, broken tiles. One stylesheet per entry (table above); MapLibre adapter also needs `maplibre-gl.css`.
- **Zero-height parent.** The root is 100% of its parent. Give the parent a height (`height: 600`, `100vh`, or `flex: 1; min-height: 0` in a flex column).
- **Coordinate order.** Element's API (data, `initialView.center`, `bounds`, `flyTo({ center })`, `fitBounds`) is GeoJSON `[lng, lat]`. Leaflet and react-leaflet (`MapContainer center`, `L.latLng`) are `[lat, lng]`. Convert at the boundary.
- **Missing or wrong peers.** `maplibre-gl` must be installed for the default entry (`^5.5`); `@element-editor/adapter-leaflet`, `leaflet ^1.9` and `react-leaflet ^5` for `/leaflet`. React 18 and react-leaflet 4 do not work.
- **SSR.** Render client-only (`next/dynamic` with `ssr: false`); `'use client'` alone is not enough.
- **Expecting `initialData` to be reactive.** Use the ref or a `key` remount (see Loading and saving data).
- **Adapters without providers.** `ElementEditorControls` throws outside `ElementEditorUIProvider`; it also needs a `GeoStoreProvider` (one per editor) and a `data-elm-theme="light" | "dark"` ancestor containing the map and all editor UI. Portaled UI of your own needs a `data-elm-portal` attribute.
- **`onEvent` set "just to log".** It silences every built-in toast. Use `onError` for logging.
- **Unstable `getFeatureStyle` or id-less inline basemap objects.** A new function re-sends every feature; a new id-less style object counts as a new basemap. Define them at module level or memoise.
- **Your own `map.setStyle()` on the MapLibre drop-in.** It drops your layers (Element restores its own). Switch basemaps with `basemap` / `ref.setBasemap()`, which keep your layers; images added with `map.addImage` are never kept across a style change.
- **Several editors on one origin.** They share `elm_*` localStorage keys (theme, view, basemap pick). Set `config.persistKey` per editor, or `config.persist: false`.
- **The map reopens where the user left it**, not at your data. Pass `initialView` (`'data'` to always fit `initialData`).
- **Production traffic on public services.** Defaults are OpenFreeMap/Mapterhorn tiles, Overpass, the OSRM demo router (car-only, not for production) and Nominatim. Configure `config.network` (https://elementeditor.dev/docs/guides/third-party-services).
- **Importing `@element-editor/ui/internal`.** Not covered by semver.

## Docs

| Topic | URL |
|---|---|
| Choosing a package | https://elementeditor.dev/docs/introduction/choosing-a-package |
| Quick start (drop-in) | https://elementeditor.dev/docs/quickstart/react |
| Quick start (adapters) | https://elementeditor.dev/docs/quickstart/adapter-maplibre, https://elementeditor.dev/docs/quickstart/adapter-leaflet |
| Component reference (props, ref, config) | https://elementeditor.dev/docs/reference/element-editor-react |
| Events and `onError` | https://elementeditor.dev/docs/reference/events |
| Types | https://elementeditor.dev/docs/reference/types |
| Next.js | https://elementeditor.dev/docs/guides/nextjs |
| Persisting data, live vs submit, large datasets | https://elementeditor.dev/docs/guides/persisting-data, https://elementeditor.dev/docs/guides/live-vs-submit, https://elementeditor.dev/docs/guides/saving-large-datasets |
| Schemas and validation | https://elementeditor.dev/docs/guides/schema-and-validation |
| Basemaps | https://elementeditor.dev/docs/guides/basemaps |
| Layout, tools, theming | https://elementeditor.dev/docs/guides/configuring-layout, https://elementeditor.dev/docs/guides/restricting-tools, https://elementeditor.dev/docs/guides/theming |
| Third-party services | https://elementeditor.dev/docs/guides/third-party-services |
| Custom UI with adapters | https://elementeditor.dev/docs/guides/custom-ui-with-adapters |
| Migrating from 0.1 | https://elementeditor.dev/docs/guides/migrating-to-0.2 |

Append `.md` to any docs URL for markdown; https://elementeditor.dev/llms-full.txt has everything in one file.
