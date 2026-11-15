import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useGeoStore } from '../store/StoreContext'

/** Marks a floating window's root: the editor's global Escape handler leaves keys pressed inside it to the window. */
export const WINDOW_ATTR = 'data-elm-window'

type Entry = { z: () => number; close: () => void }
// Open windows per editor (keyed by its uiStore), for "Escape closes the top one".
const openWindows = new WeakMap<object, Set<Entry>>()

/**
 * Close the editor's topmost open floating window (keyboard shortcuts,
 * settings, schema). Called by the global Escape handler once there is
 * nothing else to cancel (no dialog, tool, edit or selection), so Escape
 * closes a window opened by its shortcut (K) without first clicking into it.
 * Returns whether one was closed.
 */
export function closeTopWindow(uiStore: object): boolean {
  const set = openWindows.get(uiStore)
  if (!set?.size) return false
  let top: Entry | null = null
  for (const e of set) if (!top || e.z() > top.z()) top = e
  top?.close()
  return !!top
}

/**
 * Escape + focus return for a floating window:
 * - Escape pressed inside the window closes it (unless something inside
 *   handled it first, e.g. a key-capture field or a rename input).
 * - While open it's registered for `closeTopWindow` (Escape from the map).
 * - On close, focus goes back to what had it when the window opened (the
 *   button or the map), if it was inside the window or nowhere.
 * Put `{...{ [WINDOW_ATTR]: '' }}` on the window root and pass its ref.
 * `topWindow: false` (a docked panel): Escape inside still closes it, but
 * Escape from the map doesn't.
 */
export function useWindowEscape(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  zIndex: number,
  { topWindow = true }: { topWindow?: boolean } = {},
) {
  const { uiStore } = useGeoStore()
  const closeRef = useRef(onClose)
  const zRef = useRef(zIndex)
  useLayoutEffect(() => {
    closeRef.current = onClose
    zRef.current = zIndex
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const entry: Entry = { z: () => zRef.current, close: () => closeRef.current() }
    let set = openWindows.get(uiStore)
    if (!set) openWindows.set(uiStore, (set = new Set()))
    if (topWindow) set.add(entry)
    const el = ref.current
    // On the document, bubble phase: React's handlers inside the window (a
    // rename input, key capture) run first and stop the event when Escape
    // was theirs.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || !el?.contains(e.target as Node)) return
      e.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      set.delete(entry)
      document.removeEventListener('keydown', onKey)
      // Focus was in the window (now gone) or nowhere: give it back.
      const active = document.activeElement
      const lost = !active || active === document.body || (el?.contains(active) ?? false) || !active.isConnected
      if (lost && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true })
    }
  }, [open, ref, uiStore, topWindow])
}
