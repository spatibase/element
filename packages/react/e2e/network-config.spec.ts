/**
 * config.network: every request goes to the configured servers (dev page `?network=custom`, all
 * on *.example.test, through a `fetch` that adds `X-Elm-Test: 1`), none to the default ones;
 * `?network=off` hides what needs a service; the deprecated `routingApiKey` still picks ORS.
 */
import { test, expect, MAP, ATTRIBUTION, type Page, type Locator } from './fixtures'
import { waitForMap, flyTo, NOMINATIM_EIFFEL } from './helpers'

type MapLibreMap = import('maplibre-gl').Map
type Req = { url: string; headers: Record<string, string> }

const DEFAULT_HOSTS = /overpass-api\.de|nominatim\.openstreetmap\.org|router\.project-osrm\.org|api\.openrouteservice\.org|tiles\.openfreemap\.org|tiles\.mapterhorn\.com|tile\.openstreetmap\.org|cdn\.jsdelivr\.net/

const PARK = {
  elements: [{
    type: 'way', id: 123456, tags: { name: 'Test Park', leisure: 'park' },
    geometry: [{ lat: 48.86, lon: 2.34 }, { lat: 48.861, lon: 2.341 }, { lat: 48.861, lon: 2.339 }, { lat: 48.86, lon: 2.34 }],
  }],
}

/** Every request the page makes (to see that none goes to a default host). */
function recordRequests(page: Page): Req[] {
  const all: Req[] = []
  page.on('request', (r) => all.push({ url: r.url(), headers: r.headers() }))
  return all
}

/** Answer a configured host and keep its requests. */
async function serve(page: Page, glob: string, body: (url: URL) => unknown): Promise<Req[]> {
  const seen: Req[] = []
  await page.route(glob, (r) => {
    seen.push({ url: r.request().url(), headers: r.request().headers() })
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body(new URL(r.request().url()))) })
  })
  return seen
}

/** OSRM-shaped answer: a straight line through the requested waypoints. */
const osrmLine = (url: URL) => ({
  code: 'Ok',
  routes: [{ geometry: { type: 'LineString', coordinates: url.pathname.split('/').pop()!.split(';').map((p) => p.split(',').map(Number)) } }],
})

