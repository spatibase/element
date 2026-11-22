// Leaflet host with the stock ui panels, as docs/guides/custom-ui-with-adapters.md shows.
import { createRoot } from 'react-dom/client'
import { Suspense, useRef, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'
import type { ElementEditorControlsRef } from '@element-editor/adapter-leaflet'
import {
  ThemeContext, FloatingToolbar, EditingToolbar, ActiveDrawingToolbar, FitBoundsButton, LayersPanel,
  DataTablePanel, ShortcutsModal, SettingsModal, SchemaModal, GeoJSONModal, useUIStore,
} from '@element-editor/ui'

function Modals() {
  const schemaOpen = useUIStore((s) => s.schemaModalOpen)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const codeOpen = useUIStore((s) => s.codeModalOpen)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)
  return (
    <>
      {schemaOpen && <Suspense fallback={null}><SchemaModal onClose={toggleSchema} /></Suspense>}
      {codeOpen && <Suspense fallback={null}><GeoJSONModal onClose={toggleCode} /></Suspense>}
    </>
  )
}

function App() {
  const ref = useRef<ElementEditorControlsRef>(null)
  const [ready, setReady] = useState(false)
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <ThemeContext.Provider value="light">
          <div data-elm-theme="light" style={{ position: 'relative', height: 600, overflow: 'hidden' }}>
            <MapContainer center={[48.86, 2.35]} zoom={5} whenReady={() => setReady(true)}>
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {ready && <ElementEditorControls ref={ref} drawingBar={false} />}
            </MapContainer>
            {ready && (
              <>
                <FloatingToolbar />
                <EditingToolbar />
                <ActiveDrawingToolbar />
                <FitBoundsButton />
                <LayersPanel />
                <Suspense fallback={null}><DataTablePanel /></Suspense>
                <Suspense fallback={null}><ShortcutsModal /></Suspense>
                <Suspense fallback={null}><SettingsModal /></Suspense>
                <Modals />
              </>
            )}
          </div>
        </ThemeContext.Provider>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
