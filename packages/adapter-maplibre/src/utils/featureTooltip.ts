/**
 * Cursor-following feature-name tooltip — port of the leaflet adapter's version,
 * minus the leaflet type signatures. A plain fixed-position DOM element follows
 * the cursor and shows the feature's display label (name / area / length).
 *
 * Drag-suppression: the tooltip is hidden whenever a drag gesture is armed or
 * in progress (ctrl/cmd/alt held over a feature, and through the entire drag).
 * The label adds cognitive load without helping the gesture.
 */
import type { GeoJSONFeature } from '@element-editor/core'
import { placeBox } from '@element-editor/core/internal'
import { featureLabel } from '@element-editor/ui'
import { applyRootTokens } from '@element-editor/ui/internal'
import { freshFeatureId } from './freshFeature'

// Lifecycle: the element and its window/document listeners exist only while a
// feature is bound (hovered); unbind (mouseout, FeatureInteractionLayer
// cleanup on unmount) tears both down so nothing lingers on the host page.
let _tooltipEl: HTMLDivElement | null = null
let _featureDragActive = false
let _boundFeatureId: string | null = null
let _lastX = 0
let _lastY = 0

type UIStoreLike = { getState: () => { showFeatureNameOnHover: boolean; vertexEditActive: boolean } }

function isModifierHeld(e: KeyboardEvent | MouseEvent) {
  return e.ctrlKey || e.metaKey || e.altKey
}

function onKeyDown(e: KeyboardEvent) {
  if (isModifierHeld(e) && _tooltipEl) _tooltipEl.style.display = 'none'
}

function onKeyUp(e: KeyboardEvent) {
  if (isModifierHeld(e)) return
  if (_featureDragActive) return
  if (_boundFeatureId && _tooltipEl && _tooltipEl.textContent) {
    _tooltipEl.style.display = ''
    moveTooltip(_lastX, _lastY)
  }
}

// Follow cursor globally so the tooltip tracks during map drag, but
// FORCE-HIDE it whenever the cursor leaves the maplibre canvas — the
// map's own `mouseout` event doesn't fire when the cursor moves from
// the canvas onto an overlay panel (data table, sidebar, toolbar) at
// higher z-index, so without this guard the tooltip would keep
// following the cursor across the panel. Position is still updated
// even when hidden so the tooltip doesn't flash at stale coords when
// a feature re-binds it.
function onMouseMove(ev: MouseEvent) {
  if (!_tooltipEl) return
  moveTooltip(ev.clientX, ev.clientY)
  const target = ev.target as Element | null
  const overMap = !!target?.closest('.maplibregl-canvas-container, .maplibregl-canvas')
  if (!overMap) _tooltipEl.style.display = 'none'
}

/** Track the cursor; when visible, sit centered above it, flipping/clamping so it is never cut off. */
function moveTooltip(x: number, y: number) {
  _lastX = x
  _lastY = y
  if (!_tooltipEl || _tooltipEl.style.display === 'none') return
  const { left, top } = placeBox(x, y, _tooltipEl.offsetWidth, _tooltipEl.offsetHeight, { x: 'center', y: 'before', gapY: 12 })
  _tooltipEl.style.left = left + 'px'
  _tooltipEl.style.top = top + 'px'
}

function getTooltipEl(): HTMLDivElement {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div')
    _tooltipEl.className = 'elm-feature-tooltip'
    _tooltipEl.style.cssText =
      'position:fixed;pointer-events:none;z-index:10000;display:none'
    document.body.appendChild(_tooltipEl)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousemove', onMouseMove, { passive: true })
  }
  return _tooltipEl
}

export function bindFeatureTooltip(
  feature: GeoJSONFeature,
  uiStore: UIStoreLike,
  originalEvent?: MouseEvent,
) {
  if (_featureDragActive) return
  const ui = uiStore.getState()
  // No name over the shape being reshaped; none over a feature just added under the
  // cursor either, until the cursor leaves it and comes back.
  if (!ui.showFeatureNameOnHover || ui.vertexEditActive || freshFeatureId() === feature.id) { unbindFeatureTooltip(); return }
  const label = featureLabel(feature)
  if (!label) return
  const el = getTooltipEl()
  el.textContent = label
  // A <body> element shared by every editor: it takes the hovered editor's design tokens.
  applyRootTokens(el, (originalEvent?.target as Element | null | undefined)?.closest?.('[data-elm-theme]'))
  _boundFeatureId = feature.id
  if (originalEvent) {
    moveTooltip(originalEvent.clientX, originalEvent.clientY)
  }
  if (originalEvent && isModifierHeld(originalEvent)) {
    el.style.display = 'none'
  } else {
    el.style.display = ''
    moveTooltip(_lastX, _lastY)
  }
}

/** Remove the element and every listener; the next bind recreates them. */
export function unbindFeatureTooltip() {
  _boundFeatureId = null
  if (!_tooltipEl) return
  _tooltipEl.remove()
  _tooltipEl = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('mousemove', onMouseMove)
}

/**
 * Call with `true` when a feature drag begins, `false` when it ends. While
 * active, `bindFeatureTooltip` is a no-op and any visible tooltip is hidden.
 */
export function setFeatureDragActive(active: boolean) {
  _featureDragActive = active
  if (active && _tooltipEl) _tooltipEl.style.display = 'none'
}
