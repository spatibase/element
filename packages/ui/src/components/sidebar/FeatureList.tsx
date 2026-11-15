import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { clsx } from 'clsx'
import { createPortal } from 'react-dom'
import { DragDropContext, Droppable, Draggable, type DropResult, type DragStart, type DraggableChildrenFn } from '@hello-pangea/dnd'
import { useVirtualizer, observeElementOffset, elementScroll, type Virtualizer } from '@tanstack/react-virtual'
import type { GeoJSONFeature } from '@element-editor/core'
import { useMapController } from '../../contexts/MapControllerContext'
import { useJumpToFeature } from '../../hooks/useJumpToFeature'
import { getGeometryBBox } from '@element-editor/core'
import { isMultiGeometry, getPartCount, getPartBBox } from '@element-editor/core/internal'
import { NoFeaturesEmptyState } from '../ui/NoFeaturesEmptyState'
import FeatureRow from './FeatureRow'
import GroupRow from './GroupRow'
import PartSubRow from './PartSubRow'
import { FeatureRowContextMenu } from './FeatureRowContextMenu'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useAccentStyle } from '../../hooks/useAccentStyle'
import { useTheme } from '../../contexts/ThemeContext'
import { getVisualFeatureOrder, getTabbableFeatureIds } from '../../utils/layerOrder'

// Every row has a fixed height (FeatureRow and PartSubRow are h-9), so row
// sizes are computed, never measured: no measureElement, no ResizeObserver
// per row, no layout read per mounted row.
const ROW_HEIGHT = 36
/** border-b (1 px) + mt-1 (4 px) under an expanded multi-part feature. */
const PART_DIVIDER_HEIGHT = 5
const NO_FEATURES: GeoJSONFeature[] = []

type ScrollVirtualizer = Virtualizer<HTMLElement, Element>

// The virtualiser's defaults read layout synchronously when it mounts
// (offsetHeight of the scroll element in a layout effect). On a 5k load that
// forced a full-document layout in the middle of React's commit (about 280 ms).
// These versions get the same values from ResizeObserver callbacks, which run
// after layout, so nothing is forced.
function observeRectAsync(instance: ScrollVirtualizer, cb: (rect: { width: number; height: number }) => void) {
  const el = instance.scrollElement
  if (!el) return
  const ro = new ResizeObserver(([entry]) => {
    const box = entry.borderBoxSize?.[0]
    cb(box
      ? { width: Math.round(box.inlineSize), height: Math.round(box.blockSize) }
      : { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) })
  })
  ro.observe(el, { box: 'border-box' })
  return () => ro.disconnect()
}

function observeOffsetAsync(instance: ScrollVirtualizer, cb: (offset: number, isScrolling: boolean) => void) {
  const el = instance.scrollElement
  if (!el) return
  const unsub = observeElementOffset(instance, cb)
  // Several virtualisers share this scroll element, so one that mounts while
  // the list is scrolled must start from the real offset, not 0.
  const ro = new ResizeObserver(() => { ro.disconnect(); cb(el.scrollTop, false) })
  ro.observe(el)
  return () => { ro.disconnect(); unsub?.() }
}

function scrollUnlessNoop(offset: number, opts: { adjustments?: number; behavior?: ScrollBehavior }, instance: ScrollVirtualizer) {
  // On mount the virtualiser "scrolls" to its assumed offset (0). With a shared
  // scroll element that jumped the whole list to the top whenever a group's
  // list mounted.
  if (opts.adjustments === undefined && opts.behavior === undefined && offset === instance.scrollOffset) return
  elementScroll(offset, opts, instance)
}

