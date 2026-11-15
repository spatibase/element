import { SidebarSimple } from '@phosphor-icons/react'
import { useUIStore } from '../../store/StoreContext'
import { Tooltip } from '../ui/Tooltip'
import { panelHeaderIconBtn } from '../ui/panelHeader'
import { KbdDark } from '../ui/Kbd'
import { useShortcutConfig } from '../../contexts/ShortcutConfigContext'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'

/** Bare "hide layers panel" toggle for panel headers. Hidden in split layout (panel can't collapse). */
export function HideLayersToggle() {
  const setOpen = useUIStore((s) => s.setSidebarOpen)
  const isSplit = useUIStore((s) => s.layout === 'split')
  const cfg = useElementEditorConfig()
  const { getKey } = useShortcutConfig()
  if (isSplit) return null
  return (
    <Tooltip
      content="Hide layers"
      shortcut={cfg.ui.keyboardShortcuts.enabled ? <KbdDark>{getKey('toggle-sidebar').toUpperCase()}</KbdDark> : undefined}
      side="bottom"
    >
      <button
        aria-label="Collapse layers panel"
        data-elm-shortcut="toggle-sidebar"
        onClick={(e) => { setOpen(false); e.currentTarget.blur() }}
        className={`flex ${panelHeaderIconBtn}`}
      >
        <SidebarSimple size={16} mirrored />
      </button>
    </Tooltip>
  )
}
