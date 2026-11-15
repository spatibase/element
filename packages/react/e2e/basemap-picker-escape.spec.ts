/**
 * Basemap picker keyboard behaviour on the MapLibre drop-in (project chromium-maplibre):
 * Escape closes an open picker without deselecting the feature (the editor's
 * window capture Escape handler yields to it), and the picker is reachable by keyboard.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, drawPolygon, selectedIds } from './helpers'

test.skip(({ engine }) => engine !== 'maplibre', 'MapLibre BasemapControl (the Leaflet picker: leaflet-basemaps.spec.ts)')

const selected = async (page: Page) => (await selectedIds(page)).length

async function openWithSelectedPolygon(page: Page) {
  await page.goto('/')
  await waitForMap(page)
  await page.locator('.maplibregl-canvas').first().focus()
  await drawPolygon(page)
  await expect.poll(() => selected(page)).toBe(1)
}

test('Escape closes the open picker and keeps the selection', async ({ page }) => {
  await openWithSelectedPolygon(page)
  const toggle = page.getByRole('button', { name: 'Basemap' })
  const panel = page.getByRole('group', { name: 'Basemap' })
  await toggle.click()
  await expect(panel).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  expect(await selected(page)).toBe(1)

  // Picker closed: the next Escape deselects as usual.
  await page.keyboard.press('Escape')
  await expect.poll(() => selected(page)).toBe(0)
})

test('keyboard: Enter opens with the active tile focused, Escape returns focus to the button', async ({ page }) => {
  await openWithSelectedPolygon(page)
  const toggle = page.getByRole('button', { name: 'Basemap' })
  const panel = page.getByRole('group', { name: 'Basemap' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await expect(panel.locator('button[aria-pressed="true"]')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(toggle).toBeFocused()
  expect(await selected(page)).toBe(1)
})
