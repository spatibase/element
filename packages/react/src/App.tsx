import { ElementEditor as LeafletEditor } from './leaflet/index'
import { ElementEditor as MapLibreEditor } from './index'
import type { ElementEditorConfig } from '@element-editor/ui'
import { withLayout } from './index'
import type { BoundsInput, FeatureCollection, FeatureCollectionInput, FeatureStyle, GeoJSONFeature, GeometryType, InitialView } from './index'
import { Agentation } from 'agentation'
import { Profiler, useState, type CSSProperties } from 'react'
import { TileLayer } from 'react-leaflet'
import type { BasemapInput } from '@element-editor/adapter-maplibre/basemaps'
import type { LeafletBasemap } from './leaflet/index'
// maplibre-gl 6's worker file, or '' on maplibre-gl 5 (worker inlined); see vite.config.ts.
import localWorkerUrl from 'dev:maplibre-worker-url'

// Agentation overlays intercept pointer events in the map area, which breaks
// Playwright drawing tests. Skip it when running under automation
// (navigator.webdriver is set by Playwright and other drivers).
const isAutomated = typeof navigator !== 'undefined'
  && (navigator as Navigator & { webdriver?: boolean }).webdriver === true

// ?renderer=svg mounts the Leaflet SVG renderer (e2e coverage for the non-default mode).
const params = new URLSearchParams(location.search)
const renderer = params.get('renderer') === 'svg' ? 'svg' : undefined
// ?layout=<URL-encoded JSON> sets config.ui.layout; ?layoutPatch=<URL-encoded JSON> sets it to withLayout(patch); ?shortcuts=0 sets keyboardShortcuts: false; ?readonly=1;
// ?inspector=docked|1 sets geojsonEditorOpen; ?geojson=0 sets geojsonEditor: false. (e2e coverage)
const layoutParam = params.get('layout')
const layoutPatch = params.get('layoutPatch')
const shortcutsOff = params.get('shortcuts') === '0'
const inspector = params.get('inspector')
const geojsonOff = params.get('geojson') === '0'
// ?persistKey=<key> namespaces localStorage; ?persist=0 turns it off. (e2e)
const persistKey = params.get('persistKey') ?? undefined
const persistOff = params.get('persist') === '0'
const uiParams = layoutParam || layoutPatch || shortcutsOff || inspector || geojsonOff
// config.network (e2e network-config.spec): the sprite always comes from this dev server.
// ?network=custom points every service at *.example.test hosts (and a `fetch` adding `X-Elm-Test: 1`);
// ?network=off turns Overpass, routing and search off. ?routingApiKey=<key> passes the deprecated prop.
const networkParam = params.get('network')
const routingApiKey = params.get('routingApiKey') ?? undefined
const network: NonNullable<ElementEditorConfig['network']> = {
  sprite: location.origin + '/sprite',
  // ?worker=local: MapLibre's worker from this dev server (e2e on WebKit, where Playwright cannot route a worker script).
  ...(params.get('worker') === 'local' && localWorkerUrl && { maplibreWorker: new URL(localWorkerUrl, location.href).href }),
  ...(networkParam === 'custom' && {
    vectorTiles: { url: 'https://vector.example.test/planet', attribution: 'Custom vector tiles' },
    dem: { tiles: ['https://dem.example.test/{z}/{x}/{y}.png'], encoding: 'mapbox', attribution: 'Custom elevation' },
    glyphs: 'https://glyphs.example.test/{fontstack}/{range}.pbf',
    sprite: 'https://sprite.example.test/sprite',
    maplibreWorker: 'https://worker.example.test/maplibre-gl-worker.mjs',
    osmRaster: { tiles: ['https://osmraster.example.test/{z}/{x}/{y}.png'], attribution: 'Custom raster tiles' },
    overpass: { endpoint: 'https://overpass.example.test/api/interpreter' },
    routing: { url: 'https://osrm.example.test/route/v1/foot' },
    nominatim: { url: 'https://nominatim.example.test/search', email: 'dev@example.test', attribution: 'Search by Example' },
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), 'X-Elm-Test': '1' } }),
  }),
  ...(networkParam === 'off' && { overpass: false, routing: false, nominatim: false }),
}
const config: ElementEditorConfig = {
    network,
    ...(uiParams && { ui: {
      ...(layoutParam && { layout: JSON.parse(layoutParam) }),
      ...(layoutPatch && { layout: withLayout(JSON.parse(layoutPatch)) }),
      ...(shortcutsOff && { keyboardShortcuts: false }),
      ...(inspector && { geojsonEditorOpen: inspector === 'docked' ? 'docked' as const : true }),
      ...(geojsonOff && { geojsonEditor: false }),
    } }),
    ...(persistKey && { persistKey }),
    ...(persistOff && { persist: false }),
  }
