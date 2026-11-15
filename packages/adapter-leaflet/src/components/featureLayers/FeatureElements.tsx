import React, { memo, useRef } from 'react'
import { type GeoJSONFeature } from '@element-editor/core'
import { canProcessShape } from '@element-editor/core/internal'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { TextLabelLayer } from '../TextLabelLayer'
import { GeometryCollectionLayer } from './GeometryCollectionLayer'
import { LineLayer } from './LineLayer'
import { MultiLineLayer } from './MultiLineLayer'
import { MultiPointLayer } from './MultiPointLayer'
import { MultiPolygonLayer } from './MultiPolygonLayer'
import { POIMarker } from './POIMarker'
import { PolygonLayer } from './PolygonLayer'
import type { OpenFeatureCtxMenu } from './shared'
import { useProgressiveMount, type ViewBounds } from './useProgressiveMount'

type FeatureElementsProps = {
  culledFeatures: GeoJSONFeature[]
  multiSelectedSet: Set<string>
  transformDragging: boolean
  selectedFeatureId: string | null
  editingMode: string
  geometryPreview: unknown
  bufferCreateNew: boolean
  multiDragDelta: [number, number] | null
  multiDuplicateDrag: boolean
  readonly: boolean
  interaction: MapInteractionMachine
  openFeatureCtxMenu: OpenFeatureCtxMenu
  vertexEditId: string | null
  viewBounds: ViewBounds | null
  onVertexEdit: (id: string) => void
}

/**
 * The feature layers. Its own component so a progressive-mount tick re-renders
 * only this list, not the whole FeatureInteractionLayer.
 */
export const FeatureElements = memo(function FeatureElements({
  culledFeatures, multiSelectedSet, transformDragging, selectedFeatureId, editingMode, geometryPreview,
  bufferCreateNew, multiDragDelta, multiDuplicateDrag, readonly, interaction, openFeatureCtxMenu,
  vertexEditId, viewBounds, onVertexEdit,
}: FeatureElementsProps) {
  // The per-feature element list, rebuilt only when something it reads changes
  // (not on every parent render, e.g. a pan's viewBounds update or vertex-edit state).
  // Elements are cached per feature id: a one-feature commit (or a selection change)
  // with ~2k features in view reuses every other element as-is, so React skips them
  // without even running their memo comparators. The cache resets when a prop shared
  // by all elements changes.
  const elementCacheRef = useRef<{ shared: unknown[]; byId: Map<string, { f: GeoJSONFeature; sel: boolean; multi: boolean; delta: [number, number] | null; el: React.ReactElement }> }>({ shared: [], byId: new Map() })
  return useProgressiveMount(culledFeatures, (f) => multiSelectedSet.has(f.id) || f.id === vertexEditId, viewBounds, (list, mounts, partial) => {
    const cache = elementCacheRef.current
    const shared = [multiDuplicateDrag, readonly, interaction, openFeatureCtxMenu]
    if (shared.some((v, i) => v !== cache.shared[i])) cache.byId = new Map()
    cache.shared = shared
    // A full pass keeps only what it renders; a mount tick (partial) adds its chunk.
    const nextById: typeof cache.byId = partial ? cache.byId : new Map()
    const out = list.map((f) => {
        if (!mounts(f)) return null
        const isMultiSelected = multiSelectedSet.has(f.id)
        if (transformDragging && (isMultiSelected || f.id === selectedFeatureId)) return null
        // Hide the original shape while the geometry processing preview stands in for it
        if (
          (editingMode === 'simplify-shape' || editingMode === 'smooth-shape' || (editingMode === 'buffer-shape' && !bufferCreateNew)) &&
          geometryPreview !== null && f.id === selectedFeatureId &&
          canProcessShape(f.geometry.type)
        ) return null

        // Only pass multiDragDelta to multi-selected features — prevents re-renders of all others during drag
        const activeDelta = isMultiSelected ? multiDragDelta : null
        const sel = f.id === selectedFeatureId
        const hit = cache.byId.get(f.id)
        if (hit && hit.f === f && hit.sel === sel && hit.multi === isMultiSelected && hit.delta === activeDelta) {
          nextById.set(f.id, hit)
          return hit.el
        }
        const el = f.geometry.type === 'Point' ? (
          f.properties._isText === 'true' ? (
            <TextLabelLayer key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} multiDuplicateDrag={multiDuplicateDrag} readonly={readonly} suppressDoubleClickZoomForGesture={interaction.suppressDoubleClickZoomForGesture} />
          ) : (
            <POIMarker key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} multiDuplicateDrag={multiDuplicateDrag} readonly={readonly} interaction={interaction} onContextMenu={openFeatureCtxMenu} />
          )
        ) : f.geometry.type === 'MultiPoint' ? (
          <MultiPointLayer key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} readonly={readonly} interaction={interaction} onContextMenu={openFeatureCtxMenu} />
        ) : f.geometry.type === 'Polygon' ? (
          <PolygonLayer key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} multiDuplicateDrag={multiDuplicateDrag} onVertexEdit={() => { if (!readonly) onVertexEdit(f.id) }} readonly={readonly} interaction={interaction} onContextMenu={openFeatureCtxMenu} />
        ) : f.geometry.type === 'MultiPolygon' ? (
          <MultiPolygonLayer key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} onVertexEdit={() => { if (!readonly) onVertexEdit(f.id) }} readonly={readonly} interaction={interaction} onContextMenu={openFeatureCtxMenu} />
        ) : f.geometry.type === 'MultiLineString' ? (
          <MultiLineLayer key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} readonly={readonly} interaction={interaction} onContextMenu={openFeatureCtxMenu} />
        ) : f.geometry.type === 'GeometryCollection' ? (
          <GeometryCollectionLayer key={f.id} feature={f} selected={f.id === selectedFeatureId} isMultiSelected={isMultiSelected} multiDragDelta={activeDelta} readonly={readonly} interaction={interaction} onContextMenu={openFeatureCtxMenu} />
        ) : (
          <LineLayer
            key={f.id}
            feature={f}
            selected={f.id === selectedFeatureId}
            isMultiSelected={isMultiSelected}
            multiDragDelta={activeDelta}
            multiDuplicateDrag={multiDuplicateDrag}
            onVertexEdit={() => { if (!readonly) onVertexEdit(f.id) }}
            readonly={readonly}
            interaction={interaction}
            onContextMenu={openFeatureCtxMenu}
          />
        )
        nextById.set(f.id, { f, sel, multi: isMultiSelected, delta: activeDelta, el })
        return el
    })
    cache.byId = nextById
    return out
  }, [multiSelectedSet, transformDragging, selectedFeatureId, editingMode, geometryPreview, bufferCreateNew, multiDragDelta, multiDuplicateDrag, readonly, interaction, openFeatureCtxMenu, vertexEditId])
})
