# Contributing to Element

Thanks for helping. This guide covers the workflow, the tests and the checks a pull request has to pass.

- **Questions and ideas:** [GitHub Discussions](https://github.com/spatibase/element/discussions).
- **Bugs:** [GitHub Issues](https://github.com/spatibase/element/issues), with steps to reproduce and the engine (MapLibre or Leaflet).
- **Security issues:** never in a public issue. Email **security@elementeditor.dev** (see [SECURITY.md](./SECURITY.md)).

## Ground rules

- **pnpm only.** Never run `npm install` or `npm run` in this repo: it writes a `package-lock.json` and drifts the dependencies. The pinned pnpm version is in `package.json` (`packageManager`).
- **Build before you run anything.** The dev apps and the React tests load `packages/*/dist`. Run `pnpm build` after `pnpm install`, after switching branches and in a fresh worktree; a stale build gives a blank page with "does not provide an export named …".
- **CHANGELOG.** Every change to a published package (`packages/*`) adds a line under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md), in the same commit, under the matching heading (Breaking, Added, Changed, Deprecated, Removed, Fixed). Docs-only, test-only and tooling changes (CI, scripts) don't need one. Releases are described in [RELEASING.md](./RELEASING.md): `pnpm release` refuses to tag unless build, typecheck, lint, unit tests, the dist/docs/examples checks and CI on `main` all pass.
- **Docs fixes for the released version** go to the `docs-live` branch (the latest release tag plus docs-only commits; CI rejects anything outside `docs/` and `CHANGELOG.md`) and to `main`. See [RELEASING.md](./RELEASING.md#docs-fixes-between-releases-docs-live).
- **Both engines.** Interaction code lives in the adapters (`packages/adapter-leaflet`, `packages/adapter-maplibre`), shared UI in `packages/ui`. A behaviour change should land on both engines, and every renderer handles every geometry type.
- **Docs.** A new feature, prop or tool updates `docs/` and, where relevant, the package README and `AGENTS.md`.

## Setup

```bash
pnpm install
pnpm build
pnpm dev        # demo app (apps/demo)
pnpm dev:lib    # packages/react's own dev page (Leaflet drop-in; ?engine=maplibre for MapLibre)
```

## Tests

Unit tests live next to each package: `packages/{core,ui,adapter-leaflet,adapter-maplibre}/test/` (pure logic, Vitest against `src`, no build needed) and `packages/react/src/test/` (store and UI integration in jsdom, loads `packages/*/dist`, so build first). E2E and the perf benchmark live in `packages/react`, whose dev app exercises core, ui and both adapters.

| Layer | Tool | Config |
|---|---|---|
| Package unit tests | Vitest (node) | `packages/{core,ui,adapter-leaflet,adapter-maplibre}/vitest.config.ts`, tests in each `test/`, type-checked by each `tsconfig.test.json` |
| Unit + integration (react) | Vitest + jsdom + React Testing Library + user-event | `packages/react/vitest.config.ts`, `src/test/setup.ts` |
| E2E | Playwright (Chromium) | `packages/react/playwright.config.ts` |
| Perf benchmark | Playwright, opt-in | `packages/react/playwright.perf.config.ts` |
| Coverage | v8 (via Vitest) | `vitest.config.ts` |

### Scripts

From the repo root:

```bash
pnpm test        # every package's unit tests once (CI runs the same)
pnpm test:e2e    # Playwright, headless
pnpm test:perf   # large-dataset benchmark, both adapters (opt-in)
pnpm lint
```

In one of the four non-React packages: `pnpm test` (single run) or `pnpm test:watch`. In `packages/react`:

```bash
pnpm validate            # typecheck + vitest run + playwright
pnpm typecheck           # tsc -b: app, configs and tsconfig.test.json (src/test + e2e); CI runs it
pnpm test:run            # Vitest single run (CI)
pnpm test:coverage       # Vitest with v8 coverage
pnpm test:e2e:ui         # Playwright interactive UI
pnpm test:e2e:headed     # visible browser
pnpm test:e2e:debug      # PWDEBUG=1 step-through
pnpm test:e2e:report     # open the last HTML report
```

E2E runs headless by default; use the `headed`, `ui` or `debug` scripts only when you need to watch. If Playwright reports a missing or wrong browser version, run `pnpm exec playwright install chromium` in `packages/react`.

Run `pnpm test:perf` before and after any rendering or store change. Results go to `packages/react/e2e/perf/results/` (git-ignored); the bar is no long tasks and no UI blocking.

### E2E setup

`playwright.config.ts` starts two dev servers, and reuses ones already running on those ports. Override the ports with `E2E_PORT` / `E2E_DEMO_PORT` when testing from a second checkout.

| Project | Server | Specs | What it is |
|---|---|---|---|
| `chromium` | `packages/react`'s own Vite app, port 5196 | everything except `maplibre.spec.ts` | `src/App.tsx` on the **Leaflet** drop-in (`engine: 'leaflet'`) |
| `chromium-maplibre` | same server | same specs | `src/App.tsx` on the **MapLibre** drop-in (`engine: 'maplibre'`) |
| `demo-maplibre` | `apps/demo`, port 5199 | `maplibre.spec.ts` | the demo's `@element-editor/adapter-maplibre` tab |

Run one engine with `--project=chromium` or `--project=chromium-maplibre`. A cold Vite server can make the first run's `goto`s time out; warm it (or start the servers yourself and let `reuseExistingServer` pick them up) before judging failures.

### Fixtures and the engine param (`e2e/fixtures.ts`)

Specs import `test` / `expect` from `./fixtures`, not `@playwright/test`:

- `engine` (`'leaflet' | 'maplibre'`) is a project option. The `page` fixture's `goto` appends `engine=<engine>` to every dev-page URL that doesn't name one, so `page.goto('/?layout=…')` runs on whichever drop-in the project picks. Don't hard-code `?engine=` in a spec.
- Tile hosts (`tile.openstreetmap.org`, `tiles.openfreemap.org`, `tiles.mapterhorn.com`, `*.example.test`) are answered offline for every test: PNG tiles get a transparent pixel, the rest abort.
- `window.__elementEditorTest` / `__elementEditorRef` / `__leafletMap` are typed globally (real store types, `map: LeafletMap | MapLibreMap`): write `window.__elementEditorTest!.dataStore.getState()…` inside `page.evaluate`, never a per-file `Win` type or `as any`. Narrow the map with `as MapLibreMap` / `as LeafletMap` only in engine-specific code.
- `MAP` (`:is(.leaflet-container, .maplibregl-map)`), `ATTRIBUTION`, `ATTRIBUTION_TOGGLE` are engine-neutral selectors.
- Each test has a fresh browser context, so localStorage starts empty.

Keep a spec engine-neutral when you can (store-based helpers, `screenPoint`, `MAP`). Otherwise mark it:

```ts
test.skip(({ engine }) => engine !== 'leaflet', 'Leaflet canvas renderer')   // whole file or describe
test('…', async ({ page, engine }) => {
  test.fixme(engine === 'maplibre', 'parity: <what MapLibre lacks>')        // a known product gap
  if (engine === 'leaflet') { /* Leaflet-only extra assertions */ }
})
```

Use `skip` for something only one engine has (the Leaflet canvas renderer, raster `basemaps`/`tileLayer`, MapLibre's basemap catalog) and `fixme` for parity bugs, with the reason.

### Dev page query parameters (`packages/react/src/App.tsx`)

The page mounts the Leaflet drop-in by default (the e2e fixture always passes `engine=`).

| Param | Effect |
|---|---|
| `?engine=leaflet\|maplibre` | which drop-in to mount |
| `?basemaps=0` | MapLibre: `basemaps={false}` (no picker) |
| `?basemaps=streets,style,raster` | MapLibre: the `basemaps` list; built-in ids plus `style` (a custom style object) and `raster` (a custom `{ url }`) |
| `?basemap=<id>` | MapLibre: the initial `basemap` prop |
| `?tileLayer=1` | Leaflet: a custom `tileLayer`, which overrides `basemaps` |
| `?basemaps=osm,custom` / `?basemaps=custom` | Leaflet: a raster `basemaps` list / a single raster entry (no picker) |
| `?bounds=west,south,east,north` | the `bounds` prop; add `&legacyBounds=1` for the deprecated `[[south, west], [north, east]]` form |
| `?persistKey=<key>`, `?persist=0` | `config.persistKey` / `config.persist: false` |
| `?renderer=svg` | Leaflet: SVG instead of canvas for unselected features |
| `?layout=...` | `config.ui.layout` as JSON |
| `?editorLayout=panel\|minimal\|split` | the `layout` prop |
| `?readonly=1`, `?submit=1` | `readonly` / an `onSubmit` handler |
| `?network=custom`, `?network=off` | every service on `*.example.test` hosts / Overpass, routing and search off |
| `?routingApiKey=<key>` | the deprecated routing key prop |

The built-in MapLibre basemap styles are bundled, but their sprite is fetched. In dev, `packages/react/vite.config.ts` serves `packages/adapter-maplibre/basemaps` as the public dir (only for `serve`, never the library build) and the dev page points `config.network.sprite` at it, so no test needs a CDN.

### Test hooks and helpers

- In dev builds only, the shell and the adapters expose `window.__elementEditorTest` (`dataStore`, `uiStore` and the `map` instance) and `window.__elementEditorRef`. Drive state and read the map through these rather than the DOM.
- `e2e/helpers.ts` (all engine-neutral): `waitForMap`, `mapLocator`/`mapBox`, `importGeoJSON`, `drawPolygon/Line/Rect` (`drawPolygon` waits for the commit and returns the centre), `flyTo`, `screenPoint(page, lng, lat)`, `featureCenter`, `selectedIds`, `featureCount`, `editingMode`, `storeCaller(page)`, `selectByName`, `mockNominatim`, …
- Locate features through the store and projection (`featureCenter`, `screenPoint`, `selectedIds`), not the DOM: Leaflet draws unselected features on one shared canvas and MapLibre draws everything in WebGL. Vertex handles are `.elm-vertex` and midpoints `.elm-midpoint-marker` on both engines; only the hovered edge's midpoint is visible (`.elm-midpoint-marker:visible` or `hoverFirstEdgeMidpoint(page)`).
- MapLibre uses 512 px tiles, so the same zoom shows twice Leaflet's scale. Never assume a feature's pixel size at a zoom; project its coordinates.
- Leaflet's canvas hit-tests at most one mousemove per 32 ms; re-move inside `expect.poll` when checking hover.
- Don't click a feature you just drew to select it: the commit already selects it (poll `selectedIds`).
- Leaflet fires two `click` events before `dblclick`; leave about 300 ms between synthetic clicks when adding vertices.
- Debounces: freeze time with `page.clock` (`install()` before `goto`, then `pauseAt` / `runFor` / `resume`) instead of sleeping.
- Never hit live services. Mock Nominatim with `page.route('**/nominatim.openstreetmap.org/**', ...)`; tile hosts are handled by the fixture.
- The GeoJSON inspector (CodeMirror) renders only visible lines. Drive it through `document.querySelector('.cm-content').cmTile.view`, not by counting `.cm-line` elements.

### Known flaky tests

- `maplibre.spec.ts` (project `demo-maplibre`) can lose a few tests to timeouts under parallel load; it passes alone: `pnpm exec playwright test maplibre.spec.ts --workers=1`.
- Locators that match hidden copies of the same text fail strict mode; scope new locators to the element you mean (as `smoke.spec.ts` does with `aside`).

### Unit and integration tests

- Package tests import `src` directly and need no build. A known bug is pinned with `it.fails` plus a comment; when you fix it, flip it to `it` and reword the comment as a regression note.
- Unit tests and e2e specs are type-checked by `tsconfig.test.json` (`pnpm typecheck`), so `expectTypeOf` and `// @ts-expect-error` really run.
- Both stores are reset in `beforeEach` via `setState`. Use `renderWithProviders()` from `packages/react/src/test/helpers.tsx` for components that need the store, event and map-controller contexts.
- jsdom has no `<dialog>.showModal()`/`close()`; `src/test/setup.ts` shims them. Components that call react-leaflet's `useMap()` need a `vi.mock('react-leaflet', …)`.

## Docs checks

These run against the built packages (`pnpm build` first) and resolve imports the way a consumer does, through each package's `exports` to `dist`. CI runs `check:docs` and `check:examples` on every PR; the nightly workflow adds a browser smoke test.

| Command | What it checks |
|---|---|
| `pnpm check:docs` | every ` ```ts ` / ` ```tsx ` block in `docs/**`, the READMEs and the `AGENTS.md` files type-checks; every `interface X { … }` block in `docs/reference` and the prop tables in `TABLES` (`scripts/check-api-docs.mjs`) match the dist types |
| `pnpm check:examples [--smoke] [--keep] [name …]` | packs the five packages, installs each `examples/*` app from the tarballs and builds it; `--smoke` also loads every page in headless Chromium |

Snippet conventions:

- **Quickstart and README blocks are starters:** they import everything they use and declare every name.
- **Other blocks are fragments:** they see a hidden prelude (`ElementEditor`, `ref`, `map`, `useState`, `GeoJSONFeature`, …; see `PRELUDE` in `scripts/check-doc-snippets.mjs`). Wrong props, wrong types and missing exports still fail.
- ` ```tsx check=false ` opts a block out. Use it only for code meant not to compile on its own ("before" code in migration guides, `...` placeholders).
- Errors print as `docs/guides/x.md:LINE:COL TS2322 …` (and as GitHub annotations in CI).
- A new reference prop table goes in `TABLES` in `scripts/check-api-docs.mjs`; tables are found by heading, not by comment markers.

The `examples/` apps (`vite-maplibre`, `vite-leaflet`, `nextjs-app-router`) are outside the pnpm workspace on purpose, with published version ranges and no lockfile, so they install like a new user's app. Keep them minimal and in step with the quickstarts.

## Pull requests

Before opening one:

```bash
pnpm build && pnpm lint && pnpm test && pnpm --filter @element-editor/react typecheck && pnpm check:docs
pnpm test:e2e
```

Keep each PR to one change, describe what users will notice, and include the CHANGELOG line.

By contributing you agree that your contribution is licensed under the [MIT licence](./LICENSE).
