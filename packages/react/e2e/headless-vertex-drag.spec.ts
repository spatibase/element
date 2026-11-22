/**
 * Headless hosts (apps/demo `?headless=<engine>`, only `ElementEditorControls`) on a desktop viewport
 * with a narrow map: a polygon in point editing entered through the ref (`setVertexEdit`), then the
 * gesture a host test uses: hover a corner handle, press, move in two segments, release. The corner
 * moves, the other corners stay, point editing stays on. Runs in every browser project that matches it
 * (Leaflet used to drop the drag: a re-render mid-drag put the handle back, dragend committed the old
 * spot and the trailing click on the map ended point editing; seen first in WebKit hosts).
 */
import { test, expect, type Page } from './fixtures'

test.use({ viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${process.env.E2E_DEMO_PORT ?? 5199}` })

type Ring = number[][]
const ring = (page: Page) => page.evaluate(() =>
  (window.__elementEditorTest!.dataStore.getState().features[0]?.geometry as { coordinates: Ring[] }).coordinates[0])

/** Page position of a [lng, lat] on either engine's map. */
const pagePoint = (page: Page, lngLat: number[]) => page.evaluate(([lng, lat]) => {
  const map = window.__elementEditorTest!.map as {
    getContainer(): HTMLElement
    latLngToContainerPoint?: (ll: [number, number]) => { x: number; y: number }
    project?: (ll: [number, number]) => { x: number; y: number }
  }
  const p = map.latLngToContainerPoint ? map.latLngToContainerPoint([lat, lng]) : map.project!([lng, lat])
  const r = map.getContainer().getBoundingClientRect()
  return { x: r.left + p.x, y: r.top + p.y }
}, lngLat)

/** The `.elm-vertex` handle nearest a page point (its DOM centre). */
async function vertexNear(page: Page, point: { x: number; y: number }) {
  const handles = page.locator('.elm-vertex')
  await handles.first().waitFor()
  const centres = await handles.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }))
  centres.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))
  return centres[0]
}

for (const engine of ['leaflet', 'maplibre'] as const) for (const idle of [0, 3000]) {
  test(`headless ${engine}: dragging a corner in point editing (ref entry) moves it${idle ? ' after a pause' : ''}`, async ({ page }) => {
    await page.goto(`/?headless=${engine}&width=380`)
    await page.waitForFunction(() => !!window.__elementEditorTest && !!window.__elementEditorRef)
    // A rectangle 180 x 140 px around the map centre (the host's seeded area); corner 2 = north-east.
    const id = await page.evaluate(() => {
      const map = window.__elementEditorTest!.map as {
        getContainer(): HTMLElement
        containerPointToLatLng?: (p: [number, number]) => { lat: number; lng: number }
        unproject?: (p: [number, number]) => { lat: number; lng: number }
      }
      const { clientWidth: w, clientHeight: h } = map.getContainer()
      const at = (dx: number, dy: number) => {
        const p: [number, number] = [w / 2 + dx, h / 2 + dy]
        const ll = map.containerPointToLatLng ? map.containerPointToLatLng(p) : map.unproject!(p)
        return [ll.lng, ll.lat]
      }
      const sw = at(-90, 70), se = at(90, 70), ne = at(90, -70), nw = at(-90, -70)
      return window.__elementEditorTest!.dataStore.getState().addFeature({
        type: 'Feature', id: crypto.randomUUID(), properties: {},
        geometry: { type: 'Polygon', coordinates: [[sw, se, ne, nw, sw]] },
      } as never)!.id as string
    })
    await page.waitForTimeout(300)
    expect(await page.evaluate((i) => window.__elementEditorRef!.setVertexEdit(i), id)).toBe(true)
    const before = await ring(page)
    const corner = before[2]
    const from = await vertexNear(page, await pagePoint(page, corner))

    // The host saw it fail more often after a pause, so one run waits idle first.
    if (idle) await page.waitForTimeout(idle)
    await page.mouse.move(from.x, from.y)
    await page.waitForTimeout(300)
    await page.mouse.down()
    await page.mouse.move(from.x + 20, from.y + 15, { steps: 6 })
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    await expect.poll(async () => (await ring(page))[2][0]).toBeGreaterThan(corner[0] + 0.5)
    const after = await ring(page)
    expect(after).toHaveLength(before.length)
    expect(after[0]).toEqual(before[0])
    expect(after[2][1]).toBeLessThan(corner[1])
    expect(await page.evaluate(() => window.__elementEditorRef!.getVertexEdit())).toBe(id)
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
  })
}
