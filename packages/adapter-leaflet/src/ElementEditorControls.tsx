/**
 * ElementEditorControls — drop-in editing layer for an existing react-leaflet MapContainer.
 *
 * Usage:
 *   <GeoStoreProvider>
 *     <MapContainer ...>
 *       <TileLayer ... />
 *       <ElementEditorControls initialData={featureCollection} onChange={handleChange} />
 *     </MapContainer>
 *   </GeoStoreProvider>
 */
import { Suspense, useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { useMap } from 'react-leaflet'
import { latLng, type Map as LeafletMap, type LatLng } from 'leaflet'
import { normalizeBounds, normalizeFitBoundsTarget, fitPadding, visibleCenterOffset } from '@element-editor/core/internal'
import type { BoundsInput, FeatureCollection, FeatureCollectionInput, GeoJSONFeature, GeoJSONFeatureInput, CoordinateOptions, GeometryType, Schema } from '@element-editor/core'
import {
  useKeyboardShortcuts,
  useApplyAccentToRoot,
  useReportThemeFromRoot,
  preloadEditorPanelsWhenIdle,
  useSetMapController,
  EventProvider,
  useAdapterControls,
  MapDrawingBar,
  type ElementEditorImperativeAPI,
  type ImportResult,
  type ElementEditorEvent,
  type ElementEditorErrorHandler,
} from '@element-editor/ui'
import { useServiceAttribution } from '@element-editor/ui/internal'
import FeatureInteractionLayer, { type FeatureRenderer } from './components/FeatureInteractionLayer'
import DrawingLayer from './components/DrawingLayer'
import DrawingPreviewLayer from './components/DrawingPreviewLayer'
import SnapController from './components/SnapController'
import RoutePreviewLayer from './components/RoutePreviewLayer'
import BoundaryAutoFit from './components/BoundaryLayer'
import MeasurementTooltip from './components/MeasurementTooltip'
import MeasurePreviewLayer from './components/MeasurePreviewLayer'
import { OsmTraceHandler } from './components/tools/OsmTraceHandler'
import GeometryProcessingPreview from './components/GeometryProcessingPreview'
import { useGeoStore } from './store/StoreContext'
import { FeatureStyleProvider, type FeatureStyleFn } from './contexts/FeatureStyleContext'

export type DrawingTool = 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route' | 'picker' | 'measure' | 'search'

export type { ImportResult }

/** Imperative handle exposed via `ref`. Same surface across adapters and `@element-editor/react`; `getMap()` returns the `L.Map`. */
export type ElementEditorControlsRef = ElementEditorImperativeAPI<LeafletMap>

export interface ElementEditorControlsProps {
  /** Pre-populate the editor with an existing FeatureCollection. Applied once on mount. */
  initialData?: FeatureCollectionInput | GeoJSONFeatureInput | null
  /**
   * Optional single Schema pushed into the store on mount. Safe to pass a
   * stable object — re-renders that keep the same `schema.id` are no-ops.
   */
  schema?: Schema
  /** Called after every committed change with the full current FeatureCollection. */
  onChange?: (data: FeatureCollection) => void
  /**
   * Called by `ref.submit()` when all features pass validation. Receives a
   * clean FeatureCollection (stripped of `_validation`).
   */
  onSubmit?: (data: FeatureCollection) => void
  /**
   * Called by `ref.submit()` when one or more features have validation
   * errors. Blocks `onSubmit` from firing.
   */
  onValidationError?: (errors: Record<string, string[]>) => void
  /**
   * Receives every message the editor would show the user: `feature:deleted` / `features:deleted`
   * (with `undo`), `feature:duplicated` / `features:duplicated`, `feature:broken`,
   * `selection:copied`, `selection:pasted`, `undo`, `redo`, `error`, `warning` and `success`.
   * When provided, the built-in toasts are suppressed: display them yourself. Tool changes and data
   * commits are not events (use `onToolChange` and `onChange`). Wraps an EventProvider locally so
   * you don't need a separate `<ElementEditorUIProvider onEvent={...}>`.
   */
  onEvent?: (event: ElementEditorEvent) => void
  /**
   * Called first for every runtime failure with an `ElementEditorError` (`code`, `source`, honest
   * English `message`): basemap, picker, routing, search, import, geometry, clipboard, `maxFeatures`.
   * Return `false` to stop the built-in toast / `onEvent` error event, or a string to show that text
   * instead. Wraps a local EventProvider (with `onEvent`) or hands on to the enclosing one.
   */
  onError?: ElementEditorErrorHandler
  /**
   * Structural layout hint read by `@element-editor/ui` panels (LayersPanel,
   * DataTablePanel, etc.). `'panel'` keeps the sidebar docked; `'split'`
   * reserves the lower third for the data table; `'minimal'` hides them.
   */
  layout?: 'panel' | 'minimal' | 'split'
  /** Restrict which drawing tools are available. Omit to allow all. */
  tools?: DrawingTool[]
  /** Maximum number of features allowed. Drawing is disabled when reached. */
  maxFeatures?: number
  /** Geometry types the editor accepts (GeoJSON type names); omit to allow all. A refusal reports `'geometry-type-not-allowed'`; tools that can't draw an allowed type are left out. */
  geometryTypes?: GeometryType[]
  /** With `maxFeatures={1}`: a draw tool replaces the only feature's geometry instead of being refused (a "pick the location" field). Paste, duplicate, import merge and `addFeature` still refuse. */
  replaceAtLimit?: boolean
  /** `true`: drawing tools turn off after each shape (the new shape is selected); `false`: they stay on. Wins over the user's saved setting, which the Settings toggle then shows read-only. Unset: the user's setting (default off). */
  autoExitAfterDraw?: boolean
  /**
   * The drawing hint bar (hint + Done / Undo point / Cancel on touch) shown at the bottom centre of the map while a draw tool is on.
   * Default `true`; pass `false` when your own UI replaces it (render `<ActiveDrawingToolbar />` yourself, or build your own). Its presses never reach the map.
   */
  drawingBar?: boolean
  /**
   * Opt-in clean-up of every committed coordinate (add, edit, import, paste, undo/redo): `wrap`
   * shifts a feature by 360 degrees so its longitude centre is within +-180, `precision` rounds x/y
   * to N decimals. The store, `onChange` and undo history hold the cleaned values. Both off by default.
   */
  coordinates?: CoordinateOptions
  /** When true, all editing interactions are disabled. */
  readonly?: boolean
  /** Called when a feature is added. */
  onFeatureAdd?: (feature: GeoJSONFeature) => void
  /** Called when a feature's geometry or properties are updated. */
  onFeatureUpdate?: (id: string, feature: GeoJSONFeature) => void
  /** Called when a feature is deleted. */
  onFeatureDelete?: (id: string) => void
  /** Called when the selection changes. Fires with the array of selected feature ids. */
  onSelectionChange?: (ids: string[]) => void
  /**
   * Called with the single selected feature (or `null` when deselected or
   * multi-selected). Convenience variant of `onSelectionChange` that gives
   * you the full GeoJSONFeature for the common single-selection case.
   */
  onFeatureSelect?: (feature: GeoJSONFeature | null) => void
  /** Called when the map's zoom level changes. */
  onZoomChange?: (zoom: number) => void
  /** Called with the tool that turned on (as `ref.getTool()` reports it), or `null` when it turned off. */
  onToolChange?: (tool: DrawingTool | null) => void
  /** Called with the id of the feature that entered point editing (as `ref.getVertexEdit()` reports it), or `null` when it ended. */
  onVertexEditChange?: (id: string | null) => void
  /**
   * Leaflet max-bounds. When set, the user can't pan the map outside this box.
   * A GeoJSON bbox `[west, south, east, north]`. The older `[[south, west], [north, east]]`
   * form still works but is deprecated (dev warning). `null` clears.
   */
  bounds?: BoundsInput | null
  /** @deprecated Use `config.network.routing.apiKey` (it wins over this). OpenRouteService key for the Route tool. */
  routingApiKey?: string
  /**
   * Returns Leaflet PathOptions for a given feature (or `undefined`/`null` for the default look),
   * applied to polygons, polylines and point pins (pins use `fillColor`, then `color`).
   * `fillColor` falls back to `color`. Wins over `config.featureColor` per key; the selected /
   * hovered looks win over both. Called on every render — keep it fast (no heavy computation inside).
   *
   * @example
   * getFeatureStyle={(f) => ({
   *   color: f.properties.color ?? '#475569',
   *   fillOpacity: f.properties.opacity ?? 0.15,
   * })}
   */
  getFeatureStyle?: FeatureStyleFn
  /**
   * How unselected features are drawn. `'canvas'` (default) paints them on one
   * shared `<canvas>`, which keeps panning and zooming smooth with thousands of
   * features. `'svg'` gives every feature its own `<path>` element (useful if
   * your app styles or queries feature paths via CSS/DOM). Selected features and
   * editing handles are always SVG either way.
   */
  renderer?: FeatureRenderer
  /**
   * Called once per map, as soon as Element's layers and panes are on it: the place to add your
   * own layers.
   */
  onReady?: (map: LeafletMap) => void
}

/**
 * MapBridge — wires MapControllerContext to the Leaflet map instance so
 * components outside the MapContainer (FloatingToolbar search, LocateButton,
 * ZoomIndicator, FitBoundsButton, DataTable fly-to) can drive the map.
 *
 * Must be rendered inside a react-leaflet `<MapContainer>`. Also syncs the
 * map's current zoom into dataStore.currentZoom so paste/duplicate math uses
 * the right zoom level (matches adapter-maplibre's ElementEditorControls behavior).
 */
/** The map centre that shows `latlng` in the middle of the visible map at `zoom`. */
function visibleCenter(map: LeafletMap, latlng: [number, number], zoom: number): LatLng {
  const [dx, dy] = visibleCenterOffset(map.getContainer())
  if (!dx && !dy) return latLng(latlng)
  return map.unproject(map.project(latlng, zoom).subtract([dx, dy]), zoom)
}

function MapBridge({ routingApiKey }: { routingApiKey?: string }) {
  const map = useMap()
  const setController = useSetMapController()
  const { dataStore } = useGeoStore()

  useEffect(() => {
    // Keep currentZoom synced for clone / paste-at-zoom flows.
    dataStore.getState().setCurrentZoom(map.getZoom())
    const onZoomEnd = () => dataStore.getState().setCurrentZoom(map.getZoom())
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map, dataStore])

  useEffect(() => {
    setController({
      // Points land in the middle of the visible map (clear of the open
      // panels / docked inspector / table), not under them.
      flyTo: (latlng, zoom) => map.flyTo(visibleCenter(map, latlng, zoom), zoom, { duration: 1.2 }),
      panTo: (latlng) => map.flyTo(visibleCenter(map, latlng, map.getZoom()), map.getZoom(), { duration: 0.5 }),
      fitBounds: (target) => {
        const bb = normalizeFitBoundsTarget(target)
        if (!bb) return
        // Leaflet wants [[lat, lng], [lat, lng]]. flyToBounds (not fitBounds)
        // so every zoom-to animates on the same fly arc as flyTo — MapLibre's
        // fitBounds already does by default.
        const p = fitPadding(map.getContainer())
        map.flyToBounds(
          [[bb.minLat, bb.minLng], [bb.maxLat, bb.maxLng]],
          { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom], maxZoom: 16, duration: 1.2 },
        )
      },
      getCenter: () => {
        const c = map.getCenter()
        return [c.lng, c.lat]
      },
      setZoom: (zoom) => {
        const clamped = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom))
        map.setZoom(clamped, { animate: false })
        return clamped
      },
      getZoomBounds: () => ({ min: map.getMinZoom(), max: map.getMaxZoom() }),
      getMap: () => map,
    })
  }, [map, setController])

  // Credits for the services in use (the geocoder while search is offered, ORS while routing through it).
  const credit = useServiceAttribution(routingApiKey)
  useEffect(() => {
    if (!credit) return
    map.attributionControl?.addAttribution(credit)
    return () => { map.attributionControl?.removeAttribution(credit) }
  }, [map, credit])

  return null
}

