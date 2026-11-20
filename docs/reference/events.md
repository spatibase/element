# Events

*Reacting to changes in the editor.*

---

## Two patterns

**Full snapshot (`onChange`)** fires on every committed change and delivers the complete current `FeatureCollection`. Straightforward to wire up. Appropriate for most use cases under ~500 features.

**Granular events** (`onFeatureAdd`, `onFeatureUpdate`, `onFeatureDelete`) fire per feature. Appropriate for large datasets or real-time database sync where re-sending the full collection on every change is undesirable.

Both patterns can coexist. `onChange` and granular callbacks can all be provided simultaneously.

---

## `onChange`

Available on: `@element-editor/react`, `@element-editor/adapter-leaflet`, `@element-editor/adapter-maplibre`

```ts
onChange?: (data: FeatureCollection) => void
```

Fires after every committed change — feature added, updated, deleted, or undo/redo applied. The `data` argument is the complete, current `FeatureCollection` with `metadata` (schemas and groups) included. `_validation` is stripped from all features.

```tsx
<ElementEditor onChange={(data) => saveToDatabase(data)} />
```

---

## Granular events

Available on: `@element-editor/react`, `@element-editor/adapter-leaflet`, `@element-editor/adapter-maplibre`

```ts
onFeatureAdd?: (feature: GeoJSONFeature) => void
onFeatureUpdate?: (id: string, feature: GeoJSONFeature) => void
onFeatureDelete?: (id: string) => void
onSelectionChange?: (ids: string[]) => void
```

### `onFeatureAdd`

Fires when a new feature is added to the store. Fires **after** `onChange` for the same operation.

### `onFeatureUpdate`

Fires when an existing feature's `geometry` or `properties` change. Fires **after** `onChange` for the same operation.

### `onFeatureDelete`

Fires when a feature is removed from the store. Receives the deleted feature's `id`. Fires **after** `onChange` for the same operation.

### `onSelectionChange`

Fires when the set of selected feature IDs changes. Fires **independently** of feature data changes — selecting or deselecting a feature does not trigger `onChange`, `onFeatureAdd`, `onFeatureUpdate`, or `onFeatureDelete`.

```tsx
<ElementEditorControls
  onFeatureAdd={(feature) => db.insert(feature)}
  onFeatureUpdate={(id, feature) => db.update(id, feature)}
  onFeatureDelete={(id) => db.delete(id)}
  onSelectionChange={(ids) => setSelectedIds(ids)}
/>
```

---

## Selection, zoom, submit and notification events

Available on: `@element-editor/react`, `@element-editor/adapter-leaflet`, `@element-editor/adapter-maplibre`

```ts
onFeatureSelect?: (feature: GeoJSONFeature | null) => void
onZoomChange?: (zoom: number) => void
onSubmit?: (data: FeatureCollection) => void
onValidationError?: (errors: Record<string, string[]>) => void
onError?: (error: ElementEditorError) => void | false | string
onEvent?: (event: ElementEditorEvent) => void
```

### `onFeatureSelect`

Fires when a single feature is selected. Passes `null` when no feature is selected or when multiple features are selected.

### `onZoomChange`

Fires when the map zoom level changes. Receives the new zoom level as a number.

### `onSubmit`

Fires when a submit is triggered and all required schema fields pass validation. Receives the full `FeatureCollection`, with `_validation` stripped. On `<ElementEditor>`, providing `onSubmit` renders an "Apply changes" button (unless the editor is read-only). The adapters render no button: call `ref.submit()` from your own UI.

### `onValidationError`

Fires when `ref.submit()` is triggered but one or more required schema fields are empty or invalid. Receives a `Record<string, string[]>` where keys are feature IDs and values are arrays of error messages. Blocks `onSubmit` from firing.

### `onError`

Called **first** for every runtime failure, with an `ElementEditorError`: an `Error` (it has a stack, so Sentry and similar tools take it as is) with a stable machine-readable `code`, a `source`, and an honest English `message` (what happened, what to do). Use it to log failures, show your own UI, or translate.

```ts
type ElementEditorErrorHandler = (error: ElementEditorError) => void | false | string

class ElementEditorError extends Error {
  code: ErrorCode
  source: ErrorSource
  featureId?: string   // the feature the failed operation was about
  cause?: unknown      // the underlying error (HTTP error, DOMException, worker error, …)
}
```

The return value decides what Element shows:

| Return | Built-in toast | `onEvent` `error` event |
|---|---|---|
| nothing (`undefined`) | shown | sent |
| `false` | not shown: you show it | not sent |
| a string | shows that text instead | sent with that text |

