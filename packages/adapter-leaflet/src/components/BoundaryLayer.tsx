import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { fitPadding } from '@element-editor/core/internal'
import { useUIStore } from '../store/StoreContext'

/**
 * Consumes a one-shot bounding box set by useBoundaryFromURL and fits the map to it.
 * Clears the bbox immediately so it only fires once.
 */
export default function BoundaryAutoFit() {
  const map = useMap()
  const bbox = useUIStore((s) => s.boundaryAutofitBbox)
  const setBoundaryAutofitBbox = useUIStore((s) => s.setBoundaryAutofitBbox)

  useEffect(() => {
    if (!bbox) return
    const [south, north, west, east] = bbox
    const p = fitPadding(map.getContainer())
    map.fitBounds([[south, west], [north, east]], { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom], maxZoom: 10, duration: 1 })
    setBoundaryAutofitBbox(null)
  }, [map, bbox, setBoundaryAutofitBbox])

  return null
}
