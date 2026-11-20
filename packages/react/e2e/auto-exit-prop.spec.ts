/**
 * `autoExitAfterDraw` prop (dev app: `?autoExitAfterDraw=1`): it wins over the stored user setting,
 * so after a finished shape the tool is off, the new shape is selected and `onToolChange(null)`
 * fired once. The stored value is 'false' here to prove the prop wins, and is left untouched.
 */
import { test, expect } from './fixtures'
import { waitForMap, drawPolygon } from './helpers'

test('prop true beats a stored "false": polygon ends the tool, selects the shape, onToolChange(null) once', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('elm_autoExitAfterDraw', 'false'))
  await page.goto('/?autoExitAfterDraw=1')
  await waitForMap(page)
  await drawPolygon(page)

  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('none')
  const state = await page.evaluate(() => {
    const d = window.__elementEditorTest!.dataStore.getState()
    return { n: d.features.length, selected: d.selectedIds, id: d.features[0]?.id }
  })
  expect(state.n).toBe(1)
  expect(state.selected).toEqual([state.id])
  const changes = await page.evaluate(() => (window as unknown as { __toolChanges: (string | null)[] }).__toolChanges)
  expect(changes.filter((t) => t === null)).toHaveLength(1)
  expect(changes.at(-1)).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('elm_autoExitAfterDraw'))).toBe('false')
})
