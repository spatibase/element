import { CornersOut } from '@phosphor-icons/react'
import { featureCollection } from '@turf/helpers'
import { bbox } from '@turf/bbox'
import { useDataStore } from '../store/StoreContext'
import { useMapController } from '../contexts/MapControllerContext'
import { useEmit } from '../contexts/EventContext'
import { IconButton, type IconButtonSize } from './ui/IconButton'
import type { TooltipSide } from './ui/Tooltip'
import { getGeometryBBox } from '@element-editor/core'

export default function FitBoundsButton({ size, tooltipSide }: { size?: IconButtonSize; tooltipSide?: TooltipSide } = {}) {
  const { fitBounds } = useMapController()
  const emit = useEmit()
  const features = useDataStore((s) => s.features)
  const selectedIds = useDataStore((s) => s.selectedIds)

  function handleFitBounds() {
    if (!fitBounds) return

    let targetFeatures = features
    // If there is an active selection, only fit to the selected items
    if (selectedIds.length > 0) {
      const selectedSet = new Set(selectedIds)
      targetFeatures = features.filter((f) => selectedSet.has(f.id))
    }

    if (targetFeatures.length === 0) {
      emit({ type: 'warning', message: 'No features on the map to zoom to' })
      return
    }

    try {
      // For a single feature, use its stored bbox or calculate it
      if (targetFeatures.length === 1) {
        const f = targetFeatures[0]
        fitBounds(f.bbox || getGeometryBBox(f.geometry))
        return
      }

      // For multiple features, calculate the combined bounding box
      const collection = featureCollection(targetFeatures as unknown as import('geojson').Feature[])
      const combinedBbox = bbox(collection) as [number, number, number, number]
      fitBounds(combinedBbox)
    } catch (err) {
      emit({ type: 'error', code: 'geometry', source: 'editor', message: 'Failed to calculate map bounds', cause: err })
    }
  }

  return (
    <IconButton
      label="Fit map to features"
      tooltipContent={selectedIds.length > 0 ? 'Zoom to selection' : 'Zoom to all features'}
      onClick={handleFitBounds}
      size={size}
      tooltipSide={tooltipSide}
    >
      <CornersOut size={24} />
    </IconButton>
  )
}
