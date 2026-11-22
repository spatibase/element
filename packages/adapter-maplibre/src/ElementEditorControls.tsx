/**
 * ElementEditorControls — drop-in editing layer for an existing MapLibre GL map.
 *
 * Usage:
 *   const [mapReady, setMapReady] = useState(false)
 *   const mapRef = useRef<maplibregl.Map | null>(null)
 *
 *   // initialise your map, call setMapReady(true) on 'load'
 *
 *   {mapReady && mapRef.current && (
 *     <GeoStoreProvider>
 *       <ElementEditorControls map={mapRef.current} onChange={handleChange} />
 *     </GeoStoreProvider>
 *   )}
 */
import React, { Suspense, createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CoordinateOptions, FeatureCollection, FeatureCollectionInput, GeoJSONFeature, GeoJSONFeatureInput, GeometryType, Schema } from '@element-editor/core'
import { normalizeFitBoundsTarget, fitPadding, visibleCenterOffset } from '@element-editor/core/internal'
import {
  useKeyboardShortcuts,
  useApplyAccentToRoot,
  useReportThemeFromRoot,
  preloadEditorPanelsWhenIdle,
  EventProvider,
  useAdapterControls,
  MapDrawingBar,
  type ElementEditorImperativeAPI,
  type ImportResult,
  type ElementEditorEvent,
  type ElementEditorErrorHandler,
} from '@element-editor/ui'
import { useGeoStore } from './store/StoreContext'
import { MapControllerProvider, useSetMapController } from './contexts/MapControllerContext'
import FeatureLayer from './components/FeatureLayer'
import DrawingLayer from './components/DrawingLayer'
import DrawingPreviewLayer from './components/DrawingPreviewLayer'
import FeatureInteractionLayer from './components/FeatureInteractionLayer'
import SnapController from './components/SnapController'
import BoundaryLayer from './components/BoundaryLayer'
import GeometryProcessingPreview from './components/GeometryProcessingPreview'
import { FeatureStyleProvider, type FeatureStyleFn } from './contexts/FeatureStyleContext'
import { StyleEpochContext } from './contexts/StyleEpochContext'
import { watchElementLayers, cleanupElementLayers } from './elementLayers'
import MeasurePreviewLayer from './components/MeasurePreviewLayer'
import MeasurementTooltip from './components/MeasurementTooltip'
import OsmTraceHandler from './components/OsmTraceHandler'

// ─── Map context ──────────────────────────────────────────────────────────────

const MapContext = createContext<MapLibreMap | null>(null)

export function useMapLibre(): MapLibreMap {
  const map = useContext(MapContext)
  if (!map) throw new Error('useMapLibre must be used inside ElementEditorControls')
  return map
}

/** Like `useMapLibre` but returns null outside ElementEditorControls. */
export const useOptionalMapLibre = (): MapLibreMap | null => useContext(MapContext)

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrawingTool =
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'point'
  | 'freehand'
  | 'route'
  | 'picker'
  | 'measure'
  | 'search'

export type { ImportResult }

/** Imperative handle exposed via `ref`. Same surface across adapters and `@element-editor/react`; `getMap()` returns the `maplibregl.Map`. */
export type ElementEditorControlsRef = ElementEditorImperativeAPI<MapLibreMap>

