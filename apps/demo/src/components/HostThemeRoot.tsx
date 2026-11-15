import { useEffect, useState, type HTMLAttributes } from 'react'
import { useUIStore } from '@element-editor/ui'

/**
 * The adapter demos' themed root. As a real host app would, it owns
 * `data-elm-theme` — here driven by the editor's own Light/Dark/System setting
 * so the adapter tabs follow it (`<ElementEditor>` does this internally).
 */
export function HostThemeRoot(props: HTMLAttributes<HTMLDivElement>) {
  const userTheme = useUIStore((s) => s.userTheme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const dark = userTheme === 'dark' || (userTheme === 'system' && systemDark)
  return <div data-elm-theme={dark ? 'dark' : 'light'} {...props} />
}
