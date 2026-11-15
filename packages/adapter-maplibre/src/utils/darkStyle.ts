import type { Map as MapLibreMap } from 'maplibre-gl'

/** Relative luminance (0…1) of a `#rgb` / `#rrggbb` / `rgb()` / `rgba()` colour, or null if unparsable. */
export function colorLuminance(color: string): number | null {
  let r: number, g: number, b: number
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim())
    if (!m) return null
    r = +m[1]; g = +m[2]; b = +m[3]
  }
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Whether the map's style draws a dark base: its background layer's colour
 * (a plain colour; a zoom expression or a raster basemap counts as light).
 */
export function isDarkMapStyle(map: MapLibreMap): boolean {
  try {
    const bg = map.getStyle()?.layers?.find((l) => l.type === 'background')
    const c = (bg?.paint as Record<string, unknown> | undefined)?.['background-color']
    if (typeof c !== 'string') return false
    const l = colorLuminance(c)
    return l !== null && l < 0.18
  } catch {
    return false // style not loaded yet
  }
}
