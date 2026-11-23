/**
 * Accent palette — one colour in, the whole 50…950 scale out.
 *
 * The CSS side (`index.css`) derives `--color-primary-*` from `--elm-accent`
 * with `color-mix(in oklab, …)`; this is the same math in JS for places that
 * can't use CSS variables (Leaflet SVG attributes, MapLibre paint props).
 * Keep ACCENT_STEPS in sync with the CSS block.
 */

export const DEFAULT_ACCENT = '#3b82f6'

/** Default feature colour (slate-600) when neither `featureColor` nor `getFeatureStyle` sets one. */
export const DEFAULT_FEATURE_COLOR = '#475569'
/** The default on a dark basemap (slate-400): slate-600 nearly vanishes there. */
export const DEFAULT_FEATURE_COLOR_ON_DARK = '#94a3b8'

export type AccentShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950
export type AccentPalette = Record<AccentShade, string>

/**
 * Per shade. Light side (`mix`): share of accent mixed with white in OKLab —
 * CSS `color-mix(in oklab, accent N%, white)`. Dark side (`l`/`c`): OKLCH
 * lightness and chroma multipliers, hue kept — CSS relative colour
 * `oklch(from accent calc(l * L) calc(c * C) h)`. Mixing with black would also
 * drain chroma and the darks go muddy; these factors are fitted to Tailwind's
 * blue so the default accent reproduces the familiar scale.
 */
export const ACCENT_STEPS: Record<AccentShade, { mix: number } | { l: number; c: number }> = {
  50: { mix: 0.08 },
  100: { mix: 0.16 },
  200: { mix: 0.3 },
  300: { mix: 0.5 },
  400: { mix: 0.75 },
  500: { mix: 1 },
  600: { l: 0.876, c: 1 },
  700: { l: 0.78, c: 1 },
  800: { l: 0.68, c: 0.93 },
  900: { l: 0.61, c: 0.7 },
  950: { l: 0.45, c: 0.45 },
}

type RGB = [number, number, number]

/** Parse `#rgb`, `#rrggbb`, `rgb()/rgba()` (comma or space syntax). Null if unrecognised. */
export function parseColor(input: string): RGB | null {
  const s = input.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

let ctx: CanvasRenderingContext2D | null | undefined // shared 1×1 canvas for resolveColor

/**
 * Normalise any CSS colour (named, hsl, oklch, color-mix, …) to an RGB triple.
 * Hex/rgb are parsed directly; anything else is painted onto a 1×1 canvas and
 * the pixel read back — `fillStyle` alone isn't enough, since browsers keep
 * modern syntaxes like `oklch()` as-is instead of normalising them to hex.
 */
export function resolveColor(input: string): RGB | null {
  const direct = parseColor(input)
  if (direct || typeof document === 'undefined') return direct
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', input)) return null
  if (ctx === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) return null
  ctx.fillStyle = input
  const normalised = parseColor(String(ctx.fillStyle))
  if (normalised) return normalised
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a === 0 ? null : [r, g, b]
}

const toLinear = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function rgbToOklab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const toHex = (rgb: RGB) =>
  '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')

/** `color-mix(in oklab, a t, b)` — t is the share of `a` (0…1). */
export function mixOklab(a: RGB, b: RGB, t: number): string {
  const A = rgbToOklab(a)
  const B = rgbToOklab(b)
  return toHex(oklabToRgb([0, 1, 2].map((i) => A[i] * t + B[i] * (1 - t)) as RGB))
}

/** OKLCH lightness × `l`, chroma × `c`, hue kept (out-of-gamut channels clip). */
function scaleOklch(rgb: RGB, l: number, c: number): string {
  const [L, a, b] = rgbToOklab(rgb)
  return toHex(oklabToRgb([L * l, a * c, b * c]))
}

/** OKLab lightness × `l` (chroma and hue kept), as `#rrggbb`. */
export function oklabShift(rgb: RGB, l: number): string {
  const [L, a, b] = rgbToOklab(rgb)
  return toHex(oklabToRgb([L * l, a, b]))
}

/** The full 50…950 scale for an accent colour (any CSS colour; falls back to the default blue). */
export function accentPalette(accent: string = DEFAULT_ACCENT): AccentPalette {
  const base = resolveColor(accent) ?? (parseColor(DEFAULT_ACCENT) as RGB)
  const out = {} as AccentPalette
  for (const [shade, step] of Object.entries(ACCENT_STEPS)) {
    out[Number(shade) as AccentShade] = 'mix' in step
      ? mixOklab(base, [255, 255, 255], step.mix)
      : scaleOklch(base, step.l, step.c)
  }
  return out
}

const SHADES = Object.keys(ACCENT_STEPS).map(Number) as AccentShade[]
const probes = new WeakMap<Element, HTMLElement>()

/**
 * A hidden probe inside `el`: one child per shade with
 * `color: var(--color-primary-N)`, so the browser resolves the shade exactly
 * as the UI sees it — `color-mix()`, `oklch(from …)`, `--elm-primary-N`
 * overrides and all. Created once per element; styles never change, so a
 * read costs one style recalc.
 */
function probeFor(el: Element): HTMLElement {
  let probe = probes.get(el)
  if (probe?.parentNode === el) return probe
  probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.dataset.elmAccentProbe = ''
  probe.style.display = 'none'
  for (const n of SHADES) {
    const s = document.createElement('span')
    s.style.color = `var(--color-primary-${n})`
    probe.appendChild(s)
  }
  el.appendChild(probe)
  probes.set(el, probe)
  return probe
}

/**
 * The palette in effect for an element, as concrete `#rrggbb` — the shades
 * the CSS actually resolves to there (including per-shade `--elm-primary-N`
 * overrides). A shade the CSS doesn't define (no stylesheet, no DOM, jsdom)
 * falls back to `accentPalette(--elm-accent)`.
 */
export function readAccentPalette(el: Element | null | undefined): AccentPalette {
  const dom = !!el && typeof getComputedStyle !== 'undefined' && typeof document !== 'undefined'
  const accent = dom ? getComputedStyle(el).getPropertyValue('--elm-accent').trim() : ''
  const out = accentPalette(accent || DEFAULT_ACCENT)
  if (!dom) return out
  const kids = probeFor(el).children
  SHADES.forEach((n, i) => {
    const cs = getComputedStyle(kids[i])
    if (!cs.getPropertyValue(`--color-primary-${n}`).trim()) return
    const rgb = resolveColor(cs.color)
    if (rgb) out[n] = toHex(rgb)
  })
  return out
}
