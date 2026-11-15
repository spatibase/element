import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { useAccentStyle } from '../../hooks/useAccentStyle'

export interface ContextMenuAction {
  label: string
  icon?: React.ReactNode
  /** Optional shortcut hint shown right-aligned (e.g. a <KbdDark> element). */
  shortcut?: React.ReactNode
  onClick: () => void
  disabled?: boolean
}

export type ContextMenuItem = ContextMenuAction | { separator: true }

/**
 * Marker attribute set on every open <ContextMenu>. Other capture-phase ESC
 * handlers registered earlier than the menu's own listener won't see the
 * stopImmediatePropagation from ContextMenu (capture order = registration
 * order). Those handlers check for this attribute to yield the keypress.
 */
export const CONTEXT_MENU_MARKER_ATTR = 'data-elm-context-menu'

/** True if any <ContextMenu> is currently mounted. Pair with capture-phase ESC handlers. */
export function isContextMenuOpen(): boolean {
  return document.querySelector(`[${CONTEXT_MENU_MARKER_ATTR}]`) !== null
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // The menu portals to <body>, outside [data-elm-theme], so it can't inherit
  // the editor's theme. A hidden in-tree anchor reads it from the editor root;
  // the menu then carries its own data-elm-theme (dark: variants + neutral grey
  // remap + scoped preflight all apply).
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [dark, setDark] = useState(false)
  const accentStyle = useAccentStyle()
  useLayoutEffect(() => {
    setDark(anchorRef.current?.closest('[data-elm-theme]')?.getAttribute('data-elm-theme') === 'dark')
  }, [])

  // Measure real dimensions after first paint and clamp to viewport
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: x + width  > window.innerWidth  ? x - width  : x,
      top:  y + height > window.innerHeight ? y - height : y,
    })
  }, [x, y])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Capture phase + stopImmediatePropagation: ESC belongs to the menu
        // first. Without this, other global ESC handlers (e.g. clearSelection)
        // would also fire and the user would need two ESC presses.
        e.stopImmediatePropagation()
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey, { capture: true })
    }
  }, [onClose])

  return <>
    <span ref={anchorRef} hidden />
    {createPortal(
    <div
      ref={menuRef}
      data-elm-portal
      data-elm-theme={dark ? 'dark' : 'light'}
      // Stop mousedown at the container so the outside-click handler in callers
      // doesn't see a click outside before the item's onClick fires.
      onMouseDown={(e) => e.stopPropagation()}
      // Global marker: see CONTEXT_MENU_MARKER_ATTR / isContextMenuOpen().
      {...{ [CONTEXT_MENU_MARKER_ATTR]: '' }}
      style={{ ...accentStyle, position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
      // Same surface as the panels/toolbars. `elm-tooltip-light` flips KbdDark
      // shortcut hints to their light variant on the light surface.
      className={clsx(
        'elm-kbd-on-surface bg-elm-surface/95 backdrop-blur-md text-(--elm-text-secondary,var(--color-gray-700)) dark:text-(--elm-text-secondary,var(--color-gray-200)) rounded-elm shadow-elm py-1.5 min-w-[180px] border border-elm-border/80 select-none',
        !dark && 'elm-tooltip-light',
      )}
    >
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="my-1.5 border-t border-elm-border" />
        ) : (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); item.onClick(); onClose() }}
            disabled={item.disabled}
            className={clsx(
              // No colour transition: moving down the list should feel instant.
              'w-full text-left px-3 py-2 text-sm flex items-center gap-2.5',
              item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-elm-surface-hover hover:text-(--elm-text,var(--color-gray-900)) dark:hover:text-(--elm-text,var(--color-gray-50))',
            )}
          >
            {item.icon && <span className="flex-shrink-0 opacity-70">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="flex-shrink-0 ml-4 opacity-80">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>,
    document.body,
    )}
  </>
}
