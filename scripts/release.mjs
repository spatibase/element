#!/usr/bin/env node
// Cut a release: one version for all five packages (lockstep), CHANGELOG section, commit, tag.
// Nothing is tagged unless the release gate passes. See RELEASING.md for the policy.
//
//   pnpm release patch|minor|major|<x.y.z>|<x.y.z-beta.N> [--date YYYY-MM-DD] [--dry-run] [--no-commit] [--no-site]
//   pnpm release --trigger-site [vX.Y.Z]     (after pushing the tag: redeploy the docs site from it)
//
// 1. Repo state: on `main`, clean tree, HEAD equal to `origin/main`, CI green for HEAD, the tag is
//    free locally and on origin, packages in lockstep.
// 2. CHANGELOG: `## [Unreleased]` has entries, or a `## [x.y.z]` section for the target version is
//    already prepared (that is how the version already in package.json, e.g. 0.2.0, is released:
//    `pnpm release 0.2.0` only dates its section and tags).
// 3. Applies the bump to the working tree: every packages/*/package.json and apps/demo get x.y.z,
//    examples/* get ^x.y.z for @element-editor/*, CHANGELOG `## [Unreleased]` becomes
//    `## [x.y.z] — <date>` under a fresh empty `## [Unreleased]`.
// 4. Runs the checks against exactly that tree: frozen install, build, typecheck, lint (errors),
//    unit tests, check:dist, check:docs, check:examples, then the docs site (`pnpm --dir site
//    verify`) when the private site checkout exists at ./site. Without ./site the release is refused
//    unless --no-site is passed.
// 5. Any failure restores the files the bump touched and exits non-zero. On success commits
//    `chore(release): x.y.z` and creates the annotated tag `vx.y.z`. It never pushes.
//
// --dry-run runs the whole gate, then restores every file it touched (build output in dist/ stays).
// In a dry run, repo-state failures are listed and the checks still run, so one run shows everything
// that stands between HEAD and a release.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE_REPO = 'spatibase/element-web'
const LIB_REPO = 'spatibase/element'
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const positional = args.filter((a) => !a.startsWith('--') && a !== opt('--date'))
const dryRun = flag('--dry-run')
const noCommit = flag('--no-commit') || dryRun
const noSite = flag('--no-site')

const die = (msg) => { console.error(`\nrelease: ${msg}`); process.exit(1) }
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGit = (...a) => { try { return git(...a) } catch { return null } }
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const line = (s = '') => console.log(s)

// ── --trigger-site: redeploy the docs site from a pushed tag ──────────────────
if (flag('--trigger-site')) {
  const tag = positional[0] ?? `v${readJson(join(root, 'packages/react/package.json')).version}`
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) die(`--trigger-site takes a tag like v0.2.0, got ${tag}`)
  if (!tryGit('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) die(`${tag} is not on origin yet: git push origin main ${tag} first`)
  line(`Triggering the docs site deploy at ${tag} …`)
  const r = spawnSync('gh', ['workflow', 'run', 'deploy.yml', '-R', SITE_REPO, '-f', `ref=${tag}`], { stdio: 'inherit' })
  if (r.status !== 0) die('gh workflow run failed (needs gh logged in with access to the site repo)')
  line(`Started. Follow it with: gh run list -R ${SITE_REPO} --workflow deploy.yml -L 1`)
  process.exit(0)
}

const bump = positional[0]
if (!bump) die('usage: pnpm release patch|minor|major|<x.y.z> [--date YYYY-MM-DD] [--dry-run] [--no-commit] [--no-site]\n       pnpm release --trigger-site [vX.Y.Z]')

// ── Site checkout: required unless --no-site ────────────────────────────────
const siteDir = join(root, 'site')
const hasSite = existsSync(join(siteDir, 'package.json'))
if (!hasSite && !noSite) {
  die(`no docs site checkout at ./site, so the site cannot be checked against this release.
  Run the release from the maintainer checkout that has ./site, or pass --no-site to release
  without checking the site (not recommended: the site deploys from the tag).`)
}
if (!hasSite) {
  line('!'.repeat(78))
  line('!!  --no-site: the docs site is NOT checked against this release.')
  line('!!  The site deploys from the tag; if it breaks, the deploy fails and production keeps the')
  line('!!  previous version. Run `pnpm --dir site verify` against the tag before pushing if you can.')
  line('!'.repeat(78))
}

// ── Version ────────────────────────────────────────────────────────────────
const pkgDirs = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'package.json')))
const versions = new Set(pkgDirs.map((p) => readJson(join(root, 'packages', p, 'package.json')).version))
if (versions.size !== 1) die(`packages are not in lockstep: ${[...versions].join(', ')}`)
const current = [...versions][0]
// x.y.z, or a prerelease x.y.z-alpha.N / -beta.N / -rc.N (published to the `next` dist-tag).
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/
const PRE = ['alpha', 'beta', 'rc']
// [major, minor, patch, pre rank (alpha 0, beta 1, rc 2, release 3), pre number]
const parse = (v) => {
  const r = v.match(SEMVER) ?? die(`version ${v} is not x.y.z or x.y.z-alpha|beta|rc.N`)
  return [+r[1], +r[2], +r[3], r[4] ? PRE.indexOf(r[4]) : PRE.length, r[5] ? +r[5] : 0]
}
const [M, m, p, preRank] = parse(current)
if (preRank < PRE.length && ['major', 'minor', 'patch'].includes(bump)) {
  die(`the current version ${current} is a prerelease: give the next version explicitly (e.g. ${M}.${m}.${p} or ${M}.${m}.${p}-rc.1)`)
}
const next = SEMVER.test(bump) ? bump
  : bump === 'major' ? `${M + 1}.0.0`
  : bump === 'minor' ? `${M}.${m + 1}.0`
  : bump === 'patch' ? `${M}.${m}.${p + 1}`
  : die(`unknown bump "${bump}"`)
