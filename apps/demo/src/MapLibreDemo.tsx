/**
 * MapLibreDemo — @element-editor/adapter-maplibre with the full @element-editor/ui panel set.
 *
 * Demonstrates that a developer can replicate the complete @element-editor/react
 * experience using the adapter + @element-editor/ui components, while keeping full
 * control over the map instance and layout.
 */
import { useEffect, useRef, useState, useCallback, Suspense, type ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre GL JS 6 loads its worker from a separate file; a bundled app points MapLibre at it
// (MapLibre's Vite setup). The drop-in falls back to a CDN copy, but a host map like this one has
// to set it itself.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { ElementToaster, ElementEditorConfigProvider, type ElementEditorConfig } from '@element-editor/ui'
import { Table, TreeStructure, Code, Gear, Keyboard, Check } from '@phosphor-icons/react'
import { GeoStoreProvider, ElementEditorControls, BasemapControl } from '@element-editor/adapter-maplibre'
import type { ElementEditorControlsRef } from '@element-editor/adapter-maplibre'
import type { FeatureCollection } from '@element-editor/core'
import { getFeatureCollectionBBox } from '@element-editor/core'
import { HostThemeRoot } from './components/HostThemeRoot'
import { useGeoJSONDropzone, GeoJSONExportButton } from './components/GeoJSONDropzone'
import {
  ShortcutConfigProvider,
  EventProvider,
  ThemeReportingProvider,
  LayersPanel,
  FloatingToolbar,
  EditingToolbar,
  UndoRedoToolbar,
  ActiveDrawingToolbar,
  FitBoundsButton,
  LocateButton,
  ZoomIndicator,
  DataTablePanel,
  ShortcutsModal,
  SettingsModal,
  SchemaModal,
  GeoJSONModal,
  SimplifyPanel,
  SmoothPanel,
  BufferPanel,
  IconButton,
  KbdDark,
  Button,
  useUIStore,
  useShortcutConfig,
} from '@element-editor/ui'

// ─── Action buttons wired to UIStore ─────────────────────────────────────────

maplibregl.setWorkerUrl(workerUrl)

// Per-editor network settings (config.network): the ORS key for the Route tool, the sprite from this server.
const DEMO_CONFIG: ElementEditorConfig = {
  network: { routing: { apiKey: import.meta.env.VITE_ORS_API_KEY }, sprite: location.origin + '/sprite' },
}

function BottomBar({ extra }: { extra?: ReactNode }) {
  const tableOpen = useUIStore((s) => s.tableOpen)
  const schemaOpen = useUIStore((s) => s.schemaModalOpen)
  const codeOpen = useUIStore((s) => s.codeModalOpen)
  const shortcutsOpen = useUIStore((s) => s.shortcutsModalOpen)
  const toggleTable = useUIStore((s) => s.toggleTable)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)
  const openShortcuts = useUIStore((s) => s.openShortcutsModal)
  const closeShortcuts = useUIStore((s) => s.closeShortcutsModal)
  const setSettingsOpen = useUIStore((s) => s.setSettingsModalOpen)
  const settingsOpen = useUIStore((s) => s.settingsModalOpen)
  const readonly = useUIStore((s) => s.readonly)
  const { getKey } = useShortcutConfig()

  return (
    <div className="absolute bottom-[calc(var(--elm-table-offset,0px)+16px)] left-4 z-[400] flex items-center gap-2 pointer-events-auto">
      <FitBoundsButton />
      <LocateButton />
      <ZoomIndicator fractional />
      <BasemapControl defaultValue="osm" initialApplied />
      {extra}

      <IconButton
        label={tableOpen ? 'Hide table' : 'Show table'}
        shortcut={<KbdDark>{getKey('toggle-table').toUpperCase()}</KbdDark>}
        onClick={toggleTable}
        active={tableOpen}
      >
        <Table size={24} />
      </IconButton>

      {!readonly && (
        <IconButton label="Edit schema" onClick={toggleSchema} active={schemaOpen}>
          <TreeStructure size={24} />
        </IconButton>
      )}

      <IconButton
        label="Show GeoJSON"
        shortcut={<KbdDark>{getKey('toggle-geojson').toUpperCase()}</KbdDark>}
        onClick={toggleCode}
        active={codeOpen}
      >
        <Code size={24} />
      </IconButton>

      <IconButton label="Editor settings" onClick={() => setSettingsOpen(!settingsOpen)} active={settingsOpen}>
        <Gear size={24} />
      </IconButton>

      <IconButton
        label="Keyboard shortcuts"
        shortcut={<KbdDark>{getKey('show-shortcuts').toUpperCase()}</KbdDark>}
        onClick={shortcutsOpen ? closeShortcuts : openShortcuts}
        active={shortcutsOpen}
      >
        <Keyboard size={24} />
      </IconButton>
    </div>
  )
}

