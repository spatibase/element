import { memo, useContext, useMemo, useRef, useState } from 'react'
import { Polygon } from 'react-leaflet'
import type { LatLngExpression, LeafletMouseEvent } from 'leaflet'
import { DEFAULT_FEATURE_COLOR, type GeoJSONFeature } from '@element-editor/core'
import { isTouchEvent } from '@element-editor/core/internal'
import { useDataStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { GHOST_FILL_OPTIONS } from '../../utils/dragUtils'
import { bindFeatureTooltip, unbindFeatureTooltip } from '../../utils/featureTooltip'
import { useModifierDragCursor } from '../../hooks/useModifierDragCursor'
import { useFeatureDrag } from '../../hooks/useFeatureDrag'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { pathElement, useFeatureRenderer } from './renderer'
import { AccentContext, HOVER_POLY, IDLE_POLY, idleStyle, litStyle, makeContextMenuHandler, useCustomStyle, type OpenFeatureCtxMenu } from './shared'

export const PolygonLayer = memo(function PolygonLayer({ feature, selected, isMultiSelected, multiDragDelta, multiDuplicateDrag, onVertexEdit, readonly, interaction, onContextMenu }: { feature: GeoJSONFeature; selected: boolean; isMultiSelected: boolean; multiDragDelta: [number, number] | null; multiDuplicateDrag: boolean; onVertexEdit: () => void; readonly: boolean; interaction: MapInteractionMachine; onContextMenu?: OpenFeatureCtxMenu }) {
  const { dataStore, uiStore } = useGeoStore()
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const accent500 = useContext(AccentContext)[500]

  const rings = feature.geometry.coordinates as [number, number][][]
  const mainRef = useRef<L.Polygon | null>(null)
  const ghostRef = useRef<L.Polygon | null>(null)
  const [hovered, setHovered] = useState(false)
  const modifierCursor = useModifierDragCursor(readonly)
  const custom = useCustomStyle(feature)
  const renderer = useFeatureRenderer(selected || isMultiSelected, () => [mainRef.current], {
    after: () => { if (mainRef.current) modifierCursor.retarget(pathElement(mainRef.current)) },
  })

  const { effectiveDelta, display: displayRings, ghost: ghostRings, dragged, handleMouseDown } = useFeatureDrag(
    feature, 'Polygon', rings, selected, isMultiSelected, multiDragDelta, multiDuplicateDrag, readonly, interaction,
    (translated, isDuplicate) => (isDuplicate ? ghostRef : mainRef).current?.setLatLngs(translated.map((ring) => ring.map(toLeaflet)) as LatLngExpression[][]),
  )
  const positions: LatLngExpression[][] = useMemo(() => displayRings.map((ring) => ring.map(toLeaflet)), [displayRings])

  return (
    <>
    <Polygon
      ref={(l) => { mainRef.current = (l as unknown as L.Polygon | null) }}
      positions={positions}
      renderer={renderer}
      pathOptions={(isMultiSelected || selected || !!effectiveDelta)
        ? litStyle(custom, true, {
            color: (isMultiSelected || selected) ? accent500 : DEFAULT_FEATURE_COLOR,
            fillColor: (isMultiSelected || selected) ? accent500 : DEFAULT_FEATURE_COLOR,
            weight: selected ? 3 : 2,
            opacity: hovered ? 1 : 0.9,
            fillOpacity: selected ? 0.25 : hovered ? 0.28 : 0.15,
            className: effectiveDelta ? 'cursor-grabbing' : '',
          })
        : idleStyle(IDLE_POLY, custom, hovered ? HOVER_POLY : null)}
      eventHandlers={{
        mouseover: (e: L.LeafletMouseEvent) => {
          modifierCursor.enter(pathElement(e.target as L.Path), e.originalEvent)
          bindFeatureTooltip(e.target, feature, uiStore, e.latlng, e.originalEvent)
          if (!uiStore.getState().vertexEditActive) setHovered(true)
        },
        mouseout: (e: L.LeafletMouseEvent) => {
          modifierCursor.leave()
          unbindFeatureTooltip(e.target)
          setHovered(false)
        },
        click: (e: LeafletMouseEvent) => {
          if (uiStore.getState().editingMode !== 'none') return
          e.originalEvent.stopPropagation()
          if (!interaction.shouldHandleFeatureClick(dragged.current)) return
          if (e.originalEvent.shiftKey && !readonly) {
            toggleSelection(feature.id)
          } else {
            // A finger has no double-click: a second tap on the selected shape edits its points.
            const sel = dataStore.getState().selectedIds
            const again = isTouchEvent(e.originalEvent) && sel.length === 1 && sel[0] === feature.id
            interaction.markFeatureClick()
            dataStore.getState().selectFeature(feature.id)
            if (again && !readonly && !uiStore.getState().vertexEditActive) onVertexEdit()
          }
        },
        dblclick: (e: LeafletMouseEvent) => {
          if (uiStore.getState().editingMode !== 'none') return
          e.originalEvent.stopPropagation()
          if (isTouchEvent(e.originalEvent) && uiStore.getState().vertexEditFeatureId === feature.id) return
          if (!readonly) onVertexEdit()
        },
        contextmenu: makeContextMenuHandler(feature, readonly, onContextMenu),
        mousedown: handleMouseDown,
      }}
    />
    {ghostRings && (
      <Polygon
        ref={(l) => { ghostRef.current = (l as unknown as L.Polygon | null) }}
        positions={ghostRings.map((ring) => ring.map(toLeaflet))}
        pathOptions={{ ...GHOST_FILL_OPTIONS, color: accent500, fillColor: accent500 }}
      />
    )}
    </>
  )
}, (prev, next) =>
  prev.feature === next.feature &&
  prev.selected === next.selected &&
  prev.isMultiSelected === next.isMultiSelected &&
  prev.multiDragDelta === next.multiDragDelta &&
  prev.multiDuplicateDrag === next.multiDuplicateDrag &&
  prev.readonly === next.readonly &&
  prev.interaction === next.interaction
)
