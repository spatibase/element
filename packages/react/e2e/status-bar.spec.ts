import { test, expect, MAP, ATTRIBUTION, ATTRIBUTION_TOGGLE } from './fixtures'
import { waitForMap } from './helpers'

const at = (layout: object) => '/?layout=' + encodeURIComponent(JSON.stringify(layout))
// The old `statusBar: true` arrangement: keyboard left, locate + zoom right, the rest on the map.
const BAR = at({
  topCenter: ['toolbar'],
  leftCenter: [{ group: ['undo', 'redo'] }],
  bottomLeft: ['fitBounds', 'table', 'schema', 'geojson', 'settings'],
  statusLeft: ['keyboard'],
  statusRight: ['locate', 'zoomIndicator'],
})

test.describe('Status bar (ui.layout statusLeft / statusRight)', () => {
  test('off by default', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await expect(page.locator('[data-elm-status-bar]')).toHaveCount(0)
  })

  test('sits below the map, holds the default buttons once, and they work', async ({ page }) => {
    await page.goto(BAR)
    await waitForMap(page)
    const bar = page.locator('[data-elm-status-bar]')
    await expect(bar).toBeVisible()

    // Default items live in the bar only, not in a corner too.
    await expect(bar.getByRole('button', { name: /set map zoom level/i })).toBeVisible()
    await expect(bar.getByRole('button', { name: /show my location/i })).toBeVisible()
    await expect(bar.getByRole('button', { name: /show keyboard shortcuts/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /show my location/i })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /show keyboard shortcuts/i })).toHaveCount(1)
    // Other buttons stay in their corner.
    await expect(bar.getByRole('button', { name: /show geojson/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /show geojson/i })).toBeVisible()

    // The map ends where the bar starts: no overlap.
    const mapBox = (await page.locator(MAP).boundingBox())!
    const barBox = (await bar.boundingBox())!
    expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(barBox.y + 0.5)

    // Default: Keyboard on the left, Locate + Zoom pushed to the right edge.
    const kbLeft = (await bar.getByRole('button', { name: /show keyboard shortcuts/i }).boundingBox())!
    const locate = (await bar.getByRole('button', { name: /show my location/i }).boundingBox())!
    expect(kbLeft.x).toBeLessThan(barBox.x + 40)
    expect(locate.x).toBeGreaterThan(barBox.x + barBox.width / 2)

    // Compact buttons keep a 24px hit target.
    const kb = (await bar.getByRole('button', { name: /show keyboard shortcuts/i }).boundingBox())!
    expect(kb.width).toBeGreaterThanOrEqual(24)
    expect(kb.height).toBeGreaterThanOrEqual(24)

    // Click opens the shortcuts window; the button shows it as pressed.
    const kbButton = bar.getByRole('button', { name: /show keyboard shortcuts/i })
    await kbButton.click()
    await expect(kbButton).toHaveAttribute('aria-pressed', 'true')
  })

  test('a bar whose buttons are all hidden is not rendered (readonly hides schema)', async ({ page }) => {
    await page.goto(at({ statusRight: ['schema'] }) + '&readonly=1')
    await waitForMap(page)
    await expect(page.locator('[data-elm-status-bar]')).toHaveCount(0)
    await page.goto(at({ statusRight: ['schema'] }))
    await waitForMap(page)
    await expect(page.locator('[data-elm-status-bar]')).toBeVisible()
  })

  test("'attribution' moves the map attribution into the bar", async ({ page, engine }) => {
    await page.goto(at({ statusRight: ['locate', 'attribution'] }))
    await waitForMap(page)
    const bar = page.locator('[data-elm-status-bar]')
    const attr = bar.locator(`[data-elm-attribution] ${ATTRIBUTION}`)
    await expect(attr).toBeVisible()
    await expect(attr.getByRole('link', { name: 'Nominatim' })).toHaveCount(1)
    // No on-map control or compact toggle.
    await expect(page.locator(`${MAP} ${ATTRIBUTION}`)).toHaveCount(0)
    // (MapLibre keeps its toggle button in the moved control, hidden when not compact.)
    await expect(page.locator(ATTRIBUTION_TOGGLE)).toBeHidden()
    if (engine === 'leaflet') {
      await expect(attr.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible()
      // Leaflet keeps updating the same element.
      await page.evaluate(() => window.__leafletMap!.attributionControl.addAttribution('Extra credit'))
      await expect(attr).toContainText('Extra credit')
    } else {
      await expect(attr).toContainText(/OpenFreeMap|OpenStreetMap|Mapterhorn/)
    }
    // One line, no taller than the bar.
    const barBox = (await bar.boundingBox())!
    const box = (await attr.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(barBox.height)
  })

  test('without the attribution entry the on-map toggle stays', async ({ page }) => {
    await page.goto(BAR)
    await waitForMap(page)
    await expect(page.locator(ATTRIBUTION_TOGGLE)).toBeVisible()
  })

  test('separators: dividers in the bar and inside groups; none loose over the map', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tile/i.test(m.text())) errors.push(m.text()) })
    await page.goto(at({
      bottomLeft: ['fitBounds', 'separator', { group: ['table', 'separator', 'schema'] }],
      statusLeft: ['keyboard', 'separator', 'settings', 'separator', 'separator'],
      statusRight: [{ group: ['locate', 'separator', 'zoomIndicator'] }],
    }))
    await waitForMap(page)
    const bl = page.locator('[data-elm-slot="bottomLeft"]')
    await expect(bl.locator(':scope > [data-elm-separator]')).toHaveCount(0)
    await expect(bl.locator('[data-elm-group] [data-elm-separator]')).toHaveCount(1)
    await expect(page.locator('[data-elm-slot="statusLeft"] > [data-elm-separator]')).toHaveCount(1)
    await expect(page.locator('[data-elm-slot="statusRight"] [data-elm-group] [data-elm-separator]')).toHaveCount(1)
    expect(errors).toEqual([])
  })
  // The shell gets the picker as a pre-built element; it must still take the slot's size. (Groups refuse 'basemap'.)
  for (const [engine, query] of [['Leaflet', '&basemaps=osm,custom'], ['MapLibre', '&engine=maplibre']]) {
    test(`${engine}: the basemap picker is compact in the bar and full size on the map`, async ({ page }) => {
      const height = async (layout: object) => {
        await page.goto(at(layout) + query)
        return (await page.getByRole('button', { name: 'Basemap' }).boundingBox())!.height
      }
      expect(await height({ statusLeft: ['basemap'] })).toBe(24)
      expect(await height({ topRight: ['basemap'] })).toBe(48)
    })
  }
})
