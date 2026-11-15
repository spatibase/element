/**
 * Fast clicking with click tools (both engines), and the Picker commit matching the other tools.
 *
 * Two ways a fast click used to get lost:
 * - The OS counts clicks by time (macOS by time alone), so the 2nd of two quick clicks at
 *   different spots arrives with `detail: 2` plus a `dblclick`. The draw layers dropped every
 *   `detail > 1` click and let that dblclick finish the shape. `osClick` reproduces it.
 * - The hand is still moving when the button goes down: mouseup a few px from mousedown, which
 *   the engines' 3 px drag threshold turned into a tiny pan with no click. `slipClick` reproduces it.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, featureCount, mapBox, enableStayInTool, editingMode } from './helpers'

/** One click with the OS click count `count` (2 = the OS saw it as the 2nd of a double-click). */
async function osClick(page: Page, x: number, y: number, count: number) {
  await page.mouse.move(x, y)
  await page.mouse.down({ clickCount: count })
  await page.mouse.up({ clickCount: count })
}

/** A click whose mouseup lands `slip` px right of its mousedown. */
async function slipClick(page: Page, x: number, y: number, slip: number) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + slip, y, { steps: 2 })
  await page.mouse.up()
}

const drawState = (page: Page) => page.evaluate(() => {
  const s = window.__elementEditorTest!.uiStore.getState()
  return { line: s.lineInProgress.length, poly: s.polygonInProgress.length }
})
const zoom = (page: Page) => page.evaluate(() => window.__elementEditorTest!.map.getZoom())
const firstFeatureCoords = (page: Page) => page.evaluate(() => {
  const g = window.__elementEditorTest!.dataStore.getState().features[0].geometry as GeoJSON.Polygon | GeoJSON.LineString
  return (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates).length
})

test.describe('fast clicks at different spots', () => {
  test.beforeEach(async ({ page }) => {
    await enableStayInTool(page)
    await page.goto('/')
    await waitForMap(page)
  })

  test('Point tool: every fast click places a point, and the map does not zoom', async ({ page }) => {
    const box = await mapBox(page)
    await page.getByRole('button', { name: 'Point' }).click()
    const z0 = await zoom(page)
    for (let i = 0; i < 6; i++) await osClick(page, box.x + 150 + i * 60, box.y + 200 + (i % 2) * 50, i % 2 ? 2 : 1)
    await expect.poll(() => featureCount(page)).toBe(6)
    expect(await zoom(page)).toBe(z0)
  })

  test('Point tool: a click that slips a few pixels still places a point', async ({ page }) => {
    const box = await mapBox(page)
    await page.getByRole('button', { name: 'Point' }).click()
    for (let i = 0; i < 4; i++) await slipClick(page, box.x + 150 + i * 60, box.y + 200, 6)
    await expect.poll(() => featureCount(page)).toBe(4)
  })

  test('Point tool: a double-click on one spot places one point', async ({ page }) => {
    const box = await mapBox(page)
    await page.getByRole('button', { name: 'Point' }).click()
    await page.mouse.dblclick(box.x + 200, box.y + 200)
    await page.waitForTimeout(300)
    expect(await featureCount(page)).toBe(1)
  })

  test('Area tool: fast vertices are all kept, a same-spot double-click still finishes', async ({ page }) => {
    const box = await mapBox(page)
    await page.getByRole('button', { name: 'Area', exact: true }).click()
    const pts = [[200, 200], [400, 200], [400, 350], [200, 350]]
    for (let i = 0; i < pts.length; i++) await osClick(page, box.x + pts[i][0], box.y + pts[i][1], i % 2 ? 2 : 1)
    await slipClick(page, box.x + 120, box.y + 280, 6)
    await expect.poll(() => drawState(page)).toEqual({ line: 0, poly: 5 })
    expect(await featureCount(page)).toBe(0)

    await page.mouse.dblclick(box.x + 300, box.y + 420)
    await expect.poll(() => featureCount(page)).toBe(1)
    expect(await firstFeatureCoords(page)).toBe(7) // 6 vertices + closing coordinate
  })

  test('Line tool: fast vertices are all kept, a same-spot double-click still finishes', async ({ page }) => {
    const box = await mapBox(page)
    await page.getByRole('button', { name: 'Line' }).click()
    for (let i = 0; i < 4; i++) await osClick(page, box.x + 150 + i * 70, box.y + 200 + (i % 2) * 60, i % 2 ? 2 : 1)
    await expect.poll(() => drawState(page)).toEqual({ line: 4, poly: 0 })

    await page.mouse.dblclick(box.x + 450, box.y + 300)
    await expect.poll(() => featureCount(page)).toBe(1)
    expect(await firstFeatureCoords(page)).toBe(5)
  })
})

test.describe('Picker commit behaves like a drawing tool commit', () => {
  for (const stay of [false, true]) {
    test(`picked shape is selected, one undo step, Enter edits its shape (${stay ? 'tool stays' : 'auto-exit'})`, async ({ page }) => {
      if (stay) await enableStayInTool(page)
      await page.goto('/')
      await waitForMap(page)
      const c = await page.evaluate(() => {
        const m = window.__elementEditorTest!.map
        if ('jumpTo' in m) m.jumpTo({ center: [2.34, 48.86], zoom: 17 })
        else m.setView([48.86, 2.34], 17, { animate: false })
        const ll = m.getCenter()
        return { lng: ll.lng, lat: ll.lat }
      })
      const d = 0.0003
      // Tiles are offline in tests, so MapLibre falls back to (mocked) Overpass like Leaflet.
      await page.route('**/overpass-api.de/**', (r) => r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ elements: [{
          type: 'way', id: 1, tags: { name: 'Building', building: 'yes' },
          geometry: [[-d, -d], [d, -d], [d, d], [-d, d], [-d, -d]].map(([x, y]) => ({ lat: c.lat + y, lon: c.lng + x })),
        }] }),
      }))
      const box = await mapBox(page)
      const undo0 = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)
      await page.getByRole('button', { name: 'Picker' }).click()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(() => featureCount(page)).toBe(1)

      const st = await page.evaluate(() => {
        const ds = window.__elementEditorTest!.dataStore.getState()
        return { selected: ds.selectedIds[0] === ds.features[0].id, undo: ds.undoStack.length }
      })
      expect(st).toEqual({ selected: true, undo: undo0 + 1 })
      expect(await editingMode(page)).toBe(stay ? 'pick-shape' : 'none')

      await page.keyboard.press('Enter')
      await expect(page.locator('.elm-vertex').first()).toBeVisible()
      expect(await editingMode(page)).toBe('none')
    })
  }
})