export interface ElementEditorControlsProps {
  /**
   * The MapLibre GL map instance. Pass it as soon as it exists: Element waits until the style can
   * take sources before it adds its layers (and puts them back after every `map.setStyle()`).
   */
  map: MapLibreMap
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
   * Structural layout hint read by `@element-editor/ui` panels.
   * `'panel'` / `'split'` / `'minimal'`. Defaults to `'panel'`.
   */
  layout?: 'panel' | 'minimal' | 'split'
  /**
   * MapLibre `maxBounds` — restricts panning. A GeoJSON bbox `[west, south, east, north]`
   * or MapLibre's `[[west, south], [east, north]]` (both `[lng, lat]`). `null` clears.
   */
  maxBounds?: [number, number, number, number] | [[number, number], [number, number]] | null
  /** Restrict which drawing tools are available. Omit to allow all. */
  tools?: DrawingTool[]
  /** Maximum number of features allowed. */
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
   * multi-selected). Convenience variant of `onSelectionChange`.
   */
  onFeatureSelect?: (feature: GeoJSONFeature | null) => void
  /** Called when the map's zoom level changes. */
  onZoomChange?: (zoom: number) => void
  /** Called with the tool that turned on (as `ref.getTool()` reports it), or `null` when it turned off. */
  onToolChange?: (tool: DrawingTool | null) => void
  /** Called with the id of the feature that entered point editing (as `ref.getVertexEdit()` reports it), or `null` when it ended. */
  onVertexEditChange?: (id: string | null) => void
  /**
   * Optional per-feature style callback. Return a `FeatureStyle` ({ color,
   * fillColor, opacity, fillOpacity, weight }) to override the default paint
   * for that feature. Wins over `config.featureColor` per key; the selected
   * look still takes precedence and hover keeps the colour. Re-run whenever features change, and on a new
   * function identity (keep it stable: module-level or `useCallback`).
   */
  getFeatureStyle?: FeatureStyleFn
  /** @deprecated Use `config.network.routing.apiKey` (it wins over this). OpenRouteService key for the Route tool. */
  routingApiKey?: string
  /**
   * Called once per map, as soon as Element's sources and layers (`elm-*`) are on it: the place to
   * add your own layers (pass an `elm-*` id as `beforeId` to put yours under Element's). Basemap
   * switches through `setBasemap` / `BasemapControl` keep them. Your own `map.setStyle` drops them;
   * Element puts its own layers back on top by itself, and a `style.load` listener you add here runs
   * after that, so it can re-add yours (with an `elm-*` `beforeId` if you like). Element never moves
   * the map on mount; fit your data with `ref.fitBounds` if you want that.
   */
  onReady?: (map: MapLibreMap) => void
  /**
   * Optional UI components rendered inside MapControllerProvider alongside the map layers.
   * Use this to place @element-editor/ui panels (LayersPanel, DataTablePanel, FloatingToolbar, etc.)
   * so they have access to useMapController for fit-bounds and fly-to operations.
   */
  children?: React.ReactNode
}

// ─── MapBridge — wires MapControllerContext to the MapLibre instance ──────────

function MapBridge({ map }: { map: MapLibreMap }) {
  const setController = useSetMapController()

  useEffect(() => {
    setController({
      // MapController's public contract is `[lat, lng]` (Leaflet convention —
      // the UI package normalises to that). MapLibre natively uses `[lng, lat]`,
      // so we swap on the boundary. Search "Go" / LocateButton / ZoomIndicator
      // all pass [lat, lng]; flipping here restores correct flyTo targets.
      // `offset`, not `padding`: MapLibre keeps a camera padding for good.
      // Points land in the middle of the visible map (clear of the open
      // panels / docked inspector / table), not under them.
      flyTo: ([lat, lng], zoom) => map.flyTo({ center: [lng, lat], zoom, offset: visibleCenterOffset(map.getContainer()) }),
      panTo: ([lat, lng]) => map.panTo([lng, lat], { offset: visibleCenterOffset(map.getContainer()) }),
      fitBounds: (target) => {
        const bb = normalizeFitBoundsTarget(target)
        if (!bb) return
        map.fitBounds(
          [[bb.minLng, bb.minLat], [bb.maxLng, bb.maxLat]],
          { padding: fitPadding(map.getContainer()), maxZoom: 16 },
        )
      },
      getCenter: () => {
        const c = map.getCenter()
        return [c.lng, c.lat]
      },
      setZoom: (zoom) => {
        // Synchronous — no animation. MapLibre's setZoom is instant.
        const clamped = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom))
        map.setZoom(clamped)
        return clamped
      },
      getZoomBounds: () => ({ min: map.getMinZoom(), max: map.getMaxZoom() }),
      getMap: () => map,
    })
  }, [map, setController])

  return null
}

// ─── Inner component (has store access) ──────────────────────────────────────

