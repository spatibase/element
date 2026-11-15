export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[11px] font-medium font-elm rounded-elm-chip border border-elm-border-strong bg-(--elm-surface-hover,var(--color-gray-100)) dark:bg-(--elm-surface-hover,var(--color-gray-700)) text-elm-text-muted shadow-[0_1px_0_0_rgba(0,0,0,0.15)] dark:shadow-[0_1px_0_0_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  )
}

/**
 * Kbd variant for tooltips and context menus. Neutral greys by default; once the
 * integrator sets the design tokens of its container (tooltip: --elm-tooltip +
 * --elm-tooltip-text, menu: --elm-surface + --elm-text) it is mixed from them
 * (`--_elm-kbd-*`, shared.css).
 */
export function KbdDark({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 text-[10px] font-medium font-elm rounded-elm-chip border border-(--_elm-kbd-border,var(--color-neutral-600)) bg-(--_elm-kbd-bg,var(--color-neutral-700)) text-(--_elm-kbd-text,var(--color-neutral-300)) in-[.elm-tooltip-light]:border-(--_elm-kbd-border,var(--color-neutral-300)) in-[.elm-tooltip-light]:bg-(--_elm-kbd-bg,var(--color-neutral-100)) in-[.elm-tooltip-light]:text-(--_elm-kbd-text,var(--color-neutral-600)) in-[.elm-tooltip-light]:shadow-[0_1px_0_0_rgba(0,0,0,0.12)] shadow-[0_1px_0_0_rgba(0,0,0,0.3)] leading-none">
      {children}
    </kbd>
  )
}

/** Kbd variant for use on colored backgrounds (e.g. inside a primary button). */
export function KbdInvert({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[11px] font-medium font-elm rounded-elm-chip border border-primary-400 bg-primary-500 text-primary-100 shadow-[0_1px_0_0_rgba(0,0,0,0.2)]">
      {children}
    </kbd>
  )
}
