import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { getGeometryBBox, getFeatureBBox, type GeoJSONFeature } from '@element-editor/core'
import { offsetGeometry, commitTopoDelete, rdp, fitPadding, vertexEditNotice, vertexEditPatch } from '@element-editor/core/internal'
import { FeatureMapContextMenu, type FeatureContextMenuData } from '@element-editor/ui'
import { useContextMenu } from '@element-editor/ui/internal'
import { useMap, useMapEvents } from 'react-leaflet'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEmit, useIsEventForEditor, useAccentPalette, useElementEditorConfig, VertexSelectionBar } from '@element-editor/ui'
import { FeatureStyleProvider, useFeatureStyle } from '../contexts/FeatureStyleContext'
import { unbindFeatureTooltip } from '../utils/featureTooltip'
import { markAddedUnderCursor, prunePending } from '../utils/freshFeature'
import { getLastPointer } from '../hooks/lastPointer'

import { TransformControls } from './TransformControls'
import { BoxSelectHandler } from './tools/BoxSelectHandler'
import { VertexEditor } from './tools/VertexEditor'
import { CirclePreview } from './previews/CirclePreview'
import { PolygonPreview } from './previews/PolygonPreview'
import { RectPreview } from './previews/RectPreview'
import { LinePreview } from './previews/LinePreview'
import { MapClickHandler } from './tools/MapClickHandler'
import { MultiDragHandler } from './tools/MultiDragHandler'
import { SelectedDragSupport } from './tools/SelectedDragSupport'
import { PendingPointMarker } from './PendingPointMarker'
import { useMapInteractionMachine } from '../hooks/useMapInteractionMachine'
import { isFreehandCommitConsumed } from '../utils/freehandCommitFlag'
import { IdleRendererContext, useIdleRenderer, type FeatureRenderer } from './featureLayers/renderer'
import { AccentContext, SelectionStyleContext, composeFeatureStyle, type OpenFeatureCtxMenu } from './featureLayers/shared'
import { FeatureElements } from './featureLayers/FeatureElements'

// Every feature is drawn once, by this layer (FeatureElements → one memoised
// per-geometry component in ./featureLayers). This file owns what spans
// features: selection, vertex edit, keyboard shortcuts, context menu, overlays.

export type { FeatureRenderer }

/**
 * Provides `getFeatureStyle` composed with `config.featureColor` to the feature layers,
 * stable until either changes. Only this reads the editor config: an unrelated config
 * change (units, or a host passing an equal inline `config={{…}}`) re-renders just this,
 * not every mounted feature layer.
 */
function ComposedFeatureStyle({ children }: { children: ReactNode }) {
  const getFeatureStyle = useFeatureStyle()
  const { featureColor, selectionStyle } = useElementEditorConfig()
  const composed = useMemo(() => composeFeatureStyle(getFeatureStyle, featureColor), [getFeatureStyle, featureColor])
  return (
    <SelectionStyleContext.Provider value={selectionStyle}>
      <FeatureStyleProvider getFeatureStyle={composed}>{children}</FeatureStyleProvider>
    </SelectionStyleContext.Provider>
  )
}

