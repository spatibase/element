// Scope the published stylesheets to Element's own DOM (run by scripts/flatten-css.mjs after the
// layers are flattened; `checkScoped` is used by scripts/check-dist.mjs).
//
// Why: the published CSS is unlayered and usually loads after the host's own CSS, so any global rule
// in it overrides the host: Tailwind utilities (`.hidden`, `.absolute`, `md:flex`…), the theme
// variables on `:root`, the `--tw-*` fallback resets. Every rule must match only elements inside
// Element's roots (the roots included: they carry utility classes).
//
// How: each selector of a non-vendor rule gets `:where(SCOPE)` appended to its subject compound
// (before any pseudo-element), so specificity and order are unchanged and the cascade inside Element
// is exactly what it was. The original selector comes first, so only elements that already match it
// evaluate the scope, and the scope is spelled as plain `ROOT` / `ROOT *` compounds (a `:is(ROOTS) *`
// form cannot use the browser's ancestor filter: ~55 ms per style recalc at 5k features).
// `:root` / `:host` (the Tailwind theme variables, the accent scale) become the OUTERMOST roots, so a
// root nested in another (a feature tooltip inside a dark editor) still inherits its ancestor's
// values, as it did from :root.
//
// Left global, by design:
//   - vendor CSS bundled in, namespaced by its own class names: leaflet.css (`.leaflet-*`),
//     maplibre-gl.css (`.maplibregl-*`, `.mapboxgl-*`) and react-data-grid (its `@layer rdg.*`
//     rules, hashed class names). The host's own maps/grids load the same files.
//   - rules whose every class / attribute is Element-namespaced (`.elm-*`, `[data-elm-*]`).
//   - `@property --tw-*` (cannot be scoped; see the comment in check-dist.mjs) and `@keyframes`
//     (Element-prefixed names, `elm-*`).

/** Element's root elements. Keep in sync with the scoped preflight in packages/ui/src/styles/shared.css
 *  (scripts/check-dist.mjs verifies that its lists equal this one). */
export const ROOTS = [
  '[data-elm-theme]',
  '[data-elm-portal]',
  '[data-elm-context-menu]',
  '[role=dialog][aria-label="Edit feature"]',
  'body>.z-\\[9999\\]',
  'body>[data-rfd-draggable-id]',
  '.elm-feature-tooltip',
]

/** Matches a root or anything inside one. Descendant forms first: almost every element that reaches
 *  the scope is inside the editor root, so the first alternative usually decides. */
export const SCOPE = `:where(${[...ROOTS.map((r) => `${r} *`), ...ROOTS].join(',')})`
/** The outermost roots only (where `:root` used to sit), zero specificity. */
export const OUTER = `:where(${ROOTS.join(',')}):not(:where(${ROOTS.map((r) => `${r} *`).join(',')}))`

const VENDOR_CLASS = /^(leaflet-|maplibregl-|mapboxgl-)/
const ELM_CLASS = /^elm-/
const ELM_ATTR = /^data-elm-/

// ─── Tiny selector tokenizer (enough for minified Tailwind / lightningcss output) ──────────────

/** Split at top-level occurrences of `sep` (a char test), outside (), [], strings and escapes. */
function splitTop(s, isSep) {
  const out = []
  let depth = 0, quote = null, start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') { i++; continue }
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && isSep(c, i)) { out.push(s.slice(start, i)); start = i + 1 }
  }
  out.push(s.slice(start))
  return out
}

export const splitList = (sel) => splitTop(sel, (c) => c === ',').map((s) => s.trim()).filter(Boolean)

/** A complex selector as [compound, combinator, compound, …]; combinators are ' ', '>', '+', '~'. */
export function splitComplex(sel) {
  const parts = []
  let depth = 0, quote = null, cur = '', pendingComb = null
  const flush = () => { if (cur) { if (parts.length) parts.push(pendingComb ?? ' '); parts.push(cur); cur = ''; pendingComb = null } }
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (c === '\\') { cur += c + (sel[i + 1] ?? ''); i++; continue }
    if (quote) { cur += c; if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~' || c === '\n' || c === '\t')) {
      if (cur) { const keep = cur; cur = ''; if (parts.length) parts.push(pendingComb ?? ' '); parts.push(keep); pendingComb = null }
      if (c !== ' ' && c !== '\n' && c !== '\t') pendingComb = c
      else if (pendingComb === null) pendingComb = ' '
      continue
    }
    cur += c
  }
  flush()
  return parts
}

const LEGACY_PSEUDO_EL = /^:(before|after|first-line|first-letter)(?![\w-])/i

/** Index of the first top-level pseudo-element in a compound, or -1. */
function pseudoElementIndex(compound) {
  let depth = 0, quote = null
  for (let i = 0; i < compound.length; i++) {
    const c = compound[i]
    if (c === '\\') { i++; continue }
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && c === ':') {
      if (compound[i + 1] === ':' || LEGACY_PSEUDO_EL.test(compound.slice(i))) return i
    }
  }
  return -1
}

