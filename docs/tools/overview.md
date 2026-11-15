# Tools overview

*All drawing tools and editing modes at a glance.*

Element organises its capabilities into two groups: drawing tools that create new features, and editing modes that operate on existing ones. The sections below give you a quick reference; each tool and mode has its own detailed page.

## Drawing tools

| Tool | Default key | Produces | Personality |
|---|---|---|---|
| Area (`'polygon'`) | `G` | `Polygon` | Versatile |
| Line | `L` | `LineString` | Straightforward |
| Point | `P` | `Point` | Minimal |
| Rectangle | `R` | `Polygon` (`_drawType: 'rectangle'`) | Principled |
| Circle | `O` | `Polygon` (`_drawType: 'circle'`) | Existentially complicated |
| Freehand | `F` | `LineString` or `Polygon` (simplified) | Chaotic good |
| Route | `C` | `LineString` (`_drawType: 'route'`) | Opinionated |
| Picker | `X` | The OpenStreetMap shape you click | Borrowed |

> **Note:** Default keys are configurable. Press `K` to open the shortcuts panel and remap any tool key. The keys above reflect factory defaults; your users may have changed them.

## Editing modes

| Mode | Activation | What it does |
|---|---|---|
| Vertex editing | Double-click feature or `Enter` | Drag, insert, and delete individual coordinates |
| Transform | `A` | Scale and rotate selected features |
| Selection | Click / `Shift+click` / `Shift+drag` | Select one or more features for further operations |
| Snapping | Active automatically (configurable) | Constrains cursor to nearby vertices and edges while drawing or editing |
| Boolean operations | Union, subtract, intersect, exclude: their own buttons next to the editing toolbar, with 2+ areas selected (union also joins 2+ lines). Cut hole (`H`) and slice (`J`): editing toolbar, with exactly 1 area selected | Union, intersect, subtract, exclude, cut hole, slice |
| Measure | `M` | Measure distances and areas without adding features to the map |

## Geometry processing tools

These tools modify the geometry of a selected feature.

| Tool | What it does |
|---|---|
| Buffer | Expand or contract a polygon, or turn a line into a corridor polygon, by a fixed distance (−500 m to +2,000 m; lines 0 m up) |
| Simplify | Reduce vertex count using the Ramer–Douglas–Peucker algorithm |
| Smooth | Round and soften a polygon or line by adding vertices (1–5 passes) |
| Break apart | Split a `Multi*` or `GeometryCollection` feature into one feature per part |
| Merge | Combine 2+ same-type features into a single `Multi*` feature |

The editing toolbar adapts to the current selection — only relevant actions appear:

- **Point** selected → Duplicate, Delete
- **MultiPoint** / **GeometryCollection** selected → Transform, Break apart, Duplicate, Delete
- **LineString** / **MultiLineString** selected → Transform, Simplify, Smooth, Buffer, Duplicate, Delete (plus Break apart on Multi*)
- **Polygon** / **MultiPolygon** selected → Transform, Cut hole, Slice, Simplify, Smooth, Buffer, Duplicate, Delete (plus Break apart on Multi*)
- Multiple features selected → Transform, Merge, Duplicate, Delete, plus Union / Subtract / Intersect / Exclude unless they are all points (subtract, intersect and exclude need all areas)

## Detailed pages

- [Drawing tools](./drawing-tools.md) — how each of the 8 tools works, output geometry, constraints
- [Vertex editing](./vertex-editing.md) — moving, inserting, and deleting coordinates
- [Transform](./transform.md) — scale and rotate
- [Selection](./selection.md) — single, multi, lasso, context menu
- [Boolean operations](./boolean-operations.md) — union, intersect, subtract, cut hole, slice
- [Geometry processing](./geometry-processing.md) — buffer, simplify, smooth, break apart, merge
- [Measure](./measure.md) — distance and area measurement overlay
- [Snapping](./snapping.md) — snap targets, radius, toggling
- [Import and export](./import-export.md) — file, paste, Google Sheets helpers
- [Data table](./data-table.md) — spreadsheet view of features and properties
- [Keyboard shortcuts](./keyboard-shortcuts.md) — complete shortcut reference, remapping

## The `_drawType` foreign member

Three tools — rectangle, circle, and route — produce standard GeoJSON geometry types (`Polygon` or `LineString`) but attach a `_drawType` foreign member to record the original drawing intent. Element uses it to warn before an edit would turn the shape into a plain polygon or line (vertex edit on a circle, rectangle or route; route alignment warnings when transforming). The first committed point change removes the tag.

```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[...]] },
  "properties": {},
  "_drawType": "circle"
}
```

Do not strip `_drawType` when round-tripping data through a backend. Without it, Element treats the shape as a plain polygon and removes the associated constraints.
