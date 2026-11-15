<h1>
  <a href="https://elementeditor.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/element-logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset=".github/assets/element-logo-light.svg">
      <img alt="Element" src=".github/assets/element-logo-light.svg" height="56">
    </picture>
  </a>
</h1>

Professional map editing for React. Bring your Leaflet or MapLibre map — Element adds drawing, vertex editing, snapping, undo/redo, and data management on top.

> [!TIP]
> **Using an AI coding agent?** (Claude Code, Cursor, Codex, Copilot, …) Point it at these, in this order:
>
> 1. **https://elementeditor.dev/llms.txt** is the overview for agents. **https://elementeditor.dev/llms-full.txt** has all the docs in one file. Every docs page is also served as Markdown: add `.md` to its URL, e.g. https://elementeditor.dev/docs/quickstart/react.md.
> 2. **`AGENTS.md` in the installed package** (`node_modules/@element-editor/react/AGENTS.md`, likewise for each `@element-editor/*` package) is a short guide checked against that version's types: which package to pick, install commands, the public API and common mistakes.
>
> A prompt to start with:
>
> ```text
> Add a map editor to this React app with Element (@element-editor/react).
> Read https://elementeditor.dev/llms.txt first, install the package with
> `npm install @element-editor/react maplibre-gl@^5`, then follow
> node_modules/@element-editor/react/AGENTS.md. Use only the public API it lists.
> ```

---

## Packages

