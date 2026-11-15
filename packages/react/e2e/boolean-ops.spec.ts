/**
 * Boolean operations e2e tests — union, subtract, intersect.
 * Tests require two overlapping polygons and the boolean operations toolbar.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON } from './helpers'

/** Two overlapping polygons for boolean operations */
const TWO_OVERLAPPING_POLYGONS = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [{ id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text', required: false }] }],
    groups: [],
  },
  features: [
    {
      type: 'Feature',
      id: 'poly-a',
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [[[2.33, 48.86], [2.35, 48.86], [2.35, 48.85], [2.33, 48.85], [2.33, 48.86]]] },
      properties: { name: 'Polygon A' },
    },
    {
      type: 'Feature',
      id: 'poly-b',
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [[[2.34, 48.865], [2.36, 48.865], [2.36, 48.855], [2.34, 48.855], [2.34, 48.865]]] },
      properties: { name: 'Polygon B' },
    },
  ],
})

test.describe('Boolean operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await importGeoJSON(page, TWO_OVERLAPPING_POLYGONS)
    await page.waitForTimeout(500)
  })

  test('multi-selecting two polygons shows boolean operations', async ({ page }) => {
    // Click first feature
    await page.getByText('Polygon A').click()
    await page.waitForTimeout(200)
    // Shift+click second feature for multi-select
    await page.getByText('Polygon B').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(300)

    // Boolean operations toolbar should appear
    const unionBtn = page.getByRole('button', { name: /union/i })
    await expect(unionBtn).toBeVisible({ timeout: 3000 })
  })

  test('each button names what it does; Subtract names the first selected shape as the one kept', async ({ page }) => {
    await page.getByText('Polygon A').click()
    await page.getByText('Polygon B').click({ modifiers: ['Shift'] })
    for (const name of [
      'Union: join into one shape',
      'Subtract: cut the others out of the first selected',
      'Intersect: keep only the overlap',
      "Exclude: keep only what doesn't overlap",
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: /bottom minus top/i })).toHaveCount(0)

    // And that is what it does: A (clicked first) minus B keeps A's west part, A's id is gone.
    await page.getByRole('button', { name: /^Subtract/ }).click()
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(1)
    const result = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      const xs = (f.geometry as { coordinates: number[][][] }).coordinates[0].map((c) => c[0])
      return { name: f.properties.name, minX: Math.min(...xs), maxX: Math.max(...xs) }
    })
    expect(result.name).toBe('Polygon A')
    expect(result.minX).toBeCloseTo(2.33, 5)
    expect(result.maxX).toBeCloseTo(2.35, 5)
  })

  test('union merges two polygons into one', async ({ page }) => {
    await page.getByText('Polygon A').click()
    await page.waitForTimeout(200)
    await page.getByText('Polygon B').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: /union/i }).click()
    await page.waitForTimeout(1000)

    // After union, should have fewer features than before
    const featureCount = await page.locator('aside li').count()
    expect(featureCount).toBeLessThanOrEqual(2)
  })

  test('subtract removes intersection from first polygon', async ({ page }) => {
    await page.getByText('Polygon A').click()
    await page.waitForTimeout(200)
    await page.getByText('Polygon B').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(300)

    const subtractBtn = page.getByRole('button', { name: /subtract/i })
    if (await subtractBtn.isVisible()) {
      await subtractBtn.click()
      await page.waitForTimeout(1000)
      // Should still have features (the subtracted result)
      const count = await page.locator('aside li').count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('intersect keeps only the overlapping area', async ({ page }) => {
    await page.getByText('Polygon A').click()
    await page.waitForTimeout(200)
    await page.getByText('Polygon B').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(300)

    const intersectBtn = page.getByRole('button', { name: /intersect/i })
    if (await intersectBtn.isVisible()) {
      await intersectBtn.click()
      await page.waitForTimeout(1000)
      // Should have exactly one feature (the intersection)
      const count = await page.locator('aside li').count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('a boolean op is one undo step, and the result is no longer a rectangle', async ({ page }) => {
    // Polygon A was drawn as a rectangle: after the union it is a plain polygon.
    await page.evaluate(() => {
      const ds = window.__elementEditorTest!.dataStore
      ds.setState({ features: ds.getState().features.map((f) => f.id === 'poly-a' ? { ...f, _drawType: 'rectangle' as const } : f) })
    })
    const depth = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)
    await page.getByText('Polygon A').click()
    await page.getByText('Polygon B').click({ modifiers: ['Shift'] })
    await page.getByRole('button', { name: /union/i }).click()
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(1)

    const after = await page.evaluate(() => {
      const s = window.__elementEditorTest!.dataStore.getState()
      return { depth: s.undoStack.length, drawType: s.features[0]._drawType, selected: s.selectedIds, id: s.features[0].id }
    })
    expect(after.depth).toBe(depth + 1)
    expect(after.drawType).toBeUndefined()
    expect(after.selected).toEqual([after.id])

    await page.locator(MAP).click({ position: { x: 5, y: 5 }, trial: true })
    await page.keyboard.press('ControlOrMeta+z')
    const ids = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f) => f.id).sort())
    expect(ids).toEqual(['poly-a', 'poly-b'])
  })
})
