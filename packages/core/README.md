# @element-editor/core

Shared core of the [Element](https://elementeditor.dev) map editor: Zustand store factories and their state types (`DataStore`, `UIStore`), TypeScript types (`FeatureCollection`, `GeoJSONFeature`, `Schema`, …), GeoJSON helpers (bbox, parsing, schema validation), routing (`fetchRoute`), the `NetworkConfig` type (`config.network`), and storage helpers (`readPersisted`/`writePersisted`, `readStorage`/`writeStorage`). `@element-editor/core/internal` is plumbing for the other Element packages and is not covered by semver; don't import it. It has no React components and no workers; the geometry worker lives in `@element-editor/ui`.

## Install

You don't need to install it to use Element: it comes with `@element-editor/react` and both adapters. Add it to your own `package.json` (same version as your other `@element-editor/*` packages) only when you import from it, for example the data types when using an adapter, or `getFeatureCollectionBBox`:

```bash
npm install @element-editor/core
```

## Quick start

```ts
import { getFeatureCollectionBBox, type FeatureCollection } from '@element-editor/core'

// e.g. as the onChange of <ElementEditor> or an adapter's <ElementEditorControls>
export function handleChange(data: FeatureCollection) {
  const bbox = getFeatureCollectionBBox(data) // [west, south, east, north], or null when empty
  const schemas = data.metadata.schemas // the feature schemas travel with the data
  console.log(data.features.length, bbox, schemas.length)
}
```

## Documentation

- [Types reference](https://elementeditor.dev/docs/reference/types) · [Events](https://elementeditor.dev/docs/reference/events)
- [All docs](https://elementeditor.dev/docs) · [Changelog](https://github.com/spatibase/element/blob/main/CHANGELOG.md) · [Issues](https://github.com/spatibase/element/issues)

MIT licence.
