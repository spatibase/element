# Drawing tools

*Eight ways to put geometry on the map.*

Each drawing tool produces a distinct GeoJSON geometry type. Activate a tool from the floating toolbar or press its keyboard shortcut; press `Escape` to cancel at any point during drawing.

Seven tools draw new geometry from scratch. The eighth — **Picker** — imports an existing shape from OpenStreetMap by clicking on it.

---

## Behaviours common to every tool

A handful of conventions apply across the whole set, so you don't have to relearn them per tool:

- **Spacebar pans without dropping the tool.** Hold `Space` to drag the map, release to keep drawing. Useful for panning to a faraway anchor mid-shape.
- **Tools stay active after a shape.** By default the tool stays armed after you commit a shape, so you can draw several in a row; press the tool key again or `Esc` to exit. To drop back to selection after each shape, press `Cmd+J` / `Ctrl+J` or switch on **Return to select after each shape** in **Settings**. The choice is remembered in `localStorage`.
  - **One shape at a time, set by your app.** Pass `autoExitAfterDraw` to `<ElementEditor />` (or either adapter's `<ElementEditorControls />`) and every tool turns off after each finished shape; the new shape is selected and `onToolChange(null)` fires. The prop wins over the user's saved setting, is never saved to their browser, and the Settings toggle becomes read-only. `autoExitAfterDraw={false}` pins the opposite.

    ```tsx
    <ElementEditor autoExitAfterDraw onToolChange={(tool) => tool === null && save()} />
    ```
- **Backspace / Delete removes the last placed point** during multi-point drawing (line, area, route, slice, cut-hole, measure). The keyboard shortcut won't delete features while a draw is in progress.
- **Drag-to-draw on Rectangle and Circle.** Click-and-drag to size in one gesture. A Circle click without dragging places a default-sized circle (25 px radius) at the click point and selects it; a Rectangle click without dragging creates nothing, so a stray click never drops a shape.
- **Snap-aware.** If snapping is enabled (the default), each click locks to the nearest vertex or edge within 15 px. Hold `Cmd` / `Ctrl` to bypass snapping for the current gesture.
- **Touch: Done and Undo point.** With a finger, the drawing bar says "Tap" and shows **Done** (finishes the line, area or measurement, like `Enter`) and **Undo point** (removes the last point, like `Backspace`). Tapping the first point still closes an area. A mouse keeps the keyboard hints; the editor follows whichever you used last, so a touch laptop gets both. Headless hosts (only `ElementEditorControls`) get the same bar from the adapter; see [Custom UI with adapters](../guides/custom-ui-with-adapters.md#the-drawing-bar).
- **Modifier-aware cursor.** Holding a modifier (`Shift`, `Cmd`/`Ctrl`) updates the cursor to reflect the modifier's effect — a small hint that the next click will behave differently.

---

## Area

**Default key:** `G` | **Tool id:** `'polygon'` | **Produces:** `Polygon`

The general-purpose tool for closed shapes. Click to add points, building the area one corner at a time. A live preview follows the cursor so you can see what you're drawing before you commit.

**How to draw:**

1. Press `G` or click the **Area** tool in the toolbar.
2. Click to place the first vertex.
3. Continue clicking to add vertices.
4. Close the area by clicking the first vertex again, pressing `Enter`, or double-clicking. On a touch screen, tap the first point or **Done**.

Element doesn't check whether a polygon's edges cross each other (self-intersection), so you can save a polygon whose edges cross. Boolean operations may behave unexpectedly on such shapes.

**Minimum:** 3 vertices.

**Output geometry:**

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [2.35, 48.86],
      [2.37, 48.88],
      [2.39, 48.85],
      [2.35, 48.86]
    ]
  ]
}
```

---

## Line

**Default key:** `L` | **Produces:** `LineString`

Draws a multi-segment line between clicked waypoints.

**How to draw:**

1. Press `L` or click the Line tool.
2. Click to place the first point.
3. Continue clicking to add waypoints. A live preview follows the cursor.
4. Finish by pressing `Enter` or double-clicking the last point. On a touch screen, tap **Done**.

**Minimum:** 2 points.

**Output geometry:**

```json
{
  "type": "LineString",
  "coordinates": [
    [2.35, 48.86],
    [2.37, 48.88],
    [2.40, 48.84]
  ]
}
```

---

## Point

**Default key:** `P` | **Produces:** `Point`

Places a single coordinate on the map. One click, one feature.

**How to draw:**

1. Press `P` or click the Point tool.
2. Click the map to place the point. The feature is committed immediately.

**Output geometry:**

```json
{
  "type": "Point",
  "coordinates": [2.35, 48.86]
}
```

---

## Rectangle

**Default key:** `R` | **Produces:** `Polygon` with `_drawType: 'rectangle'`

Draws an axis-aligned bounding box by click-and-drag.

**How to draw:**

1. Press `R` or click the Rectangle tool.
2. Click and drag to define the bounding box. Release to commit.
3. Hold `Shift` while dragging to constrain to a perfect square.
4. A click without dragging creates nothing (no default rectangle): drag to size it.

**Editing a rectangle's points** turns it into a plain polygon, the same way as a circle. Entering vertex edit shows a notice ("Editing points will turn this rectangle into a plain shape."), but nothing changes yet: leave without moving, adding or deleting a point and it is still a rectangle. The first committed point change (drag a corner, insert, delete a corner, precise coordinates) moves only that point and removes `_drawType: 'rectangle'` in the same update (one undo step brings the rectangle back). Moving, rotating or scaling a rectangle with the transform box keeps it a rectangle.

- The `_drawType: 'rectangle'` foreign member is set on the feature. Do not strip it when round-tripping data.

**Output geometry:**

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [2.30, 48.82],
      [2.40, 48.82],
      [2.40, 48.90],
      [2.30, 48.90],
      [2.30, 48.82]
    ]
  ]
}
```

