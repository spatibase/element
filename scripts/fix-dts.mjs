#!/usr/bin/env node
// Post-build step for a library package (run in its directory after `vite build`):
// vite-plugin-dts emits extensionless relative specifiers (`from './shared'`). The packages are
// `"type": "module"`, so under `moduleResolution: node16/nodenext` those .d.ts files are ESM and
// the specifiers don't resolve (types silently become `any`), and the same .d.ts files are wrong
// for the `require` condition (CJS consumers get ESM-flavoured types).
// This rewrites every relative specifier in dist/**/*.d.ts to `./x.js` / `./x/index.js` and writes
// a CJS twin `*.d.cts` next to each (specifiers `./x.cjs` / `./x/index.cjs`), which the
// `require.types` export conditions point at.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

const dist = join(process.cwd(), 'dist')
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : []
})

const SPEC = /((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]*)\2/g
let unresolved = 0
for (const file of walk(dist)) {
  const src = readFileSync(file, 'utf8')
  const rewrite = (ext) => src.replace(SPEC, (m, pre, q, spec) => {
    const base = spec.replace(/\.js$/, '')
    const target = join(dirname(file), base)
    if (existsSync(`${target}.d.ts`)) return `${pre}${q}${base}${ext}${q}`
    if (existsSync(join(target, 'index.d.ts'))) return `${pre}${q}${base}/index${ext}${q}`
    console.error(`fix-dts: can't resolve ${spec} in ${file}`)
    unresolved++
    return m
  })
  writeFileSync(file, rewrite('.js'))
  writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), rewrite('.cjs'))
}
if (unresolved) process.exit(1)
