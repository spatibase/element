import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The tests exercise this package's shell plus core/ui/adapter source they import by relative
      // path (`@element-editor/*` imports resolve to the built dist and aren't counted).
      allowExternal: true,
      include: ['src/**', '../core/src/**', '../ui/src/**', '../adapter-maplibre/src/**', '../adapter-leaflet/src/**'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/App.tsx', '**/*.d.ts', '**/*.json'],
    },
  },
})