---

## Circle

**Default key:** `O` | **Produces:** `Polygon` with `_drawType: 'circle'`

Circles don't exist in GeoJSON. What you're drawing is stored as a polygon with 64 sides — a circle's understudy. It looks like a circle, it measures like a circle, and it will shatter your illusions the moment you open the raw GeoJSON. The `_drawType: 'circle'` foreign member is how Element remembers what was intended.

**How to draw:**

1. Press `O` or click the Circle tool.
2. Click and drag outward from the centre to set the radius. Release to commit.
3. A click without dragging creates a default-sized circle at the click point.

**Geometry modes** (configurable in Settings):

- **Visual** (default) — the circle appears as a geometrically correct circle on screen. Coordinates are Mercator-corrected for the current latitude, so the shape doesn't skew near the poles.
- **Spatial** — the circle is a geodesic circle on the actual Earth surface, accurate to a constant radius in metres regardless of latitude.

**Editing a circle's points** turns it into a plain polygon. Entering vertex edit shows a notice ("Editing points will turn this circle into a plain shape."), but nothing changes yet: leave without moving, adding or deleting a point and it is still a circle. The first committed point change (drag, insert, delete, precise coordinates) removes `_drawType: 'circle'` in the same update (one undo step brings the circle back). Moving, rotating or scaling a circle with the transform box keeps it a circle.

