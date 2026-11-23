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
import type { Map as MapLibreMap } from 'maplibre-gl'
import { placeBox, tooltipAnchor, type TooltipAnchor } from '@element-editor/core/internal'
import { featureLabel, type ResolvedConfig } from '@element-editor/ui'
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
// `placement: 'anchor'`: where the bound feature's tooltip sits (computed once per hover) and the
// map whose pan / zoom it follows. Null in cursor mode.
let _anchor: { spot: TooltipAnchor; map: MapLibreMap; lift: number } | null = null

// A point's marker: the circle (radius 8, 9 hovered, 10 selected, plus a 1 px half stroke) or a text label.
const CIRCLE_TOP = 11
const TEXT_TOP = 12

/** What the tooltip needs from the editor under the cursor: its map and its `config.featureTooltip`. */
export interface FeatureTooltipHost {
  map: MapLibreMap
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

function onKeyDown(e: KeyboardEvent) {
  if (isModifierHeld(e) && _tooltipEl) _tooltipEl.style.display = 'none'
}

function onKeyUp(e: KeyboardEvent) {
  if (isModifierHeld(e)) return
  if (_featureDragActive) return
  if (_boundFeatureId && _tooltipEl && _tooltipEl.textContent) {
    _tooltipEl.style.display = ''
    layoutTooltip()
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
  if (!_anchor) layoutTooltip() // anchored: only the map moving it
}

/** Place the tooltip: on the cursor, or (anchor mode) on its anchor. Flips / clamps at the viewport edges. */
function layoutTooltip() {
  if (!_tooltipEl || _tooltipEl.style.display === 'none') return
  let at = { x: _lastX, y: _lastY, gap: 12 }
  if (_anchor) {
    const r = _anchor.map.getCanvas().getBoundingClientRect()
    const p = _anchor.map.project(_anchor.spot.lngLat)
    at = { x: r.left + p.x, y: r.top + p.y - _anchor.lift, gap: _anchor.spot.kind === 'point' ? 6 : 8 }
  }
  const { left, top } = placeBox(at.x, at.y, _tooltipEl.offsetWidth, _tooltipEl.offsetHeight, { x: 'center', y: 'before', gapY: at.gap })
  _tooltipEl.style.left = left + 'px'
  _tooltipEl.style.top = top + 'px'
}

function setAnchor(a: typeof _anchor) {
  _anchor?.map.off('move', layoutTooltip)
  _anchor?.map.off('resize', layoutTooltip)
  _anchor = a
  _anchor?.map.on('move', layoutTooltip)
  _anchor?.map.on('resize', layoutTooltip)
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
  /** Where the cursor hit the feature (lng, lat): picks the part of a multi-part feature to anchor to. */
  hit?: [number, number],
) {
  if (_featureDragActive) return
  const ui = uiStore.getState()
  // No name over the shape being reshaped; none over a feature just added under the
  // cursor either, until the cursor leaves it and comes back.
  const host = _hosts.get(uiStore)
  const opts = host?.getOptions() ?? DEFAULT_OPTIONS
  if (!opts.enabled || !ui.showFeatureNameOnHover || ui.vertexEditActive || freshFeatureId() === feature.id) { unbindFeatureTooltip(); return }
  // `content` returning undefined = the default label; null / '' = no tooltip for this feature.
  const custom = opts.content?.(feature)
  const label = custom === undefined ? featureLabel(feature) : custom
  if (!label) { unbindFeatureTooltip(); return }
  const el = getTooltipEl()
  el.textContent = label
  // A <body> element shared by every editor: it takes the hovered editor's design tokens.
  applyRootTokens(el, (originalEvent?.target as Element | null | undefined)?.closest?.('[data-elm-theme]'))
  _boundFeatureId = feature.id
  const spot = host && opts.placement === 'anchor' ? tooltipAnchor(feature, hit ?? null) : null
  if (spot && host) {
    const lift = spot.kind !== 'point' ? 0 : feature.properties?._isText === 'true' ? TEXT_TOP : CIRCLE_TOP
    setAnchor({ spot, map: host.map, lift })
  } else setAnchor(null)
  if (originalEvent) {
    moveTooltip(originalEvent.clientX, originalEvent.clientY)
  }
  if (originalEvent && isModifierHeld(originalEvent)) {
    el.style.display = 'none'
  } else {
    el.style.display = ''
    layoutTooltip()
  }
}

/** Remove the element and every listener; the next bind recreates them. */
export function unbindFeatureTooltip() {
  _boundFeatureId = null
  setAnchor(null)
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
