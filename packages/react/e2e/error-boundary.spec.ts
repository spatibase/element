/**
 * Error boundary and edge case e2e tests — ensure the app doesn't crash
 * on invalid input and handles error states gracefully.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON } from './helpers'

test.describe('Error handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('ref.importGeoJSON with invalid input throws but leaves app functional', async ({ page }) => {
    await page.waitForFunction(() => !!window.__elementEditorRef)
    const err = await page.evaluate(() => {
      try {
        const ref = window.__elementEditorRef!
        ref.importGeoJSON({ type: 'Feature', geometry: null, properties: {} })
        return null
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(err).toMatch(/FeatureCollection/i)

    // App should still be functional — a valid import afterwards succeeds.
    const result = await page.evaluate(() => {
      const ref = window.__elementEditorRef!
      return ref.importGeoJSON({ type: 'FeatureCollection', features: [] })
    })
    expect(result).toMatchObject({ skipped: 0 })
  })

  test('importing empty FeatureCollection works without error', async ({ page }) => {
    const empty = JSON.stringify({ type: 'FeatureCollection', features: [] })
    await importGeoJSON(page, empty)
    await page.waitForTimeout(300)
    // Sidebar + data-table both show the "no features" hint; scope to sidebar.
    await expect(page.locator('aside').getByText(/no features/i).first()).toBeVisible()
  })

  test('importing feature with unknown geometry type is skipped', async ({ page }) => {
    const invalid = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: '1', geometry: { type: 'Unknown', coordinates: [] }, properties: {} },
        { type: 'Feature', id: '2', geometry: { type: 'Point', coordinates: [2.35, 48.86] }, properties: { name: 'Valid' } },
      ],
    })
    await importGeoJSON(page, invalid)
    await page.waitForTimeout(500)

    // Only the valid feature should appear
    await expect(page.getByText('Valid')).toBeVisible()
    const count = await page.locator('aside li').count()
    expect(count).toBe(1)
  })

  test('double-clicking map does not create duplicate features', async ({ page }) => {
    // Double-click should be handled by the interaction FSM
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('p')
    await page.mouse.dblclick(cx, cy)
    await page.waitForTimeout(500)

    // Should have at most 1 feature (not 2 from double-click)
    const count = await page.locator('aside li').count()
    expect(count).toBeLessThanOrEqual(1)
  })
})

test.describe('Large data handling', () => {
  test('importing many features does not freeze the UI', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()

    // Generate 100 point features
    const features = Array.from({ length: 100 }, (_, i) => ({
      type: 'Feature',
      id: `pt-${i}`,
      geometry: { type: 'Point', coordinates: [2.35 + (i % 10) * 0.01, 48.86 + Math.floor(i / 10) * 0.01] },
      properties: { name: `Point ${i}` },
    }))
    const geojson = JSON.stringify({ type: 'FeatureCollection', features })

    await importGeoJSON(page, geojson)
    await page.waitForTimeout(1000)

    // UI should still respond
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible({ timeout: 3000 })
  })
})
