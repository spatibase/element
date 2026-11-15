# Geometry processing

*Reshape existing features with Buffer, Simplify, Smooth, Break apart, and Merge.*

Buffer, Simplify and Smooth modify the geometry of an already-drawn feature. They appear in the editing toolbar (and the feature's right-click menu) when a single `Polygon`, `MultiPolygon`, `LineString` or `MultiLineString` is selected; they are not offered for points or geometry collections. All three show a live ghost preview before you commit, so you can tune the result without permanently altering the feature. The previews are computed in a background worker, so the map stays responsive while you drag a slider.

---

## Buffer

Expand or contract a polygon by a fixed distance, or turn a line into the corridor polygon around it. Useful for proximity analysis (e.g. "everything within 200 m of this boundary" or "200 m either side of this road") or for rough offset shapes.

**Supported geometry:** `Polygon`, `MultiPolygon`, `LineString`, `MultiLineString`. The result is always a `Polygon` or `MultiPolygon`.

### How to use

1. Select a single polygon or line feature.
2. Click **Buffer** in the editing toolbar.
3. Drag the distance slider. Positive values expand the polygon outward; negative values shrink it inward. Range: −500 m to +2,000 m (the slider is stored in metres regardless of the displayed unit). For a line the slider starts at 0: a line has no inside to shrink into, so a distance of 0 or less gives no preview and **Apply** stays disabled.
4. Toggle the unit label to switch between small / large display units. The pair follows `config.units.length`: `m` ↔ `km` for metric, `ft` ↔ `mi` for imperial. Storage is always metres — the conversion happens at the input boundary.
5. Choose whether to **replace** the original feature or **create a new shape** alongside it (the **New shape** toggle, on by default).
   - **New shape on:** the buffer is added as a new feature named `"<source name> (buffer)"`, placed directly below the source in the layer list. The source feature is unchanged.
   - **New shape off:** the source feature's geometry is replaced by the buffer. For a line this means the feature becomes a polygon (same id, properties and schema).
6. Press `Enter` or click **Apply** to commit. Press `Escape` to cancel.

A dashed outline of the buffered shape updates as you drag the slider, leaving the original feature visible underneath. With **New shape** off, the original is drawn as a faint grey ghost instead.

Apply is a single undo step in both modes.

### Notes

- The buffer preview is computed in a background worker, so the map stays responsive while you drag the slider. Only the latest slider value is kept; a computation that takes longer than 30 seconds is abandoned.
- Shrinking a polygon too far (below zero area) produces an empty result: the preview disappears and **Apply** stays disabled, so the feature is never replaced. The failure is reported to `onError` (no toast).
- A buffered circle, rectangle or route is a plain polygon afterwards: the result drops `_drawType` (and a route's `properties._waypoints`), so its vertices edit freely (no warning is shown). With **Create new**, the new polygon doesn't inherit `_waypoints` either.

---

## Simplify

Reduce the vertex count of a polygon or line using the Ramer–Douglas–Peucker algorithm (`@turf/simplify`). Use this to clean up overly-dense geometry imported from external sources, or to reduce file size before export.

**Supported geometry:** `Polygon`, `MultiPolygon`, `LineString`, `MultiLineString`.

### How to use

1. Select a single feature.
2. Click **Simplify** in the editing toolbar.
3. Drag the tolerance slider (0–100). The slider maps to a fraction of the feature's own bounding-box diagonal with a quadratic curve — small values at the low end give fine control, large values at the high end produce aggressive reduction. The label shows the resolved tolerance in your configured length unit (`<1 m`, `12 m`, `1.4 km`, etc.).
4. The node count change is shown in real time (e.g. "120 → 78 nodes (−42)").
5. Press `Enter` or click **Apply** to commit the simplified shape (one undo step). Press `Escape` or click **Cancel** to keep the original. Apply is disabled until the slider removes at least one node.

### Notes

- Tolerance is **adaptive**: the same slider position produces a sensible result whether the feature is a 30 m GPS track or a country outline. The bbox diagonal sets the scale, so feature size doesn't matter.
- Simplification removes vertices. It never adds them.
- A line stays a line: its first and last points are always kept, so at the highest tolerance it collapses to a straight segment between its endpoints, never to nothing. Each part of a `MultiLineString` is simplified separately.
- Tolerance 0 is lossless; tolerance 100 caps at 30 % of the bbox diagonal — enough to flatten most natural shapes without collapsing them.
- Applying Simplify (or Smooth) to a circle, rectangle or route removes the `_drawType` constraint and a route's `properties._waypoints`: the shape becomes a plain polygon / line (no warning is shown).

---

## Smooth

Add vertices to a polygon or line to produce a softer, rounder shape, using Chaikin corner cutting (Turf's `polygon-smooth` for polygons; the same scheme for lines, which stay open). Use this after importing sharp administrative boundaries, or to give manually-drawn areas a more natural appearance.

**Supported geometry:** `Polygon`, `MultiPolygon`, `LineString`, `MultiLineString`.

### How to use

1. Select a single feature.
2. Click **Smooth** in the editing toolbar.
3. Drag the passes slider (1–5). Each pass adds vertices and rounds corners further. The node count change is shown (e.g. "40 → 168 nodes (+128)").
4. Press `Enter` or click **Apply** to commit (one undo step). Press `Escape` or click **Cancel** to cancel.

### Notes

- Smooth increases vertex count. Combine with Simplify if the result is denser than needed.
- A smoothed line stays open: its first and last points don't move, only the corners in between are rounded. Each pass roughly doubles a line's point count. A line with only two points has no corners and is left as is.
- Like Simplify, Smooth strips `_drawType` from circles, rectangles and routes.
- At 5 passes, complex polygons may accumulate thousands of vertices. Check the vertex count delta before committing if file size matters.

---

## Break apart

Split a multi-geometry feature into individual features. Each part becomes its own entry in the feature collection, inheriting the original feature's properties, schema and group; the first part keeps the original's id. A circle, rectangle or route tag (`_drawType`) is dropped.

**Supported geometry:** `MultiPoint`, `MultiLineString`, `MultiPolygon`, and `GeometryCollection` (each member geometry becomes a feature; a `Multi*` member stays one feature, so break it apart again if needed). The feature needs at least two parts, and the extra features count against `maxFeatures`.

### How to use

1. Select a single multi-part feature.
2. Click **Break apart** in the editing toolbar (or press `B`, the default shortcut).
3. The feature is immediately replaced by its parts, in one undo step.

---

## Merge

Combine two or more selected features of the same geometry type into a single multi-geometry feature.

**Supported geometry:** Any.

| Input types | Output |
|---|---|
| 2+ `Point` / `MultiPoint` | `MultiPoint` |
| 2+ `LineString` / `MultiLineString` | `MultiLineString` |
| 2+ `Polygon` / `MultiPolygon` | `MultiPolygon` |
| Mixed types | `GeometryCollection` |

### How to use

1. Select two or more features (`Shift+click` or lasso).
2. Click **Merge** in the editing toolbar.
3. The selected features are combined into a single multi-geometry feature. Properties from the first-selected feature are retained; properties from the others are discarded.

### Notes

- Merge collects the parts without dissolving shared borders. Overlapping polygons stay overlapping parts. To dissolve them into one outline, use **Union** in [Boolean operations](./boolean-operations.md).
- The merge result is a single undo step.
