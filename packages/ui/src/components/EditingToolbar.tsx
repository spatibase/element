import { Suspense, lazy, useRef } from 'react'
import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { getFixedShortcutDisplay } from '@element-editor/core'
import { getPartCount, canProcessShape } from '@element-editor/core/internal'
import { useShortcutConfig } from '../contexts/ShortcutConfigContext'
import { useEmit } from '../contexts/EventContext'
import { CopySimple, Trash, Resize, Scissors, Knife, Shapes, StackPlus, WaveSine, SquareLogo, BezierCurve } from '@phosphor-icons/react'
import { KbdDark } from './ui/Kbd'
import { EditToolbarBtn } from './ui/EditToolbarBtn'
import { RowDivider } from './ui/RowDivider'
import { useBalancedWrap } from '../hooks/useBalancedWrap'
import { useTouchInput } from '../hooks/useTouchInput'

// Lazy: defers loading the geometry worker client until the user multi-selects.
const BooleanOperations = lazy(() => import('./BooleanOperations'))

export default function EditingToolbar() {
  const { dataStore } = useGeoStore()
  const readonly = useUIStore((s) => s.readonly)
  const transformActive = useUIStore((s) => s.transformActive)
  const setTransformActive = useUIStore((s) => s.setTransformActive)
  const editingMode = useUIStore((s) => s.editingMode)
  const setEditingMode = useUIStore((s) => s.setEditingMode)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const selectedFeatureId = selectedIds.length === 1 ? selectedIds[0] : null
  const closeDialog = useUIStore((s) => s.closeDialog)
  const vertexEditFeatureId = useUIStore((s) => s.vertexEditFeatureId)
  const setVertexEditFeature = useUIStore((s) => s.setVertexEditFeature)
  const touch = useTouchInput()
  const { getKey } = useShortcutConfig()
  const emit = useEmit()

  // Subscribe to derived geometry type of selected feature — avoids subscribing to entire features array
  const selectedGeomType = useDataStore((s) => {
    if (!selectedFeatureId) return null
    const f = s.features.find(x => x.id === selectedFeatureId)
    return f?.geometry.type ?? null
  })

  // Narrow screens: rows of even length, never a lone button on the second row.
  const barRef = useRef<HTMLDivElement>(null)
  useBalancedWrap(barRef, `${readonly}|${selectedIds.length}|${selectedGeomType}|${touch}`)

  if (readonly) return null

  const hasSelection = selectedFeatureId !== null || selectedIds.length > 0
  const isPolygonSelected = selectedGeomType === 'Polygon' || selectedGeomType === 'MultiPolygon'
  const isMultiGeometry = selectedGeomType === 'MultiPoint' || selectedGeomType === 'MultiPolygon' || selectedGeomType === 'MultiLineString' || selectedGeomType === 'GeometryCollection'

  // Visibility rules (issue #8): per-geometry filter + hide-when-disabled, so
  // the toolbar shows only actions that apply to the current selection.
  // - Transform: meaningful only when scaling/rotating makes sense — i.e. NOT
  //   on a single Point (a point has no extent). Multi-Point and any
  //   multi-feature selection still get Transform.
  // - Polygon-only group: cut hole, slice.
  // - Shape group (polygons and lines, `canProcessShape`): simplify, smooth, buffer.
  // - Break apart: only when the selection is a single Multi*/GC feature.
  // - Merge: only when ≥2 features are selected.
  // - Duplicate / Delete are always shown when there is a selection.
  const isSinglePoint = selectedIds.length === 1 && selectedGeomType === 'Point'
  const showTransform = hasSelection && !isSinglePoint
  const showPolygonGroup = isPolygonSelected
  const showShapeGroup = canProcessShape(selectedGeomType)
  // A finger has no double-click / Enter: "Edit points" says point editing exists (a second tap
  // on the selected shape enters it too). Lines and areas only, as for double-click.
  const showEditPoints = touch && selectedFeatureId !== null && (selectedGeomType === 'LineString' || selectedGeomType === 'Polygon')
  const showBreakApart = isMultiGeometry
  const showMerge = selectedIds.length >= 2
  const showCombineGroup = showBreakApart || showMerge

  function handleDuplicate() {
    if (selectedIds.length === 0) return
    if (!dataStore.getState().duplicateSelection()) return
    if (selectedIds.length === 1) {
      const f = dataStore.getState().features.find(x => x.id === selectedIds[0])
      emit({ type: 'feature:duplicated', featureId: selectedIds[0], label: String(f?.properties.name || 'feature') })
    } else {
      emit({ type: 'features:duplicated', count: selectedIds.length })
    }
  }

  function handleBreak() {
    if (!selectedFeatureId || !isMultiGeometry) return
    const feature = dataStore.getState().features.find(f => f.id === selectedFeatureId)
    if (!feature) return
    const count = getPartCount(feature.geometry)
    if (!dataStore.getState().breakMultiGeometry(selectedFeatureId)) return
    emit({ type: 'feature:broken', featureId: selectedFeatureId, count, undo: () => dataStore.getState().undo() })
  }

  function handleMerge() {
    if (selectedIds.length < 2) return
    dataStore.getState().mergeFeatures()
    emit({ type: 'success', message: `Merged ${selectedIds.length} features` })
  }

  function handleDelete() {
    if (selectedIds.length === 0) return
    const count = selectedIds.length
    const feature = count === 1 ? dataStore.getState().features.find((f) => f.id === selectedIds[0]) : null
    const name = count === 1 ? String(feature?.properties.name || 'Unnamed feature') : `${count} features`

    dataStore.getState().deleteSelection()
    closeDialog()
    if (count === 1) {
      emit({ type: 'feature:deleted', featureId: selectedIds[0], label: name, undo: () => dataStore.getState().undo() })
    } else {
      emit({ type: 'features:deleted', count, undo: () => dataStore.getState().undo() })
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 max-w-full pointer-events-none">
      {/* Contextual Feature Tools */}
      {hasSelection && (
        <div ref={barRef} className="flex flex-wrap items-center justify-center gap-2 max-w-full bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-2 py-2 pointer-events-auto antialiased">
          {showEditPoints && (
            <EditToolbarBtn
              label="Edit points"
              onClick={() => {
                if (editingMode !== 'none') setEditingMode('none')
                setVertexEditFeature(vertexEditFeatureId === selectedFeatureId ? null : selectedFeatureId)
              }}
              active={vertexEditFeatureId === selectedFeatureId}
            >
              <BezierCurve size={24} />
            </EditToolbarBtn>
          )}
          {showTransform && (
            <EditToolbarBtn
              label="Transform"
              shortcut={<KbdDark>{getKey('toggle-transform').toUpperCase()}</KbdDark>}
              shortcutId="toggle-transform"
              onClick={() => {
                setTransformActive(!transformActive)
                if (!transformActive && editingMode !== 'none') setEditingMode('none')
              }}
              active={transformActive}
            >
              <Resize size={24} />
            </EditToolbarBtn>
          )}

          {showTransform && (showShapeGroup || showCombineGroup) && <RowDivider />}

          {/* Polygon-only geometry tools */}
          {showPolygonGroup && (
            <>
              <EditToolbarBtn
                label="Cut hole"
                shortcut={<KbdDark>{getKey('cut-hole').toUpperCase()}</KbdDark>}
              shortcutId="cut-hole"
                onClick={() => {
                  setEditingMode(editingMode === 'cut-hole' ? 'none' : 'cut-hole')
                  if (transformActive) setTransformActive(false)
                }}
                active={editingMode === 'cut-hole'}
              >
                <Scissors size={24} />
              </EditToolbarBtn>
              <EditToolbarBtn
                label="Slice shape"
                shortcut={<KbdDark>{getKey('slice-shape').toUpperCase()}</KbdDark>}
              shortcutId="slice-shape"
                onClick={() => {
                  setEditingMode(editingMode === 'slice-shape' ? 'none' : 'slice-shape')
                  if (transformActive) setTransformActive(false)
                }}
                active={editingMode === 'slice-shape'}
              >
                <Knife size={24} />
              </EditToolbarBtn>
            </>
          )}

          {/* Simplify / Smooth / Buffer: polygons and lines */}
          {showShapeGroup && (
            <>
              <EditToolbarBtn
                label="Simplify shape"
                onClick={() => {
                  setEditingMode(editingMode === 'simplify-shape' ? 'none' : 'simplify-shape')
                  if (transformActive) setTransformActive(false)
                }}
                active={editingMode === 'simplify-shape'}
              >
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={editingMode === 'simplify-shape' ? 1.5 : 1} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2.5,8 5.25,3.5 8,8 10.75,12.5 13.5,8" />
                </svg>
              </EditToolbarBtn>
              <EditToolbarBtn
                label="Smooth shape"
                onClick={() => {
                  setEditingMode(editingMode === 'smooth-shape' ? 'none' : 'smooth-shape')
                  if (transformActive) setTransformActive(false)
                }}
                active={editingMode === 'smooth-shape'}
              >
                <WaveSine size={24} />
              </EditToolbarBtn>
              <EditToolbarBtn
                label="Buffer"
                onClick={() => {
                  setEditingMode(editingMode === 'buffer-shape' ? 'none' : 'buffer-shape')
                  if (transformActive) setTransformActive(false)
                }}
                active={editingMode === 'buffer-shape'}
              >
                <SquareLogo size={24} />
              </EditToolbarBtn>
            </>
          )}

          {showShapeGroup && showCombineGroup && <RowDivider />}

          {showBreakApart && (
            <EditToolbarBtn
              label="Break apart"
              shortcut={<KbdDark>{getKey('break-apart').toUpperCase()}</KbdDark>}
              shortcutId="break-apart"
              onClick={handleBreak}
            >
              <Shapes size={24} />
            </EditToolbarBtn>
          )}
          {showMerge && (
            <EditToolbarBtn label="Merge" onClick={handleMerge}>
              <StackPlus size={24} />
            </EditToolbarBtn>
          )}

          {(showTransform || showShapeGroup || showCombineGroup) && <RowDivider />}

          {/* Duplicate / Delete — always shown when there is a selection */}
          <EditToolbarBtn
            label="Duplicate"
            shortcut={<><KbdDark>⌘</KbdDark><KbdDark>D</KbdDark></>}
            shortcutId="duplicate"
            onClick={handleDuplicate}
          >
            <CopySimple size={24} />
          </EditToolbarBtn>
          <EditToolbarBtn
            label="Delete"
            shortcut={<KbdDark>{getFixedShortcutDisplay('delete-selected')}</KbdDark>}
            shortcutId="delete-selected"
            onClick={handleDelete}
          >
            <Trash size={24} />
          </EditToolbarBtn>
        </div>
      )}

      {/* Boolean Operations (renders only when multi-selected) */}
      {selectedIds.length >= 2 && (
        <Suspense fallback={null}>
          <BooleanOperations />
        </Suspense>
      )}
    </div>
  )
}
