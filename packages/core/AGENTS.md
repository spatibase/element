# @element-editor/core: guide for coding agents

The framework-light core of the Element map editor: the GeoJSON and schema types, the zustand stores (`createDataStore`, `createUIStore`), `ElementEditorError` and its codes, and helpers (bbox, GeoJSON parsing, schema validation, formatting, storage). No UI and no map.

You rarely use it alone. Every other Element package depends on it. Install it yourself when you use an adapter and want its types or helpers (`@element-editor/react` re-exports the common types, so drop-in users usually don't need it). For building an editor, start from `node_modules/@element-editor/react/AGENTS.md` (when installed) or https://elementeditor.dev/docs/introduction/choosing-a-package.

## Install

```bash
pnpm add @element-editor/core
```

Peer: `react` `^19.2.0`. No CSS. Use the same version as your other `@element-editor/*` packages (pnpm only resolves packages listed in your own `package.json`).

## Types

| Type | Shape |
|---|---|
| `FeatureCollection` | what Element hands back: `{ type: 'FeatureCollection'; metadata: { schemas: Schema[]; groups: Group[] }; features: GeoJSONFeature[] }` |
| `GeoJSONFeature` | `{ type: 'Feature'; id: string; geometry: Geometry; properties: Record<string, unknown>; schemaId?; groupId?; hidden?; _drawType?: 'circle' \| 'rectangle' \| 'route'; bbox? }` (stored features may also carry an `@internal` `_validation`, stripped from output) |
| `FeatureCollectionInput` / `GeoJSONFeatureInput` | what Element accepts: plain RFC 7946; `metadata` optional, `id` optional (string or number; missing ids get UUIDs), `properties` may be `null` |
| `Schema` | `{ id: string; name: string; fields: SchemaField[] }` |
| `SchemaField` | `{ key; label; type: FieldType; required: boolean; options?; min?; max? }` |
| `FieldType` | `'text' \| 'textarea' \| 'number' \| 'url' \| 'select' \| 'date' \| 'boolean'` |
| `FeaturePatch` | `Partial<Pick<GeoJSONFeature, 'properties' \| 'geometry' \| 'schemaId' \| 'hidden'>>` (for `ref.updateFeature`) |
| `BBox` | `[west, south, east, north]` |
| `FlyToOptions` | `{ center: [lng, lat]; zoom? }` |
| `NetworkConfig` | `config.network`: `vectorTiles`, `dem`, `osmRaster`, `glyphs`, `sprite`, `maplibreWorker`, `overpass`, `routing`, `nominatim`, `fetch` |
| `ErrorCode`, `ErrorSource` | closed unions, semver-covered; see the drop-in's `AGENTS.md` |
| `DataStore`, `UIStore` | state + actions of the two zustand stores (`useDataStore` / `useUIStore` selectors, `useGeoStore().dataStore.getState()`); also `UndoEntry`, `PanelPrefs`, `DialogState`, `CompletedMeasurement`, `DataStoreOptions`, `UIStoreOptions` |

All coordinates are GeoJSON `[lng, lat]`. Schemas and groups travel in the collection's `metadata` (an RFC 7946 foreign member): save and restore the whole object, not only `features`.

## Helpers

```ts
import { getFeatureCollectionBBox, parseGeoJSONText, validateFeature, type FeatureCollection, type Schema } from '@element-editor/core'

export function checkFile(text: string) {
  const parsed = parseGeoJSONText(text) // returns an error instead of throwing; shape check only (ids, metadata not filled in)
  if (!parsed.ok) return parsed.error.kind // 'too-large' | 'invalid-json' | 'not-feature-collection'
  return getFeatureCollectionBBox(parsed.fc) // [w, s, e, n], or null when there are no features
}

// On data from onChange / ref.getFeatureCollection() (normalised: every feature has an id).
export function schemaErrors(fc: FeatureCollection, schema: Schema) {
  return fc.features.map((f) => ({ id: f.id, errors: validateFeature(f, schema).errors }))
}
```

Other public helpers: `readPersisted` / `writePersisted` (versioned localStorage), `readStorage` / `writeStorage` (never throw), `formatLength` / `formatArea`, `accentPalette`, `ElementEditorError`.

## Gotchas

- Inside React, don't create stores yourself: `GeoStoreProvider` (from `@element-editor/ui` or an adapter) creates one per editor and the adapter's ref is the supported way to change data. `createDataStore` / `createUIStore` are for headless use and tests.
- `onChange` output always has `metadata.schemas` and `metadata.groups`; input may omit them.
- Removing a schema field never deletes the property values already on features.
- Import only from `@element-editor/core`. `@element-editor/core/internal` is plumbing for the other Element packages, without semver guarantees.

Docs: https://elementeditor.dev/docs/reference/types, https://elementeditor.dev/docs/introduction/geojson-primer, https://elementeditor.dev/docs/guides/schema-and-validation. Markdown: append `.md`; everything at once: https://elementeditor.dev/llms-full.txt.
