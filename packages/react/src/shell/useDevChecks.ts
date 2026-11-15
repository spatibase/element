import { useEffect, type RefObject } from 'react'
import { isDevBuild, warnOnce } from '@element-editor/core/internal'

/** A variable the stylesheet defines on every `[data-elm-theme="light"|"dark"]` root (ui/src/styles/shared.css). */
const CSS_PROBE = '--elm-row-hover'
/** Long enough for a stylesheet loaded with a lazy chunk (or a `<link>` still in flight) to apply. */
const CSS_GRACE_MS = 1500

/**
 * Development-only checks of the two classic "blank map" mistakes, run once after mount. Each
 * warns once (warnOnce) with what happened and the fix. Nothing runs in production builds.
 *
 * - The stylesheet isn't loaded: `@element-editor/react/style.css` (or `/leaflet/style.css`) was
 *   never imported, so the controls are unstyled and the map has no size rules.
 * - The editor has no height: it fills its parent, and a parent without an explicit height
 *   collapses to 0 px, so the map is invisible.
 */
export function useDevChecks(rootRef: RefObject<HTMLElement | null>, entry: 'maplibre' | 'leaflet') {
  useEffect(() => {
    if (!isDevBuild()) return
    const root = rootRef.current
    if (!root || typeof getComputedStyle !== 'function') return
    const css = entry === 'leaflet' ? '@element-editor/react/leaflet/style.css' : '@element-editor/react/style.css'
    // After layout: the first frame has the sizes of the host's layout.
    const frame = requestAnimationFrame(() => {
      // display: none (a hidden tab) has no box at all: nothing to say yet.
      if (!root.isConnected || root.getClientRects().length === 0) return
      const { width, height } = root.getBoundingClientRect()
      if (height === 0 || width === 0) {
        warnOnce('editor-zero-size', `<ElementEditor> is ${Math.round(width)}×${Math.round(height)} px, so the map is blank. `
          + 'It fills its parent element (width and height 100%): give the parent an explicit size, e.g. '
          + '<div style={{ height: 600 }}><ElementEditor /></div>, or a flex / grid layout that gives it one '
          + '(a parent with only `height: auto` collapses to 0).')
      }
    })
    const timer = setTimeout(() => {
      if (!root.isConnected) return
      if (getComputedStyle(root).getPropertyValue(CSS_PROBE).trim() === '') {
        warnOnce('editor-css-missing', `Element's stylesheet is not loaded, so the toolbar and panels are unstyled. `
          + `Import it once, near your app's entry point: import '${css}'`)
      }
    }, CSS_GRACE_MS)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [rootRef, entry])
}
