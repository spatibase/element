import { useEffect, useMemo } from 'react'
import { DEFAULT_FEATURE_COLOR, deriveStateColors, usesDerivedLook, SELECTED_WEIGHT_BOOST, type FeatureStyle, type GeoJSONFeature, type SelectionStyle } from '@element-editor/core'
import { useElementEditorConfig } from '@element-editor/ui'
import { useFeatureStyle, type FeatureStyleFn } from '../contexts/FeatureStyleContext'

/** A state's style keys that differ from the base style: a callback that ignores the state returns the base, which changes nothing. */
export function onlyChanged(state: FeatureStyle | null | undefined, base: FeatureStyle | undefined): FeatureStyle | undefined {
  if (!state) return undefined
  let out: Record<string, unknown> | undefined
  for (const [k, v] of Object.entries(state)) {
    if (v !== undefined && v !== (base as Record<string, unknown> | undefined)?.[k]) (out ??= {})[k] = v
  }
  return out as FeatureStyle | undefined
}

/** `_sel*` / `_hov*` feature properties the paint expressions read: the selected and hovered looks of one feature. */
export type StateProps = Partial<Record<'_selColor' | '_selFillColor' | '_selWeight' | '_selRadius' | '_hovColor' | '_hovFillColor', string | number>>

/**
 * The selected / hovered look of a feature, as properties to bake on the render feature
 * (MapLibre expressions can't derive colours, so they're computed here, once per data update).
 * Derived look (`selectionStyle`): darker shades of the feature's colour + a heavier stroke;
 * `getFeatureStyle(feature, state)` keys that differ from the plain call win. Empty = accent look.
 * `defaultColor`: what a feature with no colour of its own derives from (`'feature'` mode only).
 * `baseWeight`: the selected stroke width when the look is derived and the host set none.
 */
export function stateProps(
  feature: GeoJSONFeature,
  base: FeatureStyle | undefined,
  getStyle: FeatureStyleFn | undefined,
  mode: SelectionStyle,
  defaultColor: string,
  selectedWeight: number,
): StateProps | undefined {
  const derived = usesDerivedLook(mode, !!(base?.color ?? base?.fillColor))
  const hostSel = getStyle ? onlyChanged(getStyle(feature, { selected: true, hovered: false }), base) : undefined
  const hostHov = getStyle ? onlyChanged(getStyle(feature, { selected: false, hovered: true }), base) : undefined
  if (!derived && !hostSel && !hostHov) return undefined
  const out: StateProps = {}
  if (derived) {
    const stroke = deriveStateColors(base?.color ?? base?.fillColor ?? defaultColor)
    const fill = deriveStateColors(base?.fillColor ?? base?.color ?? defaultColor)
    if (stroke) {
      out._selColor = stroke.selected
      out._hovColor = stroke.hovered
      out._selWeight = selectedWeight + SELECTED_WEIGHT_BOOST
      out._selRadius = 10 + SELECTED_WEIGHT_BOOST
    }
    if (fill) { out._selFillColor = fill.selected; out._hovFillColor = fill.hovered }
  }
  if (hostSel?.color !== undefined) { out._selColor = hostSel.color; if (hostSel.fillColor === undefined) out._selFillColor = hostSel.color }
  if (hostSel?.fillColor !== undefined) out._selFillColor = hostSel.fillColor
  if (hostSel?.weight !== undefined) out._selWeight = hostSel.weight
  if (hostHov?.color !== undefined) { out._hovColor = hostHov.color; if (hostHov.fillColor === undefined) out._hovFillColor = hostHov.color }
  if (hostHov?.fillColor !== undefined) out._hovFillColor = hostHov.fillColor
  return out
}

/**
 * Handles of the feature being edited (vertex points, transform box) take the shade of its
 * selected look: `--elm-handle` (+ `-strong`, `-soft`) on the map container, which the handle
 * elements read with the accent as fallback. `undefined` (several features) keeps the accent.
 */
export function useHandleVars(feature: GeoJSONFeature | undefined, container: HTMLElement) {
  const getStyle = useFeatureStyle()
  const { featureColor, selectionStyle } = useElementEditorConfig()
  const color = useMemo(() => {
    if (!feature) return null
    const compose = (state: { selected: boolean; hovered: boolean }) => {
      const s = getStyle?.(feature, state) ?? undefined
      if (state.selected) return s
      return featureColor && !s?.color ? { ...s, color: featureColor } : s
    }
    const base = compose({ selected: false, hovered: false })
    const host = onlyChanged(compose({ selected: true, hovered: false }), base)
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
