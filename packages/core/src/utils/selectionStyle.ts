/**
 * Selected / hovered look derived from a feature's own colour (`selectionStyle`).
 * The colour is shifted in OKLab (perceptual lightness; hue and chroma kept), so
 * pink stays pink and blue stays blue. A dark colour gets its second cue from a
 * heavier stroke (`SELECTED_WEIGHT_BOOST`), since darkening it further barely shows.
 */
import { resolveColor, oklabShift } from './accent'

/** `'auto'`: a feature with its own colour derives the look, the default slate keeps the accent. `'accent'`: always the accent. `'feature'`: always derived. */
export type SelectionStyle = 'auto' | 'accent' | 'feature'

/** Extra stroke width (px) of a selected feature in the derived look. */
export const SELECTED_WEIGHT_BOOST = 1.5

/** OKLab lightness factors: selected is clearly darker, hover a milder step. */
const SELECTED_L = 0.72
const HOVERED_L = 0.88

export interface DerivedColors { selected: string; hovered: string }

const cache = new Map<string, DerivedColors | null>()

/** The selected and hovered variants of `color` (any CSS colour). Null when the colour can't be parsed. */
export function deriveStateColors(color: string): DerivedColors | null {
  const hit = cache.get(color)
  if (hit !== undefined) return hit
  const rgb = resolveColor(color)
  const out = rgb ? { selected: oklabShift(rgb, SELECTED_L), hovered: oklabShift(rgb, HOVERED_L) } : null
  if (cache.size >= 512) cache.clear()
  cache.set(color, out)
  return out
}

/** Whether a feature takes the derived look: `hasOwnColor` = colour from `getFeatureStyle` or `featureColor`. */
export function usesDerivedLook(mode: SelectionStyle | undefined, hasOwnColor: boolean): boolean {
  return mode === 'feature' || ((mode ?? 'auto') === 'auto' && hasOwnColor)
}
