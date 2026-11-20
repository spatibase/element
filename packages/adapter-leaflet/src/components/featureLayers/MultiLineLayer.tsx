import React, { memo, useContext, useRef, useState } from 'react'
import { Polyline } from 'react-leaflet'
import type { LatLngExpression, LeafletMouseEvent } from 'leaflet'
import { DEFAULT_FEATURE_COLOR, type GeoJSONFeature } from '@element-editor/core'
import { translateGeometryVisually } from '@element-editor/core/internal'
import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { usePartDrag } from '../../hooks/usePartDrag'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { LINE_HIT_WEIGHT, useFeatureRenderer } from './renderer'
import { SELECTED_FEATURE_CLASS } from '../../utils/selectedDrag'
import { AccentContext, IDLE_LINE, idleStyle, litStyle, makeContextMenuHandler, useCustomStyle, type OpenFeatureCtxMenu } from './shared'

export const MultiLineLayer = memo(function MultiLineLayer({ feature, selected, isMultiSelected, multiDragDelta, readonly, interaction, onContextMenu }: {
  feature: GeoJSONFeature
  selected: boolean
  isMultiSelected: boolean
  multiDragDelta: [number, number] | null
  readonly: boolean
  interaction: MapInteractionMachine
  onContextMenu?: OpenFeatureCtxMenu
}) {
  const { dataStore, uiStore } = useGeoStore()
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const setSelectedPartIndex = useUIStore((s) => s.setSelectedPartIndex)
  const selectedPartIndex = useUIStore((s) => s.selectedPartIndex)

  const lines = feature.geometry.coordinates as [number, number][][]
  const [hovered, setHovered] = useState(false)
  const lineRefs = useRef<Map<number, L.Polyline>>(new Map())
  const hitRefs = useRef<Map<number, L.Polyline>>(new Map())
  const custom = useCustomStyle(feature)
  // Same split as LineLayer: visible line is the canvas hit target; SVG uses the hit path.
  const renderer = useFeatureRenderer(selected || isMultiSelected, () => [...lineRefs.current.values(), ...hitRefs.current.values()], {
    before: (l, onCanvas) => { if ([...lineRefs.current.values()].includes(l as L.Polyline)) l.options.interactive = onCanvas },
  })

  const { effectiveDelta, dragged, handleMouseDown } = usePartDrag(
    feature, selected, isMultiSelected, multiDragDelta, readonly, interaction,
    (delta, mode, activePartIdx) => {
      for (let i = 0; i < lines.length; i++) {
        if (activePartIdx != null && activePartIdx !== i) continue
        const layer = lineRefs.current.get(i)
        if (!layer) continue
        const translated = mode === 'visual'
          ? translateGeometryVisually([lines[i]], delta[0], delta[1])[0]
          : lines[i].map(([lng, lat]) => [lng + delta[0], lat + delta[1]] as [number, number])
        layer.setLatLngs(translated.map(toLeaflet) as LatLngExpression[])
      }
    }
  )
  const accent500 = useContext(AccentContext)[500]
  const activePartIdx = selected ? selectedPartIndex : null

  const displayLines = lines.map((line, i) => {
    const applyDelta = effectiveDelta && (activePartIdx == null || activePartIdx === i)
    if (!applyDelta) return line
    return dataStore.getState().geometryMode === 'visual'
      ? translateGeometryVisually([line], effectiveDelta![0], effectiveDelta![1])[0]
      : line.map(([lng, lat]) => [lng + effectiveDelta![0], lat + effectiveDelta![1]] as [number, number])
  })

  const positions = displayLines.map((line) => line.map(toLeaflet)) as LatLngExpression[][]

  const hasPartSelected = selected && selectedPartIndex != null

  const basePathOptions = (isMultiSelected || selected || !!effectiveDelta)
    ? litStyle(custom, false, {
        color: (isMultiSelected || selected) ? accent500 : DEFAULT_FEATURE_COLOR,
        weight: selected ? 4.5 : 3.5,
        opacity: hovered ? 1 : 0.9,
      })
    : idleStyle(IDLE_LINE, custom, hovered ? { opacity: 1 } : null)
  const dimmedPathOptions = { ...basePathOptions, opacity: 0.25 }

  return (
    <>
      {positions.map((linePositions, i) => {
        const partActive = !hasPartSelected || selectedPartIndex === i
        const lpo = partActive ? basePathOptions : dimmedPathOptions
        const handlers = {
                mouseover: () => { if (!uiStore.getState().vertexEditActive) setHovered(true) },
                mouseout: () => setHovered(false),
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
                },
                mousedown: (e: LeafletMouseEvent) => handleMouseDown(i, e),
                contextmenu: makeContextMenuHandler(feature, readonly, onContextMenu),
        }
        return (
          <React.Fragment key={`line-part-${i}`}>
            <Polyline
              ref={(l) => {
                if (l) lineRefs.current.set(i, l as unknown as L.Polyline)
                else lineRefs.current.delete(i)
              }}
              positions={linePositions}
              pathOptions={lpo}
              renderer={renderer}
              interactive={!!renderer}
              eventHandlers={handlers}
            />
            {!renderer && (
              <Polyline
                ref={(l) => {
                  if (l) hitRefs.current.set(i, l as unknown as L.Polyline)
                  else hitRefs.current.delete(i)
                }}
                positions={linePositions}
                pathOptions={{ color: '#000', weight: LINE_HIT_WEIGHT, opacity: 0.001, className: selected || isMultiSelected ? SELECTED_FEATURE_CLASS : '' }}
                eventHandlers={handlers}
              />
            )}
          </React.Fragment>
        )
      })}
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