const readonly = params.get('readonly') === '1'
// ?editorLayout=split|minimal (default panel); ?submit=1 passes onSubmit (shows "Apply changes").
const editorLayout = (params.get('editorLayout') ?? 'panel') as 'panel' | 'minimal' | 'split'
// ?engine=maplibre mounts the MapLibre drop-in (default Leaflet); ?basemaps=0 hides its basemap picker.
const maplibre = params.get('engine') === 'maplibre'
// MapLibre ?basemaps=<list>: built-in ids, plus `style` (a custom style object) and `raster` (a custom { url });
// ?basemap=<id> is the `defaultBasemap` prop (both engines; Leaflet looks the id up in its list). (e2e)
const CUSTOM_BASEMAPS: Record<string, BasemapInput> = {
  style: { id: 'style', label: 'Custom style', style: { version: 8, name: 'Custom style', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#123456' } }] } },
  raster: { id: 'raster', label: 'Custom raster', url: 'https://raster.example.test/{z}/{x}/{y}.png', attribution: 'Custom raster' },
}
const basemaps = params.get('basemaps') === '0' ? false
  : params.get('basemaps')?.split(',').map((b) => CUSTOM_BASEMAPS[b] ?? (b as BasemapInput))
// ?basemaps=osm,custom (Leaflet) passes the raster basemap list; `custom` is a second XYZ source.
const leafletRaster = (id: string): LeafletBasemap => (id === 'osm' ? 'osm' : { id, label: id, url: `https://${id}.example.test/{z}/{x}/{y}.png`, attribution: id })
const leafletBasemaps = params.get('basemaps')?.split(',').filter((b) => b !== '0').map(leafletRaster)
/** A basemap id → the engine's basemap value (the list entry when listed; off-list ids still work). */
const basemapOf = (id: string): BasemapInput | LeafletBasemap => maplibre
  ? CUSTOM_BASEMAPS[id] ?? (id as BasemapInput)
  : leafletBasemaps?.find((b) => (b === 'osm' ? b : b.id) === id) ?? leafletRaster(id)
const basemapParam = params.get('basemap')
// ?basemapControlled=1 makes the dev page own the basemap (`basemap` + `onBasemapChange` that
// updates it); `=frozen` ignores the user's picks. `window.__setBasemapProp(id)` sets it. Every
// `onBasemapChange` call (both modes) pushes the chosen id to `window.__basemapChanges`. (e2e)
const basemapControlled = params.get('basemapControlled')
const basemapIdOf = (b: BasemapInput | LeafletBasemap) => (typeof b === 'string' ? b : b.id)
// Leaflet ?tileLayer=1 passes a custom `tileLayer` (which overrides `basemaps`). (e2e)
const tileLayer = params.get('tileLayer') === '1'
  ? <TileLayer url="https://tilelayer.example.test/{z}/{x}/{y}.png" attribution="Custom tiles" />
  : undefined
const onSubmit = params.get('submit') === '1' ? () => {} : undefined
// ?featureColor=<css colour> sets every feature's default colour; ?featureStyle=1 adds a
// getFeatureStyle that paints features with `properties.kind === 'hot'` red. (e2e)
const featureColor = params.get('featureColor') ?? undefined
const hotRed = (f: GeoJSONFeature): FeatureStyle | null => (f.properties?.kind === 'hot' ? { color: '#ff0000' } : null)
const getFeatureStyle = params.get('featureStyle') === '1' ? hotRed : undefined
// Theming (e2e): ?accentColor=<css colour>, ?style=<JSON of CSS variables for the root>,
// ?theme=light|dark|auto, or ?theme=<JSON object> (the removed object form: ignored + dev warning).
const accentColor = params.get('accentColor') ?? undefined
const styleParam = params.get('style')
const rootStyle = styleParam ? (JSON.parse(styleParam) as CSSProperties) : undefined
const themeParam = params.get('theme')
// ?demoTheme=warm: a full custom theme through the design tokens, set by a stylesheet
// rule on the editor root's class, per mode (so portals get it through the root-token forwarding,
// not through `style`). The acceptance test for token coverage: no cold grey may remain.
const demoTheme = params.get('demoTheme')
const DEMO_THEMES: Record<string, string> = {
  warm: `
.elm-demo-warm[data-elm-theme] {
  --elm-accent: #c0582b;
  --elm-font: "Avenir Next", Avenir, "Trebuchet MS", sans-serif;
  --elm-font-mono: "SF Mono", Menlo, Consolas, monospace;
  --elm-radius: 18px;
  --elm-radius-control: 12px;
}
.elm-demo-warm[data-elm-theme="light"] {
  --elm-surface: #fbf6ee;
  --elm-surface-raised: #fffcf7;
  --elm-surface-sunken: #f3eadc;
  --elm-surface-hover: #f0e5d3;
  --elm-control-hover: #e9dbc5;
  --elm-text: #3b2a1e;
  --elm-text-secondary: #5c4331;
  --elm-text-muted: #8a6f58;
  --elm-text-subtle: #a8917b;
  --elm-text-disabled: #cdbba6;
  --elm-border: #e5d6c0;
  --elm-border-subtle: #efe5d5;
  --elm-border-strong: #d2bc9f;
  --elm-focus-ring: #b08d68;
  --elm-shadow: 0 20px 25px -5px rgb(90 55 20 / 0.12), 0 8px 10px -6px rgb(90 55 20 / 0.1);
  --elm-shadow-raised: 0 25px 50px -12px rgb(90 55 20 / 0.3);
  --elm-shadow-control: 0 10px 15px -3px rgb(90 55 20 / 0.12), 0 4px 6px -4px rgb(90 55 20 / 0.1);
  --elm-tooltip: #3b2a1e;
  --elm-tooltip-text: #fbf6ee;
  --elm-row-hover: #f3eadc;
  --elm-row-selected: #f7e6d8;
  --elm-row-selected-hover: #f2dccb;
}
.elm-demo-warm[data-elm-theme="dark"] {
  --elm-surface: #2a211b;
  --elm-surface-raised: #352a22;
  --elm-surface-sunken: #211a15;
  --elm-surface-hover: #3a2e25;
  --elm-control-hover: #45372c;
  --elm-text: #f6ece0;
  --elm-text-secondary: #e2d2bf;
  --elm-text-muted: #b9a28b;
  --elm-text-subtle: #8f7a66;
  --elm-text-disabled: #5e4d40;
  --elm-border: #4a3b30;
  --elm-border-subtle: #3a2e25;
  --elm-border-strong: #66523f;
  --elm-focus-ring: #a3836a;
  --elm-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.25);
  --elm-shadow-raised: 0 25px 50px -12px rgb(0 0 0 / 0.5);
  --elm-shadow-control: 0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.25);
  --elm-tooltip: #f6ece0;
  --elm-tooltip-text: #2a211b;
  --elm-row-hover: #33281f;
  --elm-row-selected: #3d3027;
  --elm-row-selected-hover: #46382d;
  --elm-row-checked: #46382d;
  --elm-row-checked-hover: #504033;
}`,
}
const demoCss = demoTheme ? DEMO_THEMES[demoTheme] : undefined
const demoClass = demoCss ? `elm-demo-${demoTheme}` : undefined
const theme = themeParam?.startsWith('{') ? (JSON.parse(themeParam) as 'light') : (themeParam as 'light' | 'dark' | 'auto' | null) ?? undefined
// ?bounds=west,south,east,north passes the `bounds` prop as a bbox (both engines); add
// &legacyBounds=1 to pass the deprecated [[south, west], [north, east]] form instead. (e2e)
const b = params.get('bounds')?.split(',').map(Number)
const bounds: BoundsInput | undefined = b?.length !== 4 ? undefined
  : params.get('legacyBounds') === '1' ? [[b[1], b[0]], [b[3], b[2]]] : [b[0], b[1], b[2], b[3]]

// Map setup (e2e initial-view.spec): ?view=lng,lat,zoom | west,south,east,north | data sets
// `initialView`; ?data=sample passes a small `initialData` around Tokyo; ?mapOptions=<URL-encoded
// JSON> passes `mapOptions`. `onMapReady` pushes every map it gets to `window.__readyMaps` and
// whether Element's layers/panes were already there to `window.__readyHadElm`;
// `window.__remountHost()` remounts the editor (new map).
const v = params.get('view')
const vn = v?.split(',').map(Number)
const initialView: InitialView | undefined = v === 'data' ? 'data'
  : vn?.length === 3 ? { center: [vn[0], vn[1]], zoom: vn[2] }
  : vn?.length === 4 ? { bounds: [vn[0], vn[1], vn[2], vn[3]] } : undefined
const initialData: FeatureCollection | undefined = params.get('data') === 'sample' ? {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'tokyo-a', properties: {}, geometry: { type: 'Polygon', coordinates: [[[139.70, 35.65], [139.80, 35.65], [139.80, 35.72], [139.70, 35.72], [139.70, 35.65]]] } },
    { type: 'Feature', id: 'tokyo-b', properties: {}, geometry: { type: 'Point', coordinates: [139.76, 35.68] } },
  ],
} as FeatureCollection : params.get('data') === 'empty' ? { type: 'FeatureCollection', features: [] } as unknown as FeatureCollection : undefined
// ?data=late starts with `initialData={null}`; `window.__setInitialData(fc)` sets the prop later
// (the fetch → setState pattern). ?changes=1 passes an `onChange` that pushes each call's feature
// count to `window.__changes` (off by default: it would add to the perf benchmark's commits). (e2e)
const lateData = params.get('data') === 'late'
const onChange = params.get('changes') === '1' ? (data: FeatureCollection) => {
  const w = window as unknown as { __changes?: number[] }
  ;(w.__changes ??= []).push(data.features.length)
} : undefined
// Every `onVertexEditChange` call pushes its id (or null) to `window.__vertexEditChanges`. (e2e)
const onVertexEditChange = (id: string | null) => {
  const w = window as unknown as { __vertexEditChanges?: (string | null)[] }
  ;(w.__vertexEditChanges ??= []).push(id)
}
// Every `onToolChange` call pushes its tool (or null) to `window.__toolChanges`. (e2e)
const onToolChange = (tool: string | null) => {
  const w = window as unknown as { __toolChanges?: (string | null)[] }
  ;(w.__toolChanges ??= []).push(tool)
}
const mapOptionsParam = params.get('mapOptions')
const mapOptions = mapOptionsParam ? JSON.parse(mapOptionsParam) : undefined
type ReadyWin = { __readyMaps?: unknown[]; __readyHadElm?: boolean[] }
// ?readyVertexEdit=<feature id> calls `ref.setVertexEdit(id)` from inside `onMapReady` (e2e vertex-edit-ready.spec).
const readyVertexEdit = params.get('readyVertexEdit')
const editorRefHolder: { current: { setVertexEdit: (id: string | null) => boolean } | null } = { current: null }
const onMapReady = (map: { getLayer?: (id: string) => unknown; getPane?: (id: string) => unknown }) => {
  const w = window as unknown as ReadyWin & { __readyVertexEdit?: boolean | null }
  if (readyVertexEdit) w.__readyVertexEdit = editorRefHolder.current?.setVertexEdit(readyVertexEdit) ?? null
  ;(w.__readyMaps ??= []).push(map)
  ;(w.__readyHadElm ??= []).push(!!(map.getLayer ? map.getLayer('elm-features-fill') : map.getPane?.('elmIdleFeatures')))
}

