import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAccentStyle } from '../hooks/useAccentStyle'
import { useTheme } from '../contexts/ThemeContext'
import ActiveDrawingToolbar from './ActiveDrawingToolbar'

/** Events the map would read as its own (a pan, a click that adds a point) if they reached it. */
const STOPPED = ['mousedown', 'touchstart', 'dblclick', 'contextmenu'] as const

const stopReact = (e: { stopPropagation: () => void }) => e.stopPropagation()

/**
 * The drawing hint bar for hosts that mount only the adapter's `ElementEditorControls`: portaled into
 * the map container (a positioned element inside the host's `[data-elm-theme]` root), bottom centre,
 * above the phone's home indicator. Its presses never reach the map, so tapping Done adds no point.
 * Same markup as the drop-in's bar (`ActiveDrawingToolbar`); the drop-in turns this one off.
 */
/**
 * `drawingBar` as the adapters take it: on/off, or `{ container }` to put the bar in a host element
 * (a slot under the map) instead of over the map. `container: null` = the slot isn't mounted yet: nothing shows.
 */
export type DrawingBarOption = boolean | { container?: HTMLElement | null }

export default function MapDrawingBar({ container: mapContainer, option = true }: { container: HTMLElement; option?: DrawingBarOption }) {
  const slot = typeof option === 'object' && option ? option.container : undefined
  const container = slot ?? mapContainer
  const inline = !!slot
  const shown = option !== false && slot !== null
  const ref = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  const style = useAccentStyle()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    // Not pointerdown / click: Element's touch detection and React's own delegated handlers need them.
    for (const t of STOPPED) el.addEventListener(t, stop)
    // Leaflet's own switch (what L.DomEvent.disableClickPropagation sets): the map ignores a `click` from inside.
    ;(el as HTMLElement & { _leaflet_disable_click?: boolean })._leaflet_disable_click = true
    return () => { for (const t of STOPPED) el.removeEventListener(t, stop) }
  }, [shown, container])

  if (!shown) return null

  return createPortal(
    <div
      ref={ref}
      data-elm-portal=""
      data-elm-theme={theme}
      data-elm-drawing-bar=""
      // React bubbles events through a portal to the host's own handlers up the tree: stop them here too.
      onClick={stopReact}
      onDoubleClick={stopReact}
      onMouseDown={stopReact}
      onTouchStart={stopReact}
      onContextMenu={stopReact}
      className={inline ? 'flex w-full justify-center' : 'absolute inset-x-0 z-[1000] flex justify-center pointer-events-none px-(--elm-drawing-bar-inset-x,1rem)'}
      // In a map: --elm-drawing-bar-bottom (public) lifts it, e.g. above a host control cluster; default is the editor's bottom stack + 16px.
      style={inline ? style : { ...style, bottom: 'calc(var(--elm-drawing-bar-bottom, var(--elm-bottom-stack-offset, 16px)) + env(safe-area-inset-bottom, 0px))' }}
    >
      <ActiveDrawingToolbar />
    </div>,
    container,
  )
}
