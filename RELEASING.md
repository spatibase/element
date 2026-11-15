# Releasing

All five packages in `packages/*` (`core`, `ui`, `adapter-leaflet`, `adapter-maplibre`, `react`) are released together, always on the same version. `.github/workflows/release.yml` publishes them to npm when a `v*` tag is pushed.

## One-time setup

- The npm organisation `element-editor` exists and the publishing account is an owner of the `@element-editor` scope.
- The repository secret `NPM_TOKEN` holds an npm **granular access token** with read and write access to the `@element-editor` packages (give it a name that says what it is for, e.g. `element GitHub Actions release token`). Granular tokens expire: renew it before it does.
- The GitHub repository is **public**. npm provenance (`--provenance`, `publishConfig.provenance`) is only accepted from public repositories; from a private one the publish fails.

## Versioning policy

- **Lockstep.** All five packages always carry the same version; one tag `vX.Y.Z` releases all of them.
- **Semver, pre-1.0 rules.** While the major is `0`:
  - **minor** (`0.2.0` → `0.3.0`): anything breaking (a removed or renamed export/prop, changed default behaviour an integrator could notice, a raised peer range) and notable new features.
  - **patch** (`0.2.0` → `0.2.1`): bug fixes, docs, performance, internal changes, additive props/methods that change nothing for existing users.
  - `@element-editor/core/internal` and `@element-editor/ui/internal` are not covered: changing them never forces a minor.
  - `1.0.0` only when the maintainers declare the API stable.
- **Every change to a published package gets a CHANGELOG line** under `## [Unreleased]` in the same commit (Keep a Changelog headings: Breaking, Added, Changed, Deprecated, Removed, Fixed). Docs-site-only or test-only changes don't.
- **When to release:** a patch as soon as a user-visible fix lands on `main` and CI is green; a minor when a batch of features or any breaking change is ready (breaking changes are batched, with a migration note in the CHANGELOG entry).

## Release steps

1. On an up-to-date, clean `main` with green CI:
   ```bash
   pnpm release patch          # or: minor | major | 0.3.0   (--date YYYY-MM-DD, --dry-run, --no-commit)
   ```
   `scripts/release.mjs` sets the version in every `packages/*/package.json` and `apps/demo`, sets the `@element-editor/*` ranges in `examples/*` to `^X.Y.Z`, turns `## [Unreleased]` into `## [X.Y.Z] — date` (or dates an already prepared `## [X.Y.Z]` section, as for 0.2.0) and opens a new empty `[Unreleased]`, then commits `chore(release): X.Y.Z` and creates the tag `vX.Y.Z`. It refuses a dirty tree, packages out of lockstep, an existing tag, or an empty `[Unreleased]`.
2. Check locally:
   ```bash
   CI=true pnpm install --frozen-lockfile && pnpm build
   pnpm lint && pnpm test && pnpm check:dist && pnpm check:docs && pnpm check:examples
   pnpm publish -r --access public --no-git-checks --dry-run   # what would be published
   ```
3. Push: `git push origin main vX.Y.Z`. `.github/workflows/release.yml` checks the tag matches every package version, builds, runs `check:dist`, runs `pnpm publish -r` (versions already on npm are skipped, so a rerun after a partial failure is safe) and creates the GitHub release from the CHANGELOG section.

A dry run of the whole workflow (no publish) can be started from the Actions tab: **Release → Run workflow** (`dry_run` is on by default).

## After publishing

- `npm view @element-editor/react@0.3.0` (and the other four) shows the version, and the npm page shows the README and a provenance badge.
- The MapLibre sprite resolves on jsDelivr. Its URL is built from the package version (`DEFAULT_SPRITE_URL` in `packages/adapter-maplibre/src/basemaps/index.ts`), so a release that isn't on npm breaks the icons of every built-in basemap:
  ```bash
  curl -sI https://cdn.jsdelivr.net/npm/@element-editor/adapter-maplibre@0.3.0/basemaps/sprite.json | head -1   # HTTP/2 200
  curl -sI https://cdn.jsdelivr.net/npm/@element-editor/adapter-maplibre@0.3.0/basemaps/sprite@2x.png | head -1
  ```
- A fresh app installs and builds: the nightly workflow (`check:examples --smoke`, Actions → Nightly → Run workflow) does this against the packed tarballs; for the real registry, `npm create vite@latest`, `npm install @element-editor/react maplibre-gl` and follow the quick start.
- The GitHub release exists with the CHANGELOG section (the workflow creates it).
- Update the docs site (elementeditor.dev): sync the docs and add the version to its changelog page.
