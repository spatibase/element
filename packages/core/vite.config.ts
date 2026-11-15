import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve, isAbsolute } from 'path'

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts'],
    }),
  ],
  build: {
    lib: {
      // `internal` = @element-editor/core/internal (not semver-covered plumbing for the other packages).
      // Modules both entries use land in shared chunks, so module state exists once.
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        internal: resolve(__dirname, 'src/internal.ts'),
      },
      name: 'ElementEditorCore',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'es.js' : 'cjs'}`,
    },
    rollupOptions: {
      // Every bare import is a dependency/peer from package.json; never bundle them.
      external: (id: string) => !id.startsWith('.') && !id.startsWith('\0') && !isAbsolute(id),
    },
  },
})
