/**
 * Compile-time checks for the slot-specific layout types (run by `pnpm typecheck`):
 * every `@ts-expect-error` must fire, or tsc fails with "Unused '@ts-expect-error' directive".
 */
import { it, expect } from 'vitest'
import { DEFAULT_LAYOUT, withLayout, type LayoutConfig } from '../../shared'

it('the layout types accept the common forms', () => {
  const full: LayoutConfig = {
    topCenter: ['toolbar'],
    leftCenter: [{ group: ['undo', 'separator', 'redo'] }],
    bottomLeft: ['basemap', 'fitBounds', { group: ['table', 'separator', 'schema'] }, 'applyChanges'],
    bottomRight: { items: ['settings', 'keyboard'], direction: 'vertical' },
    statusLeft: [{ group: ['undo', 'redo'] }, 'separator', 'basemap', 'keyboard'],
    statusRight: ['zoomIndicator', 'separator', { group: ['locate', 'attribution'] }],
  }
  const spread: LayoutConfig = { ...DEFAULT_LAYOUT, statusRight: ['attribution'] }
  const local = { topLeft: ['table'], statusRight: ['attribution'] } as const satisfies LayoutConfig
  const patched: LayoutConfig = withLayout({ move: { table: 'topRight', attribution: 'statusRight', locate: { slot: 'bottomRight', at: 'start' } }, hide: ['keyboard'] })
  withLayout({ hide: ['geojson'] }, local)
  expect([full, spread, patched].every(Boolean)).toBe(true)
})

it('the layout types reject what the resolver would drop', () => {
  const bad: LayoutConfig[] = [
    // @ts-expect-error -- attribution only goes in the status bar
    { topLeft: ['attribution'] },
    // @ts-expect-error -- a bare separator over the map has nothing to draw on
    { bottomLeft: ['table', 'separator'] },
    // @ts-expect-error -- status slots are always horizontal (no { items, direction })
    { statusLeft: { items: ['locate'], direction: 'vertical' } },
    // @ts-expect-error -- the toolbar can't go in the status bar
    { statusRight: ['toolbar'] },
    // @ts-expect-error -- nor applyChanges, also inside a group
    { statusRight: [{ group: ['applyChanges'] }] },
    // @ts-expect-error -- the toolbar can't go in a group
    { topLeft: [{ group: ['toolbar'] }] },
    // @ts-expect-error -- nor the basemap picker
    { statusLeft: [{ group: ['basemap'] }] },
    // @ts-expect-error -- groups don't nest
    { bottomLeft: [{ group: [{ group: ['table'] }] }] },
    // @ts-expect-error -- unknown slot
    { middle: ['table'] },
  ]
  // @ts-expect-error -- the toolbar only moves to a map slot
  withLayout({ move: { toolbar: 'statusLeft' } })
  // @ts-expect-error -- attribution only moves to the status bar
  withLayout({ move: { attribution: { slot: 'topLeft' } } })
  // @ts-expect-error -- 'search' is a drawing tool (config.tools), not a layout control
  withLayout({ hide: ['search'] })
  expect(bad).toHaveLength(9)
})
