import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useUIStore } from '../store/StoreContext'
import { useDataStore } from '../store/StoreContext'
import { getGeometryBBox } from '@element-editor/core'
import { fitPadding } from '@element-editor/core/internal'

interface Props {
  map: MapLibreMap
}

/** Fits the map bounds to the loaded features once on mount if initialData had content. */
export function FitBounds({ map }: Props) {
  const features = useDataStore((s) => s.features)

  useEffect(() => {
    if (features.length === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const f of features) {
      const [w, s, e, n] = f.bbox || getGeometryBBox(f.geometry)
      if (w < minX) minX = w
      if (s < minY) minY = s
      if (e > maxX) maxX = e
      if (n > maxY) maxY = n
    }

    if (minX !== Infinity) {
      map.fitBounds([[minX, minY], [maxX, maxY]], { padding: fitPadding(map.getContainer()), maxZoom: 16, duration: 600 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount

  return null
}

/** One-shot autofit from URL boundary param. Store convention is [S, N, W, E]
 * (shared with adapter-leaflet). MapLibre's `fitBounds` wants
 * `[[west, south], [east, north]]` so we reorder. */
export default function BoundaryLayer({ map }: Props) {
  const bbox = useUIStore((s) => s.boundaryAutofitBbox)
  const setBoundaryAutofitBbox = useUIStore((s) => s.setBoundaryAutofitBbox)

  useEffect(() => {
    if (!bbox) return
    const [south, north, west, east] = bbox
    // maxZoom parity with adapter-leaflet — URL-boundary autofit shouldn't
    // over-zoom into a small bbox beyond readable country / city extent.
    map.fitBounds([[west, south], [east, north]], { padding: fitPadding(map.getContainer()), maxZoom: 10, duration: 1 })
    setBoundaryAutofitBbox(null)
  }, [bbox, setBoundaryAutofitBbox, map])

  return null
}
