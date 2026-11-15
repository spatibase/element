import { useCallback } from 'react'
import { getGeometryBBox, type GeoJSONFeature } from '@element-editor/core'
import { useMapController } from '../contexts/MapControllerContext'

/** Moves the map to a feature: pans to a point, fits anything else. */
export function useJumpToFeature() {
  const { panTo, fitBounds } = useMapController()
  return useCallback((f: GeoJSONFeature) => {
    if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates as [number, number]
      panTo?.([lat, lng])
    } else {
      fitBounds?.(f.bbox || getGeometryBBox(f.geometry))
    }
  }, [panTo, fitBounds])
}