const prerelease = next.includes('-')
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 5; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }
if (cmp(next, current) < 0) die(`${next} is lower than the current version ${current}`)
const tag = `v${next}`
const date = opt('--date') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must be YYYY-MM-DD, got ${date}`)

line(`${dryRun ? '[dry run] ' : ''}release ${current} → ${next} (${date})`)

// ── Gate, part 1: repo state ───────────────────────────────────────────────
// Outside a dry run the first failure stops the release; in a dry run they are collected.
const failures = []
const fail = (msg) => {
  if (!dryRun) die(msg)
  failures.push(msg)
  line(`  ✗ ${msg}`)
}
const ok = (msg) => line(`  ✓ ${msg}`)

line('\nRepo state')
const branch = tryGit('rev-parse', '--abbrev-ref', 'HEAD')
branch === 'main' ? ok('on main') : fail(`not on main (on ${branch}): releases are cut from main`)
const dirty = tryGit('status', '--porcelain')
!dirty ? ok('working tree clean') : fail(`working tree is not clean:\n${dirty}`)
if (tryGit('fetch', '--quiet', '--tags', 'origin', 'main') === null) fail('git fetch origin main failed')
const head = git('rev-parse', 'HEAD')
const originMain = tryGit('rev-parse', 'origin/main')
head === originMain ? ok(`HEAD is origin/main (${head.slice(0, 7)})`)
  : fail(`HEAD ${head.slice(0, 7)} is not origin/main ${originMain?.slice(0, 7)}: pull, or push and wait for CI`)
tryGit('tag', '--list', tag) ? fail(`tag ${tag} already exists locally`) : null
tryGit('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) ? fail(`tag ${tag} already exists on origin`) : ok(`tag ${tag} is free`)

// CI on GitHub for this exact commit (runs the e2e suite the local gate doesn't).
{
  const r = spawnSync('gh', ['run', 'list', '-R', LIB_REPO, '--workflow', 'ci.yml', '--commit', head, '--json', 'status,conclusion,url', '-L', '1'], { encoding: 'utf8' })
  if (r.status !== 0) fail(`could not read CI status with gh: ${(r.stderr || r.error?.message || '').trim()}`)
  else {
    const [run] = JSON.parse(r.stdout || '[]')
    if (!run) fail(`no CI run for ${head.slice(0, 7)}: push it to main and let CI finish`)
    else if (run.status !== 'completed') fail(`CI for ${head.slice(0, 7)} is still ${run.status}: ${run.url}`)
    else if (run.conclusion !== 'success') fail(`CI for ${head.slice(0, 7)} concluded ${run.conclusion}: ${run.url}`)
    else ok(`CI green for ${head.slice(0, 7)}`)
  }
}

// ── Gate, part 2: CHANGELOG ────────────────────────────────────────────────
line('\nCHANGELOG')
const clPath = join(root, 'CHANGELOG.md')
let cl = readFileSync(clPath, 'utf8')
const prepared = new RegExp(`^## \\[${next.replace(/\./g, '\\.')}\\][^\\n]*$`, 'm')
const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[)/m
const hasEntries = (u) => u && u[1].replace(/---/g, '').trim()
if (prepared.test(cl)) {
  // An empty Unreleased above a prepared section is fine; a non-empty one would be lost.
  if (hasEntries(cl.match(unreleased))) fail(`CHANGELOG has entries under [Unreleased] and a prepared [${next}] section: merge them first`)
  else ok(`dating the prepared [${next}] section`)
  cl = cl.replace(prepared, `## [${next}] — ${date}`)
} else if (next === current) {
  fail(`${next} is the current version but CHANGELOG has no [${next}] section to release`)
} else {
  const u = cl.match(unreleased)
  if (!u) fail('CHANGELOG.md has no "## [Unreleased]" section')
  else if (!hasEntries(u)) fail('nothing under [Unreleased]: add the changes before releasing')
  else ok(`[Unreleased] becomes [${next}]`)
  cl = cl.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n---\n\n## [${next}] — ${date}\n`)
}
if (!/^## \[Unreleased\]/m.test(cl)) cl = cl.replace(/^## \[/m, '## [Unreleased]\n\n---\n\n## [')

// ── Apply the bump to the working tree (restored on failure / dry run) ────────
const originals = new Map()
const put = (rel, text) => {
  const f = join(root, rel)
  const before = readFileSync(f, 'utf8')
  if (before === text) return
  if (!originals.has(rel)) originals.set(rel, before)
  writeFileSync(f, text)
}
const putJson = (rel, j) => put(rel, JSON.stringify(j, null, 2) + '\n')
const restore = () => {
  for (const [rel, text] of originals) writeFileSync(join(root, rel), text)
  if (originals.size) line(`Restored ${originals.size} file(s) the bump touched.`)
  originals.clear()
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })

