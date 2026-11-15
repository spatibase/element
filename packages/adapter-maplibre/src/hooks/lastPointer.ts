/**
 * Module-level pointer tracker. Parallel to `adapter-leaflet/src/hooks/lastPointer.ts`.
 * Used by `FeatureInteractionLayer` to synthesise a `mousemove` on MapLibre's
 * internal event pipeline when a new feature lands under a stationary cursor —
 * the user's mouse didn't move, so no hover hit-test fires on its own and
 * modifier-cursor affordances (Cmd/Alt) never activate on the fresh feature.
 *
 * Listeners are installed **eagerly at module load** (never lazily), so state
 * reflects every `mousemove` that happened before the first consumer runs.
 */
export type PointerState = {
  x: number
  y: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

let state: PointerState = { x: -1, y: -1, ctrlKey: false, metaKey: false, altKey: false }

if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    state = { x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }
  }, { capture: true, passive: true })
  const syncPos = (e: MouseEvent) => {
    state = { x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }
  }
  window.addEventListener('pointerdown', syncPos, { capture: true, passive: true })
  window.addEventListener('mousedown', syncPos, { capture: true, passive: true })
  const syncMods = (e: KeyboardEvent) => {
    state = { ...state, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }
  }
  window.addEventListener('keydown', syncMods, { capture: true })
  window.addEventListener('keyup', syncMods, { capture: true })
}

export function getLastPointer(): PointerState {
  return state
}
