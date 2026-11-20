# Types

*TypeScript type reference for all Element data structures.*

---

## Import

The data types live in `@element-editor/core`. `@element-editor/react` re-exports the most common ones (`FeatureCollection`, `GeoJSONFeature`, `Schema`, `SchemaField`, `Group`, `Geometry`, `EditingMode`). The adapters don't re-export them.

```ts check=false
// With @element-editor/react:
import type { FeatureCollection, GeoJSONFeature, Schema } from '@element-editor/react'

// With an adapter, or for the other types on this page:
import type { FeatureCollection, GeoJSONFeature, Schema } from '@element-editor/core'
```

> **Note:** `@element-editor/core` is installed automatically with every Element package. To import from it, add it to your own `package.json` at the same version as your other `@element-editor/*` packages; strict package managers (pnpm) don't resolve undeclared packages.

---

## `FeatureCollection`

The root data structure returned by `onChange`, `getFeatureCollection()`, `exportGeoJSON()` (serialised), and `exportAs()` (download).

```ts
interface FeatureCollection {
  type: 'FeatureCollection'
  metadata: {
    schemas: Schema[]
    groups: Group[]
  }
  features: GeoJSONFeature[]
}
```

`metadata` is an Element extension that travels with the data so schemas **and groups** survive a round-trip through a backend or file system. `metadata` is always present (never `undefined`) on objects produced by Element.

> **Note:** `metadata.schemas` and `metadata.groups` are the wire format. At runtime, schemas and groups live at the top level of the data store (inside the editor tree: `useDataStore((s) => s.schemas)` / `useGeoStore().dataStore.getState().groups` from `@element-editor/ui`; `useDataStore` is a selector hook, not a store, so it has no `getState()`), not under `metadata`. The collection is reassembled when you call `getFeatureCollection()` / `exportGeoJSON()`.

---

## `GeoJSONFeature`

```ts
interface GeoJSONFeature {
  type: 'Feature'
  id: string                       // UUID; always present
  geometry: Geometry
  properties: Record<string, unknown>
  schemaId?: string                // RFC 7946 §6.1 — links feature to a Schema
  groupId?: string                 // RFC 7946 §6.1 — links feature to a Group
  hidden?: boolean                 // RFC 7946 §6.1 — visibility toggle
  _drawType?: DrawType             // RFC 7946 §6.1 — original drawing tool
  bbox?: [number, number, number, number]  // RFC 7946 §5 — [w, s, e, n]
}
```

`id` is required and always a string UUID. New features get one via `crypto.randomUUID()`.

> **Warning:** Do not strip `_drawType` when round-tripping feature data through a backend. Element uses it to warn before an edit turns a circle (64-sided polygon approximation), rectangle or route (road-network alignment) into a plain polygon or line; the first committed point change removes it. It is a valid RFC 7946 §6.1 extension member — any compliant GeoJSON consumer must preserve unknown members.

Features inside the store can also carry `_validation` (`{ errors, warnings }`), the editor's own validation state. It is marked `@internal` (not part of the public data shape, may change), is stripped from the output of `getFeatureCollection()`, `exportGeoJSON()`, `onChange` and `exportAs()`, and should never be written. Use `ref.validate()` or `validateFeature()` instead.

---

## `FeatureCollectionInput` / `GeoJSONFeatureInput`

What Element **accepts**: any RFC 7946 GeoJSON, so data typed with `@types/geojson` (`GeoJSON.FeatureCollection`, `GeoJSON.Feature`) type-checks as is under `strict`, with no cast. Used by `initialData` (which also takes a single feature), `ref.setFeatureCollection()`, `ref.importGeoJSON()` and `ref.addFeature()`, on both drop-ins and both adapters. What Element **hands back** (`getFeatureCollection()`, `onChange`, events) is always the strict `FeatureCollection` / `GeoJSONFeature` above. Exported by `@element-editor/core` and both `@element-editor/react` entries.

