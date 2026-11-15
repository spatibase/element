// core has no @types/node; only `process.env.NODE_ENV` is read (and replaced by bundlers).
declare const process: { env: { NODE_ENV?: string } }

const warned = new Set<string>()

// Not `import.meta.env.DEV`: Vite inlines that as `false` in our library build, so integrators
// never saw these warnings. `process.env.NODE_ENV` survives library mode and the consumer's
// bundler decides. Keep the expression bare (no `typeof process`, no `?.`) so bundler
// defines match it; the catch covers a bundler-less browser where `process` is undefined.
let isDev = false
try { isDev = process.env.NODE_ENV !== 'production' } catch { /* no bundler define: stay quiet */ }

/**
 * True in a development build of the host app (`process.env.NODE_ENV !== 'production'`, as the
 * host's bundler defines it). Gate dev-only checks on this, not on `import.meta.env.DEV` (inlined
 * as `false` in our library build).
 */
export function isDevBuild(): boolean {
  return isDev
}

/** Dev-only `console.warn`, once per `key` per page load. Silent in production builds. */
export function warnOnce(key: string, message: string): void {
  if (!isDev || warned.has(key)) return
  warned.add(key)
  console.warn(`[element-editor] ${message}`)
}