/** Class names, attribute names, and top-level :is()/:where()/:not()/:has() arguments of a compound. */
function simpleParts(compound) {
  const classes = [], attrs = [], fns = []
  for (let i = 0; i < compound.length; i++) {
    const c = compound[i]
    if (c === '.') {
      let j = i + 1, name = ''
      while (j < compound.length && /[^.#:[\s>+~(),]/.test(compound[j])) { if (compound[j] === '\\') { name += compound[j + 1]; j += 2 } else name += compound[j++] }
      classes.push(name); i = j - 1
    } else if (c === '[') {
      let depth = 1, j = i + 1
      while (j < compound.length && depth) { if (compound[j] === '\\') j++; else if (compound[j] === '[') depth++; else if (compound[j] === ']') depth--; j++ }
      attrs.push(compound.slice(i + 1, j - 1).split(/[~|^$*]?=/)[0].trim()); i = j - 1
    } else if (c === ':') {
      const m = /^::?([\w-]+)(\()?/.exec(compound.slice(i))
      if (!m) continue
      if (m[2]) {
        let depth = 1, j = i + m[0].length
        const s = j
        while (j < compound.length && depth) { if (compound[j] === '\\') j++; else if (compound[j] === '(') depth++; else if (compound[j] === ')') depth--; j++ }
        fns.push({ name: m[1], args: compound.slice(s, j - 1) }); i = j - 1
      } else i += m[0].length - 1
    }
  }
  return { classes, attrs, fns }
}

// ─── Classification ────────────────────────────────────────────────────────────────────────────

/** Whitespace around combinators and quotes around identifier attribute values don't matter. */
export const norm = (s) => s.replace(/\s*([>+~,])\s*/g, '$1').replace(/\s+/g, ' ').replace(/=(["'])([\w-]+)\1\]/g, '=$2]').trim()
const ROOT_SET = new Set(ROOTS.map(norm))
const ROOT_DESC_SET = new Set(ROOTS.map((r) => norm(`${r} *`)))
const ROOT_ATTR = /^data-elm-(theme|portal|context-menu)$/

/** True when a compound only matches root elements. */
function compoundIsRoot(compound) {
  const { classes, attrs, fns } = simpleParts(compound)
  if (attrs.some((a) => ROOT_ATTR.test(a)) || classes.includes('elm-feature-tooltip')) return true
  return fns.some((f) => (f.name === 'where' || f.name === 'is') && splitList(f.args).every((alt) => isScoped(alt)))
}

/** True when a complex selector can only match elements inside (or at) Element's roots. */
export function isScoped(sel) {
  const n = norm(sel)
  if (ROOT_SET.has(n) || ROOT_DESC_SET.has(n)) return true
  const parts = splitComplex(sel)
  // The subject, or an ancestor reached only through descendant/child combinators, is a root.
  for (let i = parts.length - 1; i >= 0; i -= 2) {
    if (compoundIsRoot(parts[i])) return true
    const comb = parts[i - 1]
    if (comb !== ' ' && comb !== '>') return false
  }
  return false
}

/** True when every class and attribute in the selector is vendor- or Element-namespaced (and it has
 *  at least one), or one of the extra vendor classes (react-data-grid's hashed names). */
export function isNamespaced(sel, vendorClasses = new Set()) {
  let any = false, ok = true
  // Names inside :not() don't constrain the match, so they never count as the namespace.
  const visit = (s, negated) => {
    for (const part of splitComplex(s)) {
      if (part.length === 1 && /[ >+~]/.test(part)) continue
      const { classes, attrs, fns } = simpleParts(part)
      for (const c of classes) {
        const named = VENDOR_CLASS.test(c) || ELM_CLASS.test(c) || vendorClasses.has(c)
        if (!named) ok = false
        else if (!negated) any = true
      }
      for (const a of attrs) if (ELM_ATTR.test(a) && !negated) any = true
      for (const f of fns) for (const alt of splitList(f.args)) visit(alt, negated || f.name === 'not')
    }
  }
  visit(sel, false)
  return any && ok
}

/** Append the scope to the subject compound of one complex selector. */
export function scopeSelector(sel) {
  const t = sel.trim()
  if (t === ':root' || t === ':host') return OUTER
  const parts = splitComplex(t)
  const last = parts[parts.length - 1]
  const at = pseudoElementIndex(last)
  parts[parts.length - 1] = at < 0 ? last + SCOPE : (at === 0 ? SCOPE : last.slice(0, at) + SCOPE) + last.slice(at)
  return parts.join('')
}

const inKeyframes = (rule) => {
  for (let p = rule.parent; p; p = p.parent) if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true
  return false
}

/**
 * Scope every rule of a postcss root in place. `skip(rule)` marks vendor rules to leave alone
 * (flatten-css passes the react-data-grid layer's rules). Returns counts for the build log.
 */
export function scopeRoot(root, { skip = () => false } = {}) {
  const stats = { scoped: 0, already: 0, namespaced: 0, vendor: 0 }
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return
    if (skip(rule)) { stats.vendor++; return }
    const sels = splitList(rule.selector)
    const out = []
    let changed = false
    for (const s of sels) {
      if (isScoped(s)) { stats.already++; out.push(s); continue }
      if (isNamespaced(s)) { stats.namespaced++; out.push(s); continue }
      const scoped = scopeSelector(s)
      if (!out.includes(scoped)) out.push(scoped)
      stats.scoped++
      changed = true
    }
    if (changed) rule.selector = out.join(',')
  })
  return stats
}

/** Selectors of a postcss root that are neither scoped nor namespaced (check-dist). */
export function unscopedSelectors(root, vendorClasses) {
  const bad = []
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return
    for (const s of splitList(rule.selector)) if (!isScoped(s) && !isNamespaced(s, vendorClasses)) bad.push(s)
  })
  return bad
}
