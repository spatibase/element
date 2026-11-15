/**
 * Picker tool e2e tests — click to import shapes from OpenStreetMap.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, flyTo } from './helpers'

const MOCK_OVERPASS_SINGLE = {
  elements: [
    {
      type: 'way',
      id: 123456,
      tags: { name: 'Test Park', leisure: 'park' },
      geometry: [
        { lat: 48.8600, lon: 2.3400 },
        { lat: 48.8610, lon: 2.3410 },
        { lat: 48.8610, lon: 2.3390 },
        { lat: 48.8600, lon: 2.3400 },
      ],
    },
  ],
}

// Both polygons must contain the click centre (48.860, 2.340) so filterAndSort returns both
const MOCK_OVERPASS_MULTI = {
  elements: [
    {
      type: 'way',
      id: 111,
      tags: { name: 'Park A', leisure: 'park' },
      geometry: [
        { lat: 48.8610, lon: 2.3380 },
        { lat: 48.8610, lon: 2.3420 },
        { lat: 48.8590, lon: 2.3420 },
        { lat: 48.8590, lon: 2.3380 },
        { lat: 48.8610, lon: 2.3380 },
      ],
    },
    {
      type: 'way',
      id: 222,
      tags: { name: 'Park B', leisure: 'park' },
      geometry: [
        { lat: 48.8620, lon: 2.3370 },
        { lat: 48.8620, lon: 2.3430 },
        { lat: 48.8580, lon: 2.3430 },
        { lat: 48.8580, lon: 2.3370 },
        { lat: 48.8620, lon: 2.3370 },
      ],
    },
  ],
}

async function mockOverpass(page: import('@playwright/test').Page, body: object) {
  await page.route('**/overpass-api.de/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  )
}

test.describe('Picker tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('X activates picker mode and shows hint', async ({ page }) => {
    await page.keyboard.press('x')
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })
  })

  test('Picker toolbar button activates picker mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Picker' }).click()
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })
  })

  test('Escape exits picker mode', async ({ page }) => {
    await page.keyboard.press('x')
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })
    await page.keyboard.press('Escape')
    await expect(page.getByText(/click anywhere to import/i)).not.toBeVisible({ timeout: 2000 })
  })

  test('clicking Picker button again exits picker mode', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Picker' })
    await btn.click()
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })
    await btn.click()
    await expect(page.getByText(/click anywhere to import/i)).not.toBeVisible({ timeout: 2000 })
  })

  test('clicking at high zoom adds a single matching OSM feature', async ({ page }) => {
    await mockOverpass(page, MOCK_OVERPASS_SINGLE)
    await flyTo(page, [48.860, 2.340], 18)

    await page.keyboard.press('x')
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })

    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } })

    // Feature should appear in the sidebar
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 5000 })
    // Auto-exit-after-draw default: picker deactivates after a successful pick.
    // (Toggle "Return to select after each shape" off to keep it active.)
    await expect(page.getByText(/click anywhere to import/i)).not.toBeVisible({ timeout: 2000 })
  })

  test('multiple OSM candidates show a picker popup', async ({ page }) => {
    await mockOverpass(page, MOCK_OVERPASS_MULTI)
    await flyTo(page, [48.860, 2.340], 18)

    await page.keyboard.press('x')
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })

    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } })

    // Candidate picker popup should list both options
    await expect(page.getByText('Park A')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Park B')).toBeVisible({ timeout: 2000 })
  })

  test('picker shows "Zoom in" message at low zoom', async ({ page }) => {
    // Default zoom is 5 — well below MIN_ZOOM of 15
    await page.keyboard.press('x')
    await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })

    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } })

    await expect(page.getByText(/zoom in/i)).toBeVisible({ timeout: 3000 })
  })

  test('Picker shortcut X appears in the shortcuts modal', async ({ page }) => {
    await page.keyboard.press('k')
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible({ timeout: 2000 })
    await expect(page.getByText('Picker')).toBeVisible({ timeout: 1000 })
  })
})
