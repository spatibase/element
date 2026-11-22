#!/usr/bin/env node
// Smoke-check the published dist of the library packages (run after `pnpm build`): `pnpm check:dist`.
// Nothing in the repo consumes packages/*/dist (apps alias to src), so packaging bugs are invisible
// in dev; this catches the ones we've already shipped once.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import { findDirectives } from './flatten-css.mjs'
import { ROOTS, norm, splitList, unscopedSelectors } from './css-scope.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = (name) => join(root, 'packages', name.replace('@element-editor/', ''))
const pkgJson = (name) => JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8'))
const PACKAGES = ['core', 'ui', 'adapter-leaflet', 'adapter-maplibre', 'react'].map((p) => `@element-editor/${p}`)
const failures = []
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg) }

// Every `exports` target as [subpath, condition path (e.g. 'import.default'), absolute file].
const leaves = (t, path) => typeof t === 'string' ? [[path || 'default', t]]
  : Object.entries(t).flatMap(([c, v]) => leaves(v, path ? `${path}.${c}` : c))
const targets = (name) => Object.entries(pkgJson(name).exports).flatMap(([sub, t]) =>
  leaves(t, '').map(([cond, f]) => [sub, cond, join(pkgDir(name), f)]))

// 1. Every exports target exists (covers both CSS files of @element-editor/react).
for (const name of PACKAGES) {
  const missing = targets(name).filter(([, , f]) => !existsSync(f)).map(([s, c]) => `${s} (${c})`)
  check(!missing.length, `${name}: all exports targets exist${missing.length ? ` — missing ${missing.join(', ')}` : ''}`)
}

// 1b. Published stylesheets are plain CSS: no cascade layers or Tailwind directives, which a host's
//     PostCSS (Tailwind v3 fails on `@layer` without `@tailwind`) would reinterpret (scripts/flatten-css.mjs).
for (const name of PACKAGES) {
  for (const [sub, , f] of targets(name).filter(([, , f]) => f.endsWith('.css') && existsSync(f))) {
    const left = findDirectives(readFileSync(f, 'utf8'))
    check(!left.length, `${name}${sub.slice(1)} is plain CSS${left.length ? ` — contains ${left.join(', ')}` : ''}`)
  }
}