| Package | Description |
|---|---|
| [`@element-editor/react`](#element-editorreact) | Self-contained full editor. Owns the map (MapLibre; Leaflet via `/leaflet`). Drop in one component. |
| [`@element-editor/adapter-leaflet`](#element-editoradapter-leaflet) | Plug editing into an existing Leaflet map. |
| [`@element-editor/adapter-maplibre`](#element-editoradapter-maplibre) | Plug editing into an existing MapLibre GL map (MapTiler SDK and Mapbox GL JS work too). |
| `@element-editor/ui` | The toolbars, panels and modals, for building your own layout with an adapter. |
| `@element-editor/core` | Stores, data types and helpers shared by all packages (installed with each of them). |

---

## Requirements

React and React DOM `^19.2` (React 18 is not supported; Next.js 15's `create-next-app` pins 19.1, so run `npm install react@^19.2 react-dom@^19.2` there first). `@element-editor/react` and the MapLibre adapter need `maplibre-gl` 5.5 or 6 (the built-in Terrain basemap needs 5.5+); the Leaflet adapter (and the Leaflet drop-in, `@element-editor/react/leaflet`) need `leaflet` `^1.9` and `react-leaflet` `^5`. Every peer of `@element-editor/react` except React is optional, so install the ones for the entry you use. The Leaflet drop-in never loads `maplibre-gl`.

The packages ship ES modules plus CommonJS (`.cjs`) builds. `@element-editor/react` depends on `@element-editor/core`, `@element-editor/ui` and `@element-editor/adapter-maplibre` instead of bundling them. The geometry worker is inlined, so no bundler configuration is needed. The stylesheets don't reset your page: Tailwind's base styles apply only inside the editor (`[data-elm-theme]`). TypeScript users of the Leaflet entries also need `@types/leaflet`. Sites with a Content Security Policy need `worker-src blob:` and `style-src 'unsafe-inline'` plus the map and service hosts: see [CSP](./docs/guides/third-party-services.md#content-security-policy-csp).

---

## `@element-editor/react`

The batteries-included editor. Owns its own MapLibre map, with built-in basemaps and a picker, plus the toolbar, layers panel, and all editing tools. Zero configuration required.

### Install

```bash
npm install @element-editor/react maplibre-gl@^5
```

### Usage

```tsx
import { ElementEditor } from '@element-editor/react'
import '@element-editor/react/style.css' // includes MapLibre's CSS

export default function App() {
  return (
    <div style={{ height: 600 }}>
      <ElementEditor
        onChange={(data) => console.log(data)}
      />
    </div>
  )
}
```

### Key props

| Prop | Type | Description |
|---|---|---|
| `initialData` | `FeatureCollectionInput \| GeoJSONFeatureInput \| null` | Pre-populate with existing GeoJSON. Invalid data reports an error and the editor starts empty. |
| `onChange` | `(data: FeatureCollection) => void` | Fires on every committed change. |
| `onEvent` | `(event: ElementEditorEvent) => void` | Receive every user-facing message; when set, the editor shows no toasts. |
| `onError` | `(error: ElementEditorError) => void \| false \| string` | Every runtime failure, with a stable `code` and `source`. Return `false` to hide the toast or a string to replace its text. |
| `initialView` | `{ center, zoom } \| { bounds } \| 'data'` | Where the map starts. Without it: the view the user left, else a fit of `initialData`. |
| `mapOptions` / `onMapReady` | `maplibregl.MapOptions` / `(map) => void` | Extra map options; the map once Element's layers are on it (add your own layers here). |
| `tools` | `DrawTool[]` | Restrict which tools are shown: `'polygon'` (the Area tool), `'rectangle'`, `'circle'`, `'line'`, `'point'`, `'freehand'`, `'route'`, `'picker'`, `'measure'`, `'search'`. |
| `readonly` | `boolean` | Disable all editing. |
| `theme` | `'light' \| 'dark' \| 'auto'` | Light or dark mode only. Defaults to following the OS. Colours, fonts, radius and shadows go through `accentColor` and the CSS design tokens, set in your stylesheet or in `style` (`style={{ '--elm-accent': '#7c3aed', '--elm-surface': '#fbf6ee' }}`). See [Theming](./docs/guides/theming.md). |
| `accentColor` | `string` | Brand colour, any CSS colour. Every accent shade in the UI and on the map is generated from it. |
| `featureColor` | `string` | Default colour of every feature (outline, fill, line, point). Default slate `#475569`. |
| `getFeatureStyle` | `(feature) => FeatureStyle \| null` | Per-feature `{ color, fillColor, opacity, fillOpacity, weight }`, e.g. colour by a property. Wins over `featureColor`. |
| `defaultBasemap` | `BasemapInput` | Starting basemap: `'auto'` (default; follows light/dark), `'streets'`, `'terrain'`, `'light'`, `'dark'`, `'osm'`, a style URL/JSON or a raster `{ url, attribution }`. The user's pick is remembered and wins on reload. |
| `basemap` / `onBasemapChange` | `BasemapInput` / `(b) => void` | Control the basemap from your app (nothing is remembered) and hear about the user's picks. |
| `basemaps` | `BasemapInput[] \| false` | Choices in the basemap picker. `false` hides it. |
| `config.ui.layout` | `LayoutConfig` | Where every control goes. `withLayout({ move: { table: 'topRight' } })` moves a few and keeps the rest. See [Configuring layout](./docs/guides/configuring-layout.md). |
| `config.network` | `NetworkConfig` | Your own servers and keys for every third-party service (tiles, fonts, sprite, Overpass, routing, geocoder), per editor; `false` turns one off. See [Third-party services and self-hosting](./docs/guides/third-party-services.md). |

### Leaflet drop-in

The same component on Leaflet lives at `@element-editor/react/leaflet`. Its peers are optional, so install them (`maplibre-gl` isn't needed):

```bash
npm install @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet
npm install -D @types/leaflet # TypeScript only
```

```tsx
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css' // includes Leaflet's CSS
```

`tileLayer`, `renderer` and a raster-only `basemaps` list are Leaflet-only props. If you used a 0.1 pre-release build, where `@element-editor/react` was the Leaflet drop-in: see [Migrating to 0.2](./docs/guides/migrating-to-0.2.md).

### Ref API

```tsx
import { useRef } from 'react'
import { ElementEditor, type ElementEditorRef } from '@element-editor/react'

const ref = useRef<ElementEditorRef>(null)
<ElementEditor ref={ref} />

ref.current?.getFeatureCollection()
ref.current?.setFeatureCollection({ type: 'FeatureCollection', features: [] }) // plain GeoJSON is fine
const f = ref.current?.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.86] }, properties: {} })
if (f) ref.current?.select([f.id], { fit: true })
ref.current?.setTool('polygon')
ref.current?.getMap() // the maplibregl.Map (L.Map on /leaflet)
ref.current?.undo()
```

---

## `@element-editor/adapter-leaflet`

Plug editing into an existing `react-leaflet` map. You control the map; Element controls the editing layer.

### Install

```bash
npm install @element-editor/adapter-leaflet @element-editor/ui leaflet react-leaflet
npm install -D @types/leaflet # TypeScript only
```

### Usage

```tsx
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import '@element-editor/adapter-leaflet/style.css' // includes Leaflet's CSS

export default function MyMap() {
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light">
          <MapContainer center={[48.86, 2.35]} zoom={12} style={{ height: 600 }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ElementEditorControls
              onChange={(data) => console.log(data)}
            />
          </MapContainer>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

> `ElementEditorUIProvider` (contexts, error boundary, its own toast `<Toaster>`) and `GeoStoreProvider` (the store) must wrap the map. The map and any editor UI must be inside a `data-elm-theme` element, which scopes the editor's styles and keyboard shortcuts. `ElementEditorControls` must be inside `MapContainer`.

---

## `@element-editor/adapter-maplibre`

Plug editing into an existing MapLibre GL map. Same API as the Leaflet adapter — swap by changing the import.

### Install

```bash
npm install @element-editor/adapter-maplibre @element-editor/ui maplibre-gl@^5
```

### Usage

```tsx
import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap() {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current!,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86],
      zoom: 12,
    })
    setMap(m)
    return () => { m.remove(); setMap(null) }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', height: 600 }}>
          <div ref={container} style={{ width: '100%', height: '100%' }} />
          {map && (
            <ElementEditorControls
              map={map}
              onChange={(data) => console.log(data)}
            />
          )}
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

> `ElementEditorControls` waits for the map style to accept sources before adding its layers, so it can mount as soon as the map exists.

---

## Drawing tools

Every package has the same tools:

| Tool | Key | Description |
|---|---|---|
| Point | `P` | Click to place a point |
| Line | `L` | Click to add points, double-click or `Enter` to finish |
| Area | `G` | Click to add points; click the first point, double-click or `Enter` to close |
| Rectangle | `R` | Click and drag |
| Circle | `O` | Click and drag outward from the centre |
| Freehand | `F` | Click and drag (open line or closed shape) |
| Route | `C` | Click waypoints, road-snapped via OpenRouteService (`config.network.routing.apiKey`), your own router, or by default the OSRM demo server (car-only, not for production) |
| Picker | `X` | Click a building, park or lake to copy its OpenStreetMap shape |
| Measure | `M` | Measure distances and areas |

Additional shortcuts: `Enter` to finish, `Escape` to cancel, `⌘Z` undo, `⌘⇧Z` redo, `Delete` to delete selected, `Shift+drag` to box-select. Shortcuts are scoped per editor: they act only when focus or your last click is inside that editor.

---

## Features

- **Schema system** — define named data models; features carry typed properties with validation
- **Data table** — spreadsheet view of all features and their properties (`T` to toggle)
- **GeoJSON inspector** — view and edit raw GeoJSON directly
- **Import / export** — GeoJSON import with replace or merge, GeoJSON export
- **Undo/redo** — 25-level history stack
- **Snapping** — magnetic snapping to nearby points and edges
- **Boolean operations** — union, subtract, intersect, exclude, cut hole, slice; plus buffer, simplify and smooth (polygon booleans, cut hole, slice and the previews run in a background worker)
- **Groups** — organise features into named collapsible groups
- **Dark mode** — `theme="dark"` or `theme="auto"`
- **Brand colour** — one colour (`accentColor="#ea580c"`, or `--elm-accent` in CSS) recolours the UI and the map highlights
- **Custom theming** — CSS design tokens (`--elm-surface`, `--elm-text`, `--elm-border`, `--elm-radius`, `--elm-font`, `--elm-shadow`, …) restyle every surface, text, border, radius, font and shadow, per mode and per editor, portals included

---

## Licensing

Element Editor is [MIT-licensed](./LICENSE): free for any use, commercial or not. No runtime key, no feature gating, no watermarks.

A Pro tier with team features is planned. It will ship as a separate package under a commercial licence; everything in this repository stays MIT.

---

## Development

```bash
# Install dependencies
pnpm install

# Run the demo (apps/demo — @element-editor/react, adapter-leaflet and adapter-maplibre tabs)
pnpm dev

# Build all packages
pnpm build

# Full validation: typecheck + unit tests + e2e
pnpm --filter @element-editor/react validate

# E2E tests only
pnpm test:e2e

# Playwright interactive UI
pnpm --filter @element-editor/react test:e2e:ui
```

`pnpm check:docs` type-checks the code in the docs and compares the API reference with the types. `pnpm lint` runs ESLint over `packages/*/src`. Releases: see [RELEASING.md](./RELEASING.md).

See the [documentation](./docs/index.md) for guides and the full API reference.

---

## Contributing

Contributions are welcome: read [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow, tests and checks. Ask questions in [GitHub Discussions](https://github.com/spatibase/element/discussions). Report security issues privately to security@elementeditor.dev (see [SECURITY.md](./SECURITY.md)).
