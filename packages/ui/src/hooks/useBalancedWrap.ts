import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/** Visual rows of a flex-wrap container: its flex items grouped by vertical centre. */
function rowsOf(el: HTMLElement): number {
  const centres: number[] = []
  const visit = (parent: Element) => {
    for (const c of Array.from(parent.children)) {
      // `display: contents` wrappers (Tooltip) have no box: their children are the items.
      if (getComputedStyle(c).display === 'contents') { visit(c); continue }
      const r = c.getBoundingClientRect()
      if (!r.width) continue
      const y = r.top + r.height / 2
      if (!centres.some((v) => Math.abs(v - y) < 8)) centres.push(y)
    }
  }
  visit(el)
  return centres.length
}

/**
 * `text-wrap: balance` for a `flex-wrap` toolbar: when its buttons don't fit
 * on one row, it's narrowed to the least width that still needs no more rows,
 * so a narrow screen shows 4 + 4 buttons rather than 7 + a lone Delete.
 * Re-runs when the room around it or `key` (what the toolbar holds) changes.
 */
export function useBalancedWrap(ref: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const balance = () => {
      el.style.maxWidth = ''
      const rows = rowsOf(el)
      if (rows < 2) return
      // Binary search the narrowest width (px) that keeps the same row count.
      let lo = 0
      let hi = el.offsetWidth
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        el.style.maxWidth = mid + 'px'
        if (rowsOf(el) > rows || el.scrollWidth > el.clientWidth) lo = mid
        else hi = mid
      }
      el.style.maxWidth = hi + 'px'
    }
    balance()
    // The room it may take is set somewhere up the tree (the editor's width, a
    // panel sliding in), and shrink-to-fit ancestors follow its own width:
    // watch them all, and act on a width other than the one balancing left.
    const ancestors: HTMLElement[] = []
    for (let a = el.parentElement; a && ancestors.length < 8; a = a.parentElement) {
      ancestors.push(a)
      if (a.hasAttribute('data-elm-theme')) break
    }
    const seen = new WeakMap<Element, number>()
    const remember = () => { for (const a of ancestors) seen.set(a, a.clientWidth) }
    remember()
    const ro = new ResizeObserver((entries) => {
      if (entries.every((e) => seen.get(e.target) === (e.target as HTMLElement).clientWidth)) return
      balance()
      remember()
    })
    for (const a of ancestors) ro.observe(a)
    return () => {
      ro.disconnect()
      el.style.maxWidth = ''
    }
  }, [ref, key])
}
