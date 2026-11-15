# Transform

*Scale and rotate selected features.*

The transform tool places handles around a selected feature (or group of features) that let you scale and rotate without touching individual vertices. It is the fastest way to resize a polygon or spin a linestring to a new orientation.

---

## Activating transform

Select one or more features, then:

- Press `A` (default key, configurable)
- Click the transform button in the editing toolbar

Transform handles appear around the bounding box of the selected feature(s).

Press `A` again or `Escape`, or click empty map, to exit transform mode. Clicking the selected feature (or another feature) keeps transform on. Each drag is committed as it ends and is one undo step.

---

## Moving

Press anywhere inside the box (on a selected feature or on the empty space around it) and drag to move the whole selection; the map doesn't pan. With several features selected, a plain drag on any one of them moves them all. A press without a drag stays a click. This works the same on Leaflet and MapLibre.

---

## Handles

| Handle | Position | Action |
|---|---|---|
| **Corner handles** (4) | Corners of the bounding box | Drag to scale both directions |
| **Edge handles** (4) | Middle of each side of the bounding box | Drag to scale in one direction only (width or height) |
| **Rotate handle** | Above the middle of the top side | Drag to rotate around the centre of the box |

After a rotation the box stays rotated with the shape, and the handles scale along its rotated sides.

---

## Scaling

Drag a corner handle to resize the feature in both directions, or an edge handle to stretch it in one. The opposite corner or side stays where it is. By default the two directions scale independently, so the shape can change proportions.

- **Shift:** uniform scale on every handle. Both directions scale by the same factor, so the shape keeps its proportions: a corner follows the box's diagonal, and an edge handle grows or shrinks the other direction with it.
- **Alt / Option:** scale from the centre of the box instead of the opposite corner or side. Combine it with Shift for a uniform scale from the centre.

You can press or release either key mid-drag; the preview updates at once. Both work the same on Leaflet and MapLibre.

**Mercator correction:** a uniform (Shift) scale runs point by point in the map's Web Mercator projection, so the shape keeps its on-screen proportions at any latitude, even when it spans many degrees. A free scale corrects for latitude at the anchor point, which is exact for shapes of ordinary size. Both are automatic and need no configuration.

---

## Rotating

Drag the rotate handle (above the top edge of the bounding box) to rotate the feature around the centre of the box, the same point on Leaflet and MapLibre (not the average of the shape's points, which can sit off-centre). Rotation is continuous — drag further for a larger angle; there is no angle snapping.

---

## Multi-feature transform

When multiple features are selected, all selected features transform together around one box that contains all of them: scaling anchors at that box's opposite corner or side (or its centre with Alt / Option), and rotation turns them around the centre of that box.

This means selecting two features and scaling down will shrink both features and move them closer together, maintaining their relative positions.

---

## Routes and transforms

Applying a transform to a route (`_drawType: 'route'`) moves the geometry away from the road network it was originally snapped to. A one-time warning fires per session when the transform box opens on a route. The transform proceeds normally after the warning; the route keeps `_drawType: 'route'` and its `_waypoints` (only editing its points makes it a plain line, see [Drawing tools](./drawing-tools.md#route)).

> **Note:** The warning fires once per session, not once per route. If you dismiss it and later transform a different route, no second warning appears.

---

## Undo

Each transform operation is a single undo step. Press `Cmd/Ctrl+Z` to revert the last scale or rotation. Move, scale and rotate keep each point's altitude (Z).