function ConditionalModals() {
  const schemaOpen = useUIStore((s) => s.schemaModalOpen)
  const toggleSchema = useUIStore((s) => s.toggleSchemaModal)
  const codeOpen = useUIStore((s) => s.codeModalOpen)
  const toggleCode = useUIStore((s) => s.toggleCodeModal)

  return (
    <>
      {schemaOpen && <SchemaModal onClose={toggleSchema} />}
      {codeOpen && <GeoJSONModal onClose={toggleCode} />}
    </>
  )
}

// ─── Main demo component ──────────────────────────────────────────────────────

export default function MapLibreDemo() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const controlsRef = useRef<ElementEditorControlsRef>(null)
  const [mapReady, setMapReady] = useState(false)

  const handleChange = useCallback((_data: FeatureCollection) => {}, [])

  const handleImport = useCallback((fc: FeatureCollection) => {
    controlsRef.current?.setFeatureCollection(fc)
    const bbox = getFeatureCollectionBBox(fc)
    if (bbox) controlsRef.current?.fitBounds(bbox)
  }, [])

  const { rootProps, Button: ImportButton, Overlay: DropOverlay } = useGeoJSONDropzone({
    onImport: handleImport,
  })

  const getExportFC = useCallback(
    () => controlsRef.current?.getFeatureCollection() ?? null,
    [],
  )

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.35, 48.86],
      zoom: 5,
      attributionControl: { compact: true },
    })

    mapRef.current = map

    function disableBuildings() {
      map.getStyle().layers
        .filter(l => l.type === 'fill-extrusion')
        .forEach(l => map.setLayoutProperty(l.id, 'visibility', 'none'))
    }

    if (map.isStyleLoaded()) {
      disableBuildings()
      setMapReady(true)
    } else {
      map.on('load', () => { disableBuildings(); setMapReady(true) })
    }

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  return (
    <ElementEditorConfigProvider config={DEMO_CONFIG}>
    <GeoStoreProvider>
      <ShortcutConfigProvider>
        <EventProvider>
          <ThemeReportingProvider>
            <HostThemeRoot
              className="relative w-full h-full overflow-clip bg-gray-50 dark:bg-gray-900 flex"
              {...rootProps}
            >
              {/* MapLibre map — fills remaining space beside the sidebar */}
              <div ref={mapContainer} className="flex-1 h-full" />

              {/* All panels rendered once the map + store are ready */}
              {mapReady && mapRef.current && (
                <ElementEditorControls
                  ref={controlsRef}
                  map={mapRef.current}
                  onChange={handleChange}
                >
                  {/* Drawing toolbar — top center */}
                  <FloatingToolbar />

                  {/* Undo/Redo — left center, vertical (parity with @element-editor/react) */}
                  {/* Centred on the map above the data table and the bottom button row
                      (inline: apps/demo classes aren't in the library's CSS). */}
                  <div className="absolute left-4 z-[400] flex flex-col justify-center pointer-events-none"
                    style={{ top: 16, bottom: 'calc(var(--elm-table-offset, 0px) + 80px)' }}>
                    <div className="pointer-events-auto">
                      <UndoRedoToolbar direction="vertical" />
                    </div>
                  </div>

                  {/* Editing toolbar + processing panels — bottom center */}
                  {/* Above the bottom-left button row (48 px + gaps), which it overlapped on narrower screens. */}
                  <div className="absolute left-1/2 -translate-x-1/2 z-[400] flex gap-2"
                    style={{ bottom: 'calc(var(--elm-table-offset, 0px) + 76px)' }}>
                    <EditingToolbar />
                    <ActiveDrawingToolbar />
                    <SimplifyPanel />
                    <SmoothPanel />
                    <BufferPanel />
                  </div>

                  {/* Action buttons — bottom left */}
                  <BottomBar extra={<><ImportButton /><GeoJSONExportButton getFeatureCollection={getExportFC} /></>} />

                  {/* Drag-drop overlay — only visible while a file is being dragged */}
                  <DropOverlay />

                  {/* Right sidebar — flex sibling of the map div (ElementEditorControls adds no DOM wrapper) */}
                  <LayersPanel />

                  {/* Data table, modals — lazy; Suspense is mandatory */}
                  <Suspense fallback={null}>
                    <DataTablePanel />
                    <ShortcutsModal />
                    <SettingsModal />
                    <ConditionalModals />
                  </Suspense>
                </ElementEditorControls>
              )}

              <ElementToaster position="bottom-right" />
            </HostThemeRoot>
          </ThemeReportingProvider>
        </EventProvider>
      </ShortcutConfigProvider>
    </GeoStoreProvider>
    </ElementEditorConfigProvider>
  )
}