```ts
interface FeatureCollectionInput {
  type: 'FeatureCollection'
  metadata?: { schemas?: Schema[]; groups?: Group[] }   // missing: the default schema, no groups
  features: GeoJSONFeatureInput[]
  bbox?: BBoxInput                                      // ignored
}

interface GeoJSONFeatureInput {
  type: 'Feature'
  id?: string | number                          // missing or '': a UUID; a number becomes a string ('0' included)
  geometry: GeometryInput | null                // null: left out on import, reported (see below)
  properties?: Record<string, unknown> | null   // missing or null: {}
  bbox?: BBoxInput                              // recomputed by Element
  schemaId?: string
  groupId?: string
  hidden?: boolean
  _drawType?: DrawType
}

type PositionInput = number[]                   // [lng, lat] or [lng, lat, altitude, …]
type BBoxInput = [number, number, number, number] | [number, number, number, number, number, number]
type GeometryInput =                            // every RFC 7946 geometry; each may carry a bbox
  | { type: 'Point'; coordinates: PositionInput }
  | { type: 'MultiPoint' | 'LineString'; coordinates: PositionInput[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: PositionInput[][] }
  | { type: 'MultiPolygon'; coordinates: PositionInput[][][] }
  | { type: 'GeometryCollection'; geometries: GeometryInput[] }
```

```ts
import type { FeatureCollectionInput } from '@element-editor/react'

const data: FeatureCollectionInput = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [14.42, 50.09] }, properties: null }],
}
```

```ts check=false
import type * as GeoJSON from 'geojson'
const fc: GeoJSON.FeatureCollection = await (await fetch('/parcels.geojson')).json()
<ElementEditor initialData={fc} />            // no cast needed
ref.current?.setFeatureCollection(fc)
```

`hidden` and `_drawType` are kept on import, so data exported by Element round-trips unchanged. Altitudes in positions are kept as given (a vertex the user moves becomes `[lng, lat]`). A feature with `geometry: null` (an "unlocated" feature, valid GeoJSON) can't be shown on a map: `initialData` and `setFeatureCollection` leave it out and report it once through `onError` / the `error` event (`code: 'invalid-data'`, `source: 'import'`), `importGeoJSON` counts it in `ImportResult.skipped`, and `addFeature` returns `null`. `PositionInput`, `BBoxInput` and `GeometryInput` are exported by `@element-editor/core` (`GeometryInput` also by `@element-editor/react`).

---

## `DrawType`

```ts
type DrawType = 'circle' | 'rectangle' | 'route'
```

Set on `GeoJSONFeature._drawType` when the feature was drawn with a tool that produces a geometry type GeoJSON cannot natively express:

| Value | Geometry type produced | Significance |
|---|---|---|
| `'circle'` | `Polygon` (64-sided approximation) | Editing preserved as circle; vertex edit converts to plain polygon. |
| `'rectangle'` | `Polygon` (4 corners) | Kept by the transform box; vertex edit converts to plain polygon. |
| `'route'` | `LineString` | Path follows road network. Vertex/transform edits may misalign from roads. |

---

## `Schema`

A named set of fields for feature properties. A feature follows the schema its `schemaId` names (none: the first schema). Several schemas can coexist; they travel with the data as `metadata.schemas`. Removing a field never deletes values already stored.

```ts
interface Schema {
  id: string            // features reference it in `schemaId`
  name: string          // shown in the schema editor and the feature panel
  fields: SchemaField[] // in display order
}
```

```ts
import type { Schema } from '@element-editor/react'

const parcel: Schema = {
  id: 'parcel',
  name: 'Parcel',
  fields: [
    { key: 'owner', label: 'Owner', type: 'text', required: true },
    { key: 'area_ha', label: 'Area (ha)', type: 'number', required: false, min: 0 },
  ],
}
```

Validation (`ref.validate()`, `ref.submit()`): a `required` field with a missing, `null` or blank value, a `number` outside `min` / `max`, and a zero-area polygon are errors. Errors never block editing.

---

## `SchemaField`

```ts
interface SchemaField {
  key: string         // auto-generated slug from label; used as the properties key
  label: string       // display name shown in forms
  type: FieldType
  required: boolean
  options?: string[]  // only for type 'select'
  min?: number        // only for type 'number'
  max?: number        // only for type 'number'
}
```

`key` is the property name written to `feature.properties[key]`. `label` is what the user sees in forms and column headers. They differ because labels are free text and keys must be JSON-safe.

---

## `FieldType`

```ts
type FieldType = 'text' | 'textarea' | 'number' | 'url' | 'select' | 'date' | 'boolean'
```

