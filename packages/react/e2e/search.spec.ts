import { test, expect } from './fixtures'
import { waitForMap, mockNominatim, NOMINATIM_EIFFEL } from './helpers'

test.describe('Search / Geocoding', () => {
  test.beforeEach(async ({ page }) => {
    await mockNominatim(page, [NOMINATIM_EIFFEL])
    await page.goto('/')
    await waitForMap(page)
  })

  test('typing fewer than 2 chars shows no dropdown', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('E')
    await page.waitForTimeout(500)
    await expect(page.getByText('Eiffel Tower')).not.toBeVisible()
  })

  test('typing 2+ chars shows autocomplete results after debounce', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    // Title shows first part of display_name
    await expect(page.getByText('Eiffel Tower').first()).toBeVisible({ timeout: 1500 })
  })

  test('shows loading spinner while fetching', async ({ page }) => {
    await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([NOMINATIM_EIFFEL]) })
    })

    await page.getByPlaceholder(/search/i).fill('Eiffel')
    await expect(page.locator('.animate-spin')).toBeVisible({ timeout: 800 })
  })

  test('empty result set shows no results message', async ({ page }) => {
    await mockNominatim(page, [])
    await page.getByPlaceholder(/search/i).fill('xyznonexistent')
    await expect(page.getByText(/no results/i)).toBeVisible({ timeout: 1500 })
  })

  test('clicking + Add immediately adds the feature to the list', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByText('Eiffel Tower').first()).toBeVisible({ timeout: 1500 })
    await page.getByRole('button', { name: 'Add' }).first().click()

    // Feature is added directly to the list (no confirmation dialog)
    await expect(page.locator('aside li').filter({ hasText: 'Eiffel Tower' })).toBeVisible()
  })

  test('clicking + Add does not open the side panel', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByText('Eiffel Tower').first()).toBeVisible({ timeout: 1500 })
    await page.getByRole('button', { name: 'Add' }).first().click()

    // No edit panel should open automatically
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
  })

  test('clicking ↗ Go flies to location without adding a feature', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByText('Eiffel Tower').first()).toBeVisible({ timeout: 1500 })
    await page.getByRole('button', { name: 'Go' }).first().click()

    // No feature should be added to the list, no side panel should open
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'Eiffel Tower' })).not.toBeVisible()
  })

  // The map centre as [lng, lat] (either engine).
  const center = (page: import('./fixtures').Page) => page.evaluate(() => {
    const c = (window.__elementEditorTest!.map as unknown as { getCenter(): { lng: number; lat: number } }).getCenter()
    return [c.lng, c.lat]
  })
  const nearEiffel = async (page: import('./fixtures').Page) => {
    const [lng, lat] = await center(page)
    return Math.abs(lng - 2.2945) < 0.05 && Math.abs(lat - 48.8584) < 0.05
  }

  test('Enter right after typing searches and goes to the first result', async ({ page }) => {
    const input = page.getByPlaceholder(/search/i)
    await input.fill('Eiffel Tower')
    // Before the debounce: Enter runs the search now and flies when it lands.
    await input.press('Enter')
    await expect.poll(() => nearEiffel(page), { timeout: 6000 }).toBe(true)
    await expect(input).toBeFocused()
  })

  test('ArrowDown + Enter goes to the highlighted result', async ({ page }) => {
    await page.unroute('**/nominatim.openstreetmap.org/**')
    await mockNominatim(page, [{ ...NOMINATIM_EIFFEL, place_id: 2, display_name: 'Prague, Czechia', lat: '50.0875', lon: '14.4213' }, NOMINATIM_EIFFEL])
    const input = page.getByPlaceholder(/search/i)
    await input.fill('Eiffel Tower')
    await expect(page.getByText('Prague').first()).toBeVisible({ timeout: 1500 })
    await input.press('ArrowDown')
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect.poll(() => nearEiffel(page), { timeout: 6000 }).toBe(true)
  })

  test('network error shows error message', async ({ page }) => {
    await page.route('**/nominatim.openstreetmap.org/**', (route) => route.abort('failed'))
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByText(/search unavailable/i)).toBeVisible({ timeout: 1500 })
  })
})
