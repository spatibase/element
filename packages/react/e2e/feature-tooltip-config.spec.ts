/**
 * `config.featureTooltip` on both drop-ins (dev page `?tooltip=off|anchor|content|anchor-content`):
 * `false` hides the tooltip and Settings' switch, `content` supplies (or, with null, removes) the
 * text, and `placement: 'anchor'` pins the tooltip to the feature: it stays put while the cursor
 * moves over it, sits above a pin, and for a C-shaped area lands inside the shape.
 */
import { test, expect, type Page } from './fixtures'
import { importGeoJSON, waitForMap, screenPoint } from './helpers'

test.slow()

// Fractions of the initial view: [west..east, south..north].
const C_SHAPE: [number, number][] = [[0.2, 0.3], [0.6, 0.3], [0.6, 0.4], [0.3, 0.4], [0.3, 0.6], [0.6, 0.6], [0.6, 0.7], [0.2, 0.7], [0.2, 0.3]]
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

async function open(page: Page, query: string) {
  await page.goto('/?' + query)
  await waitForMap(page)
  const b = await page.evaluate(() => {
    const b = window.__elementEditorTest!.map.getBounds()
    return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }
  })
  const ll = ([fx, fy]: [number, number]) => [b.w + (b.e - b.w) * fx, b.s + (b.n - b.s) * fy]
  const poly = (id: string, ring: [number, number][]) => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Polygon', coordinates: [ring.map(ll)] } })
  await importGeoJSON(page, JSON.stringify({
    type: 'FeatureCollection',
    features: [
      poly('cee', C_SHAPE),
      poly('hidden', box(0.7, 0.3, 0.8, 0.4)),
      poly('default', box(0.7, 0.5, 0.8, 0.6)),
      { type: 'Feature', id: 'pin', properties: { name: 'pin' }, geometry: { type: 'Point', coordinates: ll([0.5, 0.85]) } },
    ],
  }))
  return { ll }
}

const tip = (page: Page) => page.locator('.elm-feature-tooltip')
const tipBox = async (page: Page) => (await tip(page).boundingBox())!

async function hover(page: Page, lng: number, lat: number) {
  const p = await screenPoint(page, lng, lat)
  await page.mouse.move(p.x - 30, p.y - 30)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  return p
}

test('content supplies the text, null hides it, undefined keeps the default label', async ({ page }) => {
  const { ll } = await open(page, 'tooltip=content')
  await hover(page, ...(ll([0.25, 0.5]) as [number, number]))
  await expect(tip(page)).toHaveText('Custom cee')
  await hover(page, ...(ll([0.75, 0.35]) as [number, number]))
  await expect(tip(page)).toHaveCount(0)
  await hover(page, ...(ll([0.75, 0.55]) as [number, number]))
  await expect(tip(page)).toHaveText('default')
})

test('featureTooltip: false shows no tooltip and no Settings switch', async ({ page }) => {
  const { ll } = await open(page, 'tooltip=off')
  await hover(page, ...(ll([0.25, 0.5]) as [number, number]))
  await page.waitForTimeout(300)
  await expect(tip(page)).toHaveCount(0)
  await page.getByRole('button', { name: /editor settings/i }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Show name on hover')).toHaveCount(0)
})

test('default config still offers the Settings switch', async ({ page }) => {
  await open(page, '')
  await page.getByRole('button', { name: /editor settings/i }).click()
  await expect(page.getByText('Show name on hover')).toBeVisible()
})

test('anchor placement: the tooltip stays put while the cursor moves, inside a C-shaped area', async ({ page }) => {
  const { ll } = await open(page, 'tooltip=anchor')
  await hover(page, ...(ll([0.25, 0.65]) as [number, number]))
  await expect(tip(page)).toHaveText('cee')
  const first = await tipBox(page)
  const p2 = await screenPoint(page, ...(ll([0.25, 0.45]) as [number, number]))
  await page.mouse.move(p2.x, p2.y, { steps: 5 })
  await page.waitForTimeout(100)
  expect(await tipBox(page)).toEqual(first)

  // The anchor (the tooltip's bottom centre, less the 8 px gap) is inside the C.
  const ring = await Promise.all(C_SHAPE.map(([fx, fy]) => screenPoint(page, ...(ll([fx, fy]) as [number, number]))))
  const ax = first.x + first.width / 2, ay = first.y + first.height + 8
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i].y > ay) !== (ring[j].y > ay) && ax < ((ring[j].x - ring[i].x) * (ay - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) inside = !inside
  }
  expect(inside).toBe(true)
})

test('anchor placement: a pin gets the tooltip above its head, and it follows a pan', async ({ page }) => {
  const { ll } = await open(page, 'tooltip=anchor')
  const [lng, lat] = ll([0.5, 0.85]) as [number, number]
  const tipPx = await screenPoint(page, lng, lat) // a pin's anchor is its tip
  // Leaflet: the pin head is above its tip; MapLibre: a circle on the point.
  const leaflet = await page.evaluate(() => 'latLngToContainerPoint' in window.__elementEditorTest!.map)
  await page.mouse.move(tipPx.x + 40, tipPx.y + 40)
  await page.mouse.move(tipPx.x, tipPx.y - (leaflet ? 14 : 0), { steps: 4 })
  await expect(tip(page)).toHaveText('pin')
  const b = await tipBox(page)
  expect(Math.abs(b.x + b.width / 2 - tipPx.x)).toBeLessThanOrEqual(2)
  const lift = leaflet ? 28 : 11
  expect(b.y + b.height).toBeLessThanOrEqual(tipPx.y - lift + 1)
  expect(b.y + b.height).toBeGreaterThan(tipPx.y - lift - 12)

  // Pan the map by 4 px (the cursor stays on the pin): the tooltip moves with its anchor.
  await page.evaluate(() => {
    const m = window.__elementEditorTest!.map
    if ('panBy' in m) m.panBy([4, 0], { animate: false })
    else m.jumpTo({ center: m.unproject([m.getContainer().clientWidth / 2 + 4, m.getContainer().clientHeight / 2]) })
  })
  await page.waitForTimeout(200)
  const moved = await tipBox(page)
  const tipPx2 = await screenPoint(page, lng, lat)
  expect(Math.abs(moved.x + moved.width / 2 - tipPx2.x)).toBeLessThanOrEqual(2)
  expect(moved.x).not.toBe(b.x)
})
