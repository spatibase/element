/**
 * Duplicate and paste e2e tests — copy/paste features, duplicate via toolbar.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

test.describe('Duplicate feature', () => {
  test.beforeEach(async ({ page, context }) => {
    // Copy writes the system clipboard too; without the grant it is refused and an older test's
    // clipboard content (same browser) could be what gets pasted.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await page.waitForTimeout(500)
  })

  test('Ctrl+D duplicates selected feature', async ({ page }) => {
    await page.getByText('Paris').click()
    await page.waitForTimeout(200)
    // Don't click the map to "focus" — clicking empty map area deselects.
    // The global keydown listener fires regardless of which element holds focus.
    await page.keyboard.press('Meta+d')
    await page.waitForTimeout(500)

    const count = await page.locator('aside li').count()
    expect(count).toBe(3)
  })

  test('duplicate via toolbar button', async ({ page }) => {
    await page.getByText('Paris').click()
    await page.waitForTimeout(300)

    const dupBtn = page.getByRole('button', { name: /duplicate/i })
    if (await dupBtn.isVisible()) {
      await dupBtn.click()
      await page.waitForTimeout(500)
      const count = await page.locator('aside li').count()
      expect(count).toBe(3)
    }
  })

  test('Ctrl+C then Ctrl+V copies and pastes a feature', async ({ page }) => {
    await page.getByText('Paris').click()
    await page.waitForTimeout(200)

    // Paste is the browser's native paste command (the editor listens for the `paste` event), so the
    // key must be the platform's: Ctrl+V on Linux (CI), Cmd+V on macOS. Meta+V on Linux pastes nothing.
    await page.keyboard.press('ControlOrMeta+c')
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+v')
    await page.waitForTimeout(500)

    const count = await page.locator('aside li').count()
    expect(count).toBe(3)
  })

  test('pasted feature has "(copy)" suffix', async ({ page }) => {
    await page.getByText('Paris').click()
    await page.waitForTimeout(200)

    // Paste is the browser's native paste command (the editor listens for the `paste` event), so the
    // key must be the platform's: Ctrl+V on Linux (CI), Cmd+V on macOS. Meta+V on Linux pastes nothing.
    await page.keyboard.press('ControlOrMeta+c')
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+v')
    await page.waitForTimeout(500)

    await expect(page.getByText(/paris.*\(copy\)/i)).toBeVisible({ timeout: 3000 })
  })
})
