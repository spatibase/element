import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { resolve, isAbsolute } from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({ insertTypesEntry: true, include: ["src/**/*.ts", "src/**/*.tsx"] }),
  ],
  build: {
    assetsInlineLimit: 32 * 1024, // inline the basemap thumbnails (WebP, a few KB each)
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        basemaps: resolve(__dirname, 'src/basemaps/index.ts'),
      },
      name: 'ElementEditorAdapterMapLibre',
      formats: ['es', 'cjs'],
      fileName: (format, name) => (format === 'es' ? `${name}.es.js` : `${name}.cjs`),
    },
    rollupOptions: {
      // Every bare import is a dependency/peer from package.json; never bundle them.
      external: (id: string) => !id.startsWith('.') && !id.startsWith('\0') && !isAbsolute(id),
      // React components: mark entry chunks as client modules so Next.js App Router server
      // components can import them (banner = first line of the emitted file, before CJS 'use strict').
      // `basemaps` stays server-importable: it is framework-neutral (no React).
      output: { banner: (chunk) => (chunk.isEntry && chunk.name === 'index' ? "'use client';" : '') },
    },
  },
})
