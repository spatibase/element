import { accentPalette, DEFAULT_FEATURE_COLOR, deriveStateColors, usesDerivedLook, SELECTED_WEIGHT_BOOST, type GeoJSONFeature, type SelectionStyle } from '@element-editor/core'
import { divIcon, Polygon as LeafletPolygon, Polyline as LeafletPolyline, type LeafletMouseEvent, type PathOptions } from 'leaflet'
import { createContext, useContext, useEffect, useMemo } from 'react'
import { useElementEditorConfig } from '@element-editor/ui'
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
  return (feature, state) => {
    const s = getFeatureStyle?.(feature, state)
    if (state?.selected || state?.hovered) return s ?? undefined // a state's own style: not the base colour
    const color = s?.color ?? featureColor
    const fillColor = s?.fillColor ?? color
    if (!color && !fillColor) return s ?? undefined
    return { ...s, ...(color && { color }), ...(fillColor && { fillColor }) }
  }
}

/** This feature's custom (unselected) style, from the composed FeatureStyleContext. */
export function useCustomStyle(feature: GeoJSONFeature): PathOptions | undefined {
  return useFeatureStyle()?.(feature, { selected: false, hovered: false }) ?? undefined
}

/** `config.selectionStyle`, provided once by FeatureInteractionLayer. */
export const SelectionStyleContext = createContext<SelectionStyle>('auto')

/** What a feature looks like selected / hovered: see `useStateLook`. */
export interface StateLook {
  /** Selected outline / fill colour: a shade of the feature's colour (derived look), else the accent. */
  color: string
  fillColor: string
  /** Extra stroke px when selected (derived look only). */
  boost: number
  /** The integrator's `getFeatureStyle(feature, { selected: true })`, spread over the selected look. */
  host: PathOptions | undefined
  /** Hover overrides for an unselected feature (derived shade, or the integrator's hovered style). */
  hover: PathOptions
  /** Pin colours: selected, and hovered (undefined = keep the idle colour / default tint). */
  pinLit: string
  pinHover: string | undefined
}

/** A state's style keys that differ from the base style: a callback that ignores the state returns the base, which changes nothing. */
function onlyChanged(state: PathOptions | null | undefined, base: PathOptions | undefined): PathOptions | undefined {
  if (!state) return undefined
  let out: Record<string, unknown> | undefined
  for (const [k, v] of Object.entries(state)) {
    if (v !== undefined && v !== (base as Record<string, unknown> | undefined)?.[k]) (out ??= {})[k] = v
  }
  return out as PathOptions | undefined
}

/**
 * The selected / hovered look of one feature. In the derived look (`selectionStyle`) the
 * colours are shades of the feature's own colour, else the accent. `getFeatureStyle` is
 * asked for a state only while the feature is in it, so idle features cost nothing extra.
 */
