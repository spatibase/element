#!/usr/bin/env node
// Cut a release: one version for all five packages (lockstep), CHANGELOG section, commit, tag.
//
//   pnpm release patch|minor|major|<x.y.z> [--date YYYY-MM-DD] [--dry-run] [--no-commit]
//
// What it does (see RELEASING.md for the policy):
// 1. Computes the next version from packages/react's current one (or takes an explicit x.y.z).
// 2. Writes it to every packages/*/package.json and apps/demo/package.json, and sets the
//    @element-editor/* ranges in examples/*/package.json to ^x.y.z.
// 3. CHANGELOG.md: renames `## [Unreleased]` to `## [x.y.z] — <date>` and opens a fresh empty
//    `## [Unreleased]` above it. If a `## [x.y.z]` section was already prepared by hand (the 0.2.0
//    launch entry), it only (re)sets its date. Refuses to release with nothing in Unreleased.
// 4. Commits `chore(release): x.y.z` and creates the annotated tag `vx.y.z` (no push: pushing the
//    tag is what triggers .github/workflows/release.yml, which publishes to npm).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const bump = args.find((a) => !a.startsWith('--') && a !== opt('--date'))
const dryRun = flag('--dry-run')
const noCommit = flag('--no-commit') || dryRun

const die = (msg) => { console.error(`release: ${msg}`); process.exit(1) }
if (!bump) die('usage: pnpm release patch|minor|major|<x.y.z> [--date YYYY-MM-DD] [--dry-run] [--no-commit]')

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJson = (f, j) => { if (!dryRun) writeFileSync(f, JSON.stringify(j, null, 2) + '\n') }
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()

// ── Version ────────────────────────────────────────────────────────────────
const pkgDirs = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'package.json')))
const versions = new Set(pkgDirs.map((p) => readJson(join(root, 'packages', p, 'package.json')).version))
if (versions.size !== 1) die(`packages are not in lockstep: ${[...versions].join(', ')}`)
const current = [...versions][0]
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const [, M, m, p] = (current.match(SEMVER) ?? die(`current version ${current} is not x.y.z`)).map(Number)
const next = SEMVER.test(bump) ? bump
  : bump === 'major' ? `${M + 1}.0.0`
  : bump === 'minor' ? `${M}.${m + 1}.0`
  : bump === 'patch' ? `${M}.${m}.${p + 1}`
  : die(`unknown bump "${bump}"`)
const date = opt('--date') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must be YYYY-MM-DD, got ${date}`)

// ── Clean tree, tag free ───────────────────────────────────────────────────
if (!noCommit) {
  if (git('status', '--porcelain')) die('working tree is not clean; commit or stash first')
  if (git('tag', '--list', `v${next}`)) die(`tag v${next} already exists`)
}

// ── CHANGELOG ──────────────────────────────────────────────────────────────
const clPath = join(root, 'CHANGELOG.md')
let cl = readFileSync(clPath, 'utf8')
const prepared = new RegExp(`^## \\[${next.replace(/\./g, '\\.')}\\][^\\n]*$`, 'm')
const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[)/m
if (prepared.test(cl)) {
  cl = cl.replace(prepared, `## [${next}] — ${date}`)
  // An empty Unreleased above a prepared section is fine; a non-empty one would be lost.
  const u = cl.match(unreleased)
  if (u && u[1].replace(/---/g, '').trim()) die(`CHANGELOG has entries under [Unreleased] and a prepared [${next}] section: merge them first`)
} else {
  const u = cl.match(unreleased) ?? die('CHANGELOG.md has no "## [Unreleased]" section')
  if (!u[1].replace(/---/g, '').trim()) die('nothing under [Unreleased]: add the changes before releasing')
  cl = cl.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n---\n\n## [${next}] — ${date}\n`)
}
if (!/^## \[Unreleased\]/m.test(cl)) cl = cl.replace(/^## \[/m, '## [Unreleased]\n\n---\n\n## [')
if (!dryRun) writeFileSync(clPath, cl)

// ── package.json files ─────────────────────────────────────────────────────
const touched = ['CHANGELOG.md']
for (const d of pkgDirs) {
  const f = join(root, 'packages', d, 'package.json'), j = readJson(f)
  j.version = next; writeJson(f, j); touched.push(`packages/${d}/package.json`)
}
const demo = join(root, 'apps/demo/package.json')
if (existsSync(demo)) { const j = readJson(demo); j.version = next; writeJson(demo, j); touched.push('apps/demo/package.json') }
for (const ex of existsSync(join(root, 'examples')) ? readdirSync(join(root, 'examples')) : []) {
  const f = join(root, 'examples', ex, 'package.json')
  if (!existsSync(f)) continue
  const j = readJson(f)
  for (const deps of [j.dependencies, j.devDependencies]) for (const k in deps ?? {}) if (k.startsWith('@element-editor/')) deps[k] = `^${next}`
  writeJson(f, j); touched.push(`examples/${ex}/package.json`)
}

console.log(`${dryRun ? '[dry run] ' : ''}${current} → ${next} (${date})`)
console.log(touched.map((t) => `  ${t}`).join('\n'))

if (!noCommit) {
  git('add', ...touched)
  git('commit', '-m', `chore(release): ${next}`)
  git('tag', '-a', `v${next}`, '-m', `v${next}`)
  console.log(`Committed and tagged v${next}. Publish: git push origin main v${next}`)
} else if (!dryRun) {
  console.log('Files updated; not committed (--no-commit).')
}
