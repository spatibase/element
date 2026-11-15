import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { resolve, isAbsolute } from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({ insertTypesEntry: true, include: ['src/**/*.ts', 'src/**/*.tsx'] }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ElementEditorAdapterLeaflet',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.es.js' : 'index.cjs'),
    },
    rollupOptions: {
      // Every bare import is a dependency/peer from package.json; never bundle them.
      external: (id: string) => !id.startsWith('.') && !id.startsWith('\0') && !isAbsolute(id),
      // React components: mark entry chunks as client modules so Next.js App Router server
      // components can import them (banner = first line of the emitted file, before CJS 'use strict').
      output: { banner: (chunk) => (chunk.isEntry ? "'use client';" : '') },
    },
  },
})
