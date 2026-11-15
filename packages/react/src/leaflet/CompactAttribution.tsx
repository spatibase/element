import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { Info } from '@phosphor-icons/react'
import { useAttributionAutoCollapse } from '../shell/useAttributionAutoCollapse'

/**
 * MapLibre-style compact attribution for Leaflet: Leaflet's own attribution
 * control stays (so tileLayer attributions and `addAttribution` keep working)
 * and a round "i" toggle collapses / expands it. Per the OSM Foundation
 * attribution guidelines it starts expanded and collapses on the first map
 * interaction or after five seconds (useAttributionAutoCollapse); dragging the
 * map or Escape closes it again after the user reopens it. The toggle is
 * portalled into the control's corner, not the control itself, because
 * Leaflet rewrites the control's innerHTML whenever an attribution changes.
 *
 * With `target` (the status bar's `'attribution'` entry) the control element
 * itself is moved there instead and no toggle renders. Leaflet keeps updating
 * the same element, so the bar stays in sync with layer changes for free; it
 * moves back to its map corner when `target` goes away.
 *
 * With `corner` (the shell's element at the bottom-right end of its slot row)
 * the control and its toggle move there, so the shell lays its bottom
 * controls out around the attribution instead of over it.
 */
export default function CompactAttribution({ target, corner: shellCorner }: { target?: HTMLElement | null; corner?: HTMLElement | null }) {
  const map = useMap()
  const [open, setOpen] = useState(true)
  const id = `elm-attribution${useId().replace(/:/g, '')}`
  const control = map.attributionControl?.getContainer()
  // The map corner, captured once: while moved, control.parentElement is the bar.
  const [mapCorner] = useState(() => control?.parentElement)
  const corner = shellCorner ?? mapCorner

  useEffect(() => {
    if (!control || !mapCorner) return
    if (target) {
      control.classList.add('elm-attribution-bar')
      target.appendChild(control)
      return () => { control.classList.remove('elm-attribution-bar'); mapCorner.appendChild(control) }
    }
    control.classList.add('elm-attribution-compact')
    control.id = id
    if (shellCorner) shellCorner.prepend(control)
    return () => {
      control.classList.remove('elm-attribution-compact', 'elm-attribution-open')
      if (shellCorner) mapCorner.appendChild(control)
    }
  }, [control, mapCorner, shellCorner, target, id])

  useEffect(() => {
    if (target) return
    control?.classList.toggle('elm-attribution-open', open)
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    map.on('dragstart', close)
    document.addEventListener('keydown', onKey)
    return () => { map.off('dragstart', close); document.removeEventListener('keydown', onKey) }
  }, [open, map, control, target])

  const stopAutoCollapse = useAttributionAutoCollapse(map.getContainer(), () => setOpen(false), !target && !!control)

  if (!control || !corner || target) return null
  return createPortal(
    <button
      type="button"
      // Keep clicks/wheel off the map (Leaflet does this for its own controls)
      ref={(el) => { if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el) } }}
      className="elm-attribution-toggle"
      aria-label={open ? 'Hide map attribution' : 'Show map attribution'}
      aria-expanded={open}
      aria-controls={id}
      onClick={() => { stopAutoCollapse(); setOpen((o) => !o) }}
    >
      <Info size={16} weight="bold" aria-hidden />
    </button>,
    corner,
  )
}