| Value | Renders as | Additional options |
|---|---|---|
| `'text'` | Single-line input | — |
| `'textarea'` | Multi-line input | — |
| `'number'` | Number input | `min`, `max` |
| `'url'` | URL input | — |
| `'select'` | Dropdown | `options: string[]` |
| `'date'` | Date picker | — |
| `'boolean'` | Checkbox | — |

---

## `Group`

```ts
interface Group {
  id: string
  name: string
  collapsed: boolean
  hidden?: boolean
}
```

Groups are containers for features in the layers panel. A feature belongs to at most one group (`GeoJSONFeature.groupId`). Hiding a group hides all its member features.

Groups travel with the data on `FeatureCollection.metadata.groups`. Removing a group (via `dataStore.deleteGroup(id, mode)`) can either ungroup or delete the member features depending on `mode`.

---

## Geometry types

All geometry types use GeoJSON coordinate order: `[longitude, latitude]`.

### `PointGeometry`

```ts
interface PointGeometry {
  type: 'Point'
  coordinates: [number, number]  // [longitude, latitude]
}
```

### `LineStringGeometry`

```ts
interface LineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]  // [[lng, lat], ...]
}
```

### `PolygonGeometry`

```ts
interface PolygonGeometry {
  type: 'Polygon'
  coordinates: [number, number][][]  // [outer ring, ...optional inner rings (holes)]
}
```

The first ring is the exterior boundary. Additional rings are holes.

### `MultiPointGeometry`

```ts
interface MultiPointGeometry {
  type: 'MultiPoint'
  coordinates: [number, number][]
}
```

### `MultiLineStringGeometry`

```ts
interface MultiLineStringGeometry {
  type: 'MultiLineString'
  coordinates: [number, number][][]
}
```

### `MultiPolygonGeometry`

```ts
interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: [number, number][][][]
}
```

### `GeometryCollectionGeometry`

```ts
interface GeometryCollectionGeometry {
  type: 'GeometryCollection'
  geometries: SimpleGeometry[]
}
```

### `SimpleGeometry`

Union of all geometry types except `GeometryCollection`:

```ts
type SimpleGeometry =
  | PointGeometry
  | MultiPointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry
```

### `Geometry`

```ts
type Geometry = SimpleGeometry | GeometryCollectionGeometry
```

### `CoordinateGeometry`

```ts
type CoordinateGeometry = SimpleGeometry
```

Alias for `SimpleGeometry`. Use when a function only handles geometries with a `coordinates` property (i.e., not `GeometryCollection`).

### `isSimpleGeometry(g)`

```ts
import { isSimpleGeometry } from '@element-editor/core'

if (isSimpleGeometry(feature.geometry)) {
  feature.geometry.coordinates  // narrowed to SimpleGeometry
}
```

`isSimpleGeometry` is a type guard: it's false only for a `GeometryCollection`.

---

## `EditingMode`

The FSM states for the drawing and editing interaction machine:

```ts
type EditingMode =
  | 'none'
  | 'place-point'
  | 'draw-line'
  | 'draw-polygon'
  | 'draw-circle'
  | 'draw-rect'
  | 'draw-route'
  | 'draw-freehand'
  | 'picker'
  | 'measure'
  | 'cut-hole'
  | 'slice-shape'
  | 'simplify-shape'
  | 'smooth-shape'
  | 'buffer-shape'
  | 'measure'
```

| Value | Active when |
|---|---|
| `'none'` | Selection mode; no active drawing. |
| `'place-point'` | Point tool active. |
| `'draw-line'` | Line tool active. |
| `'draw-polygon'` | Area tool active. |
| `'draw-circle'` | Circle tool active. |
| `'draw-rect'` | Rectangle tool active. |
| `'draw-route'` | Route tool active. |
| `'draw-freehand'` | Freehand tool active (click-and-drag). |
| `'pick-shape'` | Picker tool active (Eyedropper-style shape pick). |
| `'cut-hole'` | Cut hole tool active. |
| `'slice-shape'` | Slice shape tool active. |
| `'simplify-shape'` | Simplify slider preview is open. |
| `'smooth-shape'` | Smooth slider preview is open. |
| `'buffer-shape'` | Buffer slider preview is open. |
| `'measure'` | Measure tool active. |

