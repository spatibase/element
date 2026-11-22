import { defineConfig, devices } from '@playwright/test'
import type { Engine } from './e2e/fixtures'

// Port for apps/demo. Its Vite default is also 5173, and 5174-5180 are often
// taken by ad-hoc demo/playground servers, so pin an unusual one.
const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 5199)
// Override both (E2E_PORT / E2E_DEMO_PORT) to run from a second checkout without
// reuseExistingServer silently testing another tree's dev server.
// Not Vite's default 5173: any stray dev server there (e.g. apps/demo) would be
// silently reused via reuseExistingServer and the suite would test the wrong app.
const PORT = Number(process.env.E2E_PORT ?? 5196)

const WEBKIT_SPECS = /(vertex-editing|vertex-edit-api|edge-drag-insert|drag-selected|click-select|drawing)\.spec\.ts/

export default defineConfig<{ engine: Engine }>({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI runs the suite as a sharded matrix (.github/workflows/ci.yml); each shard also writes an HTML
  // report that the workflow uploads when the shard fails (traces are recorded on the first retry).
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      // packages/react's own dev app (src/App.tsx) on the Leaflet drop-in. Specs import `test` from
      // e2e/fixtures.ts, whose `engine` option appends `engine=` to every dev-page URL.
      name: 'chromium',
      testIgnore: /(maplibre|headless-[\w-]+)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], engine: 'leaflet' },
    },
    {
      // Same server and specs on the MapLibre drop-in (`?engine=maplibre`). Engine-specific specs
      // skip themselves with `test.skip(({ engine }) => ...)`.
      name: 'chromium-maplibre',
      testIgnore: /(maplibre|headless-[\w-]+)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], engine: 'maplibre' },
    },
    {
      // maplibre.spec needs the demo's "@element-editor/adapter-maplibre" tab, which
      // only exists in apps/demo.
      name: 'demo-maplibre',
      testMatch: /maplibre\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DEMO_PORT}` },
    },
    {
      // Headless hosts (apps/demo `?headless=<engine>`): the adapter controls alone; Pixel 7 is set in the spec.
      name: 'demo-headless',
      testMatch: /headless-[\w-]+\.spec\.ts/,
    },
    // WebKit (Desktop Safari) on the pointer-interaction specs only: point editing (drag, insert, delete,
    // ref entry), plain drag on a selection, click-select and drawing, for both engines and the headless host.
    // The full suite stays Chromium; this set catches engine differences in mouse/click event order.
    {
      name: 'webkit',
      testMatch: WEBKIT_SPECS,
      use: { ...devices['Desktop Safari'], engine: 'leaflet' },
    },
    {
      name: 'webkit-maplibre',
      testMatch: WEBKIT_SPECS,
      use: { ...devices['Desktop Safari'], engine: 'maplibre' },
    },
    {
      name: 'webkit-headless',
      testMatch: /headless-vertex-drag\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: `pnpm exec vite --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: true,
    },
    {
      command: `pnpm --dir ../../apps/demo exec vite --port ${DEMO_PORT} --strictPort`,
      port: DEMO_PORT,
      reuseExistingServer: true,
    },
  ],
})
