# GeoJSON primer

*Everything Element needs you to know about the data format — and nothing more.*

---

## What GeoJSON is

GeoJSON is an open standard (RFC 7946) for representing geographic features as JSON. An Element `FeatureCollection` is valid GeoJSON — you can take it anywhere: store it in a database, serve it from an API, load it in QGIS, or pass it to any other library that speaks GeoJSON.

You don't need to construct GeoJSON by hand. Element's `onChange` callback gives you a valid `FeatureCollection` on every change. This primer exists so you understand what you're receiving — not because you need to produce it.

---

## Geometry types

GeoJSON defines seven geometry types. Element's drawing tools create Points, LineStrings and Polygons, and merging creates the Multi* types. Imported data can use any of the seven, including MultiPoint and GeometryCollection. The common ones:

### Point

A single location on the map. Coordinates are `[longitude, latitude]`.

```json
{
  "type": "Point",
  "coordinates": [-0.1276, 51.5074]
}
```

### LineString

An ordered sequence of two or more points. Represents paths, roads, routes, or any linear feature.

```json
{
  "type": "LineString",
  "coordinates": [
    [-0.1276, 51.5074],
    [-0.0994, 51.5142],
    [-0.0753, 51.5084]
  ]
}
```

### Polygon

A closed shape. The first element in `coordinates` is the **outer ring** — a sequence of positions that closes back on itself (the first and last position must be identical). Additional elements are **inner rings** representing holes cut out of the polygon.

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [2.294, 48.858],
      [2.296, 48.858],
      [2.296, 48.860],
      [2.294, 48.860],
      [2.294, 48.858]
    ]
  ]
}
```

A polygon with a hole adds a second ring:

```json
{
  "type": "Polygon",
  "coordinates": [
    [[...outer ring...]],
    [[...inner hole ring...]]
  ]
}
```

### MultiPolygon

An array of Polygons. Used for features that are geographically discontinuous — a country with islands, a state with an exclave, a postal district split across a river.

```json
{
  "type": "MultiPolygon",
  "coordinates": [
    [[[...ring of polygon 1...]]],
    [[[...ring of polygon 2...]]]
  ]
}
```

### MultiLineString

An array of LineStrings. Used for road networks, river systems, or any feature composed of multiple distinct linear segments.

```json
{
  "type": "MultiLineString",
  "coordinates": [
    [[...line 1 coordinates...]],
    [[...line 2 coordinates...]]
  ]
}
```

---

## Feature

A geometry on its own is just a shape — no identity, no data. A **Feature** wraps a geometry with an `id` and a `properties` object that holds the feature's attributes.

```json
{
  "type": "Feature",
  "id": "3f2a1c9b-...",
  "geometry": {
    "type": "Point",
    "coordinates": [-0.1276, 51.5074]
  },
  "properties": {
    "name": "Trafalgar Square",
    "category": "landmark",
    "capacity": 10000
  }
}
```

The `properties` object can hold anything. When you define a schema in Element, the property names are the field `key`s from your schema definition.

---

## FeatureCollection

A **FeatureCollection** is an array of Features. This is the top-level object Element's `onChange` callback gives you on every change.

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "id": "...", "geometry": { ... }, "properties": { ... } },
    { "type": "Feature", "id": "...", "geometry": { ... }, "properties": { ... } }
  ]
}
```

---

## The coordinate order trap

GeoJSON coordinates are `[longitude, latitude]` — mathematically sensible (x before y), but the opposite of how English speakers say "latitude and longitude." If you've been writing map code for any length of time, you have already been bitten by this at least once. Element handles the conversion at every map boundary so you never flip coordinates yourself. But if you inspect raw coordinates and the numbers look backwards, that's why.

---

## What Element adds to GeoJSON

Standard GeoJSON has no concept of schemas, groups, or drawing tool history. Element extends the format with a few foreign members, all within the rules of RFC 7946: `metadata` on the collection, and `schemaId`, `groupId`, `hidden` and `_drawType` on features.

### `metadata` on FeatureCollection

Element adds a `metadata` envelope to the root `FeatureCollection` object. This is where schema definitions and feature groups travel with the data — so when you export and re-import a file, the full editor state is preserved.

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "schemas": [
      {
        "id": "location",
        "name": "Location",
        "fields": [
          { "key": "name", "label": "Name", "type": "text", "required": true },
          { "key": "category", "label": "Category", "type": "select", "required": false, "options": ["park", "hospital", "school"] }
        ]
      }
    ],
    "groups": []
  },
  "features": [...]
}
```

### `_drawType` on features

When a user draws a circle, rectangle, or route, GeoJSON has no way to record that intent — a circle is stored as a Polygon; a rectangle is stored as a Polygon; a route is stored as a LineString. Element adds a `_drawType` foreign member to those features so it can recover the original intent.

RFC 7946 §6.1 explicitly permits extension members on Feature objects. Element uses the underscore prefix convention to signal that these are application-specific extensions.

```json
{
  "type": "Feature",
  "id": "...",
  "geometry": { "type": "Polygon", "coordinates": [...] },
  "properties": {},
  "_drawType": "circle"
}
```

Possible values: `"circle"`, `"rectangle"`, `"route"`.

### `_waypoints` on route features

Route features carry an additional `_waypoints` field in `properties` — the original click points the user placed when drawing the route. These are the input coordinates sent to the routing API; Element records them but doesn't re-route from them. Editing the route's points, or simplifying, smoothing or buffering it, makes it a plain line: `_drawType` and `_waypoints` are both removed.

> **Warning:** Do not strip `_drawType` when round-tripping feature data through your backend. Element uses it to tell users what an edit will do: entering vertex edit on a circle or rectangle says the first point change turns it into a plain polygon (a route: a plain line), and Simplify / Smooth note when a circle or rectangle will lose its tag. The first point change, or a geometry operation (buffer, simplify, smooth, boolean ops), removes the tag; moving, rotating or scaling with the transform box keeps it. Strip it and Element treats the shape as a plain polygon or line.

---

> **Tip:** When you export a FeatureCollection from Element (via the export button or `ref.current.exportAs('geojson')`), the result is fully valid RFC 7946. Any tool, database, or API that accepts GeoJSON will accept it. The `metadata` and `_drawType` fields are ignored by tools that don't know about them.