export function FitBounds() {
  const { dataStore } = useGeoStore()
  const map = useMap()

  useEffect(() => {
    // Read features once on mount via getState() to avoid subscribing to all feature updates
    // and causing this invisible component to re-render constantly.
    const features = dataStore.getState().features
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
      const p = fitPadding(map.getContainer())
      map.fitBounds([[minY, minX], [maxY, maxX]], { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom], maxZoom: 16 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export default function FeatureInteractionLayer({ renderer: rendererMode = 'canvas' }: { renderer?: FeatureRenderer } = {}) {
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const features = useDataStore((s) => s.features)
  const groups = useDataStore((s) => s.groups)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const selectedFeatureId = selectedIds.length === 1 ? selectedIds[0] : null
  const clearSelection = useDataStore((s) => s.clearSelection)
  const selectFeature = useDataStore((s) => s.selectFeature)
  const updateFeature = useDataStore((s) => s.updateFeature)
  const closeDialog = useUIStore((s) => s.closeDialog)
  const setTransformActive = useUIStore((s) => s.setTransformActive)
  const transformActive = useUIStore((s) => s.transformActive)
  const vertexEditActive = useUIStore((s) => s.vertexEditActive)
  const transformDragging = useUIStore((s) => s.transformDragging)
  const editingMode = useUIStore((s) => s.editingMode)
  const geometryPreview = useUIStore((s) => s.geometryPreview)
  const bufferCreateNew = useUIStore((s) => s.bufferCreateNew)
  const readonly = useUIStore((s) => s.readonly)
  // The store owns which feature is in vertex edit (uiStore.vertexEditFeatureId): the user's
  // gestures below and ref.setVertexEdit both write it, and this layer follows it.
  const vertexEditId = useUIStore((s) => s.vertexEditFeatureId)
  function setVertexEditId(id: string | null) {
    uiStore.getState().setVertexEditFeature(id)
  }
  const shownRouteWarnRef = useRef(false)
  const interaction = useMapInteractionMachine(!!vertexEditId || editingMode !== 'none')

  // The feature the last entry already announced: an entry from the map (enterVertexEdit) says
  // it at once; one that only changed the store (ref.setVertexEdit) is announced by the effect below.
  const announcedVertexEditRef = useRef<string | null>(null)
  function announceVertexEdit(featureId: string) {
    announcedVertexEditRef.current = featureId
    const feature = dataStore.getState().features.find((f) => f.id === featureId)
    // Circle / rectangle / route: say what an edit will do. Nothing converts yet: the first
    // committed point change does (vertexEditPatch).
    const notice = vertexEditNotice(feature)
    if (notice) emit({ type: 'warning', message: notice })
  }

  function enterVertexEdit(featureId: string, suppressDoubleClickZoom = false) {
    const feature = dataStore.getState().features.find((f) => f.id === featureId)
    if (!feature) return
    announceVertexEdit(featureId)
    if (suppressDoubleClickZoom) interaction.suppressDoubleClickZoomForGesture()
    interaction.suppressNextVertexExit()
    setVertexEditId(featureId)
    setSelectedVertexIndices([])
  }

  // Hide hover tooltip when features are removed (mouseout never fires on deleted layers)
  useEffect(() => {
    unbindFeatureTooltip(null)
  }, [features.length])

  // Hide hover tooltip when entering/leaving any drawing mode or vertex edit (mouseout
  // never fires when the mode switches; vertex edit shows no names at all)
  useEffect(() => {
    unbindFeatureTooltip(null)
  }, [editingMode, vertexEditActive])

  // Clear transform when selection is cleared
  useEffect(() => {
    if (transformActive && !selectedFeatureId && selectedIds.length === 0) {
      setTransformActive(false)
    }
  }, [selectedFeatureId, selectedIds.length, transformActive, setTransformActive])

  // Disable transform when entering vertex edit
  useEffect(() => {
    if (vertexEditId && transformActive) {
      setTransformActive(false)
    }
  }, [vertexEditId, transformActive, setTransformActive])

  // Warn once when transform activates on a route
  useEffect(() => {
    if (!transformActive) return
    const feature = selectedFeatureId ? dataStore.getState().features.find((f) => f.id === selectedFeatureId) : null
    if (feature?._drawType === 'route' && !shownRouteWarnRef.current) {
      emit({ type: 'warning', message: 'Transforming may break road alignment.' })
      shownRouteWarnRef.current = true
    }
  }, [transformActive, selectedFeatureId, dataStore, emit])
  const [selectedVertexIndices, setSelectedVertexIndices] = useState<number[]>([])
  const [multiDragDelta, setMultiDragDelta] = useState<[number, number] | null>(null)
  const [multiDuplicateDrag, setMultiDuplicateDrag] = useState(false)
  const map = useMap()
  const accent = useAccentPalette(map.getContainer())
  const idleRenderer = useIdleRenderer(map, rendererMode)

  // Right-click menu on any feature. Selects the clicked feature (unless it's
  // already part of a multi-selection) so the menu's actions operate on it.
  const featureCtxMenu = useContextMenu<FeatureContextMenuData>()
  const openCtxMenu = featureCtxMenu.open // stable; the returned object isn't
  const openFeatureCtxMenu = useCallback<OpenFeatureCtxMenu>((args) => {
    const { feature, x, y, requestPreciseCoords } = args
    const sel = dataStore.getState().selectedIds
    if (!(sel.length >= 2 && sel.includes(feature.id))) {
      dataStore.getState().selectFeature(feature.id)
    }
    openCtxMenu(x, y, { feature, requestPreciseCoords })
  }, [dataStore, openCtxMenu])

  const handleMultiDragEnd = useCallback((delta: [number, number], isDuplicate: boolean) => {
    setMultiDragDelta(null)
    interaction.markDragEnd()
    const byId = new Map(dataStore.getState().features.map((f) => [f.id, f]))
    const moved = dataStore.getState().selectedIds.flatMap((id) => {
      const f = byId.get(id)
      return f ? [{ id, geometry: offsetGeometry(f.geometry, delta, false) }] : []
    })
    if (isDuplicate) {
      dataStore.getState().duplicateFeaturesAtPosition(moved.map(({ id, geometry }) => ({ sourceId: id, geometry })))
    } else {
      dataStore.getState().takeSnapshot()
      dataStore.getState().updateFeatures(moved.map(({ id, geometry }) => ({ id, patch: { geometry } })))
    }
  }, [dataStore, interaction])

  // ─── Viewport bounds for culling ─────────────────────────────────────────
  const [viewBounds, setViewBounds] = useState<{ w: number; s: number; e: number; n: number } | null>(null)

  function updateViewBounds() {
    const b = map.getBounds().pad(0.5) // 50% buffer so features pre-load before entering view
    setViewBounds({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() })
  }

  useEffect(() => { updateViewBounds() }, []) // capture initial bounds on mount
  useMapEvents({
    moveend: updateViewBounds,
    zoomend: updateViewBounds,
    // Suppress the browser's native context menu anywhere on the map. Feature
    // layers call preventDefault themselves; this catches bare-map right-clicks.
    contextmenu: (e) => { e.originalEvent.preventDefault() },
    mousemove: (e) => prunePending(map, e.containerPoint),
  })

  // A feature added under the still cursor stays quiet (no name, no snap) until the
  // cursor leaves it: see utils/freshFeature.ts. Diffs ids only when features were added.
  const prevFeaturesRef = useRef(features)
  useEffect(() => {
    const prev = prevFeaturesRef.current
    prevFeaturesRef.current = features
    if (features.length <= prev.length) return
    const { x, y } = getLastPointer()
    const r = map.getContainer().getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
    const before = new Set(prev.map((f) => f.id))
    markAddedUnderCursor(map, features.filter((f) => !before.has(f.id)), { x: x - r.left, y: y - r.top })
  }, [features, map])

  // ─── Visible + culled features (memoized to avoid recomputing on unrelated re-renders) ───
  const visibleFeatures = useMemo(() => {
    const hiddenGroupIds = new Set(groups.filter((g) => g.hidden).map((g) => g.id))
    return features.filter((f) =>
      !f.hidden && (!f.groupId || !hiddenGroupIds.has(f.groupId))
    )
  }, [features, groups])

  const multiSelectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Keeps its identity while the culled set is unchanged, so a moveend that
  // brings nothing new into the padded view doesn't rebuild the feature list.
  const prevCulledRef = useRef<GeoJSONFeature[]>([])
  const culledFeatures = useMemo(() => {
    let next = visibleFeatures
    if (viewBounds) {
      // Always render: selected, vertex-edit, and multi-selected features regardless of viewport
      const alwaysRender = new Set<string>(selectedIds)
      if (selectedFeatureId) alwaysRender.add(selectedFeatureId)
      if (vertexEditId) alwaysRender.add(vertexEditId)
      next = visibleFeatures.filter((f) => {
        if (alwaysRender.has(f.id)) return true
        const [minX, minY, maxX, maxY] = getFeatureBBox(f)
        return maxX >= viewBounds.w && minX <= viewBounds.e && maxY >= viewBounds.s && minY <= viewBounds.n
      })
    }
    const prev = prevCulledRef.current
    if (prev.length === next.length && next.every((f, i) => f === prev[i])) return prev
    prevCulledRef.current = next
    return next
  }, [visibleFeatures, viewBounds, selectedIds, selectedFeatureId, vertexEditId])

  const vertexEditFeature = vertexEditId
    ? visibleFeatures.find((f) => f.id === vertexEditId && (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon')) ?? null
    : null

  const handleBoxSelect = useCallback((featureId: string, indices: number[]) => {
    if (vertexEditIdRef.current === featureId) {
      // Already in vertex edit on this feature → additive merge.
      setSelectedVertexIndices((prev) => {
        const merged = new Set(prev)
        for (const i of indices) merged.add(i)
        return Array.from(merged).sort((a, b) => a - b)
      })
      return
    }
    enterVertexEdit(featureId)
    setSelectedVertexIndices(indices)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction])

  // Clear vertex edit whenever the selected feature changes away from the vertex-edit feature.
  // Needed for POI clicks: markers don't produce a map click, so VertexEditor's onExit never fires.
  useEffect(() => {
    if (vertexEditId && selectedFeatureId !== vertexEditId) {
      setVertexEditId(null)
      setSelectedVertexIndices([])
    }
  }, [selectedFeatureId, vertexEditId])

  // Vertex edit that changed in the store alone (Esc in useKeyboardShortcuts, a deselect,
  // ref.setVertexEdit): drop the point selection and, for an entry, show the notice as the
  // gestures do. No suppressNextVertexExit: no click started it, so the next map click leaves.
  useEffect(() => {
    if (!vertexEditId) { announcedVertexEditRef.current = null; setSelectedVertexIndices([]); return }
    if (announcedVertexEditRef.current !== vertexEditId) {
      announceVertexEdit(vertexEditId)
      setSelectedVertexIndices([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertexEditId])

  // N toggles vertex edit — same guards as other letter shortcuts (panel must be closed).
  useEffect(() => {
    if (readonly) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'n' && e.key !== 'N') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!isForThisEditor(e)) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if (uiStore.getState().dialogState.type !== 'closed') return
      const currentSelectedId = (dataStore.getState().selectedIds.length === 1 ? dataStore.getState().selectedIds[0] : null)
      if (!currentSelectedId) return
      e.preventDefault()
      if (vertexEditId === currentSelectedId) {
        setVertexEditId(null)
        setSelectedVertexIndices([])
      } else {
        const feature = dataStore.getState().features.find((f) => f.id === currentSelectedId)
        if (!feature) return
        if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'Polygon') return
        enterVertexEdit(currentSelectedId)
      }
    }
    const targetWindow = (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
    targetWindow.addEventListener('keydown', handleKeyDown)
    return () => targetWindow.removeEventListener('keydown', handleKeyDown)
  }, [vertexEditId, uiStore, dataStore, readonly, interaction, isForThisEditor])

  // Enter toggles vertex edit — capture phase + ref so nothing can block it.
  const vertexEditIdRef = useRef(vertexEditId)
  useEffect(() => { vertexEditIdRef.current = vertexEditId }, [vertexEditId])

  // BoxSelectHandler reads this ref when shift+drag begins to seed live
  // preview with the user's prior additive picks.
  const selectedVertexIndicesRef = useRef(selectedVertexIndices)
  useEffect(() => { selectedVertexIndicesRef.current = selectedVertexIndices }, [selectedVertexIndices])

  useEffect(() => {
    if (readonly) return
    function handleEnter(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Host page / other editor: never act, never stopPropagation.
      if (!isForThisEditor(e)) return
      // Don't steal Enter from inputs (inline rename, panel fields, etc.) — the
      // listener is capture-phase, so stopImmediatePropagation in the input
      // handler can't defend itself. Let the input's bubble handler run.
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // Don't fire while drawing (Enter commits the shape in that flow).
      // One-shot tools and multi-click tools with nothing in progress fall
      // through to vertex-edit.
      const us = uiStore.getState()
      const currentMode = us.editingMode
      const isIdleOrOneShotTool = currentMode === 'none' ||
        currentMode === 'draw-rect' || currentMode === 'draw-circle' ||
        currentMode === 'place-point' || currentMode === 'draw-freehand' || currentMode === 'pick-shape' ||
        (currentMode === 'draw-line' && us.lineInProgress.length < 2) ||
        (currentMode === 'draw-polygon' && us.polygonInProgress.length < 3) ||
        (currentMode === 'draw-route' && us.routeWaypoints.length < 2)
      if (!isIdleOrOneShotTool) return
      // Don't fire while any edit/detail dialog is open — the focused control
      // (Source/Coordinates toggle, copy button, Save) should handle Enter.
      if (uiStore.getState().dialogState.type !== 'closed') return
      const currentSelectedId = (dataStore.getState().selectedIds.length === 1 ? dataStore.getState().selectedIds[0] : null)
      if (!currentSelectedId) return
      e.preventDefault()
      e.stopPropagation()
      // Exit any active one-shot tool so DrawingLayer stops intercepting mouse events.
      if (currentMode !== 'none') uiStore.getState().setEditingMode('none')
      if (vertexEditIdRef.current === currentSelectedId) {
        setVertexEditId(null)
        setSelectedVertexIndices([])
      } else {
        const feature = dataStore.getState().features.find((f) => f.id === currentSelectedId)
        if (!feature) return
        if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'Polygon') return
        enterVertexEdit(currentSelectedId)
      }
    }
    const targetWindow = (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
    targetWindow.addEventListener('keydown', handleEnter, { capture: true })
    return () => targetWindow.removeEventListener('keydown', handleEnter, { capture: true })
  }, [uiStore, dataStore, readonly, interaction, isForThisEditor])

  function handleExitVertexEdit() {
    if (!interaction.shouldHandleVertexExit()) return
    setVertexEditId(null)
    setSelectedVertexIndices([])
    // Only close the dialog if it's still showing the vertex-edit feature.
    // If the user clicked a different feature, openEditDialog already switched the dialog — don't clobber it.
    const ds = uiStore.getState().dialogState
    if (ds.type !== 'edit' || ds.featureId === vertexEditId) {
      closeDialog()
    }
  }

  const handleDeleteSelected = useCallback(() => {
    if (!vertexEditFeature || selectedVertexIndices.length === 0 || readonly) return
    dataStore.getState().takeSnapshot()
    const isPolygon = vertexEditFeature.geometry.type === 'Polygon'
    const selectedSet = new Set(selectedVertexIndices)

    if (isPolygon) {
      const ring = (vertexEditFeature.geometry.coordinates as [number, number][][])[0]
      const remaining = ring.slice(0, -1).filter((_, i) => !selectedSet.has(i))
      if (remaining.length < 3) {
        emit({ type: 'warning', message: 'Cannot delete: an area needs at least 3 points' })
        return
      }
      remaining.push(remaining[0]) // close ring
      updateFeature(vertexEditFeature.id, vertexEditPatch(vertexEditFeature, { type: 'Polygon', coordinates: [remaining] }))
    } else {
      const coords = vertexEditFeature.geometry.coordinates as [number, number][]
      const remaining = coords.filter((_, i) => !selectedSet.has(i))
      if (remaining.length < 2) {
        emit({ type: 'warning', message: 'Cannot delete: a line needs at least 2 points' })
        return
      }
      updateFeature(vertexEditFeature.id, vertexEditPatch(vertexEditFeature, { type: 'LineString', coordinates: remaining }))
    }
    if (isPolygon && uiStore.getState().topoEditEnabled) {
      const ring = (vertexEditFeature.geometry.coordinates as [number, number][][])[0]
      const deletedCoords = selectedVertexIndices.map(i => ring[i])
      dataStore.getState().updateFeatures(commitTopoDelete(dataStore.getState().features, vertexEditFeature.id,
        deletedCoords))
    }

    setSelectedVertexIndices([])
  }, [vertexEditFeature, selectedVertexIndices, updateFeature, readonly, uiStore, dataStore, emit])

  const handleSimplifySelected = useCallback(() => {
    if (!vertexEditFeature || selectedVertexIndices.length < 3 || readonly) {
      if (!readonly) emit({ type: 'warning', message: 'Select at least 3 points to simplify' })
      return
    }
    const isPolygon = vertexEditFeature.geometry.type === 'Polygon'
    const coords: [number, number][] = isPolygon
      ? (vertexEditFeature.geometry.coordinates as [number, number][][])[0].slice(0, -1)
      : vertexEditFeature.geometry.coordinates as [number, number][]
    const sorted = [...selectedVertexIndices].sort((a, b) => a - b)
    const minIdx = sorted[0]
    const maxIdx = sorted[sorted.length - 1]

    const segment = coords.slice(minIdx, maxIdx + 1)
    const simplified = rdp(segment, 1e-5)
    const removed = segment.length - simplified.length

    if (removed === 0) {
      emit({ type: 'warning', message: 'Nothing to remove: no selected point sits on a straight line' })
      return
    }

    const newCoords = [...coords.slice(0, minIdx), ...simplified, ...coords.slice(maxIdx + 1)]
    const minVerts = isPolygon ? 3 : 2
    if (newCoords.length < minVerts) {
      emit({ type: 'warning', message: `Cannot simplify: ${isPolygon ? 'an area needs at least 3' : 'a line needs at least 2'} points` })
      return
    }

    dataStore.getState().takeSnapshot() // one undo step, as on MapLibre
    if (isPolygon) {
      const ring = [...newCoords, newCoords[0]]
      updateFeature(vertexEditFeature.id, vertexEditPatch(vertexEditFeature, { type: 'Polygon', coordinates: [ring] }))

      // Topo: remove simplified-away vertices from neighbors
      if (uiStore.getState().topoEditEnabled) {
        const simplifiedSet = new Set(simplified.map(c => `${c[0]},${c[1]}`))
        const removedCoords = segment.filter(c => !simplifiedSet.has(`${c[0]},${c[1]}`))
        if (removedCoords.length > 0) {
          dataStore.getState().updateFeatures(commitTopoDelete(dataStore.getState().features, vertexEditFeature.id,
            removedCoords))
        }
      }
    } else {
      updateFeature(vertexEditFeature.id, vertexEditPatch(vertexEditFeature, { type: 'LineString', coordinates: newCoords }))
    }
    setSelectedVertexIndices([])
    emit({ type: 'success', message: `Removed ${removed} extra point${removed !== 1 ? 's' : ''}` })
  }, [vertexEditFeature, selectedVertexIndices, updateFeature, readonly, uiStore, dataStore, emit])

  // Latest enterVertexEdit for the feature list's onVertexEdit (a stable callback).
  const enterVertexEditRef = useRef(enterVertexEdit)
  enterVertexEditRef.current = enterVertexEdit
  const onFeatureVertexEdit = useCallback((id: string) => enterVertexEditRef.current(id, true), [])


  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const showDeleteBar = mounted && !!vertexEditFeature && selectedVertexIndices.length > 0 && !readonly

  return (
    <AccentContext.Provider value={accent}>
      <MapClickHandler onMapClick={(e) => {
        if (uiStore.getState().editingMode !== 'none') return
        if (isFreehandCommitConsumed()) return // suppress trailing click after freehand commit
        if (uiStore.getState().vertexEditActive) return
        if (e.originalEvent.shiftKey) return // shift+click handled by feature handlers
        // A feature click bubbles here too (and marked itself): transform stays on, as on
        // MapLibre. Only a click on empty map leaves it (with the selection; Esc / A also do).
        if (!interaction.shouldHandleMapClick()) return
        if (uiStore.getState().transformActive) uiStore.getState().setTransformActive(false)
        if (selectedIds.length > 0 && !readonly) clearSelection()
        if (selectedFeatureId) { selectFeature(null); closeDialog() }
      }} />
      <MultiDragHandler onDragDelta={setMultiDragDelta} onDragEnd={(d, dup) => { setMultiDuplicateDrag(false); handleMultiDragEnd(d, dup) }} onDuplicateDragChange={setMultiDuplicateDrag} onDragCancel={() => { setMultiDragDelta(null); setMultiDuplicateDrag(false) }} readonly={readonly} />
      <SelectedDragSupport readonly={readonly} />
      {/* Keyed by mode: switching renderer remounts the features onto the new one. */}
      <IdleRendererContext.Provider key={rendererMode} value={idleRenderer}>
        <ComposedFeatureStyle>
          <FeatureElements
            culledFeatures={culledFeatures} multiSelectedSet={multiSelectedSet} transformDragging={transformDragging}
            selectedFeatureId={selectedFeatureId} editingMode={editingMode} geometryPreview={geometryPreview}
            bufferCreateNew={bufferCreateNew} multiDragDelta={multiDragDelta} multiDuplicateDrag={multiDuplicateDrag}
            readonly={readonly} interaction={interaction} openFeatureCtxMenu={openFeatureCtxMenu}
            vertexEditId={vertexEditId} viewBounds={viewBounds} onVertexEdit={onFeatureVertexEdit}
          />
        </ComposedFeatureStyle>
      </IdleRendererContext.Provider>
      {vertexEditFeature && (
        <VertexEditor
          feature={
            (editingMode === 'simplify-shape' || editingMode === 'smooth-shape') && geometryPreview
              ? { ...vertexEditFeature, geometry: geometryPreview }
              : vertexEditFeature
          }
          selectedIndices={selectedVertexIndices}
          onExit={handleExitVertexEdit}
          onDeleteSelected={handleDeleteSelected}
          onSelectIndices={setSelectedVertexIndices}
          onFeatureClick={() => {
            interaction.markFeatureClick()
          }}
          readonly={readonly}
        />
      )}
      <BoxSelectHandler
        onSelect={handleBoxSelect}
        onDragStart={() => { interaction.markDragStart(); interaction.suppressNextVertexExit() }}
        readonly={readonly}
        getInitialVertexIndices={() => selectedVertexIndicesRef.current}
        onVertexBoxPreview={(featureId, indices) => {
          if (vertexEditIdRef.current === featureId) {
            setSelectedVertexIndices(indices)
          }
        }}
      />
      <LinePreview />
      <PolygonPreview />
      <CirclePreview />
      <RectPreview />
      <TransformControls />
      <PendingPointMarker />
      {showDeleteBar && (
        <VertexSelectionBar
          mapContainer={map.getContainer()}
          count={selectedVertexIndices.length}
          onSimplify={handleSimplifySelected}
          onDelete={handleDeleteSelected}
        />
      )}
      {featureCtxMenu.state && (
        <FeatureMapContextMenu
          x={featureCtxMenu.state.x}
          y={featureCtxMenu.state.y}
          data={featureCtxMenu.state.data}
          onClose={featureCtxMenu.close}
        />
      )}
    </AccentContext.Provider>
  )
}
