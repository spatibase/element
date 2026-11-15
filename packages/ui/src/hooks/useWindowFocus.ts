import { useCallback, useEffect, useState } from 'react'

// Shared counter so every floating window gets a unique, monotonically
// increasing z-index. Starts above the map control slots and floating toolbar
// (z-400 / z-500 in ElementEditor) so windows always cover buttons and bars;
// context menu (9999), tooltips and toasts stay above windows.
let topZ = 1000

export function useWindowFocus(isOpen: boolean = true) {
  const [zIndex, setZ] = useState<number>(() => {
    topZ += 1
    return topZ
  })

  // Bring to front whenever the window transitions to open.
  useEffect(() => {
    if (!isOpen) return
    topZ += 1
    setZ(topZ)
  }, [isOpen])

  const focus = useCallback(() => {
    setZ((current) => {
      if (current === topZ) return current
      topZ += 1
      return topZ
    })
  }, [])

  return { zIndex, focus }
}
