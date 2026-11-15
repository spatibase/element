# Persisting data

*Get feature data out of the editor and into your storage layer.*

Element manages features in memory. To keep them across page reloads or share them with other users, you need to persist them. This guide covers four patterns — from a two-liner for prototypes to granular event hooks for real-time sync.

---

## Pattern 1 — localStorage

The fastest path for prototypes and local-only tools. The editor rehydrates from storage on every page load.

```tsx
import { ElementEditor } from '@element-editor/react'
import type { FeatureCollection } from '@element-editor/react'

export default function App() {
  const saved = localStorage.getItem('my-map')

  return (
    <ElementEditor
      initialData={saved ? JSON.parse(saved) as FeatureCollection : null}
      onChange={(data) => localStorage.setItem('my-map', JSON.stringify(data))}
    />
  )
}
```

> **Note:** `onChange` fires on every committed change, including each vertex drag (once, when it ends). For large feature sets, consider debouncing or switching to granular events (see Pattern 3 below). It doesn't fire for the `initialData` load itself, so restoring data never writes it straight back.

Element doesn't care if you never call `onChange`. It will happily draw polygons into the void, perfectly content.

---

## Pattern 2 — POST to an API

For production apps, send the full `FeatureCollection` to your backend on every committed change.

```tsx
import { useCallback } from 'react'
import { ElementEditor } from '@element-editor/react'
import type { FeatureCollection } from '@element-editor/react'

export default function App() {
  const handleChange = useCallback(async (data: FeatureCollection) => {
    await fetch('/api/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }, [])

  return <ElementEditor onChange={handleChange} />
}
```

The `FeatureCollection` passed to `onChange` includes the `metadata` envelope containing schema definitions and groups — round-trip it faithfully and pass it back via `initialData` to restore the full editor state.

To load initial data from your API, pass it as `initialData` when it arrives:

```tsx
const [initialData, setInitialData] = useState<FeatureCollection | null>(null)

useEffect(() => {
  fetch('/api/map')
    .then((r) => r.json())
    .then(setInitialData)
}, [])

// Mounts empty; the data is applied once when it arrives (no undo step, no onChange, and the
// map fits it on a first visit). The editor stays usable while loading.
return <ElementEditor initialData={initialData} onChange={handleChange} />
```

Data that arrives late is applied only while the editor is still empty and the user hasn't edited (otherwise it is ignored, so their edits are kept), and only once: a later change of `initialData` is ignored, with a development warning. To swap the data afterwards, see [Loading data back after mount](#loading-data-back-after-mount). If you'd rather not show an empty editor while loading, render it only when the data is there (`initialData ? <ElementEditor … /> : <p>Loading…</p>`).

`initialData` takes any GeoJSON: a `GeoJSON.FeatureCollection` from `@types/geojson` type-checks as is, and plain files without Element's `metadata` load with the default schema.

---

## Pattern 3 — Granular events

`onChange` reconstructs the full `FeatureCollection` on every committed change. For 500+ features, this means sending potentially thousands of features on every vertex move. Granular events deliver only the affected feature.

```tsx
import { ElementEditorControls } from '@element-editor/adapter-leaflet' // or adapter-maplibre

<ElementEditorControls
  onFeatureAdd={(feature) => {
    db.features.insert(feature)
  }}
  onFeatureUpdate={(id, feature) => {
    db.features.update(id, feature)
  }}
  onFeatureDelete={(id) => {
    db.features.delete(id)
  }}
/>
```

Granular events and `onChange` can coexist. You can use `onChange` for a periodic full-save and `onFeatureAdd/Update/Delete` for real-time incremental sync simultaneously.

`onSelectionChange` fires independently of data changes — use it to react to the user's current selection without triggering a save:

```tsx
<ElementEditorControls
  onChange={saveToDB}
  onSelectionChange={(ids) => setHighlightedIds(ids)}
/>
```

---

## Pattern 4 — Save on demand (ref API)

For cases where you want an explicit Save button rather than auto-save on every change.

```tsx
import { useRef } from 'react'
import { ElementEditor } from '@element-editor/react'
import type { ElementEditorRef } from '@element-editor/react'
import type { FeatureCollection } from '@element-editor/react'

export default function App() {
  const ref = useRef<ElementEditorRef>(null)

  function handleSave() {
    const data = ref.current?.getFeatureCollection()
    if (data) localStorage.setItem('my-map', JSON.stringify(data)) // or send it to your API
  }

  return (
    <>
      <div style={{ width: '100%', height: '600px' }}>
        <ElementEditor ref={ref} />
      </div>
      <button onClick={handleSave}>Save</button>
    </>
  )
}
```

`getFeatureCollection()` returns a snapshot of the current state. It does not trigger `onChange`.

For the adapter packages (`@element-editor/adapter-leaflet`, `@element-editor/adapter-maplibre`), the ref type is `ElementEditorControlsRef`. It has the same methods as `ElementEditorRef`.

---

## Loading data back after mount

`initialData` is the starting data (see above). To swap data imperatively after mount — for example, after the user opens a different project — call the ref:

```tsx
// @element-editor/react
ref.current?.importGeoJSON(newData)            // replace (default)
ref.current?.importGeoJSON(extra, 'merge')     // append

// Like importGeoJSON(newData, 'replace'), on all three packages:
ref.current?.setFeatureCollection(newData)
```

> **Note:** these loads fire `onChange` (and `onFeatureAdd` / `onFeatureDelete`) like any other change, and are one undo step. If you save in `onChange`, loading from your backend would save the same data straight back. Pass `{ silent: true }` to skip the data callbacks for that load, and `{ undoable: false }` if the user shouldn't be able to undo back to the previous project (it also clears the undo history):
>
> ```tsx
> const data = await (await fetch(`/api/projects/${id}`)).json()
> ref.current?.setFeatureCollection(data, { silent: true, undoable: false })
> ```

