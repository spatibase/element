#!/usr/bin/env node
// What does a host pay (JS, min+gzip) for each way of using Element? Run after `pnpm build`:
//   pnpm check:size            CI guard: the two headless fixtures (eager budget + no panel dependencies anywhere in the
//                              build, lazy chunks included, so they are never fetched at idle either). ~1.5 min.
//   pnpm check:size --all      every fixture (adds the stock-panels hosts and both drop-ins)
//   --report                   top contributors per fixture;  --chunks  lazy chunks and who imports them
//   --only=name,name           pick fixtures by name
//
// Each fixture in apps/size-fixture/src is a minimal consumer app, production-built from the packages'
// published dist (the workspace links resolve through each package's `exports`). react, react-dom,
// leaflet, react-leaflet and maplibre-gl are EXTERNAL: they cost the same for every approach and
// the host pays them anyway, so the numbers are Element + its own dependencies only.
// "eager" = the entry chunk plus everything it statically imports; "lazy" = chunks behind dynamic import().
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'apps/size-fixture')
const require = createRequire(join(fixtureDir, 'package.json'))
const { build } = require('vite')
const react = require('@vitejs/plugin-react').default

const REPORT = process.argv.includes('--report')
const EXTERNAL = /^(react|react-dom|react-leaflet|leaflet|maplibre-gl)(\/.*)?$/

// Budgets in KB (min+gzip, eager JS). Measured value + ~10 %; raise deliberately, never to "make CI pass".
// `lazy` is the total of all dynamic-import chunks and is only reported (it loads on demand).
// `headless` fixtures render no stock panel, so none of these packages may appear in their build at all.
const PANEL_DEPS = ['@codemirror/', 'codemirror', 'react-data-grid', '@hello-pangea/dnd', '@tanstack/react-virtual', 'react-redux']
const FIXTURES = [
  { name: 'leaflet-headless', label: 'adapter-leaflet, headless', budget: 127, headless: true },
  { name: 'leaflet-panels', label: 'adapter-leaflet + stock panels', budget: null },
  { name: 'maplibre-headless', label: 'adapter-maplibre, headless', budget: 118.5, headless: true },
  { name: 'maplibre-panels', label: 'adapter-maplibre + stock panels', budget: null },
  { name: 'react-dropin-maplibre', label: '@element-editor/react (MapLibre)', budget: null },
  { name: 'react-dropin-leaflet', label: '@element-editor/react/leaflet', budget: null },
]

const kb = (n) => (n / 1024).toFixed(1)

function pkgOf(id) {
  const parts = id.split(sep)
  const nm = parts.lastIndexOf('node_modules')
  if (nm >= 0) {
    const p = parts[nm + 1]
    return p.startsWith('@') ? `${p}/${parts[nm + 2]}` : p
  }
  const pk = parts.lastIndexOf('packages')
  if (pk >= 0) return `@element-editor/${parts[pk + 1]}`
  return 'app'
}

