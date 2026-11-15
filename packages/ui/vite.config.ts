import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { resolve, isAbsolute } from 'path'

export default defineConfig({
  // Relative base so the emitted worker URL is `new URL("assets/…", import.meta.url)`
  // (resolved next to the chunk) instead of root-absolute "/assets/…", which 404s
  // for npm consumers.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    dts({ insertTypesEntry: true, include: ['src/**/*.ts', 'src/**/*.tsx'] }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        primitives: resolve(__dirname, 'src/primitives.ts'),
        internal: resolve(__dirname, 'src/internal.ts'),
      },
      name: 'ElementEditorUI',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const base = entryName === 'index' ? 'element-editor-ui' : entryName
        return format === 'es' ? `${base}.es.js` : `${base}.cjs`
      },
    },
    rollupOptions: {
      // Every bare import is a dependency/peer from package.json; never bundle them.
      // (The geometry worker is a separate bundle and still inlines its turf deps.)
      external: (id: string) => !id.startsWith('.') && !id.startsWith('\0') && !isAbsolute(id),
      // React components: mark entry chunks as client modules so Next.js App Router server
      // components can import them (banner = first line of the emitted file, before CJS 'use strict').
      output: { banner: (chunk) => (chunk.isEntry ? "'use client';" : '') },
    },
  },
})