Replacing with features whose ids are already in the editor keeps them (re-importing the same data is safe). In `'replace'` mode only ids repeated within the incoming data count as `duplicates`; in `'merge'` mode, ids already in the editor are skipped too.

This preserves zoom, selection, and undo history. If you want a clean slate (reset zoom, collapse panels, clear undo), remount with a new `key` prop instead:

```tsx
<ElementEditor key={projectId} initialData={projectData} onChange={handleChange} />
```

---

## TypeScript imports

```ts check=false
// @element-editor/react re-exports the data types:
import type { FeatureCollection, GeoJSONFeature, Schema } from '@element-editor/react'

// The adapters don't. With an adapter, import them from @element-editor/core
// (add it to your package.json, same version as the adapter):
import type { FeatureCollection, GeoJSONFeature, Schema } from '@element-editor/core'
```

---

## Element's own saved state (`persistKey` / `persist`)

Separately from your features, the editor remembers the visitor's UI choices in `localStorage`. By default every editor on an origin shares the same `elm_*` keys, so two editors (two pages of one app, or two editors on one page) overwrite each other's choices. Give each one its own key:

```tsx
<ElementEditor config={{ persistKey: 'parcels' }} />   // elm_theme → elm_parcels_theme, …
<ElementEditor config={{ persistKey: 'routes' }} />
<ElementEditor config={{ persist: false }} />          // reads and writes nothing
```

- **`config.persistKey?: string`** prefixes every key below: `elm_<name>` becomes `elm_<persistKey>_<name>`. Default: none (the plain `elm_*` keys, so existing visitors keep their saved state).
- **`config.persist?: boolean`** (default `true`). `false` reads nothing and writes nothing: every load starts from your config and props.

Both work the same with the drop-ins and with adapters (`ElementEditorUIProvider config={…}`). Set them once at mount; changing them later isn't supported.

| Key | What |
|---|---|
| `elm_theme` | Light / Dark / Auto picked in settings |
| `elm_showMeasurements`, `elm_showFeatureNameOnHover`, `elm_topoEditEnabled`, `elm_autoExitAfterDraw` | Settings toggles |
| `elm_units` | Units override picked in settings |
| `elm_shortcuts` | Custom keyboard shortcuts |
| `elm_lastSchemaId` | Schema used for the last new feature |
| `elm_panel_prefs`, `elm_panel_width` | Layers panel sections and width |
| `elm_code_docked`, `elm_code_dock_width`, `elm_code_win`, `elm_code_win_size` | GeoJSON inspector: docked or floating, dock width, window position and size |
| `elm_settings_win(_size)`, `elm_schema_win(_size)`, `elm_feature_win(_size)`, `elm_shortcuts_win(_size)` | Other windows' position and size |
| `elm_mapView` | Last map centre and zoom (drop-ins); the start view unless `initialView` is set |
| `elm_basemap` / `elm_basemap_leaflet` | Basemap picked in the MapLibre / Leaflet drop-in (not with a controlled `basemap` prop) |

`BasemapControl`'s `storageKey` is namespaced the same way. The storage helpers below take the same scope as an optional last argument (`readStorage(key, { persistKey })`), so your own keys can follow it too.

---

## Persisting your own app state with a version guard

If you store app-specific preferences alongside Element's own keys, use the versioned helpers from `@element-editor/core` so a shape change doesn't silently drop (or, worse, silently corrupt) stored values when users upgrade.

```ts
// @element-editor/core is installed with every ElementEditor package; add it to your package.json to import it.
import { readPersisted, writePersisted } from '@element-editor/core'

type MyPrefs = { unit: 'metric' | 'imperial'; sidebar: 'left' | 'right' }
const KEY = 'myapp_prefs'
const VERSION = 2

const prefs = readPersisted<MyPrefs>(KEY, VERSION, (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<MyPrefs>
  if (v.unit !== 'metric' && v.unit !== 'imperial') return null
  if (v.sidebar !== 'left' && v.sidebar !== 'right') return null
  return { unit: v.unit, sidebar: v.sidebar }
}) ?? { unit: 'metric', sidebar: 'right' }

writePersisted(KEY, VERSION, prefs)
```

**Semantics:**
- `writePersisted` wraps the value in `{ v: VERSION, data: value }`.
- `readPersisted` returns the inner `data` when the envelope matches the current version. If the stored version is older it returns `null` (and logs a dev-mode warning), so callers fall back to defaults instead of loading a stale shape.
- Legacy unversioned values written by an older release are accepted **once** on first read — the next `writePersisted` call re-seals them in the envelope.
- The optional `parse` argument is your shape guard: return `null` to reject malformed stored data.

Bump `VERSION` whenever you change the persisted shape — users will silently fall back to the default and their next save re-seals the new shape.

`@element-editor/core` also exports `readStorage(key)` and `writeStorage(key, value)`: raw `localStorage` string access that never throws. In a sandboxed or storage-blocked iframe, `readStorage` returns `null` and `writeStorage` does nothing, instead of throwing a `SecurityError`. Element guards all its own storage access the same way.

Element uses the versioned helper internally for `elm_mapView`, `elm_shortcuts`, `elm_panel_prefs`, and the modal window positions.

---

## What's next

- [Working with large datasets](./saving-large-datasets.md) — granular events, viewport culling, geometry workers
- [Reference: events](../reference/events.md) — full event API documentation
- [Reference: @element-editor/react](../reference/element-editor-react.md) — `ElementEditorRef` interface
