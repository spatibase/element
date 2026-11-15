import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * Shared ctrl/cmd + alt drag-affordance cursor behaviour for hoverable
 * feature layers in MapLibre. While the user is hovering a feature and holds
 * ctrl/cmd (move) or alt (copy), the map canvas shows the corresponding drag
 * cursor.
 *
 * Returns `{ enter, leave }` to wire into `mouseenter` / `mouseleave` layer
 * events. Pass the map canvas (`map.getCanvas()`) on enter so the cursor can
 * be set synchronously if the modifier is already held on enter.
 *
 * A global keydown/keyup listener updates the cursor live while the user is
 * still hovering, so pressing or releasing a modifier without moving the
 * mouse updates the cursor in place.
 */
type Stylable = { style: CSSStyleDeclaration } & Element

function asStylable(el: Element | HTMLElement | null | undefined): Stylable | null {
  return el && 'style' in el ? (el as Stylable) : null
}

export function useModifierDragCursor(readonly: boolean) {
  const elRef = useRef<Stylable | null>(null)
  const hoveredRef = useRef(false)
  // Remember the cursor the canvas had before we overrode it, so releasing
  // the modifier while a tool keeps a custom cursor (e.g. 'crosshair' during
  // drawing) restores that cursor instead of wiping it. We capture both the
  // value and its priority so we can reinstate `!important` faithfully.
  const baseCursorRef = useRef<{ value: string; priority: string }>({ value: '', priority: '' })

  // Set the inline cursor with `!important` priority so it wins against any
  // global stylesheet that uses `!important` on cursor (mirrors adapter-leaflet
  // where `.drawing-mode .leaflet-interactive { cursor: crosshair !important }`
  // would otherwise trump a normal inline cursor).
  function setCursor(el: Stylable, cursor: string, priority: 'important' | '' = 'important') {
    el.style.setProperty('cursor', cursor, priority)
  }

  useEffect(() => {
    if (readonly) return
    function onKey(e: KeyboardEvent) {
      if (!hoveredRef.current) return
      const el = elRef.current
      if (!el) return
      const isCtrl = e.ctrlKey || e.metaKey
      const isAlt = e.altKey
      if (isCtrl || isAlt) {
        setCursor(el, isAlt ? 'copy' : 'move')
      } else {
        setCursor(el, baseCursorRef.current.value, baseCursorRef.current.priority as 'important' | '')
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [readonly])

  /**
   * `base`: the cursor to show without a modifier. Given, the hook owns the element's
   * cursor (writes `base` now, and on modifier release); `leave(next)` then writes
   * `next`. Omitted, it keeps whatever cursor the element had (a tool's crosshair) and
   * restores that on release / leave. Never set the cursor yourself and then call
   * `enter()` without `base`: your cursor becomes the "restore" value and sticks.
   */
  const enter = useCallback((
    el: Element | HTMLElement | null | undefined,
    originalEvent?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
    base?: string,
  ) => {
    const stylable = asStylable(el)
    // Skip re-capturing baseCursor when the same canvas re-fires hover while
    // we're still in the hovered state. After a Cmd-drag the canvas often
    // re-asserts hover without an intervening leave — at that moment the
    // inline cursor is our own 'move'/'copy' override, and capturing it as
    // the new base would lock the cursor at that override on keyup.
    const isReEnter = stylable !== null && stylable === elRef.current && hoveredRef.current
    elRef.current = stylable
    hoveredRef.current = true
    if (base !== undefined) {
      baseCursorRef.current = { value: base, priority: '' }
    } else if (!isReEnter) {
      baseCursorRef.current = {
        value: stylable?.style.getPropertyValue('cursor') ?? '',
        priority: stylable?.style.getPropertyPriority('cursor') ?? '',
      }
    }
    const e = originalEvent
    if (stylable && e && (e.ctrlKey || e.metaKey || e.altKey)) {
      setCursor(stylable, e.altKey ? 'copy' : 'move')
    } else if (stylable && base !== undefined) {
      setCursor(stylable, base, '')
    }
  }, [])

  /** `next`: the cursor to leave behind (see `enter`'s `base`); omitted, the one captured on enter. */
  const leave = useCallback((next?: string) => {
    hoveredRef.current = false
    if (elRef.current) {
      if (next !== undefined) setCursor(elRef.current, next, '')
      else setCursor(elRef.current, baseCursorRef.current.value, baseCursorRef.current.priority as 'important' | '')
      elRef.current = null
    }
    baseCursorRef.current = { value: '', priority: '' }
  }, [])

  // Stable: callers list it in effect deps.
  return useMemo(() => ({ enter, leave }), [enter, leave])
}
