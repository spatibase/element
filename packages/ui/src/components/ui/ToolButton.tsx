import { clsx } from 'clsx'
import { Tooltip, type TooltipSide } from './Tooltip'
import { KbdDark } from './Kbd'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'

interface ToolButtonProps {
  active: boolean
  onClick: () => void
  label: string
  shortcut?: string
  /** Shortcut id (`data-elm-shortcut`): the key flashes this button pressed. */
  shortcutId?: string
  color?: 'blue' | 'emerald' | 'amber' | 'violet'
  /** Tooltip side. Omit to auto-pick from toolbar position/direction. */
  tooltipSide?: TooltipSide
  disabled?: boolean
  children: React.ReactNode
}

const activeClasses: Record<NonNullable<ToolButtonProps['color']>, string> = {
  blue: 'bg-primary-500 hover:bg-primary-600 disabled:hover:bg-primary-500 text-white shadow-sm',
  emerald: 'bg-emerald-500 hover:bg-emerald-600 disabled:hover:bg-emerald-500 text-white shadow-sm',
  amber: 'bg-amber-500 hover:bg-amber-600 disabled:hover:bg-amber-500 text-white shadow-sm',
  violet: 'bg-violet-500 hover:bg-violet-600 disabled:hover:bg-violet-500 text-white shadow-sm',
}

// Pick a tooltip side that points AWAY from the toolbar's body so the tooltip
// doesn't sit on top of neighbouring tool icons. Tooltip's auto-flip will
// further correct this if the chosen side overflows the viewport.
function defaultTooltipSide(
  position: ReturnType<typeof useElementEditorConfig>['toolbar']['position'],
  direction: 'horizontal' | 'vertical',
): TooltipSide {
  if (direction === 'vertical') {
    // Vertical column — tooltip must go sideways. Right for left-anchored,
    // left for right-anchored.
    if (position.endsWith('-right') || position.startsWith('right')) return 'left'
    return 'right'
  }
  // Horizontal row — tooltip goes vertically. Below for top-anchored,
  // above for bottom-anchored. Centre rows default below.
  if (position.startsWith('bottom')) return 'top'
  return 'bottom'
}

export function ToolButton({ active, onClick, label, shortcut, shortcutId, color = 'blue', tooltipSide, disabled, children }: ToolButtonProps) {
  const cfg = useElementEditorConfig()
  const showShortcut = cfg.ui.keyboardShortcuts.enabled && shortcut
  const side = tooltipSide ?? defaultTooltipSide(cfg.toolbar.position, cfg.toolbar.direction)
  return (
    <Tooltip content={label} shortcut={showShortcut && <KbdDark>{shortcut}</KbdDark>} side={side}>
      <button
        aria-label={label}
        data-elm-shortcut={shortcutId}
        onClick={(e) => { onClick(); e.currentTarget.blur() }}
        disabled={disabled}
        className={clsx(
          'p-1 text-sm rounded-elm-control flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring active:scale-[0.95] disabled:cursor-not-allowed disabled:text-elm-text-disabled disabled:active:scale-100',
          active ? activeClasses[color] : 'text-elm-text hover:bg-elm-control-hover disabled:hover:bg-transparent',
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function ToolbarDivider({ vertical }: { vertical?: boolean } = {}) {
  return vertical
    ? <div className="h-px w-5 bg-elm-border my-0.5 flex-shrink-0" />
    : <div className="w-px h-5 bg-elm-border mx-1 flex-shrink-0" />
}
