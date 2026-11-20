import { createElement, lazy, useState, type ComponentProps, type ComponentType } from 'react'

const preloaders: Array<() => Promise<unknown>> = []

type Loader<T extends ComponentType<any>> = () => Promise<{ default: T }>

/**
 * `React.lazy` plus `.preload()` — start fetching the chunk before first render.
 * Once the chunk is in, it renders the component directly: React.lazy would
 * still suspend on its first render (the resolved promise is only read a
 * microtask later), and React 19 holds back revealing a suspended boundary's
 * content for ~300 ms — the GeoJSON inspector opened ~280 ms late because of it.
 */
export function lazyWithPreload<T extends ComponentType<any>>(load: Loader<T>): T & { preload: () => Promise<unknown> } {
  let promise: Promise<{ default: T }> | null = null
  let loaded: T | null = null
  const once = () => (promise ??= load().then((m) => { loaded = m.default; return m }))
  const Lazy = lazy(once)
  function Preloaded(props: ComponentProps<T>) {
    // Per instance, so one that mounted through Lazy doesn't remount when the chunk lands.
    const [C] = useState<ComponentType<any>>(() => loaded ?? Lazy)
    return createElement(C, props)
  }
  // Self-registers for preloadEditorPanelsWhenIdle(). Call sites are marked /*#__PURE__*/, so a host
  // that never renders (or imports) a panel drops it, its registration and its chunk from its bundle.
  preloaders[preloaders.length] = once
  // Typed as T so the emitted .d.ts names the component, not its (unexported) props.
  return Object.assign(Preloaded as unknown as T, { preload: once })
}

let scheduled = false
/**
 * Fetch every lazy editor panel that is part of the host's bundle (GeoJSON inspector, data table, modals…) once
 * the browser is idle, so their first open is instant instead of waiting on a
 * chunk download. Idle-time only: never competes with the initial render.
 */
export function preloadEditorPanelsWhenIdle() {
  if (scheduled || typeof window === 'undefined') return
  scheduled = true
  const run = () => { for (const p of preloaders) p().catch(() => {}) }
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
