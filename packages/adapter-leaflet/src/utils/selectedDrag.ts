import { CLICK_SLOP_PX } from '@element-editor/core/internal'

// A plain drag (no modifier, mouse or one finger) that starts on an already-selected
// feature moves it, through the same code as a Cmd/Ctrl-drag (useFeatureDrag,
// usePartDrag, MultiDragHandler). Unselected features keep plain drag = pan.

type UIGate = {
  readonly: boolean
  editingMode: string
  vertexEditActive: boolean
  vertexEditFeatureId: string | null
  transformActive: boolean
}

/** No tool, no point editing (handles own drags there), no transform box (it moves on its own). */
export function canPlainDragSelected(ui: UIGate): boolean {
  return !ui.readonly && ui.editingMode === 'none' && !ui.vertexEditActive && !ui.vertexEditFeatureId && !ui.transformActive
}

/** On the map container while a plain drag on a selected feature is possible (move cursor, touch bridge). */
export const CAN_MOVE_SELECTED_CLASS = 'elm-can-move-selected'
/** On every selected feature's SVG path / pin element. */
export const SELECTED_FEATURE_CLASS = 'elm-selected-feature'
/** On the map container while a feature drag runs (grabbing cursor). */
export const MOVING_FEATURE_CLASS = 'elm-moving-feature'

// The layer's mousedown runs before the map's (MultiDragHandler): it marks a plain press
// on a selected feature so the multi-selection drag can take it.
const selectedPresses = new WeakSet<Event>()
export function markSelectedPress(ev: Event) { selectedPresses.add(ev) }
export function isSelectedPress(ev: Event) { return selectedPresses.has(ev) }

/** A plain press becomes a move only past the click slop, so a click (or a jittery tap) stays a click. */
export function pastSlop(start: { x: number; y: number }, ev: MouseEvent) {
  return Math.hypot(ev.clientX - start.x, ev.clientY - start.y) >= CLICK_SLOP_PX
}

/**
 * After a multi-selection drag the browser still fires a click on the feature that ended
 * up under the cursor; the layer would take it as "select only this one". Swallow that one
 * click (same spot, right after), not a later click elsewhere.
 */
export function swallowTrailingClick(container: HTMLElement, up: MouseEvent) {
  const until = performance.now() + 300
  const swallow = (e: MouseEvent) => {
    container.removeEventListener('click', swallow, true)
    if (performance.now() > until || Math.hypot(e.clientX - up.clientX, e.clientY - up.clientY) > CLICK_SLOP_PX) return
    e.stopPropagation()
  }
  container.addEventListener('click', swallow, true)
  setTimeout(() => container.removeEventListener('click', swallow, true), 300)
}

// The running feature drag's cancel (a second finger turns the gesture into a pinch).
let activeCancel: (() => void) | null = null
export function setActiveFeatureDrag(cancel: (() => void) | null) { activeCancel = cancel }
export function cancelActiveFeatureDrag() {
  const c = activeCancel
  activeCancel = null
  c?.()
}
