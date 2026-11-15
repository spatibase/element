#!/usr/bin/env node
// Type-check every ```ts / ```tsx block in docs/**, the READMEs and AGENTS.md files against the BUILT packages
// (run after `pnpm build`): `pnpm check:docs`. Fence conventions are listed below.
//
// - Blocks compile as virtual files inside packages/react, so imports resolve like a consumer's:
//   through each package's `exports` to dist .d.ts (`@element-editor/react` by self-reference),
//   never to src. Nothing is written to disk.
// - Fragments (blocks outside quickstart/ and the READMEs) see a hidden prelude of common names
//   (`ElementEditor`, `ref`, `map`, ...); quickstart and README blocks are copy-paste starters and
//   must import everything themselves.
// - Column-0 JSX lines become statements; a column-0 `return` wraps the block in a component; a
//   block that doesn't parse is retried as `<>…</>`, `<ElementEditor …/>`, then `(…)`.
// - API-shape blocks (only interface / type / bodyless function declarations) are skipped.
// - ```tsx check=false opts a block out (intentionally partial or "before" code). A docs site that
//   renders these files must keep that fence meta.
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const virtualDir = join(root, 'packages/react/__doc_snippets__')

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  if (statSync(p).isDirectory()) return walk(p)
  return p.endsWith('.md') ? [p] : []
})
const docs = [
  ...walk(join(root, 'docs')),
  join(root, 'README.md'),
  ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'README.md')),
  // Shipped in the npm tarballs for coding agents: their snippets must compile too.
  ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'AGENTS.md')),
].filter(existsSync)

const isStarter = (md) => /(^|\/)(README|AGENTS)\.md$|^docs\/quickstart\//.test(relative(root, md))

// Hidden prelude for fragments. A script file (no top-level import/export), so these are globals;
// a snippet's own imports and declarations shadow them.
const PRELUDE = `
declare const ElementEditor: typeof import('@element-editor/react').ElementEditor
declare const DEFAULT_LAYOUT: typeof import('@element-editor/react').DEFAULT_LAYOUT
// Leaflet's: engine-neutral fragments leave out the 'map' prop MapLibre's requires.
declare const ElementEditorControls: typeof import('@element-editor/adapter-leaflet').ElementEditorControls
declare const ElementEditorUIProvider: typeof import('@element-editor/ui').ElementEditorUIProvider
declare const Suspense: typeof import('react').Suspense
declare const useState: typeof import('react').useState
declare const useRef: typeof import('react').useRef
declare const useEffect: typeof import('react').useEffect
declare const useCallback: typeof import('react').useCallback
declare const toast: typeof import('sonner').toast
declare const ref: import('react').RefObject<import('@element-editor/react').ElementEditorRef | null>
declare const map: import('maplibre-gl').Map
declare const role: 'viewer' | 'editor' | 'super'
declare const savedData: import('@element-editor/core').FeatureCollection
declare const handleChange: (data: import('@element-editor/core').FeatureCollection) => void
declare const handleSave: (data: import('@element-editor/core').FeatureCollection) => void
declare const db: any
type GeoJSONFeature = import('@element-editor/core').GeoJSONFeature
type FeatureCollection = import('@element-editor/core').FeatureCollection
type Schema = import('@element-editor/core').Schema
type ElementEditorRef = import('@element-editor/react').ElementEditorRef
type BasemapInput = import('@element-editor/react').BasemapInput
`
// Modules a snippet may import that aren't installed here.
const SHIMS = "declare module 'next/app' { export type AppProps = any }\n" + ['next/dynamic', 'next/router', '@maptiler/sdk', 'mapbox-gl', 'use-debounce']
  .map((m) => `declare module '${m}'`).join('\n') + // shorthand ambient modules: every import is any
  "\ndeclare module '*?worker&url' { const url: string; export default url }" // Vite asset-URL import

// Tried in order until the block parses. A column-0 `return` means a component body excerpt.
const WRAPS = [['', ''], ['export default (<>', '</>)'], ['export default (<ElementEditor', '/>)'], ['export default (', ')'],
  // `network: { … }`, `toolbar: { … }`: a config excerpt, typed as one.
  ["export const config: import('@element-editor/react').ElementEditorConfig = {", '}'],
  // `onChange?: (data: FeatureCollection) => void`: member signatures (API shape, skipped).
  ['interface Snippet {', '}']]
const BODY = ['export default function Snippet() {', '}']
const parses = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, false,
  name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.length === 0
const isApiShape = (sf) => sf.statements.some((s) => !ts.isImportDeclaration(s)) && sf.statements.every((s) =>
  ts.isImportDeclaration(s) || (ts.isExportDeclaration(s) && !s.moduleSpecifier) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isModuleDeclaration(s) ||
  (ts.isFunctionDeclaration(s) && !s.body) ||
  (ts.isVariableStatement(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)))

