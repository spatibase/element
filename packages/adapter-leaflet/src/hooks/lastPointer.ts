/**
 * Module-level pointer tracker. Used by marker components to decide whether
 * the cursor is already over them at mount time (e.g. right after a point
 * is placed by the draw tool — the marker mounts under a stationary cursor,
 * so no `mouseover` event fires and hover affordances like the Cmd/Alt
 * modifier cursor never activate until the user moves the mouse away and
 * back).
 *
 * Exposing this as a shared module avoids re-attaching the window listeners
 * per marker — one set of listeners keeps a single source of truth.
 */
import type L from 'leaflet'

export type PointerState = {
  x: number
  y: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

let state: PointerState = { x: -1, y: -1, ctrlKey: false, metaKey: false, altKey: false }

// Install listeners eagerly at module load so `state` reflects real mouse
// movement from the moment the adapter bundle evaluates. Installing lazily
// on first `getLastPointer()` call misses every `mousemove` that happened
// before the first consumer (e.g. a POIMarker mount effect fires only after
// the user clicks — by which point the pointer's already at the click site
// and no more `mousemove` will update state until the user moves again).
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    state = { x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }
  }, { capture: true, passive: true })
  // pointerdown / click also update position so a keyboard-only user (no
  // mousemove) still gets an accurate reading after their first interaction.
  const syncPos = (e: MouseEvent) => {
    state = { x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }
  }
  window.addEventListener('pointerdown', syncPos, { capture: true, passive: true })
  window.addEventListener('mousedown', syncPos, { capture: true, passive: true })
  const syncMods = (e: KeyboardEvent) => {
    state = { ...state, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }
  }
  window.addEventListener('keydown', syncMods, { capture: true })
  window.addEventListener('keyup', syncMods, { capture: true })
}

export function getLastPointer(): PointerState {
  return state
}

export function isPointerOver(el: Element | null | undefined): boolean {
  if (!el) return false
  const rect = (el as HTMLElement).getBoundingClientRect?.()
  if (!rect) return false
  const { x, y } = getLastPointer()
  if (x < 0 || y < 0) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

// Container rect, cached for one frame: many markers mounting in one commit
// (an import) would otherwise force a layout each.
let rectCache: { el: HTMLElement; rect: DOMRect } | null = null

/** Layout-free pre-check for isPointerOver: is the pointer within `px` of this map point?
 *  Lets a bulk mount skip getBoundingClientRect on all but the marker under the cursor. */
export function isPointerNear(map: L.Map, latlng: L.LatLngExpression, px = 40): boolean {
  const { x, y } = state
  if (x < 0 || y < 0) return false
  const c = map.getContainer()
  if (!rectCache || rectCache.el !== c) {
    rectCache = { el: c, rect: c.getBoundingClientRect() }
    requestAnimationFrame(() => { rectCache = null })
  }
  const p = map.latLngToContainerPoint(latlng)
  return Math.abs(rectCache.rect.left + p.x - x) <= px && Math.abs(rectCache.rect.top + p.y - y) <= px
}
