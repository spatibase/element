/**
 * Cursor-following feature-name tooltip, shared across all feature layers.
 *
 * Leaflet's built-in bindTooltip adds focus/blur/click handlers that fight
 * with React re-renders (tooltip jumps to layer center on mousedown, or
 * disappears on map drag). This module renders a plain fixed-position DOM
 * element instead and bypasses all of that.
 *
 * Drag-suppression: the name tooltip is hidden whenever a drag gesture is
 * armed or in progress — i.e. while ctrl/cmd/alt is held over a feature,
 * and through the entire drag until mouseup. The label adds cognitive load
 * without helping the gesture; once the user has committed to a drag they
 * don't need to be told what they grabbed.
 */
import type L from 'leaflet'
import type { GeoJSONFeature } from '@element-editor/core'
import { placeBox } from '@element-editor/core/internal'
import { featureLabel } from '@element-editor/ui'
import { applyRootTokens } from '@element-editor/ui/internal'
import { claimFresh, setFreshFeature } from './freshFeature'

// Lifecycle: the element and its window/document listeners exist only while a
// feature is bound (hovered). Unbinding — mouseout, the bound layer being
// removed (feature deleted under the cursor, editor unmounted) — tears both
// down, so nothing lingers on the host page after the last editor is gone.
let _tooltipEl: HTMLDivElement | null = null
let _featureDragActive = false
let _boundFeatureId: string | null = null
let _boundLayer: L.Layer | null = null
let _lastX = 0
let _lastY = 0

type UIStoreLike = { getState: () => { showFeatureNameOnHover: boolean; vertexEditActive: boolean } }

function isModifierHeld(e: KeyboardEvent | MouseEvent) {
  return e.ctrlKey || e.metaKey || e.altKey
}

// Pressing a drag-modifier while hovering a feature should hide the name
// immediately (not wait for the first mousemove of the actual drag).
function onKeyDown(e: KeyboardEvent) {
  if (isModifierHeld(e) && _tooltipEl) _tooltipEl.style.display = 'none'
}

// Releasing the modifier restores the tooltip if we're still hovering a
// feature and no drag is running. Covers the "user tapped cmd to inspect"
// case — no lingering hidden state.
function onKeyUp(e: KeyboardEvent) {
  if (isModifierHeld(e)) return
  if (_featureDragActive) return
  if (_boundFeatureId && _tooltipEl && _tooltipEl.textContent) {
    _tooltipEl.style.display = ''
    moveTooltip(_lastX, _lastY)
  }
}

// Follow cursor globally so the tooltip tracks during map drag. Always
// update the position (even when hidden) so that when we restore the
// tooltip after a keyup or drag end, it doesn't flash at the stale
// coordinates from wherever it was last visible. ALSO force-hide the
// tooltip whenever the cursor leaves the leaflet container — Leaflet's
// own mouseout doesn't fire when the cursor moves from the map onto an
// overlay panel (data table, sidebar) sitting at higher z-index, so
// without this guard the tooltip would keep following the cursor over
// the panel.
function onMouseMove(ev: MouseEvent) {
  if (!_tooltipEl) return
  moveTooltip(ev.clientX, ev.clientY)
  const target = ev.target as Element | null
  if (!target?.closest('.leaflet-container')) _tooltipEl.style.display = 'none'
}

// The bound layer left the map. A re-render that swaps the hovered path for a
// new one (e.g. select moves it to the interaction layer) leaves an
// interactive element under the cursor, so keep the label; otherwise the
// feature is gone (deleted, editor unmounted) and the label must go too.
function onBoundLayerRemove(e: { target: L.Layer }) {
  requestAnimationFrame(() => {
    if (_boundLayer !== e.target) return
    // Removed and re-added in the same tick: the idle canvas <-> SVG swap on select.
    if ((e.target as unknown as { _map?: unknown })._map) return
    const under = document.elementFromPoint(_lastX, _lastY)
    if (!under?.closest('.leaflet-interactive')) teardown()
  })
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
    _tooltipEl.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;display:none'
    document.body.appendChild(_tooltipEl)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousemove', onMouseMove, { passive: true })
  }
  return _tooltipEl
}

function setBoundLayer(layer: L.Layer | null) {
  if (_boundLayer === layer) return
  _boundLayer?.off('remove', onBoundLayerRemove)
  _boundLayer = layer
  _boundLayer?.on('remove', onBoundLayerRemove)
}

/** Remove the element and every listener; the next bind recreates them. */
function teardown() {
  setBoundLayer(null)
  _boundFeatureId = null
  if (!_tooltipEl) return
  _tooltipEl.remove()
  _tooltipEl = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('mousemove', onMouseMove)
}

export function bindFeatureTooltip(
  layer: L.Layer,
  feature: GeoJSONFeature,
  uiStore: UIStoreLike,
  _latlng?: L.LatLng,
  originalEvent?: MouseEvent,
) {
  if (_featureDragActive) return
  const ui = uiStore.getState()
  // No name over the shape being reshaped; none over a feature just added under the
  // cursor either, until the cursor leaves it and comes back.
  if (claimFresh(feature.id) || !ui.showFeatureNameOnHover || ui.vertexEditActive) { teardown(); return }
  const label = featureLabel(feature)
  if (!label) return
  const el = getTooltipEl()
  el.textContent = label
  // A <body> element shared by every editor: it takes the hovered editor's design tokens.
  applyRootTokens(el, (originalEvent?.target as Element | null | undefined)?.closest?.('[data-elm-theme]'))
  _boundFeatureId = feature.id
  setBoundLayer(layer)
  if (originalEvent) {
    moveTooltip(originalEvent.clientX, originalEvent.clientY)
  }
  // If the modifier is already down when the mouse enters the feature,
  // don't show — the user is lining up a drag, not inspecting.
  if (originalEvent && isModifierHeld(originalEvent)) {
    el.style.display = 'none'
  } else {
    el.style.display = ''
    moveTooltip(_lastX, _lastY)
  }
}

/** `layer`: the cursor left that feature (its mouseout), which also ends a fresh
 *  feature's quiet hover. `null`: just hide (mode switch, features removed, ...). */
export function unbindFeatureTooltip(layer: L.Layer | null) {
  if (layer) setFreshFeature(null)
  teardown()
}

/**
 * Call with `true` when a ctrl/cmd/alt feature drag begins, `false` when it
 * ends. While active, `bindFeatureTooltip` is a no-op and any currently
 * visible tooltip is hidden immediately.
 */
export function setFeatureDragActive(active: boolean) {
  _featureDragActive = active
  if (active && _tooltipEl) _tooltipEl.style.display = 'none'
}
