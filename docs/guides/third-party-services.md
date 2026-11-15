# Third-party services and self-hosting

Out of the box Element talks to free public services: basemap tiles, fonts and elevation from OpenFreeMap and Mapterhorn, OpenStreetMap raster tiles, the Picker's Overpass lookups, the Route tool's router and the search box's geocoder. That works for a demo. For production, privacy, an intranet or a paid plan you usually want your own servers or keys. `config.network` sets all of them in one place:

```tsx
<ElementEditor
  config={{
    network: {
      vectorTiles: { url: 'https://api.maptiler.com/tiles/v3-openmaptiles/tiles.json?key=KEY', attribution: '© MapTiler © OpenStreetMap contributors' },
      glyphs: 'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=KEY',
      sprite: `${location.origin}/map/sprite`,
      overpass: { endpoint: 'https://overpass.example.com/api/interpreter' },
      routing: { apiKey: ORS_KEY },
      nominatim: { url: 'https://geocode.example.com/search', attribution: 'Geocoding © Example' },
    },
  }}
/>
```

The settings belong to that editor: two editors on one page can use different servers and keys. Leave a key out to keep the default service. Set a service to `false` to turn it off: the tool or box that needs it is hidden.

The same `config` works with the adapters: pass it to `ElementEditorUIProvider` (or `ElementEditorConfigProvider`) around your `ElementEditorControls`.

---

## What Element calls

