#!/usr/bin/env node
// Flatten CSS cascade layers out of built stylesheets: `node scripts/flatten-css.mjs <file.css> ...`
// (rewrites in place; run by each package's `build` after `vite build`).
//
// Why: the stylesheets are compiled from Tailwind v4 source, whose output is wrapped in
// `@layer theme, base, components, utilities`. A host that runs Tailwind v3 (or any PostCSS setup
// that treats `@layer` as a Tailwind directive) fails the build on it, and host CSS is almost always
// unlayered, which beats every layered rule. The published files must be plain scoped CSS.
//
// How: every `@layer` block is replaced by its content, and the top-level nodes are re-emitted in
// cascade order: layers by declaration order (theme < base < components < utilities, `rdg.*` sublayers
// in their own order, a layer's direct rules after its sublayers), unlayered rules last. Within a
// layer the original order is kept. This reproduces the layered cascade for normal declarations
// wherever specificity does not contradict layer order (scripts/check-dist.mjs and the audit notes in
// the devlog cover the exceptions; `!important` inverts layer order, so none may live in a layer).
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import postcss from 'postcss'

const LAST = Number.POSITIVE_INFINITY

export function flattenCss(css, from = 'input.css') {
  const root = postcss.parse(css, { from })
  const order = { children: new Map() } // layer name tree, in order of first appearance
  const register = (names) => {
    let node = order
    const path = []
    for (const name of names) {
      if (!node.children.has(name)) node.children.set(name, { idx: node.children.size, children: new Map() })
      node = node.children.get(name)
      path.push(node.idx)
    }
    return path
  }
  const nameList = (params) => params.split(',').map((s) => s.trim().split('.'))

  const out = [] // { key, node }
  const visit = (node, prefix, names) => {
    for (const child of [...node.nodes]) {
      if (child.type === 'atrule' && child.name === 'layer') {
        if (!child.nodes) {
          for (const n of nameList(child.params)) register([...names, ...n]) // layer statement: order only
        } else {
          if (!child.params.trim()) throw new Error('anonymous @layer blocks cannot be flattened')
          const full = [...names, ...child.params.trim().split('.')]
          visit(child, register(full), full)
        }
      } else if (prefix) {
        out.push({ key: [...prefix, LAST], node: child })
      } else {
        out.push({ key: [LAST], node: child })
      }
    }
  }
  visit(root, null, [])

  const cmp = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? -1, y = b[i] ?? -1
      if (x !== y) return x < y ? -1 : 1
    }
    return 0
  }
  out.sort((a, b) => cmp(a.key, b.key)) // stable: original order within a layer
  const result = postcss.root()
  for (const { node } of out) result.append(node.clone())
  return result.toString()
}

// Bare `@layer` / `@tailwind` / `@apply` / `@theme` / `@source` / `@config` / `@plugin` / `@utility` / `@variant`
// / `@custom-variant` / `@import "tailwindcss…"` anywhere in the text: the directives a host's PostCSS could reinterpret.
export function findDirectives(css) {
  const found = new Set()
  postcss.parse(css).walkAtRules((a) => {
    if (/^(layer|tailwind|apply|theme|source|config|plugin|utility|variant|custom-variant|reference)$/.test(a.name)) found.add(`@${a.name}`)
    if (a.name === 'import' && /tailwindcss/.test(a.params)) found.add('@import tailwindcss')
  })
  return [...found]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('usage: flatten-css.mjs <file.css> ...'); process.exit(2) }
  for (const f of files) {
    const before = readFileSync(f, 'utf8')
    const after = flattenCss(before, f)
    const left = findDirectives(after)
    if (left.length) { console.error(`${f}: still contains ${left.join(', ')}`); process.exit(1) }
    writeFileSync(f, after)
    console.log(`flattened ${f}: ${before.length} -> ${after.length} bytes`)
  }
}
