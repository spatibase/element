/**
 * Cut hole and slice shape e2e tests.
 * These require a selected polygon and then entering cut/slice mode.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, importGeoJSON, flyTo, screenPoint, featureCount } from './helpers'

const LARGE_POLYGON = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [{ id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text', required: false }] }],
    groups: [],
  },
  features: [{
    type: 'Feature',
    id: 'big-poly',
    schemaId: 'default',
    geometry: { type: 'Polygon', coordinates: [[[2.32, 48.87], [2.38, 48.87], [2.38, 48.84], [2.32, 48.84], [2.32, 48.87]]] },
    properties: { name: 'Big Polygon' },
  }],
})

/** Slice tool is active: click above and below the big polygon, then Enter. */
async function sliceAcross(page: Page) {
  const top = await screenPoint(page, 2.35, 48.875)
  const bottom = await screenPoint(page, 2.35, 48.835)
  await page.mouse.click(top.x, top.y)
  await page.waitForTimeout(250) // Leaflet: keep clicks apart, or they read as a dblclick
  await page.mouse.click(bottom.x, bottom.y)
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
}

test.describe('Cut hole', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await importGeoJSON(page, LARGE_POLYGON)
    await page.waitForTimeout(500)
  })

  test('cut hole button is visible for selected polygon', async ({ page }) => {
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)

    const cutBtn = page.getByRole('button', { name: /cut.*hole/i })
    await expect(cutBtn).toBeVisible({ timeout: 3000 })
  })

  test('entering cut hole mode shows drawing hint', async ({ page }) => {
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)

    // Enter cut-hole mode by keyboard shortcut to avoid the toolbar click
    // being intercepted by an adjacent button's icon SVG (z-[400] stacking).
    await page.keyboard.press('h')
    await page.waitForTimeout(300)

    // ActiveDrawingToolbar hint for the initial cut-hole state.
    await expect(page.getByText(/draw a shape inside to cut a hole/i)).toBeVisible({ timeout: 3000 })
  })
})

test.describe('Slice shape', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await importGeoJSON(page, LARGE_POLYGON)
    await page.waitForTimeout(500)
  })

  test('slice button is visible for selected polygon', async ({ page }) => {
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)

    const sliceBtn = page.getByRole('button', { name: /slice/i })
    await expect(sliceBtn).toBeVisible({ timeout: 3000 })
  })

  test('entering slice mode shows line drawing hint', async ({ page }) => {
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)

    await page.keyboard.press('j') // slice-shape shortcut
    await page.waitForTimeout(300)

    await expect(page.getByText(/draw a line across the shape to slice it/i)).toBeVisible({ timeout: 3000 })
  })

  test('slicing a polygon across creates multiple features', async ({ page }) => {
    // Sidebar-select pans but doesn't zoom in enough for screen-space clicks
    // to intersect the polygon; fit-to-feature at zoom 13 via imperative ref.
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)
    await flyTo(page, [48.855, 2.35], 13)

    await page.keyboard.press('j')
    await page.waitForTimeout(300)

    // Draw a line from just above the polygon to just below it (projected, so it crosses
    // on either engine: MapLibre's 512 px tiles show zoom 13 twice as large as Leaflet).
    await sliceAcross(page)

    // After slicing, should have 2 features
    await expect.poll(() => featureCount(page)).toBeGreaterThanOrEqual(2)
    await expect.poll(() => page.locator('aside li').count()).toBeGreaterThanOrEqual(2)
  })

  // Regression: slice used to push 2 undo entries (one explicit takeSnapshot
  // plus one implicit from each addFeature in the loop), so the first Cmd+Z
  // showed only one of the cut halves. The whole slice should be a single
  // undo step.
  test('Cmd+Z after slice restores the original polygon in one step', async ({ page }) => {
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)
    await flyTo(page, [48.855, 2.35], 13)
    await page.keyboard.press('j')
    await page.waitForTimeout(300)

    await sliceAcross(page)
    await expect.poll(() => featureCount(page)).toBeGreaterThanOrEqual(2)

    // Single Cmd+Z should restore the original — back to ONE feature.
    await page.keyboard.press('Meta+z')
    await expect.poll(() => featureCount(page)).toBe(1)
    await expect(page.locator('aside li')).toHaveCount(1)
  })

  // A line that stops inside the shape used to notch it (0.01 m cut, one undo step) and
  // report a failure at the same time. Now nothing changes and only the message shows.
  test('a line that stops inside the shape changes nothing and says so', async ({ page }) => {
    await page.getByText('Big Polygon').click()
    await page.waitForTimeout(300)
    await flyTo(page, [48.855, 2.35], 13)
    await page.keyboard.press('j')
    await page.waitForTimeout(300)

    const before = await page.evaluate(() => {
      const s = window.__elementEditorTest!.dataStore.getState()
      return { geometry: JSON.stringify(s.features[0].geometry), depth: s.undoStack.length }
    })
    const top = await screenPoint(page, 2.35, 48.875)
    const middle = await screenPoint(page, 2.35, 48.855)
    await page.mouse.click(top.x, top.y)
    await page.waitForTimeout(250)
    await page.mouse.click(middle.x, middle.y)
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.getByText(/didn't cut the shape apart, so nothing changed/i)).toBeVisible({ timeout: 5000 })
    const after = await page.evaluate(() => {
      const s = window.__elementEditorTest!.dataStore.getState()
      return { count: s.features.length, geometry: JSON.stringify(s.features[0].geometry), depth: s.undoStack.length }
    })
    expect(after).toEqual({ count: 1, geometry: before.geometry, depth: before.depth })
  })
})