// ?onError=log|false|de (e2e on-error.spec): passes `onError`, which pushes every error's
// { code, source, message } to `window.__elementErrors` and returns nothing (log), false (the
// host shows it: no toast), or a German text for 'rate-limited' / 'limit-reached' (de).
const onErrorMode = params.get('onError')
const onError = onErrorMode ? (e: { code: string; source: string; message: string }) => {
  const w = window as unknown as { __elementErrors?: unknown[] }
  ;(w.__elementErrors ??= []).push({ code: e.code, source: e.source, message: e.message })
  if (onErrorMode === 'false') return false
  if (onErrorMode === 'de' && e.code === 'limit-reached') return 'Maximale Anzahl erreicht'
  if (onErrorMode === 'de' && e.code === 'rate-limited') return 'Zu viele Anfragen'
  return undefined
} : undefined
// ?maxFeatures=N passes `maxFeatures`. (e2e)
const maxFeaturesParam = params.get('maxFeatures')
const maxFeatures = maxFeaturesParam ? Number(maxFeaturesParam) : undefined
// ?geometryTypes=Point,MultiPoint passes `geometryTypes` (e2e).
const geometryTypesParam = params.get('geometryTypes')
const geometryTypes = geometryTypesParam ? (geometryTypesParam.split(',') as GeometryType[]) : undefined
// ?replaceAtLimit passes `replaceAtLimit` (draw tools replace the only feature at `maxFeatures=1`). (e2e)
const replaceAtLimit = params.has('replaceAtLimit')
// ?autoExitAfterDraw=1 / =0 passes `autoExitAfterDraw` true / false (the prop wins over the stored setting). (e2e)
const autoExitParam = params.get('autoExitAfterDraw')
const autoExitAfterDraw = autoExitParam === null ? undefined : autoExitParam === '1'
// ?coordinates=wrap,6 passes `coordinates` ({ wrap: true, precision: 6 }). (e2e)
const coordinatesParam = params.get('coordinates')
const coordinates = coordinatesParam
  ? { wrap: coordinatesParam.includes('wrap') || undefined, precision: /\d+/.test(coordinatesParam) ? Number(/\d+/.exec(coordinatesParam)![0]) : undefined }
  : undefined

