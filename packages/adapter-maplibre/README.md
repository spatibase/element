# @element-editor/adapter-maplibre

Plug Element drawing and editing tools (vertex editing, snapping, a data table, a GeoJSON inspector, undo/redo) into an existing MapLibre GL map. You keep the map; Element adds the editing layer. MapTiler SDK and Mapbox GL JS maps work too.

## Install

```bash
npm install @element-editor/adapter-maplibre @element-editor/ui maplibre-gl
```

Peer dependencies: `react` and `react-dom` `^19.2` (React 18 is not supported), `maplibre-gl` 5.5 or 6. `@element-editor/ui` (the toolbars and panels) comes with the adapter; list it yourself when you import from it, because strict package managers (pnpm) only resolve packages you declare. Keep all `@element-editor/*` packages on the same version.

## Quick start

```tsx
import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import '@element-editor/adapter-maplibre/style.css'

export default function MyMap() {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current!,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [2.35, 48.86], zoom: 12,
    })
    setMap(m)
    return () => { m.remove(); setMap(null) }
  }, [])

  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', height: 600 }}>
          <div ref={container} style={{ width: '100%', height: '100%' }} />
          {map && <ElementEditorControls map={map} onChange={(data) => console.log(data)} />}
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

`ElementEditorUIProvider` supplies the contexts the editor needs (and renders its own toast `<Toaster>`); `ElementEditorControls` throws without it. The `data-elm-theme` element scopes the editor's styles (the stylesheet doesn't reset your page) and its keyboard shortcuts. `ElementEditorControls` waits for the style to accept sources, so it can mount as soon as the map exists.

## Built-in basemaps

`BasemapControl` (main entry) plus the catalog in `@element-editor/adapter-maplibre/basemaps` (`BASEMAPS`, `setBasemap`, `loadBasemapStyle`, `resolveBasemap`): Streets, Terrain, Light and Dark on OpenFreeMap tiles, OpenStreetMap raster, and `'auto'` (follows the editor theme). Switching styles keeps Element's layers, and after your own `map.setStyle()` Element restores them by itself. See [the basemaps guide](https://github.com/spatibase/element/blob/main/docs/guides/basemaps.md); the default sprite loads from jsDelivr, and every host can be replaced with `config.network` ([third-party services](https://github.com/spatibase/element/blob/main/docs/guides/third-party-services.md)).

## Works with MapTiler SDK and Mapbox GL JS

The adapter only uses APIs shared between MapLibre GL, MapTiler SDK, and Mapbox GL JS (`flyTo`, `fitBounds`, `project`/`unproject`, GeoJSON sources/layers, pointer events, `queryRenderedFeatures`, etc.). Pass your map instance directly. Keep `maplibre-gl` installed either way: the adapter imports it at runtime for its map markers, and as an optional peer it isn't installed for you.

```tsx check=false
// MapTiler SDK — drop-in, no cast needed (their Map extends MapLibre's).
import * as maptilersdk from '@maptiler/sdk'
const map = new maptilersdk.Map({ ... })
<ElementEditorControls map={map} />

// Mapbox GL JS — runtime-compatible, one TypeScript cast required because
// @types/mapbox-gl and maplibre-gl declare separate (but structurally similar)
// Map types.
import mapboxgl from 'mapbox-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
const map = new mapboxgl.Map({ ... })
<ElementEditorControls map={map as unknown as MapLibreMap} />
```

If you hit a runtime error specific to Mapbox or MapTiler (not a TypeScript complaint), please [file an issue](https://github.com/spatibase/element/issues) — the adapter is designed to stay on the shared subset.

## Documentation

- [Quick start](https://elementeditor.dev/docs/quickstart/adapter-maplibre)
- [Adapter API reference](https://elementeditor.dev/docs/reference/adapter-maplibre)
- [Custom UI with adapters](https://elementeditor.dev/docs/guides/custom-ui-with-adapters) · [Next.js](https://elementeditor.dev/docs/guides/nextjs)
- [All docs](https://elementeditor.dev/docs) · [Changelog](https://github.com/spatibase/element/blob/main/CHANGELOG.md) · [Issues](https://github.com/spatibase/element/issues)

MIT licence.
