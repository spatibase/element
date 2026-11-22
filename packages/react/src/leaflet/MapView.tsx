import { MapContainer, useMap } from 'react-leaflet'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Map as LeafletMap, MapOptions } from 'leaflet'
import type { BoundsInput, FeatureCollectionInput, GeoJSONFeatureInput } from '@element-editor/core'
import { ElementEditorControls, type FeatureRenderer, type FeatureStyleFn } from '@element-editor/adapter-leaflet'
import { useUIStore } from '../store/StoreContext'
import { useElementEditorConfig } from '@element-editor/ui'
import { resolveInitialView, saveView as persistView, FIT_MAX_ZOOM, FIT_PADDING, type InitialView } from '../shell/savedView'

/** Creation-time inputs of the map, read once (the entry passes the first values). */
export interface MapSetup {
  initialView?: InitialView
  initialData?: FeatureCollectionInput | GeoJSONFeatureInput | null
  bounds?: BoundsInput
  /** Already filtered of the keys Element owns. */
  mapOptions?: Partial<MapOptions>
}
import CompactAttribution from './CompactAttribution'


/**
 * Wrapper-specific side effects: persist center/zoom to localStorage between
 * sessions and expose the map instance on `window` in dev builds for
 * debugging. The MapController wiring itself (flyTo / panTo / fitBounds /
 * etc.) now lives inside `adapter-leaflet`'s `ElementEditorControls` so standalone
 * adapter users get it too — no need to duplicate it here.
 */
function WrapperSideEffects() {
  const map = useMap()
  const scope = useElementEditorConfig()

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    function saveView() {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        const c = map.getCenter()
        persistView(c.lat, c.lng, map.getZoom(), scope)
      }, 300)
    }
    map.on('moveend', saveView)
    return () => { map.off('moveend', saveView); if (saveTimeout.current) clearTimeout(saveTimeout.current) }
  }, [map, scope])

  // Leaflet only listens to window resize. Re-measure when the container
  // itself changes size (status bar toggled, host layout change) so no grey
  // strip of unloaded tiles is left behind.
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __leafletMap: map })
  }, [map])

  return null
}

// memo: the shell re-renders on every host render (inline props); the map only
// needs to when these props change.
export default memo(function MapView({ tileLayer, renderer, getFeatureStyle, attributionTarget, attributionCorner, setup, onReady }: {
  /** The basemap layer (the drop-in always passes one: `tileLayer` or the chosen raster). */
  tileLayer: ReactNode
  renderer?: FeatureRenderer
  getFeatureStyle?: FeatureStyleFn
  /** Status bar element to move the attribution control into (instead of the compact "i" toggle). */
  attributionTarget?: HTMLElement | null
  /** Shell element (bottom-right end of the slot row) for the compact attribution; else the map's corner. */
  attributionCorner?: HTMLElement | null
  /** Start view + extra map options; only the first value is used. */
  setup: MapSetup
  /** Stable: called once per map once Element's layers are on it. */
  onReady?: (map: LeafletMap) => void
}) {
  const readonly = useUIStore((s) => s.readonly)
  const bounds = useUIStore((s) => s.bounds)
  const scope = useElementEditorConfig()
  // Once: MapContainer reads its view props only when it creates the map, and a 'data' fit walks
  // every coordinate.
  const [view] = useState(() => resolveInitialView(setup, scope))
  // Same element while its props hold, so a new `tileLayer` element (host JSX)
  // doesn't re-render the controls, which draw every feature.
  const controls = useMemo(
    () => <ElementEditorControls drawingBar={false} readonly={readonly} bounds={bounds} renderer={renderer} getFeatureStyle={getFeatureStyle} onReady={onReady} />,
    [readonly, bounds, renderer, getFeatureStyle, onReady],
  )

  return (
    <MapContainer
      maxBoundsViscosity={1.0}
      {...setup.mapOptions}
      {...('bounds' in view
        ? { bounds: [[view.bounds[1], view.bounds[0]], [view.bounds[3], view.bounds[2]]], boundsOptions: { padding: [FIT_PADDING, FIT_PADDING], maxZoom: FIT_MAX_ZOOM } }
        : { center: [view.center[1], view.center[0]], zoom: view.zoom })}
      className="absolute inset-0 z-0"
      zoomControl={false}
    >
      {tileLayer}
      {/* `bounds` goes through the adapter (reactive `setMaxBounds`), not MapContainer's
          `maxBounds`, which react-leaflet reads only when the map is created. */}
      {controls}
      <WrapperSideEffects />
      <CompactAttribution target={attributionTarget} corner={attributionCorner} />
    </MapContainer>
  )
})
