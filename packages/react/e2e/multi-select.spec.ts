/**
 * Multi-select and box-select e2e tests — selecting multiple features
 * via Shift+click and Shift+drag box selection.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON, featureCount, selectedIds } from './helpers'

const THREE_FEATURES = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [{ id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text', required: false }] }],
    groups: [],
  },
  features: [
    {
      type: 'Feature', id: 'f1', schemaId: 'default',
      geometry: { type: 'Point', coordinates: [2.35, 48.86] },
      properties: { name: 'Feature 1' },
    },
    {
      type: 'Feature', id: 'f2', schemaId: 'default',
      geometry: { type: 'Point', coordinates: [2.36, 48.86] },
      properties: { name: 'Feature 2' },
    },
    {
      type: 'Feature', id: 'f3', schemaId: 'default',
      geometry: { type: 'Point', coordinates: [2.37, 48.86] },
      properties: { name: 'Feature 3' },
    },
  ],
})

test.describe('Multi-select via sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await importGeoJSON(page, THREE_FEATURES)
    await expect.poll(() => featureCount(page)).toBe(3)
  })

  test('Shift+click selects multiple features in sidebar', async ({ page }) => {
    await page.getByText('Feature 1').click()
    await page.getByText('Feature 2').click({ modifiers: ['Shift'] })

    // Both rows should have selection highlight
    const selectedRows = page.locator('aside li div[class*="bg-(--elm-row-selected)"]')
    await expect.poll(() => selectedRows.count()).toBeGreaterThanOrEqual(2)
  })

  test('Ctrl+click toggles individual selection', async ({ page }) => {
    await page.getByText('Feature 1').click()
    await page.getByText('Feature 2').click({ modifiers: ['Meta'] })

    // Both should be selected; click Feature 1 again with Ctrl to deselect
    await page.getByText('Feature 1').click({ modifiers: ['Meta'] })

    // Feature 2 should still be selected, Feature 1 deselected
    await expect.poll(() => selectedIds(page)).toHaveLength(1)
  })

  test('multi-selection shows count in editing toolbar', async ({ page }) => {
    // Shift+click performs range-select (anchor → target); to build a 3-item
    // selection we range-select [f1,f2] then Meta/Ctrl+click to toggle-add f3.
    // Chained shift-clicks would just move the range, not grow it.
    await page.getByText('Feature 1').click()
    await page.getByText('Feature 2').click({ modifiers: ['Shift'] })
    await page.getByText('Feature 3').click({ modifiers: ['Meta'] })

    // LayersPanel renders "N selected" when selectedIds.length >= 2.
    await expect(page.getByText(/3 selected/i)).toBeVisible({ timeout: 3000 })
  })

  test('Delete key removes all selected features', async ({ page }) => {
    await page.getByText('Feature 1').click()
    await page.getByText('Feature 2').click({ modifiers: ['Shift'] })

    // Do NOT click the map before pressing Delete — clicking empty map
    // space is a valid deselect gesture, which would reduce the selection
    // to 0 and make Delete a no-op. Global keydown listener picks up Delete
    // regardless of focus.
    await page.keyboard.press('Delete')

    // Should have 1 feature remaining
    await expect(page.locator('aside li')).toHaveCount(1)
  })

  test('Escape deselects all in multi-select', async ({ page }) => {
    await page.getByText('Feature 1').click()
    await page.getByText('Feature 2').click({ modifiers: ['Shift'] })

    await expect.poll(() => selectedIds(page)).toHaveLength(2)
    await page.keyboard.press('Escape')
    await expect.poll(() => selectedIds(page)).toHaveLength(0)

    // No features should be selected (no editing toolbar)
    await expect(page.getByText(/selected/i)).not.toBeVisible({ timeout: 2000 })
  })
})
