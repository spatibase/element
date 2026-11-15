import { useLayoutEffect, useRef } from 'react'

/**
 * Measures the shell's map slots and writes the results as CSS vars on the
 * root (so nothing re-renders). Attach the returned refs to the matching
 * elements.
 *
 * The contextual bottom-center stack (editing toolbars, readonly banner)
 * sits above the static bottomCenter entries, and lifts above the whole
 * bottom row when it would overlap bottomLeft / bottomRight. The lift is a
 * CSS var written straight to the root, so nothing re-renders.
 */
export function useSlotAutoLayout(tableFullscreen: boolean, toggleClearance: number) {
  const rootRef = useRef<HTMLDivElement>(null)
  const topRowRef = useRef<HTMLDivElement>(null)
  const bottomRowRef = useRef<HTMLDivElement>(null)
  const bottomLeftRef = useRef<HTMLDivElement>(null)
  const bottomCenterRef = useRef<HTMLDivElement>(null)
  const bottomRightRef = useRef<HTMLDivElement>(null)
  const contextualRef = useRef<HTMLDivElement>(null)
  const leftEdgeRef = useRef<HTMLDivElement>(null)
  const rightEdgeRef = useRef<HTMLDivElement>(null)
  const leftCenterRef = useRef<HTMLDivElement>(null)
  const rightCenterRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || tableFullscreen) return
    // The right-hand panels' width, written on the root by the panels (usePanelOffset).
    const panelOffset = () => parseFloat(root.style.getPropertyValue('--elm-panel-offset')) || 0
    const box = (el: HTMLElement | null) => (el && el.offsetWidth > 0 ? el.getBoundingClientRect() : null)
    // A slot's one-line width: its entries + 8px gaps (a column: its widest
    // entry). Not its box, which wraps (narrower) once the row wraps.
    // (Tooltip wrappers are `display: contents`: measure what they wrap.)
    const widthsOf = (els: Element[]): number[] => els.flatMap((k) =>
      getComputedStyle(k).display === 'contents' ? widthsOf([...k.children]) : [(k as HTMLElement).offsetWidth])
    const natural = (slot: HTMLElement) => {
      const kids = widthsOf([...slot.children]).filter((w) => w > 0)
      if (!kids.length) return 0
      return getComputedStyle(slot).flexDirection.startsWith('column')
        ? Math.max(...kids)
        : kids.reduce((a, b) => a + b, 0) + 8 * (kids.length - 1)
    }
    // A row whose slots don't fit side by side wraps (data-elm-wrap): the
    // right slot moves to its own line instead of sliding under the panel,
    // and a slot wider than the row wraps its entries. Natural widths don't
    // depend on the mode, so this can't flip-flop.
    // Returns false when the row has to switch mode but `defer` is set: the
    // switch resizes the row and its slots, which the observer watches, so
    // doing it inside the observer's callback would leave notifications
    // undelivered ("ResizeObserver loop completed…"). The caller re-runs it
    // in the next frame instead.
    const fit = (row: HTMLElement | null, clearance: number, defer: boolean) => {
      if (!row) return true
      // Slot widths + gaps + the right slot's clearance, against the row's
      // target width (16px insets, ending at the panels): not its width
      // mid-transition, and not auto margins, which resolve to the free space
      // when wrapped and would keep the row wrapped forever.
      const room = (row.parentElement?.clientWidth ?? 0) - 32 - panelOffset()
      // The widest a slot item may get (the map attribution caps itself at it), set before
      // the widths below are read.
      const roomVar = `${Math.max(0, Math.floor(room))}px`
      if (row.style.getPropertyValue('--elm-row-room') !== roomVar) row.style.setProperty('--elm-row-room', roomVar)
      const need = [...row.children].reduce((w, k) => w + natural(k as HTMLElement), 16) + clearance
      const wrap = need > room + 0.5
      // Wrapped, the whole row clears the corner toggle (the slots in it are
      // capped at its width); the toolbar reads the clearance to compact.
      const pad = wrap && clearance ? `${clearance}px` : ''
      row.dataset.elmClearance = String(clearance)
      if (row.hasAttribute('data-elm-wrap') === wrap && row.style.paddingRight === pad) return true
      if (defer) return false
      row.toggleAttribute('data-elm-wrap', wrap)
      row.style.paddingRight = pad
      return true
    }
    let raf = 0
    const measure = (defer = false) => {
      const settled = fit(topRowRef.current, toggleClearance, defer) && fit(bottomRowRef.current, 0, defer)
      if (!settled) {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure() })
        return
      }
      const ctx = box(contextualRef.current)
      const row = box(bottomRowRef.current)
      const l = box(bottomLeftRef.current), c = box(bottomCenterRef.current), r = box(bottomRightRef.current)
      const hits = (b: DOMRect | null) => !!(ctx && b && ctx.left < b.right + 8 && b.left < ctx.right + 8)
      let lift = c ? c.height + 8 : 0
      if (row && (hits(l) || hits(r))) lift = Math.max(lift, row.height + 8)
      root.style.setProperty('--elm-bottom-row-height', `${lift}px`)
      sideShift(leftCenterRef.current, '--elm-left-center-shift')
      sideShift(rightCenterRef.current, '--elm-right-center-shift')
    }
    // A side-center slot stays centered while it fits between the top and
    // bottom rows' slots on its side (e.g. a tall vertical topLeft column),
    // otherwise it's pushed down (or up) to clear them. The shift is a CSS var
    // on `top`, which no observer sees, so this can't loop.
    const shifts: Record<string, number> = {}
    const sideShift = (el: HTMLElement | null, cssVar: string) => {
      const now = shifts[cssVar] ?? 0
      const b = box(el)
      let next = 0
      if (b) {
        const naturalTop = b.top - now
        let min = -Infinity, max = Infinity
        for (const row of [topRowRef.current, bottomRowRef.current]) {
          for (const k of row?.children ?? []) {
            const o = box(k as HTMLElement)
            if (!o || o.height === 0 || o.right + 8 <= b.left || b.right + 8 <= o.left) continue
            if (row === topRowRef.current) min = Math.max(min, o.bottom + 8)
            else max = Math.min(max, o.top - 8)
          }
        }
        // ponytail: no room between both rows → it sits below the top row and may touch the bottom one.
        const top = naturalTop < min ? min : naturalTop + b.height > max ? Math.max(min, max - b.height) : naturalTop
        next = top - naturalTop
      }
      if (next !== now) { shifts[cssVar] = next; root.style.setProperty(cssVar, `${next}px`) }
    }
    const ro = new ResizeObserver(() => measure(true))
    for (const el of [topRowRef, bottomRowRef, bottomLeftRef, bottomCenterRef, bottomRightRef, contextualRef, leftEdgeRef, rightEdgeRef, leftCenterRef, rightCenterRef]) {
      if (el.current) ro.observe(el.current)
    }
    // Slots and their entries (an entry can change width inside a capped,
    // wrapped slot without the slot resizing, e.g. the toolbar compacting).
    for (const row of [topRowRef.current, bottomRowRef.current]) {
      for (const k of row?.children ?? []) {
        ro.observe(k)
        for (const e of k.querySelectorAll(':scope > *, :scope > .contents > *')) ro.observe(e)
      }
    }
    // The right slots slide (margin / right transitions) when the layers panel
    // opens, and the root transitions --elm-table-offset. Every hover / row
    // transition inside bubbles here too: only re-measure for those.
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === root || (e.target as Element).matches?.('[data-elm-slot], [data-elm-edge]')) measure()
    }
    root.addEventListener('transitionend', onTransitionEnd)
    // A panel opening / resizing changes --elm-panel-offset (no element here
    // resizes): re-fit right after the write, before the frame renders.
    let offset = panelOffset()
    const mo = new MutationObserver(() => {
      if (panelOffset() !== offset) { offset = panelOffset(); measure() }
    })
    mo.observe(root, { attributes: true, attributeFilter: ['style'] })
    measure()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      root.removeEventListener('transitionend', onTransitionEnd)
      for (const v of ['--elm-bottom-row-height', '--elm-left-center-shift', '--elm-right-center-shift']) root.style.setProperty(v, '0px')
    }
  }, [tableFullscreen, toggleClearance])

  return {
    rootRef, topRowRef, bottomRowRef, bottomLeftRef, bottomCenterRef, bottomRightRef,
    contextualRef, leftEdgeRef, rightEdgeRef, leftCenterRef, rightCenterRef,
  }
}
