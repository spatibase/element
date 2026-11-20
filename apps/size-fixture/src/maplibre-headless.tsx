// Headless MapLibre host: providers + map + ElementEditorControls + one button driving a tool via the ref.
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import type { ElementEditorControlsRef } from '@element-editor/adapter-maplibre'

function App() {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ref = useRef<ElementEditorControlsRef>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current!, style: 'https://demotiles.maplibre.org/style.json' })
    mapRef.current = map
    map.on('load', () => setReady(true))
    return () => map.remove()
  }, [])
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', height: 600 }}>
          <div ref={el} style={{ height: '100%' }} />
          {ready && mapRef.current && <ElementEditorControls ref={ref} map={mapRef.current} onChange={(d) => console.log(d)} />}
          <button onClick={() => ref.current?.setTool('polygon')}>Draw polygon</button>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
