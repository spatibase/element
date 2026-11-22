/**
 * `ref.setVertexEdit` sticks when called in `onReady` and in the same tick as a data load (no
 * `setTimeout(0)` needed), on both engines, also with enough features to hit Leaflet's progressive mount.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap } from './helpers'

const changes = (page: Page) => page.evaluate(() => (window as unknown as { __vertexEditChanges?: (string | null)[] }).__vertexEditChanges ?? [])
const getVertexEdit = (page: Page) => page.evaluate(() => window.__elementEditorRef!.getVertexEdit())

/** Same-tick load then enter: which call is under test. */
type Load = 'setFeatureCollection' | 'importGeoJSON' | 'addFeature'

function collection(n: number, cx: number, cy: number) {
  const features = Array.from({ length: n }, (_, i) => {
    const x = cx + (i % 40) * 0.01, y = cy + Math.floor(i / 40) * 0.01
    return { type: 'Feature', id: `f${i}`, properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.008, y], [x + 0.008, y + 0.008], [x, y + 0.008], [x, y]]] } }
  })
  return { type: 'FeatureCollection', features }
}

test.describe('setVertexEdit timing', () => {
  test('inside onReady: handles show, getVertexEdit is the id, onVertexEditChange fires once', async ({ page }) => {
    await page.goto('/?data=sample&readyVertexEdit=tokyo-a')
    await waitForMap(page)
    expect(await page.evaluate(() => (window as unknown as { __readyVertexEdit?: boolean }).__readyVertexEdit)).toBe(true)
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)
    expect(await getVertexEdit(page)).toBe('tokyo-a')
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    expect(await changes(page)).toEqual(['tokyo-a'])
  })

  for (const n of [3, 1000]) {
    for (const load of ['setFeatureCollection', 'importGeoJSON', 'addFeature'] as Load[]) {
      if (load === 'addFeature' && n > 3) continue
      test(`${load} then setVertexEdit in the same tick sticks (${n} features)`, async ({ page }) => {
        await page.goto('/')
        await waitForMap(page)
        const c = await page.evaluate(() => { const m = window.__elementEditorTest!.map as unknown as { getCenter(): { lng: number; lat: number } }; m.getCenter(); const { lng, lat } = m.getCenter(); return { lng, lat } })
        const ok = await page.evaluate(({ n, load, fc }) => {
          const ref = window.__elementEditorRef!
          const ds = window.__elementEditorTest!.dataStore
          if (load === 'setFeatureCollection') ref.setFeatureCollection(fc as never)
          else if (load === 'importGeoJSON') ds.getState().importGeoJSON(fc as never, 'replace')
          else ds.getState().addFeature(fc.features[0] as never)
          const id = ds.getState().features[0].id
          void n
          return ref.setVertexEdit(id)
        }, { n, load, fc: collection(n, c.lng, c.lat) })
        expect(ok).toBe(true)
        const id = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].id)
        await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 8000 })
        await page.waitForTimeout(800)
        expect(await getVertexEdit(page)).toBe(id)
        await expect(page.locator('.elm-vertex').first()).toBeVisible()
        expect(await changes(page)).toEqual([id])
      })
    }
  }
})