export const ElementEditorControls = forwardRef<ElementEditorControlsRef, ElementEditorControlsProps>(function ElementEditorControls(props: ElementEditorControlsProps, ref) {
  // `onEvent` / `onError` is wrapped as a local EventProvider *above* the real component
  // so the inner tree sees the handler via `useEmit()`. Everything else is
  // forwarded in.
  return props.onEvent || props.onError ? (
    <EventProvider onEvent={props.onEvent} onError={props.onError}>
      <ElementEditorControlsInner {...props} ref={ref} />
    </EventProvider>
  ) : (
    <ElementEditorControlsInner {...props} ref={ref} />
  )
})

const ElementEditorControlsInner = forwardRef<ElementEditorControlsRef, ElementEditorControlsProps>(function ElementEditorControlsInner(props, ref) {
  const map = useMap()
  const { dataStore: _ds, uiStore: _us } = useGeoStore()

  // Shared editor wiring — prop sync, schema mount, callback subscriptions,
  // and the imperative API. Map-bridge / bounds / layer tree stay below.
  const api = useAdapterControls<LeafletMap>({
    initialData: props.initialData,
    schema: props.schema,
    layout: props.layout,
    readonly: props.readonly,
    tools: props.tools,
    maxFeatures: props.maxFeatures,
    geometryTypes: props.geometryTypes,
    replaceAtLimit: props.replaceAtLimit,
    autoExitAfterDraw: props.autoExitAfterDraw,
    coordinates: props.coordinates,
    engine: 'leaflet',
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onValidationError: props.onValidationError,
    onFeatureAdd: props.onFeatureAdd,
    onFeatureUpdate: props.onFeatureUpdate,
    onFeatureDelete: props.onFeatureDelete,
    onSelectionChange: props.onSelectionChange,
    onFeatureSelect: props.onFeatureSelect,
    onZoomChange: props.onZoomChange,
    onToolChange: props.onToolChange,
    onVertexEditChange: props.onVertexEditChange,
  })
  useImperativeHandle(ref, () => api, [api])

  // Dev-only: expose stores + map on `window.__elementEditorTest` so e2e tests can
  // probe state without React-tree access. Mirrors the same exposure on
  // `<ElementEditor>` (in @element-editor/react) so both packages share one test surface.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __elementEditorTest?: unknown }
    w.__elementEditorTest = { dataStore: _ds, uiStore: _us, map }
    return () => { delete w.__elementEditorTest }
  }, [_ds, _us, map])

  // Mount the shared keyboard-shortcuts hook so standalone adapter consumers
  // get drawing-tool hotkeys / undo / Enter / Delete without extra wiring.
  // @element-editor/react also relies on this hook being mounted here — it does
  // *not* call useKeyboardShortcuts in its own tree (would double-fire).
  useKeyboardShortcuts(map.getContainer())
  // config.accentColor → `--elm-accent` on the themed root (host-owned for adapter users).
  useApplyAccentToRoot(map.getContainer())
  // Tell <ElementEditorUIProvider> the host root's theme, so portaled modals follow it.
  useReportThemeFromRoot(map.getContainer())
  // Fetch the lazy panels (GeoJSON inspector, table, modals) at idle so their first open is instant.
  useEffect(() => { preloadEditorPanelsWhenIdle() }, [])

  // bounds — Leaflet max-bounds. Reactive; `null` clears.
  useEffect(() => {
    const b = normalizeBounds(props.bounds)
    map.setMaxBounds(b ? [[b[1], b[0]], [b[3], b[2]]] : undefined) // Leaflet wants [[s, w], [n, e]]
  }, [map, props.bounds])

  // `onReady` — once per map. Declared last, and the layers below are children (their effects run
  // first), so Element's panes and the map bridge exist. The ref guard survives StrictMode's re-run.
  const onReadyRef = useRef(props.onReady)
  onReadyRef.current = props.onReady
  const readyFor = useRef<LeafletMap | null>(null)
  useEffect(() => {
    if (readyFor.current === map) return
    readyFor.current = map
    map.whenReady(() => onReadyRef.current?.(map))
  }, [map])

  return (
    <FeatureStyleProvider getFeatureStyle={props.getFeatureStyle}>
      <MapBridge routingApiKey={props.routingApiKey} />
      <BoundaryAutoFit />
      {/* Draws every feature once (unselected look + hover + selection). FeatureLayer
          stays exported as a visual-only layer but isn't mounted: it doubled the paths. */}
      <FeatureInteractionLayer renderer={props.renderer} />
      <DrawingLayer routingApiKey={props.routingApiKey} />
      <DrawingPreviewLayer />
      <SnapController />
      <RoutePreviewLayer />
      <MeasurementTooltip />
      <MeasurePreviewLayer />
      <OsmTraceHandler />
      <GeometryProcessingPreview />
      {props.drawingBar !== false && <Suspense fallback={null}><MapDrawingBar container={map.getContainer()} /></Suspense>}
    </FeatureStyleProvider>
  )
})
