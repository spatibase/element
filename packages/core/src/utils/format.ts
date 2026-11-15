// Distance + area formatting that respects the editor's units config.
// One implementation; the previous in-package duplicates (3 of them across
// adapter-leaflet and react/components/map) all hardcoded metric.

export interface FormatOpts {
  /** 'auto' resolves to imperial for en-US/en-LR/my locales, metric otherwise. */
  unit: 'metric' | 'imperial' | 'auto'
  /** 'human' picks readable units (m → km, ft → mi); 'raw' stays in base unit with fixed decimals. */
  display: 'human' | 'raw'
  /** Decimal places used in 'raw' mode. */
  precision: number
}

export interface FormattedQuantity { value: string; unit: string }

const M_PER_FT = 0.3048
const SQM_PER_SQFT = M_PER_FT * M_PER_FT  // ~0.092903
const FT_PER_MILE = 5280
const SQFT_PER_ACRE = 43560
const ACRE_PER_SQ_MILE = 640

/** Resolve 'auto' to 'metric' or 'imperial' from the browser locale. */
export function resolveUnitSystem(unit: FormatOpts['unit']): 'metric' | 'imperial' {
  if (unit !== 'auto') return unit
  const locale = (typeof navigator !== 'undefined' ? navigator.language : 'en-US').toLowerCase()
  // Imperial-using locales: US, Liberia, Myanmar
  return /^en-us|^en-lr|^my\b/.test(locale) ? 'imperial' : 'metric'
}

const resolveAuto = resolveUnitSystem

/** Format a length given in **meters**. */
export function formatLength(meters: number, opts: FormatOpts): FormattedQuantity {
  const unit = resolveAuto(opts.unit)

  if (opts.display === 'raw') {
    return unit === 'imperial'
      ? { value: (meters / M_PER_FT).toFixed(opts.precision), unit: 'ft' }
      : { value: meters.toFixed(opts.precision), unit: 'm' }
  }

  if (unit === 'imperial') {
    const ft = meters / M_PER_FT
    if (ft < FT_PER_MILE) return { value: String(Math.round(ft)), unit: 'ft' }
    return { value: (ft / FT_PER_MILE).toFixed(2), unit: 'mi' }
  }

  if (meters < 1000) return { value: String(Math.round(meters)), unit: 'm' }
  return { value: (meters / 1000).toFixed(2), unit: 'km' }
}

/** Format an area given in **square meters**. */
export function formatArea(sqMeters: number, opts: FormatOpts): FormattedQuantity {
  const unit = resolveAuto(opts.unit)

  if (opts.display === 'raw') {
    return unit === 'imperial'
      ? { value: (sqMeters / SQM_PER_SQFT).toFixed(opts.precision), unit: 'ft²' }
      : { value: sqMeters.toFixed(opts.precision), unit: 'm²' }
  }

  if (unit === 'imperial') {
    const sqft = sqMeters / SQM_PER_SQFT
    if (sqft < SQFT_PER_ACRE) return { value: String(Math.round(sqft)), unit: 'ft²' }
    const ac = sqft / SQFT_PER_ACRE
    if (ac < ACRE_PER_SQ_MILE) return { value: ac.toFixed(2), unit: 'ac' }
    return { value: (ac / ACRE_PER_SQ_MILE).toFixed(2), unit: 'mi²' }
  }

  // Metric: m² → ha (10,000 m²) → km² (1,000,000 m²).
  if (sqMeters < 10000)    return { value: String(Math.round(sqMeters)), unit: 'm²' }
  if (sqMeters < 1000000)  return { value: (sqMeters / 10000).toFixed(2), unit: 'ha' }
  return { value: (sqMeters / 1000000).toFixed(2), unit: 'km²' }
}
