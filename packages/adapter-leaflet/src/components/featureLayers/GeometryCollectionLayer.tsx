import React, { memo, useContext, useEffect, useState } from 'react'
import { Marker, Polygon, Polyline } from 'react-leaflet'
import type { LatLngExpression, LeafletMouseEvent, PathOptions } from 'leaflet'
import { DEFAULT_FEATURE_COLOR, type GeoJSONFeature, type SimpleGeometry } from '@element-editor/core'
import { translateGeometryVisually } from '@element-editor/core/internal'
import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { usePartDrag } from '../../hooks/usePartDrag'
import { bindFeatureTooltip, unbindFeatureTooltip } from '../../utils/featureTooltip'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { LINE_HIT_WEIGHT } from './renderer'
import {
  AccentContext, HOVER_POLY, IDLE_LINE, IDLE_POLY, idlePin, idleStyle, litStyle, makeContextMenuHandler,
  makeDimmedPinIcon, makePinIcon, pinColor, tintPin, useCustomStyle, useStateLook, type OpenFeatureCtxMenu,
} from './shared'

/** Render shapes from a simple geometry into Leaflet elements. */
interface SimpleGeometryRendererProps {
  geom: SimpleGeometry
  delta: [number, number] | null
  keyPrefix: string
  active: boolean
  selectedPart: boolean
  linePathOptions: PathOptions
  polyPathOptions: PathOptions
  pinSelected: boolean
  pinMultiSelected: boolean
  /** Idle pin colour (featureColor / getFeatureStyle). */
  pinIdle?: string
  pinLit?: string
  pinHover?: string
  handlers: Record<string, (...args: never[]) => void>
  visual?: boolean
}

function SimpleGeometryRenderer({ geom, delta, keyPrefix, active, selectedPart, linePathOptions, polyPathOptions, pinSelected, pinMultiSelected, pinIdle, pinLit, pinHover, handlers, visual = false }: SimpleGeometryRendererProps) {
  const applyOffset = delta
    ? <T,>(coords: T): T => translateGeometryVisually(coords as never, delta[0], delta[1]) as T
    : <T,>(coords: T): T => coords
  const offset = delta
    ? (visual
        ? (c: [number, number]) => translateGeometryVisually([c], delta[0], delta[1])[0] as [number, number]
        : ([lng, lat]: [number, number]): [number, number] => [lng + delta[0], lat + delta[1]])
    : (c: [number, number]) => c
  const dimmedLine = { ...linePathOptions, opacity: 0.25 }
  const dimmedPoly = { ...polyPathOptions, opacity: 0.2, fillOpacity: 0.08 }
  const lpo = selectedPart ? linePathOptions : dimmedLine
  const ppo = selectedPart ? polyPathOptions : dimmedPoly

  if (geom.type === 'Point') {
    return <Marker position={toLeaflet(offset(geom.coordinates))}
      icon={!active ? idlePin(pinIdle, pinHover) : (!selectedPart ? makeDimmedPinIcon(pinIdle) : makePinIcon(pinSelected, pinMultiSelected, pinIdle, pinLit))}
      draggable={false} eventHandlers={handlers} />
  }
  if (geom.type === 'MultiPoint') {
    return <>{geom.coordinates.map((c, j) => (
      <Marker key={`${keyPrefix}-pt${j}`} position={toLeaflet(offset(c))}
        icon={!active ? idlePin(pinIdle, pinHover) : (!selectedPart ? makeDimmedPinIcon(pinIdle) : makePinIcon(pinSelected, pinMultiSelected, pinIdle, pinLit))}
        draggable={false} eventHandlers={handlers} />
    ))}</>
  }
  if (geom.type === 'LineString') {
    const pos = (delta ? applyOffset(geom.coordinates) : geom.coordinates).map(toLeaflet)
    return <>
      <Polyline positions={pos} pathOptions={lpo} interactive={false} />
      <Polyline positions={pos} pathOptions={{ color: '#000', weight: LINE_HIT_WEIGHT, opacity: 0.001 }} eventHandlers={handlers} />
    </>
  }
  if (geom.type === 'MultiLineString') {
    const offsetLines = delta ? applyOffset(geom.coordinates) : geom.coordinates
    return <>{offsetLines.map((line: [number, number][], j: number) => {
      const pos = line.map(toLeaflet)
      return <React.Fragment key={`${keyPrefix}-ln${j}`}>
        <Polyline positions={pos} pathOptions={lpo} interactive={false} />
        <Polyline positions={pos} pathOptions={{ color: '#000', weight: LINE_HIT_WEIGHT, opacity: 0.001 }} eventHandlers={handlers} />
      </React.Fragment>
    })}</>
  }
  if (geom.type === 'Polygon') {
    const offsetRings = delta ? applyOffset(geom.coordinates) : geom.coordinates
    const pos = offsetRings.map((r: [number, number][]) => r.map(toLeaflet)) as LatLngExpression[][]
    return <Polygon positions={pos} pathOptions={ppo} eventHandlers={handlers} />
  }
  if (geom.type === 'MultiPolygon') {
    const offsetPolys = delta ? applyOffset(geom.coordinates) : geom.coordinates
    return <>{offsetPolys.map((poly: [number, number][][], j: number) => {
      const pos = poly.map((r: [number, number][]) => r.map(toLeaflet)) as LatLngExpression[][]
      return <Polygon key={`${keyPrefix}-part${j}`} positions={pos} pathOptions={ppo} eventHandlers={handlers} />
    })}</>
  }
  return null
}

