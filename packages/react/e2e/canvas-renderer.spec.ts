/**
 * Leaflet draws unselected features on one shared canvas (renderer='canvas',
 * the default) and moves a feature to SVG while it's selected. These tests pin
 * the interactions that depend on that split: hit-testing through the SVG root,
 * z-order, the line click band, the Cmd/Alt cursor on the canvas, drags, and
 * double-click into vertex edit.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, importGeoJSON, featureCenter, selectedIds, screenPoint } from './helpers'

test.skip(({ engine }) => engine !== 'leaflet', 'Leaflet canvas/SVG renderer split')

const sq = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
const FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'A', geometry: { type: 'Polygon', coordinates: sq(0.1, 0.1, 0.4, 0.4) }, properties: { name: 'A' } },
    // Overlaps A at 0.3–0.4.
    { type: 'Feature', id: 'C', geometry: { type: 'Polygon', coordinates: sq(0.3, 0.3, 0.6, 0.6) }, properties: { name: 'C' } },
    { type: 'Feature', id: 'B', geometry: { type: 'LineString', coordinates: [[0.7, 0.2], [0.9, 0.2]] }, properties: { name: 'B' } },
  ],
})

const svgPaths = (page: Page) => page.locator('.leaflet-overlay-pane path').count()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await importGeoJSON(page, FC)
  await page.evaluate(() => window.__elementEditorTest!.map.fitBounds([[0, 0], [0.7, 1]], { animate: false }))
  await page.waitForTimeout(400)
})

test('unselected features are on the canvas; selecting moves one to SVG and back', async ({ page }) => {
  await expect(page.locator('.leaflet-elmIdleFeatures-pane canvas')).toHaveCount(1)
  expect(await svgPaths(page)).toBe(0)

  const a = await featureCenter(page, 'A')
  await page.mouse.click(a.x - 20, a.y - 20)
  await expect.poll(() => selectedIds(page)).toEqual(['A'])
  expect(await svgPaths(page)).toBeGreaterThan(0)

  await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([])
  await expect.poll(() => svgPaths(page)).toBe(0)

  // Hidden features are not drawn or hit.
  await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().updateFeature('A', { hidden: true }))
  await page.mouse.click(a.x - 20, a.y - 20)
  await page.waitForTimeout(300)
  expect(await selectedIds(page)).toEqual([])
})

test('a selected feature stays on top of an overlapping unselected one', async ({ page }) => {
  // Nothing selected: the overlap hits A, the one on top (earlier features draw
  // last, matching the layer list order).
  const overlap = await screenPoint(page, 0.35, 0.35)
  await page.mouse.click(overlap.x, overlap.y)
  await expect.poll(() => selectedIds(page)).toEqual(['A'])
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([])

  const c = await featureCenter(page, 'C')
  await page.mouse.click(c.x + 20, c.y - 20)
  await expect.poll(() => selectedIds(page)).toEqual(['C'])
  // C selected (SVG) paints and hit-tests above A (canvas): C keeps the click.
  await page.mouse.click(overlap.x, overlap.y)
  await page.waitForTimeout(300)
  expect(await selectedIds(page)).toEqual(['C'])
})

test('a thin line is clickable a few pixels off its centre', async ({ page }) => {
  const p = await screenPoint(page, 0.8, 0.2)
  await page.mouse.click(p.x, p.y + 5)
  await expect.poll(() => selectedIds(page)).toEqual(['B'])
  // Well off the line: a map click clears it.
  await page.mouse.click(p.x, p.y + 30)
  await expect.poll(() => selectedIds(page)).toEqual([])
})

test('hover shows the name tooltip and Cmd/Alt set the drag cursor on the canvas', async ({ page }) => {
  const a = await featureCenter(page, 'A')
  await page.mouse.move(a.x - 30, a.y - 30)
  await page.mouse.move(a.x - 20, a.y - 20, { steps: 3 })
  await page.waitForTimeout(100)
  await expect(page.locator('.elm-feature-tooltip')).toHaveText('A')
  const cursor = () => page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-elmIdleFeatures-pane canvas')!).cursor)
  expect(await cursor()).toBe('pointer')
  await page.keyboard.down('Meta')
  await expect.poll(cursor).toBe('move')
  await page.keyboard.up('Meta')
  await page.keyboard.down('Alt')
  await expect.poll(cursor).toBe('copy')
  await page.keyboard.up('Alt')
  await expect.poll(cursor).toBe('pointer')
})

test('Cmd-drag moves and Alt-drag duplicates an unselected feature', async ({ page }) => {
  const coords = () => page.evaluate(() => JSON.stringify(window.__elementEditorTest!.dataStore.getState().features.find((f) => f.id === 'B')!.geometry))
  const before = await coords()
  const p = await screenPoint(page, 0.8, 0.2)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Meta')
  await page.mouse.down()
  await page.mouse.move(p.x, p.y + 60, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
  await expect.poll(coords).not.toBe(before)

  await page.keyboard.press('Escape')
  const a = await featureCenter(page, 'A')
  await page.mouse.move(a.x - 20, a.y - 20)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(a.x - 20, a.y + 80, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(4)
})

test('double-click on an unselected polygon enters vertex edit', async ({ page }) => {
  const a = await featureCenter(page, 'A')
  await page.mouse.dblclick(a.x - 20, a.y - 20)
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
  expect(await selectedIds(page)).toEqual(['A'])
})
