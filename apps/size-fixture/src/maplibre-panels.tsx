// MapLibre host with the stock ui panels, as docs/guides/custom-ui-with-adapters.md shows.
import { createRoot } from 'react-dom/client'
import { Suspense, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-maplibre'
import type { ElementEditorControlsRef } from '@element-editor/adapter-maplibre'
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
        <ThemeContext.Provider value="light">
          <div data-elm-theme="light" style={{ position: 'relative', height: 600, overflow: 'hidden' }}>
            <div ref={el} style={{ height: '100%' }} />
            {ready && mapRef.current && (
              <ElementEditorControls ref={ref} map={mapRef.current} drawingBar={false}>
                <FloatingToolbar />
                <EditingToolbar />
                <ActiveDrawingToolbar />
                <FitBoundsButton />
                <LayersPanel />
                <Suspense fallback={null}><DataTablePanel /></Suspense>
                <Suspense fallback={null}><ShortcutsModal /></Suspense>
                <Suspense fallback={null}><SettingsModal /></Suspense>
                <Modals />
              </ElementEditorControls>
            )}
          </div>
        </ThemeContext.Provider>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