---

## `NetworkConfig`

The shape of `config.network` (`@element-editor/core`): the servers one editor talks to (`vectorTiles`, `dem`, `osmRaster`, `glyphs`, `sprite`, `overpass`, `routing`, `nominatim`, `fetch`). `NetworkSource` is a tile URL (template with `{z}`, else TileJSON) or MapLibre source fields merged over the built-in source; `RoutingConfig` is `{ provider?: 'ors' | 'osrm', url?, apiKey?, attribution? }`; `NominatimConfig` is `{ url?, email?, attribution? }`. Every field is described in [Third-party services and self-hosting](../guides/third-party-services.md).

---

## `DataStore`

The interface for the Zustand data store, accessible via `useDataStore` and `useGeoStore`. The store state types (`DataStore`, `UIStore`, `UndoEntry`, `FeaturePatch`, `StoreFeaturePatch`, `DataStoreOptions`, `UIStoreOptions`, `DialogState`, `CompletedMeasurement`, `PanelPrefs`) are exported from `@element-editor/core` and covered by semver; `@element-editor/ui` re-exports `DataStore` and `UIStore` next to the store hooks.

```ts
interface DataStore {
  // State
  features: GeoJSONFeature[]
  schemas: Schema[]
  groups: Group[]
  selectedIds: string[]
  selectedGroupId: string | null   // the explicitly selected group (Cmd+G); cleared by every feature-selection action
  lastUsedSchemaId: string | null
  lastActiveGroupId: string | null
  undoStack: UndoEntry[]   // UndoEntry = { features: GeoJSONFeature[]; groups?: Group[]; schemas?: Schema[]; extras?: unknown }
  redoStack: UndoEntry[]
  lastModifiedAt: number | null
  clipboard: GeoJSONFeature[]
  maxFeatures?: number     // undefined = unlimited
  geometryTypes?: GeometryType[]   // undefined = every type; refusals report 'geometry-type-not-allowed' and change nothing
  currentZoom: number
  geometryMode: 'visual' | 'spatial'

  // Feature actions
  // Refused by `maxFeatures` (the error is reported via onError): addFeature returns null, the other adding actions false
  addFeature: (
    feature: GeoJSONFeature,
    options?: { insertAfterId?: string; skipSnapshot?: boolean; programmatic?: boolean; undoable?: boolean },
  ) => GeoJSONFeature | null   // the stored feature
  updateFeature: (
    id: string,
    updates: Partial<Pick<GeoJSONFeature, 'properties' | 'geometry' | 'schemaId' | 'hidden'>> & { _drawType?: undefined },  // _drawType: undefined clears it
    options?: { skipValidation?: boolean },
  ) => boolean   // false: the geometry's type is new to the feature and not in geometryTypes (nothing written)
  /** updateFeature for many features: one array copy, one notification, at most one undo step. */
  updateFeatures: (
    updates: ReadonlyArray<{ id: string; patch: FeaturePatch }>,   // FeaturePatch = updateFeature's `updates`
    options?: { skipValidation?: boolean; undoable?: boolean },
  ) => boolean   // false: a patch's geometry type isn't allowed; the whole batch is refused
  updateFeatureValidation: (id: string, warnings: string[], errors: string[]) => void
  deleteFeature: (id: string) => void
  /** Removes many features in one step; returns how many were removed. `undoable: false` also drops them from undo/redo. */
  deleteFeatures: (ids: Iterable<string>, options?: { undoable?: boolean }) => number
  /** Removes `removeIds` and adds `added` (at the top) in one commit and ONE undo step, then selects the added features (boolean ops). */
  replaceFeatures: (removeIds: Iterable<string>, added: GeoJSONFeature[]) => boolean
  duplicateFeature: (id: string) => boolean
  duplicateFeaturesAtPosition: (entries: Array<{ sourceId: string; geometry: GeoJSONFeature['geometry'] }>) => boolean
  duplicateSelection: () => boolean
  copySelection: () => Promise<boolean>   // true when the system clipboard was written too
  pasteSelection: () => boolean   // all-or-nothing under maxFeatures
  takeSnapshot: () => void
  /** Lets the host keep its own state in each undo entry (`extras`): `capture` runs on every snapshot, `restore` on undo/redo. */
  setUndoExtrasHandlers: (capture: () => unknown, restore: (extras: unknown) => void) => void

  // Selection
  selectFeature: (id: string | null) => void
  toggleSelection: (id: string) => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  selectGroup: (id: string | null) => void   // marks the selected group; doesn't touch selectedIds
  deleteSelection: () => void

  // Multi-geometry
  breakMultiGeometry: (id: string) => boolean
  mergeFeatures: () => boolean   // false: nothing merged (fewer than two selected, or the merged type isn't in geometryTypes)

  // History
  undo: () => void
  redo: () => void

  // Groups
  addGroup: (name: string) => void
  updateGroup: (id: string, updates: Partial<Pick<Group, 'name' | 'collapsed' | 'hidden'>>) => void
  deleteGroup: (id: string, mode: 'ungroup' | 'delete-features') => void
  toggleGroupCollapsed: (id: string) => void
  toggleGroupHidden: (id: string) => void
  toggleFeatureHidden: (id: string) => void
  moveFeatureToGroup: (featureId: string, groupId: string | null) => void
  reorderFeatures: (orderedIds: string[]) => void
  reorderGroups: (orderedIds: string[]) => void
  groupSelection: (name?: string) => string | null   // new group from the selection; null when it was empty
  ungroupSelection: () => void

  // Schemas
  getDefaultSchema: () => Schema
  getSchemaForFeature: (featureId: string) => Schema
  getVisibleSchemas: () => Schema[]
  setLastUsedSchemaId: (id: string) => void
  addSchema: (name: string, fields?: SchemaField[]) => string   // returns the new id
  updateSchema: (id: string, updates: { name: string }) => void
  deleteSchema: (id: string) => void   // no-op on the last schema
  addSchemaField: (schemaId: string, field: SchemaField) => void
  updateSchemaField: (schemaId: string, key: string, updates: Partial<SchemaField>) => void
  removeSchemaField: (schemaId: string, key: string) => void

  // Import / export
  exportGeoJSON: () => string
  importGeoJSON: (
    raw: unknown,
    mode: 'replace' | 'merge',
    limits?: { maxFeatures?: number; maxInputSize?: number; undoable?: boolean },
  ) => { skipped: number; duplicates: number; truncated: boolean; refused: number }  // limits.maxFeatures defaults to the store's maxFeatures; undoable: false (replace) adds no undo step and clears the history
  updateFeaturesFromEditor: (raw: unknown) => void   // applies the GeoJSON inspector's edited text

  // Feature limit
  setMaxFeatures: (max?: number) => void
  setGeometryTypes: (types?: GeometryType[]) => void
  isGeometryTypeAllowed: (type: string) => boolean   // silent: for deciding what to offer
  canUseGeometryTypes: (types: Iterable<string>, source?: 'editor' | 'import' | 'clipboard' | 'geometry') => boolean   // false also reports the refusal
  canAddFeatures: (count: number) => boolean  // false = over the limit; also reports the error

  // Geometry mode
  setGeometryMode: (mode: 'visual' | 'spatial') => void
  setCurrentZoom: (z: number) => void
}
```

