import { defineConfig } from 'vitest/config'

// Unit tests for this package's own logic. Tests import ./src directly (not dist),
// so they need no `pnpm build` first. Kept apart from vite.config.ts so the
// library build plugins (dts, tailwind) never load under vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