| Service | Default | `config.network` key | Auth | Licence and attribution |
|---|---|---|---|---|
| Vector tiles (Streets, Terrain, Light, Dark) | OpenFreeMap `tiles.openfreemap.org/planet` | `vectorTiles` | Key in the URL if your provider needs one | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Must be the **OpenMapTiles schema** (the built-in styles and the Picker read its layers). |
| Glyphs (map fonts) | OpenFreeMap fonts | `glyphs` | Key in the URL | Must serve **Noto Sans Regular, Bold and Italic** (the styles ask for these). |
| Sprite (map icons) | jsDelivr copy of `@element-editor/adapter-maplibre/basemaps/sprite` | `sprite` | none | Element's own files (MIT). |
| MapLibre worker (MapLibre drop-in on MapLibre GL JS 6 only) | jsDelivr copy of the installed `maplibre-gl/dist/maplibre-gl-worker.mjs` | none: call MapLibre's `setWorkerUrl` (see [below](#maplibre-gl-js-6-worker)) | none | MapLibre GL JS (BSD-3-Clause). |
| Elevation (hillshade on Streets / Terrain) | Mapterhorn `tiles.mapterhorn.com` | `dem` | Key in the URL | © Mapterhorn. **Terrarium** encoding, 512 px tiles; set `encoding` for another one. |
| OSM raster (`'osm'` basemap, both engines) | `tile.openstreetmap.org` | `osmRaster` | Key in the URL (Leaflet loads tiles as images: no headers) | © OpenStreetMap contributors. The [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) rules out heavy production use. |
| Overpass (Picker) | `overpass-api.de` | `overpass` | via `fetch` | OSM data, [ODbL](https://www.openstreetmap.org/copyright). The public server is often busy. |
| Routing (Route tool) | **OSRM demo** `router.project-osrm.org` | `routing` | ORS key as the `Authorization` header | ORS: "© openrouteservice.org by HeiGIT" (shown automatically). See below. |
| Geocoding (search box) | Nominatim `nominatim.openstreetmap.org` | `nominatim` | via `fetch`; `email` as a query parameter | "Geocoding by Nominatim" (shown automatically). [Usage policy](https://operations.osmfoundation.org/policies/nominatim/): at most 1 request/s, no heavy use. |

The editor makes no other requests (`fetchSheetCsv` in `@element-editor/core` fetches a Google Sheet only when your code calls it).

> **The default router is a demo.** Without `routing` set, the Route tool snaps through the public OSRM demo server. It is **car-only** (the walking profile in the URL is ignored), rate-limited and not for production. Element logs a development warning the first time it uses it. For production set an OpenRouteService key (`routing: { apiKey }`, free key at [openrouteservice.org](https://openrouteservice.org/dev/#/signup)) or your own server (`routing: { url }`).

---

## MapLibre GL JS 6 worker

MapLibre GL JS 5 has its worker built in. Version 6 loads it from a separate file, `maplibre-gl-worker.mjs`, and bundlers (Vite, webpack, Turbopack) don't put that file where MapLibre looks for it. So when the MapLibre drop-in creates its map on MapLibre 6 and your app hasn't set a worker URL, it points MapLibre at the jsDelivr copy of the version you installed (`https://cdn.jsdelivr.net/npm/maplibre-gl@<version>/dist/maplibre-gl-worker.mjs`).

To serve the worker yourself (offline, intranet, strict CSP), call MapLibre's `setWorkerUrl` once before the editor mounts. The editor then leaves it alone. With Vite:

```ts
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
```

With webpack 5 (Next.js): `setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString())`. See MapLibre's [installation notes](https://maplibre.org/maplibre-gl-js/docs/) for other bundlers.

The adapters never create a map, so with `@element-editor/adapter-maplibre` on MapLibre 6 your own map setup calls `setWorkerUrl`, as MapLibre's docs describe.

---

## Map tiles: `vectorTiles`, `dem`, `osmRaster`, `glyphs`, `sprite`

These rewrite the built-in basemaps (MapLibre drop-in, `BasemapControl`, `loadBasemapStyle` / `setBasemap`; on the Leaflet drop-in only `osmRaster` applies). A tile source is either:

- a **URL**: a tile template (with `{z}`) or a TileJSON URL, or
- an **object** of MapLibre source fields merged over the built-in source: `tiles`, `url`, `attribution`, `encoding`, `tileSize`, `maxzoom`, …

```ts
network: {
  vectorTiles: 'https://tiles.example.com/planet.json',                       // TileJSON
  dem: { tiles: ['https://dem.example.com/{z}/{x}/{y}.png'], encoding: 'mapbox', attribution: '© Example' },
  osmRaster: { tiles: ['https://osm.example.com/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors' },
  glyphs: 'https://fonts.example.com/{fontstack}/{range}.pbf',
  sprite: `${location.origin}/map/sprite`,
}
```

The tile URLs are read when a basemap loads, so a change applies on the next basemap switch. `glyphs` and `sprite` must be absolute URLs (MapLibre can't resolve relative ones). To self-host the sprite, copy `sprite*.json` / `sprite*.png` from `node_modules/@element-editor/adapter-maplibre/basemaps/` to a folder you serve and pass its URL prefix without extension.

**Headers for map resources** (a bearer token, a signed URL): use MapLibre's own `transformRequest` in the drop-in's `mapOptions`. It covers every tile, glyph and sprite request MapLibre makes:

```tsx
<ElementEditor mapOptions={{ transformRequest: (url) => ({ url, headers: { Authorization: `Bearer ${token}` } }) }} />
```

Custom basemaps (`{ style }` / `{ url }` entries) are yours already: `config.network` doesn't touch them.

---

## Services: `overpass`, `routing`, `nominatim`, `fetch`

```ts
network: {
  overpass: { endpoint: 'https://overpass.example.com/api/interpreter', timeoutMs: 10_000 },
  routing: { apiKey: ORS_KEY },                            // OpenRouteService
  // routing: { url: 'https://osrm.example.com/route/v1/foot' },     // your own OSRM (provider 'osrm' when there's no key)
  // routing: { provider: 'ors', url: 'https://ors.example.com/ors/v2/directions/foot-walking/geojson' }, // self-hosted ORS, no key
  nominatim: { url: 'https://geocode.example.com/search', email: 'maps@example.com' },
  fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers, 'X-Api-Key': KEY } }),
}
```

- **`overpass`**: `endpoint` (default `https://overpass-api.de/api/interpreter`) and `timeoutMs` per attempt (default 15000).
- **`routing`**: `provider` (`'ors'` when `apiKey` is set, else `'osrm'`), `url` (ORS: the directions endpoint; OSRM: the route service prefix including the profile, Element appends `/{lng,lat;…}?overview=full&geometries=geojson`), `apiKey`, `attribution`.
- **`nominatim`**: `url` (any Nominatim-compatible `/search`; extra query parameters in it are kept), `email` (sent as the `email` parameter, as Nominatim's policy asks of heavy users), `attribution`.
- **`fetch`** is used for every request Element makes itself: Overpass, routing and search. Use it for a proxy, auth headers, logging or tests. It can be an inline function.

To call the services yourself, `fetchRoute(waypoints, { provider, url, apiKey, fetch, signal })` and `fetchOverpassFeatures(lat, lon, radius, click, { endpoint, timeoutMs, fetch, signal })` (`@element-editor/core`) take the same settings.

---

## Turning services off

| Setting | Effect |
|---|---|
| `overpass: false` | The Picker uses only the basemap's vector tiles (MapLibre with an OpenMapTiles basemap) and says "No shape here in the basemap" where they have nothing. On Leaflet (no vector tiles) the Picker is hidden. |
| `routing: false` | The Route tool is hidden (toolbar, shortcut, `ref.setTool('route')`). |
| `nominatim: false` | The search box is hidden and the Nominatim credit dropped. |

For a fully offline or intranet editor, also give it basemaps you serve (`vectorTiles` / `glyphs` / `sprite` / `dem`, your own `basemaps`, or `basemaps={false}`), or restrict `tools`.

---

## Content Security Policy (CSP)

If your site sends a `Content-Security-Policy` header, the editor needs:

| Directive | Allow | Why |
|---|---|---|
| `worker-src` (and `child-src` for older Safari) | `blob:` | MapLibre GL starts its workers from `blob:` URLs (on MapLibre 6 when the worker file is on another origin, such as the jsDelivr default). Element's geometry worker (boolean operations, cut hole, slice, buffer / simplify / smooth previews) is inlined in the package and also starts from a `blob:` URL; only if creating that throws does it fall back to a `data:` URL. |
| `style-src` | `'unsafe-inline'` | The editor and its libraries (toasts, the CodeMirror GeoJSON inspector) add `<style>` elements at runtime. There is no nonce option. |
| `img-src` | `data:` `blob:` | Basemap picker thumbnails are inlined as `data:` images; MapLibre decodes images through `blob:` URLs. Leaflet loads raster tiles as images, so its tile hosts go here too. |
| `script-src` | `https://cdn.jsdelivr.net` | MapLibre GL JS 6 only, while the drop-in loads MapLibre's worker from jsDelivr (not needed when you call `setWorkerUrl` with a same-origin file). |
| `connect-src` | each service you keep | MapLibre fetches tiles, glyphs and the sprite; Element fetches Overpass, the router and the geocoder. |

With every default left on, that is:

```text
Content-Security-Policy:
  worker-src 'self' blob:;
  child-src blob:;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://tile.openstreetmap.org;
  connect-src 'self' https://tiles.openfreemap.org https://tiles.mapterhorn.com
    https://tile.openstreetmap.org https://cdn.jsdelivr.net https://overpass-api.de
    https://router.project-osrm.org https://api.openrouteservice.org
    https://nominatim.openstreetmap.org;
```

Drop the hosts of services you turn off or replace, and add your own servers (and the hosts of custom basemap styles). `api.openrouteservice.org` is used only with a routing `apiKey`, `router.project-osrm.org` only without one. Scripts need nothing extra (the editor uses no `eval`), except `script-src https://cdn.jsdelivr.net` for the MapLibre 6 worker default above.

---

## Attribution

Element shows the credits of what it uses, in the map's attribution control:

- Built-in sources carry their credits. When you point a tile source at another server, give its `attribution` in the object form. Without one, Element drops the default provider's credit (OpenFreeMap, Mapterhorn), keeps "© OpenStreetMap contributors" for vector and OSM raster tiles (their data is OSM), and logs a development warning.
- The geocoder credit shows while the search box is offered: "Geocoding by Nominatim" on the default server, `nominatim.attribution` on yours (none, with a development warning, if you set no attribution).
- The OpenRouteService credit shows while the Route tool routes through ORS; `routing.attribution` replaces it for your own router.
- Shapes from the Picker are OpenStreetMap data (ODbL): if you publish them, credit OpenStreetMap.

On the drop-in the credits show expanded at load and fold into an "i" button on the first map interaction or after five seconds, as the [OSM Foundation attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) allow; see [Basemaps → Attribution](./basemaps.md#attribution). Sources you add yourself need their own `attribution`, and the control must stay visible.

---

## Migrating

| Before | Now |
|---|---|
| `spriteUrl` prop / `BasemapControl spriteUrl` / `{ spriteUrl }` option (0.2 pre-releases) | `config.network.sprite` (`{ network }` option of `loadBasemapStyle` / `setBasemap`) |
| `configureOverpass({ endpoint, timeoutMs, fetch })` (page-wide, 0.2 pre-releases) | `config.network.overpass` + `config.network.fetch` (per editor), or per call in `fetchOverpassFeatures` |
| `routingApiKey` prop (deprecated, still works with a dev warning) | `config.network.routing.apiKey`, which wins when both are set |
| `setRoutingApiKey()` (deprecated) | `config.network.routing.apiKey`, or `fetchRoute(waypoints, { apiKey })` |
