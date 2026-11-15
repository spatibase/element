import { useRef, useEffect, useCallback, useState } from 'react'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'
import { readStorage, writeStorage } from '@element-editor/core'
import { createPortal } from 'react-dom'
import { useTheme } from '../../contexts/ThemeContext'
import { useDragWindow } from '../../hooks/useDragWindow'
import { useWindowFocus } from '../../hooks/useWindowFocus'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import FeatureSidePanel from './FeatureSidePanel'
import { useUIStore } from '../../store/StoreContext'
import type { DialogState } from '@element-editor/core'
import { CloseButton } from '../ui/CloseButton'
import { useAccentStyle } from '../../hooks/useAccentStyle'

const SIZE_KEY = 'elm_feature_win_size'

export default function FeatureEditModal({ dialogState }: { dialogState: Exclude<DialogState, { type: 'closed' }> }) {
  const { pos, onHandleMouseDown } = useDragWindow('elm_feature_win', { x: 80, y: 120 })
  const persistScope = useElementEditorConfig()
  const { zIndex, focus } = useWindowFocus()
  const closeDialog = useUIStore((s) => s.closeDialog)

  const [savedSize] = useState(() => {
    try { const r = readStorage(SIZE_KEY, persistScope); return r ? JSON.parse(r) as { w: number; h: number } : null } catch { return null }
  })

  const winRef = useRef<HTMLDivElement>(null)
  const saveSize = useCallback(() => {
    const el = winRef.current
    if (!el) return
    writeStorage(SIZE_KEY, JSON.stringify({ w: el.offsetWidth, h: el.offsetHeight }), persistScope)
  }, [persistScope])

  useEffect(() => {
    const el = winRef.current
    if (!el) return
    const ro = new ResizeObserver(saveSize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [saveSize])

  useFocusTrap(winRef)
  const accentStyle = useAccentStyle()
  const theme = useTheme()

  return createPortal(
    <div
      ref={winRef}
      data-elm-portal
      data-elm-theme={theme}
      onMouseDownCapture={focus}
      role="dialog"
      aria-label="Edit feature"
      className="absolute flex flex-col bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm-raised rounded-elm-window overflow-hidden"
      style={{
        ...accentStyle,
        left: pos.x,
        top: pos.y,
        zIndex,
        resize: 'both',
        overflow: 'hidden',
        minWidth: 280,
        minHeight: 200,
        width: savedSize?.w ?? 320,
        height: savedSize?.h ?? 600,
        maxWidth: '90%',
        maxHeight: '85%',
      }}
    >
      <div
        onMouseDown={onHandleMouseDown}
        className="flex items-center justify-between px-4 py-2 border-b border-elm-border flex-shrink-0 select-none bg-(--elm-surface-sunken,color-mix(in_oklab,var(--color-gray-50)_50%,transparent)) dark:bg-(--elm-surface-sunken,color-mix(in_oklab,var(--color-gray-800)_50%,transparent))"
        style={{ cursor: 'grab' }}
      >
        <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-900)) dark:text-(--elm-text,var(--color-gray-100))">Edit feature</span>
        <CloseButton onClick={closeDialog} label="Close editor" />
      </div>

      <div className="flex-1 overflow-hidden min-h-0 relative bg-elm-surface">
        <FeatureSidePanel dialogState={dialogState} />
      </div>
    </div>,
    document.body,
  )
}
