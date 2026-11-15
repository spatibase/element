# @element-editor/react

A complete map editor in one React component: drawing tools, vertex editing, snapping, schema-driven property forms, a data table, a GeoJSON inspector, undo/redo and keyboard shortcuts. The default entry owns a MapLibre GL map with built-in basemaps; `@element-editor/react/leaflet` is the same editor on Leaflet.

## Install

```bash
npm install @element-editor/react maplibre-gl
```

Peer dependencies: `react` and `react-dom` `^19.2` (React 18 is not supported), `maplibre-gl` `^5.5`. If your app pins an older React (Next.js 15's `create-next-app` installs 19.1), upgrade it: `npm install react@^19.2 react-dom@^19.2`.

## Quick start

```tsx
import { ElementEditor } from '@element-editor/react'
import '@element-editor/react/style.css' // includes MapLibre's CSS

export default function App() {
  return (
    <div style={{ height: 600 }}>
      <ElementEditor onChange={(data) => console.log(data)} />
    </div>
  )
}
```

The editor fills its container, so give the parent a height. In Next.js, load it with `dynamic(..., { ssr: false })` ([Next.js guide](https://elementeditor.dev/docs/guides/nextjs)).

## Leaflet instead of MapLibre

```bash
npm install @element-editor/react @element-editor/adapter-leaflet leaflet react-leaflet
npm install -D @types/leaflet # TypeScript only
```

```tsx
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css' // includes Leaflet's CSS
```

## Documentation

- [Quick start](https://elementeditor.dev/docs/quickstart/react)
- [`<ElementEditor />` API reference](https://elementeditor.dev/docs/reference/element-editor-react)
- [Basemaps](https://github.com/spatibase/element/blob/main/docs/guides/basemaps.md) and [third-party services, self-hosting and CSP](https://github.com/spatibase/element/blob/main/docs/guides/third-party-services.md)
- [Migrating from a 0.1 pre-release build](https://github.com/spatibase/element/blob/main/docs/guides/migrating-to-0.2.md)
- [All docs](https://elementeditor.dev/docs) · [Changelog](https://github.com/spatibase/element/blob/main/CHANGELOG.md) · [Issues](https://github.com/spatibase/element/issues)

MIT licence.