async function measure(name) {
  const { output } = await build({
    root: fixtureDir,
    configFile: false,
    logLevel: 'silent',
    plugins: [react()],
    define: { 'process.env.NODE_ENV': '"production"' },
    // Workers are the packages' business (geometry worker lives in ui); keep the fixture build plain.
    build: {
      write: false, minify: 'esbuild', target: 'es2022', cssCodeSplit: false,
      lib: { entry: join(fixtureDir, 'src', `${name}.tsx`), formats: ['es'], fileName: 'out' },
      rollupOptions: { external: (id) => EXTERNAL.test(id) },
    },
  }).then((r) => (Array.isArray(r) ? r[0] : r))
  const chunks = output.filter((o) => o.type === 'chunk')
  const byFile = new Map(chunks.map((c) => [c.fileName, c]))
  const entry = chunks.find((c) => c.isEntry)
  const eager = new Set()
  const walk = (c) => { if (eager.has(c)) return; eager.add(c); for (const i of c.imports) if (byFile.has(i)) walk(byFile.get(i)) }
  walk(entry)
  const size = (c) => {
    const buf = Buffer.from(c.code)
    return { min: buf.length, gz: gzipSync(buf, { level: 9 }).length, br: brotliCompressSync(buf).length }
  }
  const sum = (cs) => cs.map(size).reduce((a, s) => ({ min: a.min + s.min, gz: a.gz + s.gz, br: a.br + s.br }), { min: 0, gz: 0, br: 0 })
  const lazy = chunks.filter((c) => !eager.has(c))
  // Attribute by package: split each chunk's gzip size by its modules' rendered-length share.
  const attr = {}
  for (const c of chunks) {
    const total = Object.values(c.modules).reduce((a, m) => a + m.renderedLength, 0) || 1
    const gz = size(c).gz
    for (const [id, m] of Object.entries(c.modules)) {
      const k = `${eager.has(c) ? '' : '(lazy) '}${pkgOf(id)}`
      attr[k] = (attr[k] ?? 0) + (gz * m.renderedLength) / total
    }
  }
  const lazyList = lazy.map((c) => ({
    gz: size(c).gz,
    by: chunks.filter((o) => o.dynamicImports.includes(c.fileName)).map((o) => o.fileName),
    top: Object.entries(c.modules).sort((a, b) => b[1].renderedLength - a[1].renderedLength).slice(0, 2).map(([id]) => id.split(sep).slice(-3).join('/')),
    file: c.fileName,
  }))
  return { eager: sum([...eager]), lazy: sum(lazy), lazyList, attr }
}

const rows = []
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const all = process.argv.includes('--all')
for (const f of FIXTURES.filter((f) => only ? only.includes(f.name) : all || f.headless)) rows.push({ ...f, ...(await measure(f.name)) })

console.log(`${'fixture'.padEnd(38)} ${'eager gz'.padStart(9)} ${'eager br'.padStart(9)} ${'eager min'.padStart(10)} ${'lazy gz'.padStart(9)}  budget`)
const failures = []
for (const r of rows) {
  if (r.headless) {
    const heavy = Object.keys(r.attr).map((k) => k.replace('(lazy) ', '')).filter((k) => PANEL_DEPS.some((d) => k === d || k.startsWith(d)))
    if (heavy.length) failures.push(`${r.name}: panel dependencies in a headless build: ${[...new Set(heavy)].join(', ')} (a module-level call in @element-editor/ui is keeping a panel alive; mark it /*#__PURE__*/)`)
  }
  const over = r.budget != null && r.eager.gz / 1024 > r.budget
  if (over) failures.push(`${r.name}: ${kb(r.eager.gz)} KB > budget ${r.budget} KB`)
  console.log(`${r.label.padEnd(38)} ${(kb(r.eager.gz) + ' KB').padStart(9)} ${(kb(r.eager.br) + ' KB').padStart(9)} ${(kb(r.eager.min) + ' KB').padStart(10)} ${(kb(r.lazy.gz) + ' KB').padStart(9)}  ${r.budget == null ? '-' : r.budget + ' KB'}${over ? '  OVER' : ''}`)
}
if (REPORT) {
  for (const r of rows) {
    console.log(`\n${r.label} - top contributors (gzip KB, apportioned by rendered size)`)
    for (const [k, v] of Object.entries(r.attr).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${kb(v).padStart(7)}  ${k}`)
  }
}
if (process.argv.includes('--chunks')) {
  for (const r of rows) {
    console.log(`\n${r.label} - lazy chunks`)
    for (const c of r.lazyList.sort((a, b) => b.gz - a.gz)) console.log(`  ${kb(c.gz).padStart(7)} KB  ${c.file}  <- ${c.by.join(', ')}  [${c.top.join(' ; ')}]`)
  }
}
if (failures.length) {
  console.error(`\n${failures.length} bundle-size budget(s) exceeded:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
