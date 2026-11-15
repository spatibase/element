/**
 * Multi-geometry e2e tests — merge features into MultiPolygon,
 * break MultiPolygon into individual features.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON } from './helpers'

const TWO_SEPARATE_POLYGONS = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [{ id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text', required: false }] }],
    groups: [],
  },
  features: [
    {
      type: 'Feature',
      id: 'sep-a',
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [[[2.30, 48.87], [2.32, 48.87], [2.32, 48.86], [2.30, 48.86], [2.30, 48.87]]] },
      properties: { name: 'Left Box' },
    },
    {
      type: 'Feature',
      id: 'sep-b',
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [[[2.36, 48.87], [2.38, 48.87], [2.38, 48.86], [2.36, 48.86], [2.36, 48.87]]] },
      properties: { name: 'Right Box' },
    },
  ],
})

const MULTI_POLYGON_FEATURE = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [{ id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text', required: false }] }],
    groups: [],
  },
  features: [{
    type: 'Feature',
    id: 'multi-1',
    schemaId: 'default',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[2.30, 48.87], [2.32, 48.87], [2.32, 48.86], [2.30, 48.86], [2.30, 48.87]]],
        [[[2.36, 48.87], [2.38, 48.87], [2.38, 48.86], [2.36, 48.86], [2.36, 48.87]]],
      ],
    },
    properties: { name: 'Multi Shape' },
  }],
})

test.describe('Merge features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('merge button appears when 2+ features selected', async ({ page }) => {
    await importGeoJSON(page, TWO_SEPARATE_POLYGONS)
    await page.waitForTimeout(500)

    await page.getByText('Left Box').click()
    await page.waitForTimeout(200)
    await page.getByText('Right Box').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(300)

    const mergeBtn = page.getByRole('button', { name: /merge/i })
    await expect(mergeBtn).toBeVisible({ timeout: 3000 })
  })

  test('merging two polygons reduces feature count to 1', async ({ page }) => {
    await importGeoJSON(page, TWO_SEPARATE_POLYGONS)
    await page.waitForTimeout(500)

    await page.getByText('Left Box').click()
    await page.waitForTimeout(200)
    await page.getByText('Right Box').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: /merge/i }).click()
    await page.waitForTimeout(500)

    const featureCount = await page.locator('aside li').count()
    expect(featureCount).toBe(1)
  })
})

test.describe('Break multi-geometry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('break button appears for multi-geometry features', async ({ page }) => {
    await importGeoJSON(page, MULTI_POLYGON_FEATURE)
    await page.waitForTimeout(500)

    await page.getByText('Multi Shape').click()
    await page.waitForTimeout(300)

    const breakBtn = page.getByRole('button', { name: /break/i })
    await expect(breakBtn).toBeVisible({ timeout: 3000 })
  })

  test('breaking a MultiPolygon creates individual polygons', async ({ page }) => {
    await importGeoJSON(page, MULTI_POLYGON_FEATURE)
    await page.waitForTimeout(500)

    // Start with 1 feature
    await expect(page.locator('aside li')).toHaveCount(1, { timeout: 3000 })

    await page.getByText('Multi Shape').click()
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: /break/i }).click()
    await page.waitForTimeout(500)

    // After breaking, should have 2 features
    const featureCount = await page.locator('aside li').count()
    expect(featureCount).toBe(2)
  })
})