// 1c. Published stylesheets only style Element's own DOM (scripts/css-scope.mjs): every selector is
//     scoped to Element's roots, or namespaced (`.leaflet-*`, `.maplibregl-*`, `.elm-*`, `[data-elm-*]`,
//     react-data-grid's hashed classes). Unlayered and loaded after the host's CSS, a global `.hidden`
//     or `.absolute` overrides the host's own utilities on the host's elements. Keyframes carry an
//     Element (or vendor) prefix. `@property --tw-*` stays global: registrations cannot be scoped; a
//     Tailwind v4 host registers identical ones, and the only typed ones are v4-only names
//     (`--tw-*-alpha`) plus `--tw-ring-offset-width: <length>`, which Tailwind v3 also only ever sets
//     to lengths (and v3 resets every `--tw-*` on every element, so `inherits: false` changes nothing).
{
  const req = createRequire(join(pkgDir('@element-editor/react'), 'package.json'))
  const rdgClasses = new Set([...readFileSync(req.resolve('react-data-grid/lib/styles.css'), 'utf8').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))
  for (const name of PACKAGES) {
    for (const [sub, , f] of targets(name).filter(([, , f]) => f.endsWith('.css') && existsSync(f))) {
      const css = postcss.parse(readFileSync(f, 'utf8'))
      const bad = unscopedSelectors(css, rdgClasses)
      check(!bad.length, `${name}${sub.slice(1)}: every selector is scoped to Element's roots or namespaced${bad.length ? ` — ${bad.length} global, e.g. ${bad.slice(0, 5).join(' , ')}` : ''}`)
      const frames = [], props = []
      css.walkAtRules((a) => { if (/keyframes$/.test(a.name)) frames.push(a.params); if (a.name === 'property') props.push(a.params) })
      const badFrames = frames.filter((n) => !/^(elm|maplibregl|mapboxgl|leaflet)-/.test(n))
      check(!badFrames.length, `${name}${sub.slice(1)}: keyframe names are prefixed${badFrames.length ? ` — ${badFrames.join(', ')}` : ''}`)
      const badProps = props.filter((n) => !n.startsWith('--tw-'))
      check(!badProps.length, `${name}${sub.slice(1)}: @property only registers --tw-*${badProps.length ? ` — ${badProps.join(', ')}` : ''}`)
    }
  }
  // The scoped preflight in shared.css spells the roots out by hand (the dev server serves the source
  // CSS); its lists must be exactly css-scope.mjs's ROOTS.
  const shared = readFileSync(join(pkgDir('@element-editor/ui'), 'src/styles/shared.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const want = ROOTS.map(norm).join(',')
  const lists = [...shared.matchAll(/:where\(([^{}]*?\[data-elm-theme\][^{}]*?)\)\s*\{/g)].map((m) => splitList(m[1]).map(norm))
  const rootLists = lists.map((l) => l.filter((s) => !s.endsWith(' *'))).filter((l) => l.length > 2)
  const descLists = lists.map((l) => l.filter((s) => s.endsWith(' *')).map((s) => s.slice(0, -2))).filter((l) => l.length)
  const wrong = [...rootLists, ...descLists].filter((l) => l.join(',') !== want)
  check(rootLists.length >= 3 && !wrong.length, `ui shared.css scoped-preflight root lists match scripts/css-scope.mjs ROOTS (${rootLists.length} lists)${wrong.length ? ` — differs: ${wrong[0].join(',')}` : ''}`)
}

// 2. React-component entries start with 'use client' (Next.js App Router). core and the
//    framework-neutral adapter-maplibre/basemaps stay server-importable.
for (const name of PACKAGES.filter((n) => n !== '@element-editor/core')) {
  for (const [sub, cond, f] of targets(name)) {
    if (!/\.(c?js)$/.test(f) || sub === './basemaps' || !existsSync(f)) continue
    const first = readFileSync(f, 'utf8').split('\n', 1)[0]
    check(/^["']use client["'];/.test(first), `${name}${sub.slice(1)} (${cond}) first line is 'use client'`)
  }
}

// 3. Engine isolation: walk an ES entry's static imports (relative chunks, plus @element-editor/*
//    packages via their dist "import" target) and collect every bare runtime import. Dynamic
//    `import()` is skipped on purpose (lazy chunks aren't loaded by merely importing the entry).
const STATIC = /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w*{}\s,$]+\s*from\s*)?["']([^"']+)["']/g
function bareImports(entry) {
  const seen = new Set(), bare = new Set(), queue = [entry]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(STATIC)) {
      if (spec.startsWith('.')) { queue.push(join(dirname(file), spec)); continue }
      bare.add(spec)
      const ws = PACKAGES.find((p) => spec === p || spec.startsWith(`${p}/`))
      const t = ws && targets(ws).find(([s, c]) => `${ws}${s.slice(1)}` === spec && c === 'import.default')
      if (t) queue.push(t[2])
    }
  }
  return bare
}
// `own` is a positive control: proves the walker sees the entry's real engine imports.
const ISOLATION = [
  ['element-editor.es.js', 'maplibre-gl', ['leaflet', 'react-leaflet', '@element-editor/adapter-leaflet']],
  ['leaflet.es.js', 'leaflet', ['maplibre-gl', '@element-editor/adapter-maplibre', '@element-editor/adapter-maplibre/basemaps']],
]
for (const [file, own, banned] of ISOLATION) {
  const bare = bareImports(join(pkgDir('@element-editor/react'), 'dist', file))
  const hits = banned.filter((b) => bare.has(b))
  check(bare.has(own) && !hits.length, `react/dist/${file} imports ${own} and never statically imports ${banned.join(', ')}${hits.length ? ` — imports ${hits.join(', ')}` : bare.has(own) ? '' : ` — walker didn't find ${own}`}`)
}
// Types too: the Leaflet entry's declarations must not need maplibre types.
{
  const seen = new Set(), queue = [join(pkgDir('@element-editor/react'), 'dist/leaflet.d.ts')], hits = new Set()
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\()\s*["']([^"']+)["']/g)) {
      if (spec.startsWith('.')) {
        const p = join(dirname(file), spec)
        queue.push(`${p}.d.ts`, join(p, 'index.d.ts'))
      } else if (/maplibre/.test(spec)) hits.add(spec)
    }
  }
  check(!hits.size, `react/dist/leaflet.d.ts (+ relative .d.ts) never references maplibre${hits.size ? ` — ${[...hits].join(', ')}` : ''}`)
}