The undo stack holds up to 25 snapshots of features, groups and schemas, so schema edits (add, rename, delete schema; add, edit, remove field) undo too. Repeated edits of the same field property within a second (typing a Min value) share one step. `updateFeature` pushes one step when `properties` or `schemaId` actually change (no-op edits push nothing; same-feature, same-keys edits within a second, such as typing a map label, share one step). It never pushes for `hidden` (view state) or for updates that include `geometry`: geometry callers take their own snapshot (`takeSnapshot()` or at drag start), so a geometry + properties update is one step. `updateFeatures` applies the same rule to a whole batch as one step: it pushes once when any patch changes `properties` or `schemaId` without `geometry`. Undo and redo clear `selectedIds`.

## `UIStore`

The interface for the Zustand UI store (`useUIStore`, `useGeoStore().uiStore`): the active tool and drawing state, panel and modal visibility, selection-related view state (vertex and part selection, hover), the `readonly` / tool / layout settings the editor props sync into it, units and measurement results. Import the type from `@element-editor/core` (or `@element-editor/ui`) to type your selectors:

```ts check=false
import type { UIStore } from '@element-editor/core'

const selectTableOpen = (s: UIStore) => s.tableOpen
```

Prefer the editor props and the ref API for changing the editor; write to the UI store only for view state your own UI owns (for example toggling a panel you render).

