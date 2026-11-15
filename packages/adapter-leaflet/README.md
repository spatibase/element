# @element-editor/adapter-leaflet

Plug Element drawing and editing tools (vertex editing, snapping, a data table, a GeoJSON inspector, undo/redo) into an existing Leaflet / react-leaflet map. You keep the map; Element adds the editing layer.

## Install

```bash
npm install @element-editor/adapter-leaflet @element-editor/ui leaflet react-leaflet
npm install -D @types/leaflet # TypeScript only
```

Peer dependencies: `react` and `react-dom` `^19.2` (React 18 is not supported), `react-leaflet` `^5`, `leaflet` `^1.9`. `@element-editor/ui` (the toolbars and panels) comes with the adapter; list it yourself when you import from it, because strict package managers (pnpm) only resolve packages you declare. Keep all `@element-editor/*` packages on the same version.

## Quick start

```tsx
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import '@element-editor/adapter-leaflet/style.css' // includes Leaflet's CSS

export default function MyMap() {
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light">
          <MapContainer center={[48.86, 2.35]} zoom={12} style={{ height: 600 }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ElementEditorControls onChange={(data) => console.log(data)} />
          </MapContainer>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

`ElementEditorUIProvider` supplies the contexts the editor needs (and renders its own toast `<Toaster>`); `ElementEditorControls` throws without it. The `data-elm-theme` element scopes the editor's styles (the stylesheet doesn't reset your page) and its keyboard shortcuts.

## Documentation

- [Quick start](https://elementeditor.dev/docs/quickstart/adapter-leaflet)
- [Adapter API reference](https://elementeditor.dev/docs/reference/adapter-leaflet)
- [Custom UI with adapters](https://elementeditor.dev/docs/guides/custom-ui-with-adapters) · [Next.js](https://elementeditor.dev/docs/guides/nextjs)
- [All docs](https://elementeditor.dev/docs) · [Changelog](https://github.com/spatibase/element/blob/main/CHANGELOG.md) · [Issues](https://github.com/spatibase/element/issues)

MIT licence.
