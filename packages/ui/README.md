# @element-editor/ui

The toolbars, layers panel, data table, schema forms, GeoJSON inspector and modals of the [Element](https://elementeditor.dev) map editor, as separate React components. Use it with `@element-editor/adapter-leaflet` or `@element-editor/adapter-maplibre` to place the editor UI in your own layout. You don't need it with `@element-editor/react`, which includes it.

## Install

```bash
npm install @element-editor/ui @element-editor/adapter-leaflet leaflet react-leaflet
# or, for MapLibre: npm install @element-editor/ui @element-editor/adapter-maplibre maplibre-gl
```

Peer dependencies: `react` and `react-dom` `^19.2` (React 18 is not supported). It has no stylesheet of its own: import your adapter's (`@element-editor/adapter-leaflet/style.css` or `@element-editor/adapter-maplibre/style.css`). Render every component inside `ElementEditorUIProvider`, `GeoStoreProvider` and an element with `data-elm-theme="light"` or `"dark"`. Keep all `@element-editor/*` packages on the same version.

## Quick start

```tsx
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import { LayersPanel } from '@element-editor/ui'
import '@element-editor/adapter-leaflet/style.css'

export default function MyEditor() {
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', height: 600 }}>
          <MapContainer center={[48.86, 2.35]} zoom={12} style={{ height: '100%' }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ElementEditorControls />
          </MapContainer>
          <LayersPanel />
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

The panels are ordinary HTML overlays: render them next to the map, not inside `MapContainer`. The data table and modals are lazy-loaded, so wrap each in its own `<Suspense>`.

## Documentation

- [Custom UI with adapters](https://elementeditor.dev/docs/guides/custom-ui-with-adapters)
- [UI API reference](https://elementeditor.dev/docs/reference/element-editor-ui)
- [All docs](https://elementeditor.dev/docs) · [Changelog](https://github.com/spatibase/element/blob/main/CHANGELOG.md) · [Issues](https://github.com/spatibase/element/issues)

MIT licence.