const ElementEditorControlsInner = forwardRef<ElementEditorControlsRef, ElementEditorControlsProps>(
  function ElementEditorControlsInner(props, ref) {
    const { map, maxBounds } = props
    const { dataStore, uiStore } = useGeoStore()

    // Shared editor wiring — prop sync, schema mount, callback subscriptions,
    // and the imperative API. Map-bridge / maxBounds / layer tree stay below.
    const api = useAdapterControls<MapLibreMap>({
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
      engine: 'maplibre',
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
      w.__elementEditorTest = { dataStore, uiStore, map }
      return () => { delete w.__elementEditorTest }
    }, [dataStore, uiStore, map])

    // Keyboard shortcuts — shared ui hook handles drawing modes, undo/redo,
    // delete, finish-drawing, copy/paste/duplicate, sidebar/modal toggles.
    // Measure-specific Enter/Backspace are handled in DrawingLayer.
    useKeyboardShortcuts(map.getContainer())
    // config.accentColor → `--elm-accent` on the themed root (host-owned for adapter users).
    useApplyAccentToRoot(map.getContainer())
    // Tell <ElementEditorUIProvider> the host root's theme, so portaled modals follow it.
    useReportThemeFromRoot(map.getContainer())
    // Fetch the lazy panels (GeoJSON inspector, table, modals) at idle so their first open is instant.
    useEffect(() => { preloadEditorPanelsWhenIdle() }, [])

    // `maxBounds` prop — reactive. MapLibre clears when passed null.
    useEffect(() => {
      map.setMaxBounds(maxBounds ?? null)
    }, [map, maxBounds])

    // Keep `dataStore.currentZoom` in sync with the map so paste/duplicate/
    // clone-at-zoom logic uses the user's actual view (leaflet equivalent at
    // adapter-leaflet/src/components/FeatureLayer.tsx:90).
    useEffect(() => {
      const onZoomEnd = () => dataStore.getState().setCurrentZoom(map.getZoom())
      // Initial sync + subscription.
      dataStore.getState().setCurrentZoom(map.getZoom())
      map.on('zoomend', onZoomEnd)
      return () => { map.off('zoomend', onZoomEnd) }
    }, [map, dataStore])

    return (
      <MapContext.Provider value={map}>
        <FeatureStyleProvider getFeatureStyle={props.getFeatureStyle}>
        <MapBridge map={map} />
        <BoundaryLayer map={map} />
        <FeatureLayer map={map} />
        <FeatureInteractionLayer map={map} />
        <DrawingLayer map={map} routingApiKey={props.routingApiKey} />
        <DrawingPreviewLayer map={map} />
        <GeometryProcessingPreview map={map} />
        {props.drawingBar !== false && <Suspense fallback={null}><MapDrawingBar container={map.getContainer()} /></Suspense>}
        <MeasurePreviewLayer map={map} />
        <MeasurementTooltip map={map} />
        <OsmTraceHandler map={map} />
        <SnapController map={map} />
        {/* BoxSelectHandler is mounted inside FeatureInteractionLayer so the
            vertex-box-select fallback can enter vertex edit with pre-selected
            indices without exposing that state outside the adapter. */}
        </FeatureStyleProvider>
        {props.children}
      </MapContext.Provider>
    )
  },
)

// ─── Public component — wraps with MapControllerProvider ─────────────────────

export const ElementEditorControls = forwardRef<ElementEditorControlsRef, ElementEditorControlsProps>(
  function ElementEditorControls(props, ref) {
    const [ready, setReady] = useState(() => props.map.isStyleLoaded())
    const [styleEpoch, setStyleEpoch] = useState(0)

    // Element's layers on the map, now and after every style replacement (see watchElementLayers).
    // Registered before `onReady` runs, so a host's `style.load` listener added there runs after
    // the repair.
    useEffect(() => watchElementLayers(props.map, () => {
      setReady(true)
      setStyleEpoch((n) => n + 1)
    }), [props.map])

    // `onReady` — once per map, after the init above added Element's layers (declared after it, so
    // in the same commit it runs second). The ref guard survives StrictMode's effect re-run.
    const onReadyRef = useRef(props.onReady)
    onReadyRef.current = props.onReady
    const readyFor = useRef<MapLibreMap | null>(null)
    useEffect(() => {
      if (!ready || readyFor.current === props.map) return
      readyFor.current = props.map
      onReadyRef.current?.(props.map)
    }, [ready, props.map])

    // Cleanup GL resources on unmount.
    // Guard with try/catch: if the consumer calls map.remove() before React
    // runs this effect (e.g. tab switch), the map's internal state is already
    // torn down and map.getLayer() / map.getSource() would throw.
    useEffect(() => {
      return () => {
        try { cleanupElementLayers(props.map) } catch { /* map was already removed */ }
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.map])

    if (!ready) return null

    // When `onEvent` / `onError` is provided, wrap locally in EventProvider so the
    // inner tree's `useEmit()` calls route into the callback without the
    // consumer needing a separate `<ElementEditorUIProvider onEvent={...}>`.
    const inner = (
      <StyleEpochContext.Provider value={styleEpoch}>
        <MapControllerProvider>
          <ElementEditorControlsInner {...props} ref={ref} />
        </MapControllerProvider>
      </StyleEpochContext.Provider>
    )
    return props.onEvent || props.onError ? (
      <EventProvider onEvent={props.onEvent} onError={props.onError}>{inner}</EventProvider>
    ) : inner
  },
)
