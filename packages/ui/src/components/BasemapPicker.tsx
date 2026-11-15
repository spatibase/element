import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { StackSimple } from '@phosphor-icons/react'
import { placeBox } from '@element-editor/core/internal'
import { IconButton, type IconButtonSize } from './ui/IconButton'
import type { TooltipSide } from './ui/Tooltip'
import { useAccentStyle } from '../hooks/useAccentStyle'
import { CONTEXT_MENU_MARKER_ATTR } from './ui/ContextMenu'

export interface BasemapPickerOption {
  id: string
  label: string
  /** Image URL, or two (shown side by side, e.g. light + dark for a theme-following option). */
  thumbnail?: string | [string, string]
}

export interface BasemapPickerProps {
  options: BasemapPickerOption[]
  value: string
  onChange: (id: string) => void
  /** Button label and the panel's accessible name. Default: 'Basemap'. */
  label?: string
  size?: IconButtonSize
  tooltipSide?: TooltipSide
}

const GAP = 8
// Arrow-key steps through the 3-column tile grid.
const ARROW_STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }

/**
 * Basemap switcher: an icon button that opens a panel of thumbnail tiles.
 * Engine-neutral: it applies nothing, the host reacts to `onChange`.
 * The panel opens away from the screen edge the button sits on and stays open until the user
 * closes it (the button again, or Escape); picking a basemap or using the map keeps it open.
 * Opening focuses the active tile (the panel is portalled to the end of <body>); Escape
 * returns focus to the button.
 */
export function BasemapPicker({ options, value, onChange, label = 'Basemap', size, tooltipSide }: BasemapPickerProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [dark, setDark] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const accentStyle = useAccentStyle()
  const placed = pos !== null

  useLayoutEffect(() => {
    // The anchor (and the tooltip wrapper inside it) are `display: contents` → no box; measure the button.
    const btn = anchorRef.current?.querySelector('button')?.getBoundingClientRect()
    const panel = panelRef.current
    if (!open || !btn || !panel) return
    const { width, height } = panel.getBoundingClientRect()
    const fromBottom = btn.top + btn.height / 2 > window.innerHeight / 2
    const fromRight = btn.left + btn.width / 2 > window.innerWidth / 2
    // Anchor on the button's edge nearest the screen centre; placeBox flips/clamps if it still overflows.
    setPos(placeBox(fromRight ? btn.right : btn.left, fromBottom ? btn.top : btn.bottom, width, height, {
      x: fromRight ? 'before' : 'after',
      y: fromBottom ? 'before' : 'after',
      gapY: GAP,
    }))
  }, [open, options.length])

  // Focus the active tile once the panel is placed (it is `visibility: hidden` until then).
  useEffect(() => {
    if (!open || !placed) return
    const panel = panelRef.current
    ;(panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>('button'))?.focus()
  }, [open, placed])

  // Escape belongs to the open picker. The portal carries CONTEXT_MENU_MARKER_ATTR so the
  // editor's earlier-registered window capture Escape handler (deselect) yields, like it
  // does for <ContextMenu>; stopImmediatePropagation keeps every later handler out.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      if (panelRef.current?.contains(document.activeElement)) anchorRef.current?.querySelector('button')?.focus()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open])

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[e.key]
    if (!step) return
    const tiles = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button'))
    const next = tiles[tiles.indexOf(document.activeElement as HTMLElement) + step]
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  const toggle = () => {
    setPos(null)
    setDark(anchorRef.current?.closest('[data-elm-theme]')?.getAttribute('data-elm-theme') === 'dark')
    setOpen((o) => !o)
  }

  return (
    <div ref={anchorRef} className="contents">
      <IconButton label={label} onClick={toggle} active={open} expanded={open} controls={open ? panelId : undefined} size={size} tooltipSide={tooltipSide}>
        <StackSimple size={24} />
      </IconButton>
      {open && createPortal(
        <div data-elm-portal data-elm-theme={dark ? 'dark' : 'light'} style={accentStyle} {...{ [CONTEXT_MENU_MARKER_ATTR]: '' }}>
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label={label}
            className="fixed z-[9999] w-80 max-h-[70vh] flex flex-col bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm antialiased"
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden' }}
          >
            <div className="grid grid-cols-3 gap-2 p-2 overflow-y-auto" onKeyDown={onGridKeyDown}>
              {options.map((o) => {
                const active = o.id === value
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={active}
                    aria-label={o.label}
                    onClick={() => onChange(o.id)}
                    className={`flex flex-col rounded-elm-card border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring ${
                      active
                        ? 'border-primary-500 ring-2 ring-primary-400/40 bg-primary-50 hover:bg-primary-100 dark:bg-primary-950/40 dark:hover:bg-primary-950/60'
                        : 'border-elm-border hover:border-(--elm-border-strong,var(--color-gray-400)) dark:hover:border-(--elm-border-strong,var(--color-gray-500)) bg-elm-surface hover:bg-elm-surface-hover'
                    }`}
                  >
                    {Array.isArray(o.thumbnail)
                      ? <div className="w-full h-12 flex rounded-t-elm-card overflow-hidden">{o.thumbnail.map((src) => <img key={src} src={src} alt="" className="w-1/2 h-full object-cover" loading="lazy" draggable={false} />)}</div>
                      : o.thumbnail
                        ? <img src={o.thumbnail} alt="" className="w-full h-12 object-cover rounded-t-elm-card" loading="lazy" draggable={false} />
                        : <div className="w-full h-12 rounded-t-elm-card bg-elm-surface-hover flex items-center justify-center text-elm-text-subtle"><StackSimple size={20} /></div>}
                    <div className={`text-[11px] leading-4 tracking-tight text-center px-0.5 py-1 truncate font-medium ${active ? 'text-primary-700 dark:text-primary-300' : 'text-(--elm-text-secondary,var(--color-gray-700)) dark:text-(--elm-text-secondary,var(--color-gray-200))'}`}>
                      {o.label}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