export function useStateLook(feature: GeoJSONFeature, custom: PathOptions | undefined, lit: boolean, hovered: boolean): StateLook {
  const getStyle = useFeatureStyle()
  const mode = useContext(SelectionStyleContext)
  const accent = useContext(AccentContext)[500]
  return useMemo(() => {
    const derived = usesDerivedLook(mode, !!(custom?.color ?? custom?.fillColor))
    const strokeBase = custom?.color ?? custom?.fillColor ?? DEFAULT_FEATURE_COLOR
    const fillBase = custom?.fillColor ?? custom?.color ?? DEFAULT_FEATURE_COLOR
    const dStroke = derived ? deriveStateColors(strokeBase) : null
    const dFill = derived ? deriveStateColors(fillBase) : null
    const host = onlyChanged(lit && getStyle ? getStyle(feature, { selected: true, hovered }) : undefined, custom)
    const hostHover = onlyChanged(!lit && hovered && getStyle ? getStyle(feature, { selected: false, hovered: true }) : undefined, custom)
    const hostFill = host?.fillColor ?? host?.color
    const hover: PathOptions = {
      ...(dStroke && { color: dStroke.hovered }),
      ...(dFill && { fillColor: dFill.hovered }),
      ...hostHover,
    }
    return {
      color: host?.color ?? dStroke?.selected ?? accent,
      fillColor: hostFill ?? dFill?.selected ?? accent,
      boost: lit && dStroke ? SELECTED_WEIGHT_BOOST : 0,
      host,
      hover,
      pinLit: host?.fillColor ?? host?.color ?? dFill?.selected ?? 'var(--color-primary-500)',
      pinHover: hostHover?.fillColor ?? hostHover?.color ?? dFill?.hovered,
    }
  }, [getStyle, mode, accent, feature, custom, lit, hovered])
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

// ─── Vertex / transform handles ───────────────────────────────────────────────

/**
 * Handles of the feature being edited (vertex points, transform box) take the same shade as its
 * selected look: `--elm-handle` (+ `-strong`, `-soft`) on the map container, which the handle
 * icons read with the accent as fallback. Pass `undefined` (several features, nothing selected)
 * to keep the accent. A no-op when the accent look applies.
 */
export function useHandleVars(feature: GeoJSONFeature | undefined, container: HTMLElement): string | null {
  const getStyle = useFeatureStyle()
  const { featureColor, selectionStyle } = useElementEditorConfig()
  const color = useMemo(() => {
    if (!feature) return null
    const composed = composeFeatureStyle(getStyle, featureColor)
    const base = composed?.(feature, { selected: false, hovered: false }) ?? undefined
    const host = onlyChanged(composed?.(feature, { selected: true, hovered: false }), base)
    if (host?.color) return host.color
    if (!usesDerivedLook(selectionStyle, !!(base?.color ?? base?.fillColor))) return null
    return deriveStateColors(base?.color ?? base?.fillColor ?? DEFAULT_FEATURE_COLOR)?.selected ?? null
  }, [feature, getStyle, featureColor, selectionStyle])
  useEffect(() => {
    if (!color) return
    const strong = deriveStateColors(color)?.selected ?? color
    container.style.setProperty('--elm-handle', color)
    container.style.setProperty('--elm-handle-strong', strong)
    container.style.setProperty('--elm-handle-soft', `color-mix(in oklab, ${color} 15%, white)`)
    return () => { for (const k of ['--elm-handle', '--elm-handle-strong', '--elm-handle-soft']) container.style.removeProperty(k) }
  }, [color, container])
  return color
}

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
export function makePinIcon(selected: boolean, multiSelected = false, idle?: string, litColor = 'var(--color-primary-500)', hoverColor?: string) {
  // Selected pins take `litColor` (accent, or a shade of the pin's own colour); an idle pin takes the hover tint (tintPin).
  const lit = multiSelected || selected
  const color = lit ? litColor : idle ?? DEFAULT_FEATURE_COLOR
  const plain = !lit && (hoverColor || color === DEFAULT_FEATURE_COLOR)
  const tint = plain ? ` data-elm-plain="1" data-elm-idle="${color}" data-elm-hover="${hoverColor ?? '#334155'}"` : ''

  return divIcon({
    className: lit ? SELECTED_FEATURE_CLASS : '',
    html: `<div style="position:relative;width:20px;height:28px">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28" style="position:relative;z-index:1;display:block">
        <path d="${PIN_PATH}" fill-rule="evenodd"${tint} style="fill:${color}"/>
      </svg>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
  })
}

/**
 * Hover tint: an unselected pin goes to its hover colour: one step darker slate for the default, a
 * milder shade of its own colour in the derived look (otherwise a custom colour is kept, like MapLibre). Set on the marker's existing element, never by swapping the icon: a swapped-in
 * element sits under the cursor without a mouseover, so it never gets the mouseout and the tint stuck.
 */
export function tintPin(layer: { getElement?: () => Element | undefined } | null | undefined, on: boolean) {
  const path = layer?.getElement?.()?.querySelector<SVGPathElement>('path[data-elm-plain]') // null for non-pin layers
  if (path) path.style.fill = (on ? path.dataset.elmHover : path.dataset.elmIdle) ?? (on ? '#334155' : DEFAULT_FEATURE_COLOR)
}

/** Unselected pin, one shared instance per colour, so idle markers never get a setIcon.
 *  Module-wide (shared by every editor), so capped: past 256 colours it starts over. */
const IDLE_PINS = new Map<string, ReturnType<typeof makePinIcon>>()
export function idlePin(color = DEFAULT_FEATURE_COLOR, hoverColor?: string) {
  const key = hoverColor ? `${color}|${hoverColor}` : color
  let icon = IDLE_PINS.get(key)
  if (!icon) {
    if (IDLE_PINS.size >= 256) IDLE_PINS.clear()
    IDLE_PINS.set(key, (icon = makePinIcon(false, false, color, undefined, hoverColor)))
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
