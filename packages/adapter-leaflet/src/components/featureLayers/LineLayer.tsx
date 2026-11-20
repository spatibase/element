import { memo, useContext, useMemo, useRef, useState } from 'react'
import { Polyline } from 'react-leaflet'
import type { LatLngExpression, LeafletMouseEvent } from 'leaflet'
import { DEFAULT_FEATURE_COLOR, type GeoJSONFeature } from '@element-editor/core'
import { isTouchEvent } from '@element-editor/core/internal'
import { useDataStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { GHOST_LINE_OPTIONS } from '../../utils/dragUtils'
import { bindFeatureTooltip, unbindFeatureTooltip } from '../../utils/featureTooltip'
import { SELECTED_FEATURE_CLASS } from '../../utils/selectedDrag'
import { useModifierDragCursor } from '../../hooks/useModifierDragCursor'
import { useFeatureDrag } from '../../hooks/useFeatureDrag'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { LINE_HIT_WEIGHT, pathElement, useFeatureRenderer } from './renderer'
import { AccentContext, IDLE_LINE, idleStyle, litStyle, makeContextMenuHandler, useCustomStyle, type OpenFeatureCtxMenu } from './shared'

export const LineLayer = memo(function LineLayer({ feature, selected, isMultiSelected, onVertexEdit, multiDragDelta, multiDuplicateDrag, readonly, interaction, onContextMenu }: {
  feature: GeoJSONFeature
  selected: boolean
  isMultiSelected: boolean
  onVertexEdit: () => void
  multiDragDelta: [number, number] | null
  multiDuplicateDrag: boolean
  readonly: boolean
  interaction: MapInteractionMachine
  onContextMenu?: OpenFeatureCtxMenu
}) {
  const { dataStore, uiStore } = useGeoStore()
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const accent500 = useContext(AccentContext)[500]

  const coords = feature.geometry.coordinates as [number, number][]
  const mainRef = useRef<L.Polyline | null>(null)
  const ghostRef = useRef<L.Polyline | null>(null)
  const hitRef = useRef<L.Polyline | null>(null)
  const [hovered, setHovered] = useState(false)
  const modifierCursor = useModifierDragCursor(readonly)
  const custom = useCustomStyle(feature)
  // On canvas the visible line is the hit target (renderer tolerance widens it);
  // on SVG it's inert and the 12 px transparent hit path takes the events.
  const renderer = useFeatureRenderer(selected || isMultiSelected, () => [mainRef.current, hitRef.current], {
    before: (l, onCanvas) => { if (l === mainRef.current) l.options.interactive = onCanvas },
    after: () => { const l = (renderer ? mainRef : hitRef).current; if (l) modifierCursor.retarget(pathElement(l)) },
  })

  const { effectiveDelta, display: displayCoords, ghost: ghostCoords, dragged, handleMouseDown } = useFeatureDrag(
    feature, 'LineString', coords, selected, isMultiSelected, multiDragDelta, multiDuplicateDrag, readonly, interaction,
    (translated, isDuplicate) => (isDuplicate ? ghostRef : mainRef).current?.setLatLngs(translated.map(toLeaflet) as LatLngExpression[]),
  )
  const positions: LatLngExpression[] = useMemo(() => displayCoords.map(toLeaflet), [displayCoords])

  const handlers = {
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
  }

  return (
    <>
      <Polyline
        ref={(l) => { mainRef.current = (l as unknown as L.Polyline | null) }}
        positions={positions}
        pathOptions={(selected || isMultiSelected || !!effectiveDelta)
          ? litStyle(custom, false, {
              color: (isMultiSelected || selected) ? accent500 : DEFAULT_FEATURE_COLOR,
              weight: selected || hovered ? 4.5 : 3.5,
              opacity: hovered ? 1 : 0.9,
            })
          : idleStyle(IDLE_LINE, custom, hovered ? { weight: 4.5, opacity: 1 } : null)}
        renderer={renderer}
        interactive={!!renderer}
        eventHandlers={handlers}
      />
      {!renderer && (
        <Polyline
          ref={(l) => { hitRef.current = (l as unknown as L.Polyline | null) }}
          positions={positions}
          pathOptions={{ color: '#000', weight: LINE_HIT_WEIGHT, opacity: 0.001, className: selected || isMultiSelected ? SELECTED_FEATURE_CLASS : '' }}
          eventHandlers={handlers}
        />
      )}
      {ghostCoords && (
        <Polyline
          ref={(l) => { ghostRef.current = (l as unknown as L.Polyline | null) }}
          positions={ghostCoords.map(toLeaflet)}
          pathOptions={{ ...GHOST_LINE_OPTIONS, color: accent500 }}
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
