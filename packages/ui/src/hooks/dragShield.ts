/**
 * Covers the page with a transparent layer for the length of a window drag or
 * resize, so the pointer passing over buttons doesn't hover them (tooltips) or
 * click them. Window-level mousemove / mouseup listeners still fire. Editor
 * transitions are off meanwhile, so whatever follows a resized panel (data
 * table, docked inspector, map slots) moves with it instead of 200 ms behind.
 * `handle` gets `data-dragging` meanwhile, so its indicator stays visible
 * (the shield takes its hover). Returns the cleanup to call on mouseup.
 */
const NO_TRANSITIONS = '[data-elm-theme],[data-elm-theme] *{transition:none!important}'

/**
 * Runs `fn` (a layout change) with editor transitions off until it has been
 * painted, so everything it moves jumps in the same frame instead of some
 * parts sliding 200 ms after others.
 */
export function withoutTransitions(fn: () => void) {
  const style = document.createElement('style')
  style.textContent = NO_TRANSITIONS
  document.head.appendChild(style)
  fn()
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()))
}

export function startDragShield(cursor: string, handle?: HTMLElement): () => void {
  handle?.setAttribute('data-dragging', '')
  const shield = document.createElement('div')
  shield.style.cssText = `position:fixed;inset:0;z-index:2147483647;cursor:${cursor}`
  document.body.appendChild(shield)
  const noTransitions = document.createElement('style')
  noTransitions.textContent = NO_TRANSITIONS
  document.head.appendChild(noTransitions)
  document.body.style.userSelect = 'none'
  return () => {
    handle?.removeAttribute('data-dragging')
    shield.remove()
    noTransitions.remove()
    document.body.style.userSelect = ''
  }
}
