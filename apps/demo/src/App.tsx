import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ElementToaster, IconButton } from '@element-editor/ui'
import { ElementEditor } from '@element-editor/react'
import type { ElementEditorRef } from '@element-editor/react'
import type { FeatureCollection } from '@element-editor/core'
import { getFeatureCollectionBBox } from '@element-editor/core'
import { Agentation } from 'agentation'
import { Broom } from '@phosphor-icons/react'
import { useGeoJSONDropzone, GeoJSONExportButton } from './components/GeoJSONDropzone'
import { SAMPLE_DATA, SAMPLE_SCHEMA } from './sampleData'

// Lazy-loaded demo tabs so only the active map engine ships in the initial chunk.
const MapLibreDemo = lazy(() => import('./MapLibreDemo'))
const LeafletDemo = lazy(() => import('./LeafletDemo'))
const HeadlessDemo = lazy(() => import('./HeadlessDemo'))

type Tab = 'react' | 'maplibre' | 'leaflet'

export default function App() {
  // ?headless=leaflet|maplibre: a host that mounts only the adapter controls (e2e, see HeadlessDemo)
  const params = new URLSearchParams(location.search)
  const headless = params.get('headless')
  if (headless === 'leaflet' || headless === 'maplibre') {
    return <Suspense fallback={null}><HeadlessDemo engine={headless} drawingBar={params.get('drawingBar') !== '0'} /></Suspense>
  }
  return <TabbedApp />
}

function TabbedApp() {
  const [tab, setTab] = useState<Tab>('react')

  return (
    <>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Tab bar */}
        <div style={{
          display: 'flex',
          gap: 0,
          background: '#0a0a0a',
          flexShrink: 0,
          borderBottom: '1px solid #262626',
        }}>
          <TabButton active={tab === 'react'} onClick={() => setTab('react')}>
            @element-editor/react
          </TabButton>
          <TabButton active={tab === 'maplibre'} onClick={() => setTab('maplibre')}>
            @element-editor/adapter-maplibre
          </TabButton>
          <TabButton active={tab === 'leaflet'} onClick={() => setTab('leaflet')}>
            @element-editor/adapter-leaflet
          </TabButton>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {tab === 'react' && <ElementEditorTab />}
          {(tab === 'maplibre' || tab === 'leaflet') && (
            <Suspense fallback={null}>
              {tab === 'maplibre' ? <MapLibreDemo /> : <LeafletDemo />}
            </Suspense>
          )}
        </div>
      </div>
      {import.meta.env.DEV && !navigator.webdriver && <Agentation endpoint="http://localhost:4747" />}
    </>
  )
}

function ElementEditorTab() {
  const elementEditorRef = useRef<ElementEditorRef>(null)

  const handleImport = useCallback((fc: FeatureCollection) => {
    elementEditorRef.current?.setFeatureCollection(fc)
    const bbox = getFeatureCollectionBBox(fc)
    if (bbox) elementEditorRef.current?.fitBounds(bbox)
  }, [])

  // Only the import button: the drop-in imports dropped files itself (`fileDrop`, on by default,
  // with its own overlay and toast). A drop zone around it here never received those drops and
  // would make a second, different import path for the few pixels it doesn't cover.
  const { Button: ImportButton } = useGeoJSONDropzone({
    onImport: handleImport,
  })

  const getExportFC = useCallback(
    () => elementEditorRef.current?.getFeatureCollection() ?? null,
    [],
  )

  // The demo opens on sample data (demo only: the library starts empty).
  // Clearing is one undo step, like any replace.
  const clearMap = useCallback(() => {
    elementEditorRef.current?.setFeatureCollection({ type: 'FeatureCollection', features: [] })
  }, [])

  const bottomLeftSlot = useMemo(
    () => (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ImportButton />
        <GeoJSONExportButton getFeatureCollection={getExportFC} />
        <IconButton label="Clear map" tooltipContent="Clear map (undo brings it back)" onClick={clearMap}>
          <Broom size={24} />
        </IconButton>
      </div>
    ),
    [ImportButton, getExportFC, clearMap],
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ElementEditor
        ref={elementEditorRef}
        layout="panel"
        theme="dark"
        initialData={SAMPLE_DATA}
        schema={SAMPLE_SCHEMA}
        initialView="data"
        config={{
          ui: { keyboardShortcuts: { mapZoom: true } },
          network: { routing: { apiKey: import.meta.env.VITE_ORS_API_KEY }, sprite: location.origin + '/sprite' },
        }}
        slots={{ bottomLeft: bottomLeftSlot }}
      />
      {/* For this tab's own import/export toasts (GeoJSONDropzone, untagged). The
          editor's toasts go to its own per-instance <Toaster>, not this one. */}
      <ElementToaster position="bottom-right" theme="dark" />
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      // Demo shell is inline-styled (its classes aren't compiled), so hover is set here.
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      style={{
        padding: '8px 20px',
        fontSize: 12,
        lineHeight: 1.5,
        fontWeight: active ? 700 : 400,
        color: active ? '#38bdf8' : '#737373',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #38bdf8' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'color 0.15s, background-color 0.15s',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {children}
    </button>
  )
}
