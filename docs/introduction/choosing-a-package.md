# Choosing a package

*Three questions to find your starting point.*

---

## The decision

### Question 1: Do you already have a Leaflet or MapLibre map in your application?

**No** — you don't have a map yet, or you want a fully self-contained editor without managing a map instance yourself.

→ Use **`@element-editor/react`**. It owns the map (MapLibre by default), the UI, and all editor state. You mount one component; everything else is handled for you. [Quick start →](../quickstart/react.md)

Prefer Leaflet for the drop-in? Import from `@element-editor/react/leaflet` instead (and install `@element-editor/adapter-leaflet leaflet react-leaflet`). Pick MapLibre unless you specifically need Leaflet: it has vector basemaps and a basemap picker with a theme-aware Auto option. Leaflet drop-in basemaps are raster only. See [Basemaps](../guides/basemaps.md).

**Yes** — you have an existing map and want to add editing tools to it.

→ Continue to Question 2.

---

### Question 2: Which map engine are you using?

**Leaflet or react-leaflet**

→ Use **`@element-editor/adapter-leaflet`**. It plugs into an existing `MapContainer` via `ElementEditorControls`. [Quick start →](../quickstart/adapter-leaflet.md)

**MapLibre GL JS, MapTiler SDK, or Mapbox GL JS**

→ Use **`@element-editor/adapter-maplibre`**. It accepts any map instance from this family — all three share the same underlying API lineage. [Quick start →](../quickstart/adapter-maplibre.md)

---

### Question 3: Do you need full control over the editor UI layout?

`ElementEditorControls` renders no buttons of its own: it adds the editing layer to your map. The toolbars, panels and modals come from **`@element-editor/ui`**, and you place them yourself.

**No** — you want the standard toolbar and panels.

→ Follow the adapter quick start. Its "Adding the full UI" section renders the standard set.

**Yes** — you need toolbars, panels, and modals at specific positions in your layout, or integrated with your own UI components.

→ Place the `@element-editor/ui` components where you need them. See [The `@element-editor/ui` path](#the-element-editorui-path) below and the [Custom UI with adapters guide](../guides/custom-ui-with-adapters.md).

---

## Summary table

| I want... | Package(s) |
|---|---|
| A full editor, no existing map | `@element-editor/react` (MapLibre) |
| A full editor on Leaflet | `@element-editor/react/leaflet` (+ `adapter-leaflet`, `leaflet`, `react-leaflet`) |
| Editing on my Leaflet map | `@element-editor/adapter-leaflet` |
| Editing on my MapLibre GL map | `@element-editor/adapter-maplibre` |
| Editing on my MapTiler SDK map | `@element-editor/adapter-maplibre` |
| Editing on my Mapbox GL JS map | `@element-editor/adapter-maplibre` |
| Full UI control (custom toolbar positions, layouts) | adapter + `@element-editor/ui` |

---

## The `@element-editor/ui` path

When you use an adapter, Element adds the editing interaction layer to your map but renders no visible UI. `@element-editor/ui` provides all the interface components — `FloatingToolbar`, `EditingToolbar`, `LayersPanel`, `DataTablePanel`, `SchemaModal`, `GeoJSONModal`, and more — as individual React components you can place anywhere in your layout.

This means you can build the same full-editor experience as `@element-editor/react` while controlling exactly where each piece lives: a toolbar docked to your application's sidebar, a data table in a bottom panel, modals triggered from your own navigation. The adapter handles the map editing layer; `@element-editor/ui` provides the interface components; you decide the layout.

The [Custom UI with adapters guide](../guides/custom-ui-with-adapters.md) shows the complete provider stack and placement patterns for both Leaflet and MapLibre.

---

> **Note:** `@element-editor/core` holds the shared TypeScript types (`FeatureCollection`, `GeoJSONFeature`, `Schema`, …) and is installed automatically with every Element package. `@element-editor/react` re-exports the common types; the adapters don't. With an adapter, add `@element-editor/core` to your `package.json` (same version as the adapter) and import the types from it:
>
> ```ts
> import type { FeatureCollection } from '@element-editor/react' // with @element-editor/react
> import type { FeatureCollection } from '@element-editor/core'  // with an adapter
> ```
