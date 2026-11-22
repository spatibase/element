import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAccentStyle } from '../../hooks/useAccentStyle'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: ReactNode
  shortcut?: ReactNode
  side?: TooltipSide
  /** Wrap long text at a max width instead of one long line. */
  multiline?: boolean
  children: ReactNode
}

const GAP = 8       // px between anchor and tooltip
const MARGIN = 8    // px from viewport edge

function opposite(s: TooltipSide): TooltipSide {
  return s === 'top' ? 'bottom' : s === 'bottom' ? 'top' : s === 'left' ? 'right' : 'left'
}

export function Tooltip({ content, shortcut, side = 'top', multiline = false, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  // anchor rect of the wrapped element (live screen coords)
  const [anchor, setAnchor] = useState<{ left: number; top: number; right: number; bottom: number; cx: number; cy: number } | null>(null)
  // computed tooltip position
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // Tooltips are inverted vs the editor theme (dark UI → light tooltip). Read
  // the theme from the DOM: the portal sits outside [data-elm-theme], and the
  // adapters don't provide ThemeContext.
  const [light, setLight] = useState(false)
  const accentStyle = useAccentStyle()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // After the tooltip mounts, measure + auto-flip if it would overflow.
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current || !anchor) return
    const { width, height } = tooltipRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    const fits = (s: TooltipSide): boolean => {
      if (s === 'top')    return anchor.top - GAP - height >= MARGIN
      if (s === 'bottom') return anchor.bottom + GAP + height <= vh - MARGIN
      if (s === 'left')   return anchor.left - GAP - width >= MARGIN
      return anchor.right + GAP + width <= vw - MARGIN
    }

    // Pick the first side that fits, in this order: requested → opposite → orthogonals.
    const candidates: TooltipSide[] = (() => {
      const orth: TooltipSide[] = side === 'top' || side === 'bottom' ? ['right', 'left'] : ['bottom', 'top']
      return [side, opposite(side), ...orth]
    })()
    const chosen = candidates.find(fits) ?? side

    // Compute tooltip position based on chosen side.
    let left = 0
    let top = 0
    if (chosen === 'top') {
      left = anchor.cx - width / 2
      top = anchor.top - GAP - height
    } else if (chosen === 'bottom') {
      left = anchor.cx - width / 2
      top = anchor.bottom + GAP
    } else if (chosen === 'left') {
      left = anchor.left - GAP - width
      top = anchor.cy - height / 2
    } else {
      left = anchor.right + GAP
      top = anchor.cy - height / 2
    }
    // Clamp inside the viewport on both axes — the cross axis when the anchor
    // hugs an edge, the main axis too when no side fits at all — so the
    // tooltip is never cut off.
    left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN))
    top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN))
    setPos({ left: Math.round(left), top: Math.round(top) })
  }, [visible, anchor, side])

  function show() {
    // Zero delay to match Mantine's default openDelay — measured 9-23 ms on the
    // reference site, which is DOM-mutation observation noise, not a real delay.
    // setTimeout(_, 0) preserves the timerRef cancellation path used by hide().
    timerRef.current = setTimeout(() => {
      const rect = (wrapperRef.current?.firstElementChild ?? wrapperRef.current)?.getBoundingClientRect()
      if (!rect) return
      setPos(null) // hide via CSS visibility until measured
      setAnchor({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        cx: Math.round(rect.left + rect.width / 2),
        cy: Math.round(rect.top + rect.height / 2),
      })
      setLight(wrapperRef.current?.closest('[data-elm-theme]')?.getAttribute('data-elm-theme') === 'dark')
      setVisible(true)
    }, 0)
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }

  return (
    <div ref={wrapperRef} onMouseEnter={show} onMouseLeave={hide} className="contents">
      {children}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          data-elm-portal
          // The editor's mode (not the tooltip's inverted look): the --elm-tooltip tokens are
          // defined per editor mode, and the editor root's custom tokens are copied on (accentStyle).
          data-elm-theme={light ? 'dark' : 'light'}
          className="fixed z-[9999] pointer-events-none"
          style={{
            ...accentStyle,
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            visibility: pos ? undefined : 'hidden',
            // Match the Mantine "pop" tooltip transition exactly: 100ms ease,
            // scale(0.9) → scale(1), opacity 0 → 1, center origin, no slide.
            animation: pos ? 'elm-tooltip-in 100ms ease' : undefined,
          }}
        >
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-elm-card shadow-elm backdrop-blur-sm ${multiline ? 'max-w-64 whitespace-normal leading-snug' : 'whitespace-nowrap'} bg-elm-tooltip/95 text-elm-tooltip-text elm-kbd-on-tooltip ${light ? 'elm-tooltip-light' : ''}`}>
            <span>{content}</span>
            {shortcut && <span className="flex items-center gap-0.5 opacity-60">{shortcut}</span>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
