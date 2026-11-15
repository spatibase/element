import { useEffect, type RefObject } from 'react'

/**
 * Traps keyboard focus within a container element.
 * Tab and Shift+Tab cycle through focusable elements without leaving the container.
 * Automatically focuses the first focusable element on mount.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return

      const elements = getFocusableElements(container)
      if (elements.length === 0) return

      const first = elements[0]
      const last = elements[elements.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore focus to the previously focused element
      previouslyFocused?.focus()
    }
  }, [containerRef, enabled])
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
}
