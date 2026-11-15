import { Tooltip, type TooltipSide } from './Tooltip'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'

export function EditToolbarBtn({
  label,
  shortcut,
  shortcutId,
  onClick,
  active,
  disabled,
  tooltipSide = 'top',
  children,
}: {
  label: string
  shortcut?: React.ReactNode
  /** Shortcut id (`data-elm-shortcut`): the key flashes this button pressed. */
  shortcutId?: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  tooltipSide?: TooltipSide
  children: React.ReactNode
}) {
  const cfg = useElementEditorConfig()
  const effectiveShortcut = cfg.ui.keyboardShortcuts.enabled ? shortcut : undefined
  return (
    <Tooltip content={label} shortcut={effectiveShortcut} side={tooltipSide}>
      <button
        aria-label={label}
        aria-pressed={active}
        data-elm-shortcut={shortcutId}
        onClick={(e) => { onClick(); e.currentTarget.blur() }}
        disabled={disabled}
        className={`p-1 rounded-elm-control flex items-center justify-center text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring
          active:scale-[0.95] disabled:cursor-not-allowed disabled:text-elm-text-disabled disabled:active:scale-100
          ${active
            ? 'bg-primary-50 dark:bg-white/10 hover:bg-primary-100 dark:hover:bg-white/15 disabled:hover:bg-primary-50 dark:disabled:hover:bg-white/10 text-primary-600 dark:text-primary-400'
            : 'text-elm-text hover:bg-elm-control-hover disabled:hover:bg-transparent'
          }`}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function ToolbarDivider() {
  return <div className="w-px h-5 bg-elm-border mx-0.5 flex-shrink-0" />
}
