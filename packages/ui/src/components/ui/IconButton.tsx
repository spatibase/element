import { cloneElement, isValidElement, type ReactNode } from 'react'
import { Tooltip, type TooltipSide } from './Tooltip'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'

interface IconButtonProps {
  label: string
  tooltipContent?: ReactNode
  shortcut?: ReactNode
  /** Shortcut id (`data-elm-shortcut`): the key flashes this button pressed. */
  shortcutId?: string
  tooltipSide?: TooltipSide
  onClick: () => void
  active?: boolean
  /**
   * Set for a button that opens a popover: announces `aria-expanded` (and
   * `aria-controls` = `controls`) instead of `aria-pressed`.
   */
  expanded?: boolean
  controls?: string
  disabled?: boolean
  /**
   * `'sm'`: flat 24px button with a 16px icon, for the status bar. `'group'`:
   * flat 32px button inside a joined pill (`ControlGroup`). Default `'md'`.
   */
  size?: IconButtonSize
  children: ReactNode
}

export type IconButtonSize = 'md' | 'sm' | 'group'

// Same look as EditToolbarBtn: a flat button inside a pill surface.
const groupClasses =
  'p-1 rounded-elm-control flex items-center justify-center text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring active:scale-[0.95] disabled:cursor-not-allowed disabled:active:scale-100'
const groupInactiveClasses =
  'text-elm-text hover:bg-elm-control-hover disabled:hover:bg-transparent'

// Flat ghost button for the status bar: no border/shadow/blur, neutral
// keyboard-only focus ring.
const smClasses =
  'flex items-center justify-center w-6 h-6 rounded-elm-control transition-colors bg-transparent hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-gray-200)_70%,transparent)) dark:hover:bg-(--elm-control-hover,var(--color-gray-800)) focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring disabled:cursor-not-allowed'

const baseClasses =
  'flex items-center justify-center w-12 h-12 backdrop-blur-md border border-elm-border/80 shadow-elm-control rounded-elm transition-colors active:scale-[0.95] focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring disabled:cursor-not-allowed disabled:active:scale-100'

// Same surface for every state; an open window/panel shows as a filled icon
// in the accent colour (below). Fill stays near-opaque (/95): these float over
// the map with backdrop-blur, and a translucent white/N would let the light
// basemap show through in dark mode.
const surfaceClasses =
  'bg-elm-surface/95 hover:bg-elm-surface-hover disabled:hover:bg-elm-surface/95'

// Disabled keeps the normal surface; only the icon greys out. Listed last so
// it overrides the hover text colours.
const disabledIconClasses = 'disabled:text-elm-text-disabled'

const activeIconClasses = 'text-primary-600 dark:text-primary-400'

const inactiveIconClasses = 'text-elm-text'

export function IconButton({
  label,
  tooltipContent,
  shortcut,
  shortcutId,
  tooltipSide = 'top',
  onClick,
  active,
  expanded,
  controls,
  disabled,
  size = 'md',
  children,
}: IconButtonProps) {
  const cfg = useElementEditorConfig()
  const effectiveShortcut = cfg.ui.keyboardShortcuts.enabled ? shortcut : undefined
  return (
    <Tooltip content={tooltipContent ?? label} shortcut={effectiveShortcut} side={tooltipSide}>
      <button
        aria-label={label}
        data-elm-shortcut={shortcutId}
        aria-pressed={expanded === undefined ? active : undefined}
        aria-expanded={expanded}
        aria-controls={controls}
        // A mouse click drops focus (no ring left behind); a keyboard press
        // (detail 0) keeps it, so a window it opens can hand focus back.
        onClick={(e) => { onClick(); if (e.detail > 0) e.currentTarget.blur() }}
        disabled={disabled}
        className={size === 'group'
          ? `${groupClasses} ${active ? activeIconClasses : groupInactiveClasses} ${disabledIconClasses}`
          : `${size === 'sm' ? smClasses : `${baseClasses} ${surfaceClasses}`} ${active ? activeIconClasses : inactiveIconClasses} ${disabledIconClasses}`}
      >
        {/* Active (its window/panel is open) → filled Phosphor icon; sm → 16px
            icon. Only icon components are cloned, never DOM elements. */}
        {isValidElement<{ weight?: string; size?: number }>(children) && typeof children.type !== 'string'
          ? cloneElement(children, { ...(active ? { weight: 'fill' } : {}), ...(size === 'sm' ? { size: 16 } : {}) })
          : children}
      </button>
    </Tooltip>
  )
}
