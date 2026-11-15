/**
 * Undo / redo while editing: a feature that still exists stays selected and stays in vertex edit /
 * transform; one that the undo removed leaves the selection, and both modes end (MapLibre used to
 * keep `vertexEditActive` / `transformActive` true, so the next click dropped into vertex edit).
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, importGeoJSON, featureCenter, flyTo } from './helpers'

const sq = (id: string, name: string, x: number) => ({
  type: 'Feature', id, properties: { name },
  geometry: { type: 'Polygon', coordinates: [[[x, 48.85], [x + 0.01, 48.85], [x + 0.01, 48.86], [x, 48.86], [x, 48.85]]] },
})
const DATA = JSON.stringify({ type: 'FeatureCollection', features: [sq('a', 'Alpha', 2.33), sq('b', 'Beta', 2.36)] })

const ui = (page: Page) => page.evaluate(() => {
  const u = window.__elementEditorTest!.uiStore.getState()
  const d = window.__elementEditorTest!.dataStore.getState()
  return { vertex: u.vertexEditActive, transform: u.transformActive, selected: d.selectedIds }
})

/** A committed edit of `id` while in the mode: snapshot + geometry change, like a vertex drag. */
const edit = (page: Page, id: string) => page.evaluate((fid) => {
  const ds = window.__elementEditorTest!.dataStore
  const f = ds.getState().features.find((x) => x.id === fid)!
  const ring = (f.geometry as { coordinates: number[][][] }).coordinates[0].map(([x, y]) => [x + 0.001, y])
  ds.getState().takeSnapshot()
  ds.getState().updateFeature(fid, { geometry: { type: 'Polygon', coordinates: [ring] } as never })
}, id)

test.describe('Undo during vertex edit / transform', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, DATA)
    await flyTo(page, [48.855, 2.35], 13)
    await page.waitForTimeout(300)
  })

  test('the edited feature stays selected and in vertex edit after undo / redo', async ({ page }) => {
    const { x, y } = await featureCenter(page, 'Alpha')
    await page.mouse.click(x, y)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await ui(page)).vertex).toBe(true)
    const before = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.find((f) => f.id === 'a')!.geometry)
    await edit(page, 'a')
    await page.keyboard.press('ControlOrMeta+z')
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.find((f) => f.id === 'a')!.geometry)).toEqual(before)
    await page.waitForTimeout(200)
    expect(await ui(page)).toEqual({ vertex: true, transform: false, selected: ['a'] })
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.waitForTimeout(200)
    expect(await ui(page)).toEqual({ vertex: true, transform: false, selected: ['a'] })
  })

  test('transform stays on after undo', async ({ page }) => {
    const { x, y } = await featureCenter(page, 'Alpha')
    await page.mouse.click(x, y)
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setTransformActive(true))
    await edit(page, 'a')
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForTimeout(200)
    expect(await ui(page)).toEqual({ vertex: false, transform: true, selected: ['a'] })
  })

  test('an undo that removes the edited feature ends the mode; the next click only selects', async ({ page }) => {
    // A feature added in one undo step, then put in vertex edit.
    await page.evaluate(() => {
      const ds = window.__elementEditorTest!.dataStore.getState()
      ds.addFeature({ type: 'Feature', id: 'c', properties: { name: 'Gamma' }, geometry: { type: 'Polygon', coordinates: [[[2.345, 48.85], [2.355, 48.85], [2.355, 48.86], [2.345, 48.86], [2.345, 48.85]]] } } as never)
    })
    const { x, y } = await featureCenter(page, 'Gamma')
    await page.mouse.click(x, y)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await ui(page)).vertex).toBe(true)
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setTransformActive(false))
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(2)
    await page.waitForTimeout(200)
    expect(await ui(page)).toEqual({ vertex: false, transform: false, selected: [] })

    const beta = await featureCenter(page, 'Beta')
    await page.mouse.click(beta.x, beta.y)
    await page.waitForTimeout(300)
    expect(await ui(page)).toEqual({ vertex: false, transform: false, selected: ['b'] })
  })
})
