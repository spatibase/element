import { memo, useRef } from 'react'
import { Marker } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import { type GeoJSONFeature } from '@element-editor/core'
import { translateGeometryVisually } from '@element-editor/core/internal'
import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { usePartDrag } from '../../hooks/usePartDrag'
import { bindFeatureTooltip, unbindFeatureTooltip } from '../../utils/featureTooltip'
import { useModifierDragCursor } from '../../hooks/useModifierDragCursor'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { idlePin, makeContextMenuHandler, makeDimmedPinIcon, makePinIcon, pinColor, tintPin, useCustomStyle, type OpenFeatureCtxMenu } from './shared'

export const MultiPointLayer = memo(function MultiPointLayer({ feature, selected, isMultiSelected, multiDragDelta, readonly, interaction, onContextMenu }: { feature: GeoJSONFeature; selected: boolean; isMultiSelected: boolean; multiDragDelta: [number, number] | null; readonly: boolean; interaction: MapInteractionMachine; onContextMenu?: OpenFeatureCtxMenu }) {
  const { dataStore, uiStore } = useGeoStore()
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const setSelectedPartIndex = useUIStore((s) => s.setSelectedPartIndex)
  const selectedPartIndex = useUIStore((s) => s.selectedPartIndex)
  const points = feature.geometry.coordinates as [number, number][]
  const pin = pinColor(useCustomStyle(feature))
  const markerRefs = useRef<Map<number, L.Marker>>(new Map())
  const modifierCursor = useModifierDragCursor(readonly)

  const { effectiveDelta, dragged, handleMouseDown } = usePartDrag(
    feature, selected, isMultiSelected, multiDragDelta, readonly, interaction,
    (delta, mode, activePartIdx) => {
      for (let i = 0; i < points.length; i++) {
        if (activePartIdx != null && activePartIdx !== i) continue
        const marker = markerRefs.current.get(i)
        if (!marker) continue
        const pt = points[i]
        const translated = mode === 'visual'
          ? translateGeometryVisually([pt], delta[0], delta[1])[0] as [number, number]
          : ([pt[0] + delta[0], pt[1] + delta[1]] as [number, number])
        marker.setLatLng(toLeaflet(translated))
      }
    }
  )
  const activePartIdx = selected ? selectedPartIndex : null

  const displayPoints: [number, number][] = points.map((pt, i) => {
    const applyDelta = effectiveDelta && (activePartIdx == null || activePartIdx === i)
    if (!applyDelta) return pt
    return dataStore.getState().geometryMode === 'visual'
      ? translateGeometryVisually([pt], effectiveDelta![0], effectiveDelta![1])[0] as [number, number]
      : [pt[0] + effectiveDelta![0], pt[1] + effectiveDelta![1]]
  })

  const active = isMultiSelected || selected || !!effectiveDelta
  const hasPartSelected = selected && selectedPartIndex != null

  return (
    <>
      {displayPoints.map((coord, i) => (
        <Marker
          key={`pt-${coord[0].toFixed(8)},${coord[1].toFixed(8)}-${i}`}
          ref={(m) => {
            if (m) markerRefs.current.set(i, m as unknown as L.Marker)
            else markerRefs.current.delete(i)
          }}
          position={toLeaflet(coord)}
          icon={!active ? idlePin(pin)
            : (hasPartSelected && selectedPartIndex !== i) ? makeDimmedPinIcon(pin)
            : makePinIcon(selected && (!hasPartSelected || selectedPartIndex === i), isMultiSelected, pin)}
          draggable={false}
          eventHandlers={{
            mouseover: (e: L.LeafletMouseEvent) => {
              modifierCursor.enter((e.target as L.Marker).getElement?.(), e.originalEvent)
              bindFeatureTooltip(e.target, feature, uiStore, e.latlng, e.originalEvent)
              if (!uiStore.getState().vertexEditActive) tintPin(e.target, true)
            },
            mouseout: (e: L.LeafletMouseEvent) => {
              modifierCursor.leave()
              unbindFeatureTooltip(e.target)
              tintPin(e.target, false)
            },
            click: (e: LeafletMouseEvent) => {
              if (uiStore.getState().editingMode !== 'none') return
              e.originalEvent.stopPropagation()
              if (e.originalEvent.shiftKey && !readonly) {
                if (!interaction.shouldHandleFeatureClick(dragged.current)) return
                toggleSelection(feature.id)
              } else if (selected) {
                if (dragged.current) return
                interaction.markFeatureClick()
                setSelectedPartIndex(selectedPartIndex === i ? null : i)
              } else {
                if (!interaction.shouldHandleFeatureClick(dragged.current)) return
                interaction.markFeatureClick()
                dataStore.getState().selectFeature(feature.id)
              }
            },
            mousedown: (e: LeafletMouseEvent) => handleMouseDown(i, e),
            contextmenu: makeContextMenuHandler(feature, readonly, onContextMenu),
          }}
        />
      ))}
    </>
  )
}, (prev, next) =>
  prev.feature === next.feature &&
  prev.selected === next.selected &&
  prev.isMultiSelected === next.isMultiSelected &&
  prev.multiDragDelta === next.multiDragDelta &&
  prev.readonly === next.readonly &&
  prev.interaction === next.interaction
)