const blocks = [] // { md, line (1-based doc line of the first code line), indent, file, text, starter }
let optedOut = 0, apiShape = 0
for (const md of docs) {
  const lines = readFileSync(md, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)```(tsx|ts)\b(.*)$/)
    if (!m) continue
    let j = i + 1
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++
    const [, indent, lang, meta] = m
    // Docs show JSX inline between statements (`const ref = useRef(…)` then `<ElementEditor ref={ref} />`).
    // A leading `;` on column-0 JSX lines makes each one its own statement instead of a `<` comparison.
    const body = lines.slice(i + 1, j).map((l) => l.slice(indent.length).replace(/^(?=<[A-Za-z>])/, ';')).join('\n')
    const line = i + 2
    i = j
    if (/\bcheck=false\b/.test(meta)) { optedOut++; continue }
    const file = join(virtualDir, `${relative(root, md).replace(/[^\w]/g, '_')}_L${line}.${lang}`)
    const wrap = /^return\b/m.test(body) ? BODY
      : WRAPS.find(([pre, post]) => parses(file, `${pre}\n${body}\n${post}`)) ?? WRAPS[0]
    const text = `${wrap[0]}\n${body}\n${wrap[1]}`
    if ((wrap === WRAPS[0] || wrap === WRAPS.at(-1)) && parses(file, text) &&
      isApiShape(ts.createSourceFile(file, text, ts.ScriptTarget.Latest))) { apiShape++; continue }
    blocks.push({ md, line, indent: indent.length, file, text, starter: isStarter(md) })
  }
}

const options = {
  target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force, jsx: ts.JsxEmit.ReactJSX, strict: true,
  noEmit: true, skipLibCheck: true, isolatedModules: true, types: [],
}
// Fragments may use host-app placeholders (`saveToDB`, `projectId`, `<MyAdminButton />`): undeclared
// names, implicit any from them, and relative imports are fine there. Starters get no such slack.
const FRAGMENT_OK = new Set([2304, 2552, 2582, 2593, 7006, 7031, 18004])
const failures = []
for (const starter of [true, false]) {
  const group = blocks.filter((b) => b.starter === starter)
  const virtual = new Map(group.map((b) => [b.file, b.text]))
  virtual.set(join(virtualDir, '__shims.d.ts'), SHIMS)
  if (!starter) virtual.set(join(virtualDir, '__prelude.d.ts'), PRELUDE)
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile } = host // the default getSourceFile reads through host.readFile
  host.fileExists = (f) => virtual.has(f) || fileExists.call(host, f)
  host.readFile = (f) => virtual.get(f) ?? readFile.call(host, f)
  const program = ts.createProgram([...virtual.keys()], options, host)
  const byFile = new Map(group.map((b) => [b.file, b]))
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const b = d.file && byFile.get(d.file.fileName)
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
    if (b && !b.starter && (FRAGMENT_OK.has(d.code) ||
      (d.code === 2307 && /'\.\.?\//.test(msg)))) continue
    if (!b) { failures.push(`${d.file?.fileName ?? 'tsconfig'}: TS${d.code} ${msg}`); continue }
    const pos = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
    // Every wrap adds one line on top; a `;` added before column-0 JSX shifts that line by one.
    const semi = b.text.split('\n')[pos.line].startsWith(';<') ? 1 : 0
    const line = b.line + pos.line - 1, col = pos.character + 1 + b.indent - semi
    const where = relative(root, b.md)
    failures.push(`${where}:${line}:${col} TS${d.code} ${msg}`)
    if (process.env.GITHUB_ACTIONS) console.log(`::error file=${where},line=${line},col=${col}::TS${d.code} ${msg}`)
  }
}

// `@element-editor/*/internal` entries are not public API: no doc, README, AGENTS.md or example may
// import from them (code blocks with check=false included).
const examplesDir = join(root, 'examples')
const exampleFiles = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  if (statSync(p).isDirectory()) return ['node_modules', 'dist', '.next'].includes(f) ? [] : exampleFiles(p)
  return /\.(tsx?|jsx?|mjs)$/.test(f) ? [p] : []
})
const INTERNAL_IMPORT = /(?:from\s*|import\s*\(?\s*)['"](@element-editor\/[\w-]+\/internal)['"]/g
for (const f of [...docs, ...(existsSync(examplesDir) ? exampleFiles(examplesDir) : [])]) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((l, i) => {
    for (const [, spec] of l.matchAll(INTERNAL_IMPORT))
      failures.push(`${relative(root, f)}:${i + 1} imports ${spec} (not public API; use the package root)`)
  })
}

console.log(`doc snippets: ${blocks.length} checked (${blocks.filter((b) => b.starter).length} starters without prelude), ` +
  `${apiShape} API-shape skipped, ${optedOut} check=false`)
if (failures.length) {
  console.error(failures.join('\n'))
  console.error(`\n${failures.length} problem(s) in doc snippets (type errors or internal imports).`)
  process.exit(1)
}
console.log('All doc snippets type-check.')
