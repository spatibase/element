/**
 * `bounds` prop restricts panning on both drop-ins (dev page `?bounds=west,south,east,north`, a GeoJSON
 * bbox; `&legacyBounds=1` passes the deprecated `[[south, west], [north, east]]` form instead).
 * The default view (48, 10) is outside the box, so a centre inside it proves the prop applied on mount.
 */
import { test, expect, MAP, type Page } from './fixtures'

const BOUNDS = [2.2, 48.8, 2.4, 48.9] // Paris bbox: west, south, east, north
const center = (page: Page) => page.evaluate(() => {
  const c = window.__elementEditorTest!.map.getCenter()
  return { lat: c.lat, lng: c.lng }
})

async function expectInside(page: Page) {
  const [w, s, e, n] = BOUNDS
  await expect.poll(async () => {
    const c = await center(page)
    return c.lat >= s - 1e-3 && c.lat <= n + 1e-3 && c.lng >= w - 1e-3 && c.lng <= e + 1e-3
  }, { timeout: 5000 }).toBe(true)
}

for (const legacy of [false, true]) {
  test(`bounds${legacy ? ' (deprecated nested form)' : ''}: keeps the map inside the box on mount and after a drag`, async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    await page.goto(`/?bounds=${BOUNDS.join(',')}${legacy ? '&legacyBounds=1' : ''}`)
    await page.waitForFunction(() => !!window.__elementEditorTest?.map)
    await expectInside(page)

    const box = (await page.locator(MAP).boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 400, y + 300, { steps: 10 })
    await page.mouse.up()
    await expectInside(page)
    const deprecation = warnings.filter((t) => t.includes('bounds={[[south, west], [north, east]]} is deprecated'))
    expect(deprecation).toHaveLength(legacy ? 1 : 0)
    if (legacy) expect(deprecation[0]).toContain(`bounds={${JSON.stringify(BOUNDS)}}`)
  })
}
