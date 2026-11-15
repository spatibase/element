# What is Element

*A drawing and editing layer that plugs into your map.*

---

## The problem

Adding geometry editing to a web application is harder than it looks. Maps use coordinate systems that differ between libraries and formats. Drawing interactions need to handle complex FSM states: mid-draw, snapped, dragging a vertex, transforming a selection. Features have geometry constraints — circles and rectangles don't exist as such in GeoJSON, routes follow road networks. And all of that geometry still needs to be persisted, validated, and paired with structured property data from your domain.

Building this from scratch means months of work before your users can draw a single polygon. Element solves it at the library level.

---

## The architecture

Element is a *layer*, not a map.

With an adapter the map is yours: the basemap tiles, the tile provider, the initial viewport, the zoom controls, the search box — you own all of it. (The drop-in owns the map for you and ships a small basemap picker; see below.) Element sits on top and handles everything related to drawing and editing: the drawing tools, the cursor interactions, vertex handles, transform controls, snapping, boolean operations, and feature state management.

Think of it this way: the map is the canvas. Element is the brush set.

This design means you can use Element alongside any other map code you already have. Features drawn in Element are delivered as standard GeoJSON, which you can layer with your own map overlays, send to your backend, or pipe into any other geospatial tooling without a translation step.

---

## Two paths

**Drop-in (`@element-editor/react`):** You want a full map editor embedded in your application and don't want to assemble the pieces yourself. `@element-editor/react` is a self-contained `<ElementEditor />` component that owns its own MapLibre map (a Leaflet version lives at `@element-editor/react/leaflet`), its own UI, and its own state. It ships built-in basemaps and a picker. Drop it into a `<div>` with an explicit height and it works. Drawing tools, vertex editing, snapping, boolean operations, schema forms, data table, import/export — all included.

**Adapter (you own the map):** You already have a Leaflet or MapLibre map in your application. You want to add Element's editing tools to it without replacing your map setup. `@element-editor/adapter-leaflet` and `@element-editor/adapter-maplibre` add the editing layer as components that plug into your existing map instance. Your map stays exactly as it is; Element attaches the interaction layer on top. If you want the full editor UI — toolbars, panels, modals — you can also install `@element-editor/ui` and position those components wherever your layout needs them.

---

## What Element is not

With an adapter, Element does not create your map or choose its tiles (the MapLibre adapter's `BasemapControl` picker is opt-in). The toolbar's place search finds a place and can add it as a feature, and the Route tool calls a routing service only to produce a road-snapped `LineString`: Element shows no turn-by-turn instructions and doesn't replace your navigation layer. Every server it calls can be swapped or turned off in `config.network` ([Third-party services](../guides/third-party-services.md)).

Element is also not a data store. It delivers your feature data via callbacks; where that data goes is your concern. Element has no opinion about your backend, your database, or your state management library.

This scope discipline is intentional. A library that tries to own the basemap, the routing, the geocoder, and the editor invariably makes poor decisions about all four. Element does one thing: it lets users draw and edit geographic features.

---

## Unique capabilities

Most map editing libraries handle drawing and vertex editing. Element adds three capabilities that alternatives don't provide:

**Schema-driven property forms.** Every feature carries a `schemaId` linking it to a named schema. A schema defines typed fields — text, number, select, date, boolean — with optional validation rules. When a user selects a feature, they see a form generated from the schema. When they fill in fields, the values travel with the GeoJSON in the `properties` object. This means your features carry structured, validated domain data alongside their geometry, not just a loose bag of properties.

**Data table.** A spreadsheet-style view of all features and their properties, accessible at any time. Rows and map selection stay in sync: selecting a feature on the map highlights it in the table, and vice versa. Cells are editable inline. Columns come from the schema fields (one tab per schema, or all of them).

**GeoJSON inspector.** A live view of the raw GeoJSON for the current feature collection. Users can inspect and edit it directly — useful for debugging, for power users who want to paste coordinates, and for developers building integrations who want to see exactly what the `onChange` callback will deliver.
