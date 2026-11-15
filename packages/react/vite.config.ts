import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { resolve, isAbsolute } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Dev only: serve the MapLibre basemap sprite (`/sprite*`). Must stay unset for the library build,
  // or vite copies the sprite into dist.
  publicDir: command === 'serve' ? resolve(__dirname, '../adapter-maplibre/basemaps') : false,
  resolve: {
    // Dev server only: resolve workspace packages from source so HMR works and no
    // pre-build is needed. The library build must NOT alias them, or they get
    // bundled into dist and the emitted .d.ts point at ../../ui/src.
    // Regex (not string) aliases: a string alias also matches subpaths (`…/adapter-maplibre/basemaps`).
    alias: command === 'serve'
      ? [
          { find: /^@element-editor\/ui$/, replacement: resolve(__dirname, '../ui/src/index.ts') },
          { find: /^@element-editor\/ui\/internal$/, replacement: resolve(__dirname, '../ui/src/internal.ts') },
          { find: /^@element-editor\/adapter-leaflet$/, replacement: resolve(__dirname, '../adapter-leaflet/src/index.ts') },
          { find: /^@element-editor\/adapter-maplibre$/, replacement: resolve(__dirname, '../adapter-maplibre/src/index.ts') },
          { find: /^@element-editor\/adapter-maplibre\/basemaps$/, replacement: resolve(__dirname, '../adapter-maplibre/src/basemaps/index.ts') },
          { find: /^@element-editor\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
          // Must be aliased together with core: a dist copy of the internal entry would carry its own
          // module state (shortcut cache, geometry runner) next to the src one.
          { find: /^@element-editor\/core\/internal$/, replacement: resolve(__dirname, '../core/src/internal.ts') },
        ]
      : [],
  },
  // The dep scanner doesn't follow `?worker` imports, so the geometry worker's
  // @turf/* deps were only found when a selection first spawned it; Vite then
  // re-optimized and force-reloaded every open page (lost state, flaky e2e).
  // Scan the worker up front.
  optimizeDeps: { entries: ['index.html', '../ui/src/workers/*.ts'] },
  plugins: [
    react(),
    tailwindcss(),
    dts({
      tsconfigPath: './tsconfig.app.json',
      insertTypesEntry: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/test/**', 'src/App.tsx', 'src/main.tsx'],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        leaflet: resolve(__dirname, 'src/leaflet/index.ts'),
      },
      formats: ['es', 'cjs'],
      // index keeps the historical `element-editor.*` names; leaflet.* for the subpath.
      fileName: (format, name) => `${name === 'index' ? 'element-editor' : name}.${format === 'es' ? 'es.js' : 'cjs'}`,
    },
    cssCodeSplit: true,
    rollupOptions: {
      // Every bare import is a dependency/peer from package.json; never bundle them
      // (bundling core/ui would duplicate stores and contexts for consumers).
      external: (id: string) => !id.startsWith('.') && !id.startsWith('\0') && !isAbsolute(id),
      output: {
        // Both entries are React components: mark them as client modules so Next.js App Router
        // server components can import them (banner = first line of the file, before CJS 'use strict').
        banner: (chunk) => (chunk.isEntry ? "'use client';" : ''),
        assetFileNames: (assetInfo) => {
          // One CSS file per entry (cssCodeSplit); vite names each after its entry: index.css / leaflet.css.
          const n = assetInfo.names?.[0] ?? assetInfo.name ?? ''
          if (n.endsWith('.css')) return n.startsWith('leaflet') ? 'element-editor-leaflet.css' : 'element-editor.css'
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
}))