`onError` fires in managed mode too (with `onEvent` set), before `onEvent`. It also fires for **quiet** failures that show no toast: a failed geometry preview (buffer / simplify / smooth), the system clipboard refusing a copy, the search box's own error line, a map style without glyphs. Validation (`onValidationError`) and dev-only `console.warn`s for API misuse are not errors and never reach it. Refusals of an action (deleting a polygon's third-last vertex, an invalid zoom value) are `warning` events, not errors. A `maxFeatures` refusal is an error (`'limit-reached'`), because the limit is your policy and you may want to act on it.

```tsx
<ElementEditor
  onError={(e) => {
    Sentry.captureException(e, { tags: { code: e.code, source: e.source } })
    if (e.code === 'rate-limited') return t('errors.rateLimited') // translated toast
    if (e.code === 'limit-reached') { openUpgradeDialog(); return false } // own UI, no toast
  }}
/>
```

`ErrorCode` and `ErrorSource` are closed unions covered by semver (a new code is a minor release; renaming or removing one is a major):

| `code` | Meaning | Typical sources |
|---|---|---|
| `network` | The request failed (no connection, CORS, a non-retryable HTTP status, a lazy chunk that didn't load). | `basemap`, `picker`, `routing`, `search` |
| `rate-limited` | HTTP 429: wait and retry. | `picker`, `routing`, `search`, `basemap` |
| `busy` | HTTP 502–504: the service is overloaded, retry later. | `picker`, `routing`, `search`, `basemap` |
| `timeout` | No answer in time (Overpass, the 30 s geometry worker limit). | `picker`, `geometry`, `locate` |
| `unauthorized` | HTTP 401/403: a refused key (e.g. the routing API key). | `routing`, `basemap` |
| `invalid-data` | Unreadable input or response: invalid JSON, not a FeatureCollection, an HTML error page; features in `initialData` / `setFeatureCollection` data that have no usable geometry (`geometry: null`) and were left out. | `import`, `picker`, `search`, `basemap` |
| `too-large` | A file over the import size cap. | `import` |
| `limit-reached` | `maxFeatures` refused an add or truncated an import. | `editor`, `import` |
| `geometry-type-not-allowed` | `geometryTypes` refused a geometry type (an add, paste, merge, break apart, geometry operation) or skipped features of that type in an import. Nothing was changed. | `editor`, `clipboard`, `geometry`, `import` |
| `geometry` | A geometry operation failed or produced an empty shape. | `geometry`, `editor` |
| `permission-denied` | The browser refused a permission (geolocation, clipboard). | `locate`, `clipboard` |
| `unsupported` | The browser or the map lacks something (no geolocation / clipboard API, a style without glyphs). | `locate`, `clipboard`, `basemap` |
| `crash` | The editor crashed while rendering; the error boundary shows its fallback. | `editor` |
| `unknown` | Anything else. | any |

`ErrorSource` is one of `'basemap' | 'picker' | 'routing' | 'search' | 'import' | 'export' | 'clipboard' | 'geometry' | 'locate' | 'editor'`. `OverpassError` (from `fetchOverpassFeatures`) is an `ElementEditorError` with `source: 'picker'`.

On the adapters, pass `onError` to `ElementEditorUIProvider` (it also gets render crashes) or to `ElementEditorControls`. A local `onError` on the controls runs first, then the event goes on to the provider (its `onError`, `onEvent` or toaster).

### `onEvent`

Intercepts all internal library events. Every message Element shows the user (errors, warnings, confirmations, including errors such as invalid `initialData`) goes through this channel. When `onEvent` is provided, the library is fully silent: no toasts are shown, and the host application is responsible for surfacing notifications. `onEvent` is read once at mount; adding or removing it later has no effect.

Without `onEvent`, Element shows its own toasts. `<ElementEditor>` and `ElementEditorUIProvider` each render their own sonner `<Toaster>`, and every toast is tagged with that instance's id. A `<Toaster>` your app already renders, or a second editor on the page, never shows the same toast twice, and you don't need to add a `<Toaster>` yourself. On `ElementEditorUIProvider`, pass `toaster={false}` to send toasts to your own untagged `<Toaster>` instead.

Element's toasts are quiet: no icons and no per-type colours, and they follow the editor's theme (a dark toast on a dark editor, on the same surface as its panels). To get the same look in your own toaster, render `<ElementToaster />` from `@element-editor/ui` (it takes every sonner `<Toaster>` prop) inside the editor's providers, or pass `theme` yourself outside them.

`error`, `warning` and `success` events may carry a `description`: a second line with more detail. The default toast shows it under the message.

```tsx
<ElementEditor
  onEvent={(event) => {
    if (event.type === 'feature:deleted') {
      showToast(`Deleted "${event.label}"`, {
        action: { label: 'Undo', onClick: event.undo },
      })
    }
    if (event.type === 'error') {
      showErrorToast(event.message) // event.code / event.source as on onError
    }
  }}
/>
```

See the `ElementEditorEvent` type section below for all event shapes.

---

## Firing order

| Scenario | Order |
|---|---|
| Feature added | `onChange` → `onFeatureAdd` |
| Feature updated | `onChange` → `onFeatureUpdate` |
| Feature deleted | `onChange` → `onFeatureDelete` |
| Selection changed | `onSelectionChange` (independent, no `onChange`) |

The ref's data methods (`addFeature`, `updateFeature(s)`, `removeFeatures`, `select`, `importGeoJSON`, …) fire the same callbacks as the equivalent user edit, synchronously before the method returns. Within one commit the order is `onChange` → per-feature callbacks → `onSelectionChange` → `onFeatureSelect`.

`onChange` fires once per commit. The granular per-feature callbacks then fire from a single diff pass — one `onFeatureAdd` per new id, one `onFeatureUpdate` per changed `geometry`/`properties` reference, one `onFeatureDelete` per removed id. A bulk delete fires N `onFeatureDelete` calls within the same commit.

---

## `ElementEditorEvent`

```ts
type ElementEditorEvent =
  // Feature lifecycle
  | { type: 'feature:deleted'; featureId: string; label: string; undo: () => void }
  | { type: 'features:deleted'; count: number; undo: () => void }
  | { type: 'feature:duplicated'; featureId: string; label: string }
  | { type: 'features:duplicated'; count: number }
  | { type: 'feature:broken'; featureId: string; count: number; undo: () => void }
  | { type: 'selection:copied' }
  | { type: 'selection:pasted'; count: number }

  // History
  | { type: 'undo' }
  | { type: 'redo' }

  // Notifications
  | { type: 'error'; code: ErrorCode; source: ErrorSource; message: string; description?: string }
  | { type: 'warning'; message: string; description?: string }
  | { type: 'success'; message: string; description?: string }
```

### Event reference

| `type` | When it fires | Notable fields |
|---|---|---|
| `feature:deleted` | A single feature is deleted. No default toast — the disappearance is its own confirmation; `Cmd/Ctrl+Z` still undoes. Use `onEvent` if you want a custom undo affordance. | `featureId`, `label`, `undo()` |
| `features:deleted` | Multiple features are deleted at once. Same default-silence behaviour as `feature:deleted`. | `count`, `undo()` |
| `feature:duplicated` | A single feature is duplicated. No default toast — the new copy on the map is its own confirmation. | `featureId`, `label` |
| `features:duplicated` | Multiple features are duplicated. Same default-silence behaviour as `feature:duplicated`. | `count` |
| `feature:broken` | A multi-geometry feature is broken into parts. | `featureId`, `count`, `undo()` |
| `selection:copied` | The selection is copied to the clipboard. | — |
| `selection:pasted` | Features are pasted from the clipboard. | `count` |
| `undo` | An undo operation is performed. | — |
| `redo` | A redo operation is performed. | — |
| `error` | A recoverable error occurs (after `onError`, unless it returned `false`). | `code`, `source`, `message`, `description?` |
| `warning` | A non-blocking warning or a refused action (e.g. circle converted to polygon, a vertex that can't be deleted, an import that skipped features). | `message`, `description?` |
| `success` | A positive confirmation (e.g. coordinate updated). | `message`, `description?` |

The `undo()` function on `feature:deleted`, `features:deleted`, and `feature:broken` events calls `dataStore.undo()` — the same as pressing `Cmd/Ctrl+Z`.

---

## When to use which

| Scenario | Recommended |
|---|---|
| Save to `localStorage` | `onChange` |
| Send to a REST API | `onChange` |
| Real-time sync / CRDT | Granular events (`onFeatureAdd/Update/Delete`) |
| 500+ features | Granular events |
| React to selection in your UI | `onSelectionChange` |
| Custom toast notifications | `onEvent` |
| Error logging, own error UI, translated error messages | `onError` |
| Validation gate before save | `onSubmit` + `onValidationError` |
