/**
 * HeadlessDemo — what a host with its own toolbar mounts: providers + map + `ElementEditorControls`
 * and nothing else from the editor's UI (no toolbars, no panels). Tools are driven through the ref.
 * `?headless=leaflet|maplibre` opens it; `&drawingBar=0` passes `drawingBar={false}`. (e2e)
 * Placement checks: `&width=380` (host width in px), `&cluster=1` (a host control cluster bottom-left),
 * `&lift=72` (sets `--elm-drawing-bar-bottom: 72px`), `&slot=1` (`drawingBar={{ container }}` = a slot under the map),
 * `&slot=late` (`container` is `null` until the host-mount-slot button is pressed).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
  const params = new URLSearchParams(location.search)
  const width = params.get('width')
  const cluster = params.get('cluster') === '1'
  const lift = params.get('lift')
  const slotMode = params.get('slot')
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null)
  const [slotMounted, setSlotMounted] = useState(slotMode !== 'late')
  const barOption = slotMode ? { container: slotMounted ? slotEl : null } : drawingBar
  const ref = useRef<ControlsRef>(null)
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [leafletReady, setLeafletReady] = useState(false)
  // A host's own handler up the tree: a press on the bar must not reach it either.
  const [hostClicks, setHostClicks] = useState(0)
  // e2e drives the controls' ref directly (setVertexEdit, …), as a host's own toolbar would.
  useEffect(() => {
    const w = window as unknown as { __elementEditorRef?: unknown }
    w.__elementEditorRef = ref.current
    return () => { delete w.__elementEditorRef }
  })

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
          style={{ position: 'relative', height: '100%', width: width ? Number(width) : undefined,
            ...(lift ? { '--elm-drawing-bar-bottom': `${lift}px` } : {}) } as CSSProperties}>
          <div style={{ position: 'relative', height: slotMode ? 'calc(100% - 80px)' : '100%' }}>
          {engine === 'leaflet' ? (
            <MapContainer center={[48.86, 2.35]} zoom={5} zoomControl={false} style={{ height: '100%' }} whenReady={() => setLeafletReady(true)}>
              {leafletReady && <Leaflet.ElementEditorControls ref={ref as never} drawingBar={barOption} />}
            </MapContainer>
          ) : (
            <>
              <div ref={el} style={{ height: '100%' }} />
              {map && <MapLibre.ElementEditorControls ref={ref as never} map={map} drawingBar={barOption} />}
            </>
          )}
          {cluster && (
            <div data-testid="host-cluster" style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, display: 'flex', gap: 4 }}>
              {['+', '-', 'GPS'].map((l) => <button key={l} style={{ width: 44, height: 44 }}>{l}</button>)}
            </div>
          )}
          </div>
          {slotMode && <div data-testid="host-slot" ref={setSlotEl} style={{ height: 80, display: 'flex', alignItems: 'center', border: '1px dashed #999' }} />}
          <button data-testid="host-mount-slot" style={{ position: 'absolute', top: 8, right: 8, zIndex: 1200 }}
            onClick={(e) => { e.stopPropagation(); setSlotMounted(true) }}>Mount slot</button>
          <button data-testid="host-draw-line" style={{ position: 'absolute', top: 8, left: 8, zIndex: 1200 }}
            onClick={(e) => { e.stopPropagation(); ref.current?.setTool('line') }}>Draw line</button>
        </div>
      </Store>
    </Provider>
  )
}
