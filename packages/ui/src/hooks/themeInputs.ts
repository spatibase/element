/**
 * Watch everything that can change the CSS variables resolved on an editor root:
 * the root's `style` / `class` / `data-elm-theme`, `<html>`'s `style` / `class`,
 * stylesheets added to, removed from or edited in `<head>`, and `<link>` loads.
 * Calls `onChange` (the caller batches it). Shared by `useAccentPalette` and
 * `useRootTokens`.
 *
 * ponytail: CSSOM edits (insertRule, adoptedStyleSheets, constructable sheets)
 * and <style> outside <head> fire no event; re-set a token on the root to nudge it.
 */

const ROOT_ATTRS: MutationObserverInit = { attributes: true, attributeFilter: ['style', 'class', 'data-elm-theme'] }
const HTML_ATTRS: MutationObserverInit = { attributes: true, attributeFilter: ['style', 'class'] }
// <style>/<link> added or removed, a <style>'s text edited (HMR), a link's href/media/disabled flipped.
const HEAD: MutationObserverInit = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] }

// Layout vars Element writes on its root (panel resize: every mousemove). They never change
// a theme value, and re-reading one forces a style recalc of the whole editor (~70 ms at 5k features).
const LAYOUT_VARS = new Set([
  '--elm-panel-offset', '--elm-table-offset', '--elm-bottom-row-height', '--elm-bottom-stack-offset',
  '--elm-bottom-toolbar-offset', '--elm-left-center-shift', '--elm-right-center-shift',
])

/** The root's theme-relevant inputs as one string: class, mode and inline style minus layout vars. */
export const themeInputs = (root: Element | null) => {
  if (!(root instanceof HTMLElement)) return ''
  let out = `${root.className}|${root.getAttribute('data-elm-theme') ?? ''}`
  for (const p of root.style) if (!LAYOUT_VARS.has(p) && !p.startsWith('transition')) out += `;${p}:${root.style.getPropertyValue(p)}`
  return out
}

/** Start watching; returns the cleanup. `onChange` may fire several times per frame: batch it. */
export function watchThemeInputs(root: Element | null, onChange: () => void): () => void {
  const onLoad = (e: Event) => { if (e.target instanceof HTMLLinkElement) onChange() }
  let inputs = themeInputs(root)
  const mo = new MutationObserver((records) => {
    const prev = inputs
    inputs = themeInputs(root)
    // A root mutation that only touched layout vars changes nothing we read.
    if (inputs === prev && records.every((r) => r.target === root)) return
    onChange()
  })
  if (root) mo.observe(root, ROOT_ATTRS)
  mo.observe(document.documentElement, HTML_ATTRS)
  mo.observe(document.head, HEAD)
  document.addEventListener('load', onLoad, true) // load doesn't bubble; capture sees link loads
  return () => {
    mo.disconnect()
    document.removeEventListener('load', onLoad, true)
  }
}
