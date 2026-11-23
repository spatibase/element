import { memo, useContext, useMemo, useRef, useState } from 'react'
import { Polygon } from 'react-leaflet'
import type { LatLngExpression, LeafletMouseEvent } from 'leaflet'
import { DEFAULT_FEATURE_COLOR, type GeoJSONFeature } from '@element-editor/core'
import { translateGeometryVisually } from '@element-editor/core/internal'
import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { usePartDrag } from '../../hooks/usePartDrag'
import { bindFeatureTooltip, unbindFeatureTooltip } from '../../utils/featureTooltip'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { useFeatureRenderer } from './renderer'
import { AccentContext, HOVER_POLY, IDLE_POLY, idleStyle, litStyle, makeContextMenuHandler, useCustomStyle, useStateLook, type OpenFeatureCtxMenu } from './shared'

export const MultiPolygonLayer = memo(function MultiPolygonLayer({ feature, selected, isMultiSelected, multiDragDelta, onVertexEdit, readonly, interaction, onContextMenu }: { feature: GeoJSONFeature; selected: boolean; isMultiSelected: boolean; multiDragDelta: [number, number] | null; onVertexEdit: () => void; readonly: boolean; interaction: MapInteractionMachine; onContextMenu?: OpenFeatureCtxMenu }) {
  const { dataStore, uiStore } = useGeoStore()
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const setSelectedPartIndex = useUIStore((s) => s.setSelectedPartIndex)
  const selectedPartIndex = useUIStore((s) => s.selectedPartIndex)

  const polygons = feature.geometry.coordinates as [number, number][][][]
  const [hovered, setHovered] = useState(false)
  const polyRefs = useRef<Map<number, L.Polygon>>(new Map())
  const custom = useCustomStyle(feature)
  const look = useStateLook(feature, custom, isMultiSelected || selected, hovered)
  const renderer = useFeatureRenderer(selected || isMultiSelected, () => polyRefs.current.values())

  const { effectiveDelta, dragged, handleMouseDown } = usePartDrag(
    feature, selected, isMultiSelected, multiDragDelta, readonly, interaction,
    (delta, mode, activePartIdx) => {
      for (let i = 0; i < polygons.length; i++) {
        if (activePartIdx != null && activePartIdx !== i) continue
        const layer = polyRefs.current.get(i)
        if (!layer) continue
        const translated = mode === 'visual'
          ? translateGeometryVisually([polygons[i]], delta[0], delta[1])[0]
          : polygons[i].map((ring) => ring.map(([lng, lat]) => [lng + delta[0], lat + delta[1]] as [number, number]))
        layer.setLatLngs(translated.map((ring) => ring.map(toLeaflet)) as LatLngExpression[][])
      }
    }
  )
  const accent500 = useContext(AccentContext)[500]
  const activePartIdx = selected ? selectedPartIndex : null

  const displayPolygons = useMemo(() => polygons.map((poly, i) => {
    const applyDelta = effectiveDelta && (activePartIdx == null || activePartIdx === i)
    if (!applyDelta) return poly
    return dataStore.getState().geometryMode === 'visual'
      ? translateGeometryVisually([poly], effectiveDelta![0], effectiveDelta![1])[0]
      : poly.map((ring) => ring.map(([lng, lat]) => [lng + effectiveDelta![0], lat + effectiveDelta![1]] as [number, number]))
  }), [polygons, effectiveDelta, activePartIdx])

  const positions = useMemo(() => displayPolygons.map((poly) => poly.map((ring) => ring.map(toLeaflet))) as LatLngExpression[][][], [displayPolygons])

  const hasPartSelected = selected && selectedPartIndex != null

  const basePathOptions = (isMultiSelected || selected || !!effectiveDelta)
    ? litStyle(custom, true, {
        color: (isMultiSelected || selected) ? look.color : DEFAULT_FEATURE_COLOR,
        fillColor: (isMultiSelected || selected) ? look.fillColor : DEFAULT_FEATURE_COLOR,
        weight: (selected ? 3 : 2) + look.boost,
        opacity: hovered ? 1 : 0.9,
        fillOpacity: selected ? 0.25 : hovered ? 0.28 : 0.15,
        className: effectiveDelta ? 'cursor-grabbing' : '',
            ...look.host,
      })
    : idleStyle(IDLE_POLY, custom, hovered ? { ...HOVER_POLY, ...look.hover } : null)
  const dimmedPathOptions = { ...basePathOptions, opacity: 0.2, fillOpacity: 0.08 }

  return (
    <>
      {positions.map((polyPositions, i) => (
        <Polygon
          key={`poly-part-${i}`}
          ref={(l) => {
            if (l) polyRefs.current.set(i, l as unknown as L.Polygon)
            else polyRefs.current.delete(i)
          }}
          positions={polyPositions}
          renderer={renderer}
          pathOptions={hasPartSelected && selectedPartIndex !== i ? dimmedPathOptions : basePathOptions}
          eventHandlers={{
            mouseover: (e: L.LeafletMouseEvent) => { bindFeatureTooltip(e.target, feature, uiStore, e.latlng, e.originalEvent); if (!uiStore.getState().vertexEditActive) setHovered(true) },
            mouseout: (e: L.LeafletMouseEvent) => { unbindFeatureTooltip(e.target); setHovered(false) },
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
            dblclick: (e: LeafletMouseEvent) => {
              if (uiStore.getState().editingMode !== 'none') return
              e.originalEvent.stopPropagation()
              if (!readonly) onVertexEdit()
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
