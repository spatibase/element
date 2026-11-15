# Working with large datasets

*Performance patterns for editors with hundreds or thousands of features.*

Default settings work well up to a few hundred features. Beyond that, a few patterns make a significant difference — mostly in how you handle data callbacks. Several of Element's performance optimizations are automatic and require no configuration; this guide covers which ones they are and when to activate the ones that aren't.

---

## Rule of thumb

| Feature count | Recommendation |
|---|---|
| < 500 | Default settings. Nothing to do. |
| 500–5,000 | Switch to granular events. |
| > 5,000 | Granular events + consider paginating or filtering data before passing it to the editor. |

---

## Use granular events (biggest win)

`onChange` reconstructs and delivers the full `FeatureCollection` on every committed change — every finished drag, edit, add or delete. On a 5,000-feature dataset, that's 5,000 features copied and delivered to your callback for each single edit.

Switch to `onFeatureAdd`, `onFeatureUpdate`, and `onFeatureDelete` to receive only the feature that changed:

```tsx
<ElementEditorControls
  onFeatureAdd={(feature) => {
    db.insert(feature)
  }}
  onFeatureUpdate={(id, feature) => {
    db.update(id, feature)
  }}
  onFeatureDelete={(id) => {
    db.delete(id)
  }}
/>
```

The granular events fire on every committed change, not on every drag tick — Element batches intermediate drag positions and fires once when the user releases the mouse. You don't need to debounce.

You can combine granular events with `onChange`. A common pattern is `onFeatureAdd/Update/Delete` for incremental database sync and `onChange` for a periodic full snapshot save:

```tsx
<ElementEditorControls
  onFeatureAdd={(f) => db.insert(f)}
  onFeatureUpdate={(id, f) => db.update(id, f)}
  onFeatureDelete={(id) => db.delete(id)}
  onChange={(data) => {
    // Full backup every time — only use this if your feature count is manageable
    sessionStorage.setItem('backup', JSON.stringify(data))
  }}
/>
```

---

## Built in (nothing to configure)

- **Leaflet draws unselected features on one canvas** (`renderer="canvas"`, the default), so panning and zooming stay smooth with thousands of features. `renderer="svg"` gives each feature its own `<path>` if you need DOM access.
- **Leaflet mounts large datasets progressively**: the first frame doesn't wait for every feature.
- **Vertex editing caps handles at 500 per ring.** On bigger rings it shows the ones in view, evenly spaced, so entering vertex edit on a 50,000-point boundary stays fast.
- **The GeoJSON inspector re-parses only the feature you edit**, not the whole collection.
- **Batch your own edits**: `ref.updateFeatures([...])` is one commit, one `onChange` and one undo step for any number of features, and `{ undoable: false }` applies server changes without filling the undo history.

The repository's `pnpm test:perf` benchmark (5,000 mixed features and a 50,000-point polygon, on both engines) checks these; the [changelog](../../CHANGELOG.md) lists the numbers.

---

## Viewport culling (automatic)

In the Leaflet adapter, Element caches a bounding box for each feature and skips rendering features that lie entirely outside the current map viewport (plus a small margin). In the MapLibre adapter, the map's own vector tiling does this. Either way it's on by default, with no configuration.

The effect grows with the share of features off screen: a large dataset with only a few features in view costs far less to draw than one with everything in view.

Viewport culling applies to the rendering layer. All features remain in the store and are included in `onChange` data regardless of visibility.

---

## Geometry worker (automatic)

Polygon boolean operations (union, intersect, subtract, exclude), Cut hole, Slice and the live previews of Buffer, Simplify and Smooth run in a background Web Worker. The UI stays responsive while they compute, a preview only keeps the latest slider value, and a computation that takes over 30 seconds is abandoned. The worker is inlined into `@element-editor/ui` and loaded on first use, so no bundler configuration is needed.

Merge, break apart and line union run on the main thread; they only regroup coordinates. Cut hole and slice fall back to the main thread only where Web Workers aren't available.

To run your own geometry operations in the same worker, use `runGeometryWorkerOperation` from `@element-editor/ui` (see the [reference](../reference/element-editor-ui.md#geometry-utilities)).

---

## Import and export (main thread)

Import (parse, ID assignment, schema extraction), export and feature validation run on the main thread, not in a worker. Very large files can briefly block the UI while they are processed. Imports above 100 MB are rejected (`DEFAULT_MAX_IMPORT_BYTES`). Validation doesn't check polygons for self-intersecting edges, which keeps edits on large polygons fast.

---

## `maxFeatures` — the explicit cap

If your use case has a hard upper limit on feature count, set it explicitly:

```tsx
<ElementEditorControls maxFeatures={500} onChange={handleChange} />
```

Once the limit is reached, drawing tools are disabled, duplicate and paste are refused, and imports are truncated (see [Restricting tools](./restricting-tools.md)). This is a blunt instrument — use it when you want to enforce a constraint for product or performance reasons, not as a substitute for the patterns above.

---

## Filtering data before passing to the editor

For datasets larger than ~5,000 features, consider pre-filtering to the viewport or a relevant subset before passing to `initialData`. Element is optimized for interactive editing workloads, not for browsing a full national dataset at country zoom.

A practical approach:

1. Store the full dataset server-side.
2. When the user opens the editor, fetch features within the current viewport bbox.
3. Pass that subset as `initialData`.
4. Use `onFeatureAdd/Update/Delete` to sync changes back to the server.

This keeps the editor's in-memory feature list manageable and means viewport culling has less work to do.

---

## What's next

- [Reference: events](../reference/events.md) — `onFeatureAdd`, `onFeatureUpdate`, `onFeatureDelete`, `onSelectionChange`
- [Persisting data](./persisting-data.md) — patterns for all four persistence strategies
