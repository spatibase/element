# Import and export

*Get GeoJSON in and out of the editor.*

Element loads existing GeoJSON from files, dropped/pasted text, and programmatic calls. It exports a standards-compliant `FeatureCollection` that round-trips Element's metadata (schemas, groups, `_drawType`). Parsing runs on the main thread, so a very large file can briefly block the UI while it loads.

---

## Export

### GeoJSON

Exports every feature as an RFC 7946 `FeatureCollection`. The exported document includes Element's `metadata` envelope (`schemas` and `groups`) as foreign members, so schema definitions travel with the data.

**Access:**

- Click the **Download** button inside the GeoJSON inspector modal (open with `I` or the Code button).
- Call `ref.current.exportAs('geojson')` to trigger a download programmatically.
- Call `ref.current.exportGeoJSON()` to receive the serialised text directly — useful when sending to an API or writing to a file yourself.

**File details:**

- Filename: `features.geojson`
- MIME type: `application/geo+json`
- Contains all features regardless of layer visibility.

The export preserves `_drawType` foreign members on circles, rectangles, and routes. Do not strip these when storing the data — Element needs them to recognise those shapes again on re-import.

---

## Import

Element accepts a `FeatureCollection` (and, for `initialData`, a single `Feature`) from five entry points: the `initialData` prop, pasting into the GeoJSON inspector, the ref API, `Cmd/Ctrl+O`, and dropping a file on the editor (the last two are under [Drag-and-drop / file picker](#drag-and-drop--file-picker)).

### `initialData` prop

```tsx
<ElementEditor initialData={myFeatureCollection} />
```

The starting data: applied on mount, with no undo step and no `onChange`. If it is `null` or empty at mount and arrives later (the usual fetch, then render), it is applied once when it arrives, as long as the editor is still empty and the user hasn't edited; the drop-ins then fit the map to it as they would on mount. Any other later change is ignored, with a development warning. To replace the data after that, call `ref.setFeatureCollection(data, { silent: true })` or remount the component with a new `key`.

### GeoJSON inspector (paste)

Open the **Code** button (or press `I`) to reveal the GeoJSON inspector. Paste a `FeatureCollection` into the editor — Element auto-parses and loads it on the fly. The same modal exposes **Copy** and **Download** for round-tripping the current data.

While the text isn't valid, nothing from it is applied — not even valid edits in other features. The error is underlined in the editor (hover it for the reason), and a status line below the editor says where, for example "Invalid JSON at line 42 — no changes apply until it's fixed" (or "Invalid feature at line …" when the JSON parses but a feature has no valid `type` or geometry). Click the status line to jump to the error; once the text is fixed, every edit applies at once.

Closing the inspector (or docking / undocking it) with text that isn't applied keeps that text: it is back, still marked, when the inspector opens again. Map or API edits made in the meantime to other features are normally merged around it; an edit to the feature you were typing into replaces your unapplied text with the current data, as it does while the inspector is open. Valid typing is applied on close, even within the short pause before it would otherwise apply. Copy and Download take the text as it is, invalid or not.

### `ref.importGeoJSON()`

For programmatic loads — after fetching from a backend, switching between projects, or restoring from `localStorage` — use the imperative API:

```tsx
const ref = useRef<ElementEditorRef>(null)

// Replace all features with the incoming set
ref.current?.importGeoJSON(fetchedData)

// Append without touching existing features
const result = ref.current?.importGeoJSON(extra, 'merge')
console.log(result)  // { skipped, duplicates, truncated }
```

The map doesn't move, and the existing undo history stays: a replace is one more undo step (and clears the selection). `ref.setFeatureCollection(fc)` is shorthand for `importGeoJSON(fc, 'replace')`; its options change how the load is recorded:

```tsx
// Data you just fetched: no onChange / onFeature* for this load, so it isn't saved straight back.
ref.current?.setFeatureCollection(fetchedData, { silent: true })

// Like initialData: no undo step, and the history is cleared.
ref.current?.setFeatureCollection(fetchedData, { silent: true, undoable: false })
```

In `'replace'` mode, incoming features whose ids are already in the editor are kept (re-importing the same data is safe); only ids repeated within the incoming data count as `duplicates`. In `'merge'` mode, ids already in the editor are skipped too. If `initialData` is invalid, the editor reports an `error` event and starts empty instead of crashing; a single `Feature` is wrapped in a collection.

---

## Drag-and-drop / file picker

In the drop-in `<ElementEditor />` (both engines) the user can drop a `.geojson` / `.json` file anywhere on the editor (map, panels or status bar), or press `Cmd+O` / `Ctrl+O` to pick one. Both do the same thing: a "Drop GeoJSON to import" overlay shows while a file is dragged over, the file **replaces** the current data in one undo step (`maxFeatures` truncates it and reports how many were imported), the map fits to the imported features, and a toast reports the result (or why the file was refused). Both are off in `readonly`; `fileDrop={false}` turns off dropping only. A drop the editor handles doesn't bubble on, so a drop zone of your own around the editor won't import the same file again; with your own drop handling, set `fileDrop={false}`. Programmatic `ref.importGeoJSON()` / `setFeatureCollection()` never move the map: call `ref.fitBounds()` yourself if you want that.

For your own drop zone or import button (e.g. with the adapters, or to merge instead of replace), `@element-editor/ui` exports a headless `useGeoJSONDrop` hook that handles file drag-and-drop and the native file picker. The hook deliberately does **not** call `importGeoJSON` for you — wire the parsed `FeatureCollection` to the ref API yourself, so you control merge vs replace and any pre-processing:

```tsx
import { useGeoJSONDrop } from '@element-editor/ui'

const { getRootProps, getInputProps, open, isDragActive } = useGeoJSONDrop({
  onImport: (fc) => ref.current?.importGeoJSON(fc, 'merge'),
  onError: (err) => console.warn(err),
})
```

`getRootProps()` returns the drop-target handlers; `getInputProps()` returns props for a hidden `<input type="file" />`. The companion `useGeoJSONExport` hook is symmetric for export.

---

## Replace vs Merge

When importing, you choose how the new data interacts with existing features:

| Mode | Behaviour |
|---|---|
| **Replace** (default) | Clears all existing features and loads the imported set. |
| **Merge** | Adds imported features to the existing set. Existing features are preserved; incoming features whose `id` already exists are counted as `duplicates` and skipped. |

> **Undo:** a Replace (or Merge) import is a single undo step: one Cmd/Ctrl+Z (or `ref.undo()`) restores the previous features, schemas and groups. No file backup is written; if you need a copy that survives a reload, store `ref.exportGeoJSON()` yourself first.

---

## Limits

- The drop hook caps file size at 100 MB by default (`DEFAULT_MAX_IMPORT_BYTES`); override via the `maxBytes` option.
- The store caps imported features at an internal limit of 50,000. When exceeded, `importGeoJSON` returns `{ truncated: true }` and stops at the cap.
- The editor's `maxFeatures` prop also caps imports: the import is truncated to the remaining room (existing features count in `merge` mode) and returns `{ truncated: true }`, with an `error` event saying how many were imported (see [Restricting tools](../guides/restricting-tools.md)).
- The editor's `geometryTypes` prop skips features whose geometry type isn't allowed and counts them in `refused`, with an `error` event saying how many (see [Allowed geometry types](../guides/restricting-tools.md#allowed-geometry-types)).

---

## Google Sheets utilities

`@element-editor/core` ships small helpers — `extractSheetId`, `fetchSheetCsv`, `parseCsv`, `csvToGeoJson` — for turning a publicly-shared Google Sheet into a `FeatureCollection`. They aren't wired to any UI button; if you want a "Load from Sheet" affordance, build it on top of the helpers and feed the result into `ref.importGeoJSON()`.
