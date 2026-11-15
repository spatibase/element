import type { ReactNode } from 'react'
import { useDataStore } from '../store/StoreContext'
import { useEmit } from '../contexts/EventContext'
import { ArrowArcLeft, ArrowArcRight } from '@phosphor-icons/react'
import { KbdDark } from './ui/Kbd'
import { IconButton, type IconButtonSize } from './ui/IconButton'
import type { TooltipSide } from './ui/Tooltip'

interface HistoryButtonProps {
  /** `'md'` map button, `'sm'` status bar, `'group'` inside a `ControlGroup`. Default `'md'`. */
  size?: IconButtonSize
  tooltipSide?: TooltipSide
}

export function UndoButton({ size, tooltipSide }: HistoryButtonProps) {
  const canUndo = useDataStore((s) => s.undoStack.length > 0)
  const undo = useDataStore((s) => s.undo)
  const emit = useEmit()
  return (
    <IconButton
      label="Undo"
      shortcutId="undo"
      shortcut={<span className="flex items-center gap-0.5"><KbdDark>⌘</KbdDark><KbdDark>Z</KbdDark></span>}
      onClick={() => { if (!canUndo) return; undo(); emit({ type: 'undo' }) }}
      disabled={!canUndo}
      size={size}
      tooltipSide={tooltipSide}
    >
      <ArrowArcLeft size={24} />
    </IconButton>
  )
}

export function RedoButton({ size, tooltipSide }: HistoryButtonProps) {
  const canRedo = useDataStore((s) => s.redoStack.length > 0)
  const redo = useDataStore((s) => s.redo)
  const emit = useEmit()
  return (
    <IconButton
      label="Redo"
      shortcutId="redo"
      shortcut={<span className="flex items-center gap-0.5"><KbdDark>⌘</KbdDark><KbdDark>⇧</KbdDark><KbdDark>Z</KbdDark></span>}
      onClick={() => { if (!canRedo) return; redo(); emit({ type: 'redo' }) }}
      disabled={!canRedo}
      size={size}
      tooltipSide={tooltipSide}
    >
      <ArrowArcRight size={24} />
    </IconButton>
  )
}

/** Joined pill surface for map controls (same look as the floating toolbar). Put `size="group"` buttons inside. */
export function ControlGroup({ direction = 'horizontal', children }: { direction?: 'horizontal' | 'vertical'; children: ReactNode }) {
  return (
    <div data-elm-group="" className={`flex bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm pointer-events-auto antialiased items-center gap-1 px-2 py-1.5 ${direction === 'vertical' ? 'flex-col' : 'flex-row'}`}>
      {children}
    </div>
  )
}

/** Undo + redo in one pill. `<ElementEditor>` places them via `config.ui.layout`; adapter users can drop this in. */
export default function UndoRedoToolbar({ direction = 'vertical' }: { direction?: 'horizontal' | 'vertical' }) {
  // Vertical stack sits flush against the left edge, so tooltips must open
  // rightward to stay on-screen and clear the buttons.
  const tooltipSide = direction === 'vertical' ? 'right' : 'top'
  return (
    <ControlGroup direction={direction}>
      <UndoButton size="group" tooltipSide={tooltipSide} />
      <RedoButton size="group" tooltipSide={tooltipSide} />
    </ControlGroup>
  )
}
