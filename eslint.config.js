// Lint the library source: `pnpm lint` (CI fails on errors, not warnings).
// typescript-eslint recommended + the React hooks rules.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // `cond && fn()` / `a ? f() : g()` as statements are used on purpose in event handlers.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // Not enforced yet (warnings only; the existing code has dozens of each). Turn them back into
      // errors once the warnings are cleaned up.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Tests call hooks inside renderHook callbacks with arbitrary names.
    files: ['packages/*/src/test/**'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
)
