# Boolean operations

*Combine, subtract, and slice polygon features.*

Boolean operations transform the geometry of two or more polygon features into a new shape based on their spatial relationship. They run in a background worker, so the UI stays responsive while they compute.

---

## Prerequisites

- **Union, Subtract, Intersect, Exclude:** select **two or more** features. A separate group with these four buttons appears next to the editing toolbar whenever two or more features are selected (not when they are all points). Each button's tooltip says what it does (for example "Intersect: keep only the overlap"). Subtract, Intersect and Exclude need every selected feature to be a `Polygon` or `MultiPolygon`; Union also joins two or more lines (see [Union](#union)).
- **Cut Hole and Slice Shape:** select **exactly one** `Polygon` or `MultiPolygon`, then draw the hole or the cutting line. Their buttons are in the editing toolbar while one area is selected.

Each operation is one undo step. The result is a plain shape: a circle, rectangle or route loses its `_drawType`.

---

## Union

Merges all selected polygons into a single polygon covering their combined area. Overlapping regions are absorbed. Non-overlapping polygons that share no area produce a `MultiPolygon`. The result keeps the first selected feature's properties, schema and group, and replaces all the selected features.

With only lines selected, Union collects them into one `MultiLineString` (no geometry is dissolved, like [Merge](./geometry-processing.md#merge)).

Like a Venn diagram that gave up on the middle section.

**Input:** 2+ selected polygons (or 2+ lines)
**Output:** A single `Polygon` or `MultiPolygon` (lines: `MultiLineString`) replacing all selected features

---

## Intersect

Keeps only the area shared by all selected polygons. Areas covered by only one polygon are discarded. If the selected polygons have no area in common, nothing changes and an error says so ("Failed to perform intersect: No overlap found between the selected shapes.").

**Input:** 2+ selected polygons
**Output:** A `Polygon` (or `MultiPolygon`) of the intersection area, replacing all selected features

---

## Subtract

Removes the area of every other selected polygon from the **first selected** one. The subtracted regions are cut away; where another polygon lies fully inside the first, what remains is the first polygon with a hole punched through it.

Like a cookie cutter, but for data, and without the cookie.

**Input:** 2+ selected polygons. Selection order matters: click the polygon to keep first, then `Shift+click` the ones to subtract. Nothing on the map marks which shape was selected first; the button's tooltip, "Subtract: cut the others out of the first selected", is the reminder.
**Output:** The first polygon minus the others, replacing all selected features. If nothing is left, nothing changes and an error says so.

---

## Exclude (XOR)

Keeps the non-overlapping area and discards the overlap. This is the symmetric difference, applied pairwise in selection order: with two polygons, areas covered by exactly one survive and areas covered by both are removed.

**Input:** 2+ selected polygons
**Output:** A `Polygon` or `MultiPolygon` of the non-overlapping areas, replacing all selected features

---

## Cut Hole

Draws a shape inside an existing polygon and punches it out as an interior ring — a hole.

RFC 7946 calls them "holes". We call them "intentional absences."

**How to use:**

1. Select a single polygon feature.
2. Press `H` (default key, configurable) or click **Cut Hole** in the editing toolbar.
3. Draw the hole shape inside the polygon. Use the same click-to-add-vertices workflow as the Area tool.
4. Press `Enter` or double-click to commit.

The original polygon is replaced with a `Polygon` containing an interior ring. This is valid RFC 7946 GeoJSON. You can add multiple holes to a single polygon by repeating the process.

**Output geometry:**

```json
{
  "type": "Polygon",
  "coordinates": [
    [[2.30, 48.82], [2.40, 48.82], [2.40, 48.90], [2.30, 48.90], [2.30, 48.82]],
    [[2.33, 48.84], [2.37, 48.84], [2.37, 48.88], [2.33, 48.88], [2.33, 48.84]]
  ]
}
```

The first ring is the outer boundary; subsequent rings are holes.

---

## Slice Shape

Draws a line across a polygon to split it into two separate features.

Useful for administrative boundary work, land parcel splitting, and the occasional urge to divide things that didn't need dividing.

**How to use:**

1. Select a single polygon feature.
2. Press `J` (default key, configurable) or click **Slice** in the editing toolbar.
3. Draw a line that crosses the polygon from one edge to another.
4. Press `Enter` or double-click to commit.

The polygon is split along the drawn line. Each piece becomes a separate feature (a line that crosses the shape several times gives more than two), inheriting the original feature's properties; the first piece keeps the original's id. The whole slice is one undo step. If the line doesn't split the shape (it stops inside it or misses it), nothing changes and an error says "The line didn't cut the shape apart, so nothing changed. Draw it all the way across the shape." The same holds for a multi-part shape that doesn't gain a part.

> **Note:** Slice uses a thin buffer (0.01 m) around the drawn line to perform the cut. Very thin polygons or highly complex shapes near the slice line may produce unexpected results.

---

## Performance

Polygon union, intersect, subtract and exclude, cut hole and slice run in a background worker (`geometryWorker.ts`), so the main thread isn't blocked: a cut on a 50,000-vertex polygon takes seconds. While a polygon union, intersect, subtract or exclude runs, a "Working…" toast shows (unless you handle events yourself with `onEvent`). Where Web Workers aren't available, cut hole and slice fall back to the main thread. Line union only collects coordinates and runs on the main thread.
