/**
 * Settings modal and map configuration e2e tests.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap } from './helpers'

test.describe('Settings modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  // Button was renamed "Map settings" → "Editor settings". Basemap options
  // moved out of the settings modal into a standalone toggle in the map
  // bottom-left slot, so that assertion is gone from the suite.
  test('settings button opens the settings modal', async ({ page }) => {
    await page.getByRole('button', { name: /editor settings/i }).click()
    await page.waitForTimeout(500)

    // Modal shows its "Appearance" heading.
    await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible()
  })

  test('settings modal shows an appearance toggle', async ({ page }) => {
    await page.getByRole('button', { name: /editor settings/i }).click()
    await page.waitForTimeout(500)

    // Light / Dark / Auto appearance modes
    await expect(page.getByRole('button', { name: /^light$/i })).toBeVisible({ timeout: 3000 })
    await expect(page.getByRole('button', { name: /^dark$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^auto$/i })).toBeVisible()
  })

  test('measurement toggle is available in settings', async ({ page }) => {
    await page.getByRole('button', { name: /editor settings/i }).click()
    await page.waitForTimeout(500)

    await expect(page.getByText(/show measurements/i).first()).toBeVisible({ timeout: 3000 })
  })

  test('geometry mode toggle is available', async ({ page }) => {
    await page.getByRole('button', { name: /editor settings/i }).click()
    await page.waitForTimeout(500)

    // Should have visual/spatial geometry mode option
    const visualLabel = page.getByText(/visual/i)
    const spatialLabel = page.getByText(/spatial/i)
    const hasMode = (await visualLabel.count()) > 0 || (await spatialLabel.count()) > 0
    expect(hasMode).toBe(true)
  })
})