// ?host=inline (perf benchmark): like a typical integrator, the host passes fresh inline `config` /
// `tools` objects every render; `window.__rerenderHost()` re-renders it. A Profiler sums the
// editor's render time into `window.__hostRender`.
const inlineHost = params.get('host') === 'inline'
const hostRender = { commits: 0, ms: 0 }
if (inlineHost) Object.assign(window, { __hostRender: hostRender })
const onRender = (_id: string, _phase: string, actualMs: number) => { hostRender.commits++; hostRender.ms += actualMs }

export default function App() {
  // Dev-only bench hook: `window.__rerenderHost()` re-renders this host with a fresh (equal) inline
  // `config` object, like a host passing `config={{…}}` on every render (perf `host-rerender`).
  // `?host=inline` additionally passes fresh `config` (with hints) and `tools` on every render (`host-5k`).
  const [rerenders, setRerenders] = useState(0)
  const [mounts, setMounts] = useState(0)
  const [lateInitialData, setLateInitialData] = useState<FeatureCollectionInput | null>(null)
  const [controlledBasemap, setControlledBasemap] = useState(() => (basemapControlled ? basemapOf(basemapParam ?? (maplibre ? 'auto' : 'osm')) : undefined))
  const onBasemapChange = (b: BasemapInput | LeafletBasemap) => {
    const w = window as unknown as { __basemapChanges?: unknown[] }
    ;(w.__basemapChanges ??= []).push(basemapIdOf(b))
    if (basemapControlled === '1') setControlledBasemap(b)
  }
  const basemapProps = {
    basemap: controlledBasemap,
    defaultBasemap: basemapParam && !basemapControlled ? basemapOf(basemapParam) : undefined,
    onBasemapChange,
  }
  if (import.meta.env.DEV) Object.assign(window, {
    __rerenderHost: () => setRerenders((n) => n + 1),
    __remountHost: () => setMounts((n) => n + 1),
    __setBasemapProp: (id: string) => setControlledBasemap(basemapOf(id)),
    __setInitialData: setLateInitialData,
  })
  const setupProps = { className: demoClass, initialView, initialData: lateData ? lateInitialData : initialData, mapOptions, onMapReady, onError, maxFeatures, geometryTypes, replaceAtLimit, autoExitAfterDraw, coordinates, routingApiKey, onChange, onVertexEditChange, onToolChange, accentColor, style: rootStyle, theme }
  const hostConfig = inlineHost ? { ...config, ui: { ...config.ui, hints: true } } : rerenders ? { ...config } : config
  const tools = inlineHost ? ['polygon' as const, 'rectangle' as const, 'circle' as const, 'line' as const, 'point' as const] : undefined
  const showAgentation = process.env.NODE_ENV === 'development' && !isAutomated
  return (
    <>
      {demoCss && <style>{demoCss}</style>}
      <div className="w-screen h-screen">
        <Profiler id="editor" onRender={onRender}>
        {maplibre
          ? <MapLibreEditor key={mounts} ref={editorRefHolder as never} {...setupProps} layout={editorLayout} config={hostConfig} tools={tools} readonly={readonly} onSubmit={onSubmit}
              {...basemapProps as { basemap?: BasemapInput; defaultBasemap?: BasemapInput }} basemaps={basemaps}
              featureColor={featureColor} getFeatureStyle={getFeatureStyle} bounds={bounds} />
          : <LeafletEditor key={mounts} ref={editorRefHolder as never} {...setupProps} layout={editorLayout} renderer={renderer} tileLayer={tileLayer} basemaps={leafletBasemaps?.length ? leafletBasemaps : undefined}
              {...basemapProps as { basemap?: LeafletBasemap; defaultBasemap?: LeafletBasemap }} config={hostConfig} tools={tools} readonly={readonly} onSubmit={onSubmit}
              featureColor={featureColor} getFeatureStyle={getFeatureStyle} bounds={bounds} />}
        </Profiler>
      </div>
      {showAgentation && <Agentation endpoint="http://localhost:4747" />}
    </>
  )
}
