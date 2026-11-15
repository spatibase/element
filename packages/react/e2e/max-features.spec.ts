/**
 * `maxFeatures` — the limit is enforced in dataStore, and drawing shortcuts
 * refuse to start a tool at the limit (same as the toolbar buttons).
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

test('polygon shortcut at the limit does not start drawing and says why', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await importGeoJSON(page, SAMPLE_GEOJSON)
  const count = await page.evaluate(() => {
    const h = window.__elementEditorTest!
    const n = h.dataStore.getState().features.length
    h.dataStore.getState().setMaxFeatures(n)
    return n
  })
  expect(count).toBeGreaterThan(0)

  await page.locator(MAP).click()
  await page.keyboard.press('g')

  await expect(page.getByText(`Maximum of ${count} features reached — delete some to add more.`)).toBeVisible({ timeout: 2000 })
  const mode = await page.evaluate(() =>
    window.__elementEditorTest!.uiStore.getState().editingMode)
  expect(mode).toBe('none')
  await expect(page.getByText(/click to (place the first|add) point/i)).not.toBeVisible()
})
