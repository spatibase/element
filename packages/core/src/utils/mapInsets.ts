/** Pixel insets on each side of the map. */
export interface MapInsets { top: number; right: number; bottom: number; left: number }

/**
 * How much of the map the editor's own panels cover: the right-hand panels
 * (open layers panel + docked GeoJSON inspector, `--elm-panel-offset`) and the
 * data table (`--elm-table-offset`), both written on the Element root. Only
 * the part that is over `mapEl` counts, so a host that lays the panels out
 * beside the map gets zero. Reads the target values (inline vars), not a
 * mid-transition frame. At least 160 px of the map stay "visible", so a fit
 * never runs out of room.
 */
export function coveredMapInsets(mapEl: HTMLElement | null | undefined): MapInsets {
  const none = { top: 0, right: 0, bottom: 0, left: 0 }
  const root = mapEl?.closest<HTMLElement>('[data-elm-theme]')
  if (!mapEl || !root) return none
  const panel = parseFloat(root.style.getPropertyValue('--elm-panel-offset')) || 0
  const table = parseFloat(root.style.getPropertyValue('--elm-table-offset')) || 0
  if (!panel && !table) return none
  const m = mapEl.getBoundingClientRect()
  const r = root.getBoundingClientRect()
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max))
  return {
    ...none,
    // Panels hug the root's right edge; the table sits on the map area's floor.
    right: clamp(panel - (r.right - m.right), m.width - 160),
    bottom: clamp(table, m.height - 160),
  }
}

/**
 * Padding for fitting bounds into the part of the map nobody covers: `base`
 * on every side plus `coveredMapInsets`. The same for every fit (select fit,
 * fit button, import, `ref.fitBounds`, search) on both engines.
 */
export function fitPadding(mapEl: HTMLElement | null | undefined, base = 40): MapInsets {
  const c = coveredMapInsets(mapEl)
  return { top: base + c.top, right: base + c.right, bottom: base + c.bottom, left: base + c.left }
}

/**
 * Screen offset (px) that puts a centred target in the middle of the visible
 * part of the map instead of the middle of the whole map (pan / fly to a point).
 */
export function visibleCenterOffset(mapEl: HTMLElement | null | undefined): [number, number] {
  const c = coveredMapInsets(mapEl)
  return [(c.left - c.right) / 2, (c.top - c.bottom) / 2]
}
