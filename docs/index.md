# Element

*Map editing tools for developers.*

Element adds professional drawing and editing tools to web maps. Bring your Leaflet or MapLibre map — Element handles the editing layer: drawing, vertex editing, snapping, boolean operations, schema-driven property forms, and more.

---

## Start here

| I want... | Start here |
|---|---|
| A complete editor with zero map setup (MapLibre) | [Quick start: @element-editor/react](./quickstart/react.md) |
| The same drop-in on Leaflet | [Quick start: @element-editor/react](./quickstart/react.md#leaflet-drop-in) |
| Editing tools on my Leaflet map | [Quick start: Leaflet adapter](./quickstart/adapter-leaflet.md) |
| Editing tools on my MapLibre / MapTiler / Mapbox map | [Quick start: MapLibre adapter](./quickstart/adapter-maplibre.md) |
| Not sure which to use | [Choosing a package](./introduction/choosing-a-package.md) |

---

## Documentation

### Introduction
*Concepts, GeoJSON background, and package comparison*

- [What is Element](./introduction/what-is-element.md) — Architecture, what Element is and is not, unique capabilities
- [Choosing a package](./introduction/choosing-a-package.md) — Decision tree to the right quickstart in three questions
- [GeoJSON primer](./introduction/geojson-primer.md) — The data format Element works with, explained from scratch

### Quickstart
*Up and running in minutes*

- [Quick start: @element-editor/react](./quickstart/react.md) — Full editor, zero map setup (MapLibre by default, Leaflet via `/leaflet`)
- [Quick start: Leaflet adapter](./quickstart/adapter-leaflet.md) — Add editing to an existing Leaflet map
- [Quick start: MapLibre adapter](./quickstart/adapter-maplibre.md) — Add editing to MapLibre GL, MapTiler SDK, or Mapbox GL JS

### Guides
*Task-first how-tos for common patterns*

- [Migrating to 0.2](./guides/migrating-to-0.2.md) — Only if you used a 0.1 pre-release build: MapLibre default, `/leaflet` entry, bbox `bounds`, new install peers
- [Persisting data](./guides/persisting-data.md) — Get feature data into localStorage, a REST API, or a database
- [Live mode vs submit mode](./guides/live-vs-submit.md) — When to listen to every edit, when to wait for a Save click
- [Schema and validation](./guides/schema-and-validation.md) — Define typed property fields for your features
- [Configuring layout](./guides/configuring-layout.md) — Place every control with `config.ui.layout` or `withLayout`, groups, the status bar, your own buttons
- [Basemaps](./guides/basemaps.md) — Built-in basemaps, the picker, custom styles, Leaflet raster tiles
- [Third-party services and self-hosting](./guides/third-party-services.md) — Every server Element calls and `config.network`: own tiles, keys, Overpass, routing, geocoder; turning services off; attribution
- [Theming](./guides/theming.md) — Match the editor to your product's visual identity
- [Restricting tools](./guides/restricting-tools.md) — Control which drawing tools and editing actions are available
- [Custom UI with adapters](./guides/custom-ui-with-adapters.md) — Full editor UI with custom layout using `@element-editor/ui`
- [Using Element with Next.js](./guides/nextjs.md) — Client-only rendering for SSR compatibility
- [Working with large datasets](./guides/saving-large-datasets.md) — Performance patterns for hundreds or thousands of features

### Tools
*Feature encyclopedia — what each tool does, how to activate it, what it produces*

- [Tools overview](./tools/overview.md) — All drawing tools and editing modes at a glance
- [Drawing tools](./tools/drawing-tools.md) — Area, line, point, rectangle, circle, freehand, route, picker
- [Vertex editing](./tools/vertex-editing.md) — Move, insert, and delete individual coordinates
- [Transform](./tools/transform.md) — Scale and rotate selected features
- [Selection](./tools/selection.md) — Select one or more features to edit, delete, or transform
- [Boolean operations](./tools/boolean-operations.md) — Union, intersect, subtract, cut hole, slice
- [Geometry processing](./tools/geometry-processing.md) — Buffer, simplify, smooth, break apart, merge
- [Measure](./tools/measure.md) — Measure distances and areas
- [Snapping](./tools/snapping.md) — Constrain cursor to nearby vertices and edges
- [Import and export](./tools/import-export.md) — Load and save GeoJSON, drop files, paste text
- [Data table](./tools/data-table.md) — Spreadsheet view of all features and properties
- [Keyboard shortcuts](./tools/keyboard-shortcuts.md) — Default bindings and how to customise them

### Reference
*Complete API surface — props, types, events*

- [@element-editor/react](./reference/element-editor-react.md) — `ElementEditorProps`, `ElementEditorRef`, `ElementEditorConfig`, all exports
- [@element-editor/adapter-leaflet](./reference/adapter-leaflet.md) — `ElementEditorControlsProps`, `ElementEditorControlsRef`
- [@element-editor/adapter-maplibre](./reference/adapter-maplibre.md) — Same API plus `map` prop and `useMapLibre` hook
- [@element-editor/ui](./reference/element-editor-ui.md) — All UI components, providers, and hooks
- [Types](./reference/types.md) — `FeatureCollection`, `GeoJSONFeature`, `Schema`, and all shared interfaces
- [Events](./reference/events.md) — `onChange`, granular events, `onError` codes, `onEvent`, firing order

---

## Packages

| Package | What it does |
|---|---|
| `@element-editor/react` | Full editor. Owns the map (MapLibre by default; Leaflet via `@element-editor/react/leaflet`). Zero configuration. |
| `@element-editor/adapter-leaflet` | Editing layer for existing Leaflet maps. |
| `@element-editor/adapter-maplibre` | Editing layer for existing MapLibre GL, MapTiler SDK, and Mapbox GL JS maps. |
| `@element-editor/ui` | UI components (toolbars, panels, modals) for building custom editor layouts. |
| `@element-editor/core` | Stores, data types and helpers shared by all packages. Installed with each of them. |
