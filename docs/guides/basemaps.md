# Basemaps

*Built-in basemaps, a picker, and your own styles.*

The MapLibre drop-in (`@element-editor/react`) ships with five basemaps and a picker. Adapters let you reuse the same catalog on your own map. The Leaflet drop-in supports raster basemaps only.

---

## Built-in basemaps

| id | Kind | Look |
|---|---|---|
| `streets` | vector | OpenFreeMap Streets, with Mapterhorn hillshade |
| `terrain` | vector | terrain-oriented style with Mapterhorn hillshade |
| `light` | vector | muted light style, so your data stands out |
| `dark` | vector | dark style |
| `osm` | raster | standard OpenStreetMap tiles |
| `'auto'` | | not a basemap: resolves to `streets` in a light editor and `dark` in a dark editor, and switches live when the theme changes |

All vector basemaps use OpenFreeMap tiles (no API key). `'auto'` is the default.

```tsx
import { ElementEditor } from '@element-editor/react'
import '@element-editor/react/style.css'

<ElementEditor defaultBasemap="terrain" />
```

If a basemap's style can't be loaded (network down, bad style URL), the drop-in still mounts on a blank map (or keeps the previous basemap) and reports the error with `source: 'basemap'` (`onError` / `onEvent` / toast).

`defaultBasemap` is the **starting** choice. The picker (bottom-left by default) lets users switch, and their pick is remembered in `localStorage` (`elm_basemap`, or `elm_<persistKey>_basemap` with [`config.persistKey`](./persisting-data.md#elements-own-saved-state-persistkey--persist)) and wins over `defaultBasemap` on the next load. Use `basemaps` to change what the picker offers, or `basemaps={false}` to hide it.

```tsx
<ElementEditor basemaps={['auto', 'light', 'dark']} />   // fewer choices
<ElementEditor basemaps={false} />                       // no picker ('auto')
```

### Controlling the basemap from your app

Pass `basemap` to own the choice: the map shows it, and changing it switches the basemap. `onBasemapChange` tells you when the user picks another one (or you call `ref.setBasemap()`); update `basemap` there, or the picker can't change anything (a dev-mode warning says so).

```tsx
const [basemap, setBasemap] = useState<BasemapInput>(() => loadFromProfile() ?? 'auto')

<ElementEditor
  basemap={basemap}
  onBasemapChange={(b) => { setBasemap(b); saveToProfile(b) }}
/>
```

- A controlled editor reads and writes **no** `localStorage`: you decide what's remembered.
- `onBasemapChange` gets the entry as it appears in `basemaps`: `'auto'` stays `'auto'` (resolve it with `resolveBasemap(b, theme)` from `@element-editor/adapter-maplibre/basemaps`). It is not called when `'auto'` follows a theme change, nor when you change `basemap`.
- `basemap` doesn't have to be in `basemaps`: it is applied and the picker shows none selected. With `basemaps={false}` it simply fixes the basemap.
- Custom entries are compared by `id` (then `label`, then URL). Give a style object an `id` or keep it stable: an id-less object created inline counts as a new basemap on every render (dev-mode warning).
- Don't call `map.setStyle()` yourself on a controlled editor: Element doesn't know about that style, and setting `basemap` to the value it already has does nothing. Switch with the prop.

Without owning the state, `ref.getBasemap()` returns the current choice and `ref.setBasemap(b)` switches like a user pick, except that it isn't remembered for the next visit.

The picker is the `'basemap'` layout control. It is hidden whenever the editor has no picker, can't be put in a group, and can be moved like any other control; see [Configuring layout](./configuring-layout.md).

---

## Custom basemaps

Anything in `basemap` / `defaultBasemap` / `basemaps` can be a custom entry:

```tsx
<ElementEditor
  defaultBasemap={{ style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=KEY', label: 'MapTiler' }}
  basemaps={[
    'auto',
    'dark',
    // vector style: a URL or a MapLibre StyleSpecification object
    { id: 'maptiler', style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=KEY', label: 'MapTiler' },
    // raster XYZ tiles
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri',
      maxZoom: 19,
      id: 'satellite',
      label: 'Satellite',
    },
  ]}
/>
```

| Shape | Fields |
|---|---|
| Vector style | `{ style: string \| StyleSpecification, id?, label?, thumbnail? }` |
| Raster tiles | `{ url, attribution, maxZoom?, id?, label?, thumbnail? }` (256px XYZ; `maxZoom` defaults to 19) |

`id` identifies the entry: the picker tells entries apart by it and the user's pick of a custom entry is remembered only when it has one. Without an `id`, the entry falls back to its `label`, then its URL; two style objects with neither can't be told apart, so give every custom entry a unique `id` (a dev-mode warning says so). `label` is the text shown in the picker. Built-in ids, `'auto'` and custom entries with an `id` are remembered.

Element's own layers (features, drawing, snapping) are kept when the basemap changes, so you can switch styles at any time without losing edits. A custom style should not use layer or source ids starting with `elm-`, which Element reserves.

---

## Attribution

Credits are shown in the map's attribution control and must stay visible. The built-ins require:

- **OpenFreeMap vector basemaps** (`streets`, `terrain`, `light`, `dark`): OpenFreeMap, © OpenMapTiles, and Data from © OpenStreetMap contributors. Added automatically.
- **Hillshade (`streets`, `terrain`)**: © Mapterhorn (links to mapterhorn.com/attribution). Added automatically.
- **`osm`**: © OpenStreetMap contributors. Added automatically. Respect the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); heavy production traffic should use your own tile provider (`config.network.osmRaster`).
- **Swapped servers** (`config.network`): give each source's `attribution`; without one Element drops the default provider's credit, keeps the OpenStreetMap data credit for vector and OSM raster tiles, and logs a development warning.

For custom basemaps, pass `attribution` (raster) or include it in your style's sources (vector).

**How the drop-in shows it.** Both drop-ins (MapLibre and Leaflet) follow the [OSM Foundation attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines), at every width:

- At load the credits are **expanded**, visible without any click, at the start of the `bottomRight` slot (the bottom row wraps around them).
- They **collapse to a round "i" button** on the first map interaction (pan, click, zoom, keyboard) or after **five seconds**, whichever comes first. The timer only counts while the page is visible. Nothing animates, so `prefers-reduced-motion` needs no special case.
- The "i" button opens them again at any time; once you open them yourself no timer closes them (a map drag does, and on Leaflet so does `Escape`).
- With `'attribution'` in a status slot ([Configuring layout](./configuring-layout.md)) the credits are a full line in the status bar instead and never collapse.

If you add your own sources or layers (`onMapReady`, `mapOptions`, a custom `tileLayer`, or your own map with an adapter), give each one its `attribution` so its credit appears in the same control, and keep that control visible: hiding or covering it breaks most data licences, OpenStreetMap's ODbL included. With an adapter you own the map, so its attribution control (and how it collapses) is yours to keep compliant.

---

## Self-hosting the tiles, fonts and sprite

The built-in vector styles load tiles and glyphs (fonts) from OpenFreeMap, hillshade elevation from Mapterhorn, and a small sprite (custom icons OpenFreeMap doesn't have) from jsDelivr at the installed package version (`https://cdn.jsdelivr.net/npm/@element-editor/adapter-maplibre@<version>/basemaps/sprite`). `config.network` points each at your own server or provider:

```tsx
<ElementEditor
  config={{
    network: {
      vectorTiles: { url: 'https://tiles.example.com/planet.json', attribution: '© Example © OpenStreetMap contributors' },
      glyphs: 'https://tiles.example.com/fonts/{fontstack}/{range}.pbf',
      dem: { tiles: ['https://dem.example.com/{z}/{x}/{y}.webp'], attribution: '© Example' },
      osmRaster: { tiles: ['https://osm.example.com/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors' },
      sprite: `${window.location.origin}/map/sprite`, // serves /map/sprite.json, /map/sprite.png, /map/sprite@2x.json, /map/sprite@2x.png
    },
  }}
/>
```

For the sprite, copy the `sprite*.json` / `sprite*.png` files from `node_modules/@element-editor/adapter-maplibre/basemaps/` to a folder you serve and pass its **absolute** URL prefix (without extension); MapLibre can't resolve a relative one. Vector tiles must use the OpenMapTiles schema, glyphs must include Noto Sans Regular / Bold / Italic, and elevation is terrarium-encoded unless you set `encoding`. Headers go through `mapOptions.transformRequest`. All the rules, plus the Picker, routing and search servers: [Third-party services and self-hosting](./third-party-services.md).

---

## With the MapLibre adapter

On your own MapLibre map, use the catalog from `@element-editor/adapter-maplibre/basemaps` and the `BasemapControl` picker from the main entry. `maplibre-gl` is a peer dependency.

```tsx
import { ElementEditorControls, BasemapControl } from '@element-editor/adapter-maplibre'
import { loadBasemapStyle } from '@element-editor/adapter-maplibre/basemaps'
```

- **`BasemapControl`** renders the picker and applies the choice with `setBasemap`. Props: `map?` (defaults to the surrounding `ElementEditorControls`' map), `basemaps?`, `value?`, `defaultValue?` (`'auto'`), `onChange?`, `storageKey?` (persist the choice in `localStorage` under this key, namespaced by `config.persistKey`) and `initialApplied?` (set when your map was created with the initial basemap's style already). On your own map it **leaves your style alone until there is a real choice**: with no `value`, no explicit `defaultValue` and nothing remembered under `storageKey`, the picker shows `'auto'` selected but applies nothing until the user picks. Pass `defaultValue` (or `value`) to apply a basemap on mount. `'auto'` follows the theme only while the control is mounted.
- **`useBasemap(map, basemap, { theme, initialApplied? })`** is the hook `BasemapControl` applies with. Call it in an always-mounted component (and give `BasemapControl` `value`/`onChange` but no `map`) to keep `'auto'` following the theme while the picker is hidden; the drop-in does this.
- **`setBasemap(map, input, { theme?, network? })`** loads and applies a basemap, preserving Element's layers and images and your own sources and layers (everything that wasn't part of the previous basemap, in its order relative to Element's layers, above the new basemap). Images you added with `map.addImage` are not kept: re-add them on `style.load`. The latest call wins. The basemap Element replaces is the style the map had when `ElementEditorControls` initialised (or the last one `setBasemap` applied), so on your own map add your layers after that (e.g. in `onReady`).
- **Your own `map.setStyle()`** (your own switcher, MapTiler SDK style switching) works too: Element puts its own sources, layers and images back on top by itself. Your layers are yours to restore: re-add them from a `style.load` listener added in `onReady`, which runs after Element's repair.
- **`loadBasemapStyle(input, { theme?, network? })`** resolves an input to a style (use it for `new maplibregl.Map({ style })`). `network` is the tile part of `config.network` (`vectorTiles`, `dem`, `osmRaster`, `glyphs`, `sprite`); `BasemapControl` and `useBasemap` pass the editor's own.
- **`resolveBasemap(input, theme)`** resolves `'auto'` to `'streets'` or `'dark'`.
- **`BASEMAPS`** lists the built-ins (`id`, `label`, `kind`, `thumbnail`). Thumbnails are small inlined WebP images, so opening the picker makes no requests.
- **`BasemapInput`** is the type of every entry above.

```tsx
import { setBasemap } from '@element-editor/adapter-maplibre/basemaps'

map.on('load', () => setBasemap(map, 'terrain'))
```

Put `BasemapControl` inside your own layout, or with the full UI stack render it in the `'basemap'` layout slot. The catalog is lazy-loaded: importing `BasemapControl` doesn't pull in the style JSON until it's needed.

---

## Leaflet: raster basemaps

The Leaflet drop-in (`@element-editor/react/leaflet`) has no vector basemaps. By default it shows OpenStreetMap with no picker (`config.network.osmRaster` serves it from your own tile server). Pass `basemaps` to choose the raster layer (a single entry just replaces OpenStreetMap; two or more add a picker), or `tileLayer` for full control. `tileLayer` wins and disables the picker.

```tsx
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css'

<ElementEditor
  basemaps={[
    'osm',
    {
      id: 'satellite',
      label: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri',
      maxZoom: 19,
      thumbnail: '/thumbs/satellite.webp', // optional
    },
  ]}
/>
```

The first entry is the default (or pass `defaultBasemap`) and the user's pick is remembered (`localStorage` key `elm_basemap_leaflet`). Entries are told apart by `id`, else by `url`. `basemap` + `onBasemapChange` and `ref.getBasemap()` / `ref.setBasemap()` work as on the MapLibre drop-in ([Controlling the basemap](#controlling-the-basemap-from-your-app)); values are `basemaps` entries or `'osm'`, and the controlled basemap may be any raster entry, listed or not. `tileLayer` overrides all of these (dev-mode warning).

### `tileLayer` (any react-leaflet tile component)

```tsx
import { TileLayer } from 'react-leaflet'
import { ElementEditor } from '@element-editor/react/leaflet'

<ElementEditor
  tileLayer={<TileLayer url="https://tiles.your-app.com/{z}/{x}/{y}.png" attribution="© Your Company" maxZoom={19} />}
/>
```

`tileLayer` accepts any `React.ReactNode` rendered inside the editor's `MapContainer` (`<TileLayer>`, `<WMSTileLayer>`, third-party tile components). To swap it at runtime, give the layer a `key` that changes with the style, otherwise Leaflet may keep the old tile cache.

### Common raster providers

Replace keys with your own and check each provider's terms.

| Provider | URL template | Notes |
|---|---|---|
| OpenStreetMap | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | built in as `'osm'` |
| Esri imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | `Tiles © Esri`; commercial use needs an ArcGIS plan |
| MapTiler | `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=KEY` | key required; for MapTiler vector styles use the MapLibre drop-in |
| Mapbox | `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=TOKEN` | with `tileSize={512}` and `zoomOffset={-1}` on a `<TileLayer>`; for vector use the MapLibre drop-in |
| Stadia Maps | `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png` | free for non-commercial |

---

## Adapters on a Leaflet map

`@element-editor/adapter-leaflet` plugs into your own `MapContainer`, so you control tiles with your own `<TileLayer>`. The basemap catalog and `BasemapControl` are MapLibre-only.

---

## What's next

- [Reference: ElementEditorProps](../reference/element-editor-react.md#elementeditorprops) — full prop list
- [Configuring layout](./configuring-layout.md) — placing the `'basemap'` control
- [Theming](./theming.md) — recoloring the editor chrome to match your basemap
- [Choosing a package](../introduction/choosing-a-package.md) — when to use `@element-editor/react` vs an adapter
