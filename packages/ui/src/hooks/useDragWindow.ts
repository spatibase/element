import { useState, useRef, useCallback, useEffect } from 'react'
import { readPersisted, writePersisted } from '@element-editor/core'
import { startDragShield } from './dragShield'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'

interface Position { x: number; y: number }

const POS_VERSION = 1

function isPosition(x: unknown): x is Position {
  return !!x && typeof x === 'object' && typeof (x as Position).x === 'number' && typeof (x as Position).y === 'number'
}

function clamp(pos: Position): Position {
  return {
    x: Math.max(0, Math.min(window.innerWidth - 120, pos.x)),
    y: Math.max(0, Math.min(window.innerHeight - 60, pos.y)),
  }
}

export function useDragWindow(storageKey: string, defaultPos: Position) {
  const scope = useElementEditorConfig()
  const [pos, setPos] = useState<Position>(() => {
    const stored = readPersisted<Position>(storageKey, POS_VERSION, (raw) => (isPosition(raw) ? raw : null), scope)
    return stored ? clamp(stored) : defaultPos
  })

  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    function onResize() {
      setPos((current) => {
        const clamped = clamp(current)
        if (clamped.x === current.x && clamped.y === current.y) return current
        writePersisted(storageKey, POS_VERSION, clamped, scope)
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [storageKey, scope])

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const originX = posRef.current.x
    const originY = posRef.current.y

    const endShield = startDragShield('grabbing')

    // The window is the handle's nearest `position: fixed` ancestor. It's moved
    // straight in the DOM while dragging: a setPos per mousemove re-renders the
    // whole window in a later task, so it trailed the cursor by a frame or more.
    // React state catches up once, on mouseup (its style prop still holds the
    // start position until then, so a re-render mid-drag doesn't touch it).
    let win = e.currentTarget as HTMLElement | null
    while (win && getComputedStyle(win).position !== 'fixed') win = win.parentElement
    // Only the px value is swapped, so a window's own wrapper (SchemaModal's
    // `clamp(8px, Xpx, …)`) keeps applying while dragging.
    const leftTpl = win?.style.left ?? ''
    const topTpl = win?.style.top ?? ''

    function onMove(ev: MouseEvent) {
      const next = clamp({ x: originX + ev.clientX - startX, y: originY + ev.clientY - startY })
      posRef.current = next
      if (!win) { setPos(next); return }
      win.style.left = leftTpl.replace(`${originX}px`, `${next.x}px`)
      win.style.top = topTpl.replace(`${originY}px`, `${next.y}px`)
    }

    function onUp() {
      endShield()
      setPos(posRef.current)
      writePersisted(storageKey, POS_VERSION, posRef.current, scope)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [storageKey, scope])

  return { pos, onHandleMouseDown }
}