// ── Virtual feature list within a single Droppable ──────────────────────────
function VirtualFeatureDroppable({
  droppableId,
  features,
  scrollElement,
  listElement,
  collapsed,
  expandedIds,
  renderItem,
  renderClone,
  scrollToId,
  showEmptyAffordance = true,
}: {
  droppableId: string
  features: GeoJSONFeature[]
  scrollElement: HTMLElement | null
  /** FeatureList's root: anything above this droppable that changes size resizes it. */
  listElement: HTMLElement | null
  collapsed?: boolean
  /** Expanded multi-part features (their row grows by one row per part). */
  expandedIds: ReadonlySet<string>
  renderItem: (f: GeoJSONFeature, index: number, isLast: boolean, prev?: GeoJSONFeature, next?: GeoJSONFeature) => React.ReactNode
  renderClone: DraggableChildrenFn
  scrollToId?: string | null
  /** When false, the empty droppable is silent — no pill, no border, just a
   *  zero-height drop target. Used for the top-level ungrouped zone where we
   *  still want drag-out support but no visible cue. */
  showEmptyAffordance?: boolean
}) {
  const count = collapsed ? 0 : features.length

  // Each group has its own virtualiser on the shared scroll element, so each
  // needs its list's offset in that element (scrollMargin). Without it every
  // group assumed it started at the top: scrolled into a big group the list
  // was blank, and scroll-to-selected landed in the wrong place. Read in a
  // ResizeObserver callback (layout is clean there); the list's offset can
  // only change when something above it resizes, which resizes listElement.
  const [ulEl, setUlEl] = useState<HTMLUListElement | null>(null)
  const dndInnerRef = useRef<((el: HTMLElement | null) => void) | null>(null)
  const ulRef = useCallback((el: HTMLUListElement | null) => { dndInnerRef.current?.(el); setUlEl(el) }, [])
  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    if (!ulEl || !scrollElement) return
    const ro = new ResizeObserver(() => {
      const top = ulEl.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top - scrollElement.clientTop + scrollElement.scrollTop
      setScrollMargin(Math.round(top))
    })
    ro.observe(ulEl)
    if (listElement) ro.observe(listElement)
    return () => ro.disconnect()
  }, [ulEl, listElement, scrollElement])

  // A new key function whenever the rows or their sizes change makes the
  // virtualiser recompute its measurements (it memoises on this identity).
  const getItemKey = useCallback((i: number) => features[i]?.id ?? i,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, expandedIds])
  const estimateSize = (i: number) => {
    const f = features[i]
    if (!f || !expandedIds.has(f.id) || !isMultiGeometry(f.geometry)) return ROW_HEIGHT
    return ROW_HEIGHT * (1 + getPartCount(f.geometry)) + (i < features.length - 1 ? PART_DIVIDER_HEIGHT : 0)
  }
  const virtualizer = useVirtualizer<HTMLElement, Element>({
    count,
    getScrollElement: () => scrollElement,
    estimateSize,
    overscan: 6,
    getItemKey,
    scrollMargin,
    initialRect: { width: 0, height: typeof window === 'undefined' ? 800 : window.innerHeight },
    observeElementRect: observeRectAsync,
    observeElementOffset: observeOffsetAsync,
    scrollToFn: scrollUnlessNoop,
  })

  // Scroll to selected feature when it (or its row index) changes. Keyed on the
  // index, not the features array, so unrelated edits don't re-trigger scrolling.
  const scrollIdx = scrollToId && !collapsed ? features.findIndex((f) => f.id === scrollToId) : -1
  useEffect(() => {
    if (scrollIdx < 0) return
    // Smooth only for nearby rows; animating across thousands of rows is slow
    // and renders every row on the way.
    const items = virtualizer.getVirtualItems()
    const near = items.length > 0 && scrollIdx > items[0].index - 50 && scrollIdx < items[items.length - 1].index + 50
    virtualizer.scrollToIndex(scrollIdx, { align: 'auto', behavior: near ? 'smooth' : 'auto' })
  }, [scrollIdx, virtualizer])

  return (
    <Droppable droppableId={droppableId} type="feature" mode="virtual" renderClone={renderClone}>
      {(provided, snapshot) => {
        dndInnerRef.current = provided.innerRef
        const isEmpty = !collapsed && features.length === 0
        const showPill = isEmpty && showEmptyAffordance
        const baseHeight = collapsed
          ? (snapshot.isDraggingOver ? 32 : 4)
          : isEmpty
            // Even without a visible pill, keep a row-tall transparent target
            // so hello-pangea-dnd can detect the drop reliably (4 px is too
            // small — the drag would snap back to the source group).
            ? (showEmptyAffordance ? 48 : ROW_HEIGHT)
            : virtualizer.getTotalSize() + (snapshot.isDraggingOver ? ROW_HEIGHT : 0)

        return (
          <ul
            ref={ulRef}
            {...provided.droppableProps}
            className="rounded-elm-control"
            style={{
              height: baseHeight,
              position: 'relative',
              // The empty-state drop zone has its own dashed border, so skip the
              // outer outline in that case to avoid a double border.
              background: snapshot.isDraggingOver && !isEmpty ? 'color-mix(in srgb, var(--color-primary-500) 8%, transparent)' : undefined,
              outline: snapshot.isDraggingOver && !isEmpty ? '1px dashed color-mix(in srgb, var(--color-primary-500) 40%, transparent)' : undefined,
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            {collapsed && snapshot.isDraggingOver && (
              <li style={{ listStyle: 'none' }} className="px-2 py-1.5 text-xs text-primary-400 italic">
                Drop here
              </li>
            )}
            {showPill && (
              <li
                style={{ listStyle: 'none' }}
                className={clsx(
                  'mx-1 my-1 h-9 flex items-center justify-center rounded-elm-control border border-dashed text-xs transition-colors',
                  snapshot.isDraggingOver
                    ? 'border-primary-400 text-primary-500 bg-primary-50/40 dark:bg-white/5'
                    : 'border-(--elm-border-strong,var(--color-gray-300)) dark:border-(--elm-border-strong,var(--color-gray-700)) text-elm-text-subtle',
                )}
              >
                {snapshot.isDraggingOver ? 'Drop here' : 'Drag here'}
              </li>
            )}
            {!collapsed && virtualizer.getVirtualItems().map((vRow) => {
              const f = features[vRow.index]
              if (!f) return null
              return (
                <div
                  key={f.id}
                  data-index={vRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vRow.start - scrollMargin}px)`,
                  }}
                >
                  {renderItem(f, vRow.index, vRow.index === features.length - 1, features[vRow.index - 1], features[vRow.index + 1])}
                </div>
              )
            })}
          </ul>
        )
      }}
    </Droppable>
  )
}

/** Combine the bboxes of a group of features into one [west, south, east, north]
 *  tuple suitable for fitBounds. Returns null if the group is empty. */
function combineBboxes(features: GeoJSONFeature[]): [number, number, number, number] | null {
  if (features.length === 0) return null
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  for (const f of features) {
    const b = f.bbox || getGeometryBBox(f.geometry)
    if (b[0] < west) west = b[0]
    if (b[1] < south) south = b[1]
    if (b[2] > east) east = b[2]
    if (b[3] > north) north = b[3]
  }
  return [west, south, east, north]
}

/** Stable (created once per FeatureList) row callbacks; all take the feature id. */
interface RowHandlers {
  onRowClick: (id: string) => void
  onRowSelectOnly: (id: string) => void
  onRowJump: (id: string) => void
  onEdit: (id: string) => void
  onToggleHidden: (id: string) => void
  onRename: (id: string, name: string) => void
  onMultiSelectToggle: (id: string) => void
  onRangeSelect: (id: string) => void
  onRenameEnd: (id: string) => void
  onRenameTab: (id: string, direction: 'next' | 'prev') => void
  onPartClick: (id: string, partIndex: number) => void
}

// One row (Draggable + FeatureRow + expanded part rows). Memoised on plain
// props so a selection change re-renders only the rows whose state changed,
// not every mounted row and its Draggable.
const FeatureItem = memo(function FeatureItem({
  feature: f,
  index,
  isLast,
  isSelected,
  isMultiSelected,
  isContextMenuActive,
  isGhosted,
  renameActive,
  isExpanded,
  selectedPartIndex,
  joinTop,
  joinBottom,
  h,
}: {
  feature: GeoJSONFeature
  index: number
  isLast: boolean
  isSelected: boolean
  isMultiSelected: boolean
  isContextMenuActive: boolean
  isGhosted: boolean
  renameActive: boolean
  isExpanded: boolean
  /** Only set for the selected feature. */
  selectedPartIndex: number | null
  /** Selected neighbour above / below: square off that edge so a selected run reads as one block. */
  joinTop: boolean
  joinBottom: boolean
  h: RowHandlers
}) {
  const id = f.id
  const onRenameEnd = useCallback(() => h.onRenameEnd(id), [h, id])
  const onRenameTab = useCallback((dir: 'next' | 'prev') => h.onRenameTab(id, dir), [h, id])
  const readonly = useUIStore((s) => s.readonly)
  return (
    <Draggable draggableId={id} index={index} isDragDisabled={readonly}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={{ outline: 'none', ...provided.draggableProps.style }}
        >
          <FeatureRow
            feature={f}
            isDragging={snapshot.isDragging}
            isSelected={isSelected}
            onRowClick={h.onRowClick}
            onRowSelectOnly={h.onRowSelectOnly}
            onRowJump={h.onRowJump}
            onEdit={h.onEdit}
            onToggleHidden={h.onToggleHidden}
            onRename={h.onRename}
            isMultiSelected={isMultiSelected}
            onMultiSelectToggle={h.onMultiSelectToggle}
            onRangeSelect={h.onRangeSelect}
            isContextMenuActive={isContextMenuActive}
            isGhosted={isGhosted}
            renameActive={renameActive}
            onRenameEnd={onRenameEnd}
            onRenameTab={onRenameTab}
            joinTop={joinTop}
            joinBottom={joinBottom}
          />
          {isExpanded && !snapshot.isDragging && (
            <>
              {Array.from({ length: getPartCount(f.geometry) }, (_, i) => (
                <PartSubRow
                  key={`${id}:${i}`}
                  geometry={f.geometry}
                  partIndex={i}
                  isSelected={selectedPartIndex === i}
                  onClick={() => h.onPartClick(id, i)}
                />
              ))}
              {!isLast && <div className="border-b border-elm-border mx-2 mt-1" />}
            </>
          )}
        </div>
      )}
    </Draggable>
  )
})

// ── Main FeatureList ────────────────────────────────────────────────────────
export default function FeatureList({
  autoFocusGroupId,
  scrollElement,
}: {
  autoFocusGroupId?: string | null
  scrollElement?: HTMLElement | null
}) {
  const { dataStore, uiStore } = useGeoStore()
  const readonly = useUIStore((s) => s.readonly)
  const features = useDataStore((s) => s.features)
  const groups = useDataStore((s) => s.groups)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const accentStyle = useAccentStyle()
  // Drag clones portal to <body>: they carry the editor's mode and design tokens themselves.
  const theme = useTheme()
  // One O(n) bucketing pass per features change instead of a filter per group per render.
  // Key null = ungrouped. Order within each bucket follows `features`.
  const featuresByGroup = useMemo(() => {
    const m = new Map<string | null, GeoJSONFeature[]>()
    for (const f of features) {
      const k = f.groupId || null
      const arr = m.get(k)
      if (arr) arr.push(f)
      else m.set(k, [f])
    }
    return m
  }, [features])
  const selectedFeatureId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedGroupId = useDataStore((s) => s.selectedGroupId)
  const selectGroup = useDataStore((s) => s.selectGroup)
  const selectFeature = useDataStore((s) => s.selectFeature)
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const setSelection = useDataStore((s) => s.setSelection)
  const updateGroup = useDataStore((s) => s.updateGroup)
  const deleteGroup = useDataStore((s) => s.deleteGroup)
  const toggleGroupCollapsed = useDataStore((s) => s.toggleGroupCollapsed)
  const moveFeatureToGroup = useDataStore((s) => s.moveFeatureToGroup)
  const reorderFeatures = useDataStore((s) => s.reorderFeatures)
  const reorderGroups = useDataStore((s) => s.reorderGroups)
  const toggleGroupHidden = useDataStore((s) => s.toggleGroupHidden)
  const openEditDialog = useUIStore((s) => s.openEditDialog)
  const { fitBounds } = useMapController()

  const updateFeature = useDataStore((s) => s.updateFeature)
  const toggleFeatureHidden = useDataStore((s) => s.toggleFeatureHidden)
  const selectedPartIndex = useUIStore((s) => s.selectedPartIndex)
  const setSelectedPartIndex = useUIStore((s) => s.setSelectedPartIndex)
  const [expandedMultiIds, setExpandedMultiIds] = useState<Set<string>>(() => new Set())
  const toggleExpanded = useCallback((id: string) => {
    setExpandedMultiIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const [dragActiveId, setDragActiveId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const lastClickedIdRef = useRef<string | null>(null)

  // Tab / Shift+Tab advances rename through the rendered rows (collapsed groups
  // skipped). Computed on the keypress so this callback, and the rows, stay
  // stable across feature edits.
  const advanceRename = useCallback((fromId: string, direction: 'next' | 'prev') => {
    const s = dataStore.getState()
    const tabbableIds = getTabbableFeatureIds(s.features, s.groups)
    const idx = tabbableIds.indexOf(fromId)
    if (idx < 0) { setRenamingId(null); return }
    const nextIdx = direction === 'next' ? idx + 1 : idx - 1
    if (nextIdx < 0 || nextIdx >= tabbableIds.length) { setRenamingId(null); return }
    setRenamingId(tabbableIds[nextIdx])
  }, [dataStore])

  const clearRenamingIfMatches = useCallback((id: string) => {
    setRenamingId((prev) => (prev === id ? null : prev))
  }, [])
  const featureCtxMenu = useContextMenu<GeoJSONFeature>()
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)

  const resolvedScrollElement = scrollElement ?? null

  // Native capture-phase listener — fires before dnd's drag-handle listeners,
  // so preventDefault reliably blocks the browser's context menu.
  useEffect(() => {
    const el = listEl
    if (!el) return
    const handler = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null
      while (target && target !== el) {
        const featureId = target.dataset.featureId
        if (featureId) {
          e.preventDefault()
          const feature = dataStore.getState().features.find((f) => f.id === featureId)
          if (feature) featureCtxMenu.open(e.clientX, e.clientY, feature)
          return
        }
        target = target.parentElement
      }
    }
    el.addEventListener('contextmenu', handler, { capture: true })
    return () => el.removeEventListener('contextmenu', handler, { capture: true })
  }, [featureCtxMenu.open, dataStore, listEl])

  // Features list changes often; grab it from the store on each call so the
  // handlers below can stay stable across re-renders.
  const handleRangeSelect = useCallback((targetId: string) => {
    // Anchor priority: current single-selected feature → last-clicked row.
    // Matches native file-manager semantics: shift+click range goes FROM
    // whatever's currently selected (including programmatic selection after
    // drawing) TO the target. Only use the stale `lastClickedIdRef` when there
    // is no unambiguous current selection (0 or 2+ selected).
    const s = dataStore.getState()
    const anchor = s.selectedIds.length === 1 ? s.selectedIds[0] : lastClickedIdRef.current
    lastClickedIdRef.current = targetId
    if (!anchor) { toggleSelection(targetId); return }
    const ids = getVisualFeatureOrder(s.features, s.groups)
    const anchorIdx = ids.indexOf(anchor)
    const targetIdx = ids.indexOf(targetId)
    if (anchorIdx === -1 || targetIdx === -1) { toggleSelection(targetId); return }
    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    setSelection(ids.slice(start, end + 1))
  }, [dataStore, toggleSelection, setSelection])

  const handleRename = useCallback((id: string, name: string) => {
    const f = dataStore.getState().features.find((x) => x.id === id)
    if (!f) return
    updateFeature(id, { properties: { ...f.properties, name } })
  }, [dataStore, updateFeature])

  // Just the map move — used by FeatureRow to defer the jump on plain clicks
  // of the layer name so a follow-up dblclick (rename) can cancel it.
  const jumpToFeature = useJumpToFeature()
  const handleRowJump = useCallback((id: string) => {
    const f = dataStore.getState().features.find((x) => x.id === id)
    if (f) jumpToFeature(f)
  }, [dataStore, jumpToFeature])

  // Selection-only path for FeatureRow's name click — keeps multi/range-select
  // flows working when the deferred jump hasn't fired yet.
  const handleRowSelectOnly = useCallback((id: string) => {
    const f = dataStore.getState().features.find((x) => x.id === id)
    if (!f) return
    lastClickedIdRef.current = id
    selectFeature(id)
    if (isMultiGeometry(f.geometry)) toggleExpanded(id)
  }, [dataStore, selectFeature, toggleExpanded])

  const handleRowClick = useCallback((id: string) => {
    handleRowSelectOnly(id)
    handleRowJump(id)
  }, [handleRowSelectOnly, handleRowJump])

  const handleMultiSelectToggle = useCallback((id: string) => {
    toggleSelection(id)
    lastClickedIdRef.current = id
  }, [toggleSelection])

  function onDragStart(start: DragStart) {
    setDragActiveId(start.draggableId)
  }

  function onDragEnd(result: DropResult) {
    const { source, destination, draggableId, type } = result
    setDragActiveId(null)
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    if (uiStore.getState().readonly) return
    // A drag (reorder and/or move between groups) is one undo step.
    dataStore.getState().takeSnapshot()

    // ── Group reorder ──
    if (type === 'group') {
      const reordered = [...groups]
      const [moved] = reordered.splice(source.index, 1)
      reordered.splice(destination.index, 0, moved)
      reorderGroups(reordered.map((g) => g.id))
      return
    }

    const srcId = source.droppableId
    const dstId = destination.droppableId

    if (srcId === dstId) {
      const scope = getScopeFeatures(srcId)
      const reordered = [...scope]
      const [moved] = reordered.splice(source.index, 1)
      reordered.splice(destination.index, 0, moved)
      applyScopeReorder(srcId, reordered.map((f) => f.id))
    } else {
      const newGroupId = dstId === 'ungrouped' ? null : dstId
      const isMultiDrag = selectedSet.has(draggableId) && selectedIds.length > 1
      const riders: string[] = isMultiDrag
        ? getScopeFeatures(srcId).filter((f) => selectedSet.has(f.id)).map((f) => f.id)
        : [draggableId]

      if (riders.length === 1) {
        moveFeatureToGroup(draggableId, newGroupId)
        const destScope = getScopeFeatures(dstId).filter((f) => f.id !== draggableId)
        destScope.splice(destination.index, 0, features.find((f) => f.id === draggableId)!)
        applyScopeReorder(dstId, destScope.map((f) => f.id), draggableId)
      } else {
        for (const id of riders) moveFeatureToGroup(id, newGroupId)
        applyMultiDragReorder(dstId, riders, destination.index)
      }
    }
  }

  function applyMultiDragReorder(dstId: string, riderIds: string[], destIndex: number) {
    const riderSet = new Set(riderIds)
    const riderFeatures = riderIds.map((id) => features.find((f) => f.id === id)!)
    const base = features.filter((f) => !riderSet.has(f.id))
    const isUngrouped = dstId === 'ungrouped'
    const destScopeItems = base.filter((f) => isUngrouped ? !f.groupId : f.groupId === dstId)
    let globalInsertAt: number
    if (destIndex < destScopeItems.length) {
      globalInsertAt = base.findIndex((f) => f.id === destScopeItems[destIndex].id)
    } else {
      const lastItem = destScopeItems[destScopeItems.length - 1]
      globalInsertAt = lastItem ? base.findIndex((f) => f.id === lastItem.id) + 1 : base.length
    }
    const final = [
      ...base.slice(0, globalInsertAt),
      ...riderFeatures,
      ...base.slice(globalInsertAt),
    ]
    reorderFeatures(final.map((f) => f.id))
  }

  function getScopeFeatures(droppableId: string): GeoJSONFeature[] {
    return featuresByGroup.get(droppableId === 'ungrouped' ? null : droppableId) ?? NO_FEATURES
  }

  function applyScopeReorder(_droppableId: string, scopeIds: string[], movedId?: string) {
    const scopeSet = new Set(scopeIds)
    const movedFeature = movedId ? features.find((f) => f.id === movedId) : null
    const base = features.filter((f) => f.id !== movedId)
    const baseWithoutScope = base.filter((f) => !scopeSet.has(f.id))
    const firstScopeItem = base.find((f) => scopeSet.has(f.id))
    const insertAt = firstScopeItem ? baseWithoutScope.findIndex((f) => f.id === firstScopeItem.id) : baseWithoutScope.length
    const scopeFeatures = scopeIds.map((id) =>
      id === movedId ? movedFeature! : features.find((f) => f.id === id)!
    )
    const final = [
      ...baseWithoutScope.slice(0, insertAt),
      ...scopeFeatures,
      ...baseWithoutScope.slice(insertAt),
    ]
    reorderFeatures(final.map((f) => f.id))
  }

  const ungrouped = featuresByGroup.get(null) ?? NO_FEATURES

  const dragRiderCount = (() => {
    if (!dragActiveId || !selectedSet.has(dragActiveId) || selectedIds.length <= 1) return 1
    const draggedFeature = features.find((f) => f.id === dragActiveId)
    const srcGroupId = draggedFeature?.groupId ?? null
    return features.filter((f) => selectedSet.has(f.id) && (f.groupId ?? null) === srcGroupId).length
  })()

  const ctxFeature = featureCtxMenu.state?.data ?? null

  const handlePartClick = useCallback((id: string, partIndex: number) => {
    const f = dataStore.getState().features.find((x) => x.id === id)
    if (!f) return
    selectFeature(id)
    setSelectedPartIndex(partIndex)
    fitBounds?.(getPartBBox(f.geometry, partIndex))
  }, [dataStore, selectFeature, setSelectedPartIndex, fitBounds])

  const rowHandlers: RowHandlers = useMemo(() => ({
    onRowClick: handleRowClick,
    onRowSelectOnly: handleRowSelectOnly,
    onRowJump: handleRowJump,
    onEdit: openEditDialog,
    onToggleHidden: toggleFeatureHidden,
    onRename: handleRename,
    onMultiSelectToggle: handleMultiSelectToggle,
    onRangeSelect: handleRangeSelect,
    onRenameEnd: clearRenamingIfMatches,
    onRenameTab: advanceRename,
    onPartClick: handlePartClick,
  }), [handleRowClick, handleRowSelectOnly, handleRowJump, openEditDialog, toggleFeatureHidden, handleRename,
    handleMultiSelectToggle, handleRangeSelect, clearRenamingIfMatches, advanceRename, handlePartClick])

  // ── renderClone: drag preview for virtual mode ──
  function makeRenderClone(featureList: GeoJSONFeature[]): DraggableChildrenFn {
    return (provided, _snapshot, rubric) => {
      const f = featureList[rubric.source.index]
      if (!f) return <div ref={provided.innerRef} {...provided.draggableProps} />
      return (
        <FeatureRow
          feature={f}
          innerRef={provided.innerRef}
          // The clone portals to <body>: data-elm-portal + the editor's mode + its design
          // tokens (accent included), so it looks like the row it was picked from.
          containerProps={{ ...provided.draggableProps, 'data-elm-portal': '', 'data-elm-theme': theme, style: { ...accentStyle, ...provided.draggableProps.style } } as unknown as Record<string, unknown>}
          dragHandleProps={provided.dragHandleProps as unknown as Record<string, unknown>}
          isDragging={true}
          isSelected={selectedSet.has(f.id)}
          dragCountBadge={dragRiderCount}
          onRowClick={() => {}}
          onEdit={() => {}}
          onToggleHidden={() => {}}
        />
      )
    }
  }

  // ── renderItem: renders a single feature row inside a Draggable ──
  // Highlighted as selected in the list (group selection shadows its features).
  const rowSelected = (g: GeoJSONFeature | undefined) =>
    !!g && !(g.groupId && selectedGroupId === g.groupId) && (g.id === selectedFeatureId || selectedSet.has(g.id))
  const rowExpanded = (g: GeoJSONFeature) => expandedMultiIds.has(g.id) && isMultiGeometry(g.geometry)

  function renderFeatureItem(f: GeoJSONFeature, index: number, isLast = false, prev?: GeoJSONFeature, next?: GeoJSONFeature) {
    const isExpanded = rowExpanded(f)
    const selfSelected = rowSelected(f)
    // Suppress per-feature highlighting when the feature's group is the
    // explicitly-selected one — keeps the visual selection on the group row only.
    const groupShadowed = !!f.groupId && selectedGroupId === f.groupId
    const isSelected = f.id === selectedFeatureId
    return (
      <FeatureItem
        key={f.id}
        feature={f}
        index={index}
        isLast={isLast}
        isSelected={!groupShadowed && isSelected}
        isMultiSelected={!groupShadowed && selectedSet.has(f.id)}
        isContextMenuActive={ctxFeature?.id === f.id}
        isGhosted={dragActiveId !== null && dragActiveId !== f.id && selectedSet.has(f.id) && selectedSet.has(dragActiveId)}
        renameActive={renamingId === f.id}
        isExpanded={isExpanded}
        selectedPartIndex={isSelected && isExpanded ? selectedPartIndex : null}
        joinTop={selfSelected && rowSelected(prev) && !rowExpanded(prev!)}
        joinBottom={selfSelected && rowSelected(next) && !isExpanded}
        h={rowHandlers}
      />
    )
  }

  const isEmpty = features.length === 0 && groups.length === 0

  return (
    <>
    {featureCtxMenu.state && ctxFeature && (
      <FeatureRowContextMenu
        x={featureCtxMenu.state.x}
        y={featureCtxMenu.state.y}
        feature={ctxFeature}
        onClose={featureCtxMenu.close}
      />
    )}
    <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div ref={setListEl} className={isEmpty ? 'h-full' : 'space-y-0.5'}>
        {isEmpty && <NoFeaturesEmptyState />}
        {/* ── Groups ── */}
        <Droppable droppableId="groups-container" type="group">
          {(groupDropProvided) => (
            <div ref={groupDropProvided.innerRef} {...groupDropProvided.droppableProps}>
              {groups.map((group, groupIndex) => {
                const groupFeatures = featuresByGroup.get(group.id) ?? NO_FEATURES
                // Group is selected when the user explicitly clicked its name
                // (or just created it via Cmd+G). Independent of selectedIds
                // so a single-feature group doesn't auto-select-its-group when
                // the user clicks the lone child feature.
                const groupSelected = selectedGroupId === group.id
                return (
                  <Draggable key={group.id} draggableId={`group:${group.id}`} index={groupIndex} isDragDisabled={readonly}>
                    {(groupDragProvided, groupDragSnapshot) => {
                      const groupNode = (
                        <div
                          ref={groupDragProvided.innerRef}
                          {...groupDragProvided.draggableProps}
                          // While dragging it portals to <body> (below): mode + design tokens come along.
                          {...(groupDragSnapshot.isDragging && { 'data-elm-portal': '', 'data-elm-theme': theme })}
                          style={{ outline: 'none', ...(groupDragSnapshot.isDragging && accentStyle), ...groupDragProvided.draggableProps.style }}
                        >
                          <GroupRow
                            group={group}
                            featureCount={groupFeatures.length}
                            autoFocus={group.id === autoFocusGroupId}
                            isSelected={groupSelected}
                            onToggleCollapse={() => toggleGroupCollapsed(group.id)}
                            onToggleHidden={() => toggleGroupHidden(group.id)}
                            onRename={(name) => updateGroup(group.id, { name })}
                            onDelete={(mode) => deleteGroup(group.id, mode)}
                            onSelect={() => {
                              if (groupFeatures.length === 0) {
                                // Empty group can still be "selected" so it
                                // visually highlights and Cmd+Backspace etc.
                                // could target it later.
                                setSelection([])
                                selectGroup(group.id)
                                return
                              }
                              // setSelection clears selectedGroupId — set it back
                              // afterwards so feature-level operations (delete,
                              // duplicate) still work on the members.
                              setSelection(groupFeatures.map((f) => f.id))
                              selectGroup(group.id)
                              const bbox = combineBboxes(groupFeatures)
                              if (bbox) fitBounds?.(bbox)
                            }}
                            dragHandleProps={groupDragProvided.dragHandleProps as unknown as Record<string, unknown>}
                            isDragging={groupDragSnapshot.isDragging}
                          />
                          {!groupDragSnapshot.isDragging && (
                            <VirtualFeatureDroppable
                              droppableId={group.id}
                              features={groupFeatures}
                              scrollElement={resolvedScrollElement}
              listElement={listEl}
              expandedIds={expandedMultiIds}
                              collapsed={group.collapsed}
                              renderItem={renderFeatureItem}
                              renderClone={makeRenderClone(groupFeatures)}
                              scrollToId={renamingId ?? selectedFeatureId}
                            />
                          )}
                          {!group.collapsed && (groupIndex < groups.length - 1 || groups.length > 0) && <div className="border-b border-elm-border mx-2 mt-1" />}
                        </div>
                      )
                      return groupDragSnapshot.isDragging ? createPortal(groupNode, document.body) : groupNode
                    }}
                  </Draggable>
                )
              })}
              {groupDropProvided.placeholder}
            </div>
          )}
        </Droppable>

        {/* ── Ungrouped features ──
            Always rendered when at least one group exists, even if empty, so
            users can drag a layer OUT of its group back to the top level.
            Without it the only top-level drop target is the group rows
            themselves, which makes "remove from group" via dnd impossible. */}
        {(ungrouped.length > 0 || groups.length > 0) && (
          <VirtualFeatureDroppable
            droppableId="ungrouped"
            features={ungrouped}
            scrollElement={resolvedScrollElement}
              listElement={listEl}
              expandedIds={expandedMultiIds}
            renderItem={renderFeatureItem}
            renderClone={makeRenderClone(ungrouped)}
            scrollToId={renamingId ?? selectedFeatureId}
            showEmptyAffordance={false}
          />
        )}

      </div>
    </DragDropContext>
    </>
  )
}
