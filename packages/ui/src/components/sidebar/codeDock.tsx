import { useLayoutEffect, useRef, useState } from 'react'
import { useUIStore } from '../../store/StoreContext'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { usePanelOffset } from '../../hooks/usePanelOffset'
import { withoutTransitions } from '../../hooks/dragShield'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'
import { readStorage } from '@element-editor/core'
import { sidebarTakesSpace } from '@element-editor/core/internal'

// The docked GeoJSON inspector's frame. Kept out of the lazy inspector chunk so
// the Suspense fallback can take the dock's place before CodeMirror arrives.

export const CODE_DOCKED_KEY = 'elm_code_docked'

/** The user's saved Dock/Undock choice wins; without one, the inspector opens docked. */
export function useInitialCodeDocked(): boolean {
  const cfg = useElementEditorConfig()
  const [docked] = useState(() => readStorage(CODE_DOCKED_KEY, cfg) !== '0')
  return docked
}

/**
 * Docked: the frame's width (resizable, saved) and position, published as
 * `codeDockWidth` so map slots, the toolbar and the data table clear it.
 * Layout effect + no transitions: they move in the same frame the dock
 * appears / disappears, not after a paint and then a 200 ms slide.
 */
export function useCodeDock(docked: boolean) {
  const cfg = useElementEditorConfig()
  const layout = useUIStore((s) => s.layout)
  const sidebarBeside = useUIStore(sidebarTakesSpace)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const tableFullscreen = useUIStore((s) => s.tableFullscreen)
  const setCodeDockWidth = useUIStore((s) => s.setCodeDockWidth)
  // Narrow editor: the dock covers the map (full width at most) instead of
  // squeezing it, so it takes no room from the controls.
  const narrow = useUIStore((s) => s.narrow)
  const dock = useResizablePanel('elm_code_dock_width', 420, 280, 900)

  useLayoutEffect(() => {
    if (!docked) return
    withoutTransitions(() => setCodeDockWidth(narrow ? 0 : dock.width))
    return () => withoutTransitions(() => setCodeDockWidth(0))
  }, [docked, narrow, dock.width, setCodeDockWidth])

  const panelVisible = cfg.ui.layerList && sidebarBeside
  return {
    ...dock,
    className: `absolute top-0 ${narrow ? 'z-[600] shadow-elm-raised' : 'z-10'} flex flex-col bg-elm-surface border-l border-elm-border/80 overflow-hidden ${tableFullscreen ? 'hidden' : ''}`,
    // Left of the layers panel, above split layout's bottom panel. Same
    // `right` transition as the panel and the data table: one mechanism
    // (layout) keeps them in lockstep; mixing it with a compositor
    // transform drifted and opened gaps.
    style: {
      right: panelVisible ? sidebarWidth : 0,
      bottom: layout === 'split' ? '33.33%' : 0,
      width: narrow ? `min(${dock.width}px, 100%)` : dock.width,
      transition: 'right 200ms ease',
    } as React.CSSProperties,
  }
}

/**
 * Suspense fallback for the inspector: an empty dock frame while its chunk
 * loads (nothing when it opens floating), so the controls clear the dock at
 * once instead of jumping when the inspector lands.
 */
export function GeoJSONDockPlaceholder() {
  const docked = useInitialCodeDocked()
  const frame = useCodeDock(docked)
  const ref = useRef<HTMLDivElement>(null)
  usePanelOffset(ref, docked)
  return docked ? <div ref={ref} aria-hidden="true" className={frame.className} style={frame.style} /> : null
}
