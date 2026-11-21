# Selection

*Select one or more features to edit, delete, or transform.*

Selection is the starting point for most editing operations. You cannot vertex-edit, transform, run boolean operations, or delete a feature without selecting it first.

---

## Single selection

Click any feature on the map. The feature highlights and its properties open in the side panel. Clicking a different feature deselects the current one and selects the new one.

---

## Multi-selection

**Add to selection:** `Shift+click` an additional feature. Each `Shift+click` toggles that feature in or out of the selection.

**Lasso selection:** `Shift+drag` on empty map space to draw a rubber-band rectangle. All features with any part inside the rectangle are added to the selection when you release.

**Select all:** `Cmd+A` (macOS) or `Ctrl+A` (Windows/Linux) selects every feature currently on the map.

---

## Deselecting

- Press `Escape` to deselect everything and return to an idle state
- Click on empty map space to deselect all features

---

## Keyboard operations on selected features

| Shortcut | Action |
|---|---|
| `Delete` / `Backspace` | Delete all selected features |
| `Cmd+C` / `Ctrl+C` | Copy selected features to the clipboard. Element writes a GeoJSON `FeatureCollection` to the system clipboard, so paste works across tabs and other editors. |
| `Cmd+V` / `Ctrl+V` | Paste copied features (offset slightly to distinguish from the original) |
| `Cmd+D` / `Ctrl+D` | Duplicate selected features in place |
| `Cmd+A` / `Ctrl+A` | Select all features |
| `Cmd+E` / `Ctrl+E` | Edit selected — opens the feature edit panel and focuses the first field (single-selection only) |
| `Cmd+G` / `Ctrl+G` | Group selection. The new group's name input auto-focuses for renaming. |
| `Cmd+Shift+G` / `Ctrl+Shift+G` | Ungroup selection |
| `Tab` / `Shift+Tab` | Move selection to the next / previous feature in visual order |
| `Escape` | Deselect all |

---

## Dragging selected features

Drag a selected feature to move it: press on it and drag (mouse or one finger). If several features are selected, a drag on any of them moves them all together, keeping their relative positions. The cursor turns into a move cursor over a selected feature and a grabbing hand while it moves. Each move is one undo step. A press that moves less than about 8 px stays a click, so clicking, double-clicking (point editing) and a second tap still work as before.

A drag that starts on an **unselected** feature, or on empty map, pans the map. To move a feature without selecting it first, hold `Cmd` (macOS) or `Ctrl` (Windows / Linux) and drag it; `Alt` / `Option`-drag drops a copy instead. Both work while a drawing tool is active too, where a plain drag belongs to the tool.

With one finger on a touch screen, the same rule applies: drag a selected feature to move it, anywhere else to pan. Two fingers always zoom and pan the map, even when one lands on a selected feature.

Moving is off in `readonly`, while point editing (drag the points instead; a drag inside the shape pans) and while a drawing tool is active. In transform mode the whole box moves the selection (see [Transform](./transform.md#moving)). This works the same on Leaflet and MapLibre.

---

## Context menu

Right-click a feature on the map (or its row in the layer list) to open the context menu. Available actions:

- **Zoom to feature** — layer-list menu only, the first item. Flies the map to the feature: points at street level, other shapes to fit their bounds. (Clicking a row only pans to a point.)
- **Edit properties** — opens the property form for that feature
- **Duplicate** — creates a copy offset from the original
- **Delete** — removes the feature
- **Hide / Show on map** — toggles visibility without deleting (layer-list menu only)
- **Group / Ungroup** — assigns the feature to a group or removes it

**Area and line additions:**

- **Simplify shape**, **Smooth shape**, **Buffer** — same actions as the editing toolbar (`Polygon`, `MultiPolygon`, `LineString`, `MultiLineString`)

**Area-only additions:**

- **Cut hole**, **Slice shape** — same actions as the editing toolbar
- **Center point** — drops a new `Point` feature at the polygon's centroid (computed via `@turf/centroid` — vertex-mean). Useful for labelling, attaching POIs, or seeding a new measurement. The new point inherits the source polygon's group and is named `"<source name> center"` when the source has a name.

**Multi*/MultiPolygon additions:** **Break apart** is also available.

The context menu is available in single-selection mode. Right-clicking in multi-selection shows a reduced set of actions that apply to all selected features (including **Merge** when 2+ are selected).

---

## The `onSelectionChange` callback

The adapter packages expose an `onSelectionChange` prop that fires whenever the selection changes:

```ts
onSelectionChange?: (ids: string[]) => void
```

This fires with the current array of selected feature IDs. It is independent of `onChange` — selection changes do not trigger `onChange`.

```tsx
<ElementEditorControls
  onSelectionChange={(ids) => {
    console.log('Selected feature IDs:', ids)
  }}
/>
```

---

## Read-only mode

In `readonly` mode, selection continues to work normally. Clicking features selects them and opens their properties. All editing actions (delete, drag, vertex edit, transform, boolean operations) are disabled, but the selection state and `onSelectionChange` callback still function.
