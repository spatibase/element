import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { memo, useState, useEffect, useLayoutEffect, useRef, useCallback, Suspense } from 'react'
import type { ReactNode } from 'react'
import { SidebarSimple, FolderPlus } from '@phosphor-icons/react'
// Lazy: the list's drag-and-drop (+ redux) and virtualizer load in their own
// chunk, right after the panel's first render, instead of in the entry chunk.
import { FeatureList } from '../lazyParts'
import { NoFeaturesEmptyState } from '../ui/NoFeaturesEmptyState'
import FeatureSidePanel from './FeatureSidePanel'
import { HideLayersToggle } from './HideLayersToggle'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { usePanelOffset } from '../../hooks/usePanelOffset'
import { useEmit } from '../../contexts/EventContext'
import { Tooltip } from '../ui/Tooltip'
import { resizeEdgeLeft } from '../ui/resizeEdge'
import { panelHeaderIconBtn, panelHeaderBar } from '../ui/panelHeader'
import { IconButton } from '../ui/IconButton'
import { KbdDark } from '../ui/Kbd'
import { useShortcutConfig } from '../../contexts/ShortcutConfigContext'

// memo: the editor shell re-renders on every host render (inline props); the
// list only needs to when the stores it reads change.
export default /*#__PURE__*/ memo(function LayersPanel({ footer }: { footer?: ReactNode }) {
  const { dataStore } = useGeoStore()
  const emit = useEmit()
  const open = useUIStore((s) => s.sidebarOpen)
  const setOpen = useUIStore((s) => s.setSidebarOpen)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const codeDockWidth = useUIStore((s) => s.codeDockWidth)
  const readonly = useUIStore((s) => s.readonly)
  const layout = useUIStore((s) => s.layout)
  const { width, onHandleMouseDown } = useResizablePanel('elm_panel_width', 288, 200, 520)
  // In split layout the panel is permanently embedded in the bottom 1/3 —
  // it's not absolutely-positioned and the user can't collapse it. Skip
  // toggle UI and slide-out animation entirely.
  const isSplit = layout === 'split'
  const asideRef = useRef<HTMLElement>(null)
  usePanelOffset(asideRef)
  // Narrow editor (its own width, not the viewport's: it's often embedded;
  // usePanelOffset keeps `narrow` in step): the panel opens as an overlay on
  // top of the map, and it starts collapsed so a phone-width editor shows the
  // map first. Crossing into narrow later closes it too.
  const overlay = useUIStore((s) => s.narrow) && !isSplit
  const [instant, setInstant] = useState(false)
  const paintedRef = useRef(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => { paintedRef.current = true })
    return () => cancelAnimationFrame(id)
  }, [])
  useLayoutEffect(() => {
    if (!overlay) return
    // Before the first paint it collapses without the slide: never seen open.
    if (!paintedRef.current) setInstant(true)
    setOpen(false)
  }, [overlay, setOpen])
  useEffect(() => {
    if (!instant) return
    const id = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(id)
  }, [instant])

  const { getKey } = useShortcutConfig()
  const toggleShortcut = <KbdDark>{getKey('toggle-sidebar').toUpperCase()}</KbdDark>

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scrollRefCallback = useCallback((el: HTMLDivElement | null) => setScrollEl(el), [])

  // Layout effect, not during render: a store write while rendering re-renders the
  // other subscribers mid-render (React warns); this still lands before paint.
  useLayoutEffect(() => { setSidebarWidth(width) }, [width, setSidebarWidth])

  const dialogState = useUIStore((s) => s.dialogState)
  const isFormOpen = dialogState.type !== 'closed'

  const features = useDataStore((s) => s.features)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const deleteSelection = useDataStore((s) => s.deleteSelection)
  const clearSelection = useDataStore((s) => s.clearSelection)

  // Group autoFocus is a one-shot signal in uiStore — set by the New-group
  // button and the Cmd+G shortcut, cleared here after one render so the input
  // doesn't keep stealing focus.
  const autoFocusGroupId = useUIStore((s) => s.autoFocusGroupId)
  const setAutoFocusGroupId = useUIStore((s) => s.setAutoFocusGroupId)

  useEffect(() => {
    if (autoFocusGroupId) setAutoFocusGroupId(null)
  }, [autoFocusGroupId, setAutoFocusGroupId])

  function handleAddGroup() {
    const id = crypto.randomUUID()
    // New groups start empty — existing layers stay where they are.
    dataStore.setState((s) => ({
      groups: [...s.groups, { id, name: 'New group', collapsed: false }],
      lastModifiedAt: Date.now(),
    }))
    setAutoFocusGroupId(id)
  }

  const formKey =
    dialogState.type === 'edit' ? `edit-${dialogState.featureId}` : dialogState.type

  return (
    <>
      {/* Panel — in split layout it's a static block filling its parent flex
          slot; in panel layout it slides in from the right. It animates `right`
          (not transform) like the data table and docked inspector beside it, so
          all three move in the same layout pass and stay edge to edge. */}
      <aside
        ref={asideRef}
        data-elm-layers-panel=""
        className={isSplit ? 'h-full w-full' : overlay ? `absolute top-0 h-full z-[600] ${open ? 'shadow-elm-raised' : ''}` : 'absolute top-0 h-full z-10'}
        style={isSplit ? undefined : overlay
          // Overlay: never wider than the editor minus a strip of map to tap back to.
          ? { width: `min(${width}px, 100% - 48px)`, right: open ? 0 : `calc(-1 * min(${width}px, 100% - 48px))`, transition: instant ? 'none' : 'right 200ms ease' }
          : { width, right: open ? 0 : -width, transition: instant ? 'none' : 'right 200ms ease' }}
      >
        {/* "Open" toggle while collapsed — sticks out to the left of the
            off-screen panel at the top, level with the panel header where the
            "hide" toggle lives when open. Hidden in split layout. */}
        {!isSplit && !open && (
          <div className="absolute z-30" style={{ left: -64 - codeDockWidth, top: 16 }}>
            <IconButton label="Open layers panel" shortcutId="toggle-sidebar" tooltipContent="Show layers" shortcut={toggleShortcut} tooltipSide="bottom" onClick={() => setOpen(true)}>
              {/* Not mirrored: bar on the left = panel is gone, map fills the screen. */}
              <SidebarSimple size={24} />
            </IconButton>
          </div>
        )}

        {/* Panel body — overflow-hidden here so toggle button can stick out */}
        {/* Collapsed (off-screen): out of the tab order and the accessibility tree. */}
        <div inert={!isSplit && !open} className={`h-full flex flex-col overflow-hidden bg-elm-surface ${isSplit ? '' : 'border-l border-elm-border/80'}`}>
          {/* Resize handle — hidden in split layout (panel size controlled by parent). */}
          {!isSplit && (
            <div
              onMouseDown={onHandleMouseDown}
                className={resizeEdgeLeft}
              title="Drag to resize panel"
            />
          )}
          {isFormOpen && selectedIds.length < 2 ? (
            <FeatureSidePanel key={formKey} dialogState={dialogState} collapsible />
          ) : (
            <>
              <header className={`${panelHeaderBar} px-3`}>
                <div className="flex items-center justify-between h-6 w-full">
                  <div className="flex items-center gap-1.5">
                    {/* Hide toggle — bare icon left of the label. */}
                    <HideLayersToggle />
                    <span className="text-xs font-medium text-elm-text-secondary">Layers</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {!readonly && (
                      <Tooltip content="New group" side="bottom">
                        <button type="button" onClick={handleAddGroup} disabled={features.length === 0} className={`flex ${panelHeaderIconBtn}`} aria-label="New group">
                          <FolderPlus size={16} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </header>

              <div ref={scrollRefCallback} className="flex-1 overflow-y-auto min-h-0">
                <div className="px-3 py-3 flex flex-col gap-3 h-full">
                  {/* While the list's chunk loads: what the list itself shows for no layers. */}
                  <Suspense fallback={features.length === 0 ? <div className="h-full"><NoFeaturesEmptyState /></div> : null}>
                    <FeatureList autoFocusGroupId={autoFocusGroupId} scrollElement={scrollEl} />
                  </Suspense>
                </div>
              </div>
              {selectedIds.length >= 2 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-elm-surface-sunken border-t border-elm-border flex-shrink-0">
                  <span className="text-xs text-elm-text-secondary font-medium flex-1">
                    {selectedIds.length} selected
                  </span>
                  <button
                    onClick={clearSelection}
                    className="text-xs text-elm-text-secondary px-2 py-1 rounded-elm-control hover:bg-(--elm-surface-hover,var(--color-gray-200)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) transition-colors"
                  >
                    Clear
                  </button>
                  {!readonly && (
                    <button
                      onClick={() => {
                        const count = selectedIds.length
                        deleteSelection()
                        emit({ type: 'features:deleted', count, undo: () => dataStore.getState().undo() })
                      }}
                      className="text-xs text-elm-text-secondary px-2 py-1 rounded-elm-control hover:bg-(--elm-surface-hover,var(--color-gray-200)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) transition-colors"
                    >
                      Delete all
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {footer && (
            <div className="flex-shrink-0 border-t border-elm-border">
              {footer}
            </div>
          )}
        </div>
      </aside>
    </>
  )
})
