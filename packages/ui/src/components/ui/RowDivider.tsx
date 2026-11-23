import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ToolbarDivider } from './EditToolbarBtn'

// `display: contents` wrappers (Tooltip) have no box of their own: use their edge child.
function boxOf(n: Element, edge: 'first' | 'last'): Element {
  let b: Element | null = n
  while (b && getComputedStyle(b).display === 'contents') b = edge === 'first' ? b.firstElementChild : b.lastElementChild
  return b ?? n
}

const midY = (n: Element, edge: 'first' | 'last') => {
  const r = boxOf(n, edge).getBoundingClientRect()
  return r.top + r.height / 2
}

const isShown = (n: Element) => (n as HTMLElement).style.display !== 'none' && getComputedStyle(boxOf(n, 'first')).display !== 'none'

/** The nearest sibling that takes up room in the bar (skips dividers hidden here). */
function neighbour(el: Element, dir: 'prev' | 'next'): Element | null {
  let n = dir === 'prev' ? el.previousElementSibling : el.nextElementSibling
  while (n && !isShown(n)) n = dir === 'prev' ? n.previousElementSibling : n.nextElementSibling
  return n
}

/**
 * Show every row divider in `bar`, then hide each one that would start or end
 * a row, in order, measuring afresh after each change: hiding one frees room,
 * which can move the next item up a row.
 */
function settle(bar: HTMLElement) {
  const dividers = Array.from(bar.children).filter((c): c is HTMLElement => c.hasAttribute('data-elm-row-divider'))
  for (const d of dividers) d.style.display = ''
  for (const d of dividers) {
    const prev = neighbour(d, 'prev')
    const next = neighbour(d, 'next')
    const y = midY(d, 'first')
    const alone = !prev || !next || Math.abs(midY(prev, 'last') - y) > 4 || Math.abs(midY(next, 'first') - y) > 4
    if (alone) d.style.display = 'none'
  }
}

/**
 * Toolbar divider for a `flex-wrap` bar: it only shows between two items on the
 * same row, so a bar that wraps at narrow widths never starts or ends a row with
 * a lone divider. Put it directly in the bar (not in a wrapper); every row
 * divider in the bar is settled together. `children` is the divider to draw.
 */
export function RowDivider({ children, as: Tag = 'span' }: { children?: ReactNode; /** `li` inside a `<ul>`. */ as?: 'span' | 'li' }) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const bar = ref.current?.parentElement
    if (!bar) return
    const update = () => settle(bar)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(bar)
    for (const c of Array.from(bar.children)) if (!c.hasAttribute('data-elm-row-divider')) ro.observe(boxOf(c, 'first'))
    return () => ro.disconnect()
  })
  return <Tag ref={ref as never} data-elm-row-divider="" aria-hidden="true" className="flex list-none">{children ?? <ToolbarDivider />}</Tag>
}
