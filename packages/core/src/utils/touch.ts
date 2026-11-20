/**
 * Touch input, decided per input event: a finger gets the touch behaviour, a mouse or pen gets
 * the mouse behaviour (a touch laptop gets both, whichever was used last). Nothing here changes
 * a mouse path: every caller gates on `isTouchEvent(e)` or `lastPointerWasTouch()`.
 */

/** Smallest hit area of a handle a finger has to hit (CSS px). The drawn handle can stay small. */
export const TOUCH_HIT_PX = 44

/** How long a finger rests on a handle before that counts as a long-press (ms). */
export const LONG_PRESS_MS = 500

/** How far (CSS px) a resting finger may drift and still be a long-press, not a drag. */
export const LONG_PRESS_SLOP_PX = 8

type PointerLike = { pointerType?: string; type?: string; sourceCapabilities?: { firesTouchEvents?: boolean } | null }

/**
 * True for an event a finger made: a pointer event with `pointerType: 'touch'`, a touch event, or a
 * mouse event the browser synthesised from a touch (`sourceCapabilities.firesTouchEvents`, Chromium).
 * A Leaflet / MapLibre wrapper event: pass its `originalEvent`.
 */
export function isTouchEvent(e: unknown): boolean {
  const ev = e as PointerLike | null | undefined
  if (!ev) return false
  if (ev.pointerType) return ev.pointerType === 'touch'
  if (ev.type && ev.type.startsWith('touch')) return true
  return ev.sourceCapabilities?.firesTouchEvents === true || lastTouchWithin(ev)
}

// A synthesised mouse event without sourceCapabilities (Safari, Firefox) right after a touch.
let lastTouchAt = 0
const lastTouchWithin = (ev: PointerLike) => ev.type?.startsWith('mouse') === true || ev.type === 'click' || ev.type === 'dblclick' || ev.type === 'contextmenu'
  ? Date.now() - lastTouchAt < 800
  : false

let lastWasTouch = false
const listeners = new Set<(touch: boolean) => void>()
function setLast(touch: boolean) {
  if (touch) lastTouchAt = Date.now()
  if (touch === lastWasTouch) return
  lastWasTouch = touch
  for (const l of listeners) l(touch)
}

if (typeof window !== 'undefined') {
  const onPointer = (e: PointerEvent) => setLast(e.pointerType === 'touch')
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  window.addEventListener('touchstart', () => setLast(true), { capture: true, passive: true })
  // A real mouse move (no touch just before) switches back to the mouse behaviour.
  window.addEventListener('mousemove', (e) => {
    if (!lastWasTouch || isTouchEvent(e)) return
    setLast(false)
  }, { capture: true, passive: true })
}

/** Whether the last pointer the user pressed with was a finger. */
export function lastPointerWasTouch(): boolean {
  return lastWasTouch
}

/** Calls `cb` whenever the last pointer switches between finger and mouse; returns the unsubscribe. */
export function subscribeLastPointer(cb: (touch: boolean) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * Long-press on one element for a finger: `onLongPress` runs when the finger rests `LONG_PRESS_MS`
 * without drifting more than `LONG_PRESS_SLOP_PX`. Returns the detach function. Mouse and pen
 * presses are ignored (they have right-click). `fired()` in a following click/up handler tells
 * whether that press was a long-press, so it can skip its own tap action.
 */
export function attachLongPress(el: HTMLElement, onLongPress: (e: PointerEvent) => void): { detach: () => void; fired: () => boolean } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number } | null = null
  let didFire = false
  const clear = () => { if (timer) clearTimeout(timer); timer = null; start = null }
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return
    didFire = false
    clear()
    start = { x: e.clientX, y: e.clientY }
    timer = setTimeout(() => { timer = null; didFire = true; onLongPress(e) }, LONG_PRESS_MS)
  }
  const move = (e: PointerEvent) => {
    if (!start || e.pointerType !== 'touch') return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) clear()
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', clear)
  el.addEventListener('pointercancel', clear)
  // The browser's own long-press menu (and text selection) would cover ours.
  const noNative = (e: Event) => { if (didFire || start) e.preventDefault() }
  el.addEventListener('contextmenu', noNative)
  // After a long-press the browser still sends the tap's compatibility mousedown / click, which
  // would close the menu that just opened (menus close on an outside mousedown). Cancel them.
  const end = (e: TouchEvent) => { if (didFire && e.cancelable) e.preventDefault() }
  el.addEventListener('touchend', end, { passive: false })
  return {
    detach: () => {
      clear()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', clear)
      el.removeEventListener('pointercancel', clear)
      el.removeEventListener('contextmenu', noNative)
      el.removeEventListener('touchend', end)
    },
    fired: () => {
      const f = didFire
      didFire = false
      return f
    },
  }
}

/**
 * CSS both adapters' point editors inject: while the last press was a finger (class `elm-touch`
 * on the map container), point and midpoint handles get an invisible 44 px hit area around the
 * small handle you see. Nothing changes for a mouse.
 */
export const TOUCH_HANDLE_CSS = [
  '.elm-touch .leaflet-marker-icon .elm-vertex{position:relative}',
  `.elm-touch .elm-vertex::before,.elm-touch .elm-midpoint-marker::before{content:"";position:absolute;left:50%;top:50%;width:${TOUCH_HIT_PX}px;height:${TOUCH_HIT_PX}px;transform:translate(-50%,-50%)}`,
].join('')
