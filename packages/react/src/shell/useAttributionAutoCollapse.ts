import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/** How long the compact attribution stays expanded after load when nobody touches the map. */
export const ATTRIBUTION_COLLAPSE_MS = 5000

/** The attribution and its toggle: using them is not "interacting with the map". */
const ATTRIBUTION_PARTS = '.leaflet-control-attribution, .elm-attribution-toggle, .maplibregl-ctrl-attrib'

/**
 * The OSM Foundation attribution guidelines
 * (https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) let a map's attribution
 * collapse to an "i" button only once the user has seen it: it must show expanded at load, and may
 * collapse on the first map interaction (pan, click, zoom) or after five seconds.
 *
 * This runs `collapse` once, on whichever comes first: a pointer press, wheel or key press on
 * `mapEl` (not on the attribution itself), or {@link ATTRIBUTION_COLLAPSE_MS} of the page being
 * visible (a page opened in a background tab starts counting when it is shown). Engine-neutral:
 * plain DOM events on the map container, so it catches drag, click, double-click, pinch, wheel
 * and keyboard pan / zoom on both Leaflet and MapLibre, and ignores programmatic moves (the
 * initial fit to data). The returned `stop()` cancels it: call it when the user opens or closes
 * the attribution themselves, so a timer never closes what they just opened.
 */
export function useAttributionAutoCollapse(mapEl: HTMLElement | null | undefined, collapse: () => void, enabled = true): () => void {
  const collapseRef = useRef(collapse)
  useLayoutEffect(() => { collapseRef.current = collapse })
  const stopRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!enabled || !mapEl) return
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      done = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const type of EVENTS) mapEl.removeEventListener(type, onInteract, true)
    }
    const fire = () => {
      if (done) return
      cleanup()
      collapseRef.current()
    }
    const onInteract = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(ATTRIBUTION_PARTS)) return
      fire()
    }
    const startTimer = () => { if (!timer) timer = setTimeout(fire, ATTRIBUTION_COLLAPSE_MS) }
    function onVisibility() { if (document.visibilityState === 'visible') startTimer() }
    for (const type of EVENTS) mapEl.addEventListener(type, onInteract, { capture: true, passive: true })
    if (document.visibilityState === 'hidden') document.addEventListener('visibilitychange', onVisibility)
    else startTimer()
    stopRef.current = cleanup
    return () => { cleanup(); stopRef.current = () => {} }
  }, [mapEl, enabled])
  return useCallback(() => stopRef.current(), [])
}

const EVENTS = ['pointerdown', 'wheel', 'keydown'] as const
