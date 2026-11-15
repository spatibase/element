#!/usr/bin/env node
// Check the hand-written API reference against the BUILT types (run after `pnpm build`):
// `pnpm check:docs`. Prose stays hand-written; this only fails when the member lists drift.
//
// - Every ```ts block in docs/reference/*.md (and packages/react/AGENTS.md) that declares
//   `interface X { … }`, where X is exported by that page's package: its members must be exactly
//   X's members (inherited ones included).
// - The prop tables in TABLES: row names (first column) must match the type's members; with a
//   Required column, "Yes" must match a non-optional member. `subset` tables (deltas) only need
//   every row to exist.
// Tables are found by heading, not by markers: the docs site renders these files as MDX, where
// `<!-- -->` comments don't compile.
import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ref = (f) => join(root, 'docs/reference', f)
// Interface-block pages, relative to the repo root.
const PAGE_MODULE = {
  'docs/reference/element-editor-react.md': '@element-editor/react',
  'docs/reference/element-editor-ui.md': '@element-editor/ui',
  'docs/reference/adapter-leaflet.md': '@element-editor/adapter-leaflet',
  'docs/reference/adapter-maplibre.md': '@element-editor/adapter-maplibre',
  'docs/reference/types.md': '@element-editor/core',
  'docs/reference/events.md': '@element-editor/ui',
  // Shipped in the npm tarball for coding agents: its ref API block must match the types too.
  'packages/react/AGENTS.md': '@element-editor/react',
}
const TABLES = [
  // The main table also lists the Leaflet-only `renderer` (marked as such in its row).
  { page: 'element-editor-react.md', heading: '## `ElementEditorProps`', module: '@element-editor/react', type: 'ElementEditorProps', extra: ['renderer'] },
  { page: 'element-editor-react.md', heading: '## Leaflet drop-in', module: '@element-editor/react/leaflet', type: 'ElementEditorProps', subset: true },
  { page: 'adapter-maplibre.md', heading: '## `ElementEditorControlsProps`', module: '@element-editor/adapter-maplibre', type: 'ElementEditorControlsProps' },
  { page: 'adapter-leaflet.md', heading: '## `ElementEditorControlsProps`', module: '@element-editor/adapter-leaflet', type: 'ElementEditorControlsProps' },
  { page: 'adapter-maplibre.md', heading: '## `ElementEditorUIProvider`', module: '@element-editor/ui', type: 'ElementEditorUIProviderProps' },
  { page: 'adapter-leaflet.md', heading: '## `ElementEditorUIProvider`', module: '@element-editor/ui', type: 'ElementEditorUIProviderProps' },
  // No exported props type: `component` reads the props from the component's first parameter.
  { page: 'element-editor-ui.md', heading: '### `EventProvider`', module: '@element-editor/ui', type: 'EventProvider', component: true },
]

// Resolve each package the way a consumer does (exports -> dist .d.ts), from inside packages/react.
const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true, noEmit: true }
const from = join(root, 'packages/react/__api_docs__.ts')
// A page's interface blocks may show types its package doesn't re-export (`MutationOptions` on the
// react page lives in ui): looked up in the page's package first, then in these.
const FALLBACK = ['@element-editor/ui', '@element-editor/core']
const modules = [...new Set([...Object.values(PAGE_MODULE), ...TABLES.map((t) => t.module), ...FALLBACK])]
const fileOf = Object.fromEntries(modules.map((m) => {
  const r = ts.resolveModuleName(m, from, options, ts.sys).resolvedModule
  if (!r) throw new Error(`can't resolve ${m} (run pnpm build first)`)
  return [m, r.resolvedFileName]
}))
const program = ts.createProgram(Object.values(fileOf), options)
const checker = program.getTypeChecker()
const exportsOf = (m) => checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(fileOf[m])))
// name -> required?, for a type's members (or a component's props). `@internal` members don't count.
function members(module, name, component = false) {
  let sym = exportsOf(module).find((s) => s.name === name)
  if (!sym) return null
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym)
  const type = component
    ? checker.getTypeOfSymbol(checker.getTypeOfSymbol(sym).getCallSignatures()[0].parameters[0])
    : checker.getDeclaredTypeOfSymbol(sym)
  return new Map(checker.getPropertiesOfType(type)
    .filter((p) => !p.declarations?.some((d) => ts.getJSDocTags(d).some((t) => t.tagName.text === 'internal')))
    .map((p) => [p.name, !(p.flags & ts.SymbolFlags.Optional)]))
}

