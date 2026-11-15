# Snapping

*Constrain the cursor to nearby vertices and edges while drawing.*

Snapping helps you place vertices precisely — aligning new geometry to existing features without needing pixel-perfect cursor placement. When the cursor moves within snap radius of a valid target, it locks to that position and a visual indicator appears on the map.

---

## What snapping does

As you draw or drag vertices, Element continuously evaluates nearby geometry. When a snap target falls within the snap radius, the cursor position is replaced with the exact coordinates of the target. The change is immediate and live — you see the snap before you click.

---

## Snap targets

Snapping recognises two target types:

| Target | Description |
|---|---|
| **Vertex** | An existing point of any feature: a point, a line's points, a polygon's corners |
| **Edge** | The nearest point on any line segment or polygon side, anywhere along it |

When both are within the snap radius, the vertex wins. Every geometry type is a snap target, on both engines: `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon` (including holes), `MultiPolygon` and every member of a `GeometryCollection`. Points and the points of a `MultiPoint` are vertex targets only (there is no edge between two points of a `MultiPoint`). A feature you just added under a still cursor isn't a target until the cursor leaves it.

---

## Snap radius

The snap radius is **15 pixels** on screen. This means the geographic distance at which snapping activates scales with the current zoom level — at higher zoom levels you need to be geographically closer to trigger a snap. At lower zoom levels, snapping covers a wider geographic area.

---

## When snapping is active

Snapping applies to every click-placed point:

- The Point, Line, Area, Rectangle, Circle and Route tools
- Cut hole and Slice shape (the hole's outline and the cutting line)
- Measure
- Vertex editing — dragging a point snaps to other features' points and edges

Freehand drawing doesn't snap.

**Angle snapping is separate:** hold `Shift` while drawing a line, area, route, hole or slice line to lock the next segment to 15° steps from the previous point.

---

## Same-feature exclusion

Snap targets belonging to the feature currently being edited are excluded. This prevents a vertex from snapping to another vertex on the same polygon, which would cause accidental self-snapping during vertex edit.

---

## Visual indicator

When the cursor snaps to a target, a snap indicator appears on the map at the snapped position: a small circle on a vertex, a small diamond on an edge. The cursor coordinate updates to match. The indicator disappears when you move outside the snap radius.

The snap circle is suppressed over existing vertex nodes during vertex editing to reduce visual noise — the vertex handle itself makes the target obvious.

---

## Toggling snapping

Snapping is **enabled by default**. To toggle it:

- Open the **Settings** panel (gear icon in the bottom toolbar)
- Use the snap toggle

The setting lasts until the page reloads; it isn't saved. There is no prop to disable snapping programmatically from the host application.

**Temporarily disable with Cmd/Ctrl:** While snapping is on, hold `Cmd` (macOS) or `Ctrl` (Windows/Linux) at any moment while drawing or dragging a vertex to bypass the snap for that gesture. Release the modifier to re-engage. Useful for placing a vertex *near* but not *on* an existing point.

> **Tip:** If you are drawing geometry that must not align to existing features — for example, a freehand sketch over a basemap — turning off snapping avoids inadvertent alignment to nearby features.
