import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readdirSync, readFileSync } from 'fs'

const basemapsDir = resolve(__dirname, '../../packages/adapter-maplibre/basemaps')

// The demo resolves workspace packages from source so that:
//   1. Web workers are bundled correctly by Vite (worker asset URLs get resolved)
//   2. Hot module replacement works during development
//   3. No need to pre-build packages before running the demo
export default defineConfig(({ command }) => ({
  // Dev only: serve the MapLibre basemap sprite (`/sprite*`) that the npm package gets from jsDelivr.
  publicDir: command === 'serve' ? resolve(__dirname, '../../packages/adapter-maplibre/basemaps') : undefined,
  // The dep scanner doesn't follow `?worker` imports, so the geometry worker's
  // @turf/* deps were only found when a selection first spawned it; Vite then
  // re-optimized and force-reloaded every open page (lost state, flaky e2e).
  // Scan the worker up front.
  optimizeDeps: { entries: ['index.html', '../../packages/ui/src/workers/*.ts'] },
  plugins: [
    react(),
    tailwindcss(),
    {
      // Build: ship only the sprite files (not the thumbs) so `location.origin + '/sprite'` works in production too.
      name: 'emit-basemap-sprite',
      generateBundle() {
        for (const f of readdirSync(basemapsDir).filter((f) => f.startsWith('sprite')))
          this.emitFile({ type: 'asset', fileName: f, source: readFileSync(resolve(basemapsDir, f)) })
      },
    },
  ],
  resolve: {
    // Regex aliases: a string alias also matches subpaths (`…/adapter-maplibre/basemaps` -> `…/index.ts/basemaps`).
    alias: [
      { find: /^@element-editor\/ui$/, replacement: resolve(__dirname, '../../packages/ui/src/index.ts') },
      { find: /^@element-editor\/ui\/internal$/, replacement: resolve(__dirname, '../../packages/ui/src/internal.ts') },
      { find: /^@element-editor\/react$/, replacement: resolve(__dirname, '../../packages/react/src/index.ts') },
      { find: /^@element-editor\/react\/leaflet$/, replacement: resolve(__dirname, '../../packages/react/src/leaflet/index.ts') },
      { find: /^@element-editor\/adapter-leaflet$/, replacement: resolve(__dirname, '../../packages/adapter-leaflet/src/index.ts') },
      { find: /^@element-editor\/adapter-maplibre$/, replacement: resolve(__dirname, '../../packages/adapter-maplibre/src/index.ts') },
      { find: /^@element-editor\/adapter-maplibre\/basemaps$/, replacement: resolve(__dirname, '../../packages/adapter-maplibre/src/basemaps/index.ts') },
    ],
  },
}))
