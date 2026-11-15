import { useCallback, useEffect, useRef } from 'react'
import { getLastPointer } from './lastPointer'

/**
 * Shared ctrl/cmd + alt drag-affordance cursor behaviour for hoverable
 * feature layers. While the user is hovering a feature and holds ctrl/cmd
 * (move) or alt (copy), the layer's DOM element shows the corresponding
 * drag cursor. Works for both SVG paths (Polyline, Polygon) and HTML
 * marker icons (Point).
 *
 * Returns `{ enter, leave }` to wire into Leaflet's `mouseover` / `mouseout`
 * handlers. `enter` takes the DOM element to style (usually
 * `(e.target as L.Path).getElement()` or `(e.target as L.Marker).getElement()`)
 * and the Leaflet event's `originalEvent` so the cursor can be set
 * synchronously if the modifier is already held on enter.
 *
 * A global keydown/keyup listener updates the cursor live while the user
 * is still hovering, so pressing or releasing a modifier without moving
 * the mouse updates the cursor in place.
 */
// Accept any DOM node that exposes a writable `style` (HTMLElement, SVGElement).
// `L.Path#getElement()` is typed as `Element | undefined`, so we narrow at
// enter-time and ignore anything without a style object.
type Stylable = { style: CSSStyleDeclaration } & Element

function asStylable(el: Element | HTMLElement | SVGElement | null | undefined): Stylable | null {
  return el && 'style' in el ? (el as Stylable) : null
}

// One window keydown/keyup pair for all hook instances, fanning out to the
// currently-hovered ones. Per-instance listeners cost 2 addEventListener calls
// per feature on mount (~1 s for 5k features).
const hoveredKeyHandlers = new Set<(e: KeyboardEvent) => void>()
let keyListenerInstalled = false
function installKeyListener() {
  if (keyListenerInstalled || typeof window === 'undefined') return
  keyListenerInstalled = true
  const fire = (e: KeyboardEvent) => { for (const h of hoveredKeyHandlers) h(e) }
  window.addEventListener('keydown', fire)
  window.addEventListener('keyup', fire)
}

export function useModifierDragCursor(readonly: boolean) {
  const elRef = useRef<Stylable | null>(null)
  const hoveredRef = useRef(false)
  // Remember the cursor the element had before we overrode it, so releasing
  // the modifier while the tool keeps a custom cursor (e.g. 'crosshair' during
  // drawing) restores that cursor instead of wiping it. We capture both the
  // value and its priority so we can reinstate `!important` faithfully.
  const baseCursorRef = useRef<{ value: string; priority: string }>({ value: '', priority: '' })

  // Set the inline cursor with `!important` priority so it wins against the
  // `.leaflet-container.drawing-mode .leaflet-interactive { cursor: crosshair
  // !important; }` global rule in adapter-leaflet/src/index.css. Without this
  // the drawing-mode rule beats a normal inline cursor.
  function setCursor(el: Stylable, cursor: string, priority: 'important' | '' = 'important') {
    el.style.setProperty('cursor', cursor, priority)
  }

  const readonlyRef = useRef(readonly)
  readonlyRef.current = readonly
  // Stable per instance; only registered with the shared window listener while
  // this feature is hovered (one listener pair total instead of 2 per feature).
  const onKey = useRef((e: KeyboardEvent) => {
    if (readonlyRef.current || !hoveredRef.current) return
    const el = elRef.current
    if (!el) return
    const isCtrl = e.ctrlKey || e.metaKey
    const isAlt = e.altKey
    if (isCtrl || isAlt) {
      setCursor(el, isAlt ? 'copy' : 'move')
    } else {
      setCursor(el, baseCursorRef.current.value, baseCursorRef.current.priority as 'important' | '')
    }
  }).current
  useEffect(() => () => { hoveredKeyHandlers.delete(onKey) }, [onKey])

  const enter = useCallback((
    el: Element | HTMLElement | SVGElement | null | undefined,
    originalEvent?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  ) => {
    const stylable = asStylable(el)
    // Skip re-capturing baseCursor when the same element re-fires `mouseover`
    // while we're still in the hovered state. Leaflet emits a spurious second
    // mouseover after a Cmd-drag (marker follows the cursor, so mouseout never
    // fires; drag-end re-asserts hover). At that moment the inline cursor is
    // already our own 'move'/'copy' override — capturing it as the new base
    // would lock the cursor at that override on keyup.
    const isReEnter = stylable !== null && stylable === elRef.current && hoveredRef.current
    elRef.current = stylable
    hoveredRef.current = true
    installKeyListener()
    hoveredKeyHandlers.add(onKey)
    if (!isReEnter) {
      baseCursorRef.current = {
        value: stylable?.style.getPropertyValue('cursor') ?? '',
        priority: stylable?.style.getPropertyPriority('cursor') ?? '',
      }
    }
    const e = originalEvent
    if (stylable && e && (e.ctrlKey || e.metaKey || e.altKey)) {
      setCursor(stylable, e.altKey ? 'copy' : 'move')
    }
  }, [])

  const leave = useCallback(() => {
    hoveredRef.current = false
    hoveredKeyHandlers.delete(onKey)
    if (elRef.current) {
      setCursor(elRef.current, baseCursorRef.current.value, baseCursorRef.current.priority as 'important' | '')
      elRef.current = null
    }
    baseCursorRef.current = { value: '', priority: '' }
  }, [])

  /** Move a live hover to a new element: the feature's path switched between the
   *  idle canvas and SVG under a stationary cursor, so no mouseover will come. */
  const retarget = useCallback((el: Element | HTMLElement | SVGElement | null | undefined) => {
    if (!hoveredRef.current) return
    leave()
    enter(el, getLastPointer())
  }, [enter, leave])

  return { enter, leave, retarget }
}
