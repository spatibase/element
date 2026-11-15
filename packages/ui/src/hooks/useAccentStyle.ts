import { createContext, useContext, useLayoutEffect, useMemo, type CSSProperties } from 'react'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { RootTokensContext } from './useRootTokens'

/**
 * CSS custom properties the host set on the editor root (`<ElementEditor style>`), e.g.
 * `--elm-accent` or a single `--elm-primary-N` shade. Body-level portals don't inherit
 * them, so `useAccentStyle()` copies them onto each portal root. `<ElementEditor>`
 * provides it; adapter users style their own root (see `useAccentStyle`).
 */
export const RootCssVarsContext = createContext<CSSProperties | undefined>(undefined)

/** Inline style that sets `--elm-accent`; undefined when no accent is configured (CSS default blue). */
export function accentStyle(accent: string | undefined): CSSProperties | undefined {
  return accent ? ({ '--elm-accent': accent } as CSSProperties) : undefined
}

/**
 * The editor root's theme for Element's body-level portals (modals, menus,
 * tooltips, drag clones, toasts): `--elm-accent` and every design token
 * (`--elm-surface`, `--elm-radius`, …) the integrator set. Portals sit outside
 * the editor root and don't inherit its CSS variables, so each portal root
 * spreads this into its `style`. The root must also carry `data-elm-theme`
 * (or `data-elm-portal`): the shared.css blocks that hold the token defaults
 * and derive `--color-primary-*` from `--elm-accent` are declared on those
 * selectors, and a var only re-resolves where it's declared.
 *
 * Merges, later winning: `config.accentColor`; the tokens resolved on the
 * editor root (RootTokensContext, so a stylesheet rule on the root such as
 * `.my-editor[data-elm-theme="dark"] { --elm-surface: … }` reaches portals too);
 * the CSS variables of `<ElementEditor style>` (RootCssVarsContext).
 */
export function useAccentStyle(): CSSProperties | undefined {
  const accent = useElementEditorConfig().accentColor
  const tokens = useContext(RootTokensContext)
  const vars = useContext(RootCssVarsContext)
  return useMemo(
    () => (tokens || vars ? { ...accentStyle(accent), ...tokens, ...vars } : accentStyle(accent)),
    [accent, tokens, vars],
  )
}

/**
 * Apply `config.accentColor` to the editor root for adapter users, whose
 * themed root (`[data-elm-theme]`) is their own element, not one we render.
 * `ElementEditorUIProvider` renders no DOM, so the provider can't style it; the
 * adapters' `ElementEditorControls` call this with `map.getContainer()` instead,
 * and the var goes on the nearest `[data-elm-theme]` ancestor (else the
 * container). This finds the root wherever it sits in the host's tree.
 *
 * Skips when the root already has that exact inline value, e.g. `<ElementEditor>`
 * sets it through React's `style`, so React keeps owning it there. Cleanup
 * only removes a value this hook wrote.
 */
export function useApplyAccentToRoot(container: HTMLElement | null | undefined): void {
  const accent = useElementEditorConfig().accentColor
  useLayoutEffect(() => {
    if (!container || !accent) return
    const root = (container.closest('[data-elm-theme]') as HTMLElement | null) ?? container
    if (root.style.getPropertyValue('--elm-accent') === accent) return
    root.style.setProperty('--elm-accent', accent)
    return () => {
      if (root.style.getPropertyValue('--elm-accent') === accent) root.style.removeProperty('--elm-accent')
    }
  }, [container, accent])
}
