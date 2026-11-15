import { createContext, useContext, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { warnOnce } from '@element-editor/core/internal'
import { RootTokensContext, useRootTokens } from '../hooks/useRootTokens'

export type ResolvedTheme = 'light' | 'dark'

export const ThemeContext = createContext<ResolvedTheme>('light')
export const useTheme = () => useContext(ThemeContext)

/**
 * Adapter setups (`<ElementEditorUIProvider>`) render no DOM — the host owns the
 * `[data-elm-theme]` root. The provider holds the theme in state; the map-side
 * `<ElementEditorControls>` reports what the host's root actually says (see
 * `useReportThemeFromRoot`). `<ElementEditor>` provides ThemeContext itself and has
 * no reporter, so the report is a no-op there.
 */
const ThemeReporterContext = createContext<((theme: ResolvedTheme) => void) | null>(null)
// The host root's custom design tokens, reported the same way, for Element's body-level portals.
const TokenReporterContext = createContext<((tokens: CSSProperties | undefined) => void) | null>(null)

export function ThemeReportingProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ResolvedTheme>('light')
  const [tokens, setTokens] = useState<CSSProperties | undefined>(undefined)
  return (
    <ThemeReporterContext.Provider value={setTheme}>
      <TokenReporterContext.Provider value={setTokens}>
        <ThemeContext.Provider value={theme}>
          <RootTokensContext.Provider value={tokens}>{children}</RootTokensContext.Provider>
        </ThemeContext.Provider>
      </TokenReporterContext.Provider>
    </ThemeReporterContext.Provider>
  )
}

/**
 * Read `data-elm-theme` from the element's themed root and keep the provider in
 * sync, along with the design tokens the host set on that root (for portals).
 */
export function useReportThemeFromRoot(el: HTMLElement | null) {
  const report = useContext(ThemeReporterContext)
  const reportTokens = useContext(TokenReporterContext)
  const tokens = useRootTokens(reportTokens && el ? (el.closest('[data-elm-theme]') as HTMLElement | null) : null)
  useLayoutEffect(() => { reportTokens?.(tokens as CSSProperties | undefined) }, [reportTokens, tokens])
  useLayoutEffect(() => {
    if (!report || !el) return
    const root = el.closest('[data-elm-theme]')
    if (!root) {
      // Adapter setups only (the drop-in has no reporter): without the themed root the editor UI
      // renders unstyled (preflight + theme colours are scoped to it) and shortcuts never fire.
      warnOnce('adapter-no-theme-root', 'The map container is not inside an element with a `data-elm-theme` attribute, so the editor UI renders unstyled and keyboard shortcuts are off. Wrap the map and the editor UI in one element: <div data-elm-theme="light" style={{ position: \'relative\', height: 600 }}>…</div> ("dark" for dark mode).')
      return
    }
    const read = () => report(root.getAttribute('data-elm-theme') === 'dark' ? 'dark' : 'light')
    read()
    const mo = new MutationObserver(read)
    mo.observe(root, { attributes: true, attributeFilter: ['data-elm-theme'] })
    return () => mo.disconnect()
  }, [report, el])
}
