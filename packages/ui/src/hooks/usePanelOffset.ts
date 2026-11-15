import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { sidebarTakesSpace, NARROW_EDITOR_WIDTH } from '@element-editor/core/internal'
import { useGeoStore, useUIStore } from '../store/StoreContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'

/**
 * Publish the right-hand panels' width (open layers panel + docked GeoJSON
 * inspector; 0 while the table is fullscreen) as --elm-panel-offset on the
 * nearest Element root, so map controls under them (attribution) can clear
 * them in every host. Called by both panels; both write the same value from
 * the same store state, so whichever is mounted keeps it right. Layout effect:
 * lands in the same frame as the panels' own `right` transition starts.
 *
 * Also keeps uiStore `narrow` in step with the root's width (the editor's,
 * not the viewport's). A narrow editor's panels overlay the map, so they add
 * nothing to the offset.
 */
export function usePanelOffset(ref: RefObject<HTMLElement | null>, enabled = true) {
  const { uiStore } = useGeoStore()
  const layerList = useElementEditorConfig().ui.layerList
  const sidebarBeside = useUIStore(sidebarTakesSpace)
  const narrow = useUIStore((s) => s.narrow)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const codeDockWidth = useUIStore((s) => s.codeDockWidth)
  const tableFullscreen = useUIStore((s) => s.tableFullscreen)
  const offset = tableFullscreen || narrow ? 0 : (layerList && sidebarBeside ? sidebarWidth : 0) + codeDockWidth
  useLayoutEffect(() => {
    if (!enabled) return
    const host = ref.current?.closest('[data-elm-theme]') as HTMLElement | null
    if (!host) return
    host.style.setProperty('--elm-panel-offset', `${offset}px`)
    return () => { host.style.removeProperty('--elm-panel-offset') }
  }, [ref, enabled, offset])

  // Width → `narrow`. Read once before the first paint, then on resize (store
  // writes from the observer callback, never during render).
  useLayoutEffect(() => {
    if (!enabled) return
    const host = ref.current?.closest('[data-elm-theme]') as HTMLElement | null
    if (!host) return
    const check = () => {
      const w = host.clientWidth
      if (w > 0 && uiStore.getState().narrow !== w < NARROW_EDITOR_WIDTH) uiStore.getState().setNarrow(w < NARROW_EDITOR_WIDTH)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(host)
    return () => ro.disconnect()
  }, [ref, enabled, uiStore])
}
