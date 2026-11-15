import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock @tanstack/react-virtual — jsdom has no layout engine so the virtualizer
// returns zero virtual items.  This mock renders every row at position 0.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; getItemKey?: (i: number) => string | number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        key: opts.getItemKey ? opts.getItemKey(i) : i,
        start: 0,
        size: 36,
      })),
    getTotalSize: () => opts.count * 36,
    scrollToIndex: () => {},
    measureElement: () => {},
  }),
}))

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString() },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    length: 0,
    key: () => null,
  }
})()
// Skipped in `@vitest-environment node` files (server-render tests have no window).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: localStorageMock })

  // jsdom doesn't implement <dialog> — shim the methods tests depend on
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
}