// 4. Load both entries under plain Node, ESM and CJS, resolved through the package's own `exports`
//    (self-reference from packages/react). Leaflet touches `window` at module load, so a jsdom
//    window is installed for that entry only (MapLibre loads without one, but takes its browser
//    path and needs URL.createObjectURL once `window` exists). Checks resolution + named exports,
//    not rendering.
const EXPECTED = ['ElementEditor', 'DEFAULT_LAYOUT', 'IconButton', 'Tooltip', 'accentPalette', 'DEFAULT_ACCENT', 'ACCENT_STEPS']
const DOM = `const w = new JSDOM('<!doctype html>', { pretendToBeVisual: true }).window;
  for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame'])
    if (!(k in globalThis)) globalThis[k] = k === 'window' ? w : w[k];`
const PRINT = `console.log(JSON.stringify(Object.keys(m).sort()))`
// maplibre-gl 6 is ESM-only and its `exports` has no "require" condition, so plain Node can't
// `require('maplibre-gl')` at all (bundlers, the real consumers of the CJS entry, resolve it). For
// the CJS load, resolve it to its ESM file the way a bundler would; Node 22 can require() ESM.
const ESM_ONLY_MAPLIBRE = `const Module = require('node:module'), path = require('node:path'), orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    try { return orig.call(this, req, ...rest) } catch (e) {
      if (req !== 'maplibre-gl' || e.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw e
      const pj = orig.call(this, 'maplibre-gl/package.json', ...rest)
      return path.join(path.dirname(pj), require(pj).exports['.'].import)
    }
  };`
