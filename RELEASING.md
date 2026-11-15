# Releasing

All five packages in `packages/*` (`core`, `ui`, `adapter-leaflet`, `adapter-maplibre`, `react`) are released together, always on the same version. `.github/workflows/release.yml` publishes them to npm when a `v*` tag is pushed.

## One-time setup

- The npm organisation `element-editor` exists and the publishing account is an owner of the `@element-editor` scope, with 2FA on.
- **Trusted publishing (OIDC).** `release.yml` authenticates to npm with a short-lived OIDC token from GitHub Actions; no npm token is stored in the repository. On npmjs.com, each of the five packages has, under **Settings → Trusted publishing**, a GitHub Actions trusted publisher with:
  - Organization or user: `spatibase`
  - Repository: `element`
  - Workflow filename: `release.yml`
  - Environment: empty
  - Allowed actions: **`npm publish` allowed** (direct publishing). A configuration that only allows `npm stage publish` (npm's default for new configurations) makes every CI publish wait for a manual approval on npmjs.com.

  A new configuration must publish successfully within **2 days** or it expires (it can then only be deleted and recreated), so add or recreate the configurations right before pushing a release tag.

  The fields are case-sensitive and npm only checks them when a publish runs. Renaming the workflow file, moving the repository or adding a GitHub environment to the job breaks publishing until every package's configuration is updated. `repository.url` in each `package.json` must keep pointing at `github.com/spatibase/element`.
- **Publishing access** on each package (Settings → Publishing access): "Require two-factor authentication and disallow tokens". Trusted publishing keeps working with it; classic and granular tokens can no longer publish.
- No npm token: the repository has no `NPM_TOKEN` secret and nothing needs renewing. (Up to 0.2.0 the workflow used a granular token; npm now stages publishes made with such tokens until a maintainer approves them. If that secret or token still exists, delete the secret and revoke the token on npmjs.com.)
- The GitHub repository is **public**. npm generates provenance automatically for trusted publishing from a public repository (the packages also set `publishConfig.provenance`); from a private one there is no provenance.
- Publishing runs on GitHub-hosted runners only: npm trusted publishing does not support self-hosted runners.

### Adding a new package

Trusted publishing is configured per package, and a package must exist on npm before it can have a trusted publisher. For a new `packages/<name>`:

1. Add it to the package lists in `release.yml` (the "Pack" and "Publish to npm" steps, in dependency order) and give it the same `version`, `publishConfig` and `repository` fields as the others.
2. Publish its first version by hand from a maintainer machine (`npm login`, then `pnpm pack` in the package directory and `npm publish <tarball> --access public`), with 2FA.
3. On npmjs.com, add its trusted publisher (fields above) and set its publishing access to "Require two-factor authentication and disallow tokens". Its configuration expires if it hasn't published within 2 days, so do this right before the next release.

## Versioning policy

- **Lockstep.** All five packages always carry the same version; one tag `vX.Y.Z` releases all of them.
- **Semver, pre-1.0 rules.** While the major is `0`:
  - **minor** (`0.2.0` → `0.3.0`): anything breaking (a removed or renamed export/prop, changed default behaviour an integrator could notice, a raised peer range) and notable new features.
  - **patch** (`0.2.0` → `0.2.1`): bug fixes, docs, performance, internal changes, additive props/methods that change nothing for existing users.
  - `@element-editor/core/internal` and `@element-editor/ui/internal` are not covered: changing them never forces a minor.
  - `1.0.0` only when the maintainers declare the API stable.
- **Every change to a published package gets a CHANGELOG line** under `## [Unreleased]` in the same commit (Keep a Changelog headings: Breaking, Added, Changed, Deprecated, Removed, Fixed). Docs-only, test-only and tooling changes (CI, scripts) don't.
- **When to release:** a patch as soon as a user-visible fix lands on `main` and CI is green; a minor when a batch of features or any breaking change is ready (breaking changes are batched, with a migration note in the CHANGELOG entry).

## Release gate

Nothing ships without cross-validation: `pnpm release` refuses to bump, commit or tag unless every check below passes, and the docs site (elementeditor.dev) only ever shows released code.

1. **Repo state:** on `main`, clean tree, `HEAD` equal to `origin/main`, the CI workflow green for that exact commit (so the e2e suite has passed), tag `vX.Y.Z` free locally and on `origin`, packages in lockstep.
2. **CHANGELOG:** `## [Unreleased]` has entries, or a `## [X.Y.Z]` section for the target version is already prepared.
3. **The bump is applied to the working tree,** then checked as it will be tagged: `pnpm install --frozen-lockfile`, `pnpm build`, typecheck of every package and the demo, `pnpm lint` (errors fail), `pnpm test`, `pnpm check:dist`, `pnpm check:docs`, `pnpm check:examples`.
4. **The docs site:** the private site checkout lives at `./site` (git-ignored) in the maintainer's checkout. The gate runs `pnpm --dir site install --frozen-lockfile` and `pnpm --dir site verify` (typecheck, tests, lint, build) against the bumped tree. Without `./site` the release is refused unless `--no-site` is passed, which prints a warning: the site would then first be built against the tag by its own deploy.

Any failure restores the files the bump touched and exits non-zero; nothing is committed or tagged. `--dry-run` runs the whole gate and changes nothing (it lists every repo-state problem and still runs the checks, so one run shows all that blocks a release). The gate takes several minutes.

## Release steps

1. On an up-to-date, clean `main` whose CI is green, in the checkout that has `./site`:
   ```bash
   pnpm release patch --dry-run   # optional: the gate only
   pnpm release patch             # or: minor | major | 0.3.0   (--date YYYY-MM-DD, --no-commit, --no-site)
   ```
   `scripts/release.mjs` sets the version in every `packages/*/package.json` and `apps/demo`, sets the `@element-editor/*` ranges in `examples/*` to `^X.Y.Z`, turns `## [Unreleased]` into `## [X.Y.Z] — date` (or dates an already prepared `## [X.Y.Z]` section) and opens a new empty `[Unreleased]`, runs the gate, then commits `chore(release): X.Y.Z` and creates the tag `vX.Y.Z`. It never pushes.
   **Releasing the version already in `package.json`** (0.2.0 was set before it was ever tagged): `pnpm release 0.2.0` dates the prepared `## [0.2.0]` section, runs the gate, commits and tags `v0.2.0`.
2. Push: `git push origin main vX.Y.Z`. `.github/workflows/release.yml` checks the tag matches every package version, builds, runs `check:dist`, packs every package with `pnpm pack` (which turns the `workspace:*` ranges into the real version), publishes the tarballs with `npm publish` in dependency order (core, ui, the two adapters, react) through trusted publishing, and creates the GitHub release from the CHANGELOG section. A version already on npm is skipped, so a rerun after a partial failure is safe.
3. The docs site deploys from the tag. Its deploy workflow checks hourly for a new release tag (or `docs-live` commit), so it goes live within the hour; to deploy right away run `pnpm release --trigger-site vX.Y.Z` (it runs `gh workflow run deploy.yml -R spatibase/element-web -f ref=vX.Y.Z` and needs `gh` logged in with access to the site repo). No token for the site lives in this repository.
4. If `docs-live` exists, reset it to the new tag: `git push --force origin vX.Y.Z^{commit}:refs/heads/docs-live`. (Until then the site ignores it: it uses `docs-live` only when the branch contains the latest tag.)

The script prints these steps after tagging. A dry run of the publish workflow (no publish) can be started from the Actions tab: **Release → Run workflow** (`dry_run` is on by default): it builds, packs and runs `npm publish --dry-run` on each tarball whose version isn't on npm yet. With the `tag` input (e.g. `v0.2.0`) and `dry_run` off, the same run builds that tag's source with the current workflow steps and publishes whatever of it isn't on npm yet (and creates its GitHub release if missing): the way to finish a release whose publish failed. A version that is staged on npm but not approved blocks publishing the same version: approve it, or reject it (`npm stage reject`) first.

## Prereleases

For a beta or release candidate, give the version explicitly: `pnpm release 0.3.0-beta.1` (accepted suffixes: `-alpha.N`, `-beta.N`, `-rc.N`). The gate and the CHANGELOG handling are the same (the section is `## [0.3.0-beta.1]`), except that `examples/*` keep their stable `^x.y.z` range. Push as usual: `git push origin main v0.3.0-beta.1`.

- `release.yml` publishes a version with a prerelease suffix to the npm dist-tag **`next`**, so `npm install @element-editor/react` keeps getting the latest stable version; testers install `@element-editor/react@next` (or the exact version). Stable versions go to `latest`.
- The GitHub release is marked as a prerelease.
- The docs site and the `docs-live` guard only consider `vX.Y.Z` tags, so a prerelease never deploys the docs; skip release steps 3 and 4.
- While the current version is a prerelease, `patch`/`minor`/`major` are refused: name the next version (`0.3.0-beta.2`, `0.3.0-rc.1`, or `0.3.0` for the final release). After the final release, `next` still points at the last prerelease; that is harmless, or move it with `npm dist-tag add @element-editor/<pkg>@0.3.0 next` from a maintainer machine.

## Docs fixes between releases (`docs-live`)

The site shows the docs of the latest release. To fix those docs without releasing:

1. Branch from the latest tag (or from `docs-live` if it already contains it): `git switch -c docs-fix vX.Y.Z`.
2. Commit **docs-only** changes: `docs/` and `CHANGELOG.md`, nothing else.
3. Push it as `docs-live`: `git push origin HEAD:docs-live` (or open a PR into `docs-live`). `.github/workflows/docs-live.yml` fails if the branch doesn't contain the latest `v*` tag or if `git diff <tag>..HEAD` touches anything outside `docs/` and `CHANGELOG.md`; it also builds and runs `check:docs`.
4. The site redeploys from `docs-live` (within the hour, or `gh workflow run deploy.yml -R spatibase/element-web` to do it now).
5. The same commits also go to `main` (cherry-pick, or a PR), so the next release keeps them.

After the next release, `docs-live` is reset to the new tag (step 4 of the release steps).

## After publishing

- `npm view @element-editor/react@0.3.0` (and the other four) shows the version, and the npm page shows the README and a provenance badge.
- The MapLibre sprite resolves on jsDelivr. Its URL is built from the package version (`DEFAULT_SPRITE_URL` in `packages/adapter-maplibre/src/basemaps/index.ts`), so a release that isn't on npm breaks the icons of every built-in basemap:
  ```bash
  curl -sI https://cdn.jsdelivr.net/npm/@element-editor/adapter-maplibre@0.3.0/basemaps/sprite.json | head -1   # HTTP/2 200
  curl -sI https://cdn.jsdelivr.net/npm/@element-editor/adapter-maplibre@0.3.0/basemaps/sprite@2x.png | head -1
  ```
- A fresh app installs and builds: the nightly workflow (`check:examples --smoke`, Actions → Nightly → Run workflow) does this against the packed tarballs; for the real registry, `npm create vite@latest`, `npm install @element-editor/react maplibre-gl` and follow the quick start.
- The GitHub release exists with the CHANGELOG section (the workflow creates it).
- The docs site (elementeditor.dev) deployed from the tag: `gh run list -R spatibase/element-web --workflow deploy.yml -L 3`, and its changelog page shows the version (it reads `CHANGELOG.md` and `docs/` at the tag).
