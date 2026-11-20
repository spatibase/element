import { accentPalette, DEFAULT_FEATURE_COLOR, type GeoJSONFeature } from '@element-editor/core'
import { divIcon, Polygon as LeafletPolygon, Polyline as LeafletPolyline, type LeafletMouseEvent, type PathOptions } from 'leaflet'
import { createContext } from 'react'
import { useFeatureStyle, type FeatureStyleFn } from '../../contexts/FeatureStyleContext'
import { PIN_PATH } from '../../utils/pinPath'
import { SELECTED_FEATURE_CLASS } from '../../utils/selectedDrag'

// ─── Feature styles ───────────────────────────────────────────────────────────
//
// Every feature is drawn ONCE, by FeatureInteractionLayer: the same Leaflet path
// carries the unselected look, hover, selection and the event handlers. (There used
// to be a second, visible-only copy in FeatureLayer under an invisible hit overlay —
// 2 SVG paths per feature, all re-clipped and re-serialised on every moveend.)

export const IDLE_LINE: PathOptions = { color: DEFAULT_FEATURE_COLOR, weight: 3.5, opacity: 0.9 }
export const IDLE_POLY: PathOptions = { color: DEFAULT_FEATURE_COLOR, fillColor: DEFAULT_FEATURE_COLOR, weight: 2, opacity: 0.9, fillOpacity: 0.15 }
export const HOVER_POLY: PathOptions = { opacity: 1, fillOpacity: 0.28 }

/**
 * The integrator's `getFeatureStyle` over `featureColor` (the unselected look), composed
 * once per editor by FeatureInteractionLayer and provided through FeatureStyleContext.
 * `fillColor` falls back to `color`, as on MapLibre. Keep the result referentially stable:
 * every feature layer restyles when it changes.
 */
export function composeFeatureStyle(getFeatureStyle: FeatureStyleFn | undefined, featureColor: string | undefined): FeatureStyleFn | undefined {
  if (!getFeatureStyle && !featureColor) return undefined
  return (feature) => {
    const s = getFeatureStyle?.(feature)
    const color = s?.color ?? featureColor
    const fillColor = s?.fillColor ?? color
    if (!color && !fillColor) return s ?? undefined
    return { ...s, ...(color && { color }), ...(fillColor && { fillColor }) }
  }
}

/** This feature's custom (unselected) style, from the composed FeatureStyleContext. */
export function useCustomStyle(feature: GeoJSONFeature): PathOptions | undefined {
  return useFeatureStyle()?.(feature) ?? undefined
}

/** Pin colour from the custom style: fill first, then outline (like MapLibre's circle). */
export const pinColor = (custom: PathOptions | undefined) => custom?.fillColor ?? custom?.color

/** Unselected look: defaults + custom style + optional hover boost. */
export function idleStyle(base: PathOptions, custom: PathOptions | undefined, hover: PathOptions | null): PathOptions {
  return { ...base, ...custom, ...hover }
}

/** Selected / dragging look. Leaflet's setStyle merges, so keys a custom style set
 *  (dashArray, lineCap, …) are put back to Leaflet's defaults instead of leaking in. */
export function litStyle(custom: PathOptions | undefined, polygon: boolean, lit: PathOptions): PathOptions {
  if (!custom) return lit
  const defaults = ((polygon ? LeafletPolygon : LeafletPolyline).prototype as unknown as { options: Record<string, unknown> }).options
  const reset: Record<string, unknown> = {}
  for (const k of Object.keys(custom)) reset[k] = defaults[k]
  return { ...(reset as PathOptions), ...lit }
}

/** Accent palette for selected-feature Path styles (SVG attributes need concrete colours); provided once by FeatureInteractionLayer. */
export const AccentContext = createContext(accentPalette())

// ─── Context-menu helpers ─────────────────────────────────────────────────────

export type OpenFeatureCtxMenu = (args: { feature: GeoJSONFeature; x: number; y: number; requestPreciseCoords?: () => void }) => void

/** Build a Leaflet `contextmenu` handler that opens the shared feature context menu. */
export function makeContextMenuHandler(feature: GeoJSONFeature, readonly: boolean, open: OpenFeatureCtxMenu | undefined) {
  return (e: LeafletMouseEvent) => {
    e.originalEvent.preventDefault()
    e.originalEvent.stopPropagation()
    if (readonly || !open) return
    open({ feature, x: e.originalEvent.clientX, y: e.originalEvent.clientY })
  }
}

// ─── Pin marker icon ──────────────────────────────────────────────────────────

/** `idle`: the pin's custom colour (featureColor / getFeatureStyle), undefined = default. */
export function makePinIcon(selected: boolean, multiSelected = false, idle?: string) {
  // Selected pins take the accent; an uncoloured idle pin can take the hover tint (tintPin).
  const lit = multiSelected || selected
  const color = lit ? 'var(--color-primary-500)' : idle ?? DEFAULT_FEATURE_COLOR
  return divIcon({
    className: lit ? SELECTED_FEATURE_CLASS : '',
    html: `<div style="position:relative;width:20px;height:28px">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28" style="position:relative;z-index:1;display:block">
        <path d="${PIN_PATH}" fill-rule="evenodd"${!lit && color === DEFAULT_FEATURE_COLOR ? ' data-elm-plain="1"' : ''} style="fill:${color}"/>
      </svg>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
  })
}

/**
 * Hover tint: an uncoloured, unselected pin goes one step darker slate (a custom colour is kept,
 * like MapLibre). Set on the marker's existing element, never by swapping the icon: a swapped-in
 * element sits under the cursor without a mouseover, so it never gets the mouseout and the tint stuck.
 */
export function tintPin(layer: { getElement?: () => Element | undefined } | null | undefined, on: boolean) {
  const path = layer?.getElement?.()?.querySelector<SVGPathElement>('path[data-elm-plain]') // null for non-pin layers
  if (path) path.style.fill = on ? '#334155' : DEFAULT_FEATURE_COLOR
}

/** Unselected pin, one shared instance per colour, so idle markers never get a setIcon.
 *  Module-wide (shared by every editor), so capped: past 256 colours it starts over. */
const IDLE_PINS = new Map<string, ReturnType<typeof makePinIcon>>()
export function idlePin(color = DEFAULT_FEATURE_COLOR) {
  let icon = IDLE_PINS.get(color)
  if (!icon) {
    if (IDLE_PINS.size >= 256) IDLE_PINS.clear()
    IDLE_PINS.set(color, (icon = makePinIcon(false, false, color)))
  }
  return icon
}

export function makeDimmedPinIcon(color = DEFAULT_FEATURE_COLOR) {
  return divIcon({
    className: '',
    html: `<div style="position:relative;width:20px;height:28px;opacity:0.3">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28" style="display:block">
        <path d="${PIN_PATH}" fill-rule="evenodd" style="fill:${color}"/>
      </svg>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
  })
}
