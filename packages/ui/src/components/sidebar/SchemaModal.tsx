import { useRef, useCallback, useState, useEffect } from 'react'
import { useWindowEscape, WINDOW_ATTR } from '../../hooks/useWindowEscape'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'
import { readStorage, writeStorage } from '@element-editor/core'
import { createPortal } from 'react-dom'
import { CloseButton } from '../ui/CloseButton'
import { useDragWindow } from '../../hooks/useDragWindow'
import { startDragShield } from '../../hooks/dragShield'
import { useWindowFocus } from '../../hooks/useWindowFocus'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import SchemaEditor from './SchemaEditor'
import { useTheme } from '../../contexts/ThemeContext'
import { useAccentStyle } from '../../hooks/useAccentStyle'

interface SchemaModalProps {
  onClose: () => void
}

const SIZE_KEY = 'elm_schema_win_size'
// Two-pane editor (schema list + fields) needs ~450px; CSS caps it at 90vw on small screens.
const MIN_W = 450
const MIN_H = 200

export default function SchemaModal({ onClose }: SchemaModalProps) {
  const { pos, onHandleMouseDown } = useDragWindow('elm_schema_win', { x: 80, y: 120 })
  const persistScope = useElementEditorConfig()
  const { zIndex, focus } = useWindowFocus()
  const themeMode = useTheme()
  const accentStyle = useAccentStyle()
  const winRef = useRef<HTMLDivElement>(null)

  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const r = readStorage(SIZE_KEY, persistScope)
      return r ? JSON.parse(r) as { w: number; h: number } : { w: MIN_W, h: 520 }
    } catch { return { w: MIN_W, h: 520 } }
  })

  const saveSize = useCallback((w: number, h: number) => {
    writeStorage(SIZE_KEY, JSON.stringify({ w, h }), persistScope)
  }, [persistScope])

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h
    const endShield = startDragShield('se-resize')

    function onMove(ev: MouseEvent) {
      const newW = Math.max(MIN_W, Math.min(window.innerWidth * 0.9, startW + ev.clientX - startX))
      const newH = Math.max(MIN_H, Math.min(window.innerHeight * 0.85, startH + ev.clientY - startY))
      setSize({ w: newW, h: newH })
    }

    function onUp() {
      endShield()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const el = winRef.current
      if (el) saveSize(el.offsetWidth, el.offsetHeight)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useFocusTrap(winRef)
  useWindowEscape(winRef, true, onClose, zIndex)

  useEffect(() => { winRef.current?.focus() }, [])

  return createPortal(
    <div data-elm-theme={themeMode} style={accentStyle}>
      <div
        ref={winRef}
        {...{ [WINDOW_ATTR]: '' }}
        onMouseDownCapture={focus}
        role="dialog"
        aria-label="Schema editor"
        tabIndex={-1}
        className="fixed flex flex-col bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm-raised rounded-elm-window overflow-hidden outline-none"
        style={{
          // Clamp into the viewport so a saved/default position never pushes the window off-screen on narrow screens.
          left: `clamp(8px, ${pos.x}px, calc(100vw - min(${size.w}px, 90vw) - 8px))`,
          top: `clamp(8px, ${pos.y}px, calc(100vh - min(${size.h}px, 85vh) - 8px))`,
          zIndex,
          minWidth: `min(${MIN_W}px, 90vw)`,
          minHeight: MIN_H,
          width: size.w,
          height: size.h,
          maxWidth: '90vw',
          maxHeight: '85vh',
        }}
      >
        {/* Title bar */}
        <div
          onMouseDown={onHandleMouseDown}
          className="flex items-center justify-between px-4 py-3 border-b border-elm-border flex-shrink-0 select-none"
          style={{ cursor: 'grab' }}
        >
          <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-900)) dark:text-(--elm-text,var(--color-gray-100))">Schema</span>
          <CloseButton onClick={onClose} label="Close schema editor" />
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          <SchemaEditor containerRef={winRef} />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize select-none"
          style={{ zIndex: 10 }}
          aria-hidden
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 right-1 text-elm-text-disabled">
            <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </div>,
    document.body,
  )
}
