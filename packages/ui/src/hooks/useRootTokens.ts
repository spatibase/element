import { createContext, useEffect, useState, type CSSProperties } from 'react'
import { watchThemeInputs } from './themeInputs'

/**
 * The public design tokens. Element never declares them itself (its
 * defaults live in private `--_elm-*` variables, see ui/src/styles/shared.css),
 * so a token with a non-empty computed value on the editor root is one the
 * integrator set: through a stylesheet rule (`.my-editor[data-elm-theme="dark"]`,
 * `[data-elm-theme]`, `:root`, an ancestor class), through `style`, or through
 * `accentColor`. Keep in sync with shared.css and docs/guides/theming.md.
 */
export const THEME_TOKENS = [
  '--elm-font', '--elm-font-mono',
  '--elm-radius', '--elm-radius-control',
  '--elm-shadow', '--elm-shadow-raised', '--elm-shadow-control',
  '--elm-surface', '--elm-surface-raised', '--elm-surface-sunken', '--elm-surface-hover', '--elm-control-hover',
  '--elm-text', '--elm-text-secondary', '--elm-text-muted', '--elm-text-subtle', '--elm-text-disabled',
  '--elm-border', '--elm-border-subtle', '--elm-border-strong',
  '--elm-focus-ring',
  '--elm-tooltip', '--elm-tooltip-text',
] as const

/** Everything copied onto portals: the design tokens plus the accent and its per-shade overrides. */
const FORWARDED: readonly string[] = [
  ...THEME_TOKENS,
  '--elm-accent',
  ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `--elm-primary-${n}`),
]

/**
 * The root's custom tokens as resolved by the browser (`{ '--elm-surface': '#fdf8f0', … }`),
 * or undefined when none is set. Reads computed style: call it on theme changes, not per frame.
 */
export function readRootTokens(root: Element | null | undefined): Record<string, string> | undefined {
  if (!root) return undefined
  const cs = getComputedStyle(root)
  let out: Record<string, string> | undefined
  for (const name of FORWARDED) {
    const v = cs.getPropertyValue(name).trim()
    if (v) (out ??= {})[name] = v
  }
  return out
}

const sameTokens = (a: Record<string, string> | undefined, b: Record<string, string> | undefined) => {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * The editor root's custom tokens, kept current: re-read (once per frame at most)
 * when the root's style/class/mode, `<html>`'s style/class or the page's
 * stylesheets change. Same object while nothing changed. Body-level portals
 * spread it (through `useAccentStyle()`), because they sit outside the root and
 * a rule like `.my-editor[data-elm-theme="dark"] { --elm-surface: … }` never
 * matches them.
 */
export function useRootTokens(root: HTMLElement | null | undefined): Record<string, string> | undefined {
  const [tokens, setTokens] = useState<Record<string, string> | undefined>(undefined)
  useEffect(() => {
    if (!root) { setTokens(undefined); return }
    const update = () => {
      const next = readRootTokens(root)
      setTokens((prev) => (sameTokens(prev, next) ? prev : next))
    }
    let frame = 0
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update() }) }
    update()
    const stop = watchThemeInputs(root, schedule)
    return () => {
      stop()
      cancelAnimationFrame(frame)
    }
  }, [root])
  return tokens
}

/** The editor root's custom tokens for portals; provided by `<ElementEditor>` and `ElementEditorUIProvider`. */
export const RootTokensContext = createContext<CSSProperties | undefined>(undefined)

/**
 * Copy the root's custom tokens onto a body-level element that isn't rendered by
 * React (the hover name tooltip). Cached per root by its theme inputs, so a hover
 * reads computed style only when the root's style/class/mode changed. Clears
 * tokens set by a previous call that the root no longer has.
 */
const applied = new WeakMap<HTMLElement, { root: Element; key: string; names: string[] }>()
export function applyRootTokens(el: HTMLElement, root: Element | null | undefined): void {
  if (!root) return
  const key = (root instanceof HTMLElement ? root.className + '|' + root.getAttribute('data-elm-theme') + '|' + (root.getAttribute('style') ?? '') : '')
    + '|' + document.documentElement.className + '|' + (document.documentElement.getAttribute('style') ?? '')
  const prev = applied.get(el)
  if (prev && prev.root === root && prev.key === key) return
  const tokens = readRootTokens(root) ?? {}
  for (const n of prev?.names ?? []) if (!(n in tokens)) el.style.removeProperty(n)
  for (const [n, v] of Object.entries(tokens)) el.style.setProperty(n, v)
  applied.set(el, { root, key, names: Object.keys(tokens) })
}