export const GeometryCollectionLayer = memo(function GeometryCollectionLayer({ feature, selected, isMultiSelected, multiDragDelta, readonly, interaction, onContextMenu }: {
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
  const [hovered, setHovered] = useState(false)

  const { effectiveDelta, dragged, handleMouseDown } = usePartDrag(feature, selected, isMultiSelected, multiDragDelta, readonly, interaction)

  const accent500 = useContext(AccentContext)[500]
  const custom = useCustomStyle(feature)
  const look = useStateLook(feature, custom, isMultiSelected || selected, hovered)
  // Swapping renderers on select/deselect replaces the path, so the old path's mouseout never fires: drop the stale hover (the next mousemove over the new path sets it again).
  useEffect(() => { setHovered(false) }, [selected, isMultiSelected])
  if (feature.geometry.type !== 'GeometryCollection') return null

  function makeHandlers(partIndex: number) {
    return {
      mouseover: (e: L.LeafletMouseEvent) => { bindFeatureTooltip(e.target, feature, uiStore, e.latlng, e.originalEvent); setHovered(true); tintPin(e.target, true) },
      mouseout: (e: L.LeafletMouseEvent) => { unbindFeatureTooltip(e.target); setHovered(false); tintPin(e.target, false) },
      click: (e: LeafletMouseEvent) => {
        if (uiStore.getState().editingMode !== 'none') return
        e.originalEvent.stopPropagation()
        if (e.originalEvent.shiftKey && !readonly) {
          if (!interaction.shouldHandleFeatureClick(dragged.current)) return
          toggleSelection(feature.id)
        } else if (selected) {
          // Already selected — toggle part selection (bypass interaction machine)
          if (dragged.current) return
          interaction.markFeatureClick()
          setSelectedPartIndex(selectedPartIndex === partIndex ? null : partIndex)
        } else {
          if (!interaction.shouldHandleFeatureClick(dragged.current)) return
          interaction.markFeatureClick()
          dataStore.getState().selectFeature(feature.id)
        }
      },
      mousedown: (e: LeafletMouseEvent) => handleMouseDown(partIndex, e),
      contextmenu: makeContextMenuHandler(feature, readonly, onContextMenu),
    }
  }

  const active = isMultiSelected || selected || !!effectiveDelta // pins: hover tints in place (tintPin)
  const hasPartSelected = selected && selectedPartIndex != null
  const lit = isMultiSelected || selected || !!effectiveDelta
  const linePathOptions = lit
    ? litStyle(custom, false, { color: (isMultiSelected || selected) ? look.color : DEFAULT_FEATURE_COLOR, weight: (selected ? 4.5 : 3.5) + look.boost, opacity: hovered ? 1 : 0.9, ...look.host })
    : idleStyle(IDLE_LINE, custom, hovered ? { opacity: 1, ...look.hover } : null)
  const polyPathOptions = lit
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

  return (
    <>
      {feature.geometry.geometries.map((sub, partIdx) => {
        // When a part is selected, only apply drag delta to that part
        const partDelta = effectiveDelta
          ? (hasPartSelected
              ? (partIdx === selectedPartIndex ? effectiveDelta : null)
              : effectiveDelta)
          : null
        const isThisPart = selectedPartIndex === partIdx
        const partHighlighted = !hasPartSelected || isThisPart
        return (
          <React.Fragment key={partIdx}>
            <SimpleGeometryRenderer geom={sub} delta={partDelta} keyPrefix={`gc-${partIdx}`} active={active} selectedPart={partHighlighted} linePathOptions={linePathOptions} polyPathOptions={polyPathOptions} pinSelected={selected} pinMultiSelected={isMultiSelected} pinIdle={pinColor(custom)} pinLit={look.pinLit} pinHover={look.pinHover} handlers={makeHandlers(partIdx)} visual={dataStore.getState().geometryMode === 'visual'} />
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
