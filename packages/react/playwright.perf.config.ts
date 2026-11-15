import { defineConfig, devices } from '@playwright/test'

// Opt-in large-dataset benchmark (`pnpm test:perf`). Kept out of the normal
// suite: `*.perf.ts` doesn't match Playwright's default *.spec/*.test pattern.
// Own ports so a stray dev server on 5173 (often apps/demo) isn't reused.
// Override (PERF_PORT / PERF_DEMO_PORT) to run several checkouts side by side.
const LIB_PORT = Number(process.env.PERF_PORT ?? 5197)
const DEMO_PORT = Number(process.env.PERF_DEMO_PORT ?? 5198)

export default defineConfig({
  testDir: './e2e/perf',
  testMatch: /\.perf\.ts$/,
  fullyParallel: false,
  workers: 1, // timings: one browser at a time
  timeout: 10 * 60_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    // Headless Chromium defaults to SwiftShader (software WebGL), which makes
    // MapLibre's frame times measure the CPU rasteriser, not the editor. Use the
    // real GPU; PERF_SWGL=1 opts back into software GL.
    launchOptions: process.env.PERF_SWGL ? {} : {
      args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    },
  },
  projects: [
    { name: 'leaflet', use: { baseURL: `http://localhost:${LIB_PORT}` } },
    { name: 'maplibre', use: { baseURL: `http://localhost:${DEMO_PORT}` } },
  ],
  webServer: [
    { command: `pnpm exec vite --port ${LIB_PORT} --strictPort`, port: LIB_PORT, reuseExistingServer: true },
    { command: `pnpm --dir ../../apps/demo exec vite --port ${DEMO_PORT} --strictPort`, port: DEMO_PORT, reuseExistingServer: true },
  ],
})
