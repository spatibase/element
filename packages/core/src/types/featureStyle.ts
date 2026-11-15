/**
 * Engine-neutral per-feature style: what a `getFeatureStyle` callback returns.
 * The same callback works with `adapter-maplibre` (baked onto feature properties
 * and read by paint expressions) and `adapter-leaflet` (merged into Leaflet's
 * `PathOptions`, which also accepts any other Leaflet path option).
 */
export interface FeatureStyle {
  /** Stroke / outline colour (any valid CSS color). */
  color?: string
  /** Fill colour. Falls back to `color` when omitted. */
  fillColor?: string
  /** Stroke opacity (0–1). */
  opacity?: number
  /** Fill opacity (0–1). */
  fillOpacity?: number
  /** Stroke width in px. */
  weight?: number
}
