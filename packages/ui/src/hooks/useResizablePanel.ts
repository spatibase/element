import { useState, useRef, useCallback } from 'react'
import { readStorage, writeStorage } from '@element-editor/core'
import { startDragShield } from './dragShield'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'

export function useResizablePanel(
  storageKey: string,
  defaultWidth: number,
  min: number,
  max: number,
) {
  const scope = useElementEditorConfig()
  const [width, setWidth] = useState<number>(() => {
    const n = parseInt(readStorage(storageKey, scope) ?? '', 10)
    return isNaN(n) ? defaultWidth : Math.max(min, Math.min(max, n))
  })

  // Keep a ref so onMove closure always reads the latest width
  const widthRef = useRef(width)
  widthRef.current = width

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widthRef.current

    const endShield = startDragShield('col-resize', e.currentTarget as HTMLElement)

    function onMove(ev: MouseEvent) {
      // Panel is right-anchored: moving handle left increases width
      const next = Math.max(min, Math.min(max, startWidth + (startX - ev.clientX)))
      widthRef.current = next
      setWidth(next)
    }

    function onUp() {
      endShield()
      writeStorage(storageKey, String(widthRef.current), scope)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [storageKey, min, max, scope])

  return { width, onHandleMouseDown }
}
