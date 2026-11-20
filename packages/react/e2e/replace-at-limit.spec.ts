/**
 * `replaceAtLimit` with `maxFeatures=1`: a draw tool replaces the only feature's geometry
 * (same id) instead of being refused. Dev app: `?maxFeatures=1&replaceAtLimit`.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, mapBox } from './helpers'

const features = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f) => ({ id: f.id, geometry: f.geometry })))

test('a second point replaces the first (same id), undo brings the first back', async ({ page }) => {
  await page.goto('/?maxFeatures=1&replaceAtLimit')
  await waitForMap(page)
  const box = await mapBox(page)
  await page.locator(MAP).click({ position: { x: box.width * 0.3, y: box.height * 0.4 } })

  await page.keyboard.press('p')
  await page.locator(MAP).click({ position: { x: box.width * 0.3, y: box.height * 0.4 } })
  await expect.poll(async () => (await features(page)).length).toBe(1)
  const [first] = await features(page)

  // The limit is reached, yet the tool still turns on and the next click moves the feature.
  await page.keyboard.press('p')
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('place-point')
  await page.locator(MAP).click({ position: { x: box.width * 0.5, y: box.height * 0.6 } })
  await expect.poll(async () => JSON.stringify((await features(page))[0].geometry)).not.toBe(JSON.stringify(first.geometry))

  const after = await features(page)
  expect(after).toHaveLength(1)
  expect(after[0].id).toBe(first.id)
  await expect(page.getByText(/Maximum of 1 feature/)).not.toBeVisible()

  await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
  const undone = await features(page)
  expect(undone).toHaveLength(1)
  expect(undone[0]).toEqual(first)
})
