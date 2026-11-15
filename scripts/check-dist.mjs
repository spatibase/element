#!/usr/bin/env node
// Smoke-check the published dist of the library packages (run after `pnpm build`): `pnpm check:dist`.
// Nothing in the repo consumes packages/*/dist (apps alias to src), so packaging bugs are invisible
// in dev; this catches the ones we've already shipped once.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

if (failures.length) {
  console.error(`\n${failures.length} dist check(s) failed.`)
  process.exit(1)
}
console.log('\nAll dist checks passed.')