async function mapCenter(page: Page) {
  const box = await page.locator(MAP).boundingBox()
  if (!box) throw new Error('no map')
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

async function drawRoute(page: Page) {
  const { cx, cy } = await mapCenter(page)
  await page.getByRole('button', { name: 'Route' }).click()
  await page.mouse.click(cx - 100, cy)
  await page.waitForTimeout(400)
  await page.mouse.click(cx + 100, cy)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
}

/** The attribution text, wherever the control is (the "i" toggle may keep it collapsed). */
const attributionOf = (page: Page): Locator => page.locator(ATTRIBUTION).first()

test.describe('?network=custom: requests go to the configured servers', () => {
  test('Picker: Overpass on the configured endpoint, through the configured fetch', async ({ page }) => {
    const all = recordRequests(page)
    const overpass = await serve(page, 'https://overpass.example.test/**', () => PARK)
    await page.goto('/?network=custom')
    await waitForMap(page)
    await flyTo(page, [48.86, 2.34], 18)
    await page.getByRole('button', { name: 'Picker' }).click()
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx, cy)
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 5000 })
    expect(overpass).toHaveLength(1)
    expect(overpass[0].url).toBe('https://overpass.example.test/api/interpreter')
    expect(overpass[0].headers['x-elm-test']).toBe('1')
    expect(all.filter((r) => DEFAULT_HOSTS.test(r.url))).toEqual([])
  })

  test('search: the configured geocoder with its email, credit swapped', async ({ page }) => {
    const all = recordRequests(page)
    const search = await serve(page, 'https://nominatim.example.test/**', () => [NOMINATIM_EIFFEL])
    await page.goto('/?network=custom')
    await waitForMap(page)
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByText('Eiffel Tower').first()).toBeVisible({ timeout: 3000 })
    const url = new URL(search[0].url)
    expect(url.origin + url.pathname).toBe('https://nominatim.example.test/search')
    expect(url.searchParams.get('email')).toBe('dev@example.test')
    expect(search[0].headers['x-elm-test']).toBe('1')
    await expect(attributionOf(page)).toContainText('Search by Example')
    await expect(attributionOf(page).getByRole('link', { name: 'Nominatim' })).toHaveCount(0)
    expect(all.filter((r) => DEFAULT_HOSTS.test(r.url))).toEqual([])
  })

  test('Route tool: snaps through the configured OSRM server', async ({ page }) => {
    const all = recordRequests(page)
    const osrm = await serve(page, 'https://osrm.example.test/**', osrmLine)
    await page.goto('/?network=custom')
    await waitForMap(page)
    await drawRoute(page)
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
    expect(osrm.length).toBeGreaterThan(0)
    expect(osrm.every((r) => r.url.startsWith('https://osrm.example.test/route/v1/foot/') && r.headers['x-elm-test'] === '1')).toBe(true)
    expect(all.filter((r) => DEFAULT_HOSTS.test(r.url))).toEqual([])
  })

  test('basemap tiles: the OSM raster basemap comes from osmRaster, with its credit', async ({ page, engine }) => {
    const all = recordRequests(page)
    await page.goto('/?network=custom&basemap=osm')
    await waitForMap(page)
    await expect.poll(() => all.some((r) => r.url.startsWith('https://osmraster.example.test/'))).toBe(true)
    if (engine === 'maplibre') {
      expect(await page.evaluate(() => (window.__elementEditorTest!.map as MapLibreMap).getStyle().sources.basemap)).toMatchObject({ tiles: ['https://osmraster.example.test/{z}/{x}/{y}.png'], attribution: 'Custom raster tiles' })
    } else {
      await expect(attributionOf(page)).toContainText('Custom raster tiles')
    }
    expect(all.filter((r) => DEFAULT_HOSTS.test(r.url))).toEqual([])
  })

  test('vector basemap: tiles, elevation, glyphs and sprite from the configured servers', async ({ page, engine }) => {
    test.skip(engine !== 'maplibre', 'vector basemaps are MapLibre-only')
    const all = recordRequests(page)
    await page.goto('/?network=custom&basemap=streets')
    await waitForMap(page)
    const style = await page.evaluate(() => (window.__elementEditorTest!.map as MapLibreMap).getStyle())
    expect(style.glyphs).toBe('https://glyphs.example.test/{fontstack}/{range}.pbf')
    expect(style.sprite).toBe('https://sprite.example.test/sprite')
    expect(style.sources.openmaptiles).toMatchObject({ url: 'https://vector.example.test/planet', attribution: 'Custom vector tiles' })
    expect(style.sources['terrain-dem']).toMatchObject({ tiles: ['https://dem.example.test/{z}/{x}/{y}.png'], encoding: 'mapbox' })
    await expect.poll(() => all.some((r) => r.url.startsWith('https://vector.example.test/planet'))).toBe(true)
    await expect.poll(() => all.some((r) => r.url.startsWith('https://sprite.example.test/sprite'))).toBe(true)
    expect(all.filter((r) => DEFAULT_HOSTS.test(r.url))).toEqual([])
  })
})

test.describe('?network=off: services off, their tools hidden', () => {
  test('no Route tool, no search box, no Nominatim credit; Picker only where tiles can serve it', async ({ page, engine }) => {
    const all = recordRequests(page)
    await page.goto('/?network=off')
    await waitForMap(page)
    await expect(page.getByRole('button', { name: 'Area', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Route' })).toHaveCount(0)
    await expect(page.getByPlaceholder(/search/i)).toHaveCount(0)
    await expect(attributionOf(page).getByRole('link', { name: 'Nominatim' })).toHaveCount(0)
    if (engine === 'leaflet') {
      await expect(page.getByRole('button', { name: 'Picker' })).toHaveCount(0)
    } else {
      // MapLibre picks from the vector tiles alone (offline here): an honest miss, no Overpass request.
      await flyTo(page, [48.86, 2.34], 18)
      await page.getByRole('button', { name: 'Picker' }).click()
      const { cx, cy } = await mapCenter(page)
      await page.mouse.click(cx, cy)
      await expect(page.getByText('No shape here in the basemap')).toBeVisible({ timeout: 3000 })
    }
    expect(all.filter((r) => /overpass|nominatim|osrm|openrouteservice/.test(new URL(r.url).hostname))).toEqual([])
  })
})

test('deprecated routingApiKey still routes through ORS with the key, and shows the ORS credit', async ({ page }) => {
  const ors: Req[] = []
  await page.route('https://api.openrouteservice.org/**', async (r) => {
    ors.push({ url: r.request().url(), headers: r.request().headers() })
    const coords = (r.request().postDataJSON() as { coordinates: number[][] }).coordinates
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: coords } }] }) })
  })
  await page.goto('/?routingApiKey=test-key')
  await waitForMap(page)
  await expect(attributionOf(page)).toContainText('openrouteservice.org')
  await drawRoute(page)
  await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  expect(ors.length).toBeGreaterThan(0)
  expect(ors[0].headers.authorization).toBe('test-key')
})