const keysBy = {}
for (const spec of ['@element-editor/react', '@element-editor/react/leaflet']) {
  for (const fmt of ['esm', 'cjs']) {
    const dom = spec.endsWith('/leaflet') ? DOM : ''
    const code = fmt === 'esm'
      ? `import { JSDOM } from 'jsdom'; ${dom} const m = await import('${spec}'); ${PRINT}`
      : `const { JSDOM } = require('jsdom'); ${ESM_ONLY_MAPLIBRE} ${dom} const m = require('${spec}'); ${PRINT}`
    try {
      const out = execFileSync(process.execPath, [...(fmt === 'esm' ? ['--input-type=module'] : []), '-e', code],
        { cwd: pkgDir('@element-editor/react'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      const keys = JSON.parse(out.trim().split('\n').pop())
      keysBy[`${spec} ${fmt}`] = keys
      const missing = EXPECTED.filter((k) => !keys.includes(k))
      check(!missing.length, `${spec} loads as ${fmt}${missing.length ? ` — missing exports ${missing.join(', ')}` : ` (${keys.length} exports)`}`)
    } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').find((l) => /Error|Cannot|not provide/.test(l)) ?? e.message
      check(false, `${spec} loads as ${fmt} — ${msg.trim()}`)
    }
  }
  const [esm, cjs] = [keysBy[`${spec} esm`], keysBy[`${spec} cjs`]]
  if (esm && cjs) check(JSON.stringify(esm) === JSON.stringify(cjs), `${spec}: ESM and CJS export the same names`)
}

// 5. @element-editor/core and its unstable `/internal` entry: both load under plain Node (ESM and
//    CJS) through the package's `exports`, ESM and CJS agree, the two entries export disjoint names
//    (nothing internal leaks back into the semver-covered root), and they share module instances:
//    an error built by an internal helper is an instance of the root's ElementEditorError (two
//    copies of a module would also mean two shortcut caches / geometry runners).
{
  const CORE_PUBLIC = ['createDataStore', 'createUIStore', 'ElementEditorError', 'getFeatureCollectionBBox', 'parseGeoJSONText', 'validateFeature', 'fetchRoute', 'readPersisted', 'accentPalette']
  const CORE_INTERNAL = ['project', 'commitTopoMove', 'createClickRepeatGuard', 'syncShortcutCache', 'setGeometryRunner', 'placeBox', 'routingError']
  const SHARED = `JSON.stringify({ root: Object.keys(root).sort(), internal: Object.keys(internal).sort(),
    shared: internal.routingError(new Error('x')) instanceof root.ElementEditorError })`
  const res = {}
  for (const fmt of ['esm', 'cjs']) {
    const code = fmt === 'esm'
      ? `const root = await import('@element-editor/core'); const internal = await import('@element-editor/core/internal'); console.log(${SHARED})`
      : `const root = require('@element-editor/core'); const internal = require('@element-editor/core/internal'); console.log(${SHARED})`
    try {
      const out = execFileSync(process.execPath, [...(fmt === 'esm' ? ['--input-type=module'] : []), '-e', code],
        { cwd: pkgDir('@element-editor/ui'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      const r = res[fmt] = JSON.parse(out.trim().split('\n').pop())
      const missing = [...CORE_PUBLIC.filter((k) => !r.root.includes(k)), ...CORE_INTERNAL.filter((k) => !r.internal.includes(k)).map((k) => `internal ${k}`)]
      check(!missing.length, `@element-editor/core + /internal load as ${fmt}${missing.length ? ` — missing ${missing.join(', ')}` : ` (${r.root.length} + ${r.internal.length} exports)`}`)
      const both = r.root.filter((k) => r.internal.includes(k))
      check(!both.length, `@element-editor/core (${fmt}): root and /internal export disjoint names${both.length ? ` — both export ${both.join(', ')}` : ''}`)
      check(r.shared, `@element-editor/core (${fmt}): root and /internal share one module instance`)
    } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').find((l) => /Error|Cannot|not provide/.test(l)) ?? e.message
      check(false, `@element-editor/core + /internal load as ${fmt} — ${msg.trim()}`)
    }
  }
  if (res.esm && res.cjs) check(JSON.stringify(res.esm) === JSON.stringify(res.cjs), '@element-editor/core + /internal: ESM and CJS export the same names')
}

// 7. Idle preloading: lazyWithPreload registers each panel with `arr[arr.length] = loader`. Rollup once
//    dropped a `.push()` there (the call sits inside a /*#__PURE__*/ call); the build must keep the
//    registration next to preloadEditorPanelsWhenIdle's requestIdleCallback.
{
  const uiDist = join(pkgDir('@element-editor/ui'), 'dist')
  const files = readdirSync(uiDist).filter((f) => /\.c?js$/.test(f))
  for (const ext of ['js', 'cjs']) {
    const f = files.filter((n) => n.endsWith(`.${ext}`)).find((n) => readFileSync(join(uiDist, n), 'utf8').includes('requestIdleCallback'))
    const registered = f && /([\w$]+)\[\1\.length\]\s*=\s*[\w$]+/.test(readFileSync(join(uiDist, f), 'utf8'))
    check(!!registered, `@element-editor/ui (${ext}): lazy panels still self-register for idle preloading`)
  }
}

if (failures.length) {
  console.error(`\n${failures.length} dist check(s) failed.`)
  process.exit(1)
}
console.log('\nAll dist checks passed.')