---

## Shortcut types

### `ShortcutId` (customizable)

```ts
type ShortcutId =
  | 'place-point'
  | 'draw-line'
  | 'draw-polygon'
  | 'draw-route'
  | 'draw-circle'
  | 'draw-rect'
  | 'draw-freehand'
  | 'picker'
  | 'measure'
  | 'cut-hole'
  | 'slice-shape'
  | 'break-apart'
  | 'toggle-table'
  | 'toggle-transform'
  | 'show-shortcuts'
  | 'toggle-geojson'
  | 'toggle-schema'
  | 'toggle-sidebar'
  | 'set-zoom'
```

Default key bindings:

| `ShortcutId` | Default key | Label |
|---|---|---|
| `'place-point'` | `p` | Place point |
| `'draw-line'` | `l` | Draw line |
| `'draw-polygon'` | `g` | Draw area |
| `'draw-route'` | `c` | Draw route |
| `'draw-circle'` | `o` | Draw circle |
| `'draw-rect'` | `r` | Draw rectangle |
| `'draw-freehand'` | `f` | Draw freehand |
| `'picker'` | `x` | Picker |
| `'measure'` | `m` | Measure |
| `'cut-hole'` | `h` | Cut hole |
| `'slice-shape'` | `j` | Slice shape |
| `'break-apart'` | `b` | Break apart |
| `'toggle-sidebar'` | `/` | Toggle layers panel |
| `'toggle-table'` | `t` | Toggle table |
| `'toggle-geojson'` | `i` | Toggle GeoJSON |
| `'toggle-transform'` | `a` | Toggle transformation |
| `'toggle-schema'` | `s` | Toggle schema editor |
| `'show-shortcuts'` | `k` | Toggle key shortcuts |
| `'set-zoom'` | `z` | Set zoom level |

Custom bindings are persisted to `localStorage` under the key `elm_shortcuts`.

### `FixedShortcutId` (not customizable)

```ts
type FixedShortcutId =
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'delete-selected'
  | 'search-places'
  | 'finish-drawing'
  | 'cancel'
  | 'group-selection'
  | 'ungroup-selection'
  | 'edit-selected'
  | 'toggle-sticky-tool'
  | 'import-geojson'
  | 'export-geojson'
```

| `FixedShortcutId` | Display | Aliases |
|---|---|---|
| `'undo'` | `⌘ Z` | — |
| `'redo'` | `⌘ ⇧ Z` | — |
| `'select-all'` | `⌘ A` | — |
| `'delete-selected'` | `Del` | `⌫` |
| `'search-places'` | `⌘ F` | — |
| `'finish-drawing'` | `↵` | — |
| `'cancel'` | `Esc` | — |
| `'group-selection'` | `⌘ G` | — |
| `'ungroup-selection'` | `⌘ ⇧ G` | — |
| `'edit-selected'` | `⌘ E` | — |
| `'toggle-sticky-tool'` | `⌘ J` | — |
| `'import-geojson'` | `⌘ O` | — |
| `'export-geojson'` | `⌘ S` | — |

Helpers `getFixedShortcutDisplay(id)` and `getFixedShortcutFullDisplay(id)` are exported from `@element-editor/core` for rendering.

---

## Accent palette

From `@element-editor/core`. See [Theming](../guides/theming.md#matching-your-own-layers-and-ui) for usage.

```ts check=false
type AccentShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950
type AccentPalette = Record<AccentShade, string> // hex colours, e.g. '#3b82f6'

const DEFAULT_ACCENT = '#3b82f6'

function accentPalette(accent?: string): AccentPalette              // any CSS colour; unrecognised → default blue
function readAccentPalette(el: Element | null | undefined): AccentPalette // inherited --elm-accent of el
function resolveColor(input: string): [number, number, number] | null     // any CSS colour → RGB
```

`ACCENT_STEPS` holds the per-shade factors (white-mix share for 50–500, lightness and chroma multipliers for 600–950). `parseColor` (hex and `rgb()` only) and `mixOklab` are exported as lower-level helpers.
