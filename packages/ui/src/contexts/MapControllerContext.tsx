import { createContext, useContext, useState } from 'react'

export interface MapController {
  /** Internal contract: `[lat, lng]` (Leaflet order). The public `ref.flyTo` takes `{ center: [lng, lat] }` and converts. */
  flyTo: ((latlng: [number, number], zoom: number) => void) | null
  /** `[lat, lng]`, like `flyTo`. */
  panTo: ((latlng: [number, number]) => void) | null
  fitBounds: ((target: [number, number][] | [number, number, number, number]) => void) | null
  getCenter: (() => [number, number]) | null  // returns [lng, lat]
  /** Synchronous zoom — no animation, no flyTo. Use for keyboard-driven zoom where
   *  multiple rapid presses must each take effect. Returns the actual zoom applied
   *  (clamped to the map's min/max). */
  setZoom: ((zoom: number) => number) | null
  /** Min/max zoom of the underlying map. Useful for clamping/UI hints. */
  getZoomBounds: (() => { min: number; max: number }) | null
  /** The engine's map instance (`maplibregl.Map` / `L.Map`), for the public `ref.getMap()`. */
  getMap?: () => unknown
}

const MapControllerContext = createContext<MapController>({
  flyTo: null,
  panTo: null,
  fitBounds: null,
  getCenter: null,
  setZoom: null,
  getZoomBounds: null,
})

// Separate context for the setter so consumers don't re-render when setter changes
const NOOP = () => {}
const MapControllerSetContext = createContext<(c: MapController) => void>(NOOP)

export function MapControllerProvider({ children }: { children: React.ReactNode }) {
  const [controller, setController] = useState<MapController>({
    flyTo: null,
    panTo: null,
    fitBounds: null,
    getCenter: null,
    setZoom: null,
    getZoomBounds: null,
  })
  // Nested inside another provider (e.g. an adapter's controls inside the drop-in
  // shell): defer to the outermost one so MapBridge registers where consumers read.
  if (useContext(MapControllerSetContext) !== NOOP) return <>{children}</>
  return (
    <MapControllerSetContext.Provider value={setController}>
      <MapControllerContext.Provider value={controller}>
        {children}
      </MapControllerContext.Provider>
    </MapControllerSetContext.Provider>
  )
}

export function useMapController(): MapController {
  return useContext(MapControllerContext)
}

export function useSetMapController(): (c: MapController) => void {
  return useContext(MapControllerSetContext)
}
