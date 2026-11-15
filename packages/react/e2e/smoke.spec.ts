import { test, expect, MAP } from './fixtures'
import { waitForMap } from './helpers'

test.describe('App — smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('page loads and shows sidebar', async ({ page }) => {
    await expect(page.getByRole('button', { name: /show geojson/i })).toBeVisible()
  })

  test('shows empty state message in feature list', async ({ page }) => {
    // Scoped to the layers panel: the (closed, lazily mounted) data table renders
    // the same empty state, and strict mode counts hidden matches too.
    await expect(page.locator('aside').getByText(/no features yet/i)).toBeVisible()
  })

  test('toolbar is rendered with search and drawing tools', async ({ page }) => {
    await expect(page.getByPlaceholder(/search places/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /show geojson/i })).toBeVisible()
  })

  test('map container is rendered', async ({ page }) => {
    await expect(page.locator(MAP)).toBeVisible()
  })
})