put('CHANGELOG.md', cl)
for (const d of pkgDirs) {
  const rel = `packages/${d}/package.json`, j = readJson(join(root, rel))
  j.version = next; putJson(rel, j)
}
if (existsSync(join(root, 'apps/demo/package.json'))) {
  const j = readJson(join(root, 'apps/demo/package.json')); j.version = next; putJson('apps/demo/package.json', j)
}
// Examples are what people copy: they keep the latest stable range through prereleases.
for (const ex of !prerelease && existsSync(join(root, 'examples')) ? readdirSync(join(root, 'examples')) : []) {
  const rel = `examples/${ex}/package.json`
  if (!existsSync(join(root, rel))) continue
  const j = readJson(join(root, rel))
  for (const deps of [j.dependencies, j.devDependencies]) for (const k in deps ?? {}) if (k.startsWith('@element-editor/')) deps[k] = `^${next}`
  putJson(rel, j)
}
line(`\nBump applied to the working tree:${[...originals.keys()].map((t) => `\n  ${t}`).join('') || ' (no file changes)'}`)

// ── Gate, part 3: checks against the bumped tree ────────────────────────────
const checks = [
  ['install (frozen lockfile)', 'pnpm', ['install', '--frozen-lockfile']],
  ['build', 'pnpm', ['build']],
  ['typecheck (packages + demo)', 'pnpm', ['-r', '--filter', './packages/**', '--filter', '@element-editor/demo', 'typecheck']],
  ['lint (errors fail)', 'pnpm', ['lint']],
  ['unit tests', 'pnpm', ['test']],
  ['check:dist', 'pnpm', ['check:dist']],
  ['check:docs', 'pnpm', ['check:docs']],
  ['check:examples', 'pnpm', ['check:examples']],
]
if (hasSite) {
  checks.push(['site: install', 'pnpm', ['--dir', 'site', 'install', '--frozen-lockfile']])
  checks.push(['site: verify (typecheck, tests, lint, build)', 'pnpm', ['--dir', 'site', 'verify']])
}
for (const [name, cmd, cmdArgs] of checks) {
  line(`\n── ${name}: ${cmd} ${cmdArgs.join(' ')}`)
  const t0 = Date.now()
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
  if (r.status !== 0) {
    restore()
    die(`gate failed at "${name}" (exit ${r.status ?? r.signal}). Nothing was committed or tagged.${failures.length ? `\nAlso failing:\n${failures.map((f) => `  - ${f}`).join('\n')}` : ''}`)
  }
  ok(`${name} (${Math.round((Date.now() - t0) / 1000)} s)`)
}

if (dryRun) {
  restore()
  if (failures.length) die(`[dry run] checks passed, but ${failures.length} repo-state problem(s) would block the release:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  line(`\n[dry run] gate passed${hasSite ? '' : ' (without the site check)'}: ${tag} could be released. Nothing was changed.`)
  process.exit(0)
}
if (noCommit) {
  line('\nGate passed. Files updated; not committed (--no-commit).')
  process.exit(0)
}

// ── Commit and tag ──────────────────────────────────────────────────────────
const touched = [...originals.keys()]
if (touched.length) {
  git('add', ...touched)
  git('commit', '-m', `chore(release): ${next}`)
}
git('tag', '-a', tag, '-m', tag)
originals.clear()
if (prerelease) line(`
Gate passed${hasSite ? '' : ' (WITHOUT the site check)'}. ${touched.length ? `Committed chore(release): ${next} and t` : 'T'}agged ${tag} (prerelease). Nothing is pushed.

Next steps:
  1. Publish:       git push origin main ${tag}
                    (release.yml publishes to the npm dist-tag \`next\`, not \`latest\`, and creates a
                    GitHub prerelease)
  2. The docs site and docs-live ignore prerelease tags: nothing to do there.
  3. Checks after publishing: see RELEASING.md ("After publishing"); use @next / @${next}.`)
else line(`
Gate passed${hasSite ? '' : ' (WITHOUT the site check)'}. ${touched.length ? `Committed chore(release): ${next} and t` : 'T'}agged ${tag}. Nothing is pushed.

Next steps:
  1. Publish:       git push origin main ${tag}
                    (release.yml publishes to npm and creates the GitHub release)
  2. Docs site:     it deploys from the tag on its own within the hour; to deploy now:
                    pnpm release --trigger-site ${tag}
                    (= gh workflow run deploy.yml -R ${SITE_REPO} -f ref=${tag})
  3. docs-live:     if the branch exists, reset it to the new release:
                    git push --force origin ${tag}^{commit}:refs/heads/docs-live
  4. Checks after publishing: see RELEASING.md ("After publishing").`)
