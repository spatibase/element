#!/usr/bin/env node
// Build the example apps against the packed packages, the way a user installs them (run after
// `pnpm build`): `pnpm check:examples [--smoke] [--keep] [--maplibre=<range>] [example ...]`.
// --maplibre=5 installs that maplibre-gl range instead of the examples' own (^6), to check the
// lower end of the peer range (CI runs both).
//
// 1. `pnpm pack` every library package (workspace:* becomes a real version, `files` applies).
// 2. Copy each examples/<name> to a temp dir outside the repo (its own one-package workspace, no parent
//    node_modules to hide a missing dependency), point every @element-editor/* at its tarball
//    via pnpm.overrides, `pnpm install` with no lockfile (fresh, like a new user), `pnpm build`.
// 3. --smoke: serve the build and load each page in headless Chromium (Playwright from
//    packages/react): the map and the editor's controls must mount with no page errors.
//    Tiles may fail to load offline; network errors are ignored.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const smoke = args.includes('--smoke'), keep = args.includes('--keep')
const maplibre = args.find((a) => a.startsWith('--maplibre='))?.slice('--maplibre='.length)
const EXAMPLES = {
  'vite-maplibre': { serve: (port) => ['exec', 'vite', 'preview', '--port', port, '--strictPort'], pages: [['/', '.maplibregl-canvas']] },
  'vite-leaflet': { serve: (port) => ['exec', 'vite', 'preview', '--port', port, '--strictPort'], pages: [['/', '.leaflet-container']] },
  'nextjs-app-router': { serve: (port) => ['exec', 'next', 'start', '-p', port], pages: [['/', '.maplibregl-canvas'], ['/leaflet', '.leaflet-container']] },
}
const names = args.filter((a) => !a.startsWith('--'))
const selected = names.length ? names : Object.keys(EXAMPLES)
for (const n of selected) if (!EXAMPLES[n]) { console.error(`unknown example: ${n}`); process.exit(2) }

// Runs a command, capturing output; rejects with the output on failure.
const run = (cmd, argv, cwd, env = {}) => new Promise((ok, fail) => {
  const p = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
  p.on('close', (code) => code === 0 ? ok(out) : fail(new Error(`${cmd} ${argv.join(' ')} failed (${code}) in ${cwd}\n${out}`)))
})
const timed = async (fn) => { const t = Date.now(); await fn(); return ((Date.now() - t) / 1000).toFixed(1) }

const tmp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'elm-examples-'))
const packs = join(tmp, 'packs')
const failures = []
try {
  const packages = ['core', 'ui', 'adapter-leaflet', 'adapter-maplibre', 'react']
  const packTime = await timed(() => Promise.all(packages.map((p) =>
    run('pnpm', ['pack', '--pack-destination', packs], join(root, 'packages', p)))))
  const tarballs = Object.fromEntries(readdirSync(packs).map((f) => {
    const p = packages.find((name) => f.startsWith(`element-editor-${name}-`) && /^\d/.test(f.slice(`element-editor-${name}-`.length)))
    return [`@element-editor/${p}`, `file:${join(packs, f)}`]
  }))
  console.log(`packed ${Object.keys(tarballs).length} packages in ${packTime}s`)

  await Promise.all(selected.map(async (name) => {
    const dir = join(tmp, name)
    cpSync(join(root, 'examples', name), dir, { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.next|dist)$/.test(src) })
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    for (const deps of [pkg.dependencies, pkg.devDependencies]) for (const d in deps ?? {}) if (tarballs[d]) deps[d] = tarballs[d]
    if (maplibre && pkg.dependencies?.['maplibre-gl']) pkg.dependencies['maplibre-gl'] = /^\d+$/.test(maplibre) ? `^${maplibre}` : maplibre
    // Overrides point the packages' own @element-editor/* deps at the tarballs too. pnpm 10 reads
    // them from package.json `pnpm.overrides`; pnpm 11+ ignores that field and reads
    // pnpm-workspace.yaml `overrides:` instead, so write both. The example also gets the repo's
    // `packageManager`, so a globally newer pnpm switches to the version CI uses, and
    // strictDepBuilds: false (pnpm 11+ otherwise fails on esbuild's unapproved build script).
    pkg.pnpm = { ...pkg.pnpm, overrides: tarballs }
    if (rootPkg.packageManager) pkg.packageManager = rootPkg.packageManager
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages:\n  - '.'\nstrictDepBuilds: false\noverrides:\n${Object.entries(tarballs).map(([k, v]) => `  '${k}': '${v}'`).join('\n')}\n`)
    try {
      const install = await timed(() => run('pnpm', ['install', '--no-frozen-lockfile'], dir))
      const build = await timed(() => run('pnpm', ['run', 'build'], dir, { NEXT_TELEMETRY_DISABLED: '1' }))
      const ml = maplibre && pkg.dependencies?.['maplibre-gl'] ? `, maplibre-gl ${JSON.parse(readFileSync(join(dir, 'node_modules/maplibre-gl/package.json'), 'utf8')).version}` : ''
      console.log(`ok   ${name}: install ${install}s, build ${build}s${ml}`)
    } catch (e) {
      console.log(`FAIL ${name}`)
      failures.push(`${name}: ${e.message}`)
    }
  }))

  if (smoke) {
    const req = createRequire(join(root, 'packages/react/package.json'))
    const { chromium } = req('playwright')
    const browser = await chromium.launch({ headless: true })
    let port = 4610
    for (const name of selected.filter((n) => !failures.some((f) => f.startsWith(`${n}:`)))) {
      const dir = join(tmp, name), p = String(port++)
      const server = spawn('pnpm', EXAMPLES[name].serve(p), { cwd: dir, stdio: 'ignore', detached: true })
      try {
        for (const [path, mapSelector] of EXAMPLES[name].pages) {
          const page = await browser.newPage()
          const errors = []
          page.on('pageerror', (e) => errors.push(e.message))
          page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|NetworkError|Failed to fetch|AJAXError/.test(m.text())) errors.push(m.text()) })
          const url = `http://localhost:${p}${path}`
          for (let i = 0; ; i++) { // wait for the server
            try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 }); break }
            catch (e) { if (i > 30) throw e; await new Promise((r) => setTimeout(r, 500)) }
          }
          try {
            await page.waitForSelector(mapSelector, { timeout: 30_000 })
            await page.waitForSelector('[data-elm-theme] [data-elm-slot] button', { timeout: 30_000 })
            await page.waitForTimeout(1000) // let late errors surface
            if (errors.length) throw new Error(errors.join('\n'))
            console.log(`ok   ${name}${path}: map and controls mounted, no page errors`)
          } catch (e) {
            console.log(`FAIL ${name}${path}`)
            failures.push(`${name}${path} smoke: ${e.message}`)
          }
          await page.close()
        }
      } finally {
        try { process.kill(-server.pid) } catch { /* already gone */ }
      }
    }
    await browser.close()
  }
} finally {
  if (keep) console.log(`kept ${tmp}`)
  else rmSync(tmp, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n\n${failures.length} example check(s) failed.`)
  process.exit(1)
}
console.log('\nAll examples build from the packed packages.')