**Output geometry:**

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [2.36, 48.87],
      [2.37, 48.87],
      "... 62 more coordinate pairs ...",
      [2.36, 48.87]
    ]
  ]
}
```

The `_drawType` is stored at the feature level, not inside `geometry`:

```json
{
  "type": "Feature",
  "id": "abc123",
  "_drawType": "circle",
  "geometry": { "type": "Polygon", "coordinates": [[...]] },
  "properties": {}
}
```

---

## Freehand

**Default key:** `F` | **Produces:** `LineString` (open, the default) or `Polygon` (closed) — both simplified

Click and drag to draw a continuous freehand path. Release to commit.

The resulting path is automatically simplified with the Ramer–Douglas–Peucker algorithm to reduce vertex count. If you draw with the steady hand of a surgeon, you'll barely notice. If you draw like you're writing cursive with your non-dominant hand, the simplification will do you a favour.

The active toolbar exposes a **Closed shape** toggle while Freehand is selected. Off commits a `LineString`; on commits a `Polygon` (the first and last points are joined automatically).

**How to draw:**

1. Press `F` or click the Freehand tool.
2. Optional: toggle between **open line** and **closed shape** in the active toolbar.
3. Click and hold the mouse button.
4. Drag to draw the path.
5. Release to commit. Simplification runs immediately on release.

**Output geometry:**

```json
{
  "type": "LineString",
  "coordinates": [
    [2.32, 48.84],
    [2.34, 48.86],
    [2.37, 48.85]
  ]
}
```

The coordinate count after simplification depends on the complexity of the drawn path. A smooth arc may produce 5–10 vertices; a highly irregular scribble may retain 50+.

---

## Route

**Default key:** `C` | **Produces:** `LineString` with `_drawType: 'route'`

The route tool calls a routing service (by default the public OSRM demo server; OpenRouteService or your own router in production) to snap your clicks to actual road networks. The resulting line follows streets, bridges, and tunnels rather than cutting through buildings. Whether this is more or less useful than cutting through buildings depends entirely on your use case.

**How to draw:**

1. Press `C` or click the Route tool.
2. Click to place the first waypoint.
3. Continue clicking to add waypoints. Each segment is resolved against the road network before display.
4. Press `Enter` or double-click to commit the full route.

**Routing service:** set it in `config.network.routing`, per editor (two editors on one page can use different keys or servers):

```tsx
<ElementEditor config={{ network: { routing: { apiKey: 'your-openrouteservice-api-key' } } }} />
// or your own OSRM: { routing: { url: 'https://osrm.example.com/route/v1/foot' } }
// or a self-hosted ORS: { routing: { provider: 'ors', url: 'https://ors.example.com/ors/v2/directions/foot-walking/geojson' } }
```

> **Without `routing`, the Route tool uses the public OSRM demo server**: car-only (routes follow roads, never footpaths), rate-limited and **not for production**. A development warning says so the first time it's used. Get a free OpenRouteService key at [openrouteservice.org](https://openrouteservice.org/dev/#/signup) or run your own router. `routing: false` hides the Route tool. With ORS the credit "© openrouteservice.org by HeiGIT" is shown automatically. See [Third-party services and self-hosting](../guides/third-party-services.md).

The `routingApiKey` prop (on `<ElementEditor>` or an adapter's `ElementEditorControls`) still works but is deprecated (dev warning); `config.network.routing.apiKey` wins over it. To call the router yourself, use `fetchRoute(waypoints, { provider, url, apiKey, fetch, signal })` from `@element-editor/core`. It returns `[lng, lat]` coordinates and uses OpenRouteService when `apiKey` is set (or `provider: 'ors'`), OSRM otherwise. The older `setRoutingApiKey(key)` global is deprecated: two editors on one page would overwrite each other's key.

**Constraints:**

- The original click waypoints are stored in `properties._waypoints`: the points the route was requested with. Element records them but doesn't re-route from them.
- **Editing a route's points** turns it into a plain line. Entering vertex edit shows a notice ("Editing points will turn this route into a plain line."); the first committed point change removes `_drawType: 'route'` and `properties._waypoints` in the same update. Leaving vertex edit without a change keeps the route.
- Simplify, smooth and buffer (and any other operation that replaces the geometry) also make it a plain line or polygon: `_drawType` and `_waypoints` both go.
- Moving, rotating or scaling a route with the transform box keeps `_drawType: 'route'` and `_waypoints` (the waypoints stay where they were clicked), but the line no longer follows the roads; a one-time warning per session says so.

**Output geometry:**

```json
{
  "type": "Feature",
  "id": "abc123",
  "_drawType": "route",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [2.35, 48.86],
      [2.355, 48.863],
      [2.36, 48.868]
    ]
  },
  "properties": {
    "_waypoints": [
      [2.35, 48.86],
      [2.36, 48.87]
    ]
  }
}
```

---

## Picker

**Default key:** `X` | **Produces:** `Polygon` or `LineString` imported from OpenStreetMap

The picker doesn't draw — it imports. Click anywhere on the map and Element finds the shapes under the click (buildings, parks, water bodies, land use, etc.) and drops the one you clicked into your FeatureCollection as an editable feature. On MapLibre with an OpenMapTiles-schema vector basemap (the built-in OpenFreeMap styles), the shapes come straight from the loaded map tiles: instant, no network request. Otherwise (Leaflet, raster or other basemaps, or nothing in the tiles at that spot) Element queries the Overpass API; a pulse marker shows while that runs.

**How to use:**

1. Press `X` or click the Picker tool in the toolbar.
2. Click anywhere on the map. Requires zoom level ≥ 15 — below that you'll see a "Zoom in" hint.
3. If one feature is found, it's imported immediately. If several candidates overlap the click point, a popup lists them (coloured by overlay). Click a candidate (on the map or in the popup) to pick it.
4. Picker mode stays active for repeated picks. Press `Escape` or click the Picker button again to exit.

**What gets imported:**

- The raw OSM geometry (polygon or linestring) in WGS84.
- The OSM `name` tag as the feature's `name` property. Other tags are discarded — the shape becomes a plain feature using your default schema.
- Once imported, the feature is identical to any other: editable, snappable, exportable. It does not retain an OSM id or tag reference.

**Constraints:**

- The search radius scales with zoom: 80 m at z18, 150 m at z17, 250 m at z16, 400 m at z15.
- The Overpass fallback uses the public Overpass API, which is often at capacity. Element retries a busy or rate-limited server (502/503/504/429) twice (1 s, then 2.5 s, or the server's `Retry-After` up to 10 s) before showing "Map data server is busy" / "Too many requests". Each attempt times out after 15 s ("took too long"); a network error isn't retried. `Escape` cancels a lookup in progress. Heavy production use should point at your own instance, per editor:

  ```tsx
  <ElementEditor
    config={{
      network: {
        overpass: { endpoint: 'https://overpass.example.com/api/interpreter', timeoutMs: 10_000 }, // defaults: overpass-api.de, 15000 per attempt
        fetch: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, Authorization: 'Bearer …' } }), // all of Element's own requests
      },
    }}
  />
  ```

  `overpass: false` makes the Picker read only the basemap's vector tiles ("No shape here in the basemap" where they have nothing; hidden on Leaflet). Called directly, `fetchOverpassFeatures(lat, lon, radius, click, { endpoint, timeoutMs, fetch, signal })` takes the same settings. A failed lookup rejects with an `OverpassError` whose `code` is `'rate-limited' | 'busy' | 'timeout' | 'network'`; `overpassErrorMessage(err)` turns it into the toast text.
- Attribution: imported shapes originate from OpenStreetMap contributors and are licensed [ODbL](https://www.openstreetmap.org/copyright). If you display Element output publicly, attribute OSM.

**When to use Picker vs the other tools:**

Use Picker when the shape you want already exists in OSM (a specific park, lake, building footprint, street) — click it instead of tracing it. Use Area or Freehand when you're defining your own area that doesn't correspond to a real-world feature.

---

## Restricting available tools

Pass `config.tools` to limit which tools appear in the toolbar and respond to keyboard shortcuts:

```tsx
<ElementEditor config={{ tools: ['polygon', 'line', 'point'] }} onChange={handleChange} />
```

Tools not in the array are hidden and their keyboard shortcuts are suppressed. Tool ids keep their GeoJSON names, so the **Area** tool is `'polygon'`. The full union of valid tool names:

```ts
type DrawTool =
  | 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route' | 'picker'
  | 'measure' | 'search'
```

`measure` and `search` aren't drawing tools in the strict sense — `measure` is the distance/area overlay, `search` is the place-search input — but both live in the same toolbar and respect the same gating.

> **Tip:** If you omit `config.tools` or set it to `'all'` (the default), every tool is available. Pass `config={{ tools: [] }}` combined with `readonly` for a view-only map with no drawing capability.
