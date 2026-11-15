import { X } from '@phosphor-icons/react'
import { panelHeaderIconBtn } from './panelHeader'

interface CloseButtonProps {
  onClick: () => void
  label?: string
}

export function CloseButton({ onClick, label = 'Close' }: CloseButtonProps) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      aria-label={label}
      className={`flex ${panelHeaderIconBtn}`}
    >
      <X size={16} />
    </button>
  )
}
