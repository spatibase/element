/**
 * HeadlessDemo — what a host with its own toolbar mounts: providers + map + `ElementEditorControls`
 * and nothing else from the editor's UI (no toolbars, no panels). Tools are driven through the ref.
 * `?headless=leaflet|maplibre` opens it; `&drawingBar=0` passes `drawingBar={false}`. (e2e)
 */
import { useEffect, useRef, useState } from 'react'
import { MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import * as Leaflet from '@element-editor/adapter-leaflet'
import * as MapLibre from '@element-editor/adapter-maplibre'

maplibregl.setWorkerUrl(workerUrl)

type ControlsRef = { setTool: (t: 'line') => void }

export default function HeadlessDemo({ engine, drawingBar }: { engine: 'leaflet' | 'maplibre'; drawingBar: boolean }) {
  const ref = useRef<ControlsRef>(null)
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [leafletReady, setLeafletReady] = useState(false)
  // A host's own handler up the tree: a press on the bar must not reach it either.
  const [hostClicks, setHostClicks] = useState(0)

  useEffect(() => {
    if (engine !== 'maplibre' || !el.current) return
    const m = new maplibregl.Map({ container: el.current, style: { version: 8, sources: {}, layers: [] }, center: [2.35, 48.86], zoom: 5 })
    m.on('load', () => setMap(m))
    return () => { m.remove(); setMap(null) }
  }, [engine])

  const Provider = engine === 'leaflet' ? Leaflet.ElementEditorUIProvider : MapLibre.ElementEditorUIProvider
  const Store = engine === 'leaflet' ? Leaflet.GeoStoreProvider : MapLibre.GeoStoreProvider
  return (
    <Provider>
      <Store>
        <div data-elm-theme="light" data-host-clicks={hostClicks} onClick={() => setHostClicks((n) => n + 1)}
          style={{ position: 'relative', height: '100%' }}>
          {engine === 'leaflet' ? (
            <MapContainer center={[48.86, 2.35]} zoom={5} zoomControl={false} style={{ height: '100%' }} whenReady={() => setLeafletReady(true)}>
              {leafletReady && <Leaflet.ElementEditorControls ref={ref as never} drawingBar={drawingBar} />}
            </MapContainer>
          ) : (
            <>
              <div ref={el} style={{ height: '100%' }} />
              {map && <MapLibre.ElementEditorControls ref={ref as never} map={map} drawingBar={drawingBar} />}
            </>
          )}
          <button data-testid="host-draw-line" style={{ position: 'absolute', top: 8, left: 8, zIndex: 1200 }}
            onClick={(e) => { e.stopPropagation(); ref.current?.setTool('line') }}>Draw line</button>
        </div>
      </Store>
    </Provider>
  )
}
