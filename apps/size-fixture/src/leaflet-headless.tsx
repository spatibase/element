// Headless Leaflet host: providers + map + ElementEditorControls + one button driving a tool via the ref.
import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import type { ElementEditorControlsRef } from '@element-editor/adapter-leaflet'

function App() {
  const ref = useRef<ElementEditorControlsRef>(null)
  const [ready, setReady] = useState(false)
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ position: 'relative', height: 600 }}>
          <MapContainer center={[48.86, 2.35]} zoom={5} whenReady={() => setReady(true)}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {ready && <ElementEditorControls ref={ref} onChange={(d) => console.log(d)} />}
          </MapContainer>
          <button onClick={() => ref.current?.setTool('polygon')}>Draw polygon</button>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
