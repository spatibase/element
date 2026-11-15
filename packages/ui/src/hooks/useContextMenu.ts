import { useState, useCallback } from 'react'

interface ContextMenuState<T> {
  x: number
  y: number
  data: T
}

export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null)

  const open = useCallback((x: number, y: number, data: T) => {
    setState({ x, y, data })
  }, [])

  const close = useCallback(() => setState(null), [])

  return { state, open, close }
}