const failures = []
const fail = (where, msg) => failures.push(`${where}: ${msg}`)
const diff = (where, what, actual, documented, subset) => {
  const missing = subset ? [] : [...actual].filter((n) => !documented.has(n) && n !== 'children') // tables leave children implicit
  const stale = [...documented].filter((n) => !actual.has(n))
  if (missing.length) fail(where, `${what}: not documented: ${missing.join(', ')}`)
  if (stale.length) fail(where, `${what}: documented but not in the type: ${stale.join(', ')}`)
}
let checked = 0

// 1. Interface blocks.
for (const [page, module] of Object.entries(PAGE_MODULE)) {
  const lines = readFileSync(join(root, page), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ts\b/.test(lines[i])) continue
    let j = i + 1
    while (j < lines.length && !/^```\s*$/.test(lines[j])) j++
    const sf = ts.createSourceFile('block.ts', lines.slice(i + 1, j).join('\n'), ts.ScriptTarget.Latest, true)
    for (const s of sf.statements) {
      if (!ts.isInterfaceDeclaration(s)) continue
      const name = s.name.text, line = i + 2 + sf.getLineAndCharacterOfPosition(s.getStart()).line
      const actual = [module, ...FALLBACK].map((m) => members(m, name)).find(Boolean)
      if (!actual) { fail(`${page}:${line}`, `interface ${name} is not exported by ${[module, ...FALLBACK].join(', ')}`); continue }
      const documented = new Set(s.members.map((m) => m.name?.getText(sf)).filter(Boolean))
      const inherited = s.heritageClauses?.length // `extends X`: X's members aren't listed here
      diff(`${page}:${line}`, `interface ${name}`, new Set(actual.keys()), documented, inherited)
      checked++
    }
    i = j
  }
}

// 2. Prop tables.
for (const t of TABLES) {
  const lines = readFileSync(ref(t.page), 'utf8').split('\n')
  const at = lines.findIndex((l) => l.trim() === t.heading)
  const where = `docs/reference/${t.page}:${at + 1}`
  if (at < 0) { fail(`docs/reference/${t.page}`, `heading not found: ${t.heading}`); continue }
  const actual = members(t.module, t.type, t.component)
  if (!actual) { fail(where, `${t.type} is not exported by ${t.module}`); continue }
  const rows = new Map()
  let header = null
  for (let i = at + 1; i < lines.length && !/^#{1,3} /.test(lines[i]); i++) {
    if (!lines[i].startsWith('|')) { if (header && rows.size) break; continue } // first table only
    const cells = lines[i].split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())
    if (!header) { header = cells; continue }
    if (/^-+$/.test(cells[0])) continue
    const required = header.indexOf('Required') // cells may be bold: **Yes**
    // A row may name several props: `basemap` / `defaultBasemap`.
    for (const [, name] of cells[0].matchAll(/`(\w+)`/g)) rows.set(name, required < 0 ? null : cells[required].replace(/\*/g, '') === 'Yes')
  }
  const documented = new Set([...rows.keys()].filter((n) => !t.extra?.includes(n)))
  diff(where, `${t.type} table`, new Set(actual.keys()), documented, t.subset)
  for (const [name, req] of rows) {
    if (req !== null && actual.has(name) && actual.get(name) !== req)
      fail(where, `${t.type} table: \`${name}\` is ${actual.get(name) ? 'required' : 'optional'} but the table says Required: ${req ? 'Yes' : 'No'}`)
  }
  checked++
}

console.log(`api docs: ${checked} interface blocks and prop tables checked against dist types`)
if (failures.length) {
  if (process.env.GITHUB_ACTIONS) for (const f of failures) {
    const [, file, line, msg] = f.match(/^([^:]+):?(\d*): (.*)$/) ?? []
    console.log(`::error file=${file},line=${line || 1}::${msg}`)
  }
  console.error(failures.join('\n'))
  console.error(`\n${failures.length} API reference mismatch(es).`)
  process.exit(1)
}
console.log('API reference matches the types.')
