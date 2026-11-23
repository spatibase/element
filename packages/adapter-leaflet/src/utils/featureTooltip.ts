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
import { placeBox, tooltipAnchor, type TooltipAnchor } from '@element-editor/core/internal'
import { featureLabel, type ResolvedConfig } from '@element-editor/ui'
import { applyRootTokens } from '@element-editor/ui/internal'
import { claimFresh, setFreshFeature } from './freshFeature'
import { PIN_HEIGHT } from './pinPath'

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
// `placement: 'anchor'`: where the bound feature's tooltip sits (computed once per hover) and the
// map whose pan / zoom it follows. Null in cursor mode.
let _anchor: { spot: TooltipAnchor; map: L.Map } | null = null

/** What the tooltip needs from the editor under the cursor: its map and its `config.featureTooltip`. */
export interface FeatureTooltipHost {
  map: L.Map
  getOptions: () => ResolvedConfig['featureTooltip']
}
// Keyed by the editor's uiStore (one per editor), so two editors on one page can differ while
// they share the single <body> element.
const _hosts = new WeakMap<object, FeatureTooltipHost>()
const DEFAULT_OPTIONS: ResolvedConfig['featureTooltip'] = { enabled: true, placement: 'cursor' }

/** Register an editor's tooltip options; returns the cleanup. */
export function registerFeatureTooltipHost(uiStore: object, host: FeatureTooltipHost): () => void {
  _hosts.set(uiStore, host)
  return () => { if (_hosts.get(uiStore) === host) _hosts.delete(uiStore) }
}

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
    layoutTooltip()
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
  if (!_anchor) layoutTooltip() // anchored: only the map moving it
}

/** Anchor mode: the anchor on screen (client px) and the extra gap above it. */
function anchorPoint(a: NonNullable<typeof _anchor>): { x: number; y: number; gap: number } {
  const r = a.map.getContainer().getBoundingClientRect()
  const p = a.map.latLngToContainerPoint([a.spot.lngLat[1], a.spot.lngLat[0]])
  // A pin's anchor is its tip: sit above its head.
  const lift = a.spot.kind === 'point' ? PIN_HEIGHT : 0
  return { x: r.left + p.x, y: r.top + p.y - lift, gap: a.spot.kind === 'point' ? 6 : 8 }
}

/** Place the tooltip: on the cursor, or (anchor mode) on its anchor. Flips / clamps at the viewport edges. */
function layoutTooltip() {
  if (!_tooltipEl || _tooltipEl.style.display === 'none') return
  const at = _anchor ? anchorPoint(_anchor) : { x: _lastX, y: _lastY, gap: 12 }
  const { left, top } = placeBox(at.x, at.y, _tooltipEl.offsetWidth, _tooltipEl.offsetHeight, { x: 'center', y: 'before', gapY: at.gap })
  _tooltipEl.style.left = left + 'px'
  _tooltipEl.style.top = top + 'px'
}

const MAP_EVENTS = 'move zoom zoomend moveend resize viewreset'
function setAnchor(a: typeof _anchor) {
  _anchor?.map.off(MAP_EVENTS, layoutTooltip)
  _anchor = a
  _anchor?.map.on(MAP_EVENTS, layoutTooltip)
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
  setAnchor(null)
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
  latlng?: L.LatLng,
  originalEvent?: MouseEvent,
) {
  if (_featureDragActive) return
  const ui = uiStore.getState()
  // No name over the shape being reshaped; none over a feature just added under the
  // cursor either, until the cursor leaves it and comes back.
  const host = _hosts.get(uiStore)
  const opts = host?.getOptions() ?? DEFAULT_OPTIONS
  if (claimFresh(feature.id) || !opts.enabled || !ui.showFeatureNameOnHover || ui.vertexEditActive) { teardown(); return }
  // `content` returning undefined = the default label; null / '' = no tooltip for this feature.
  const custom = opts.content?.(feature)
  const label = custom === undefined ? featureLabel(feature) : custom
  if (!label) { teardown(); return }
  const el = getTooltipEl()
  el.textContent = label
  // A <body> element shared by every editor: it takes the hovered editor's design tokens.
  applyRootTokens(el, (originalEvent?.target as Element | null | undefined)?.closest?.('[data-elm-theme]'))
  _boundFeatureId = feature.id
  setBoundLayer(layer)
  const spot = host && opts.placement === 'anchor' ? tooltipAnchor(feature, latlng ? [latlng.lng, latlng.lat] : null) : null
  setAnchor(spot && host ? { spot, map: host.map } : null)
  if (originalEvent) {
    moveTooltip(originalEvent.clientX, originalEvent.clientY)
  }
  // If the modifier is already down when the mouse enters the feature,
  // don't show — the user is lining up a drag, not inspecting.
  if (originalEvent && isModifierHeld(originalEvent)) {
    el.style.display = 'none'
  } else {
    el.style.display = ''
    layoutTooltip()
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
