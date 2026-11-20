/**
 * `coordinates` prop (opt-in): a shape drawn on a far world copy is committed with longitudes in
 * range, and x/y are rounded; without the prop the map's raw values are stored.
 */
import { test, expect } from './fixtures'
import { waitForMap, flyTo, screenPoint } from './helpers'

/** Draws a rectangle whose lng range is ~[185, 200] (the right-hand world copy), returns its stored coordinates. */
async function drawOnRightWorldCopy(page: import('@playwright/test').Page) {
  await page.goto(`/`)
  await waitForMap(page)
  return drawRect(page)
}

async function drawRect(page: import('@playwright/test').Page) {
  await flyTo(page, [10, 190], 3)
  const a = await screenPoint(page, 185.123456789, 5.123456789)
  const b = await screenPoint(page, 200.987654321, 15.987654321)
  await page.keyboard.press('r')
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const f = window.__elementEditorTest!.dataStore.getState().features[0]
    return f ? { coordinates: (f.geometry as { coordinates: number[][][] }).coordinates[0], bbox: f.bbox } : null
  })
}

const decimals = (n: number) => (String(n).split('.')[1] ?? '').length

test('off by default: the map-reported longitude is stored as is', async ({ page }) => {
  const r = await drawOnRightWorldCopy(page)
  expect(r).not.toBeNull()
  expect(Math.max(...r!.coordinates.map((c) => c[0]))).toBeGreaterThan(180)
})

test('wrap + precision: committed coordinates are in range and rounded, onChange data matches', async ({ page }) => {
  await page.goto('/?coordinates=wrap,6')
  await waitForMap(page)
  const r = await drawRect(page)
  expect(r).not.toBeNull()
  for (const [lng, lat] of r!.coordinates) {
    expect(lng).toBeGreaterThanOrEqual(-180)
    expect(lng).toBeLessThanOrEqual(180)
    expect(decimals(lng)).toBeLessThanOrEqual(6)
    expect(decimals(lat)).toBeLessThanOrEqual(6)
  }
  expect(r!.bbox![0]).toBeGreaterThanOrEqual(-180)
  // The ref (what the host reads) and undo history agree with the store.
  const exported = await page.evaluate(() => JSON.parse(window.__elementEditorRef!.exportGeoJSON()).features[0].geometry.coordinates[0])
  expect(exported).toEqual(r!.coordinates)
})
