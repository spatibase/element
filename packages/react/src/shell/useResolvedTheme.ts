import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUIStore, useGeoStore, useElementEditorConfig } from '@element-editor/ui'
import { readStorage } from '@element-editor/core'
import type { ElementEditorBaseProps } from './types'

/**
 * Resolve theme mode for the data-elm-theme attribute.
 * Order:
 * - `theme` prop, when provided, syncs on every prop change (mirrors how
 *   `readonly` / `tools` work — props always win when they actually change).
 *   Between prop changes, in-editor theme switches stick because we only
 *   sync on prop *change*, not every render.
 * - On first mount with no `theme` prop and no persisted user choice, fall
 *   back to `config.mode`. (The store init already reads localStorage and
 *   defaults to 'system' on its own; this just lets `config.mode` win when
 *   localStorage is empty.)
 */
export function useResolvedTheme(theme: ElementEditorBaseProps['theme']): 'light' | 'dark' {
  const cfg = useElementEditorConfig()
  const { uiStore } = useGeoStore()
  const userTheme = useUIStore((s) => s.userTheme)

  const themeSeededFromConfig = useRef(false)
  if (!themeSeededFromConfig.current) {
    themeSeededFromConfig.current = true
    if (theme === undefined && cfg.mode !== 'system') {
      const stored = readStorage('elm_theme', cfg)
      // Seed state only — persisting would turn config into a "user choice"
      // and let one instance's config clobber another's.
      if (!stored) uiStore.setState({ userTheme: cfg.mode })
    }
  }

  // Layout effect, not render: updating the store while rendering re-renders
  // its other subscribers mid-render ("Cannot update a component while
  // rendering a different component"). It still lands before paint.
  useLayoutEffect(() => {
    if (theme !== undefined) {
      // Prop-driven: set state only. Persisting would make the host's prop
      // look like a user choice and leak it to other instances on the origin.
      uiStore.setState({ userTheme: theme === 'auto' ? 'system' : theme })
    }
  }, [theme, uiStore])

  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    if (userTheme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [userTheme])

  return userTheme === 'dark' ? 'dark' : userTheme === 'light' ? 'light' : systemDark ? 'dark' : 'light'
}
