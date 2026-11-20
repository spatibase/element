/**
 * `geometryTypes` — the allowed geometry types: tools that can't draw one are left out (toolbar,
 * shortcuts, `ref.setTool`), and every other way in (paste, import) is refused with a toast and
 * changes nothing. The dev page passes `?geometryTypes=Point,MultiPoint`.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, drawPolygon, featureCount, SAMPLE_GEOJSON } from './helpers'

const POLYGON = {
  type: 'Feature', id: 'poly', properties: { name: 'A polygon' },
  geometry: { type: 'Polygon', coordinates: [[[2.30, 48.85], [2.34, 48.85], [2.34, 48.87], [2.30, 48.87], [2.30, 48.85]]] },
}

const toolButton = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name, exact: true })

test.describe('geometryTypes=Point', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?geometryTypes=Point')
    await waitForMap(page)
  })

  test('only the Point tool is in the toolbar; the other shortcuts do nothing', async ({ page }) => {
    await expect(toolButton(page, 'Point')).toBeVisible()
    for (const name of ['Line', 'Area', 'Route', 'Circle', 'Rectangle', 'Freehand', 'Picker']) {
      await expect(toolButton(page, name)).toHaveCount(0)
    }
    await page.locator(MAP).click()
    await page.keyboard.press('g') // the polygon shortcut
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('none')
    // ref.setTool refuses what can't be drawn, and accepts the point tool
    expect(await page.evaluate(() => window.__elementEditorRef!.setTool('polygon'))).toBe(false)
    expect(await page.evaluate(() => window.__elementEditorRef!.setTool('point'))).toBe(true)
  })

  test('pasting a polygon is refused with a toast and adds nothing', async ({ page }) => {
    // A polygon that got in before the restriction (put straight into the store), then copy and paste.
    await page.evaluate((f) => {
      const h = window.__elementEditorTest!
      h.dataStore.setState({ features: [f as never] })
      h.dataStore.getState().selectFeature('poly')
    }, POLYGON)
    await page.locator(MAP).click({ position: { x: 5, y: 5 } })
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectFeature('poly'))
    await page.keyboard.press('ControlOrMeta+c')
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByText("Polygon isn't allowed here: this editor accepts only Point.").first()).toBeVisible({ timeout: 3000 })
    expect(await featureCount(page)).toBe(1)
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)).toBe(0)
  })

  test('importing skips the forbidden features, keeps the points and says so', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const types = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f) => f.geometry.type))
    expect(types.length).toBeGreaterThan(0)
    expect(new Set(types)).toEqual(new Set(['Point']))
    await expect(page.getByText(/Skipped \d+ features?\./).first()).toBeVisible({ timeout: 3000 })
  })
})

test('geometryTypes=Polygon,MultiPolygon: no point tool, drawing an area still works', async ({ page }) => {
  await page.goto('/?geometryTypes=Polygon,MultiPolygon')
  await waitForMap(page)
  await expect(toolButton(page, 'Point')).toHaveCount(0)
  await expect(toolButton(page, 'Line')).toHaveCount(0)
  await expect(toolButton(page, 'Area')).toBeVisible()
  await drawPolygon(page)
  expect(await featureCount(page)).toBe(1)
  // the ref API refuses a point too
  const added = await page.evaluate(() => window.__elementEditorRef!.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }))
  expect(added).toBeNull()
  expect(await featureCount(page)).toBe(1)
})

test('without geometryTypes every tool is offered', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  for (const name of ['Point', 'Line', 'Area']) await expect(toolButton(page, name)).toBeVisible()
})
