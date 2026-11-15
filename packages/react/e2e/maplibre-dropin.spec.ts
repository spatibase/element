/**
 * MapLibre drop-in (`<ElementEditor />` from src/maplibre) on the react dev page (project chromium-maplibre).
 * The fixture answers basemap tile hosts offline (basemap styles themselves are bundled).
 */
import { test, expect, type Page } from './fixtures'
import { importGeoJSON, waitForMap, featureCount, drawPolygon, selectedIds } from './helpers'
import type { Map as MapLibreMap } from 'maplibre-gl'

test.skip(({ engine }) => engine !== 'maplibre', 'MapLibre drop-in props (basemap catalog, sprite, style switching)')

const IGNORED_ERR = /openfreemap|mapterhorn|ERR_FAILED|Failed to load resource|net::/i

/** The dev page on the MapLibre drop-in (the project's engine), keyboard focus on the map. */
async function open(page: Page, query = '') {
  await page.goto('/?' + query)
  await waitForMap(page)
  await page.locator('.maplibregl-canvas').first().focus()
}

const styleName = (page: Page) => page.evaluate(() => (window.__elementEditorTest!.map as MapLibreMap).getStyle().name)
const center = (page: Page) => page.evaluate(() => { const c = window.__elementEditorTest!.map.getCenter(); return [c.lng, c.lat] })
const features = featureCount

const SQUARE = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 'sq', properties: { name: 'Far' }, geometry: { type: 'Polygon', coordinates: [[[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]] } }],
}

test('mounts: canvas, test handle, no page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_ERR.test(m.text())) errors.push(m.text()) })
  await open(page)
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible()
  expect(await page.evaluate(() => !!(window.__elementEditorTest!.map as MapLibreMap))).toBe(true)
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

test('draws a polygon with the toolbar keys and clicking it selects it', async ({ page }) => {
  await open(page)
  const { cx, cy } = await drawPolygon(page)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(0)
  await page.mouse.click(cx, cy)
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(1)
})

test('FitBounds button and ref.flyTo move the map (MapController wiring)', async ({ page }) => {
  await open(page)
  await importGeoJSON(page, JSON.stringify(SQUARE))
  // Fly/fit centre the target in the visible map (offset for panels that cover it); close the
  // layers panel so the map centre is the target and this test checks only the wiring.
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setSidebarOpen(false))
  const before = await center(page)
  await page.getByRole('button', { name: /fit map to features/i }).click()
  await expect.poll(async () => Math.abs((await center(page))[0] - 100.5)).toBeLessThan(1)
  expect((await center(page))[0]).not.toBeCloseTo(before[0], 0)

  // Object form, GeoJSON [lng, lat] order.
  await page.evaluate(() => window.__elementEditorRef!.flyTo({ center: [-40, 10], zoom: 5 }))
  await expect.poll(async () => Math.abs((await center(page))[0] + 40)).toBeLessThan(1)
  // Deprecated [lat, lng] tuple form still works.
  await page.evaluate(() => window.__elementEditorRef!.flyTo([20, -60], 5))
  await expect.poll(async () => Math.abs((await center(page))[0] + 60)).toBeLessThan(1)
})

test('picker: Dark swaps the style and keeps features + undo; basemaps=0 hides it', async ({ page }) => {
  await open(page)
  await importGeoJSON(page, JSON.stringify(SQUARE))
  const light = await styleName(page)
  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect.poll(() => styleName(page)).toBe('Lab Dark')
  expect(light).not.toBe('Lab Dark')
  await expect.poll(() => page.evaluate(() => {
    const s = (window.__elementEditorTest!.map as MapLibreMap).getSource('elm-features')
    return !!s && !!(window.__elementEditorTest!.map as MapLibreMap).getLayer('background')
  })).toBe(true)
  expect(await features(page)).toBe(1)
  await page.keyboard.press('Control+z')
  await expect.poll(() => features(page)).toBe(0)

  await open(page, '&basemaps=0')
  await expect(page.getByRole('button', { name: 'Basemap' })).toHaveCount(0)
})

test('picker stays open until the toggle or Escape closes it; no title', async ({ page }) => {
  await open(page)
  const toggle = page.getByRole('button', { name: 'Basemap' })
  const panel = page.getByRole('group', { name: 'Basemap' })
  await toggle.click()
  await expect(panel).toBeVisible()
  await expect(panel).not.toContainText('Basemap')
  await panel.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect.poll(() => styleName(page)).toBe('Lab Dark')
  await expect(panel).toBeVisible()
  const box = (await page.locator('.maplibregl-canvas').first().boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.click(x, y)
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 80, y + 40, { steps: 5 }); await page.mouse.up()
  await expect(panel).toBeVisible()
  await toggle.click()
  await expect(panel).toHaveCount(0)
  await toggle.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('auto follows the editor theme; the chosen basemap is remembered', async ({ page }) => {
  await open(page)
  const setTheme = (t: 'light' | 'dark') =>
    page.evaluate((v) => window.__elementEditorTest!.uiStore.setState({ userTheme: v }), t)
  await setTheme('light')
  await expect.poll(() => styleName(page)).not.toBe('Lab Dark')
  await setTheme('dark')
  await expect.poll(() => styleName(page)).toBe('Lab Dark')

  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect.poll(() => styleName(page)).toBe('Lab Light')
  await page.reload()
  await waitForMap(page)
  expect(await styleName(page)).toBe('Lab Light')
})

test('auto follows the theme with no picker mounted (basemaps=0)', async ({ page }) => {
  await open(page, '&basemaps=0')
  await expect(page.getByRole('button', { name: 'Basemap' })).toHaveCount(0)
  const setTheme = (t: 'light' | 'dark') =>
    page.evaluate((v) => window.__elementEditorTest!.uiStore.setState({ userTheme: v }), t)
  await setTheme('light')
  await expect.poll(() => styleName(page)).not.toBe('Lab Dark')
  await setTheme('dark')
  await expect.poll(() => styleName(page)).toBe('Lab Dark')
  await setTheme('light')
  await expect.poll(() => styleName(page)).not.toBe('Lab Dark')
  expect(await page.evaluate(() => !!(window.__elementEditorTest!.map as MapLibreMap).getSource('elm-features'))).toBe(true)
})

test('a basemap style that fails to load still mounts the editor and reports the error', async ({ page }) => {
  // The built-in styles are lazy JSON chunks; failing them is the "network down / bad deploy" case.
  await page.route(/\/basemaps\/styles\/\w+\.json/, (r) => r.abort())
  await open(page)
  await expect(page.getByText(/basemap could not be loaded/i)).toBeVisible()
  await importGeoJSON(page, JSON.stringify(SQUARE))
  expect(await features(page)).toBe(1)
})

test('status-bar attribution lands inside the bar', async ({ page }) => {
  const layout = { statusRight: ['locate', 'attribution'] }
  await open(page, '&layout=' + encodeURIComponent(JSON.stringify(layout)))
  const bar = page.locator('[data-elm-status-bar]')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.maplibregl-ctrl-attrib.elm-attribution-bar')).toContainText(/MapLibre|OpenStreetMap|OpenMapTiles|OpenFreeMap|Mapterhorn/i)
})

test('data table (T) and GeoJSON inspector (I) open', async ({ page }) => {
  await open(page)
  await importGeoJSON(page, JSON.stringify(SQUARE))
  await page.keyboard.press('t')
  await expect(page.getByRole('grid').first()).toBeVisible()
  await page.keyboard.press('t')
  await page.keyboard.press('i')
  await expect(page.locator('.cm-editor').first()).toBeVisible()
})

test('defaultBasemap picks the starting basemap; a remembered pick wins over it', async ({ page }) => {
  // The page runs in the light theme, where the default ('auto') would be streets.
  await open(page, 'basemap=dark')
  await expect.poll(() => styleName(page)).toBe('Lab Dark')

  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect.poll(() => styleName(page)).toBe('Lab Light')
  await page.reload()
  await waitForMap(page)
  await expect.poll(() => styleName(page)).toBe('Lab Light')
})

test('custom basemaps: a style object and a raster { url } entry, keeping Element layers', async ({ page }) => {
  await open(page, 'basemaps=streets,style,raster')
  await importGeoJSON(page, JSON.stringify(SQUARE))
  const toggle = page.getByRole('button', { name: 'Basemap' })
  const panel = page.getByRole('group', { name: 'Basemap' })
  await toggle.click()
  await expect(panel.getByRole('button')).toHaveCount(3)
  const elmKept = () => page.evaluate(() => !!(window.__elementEditorTest!.map as MapLibreMap).getSource('elm-features'))

  await panel.getByRole('button', { name: 'Custom style', exact: true }).click()
  await expect.poll(() => styleName(page)).toBe('Custom style')
  await expect.poll(elmKept).toBe(true)

  await panel.getByRole('button', { name: 'Custom raster', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const s = (window.__elementEditorTest!.map as MapLibreMap).getStyle().sources.basemap as { type: string; tiles?: string[] } | undefined
    return s && `${s.type} ${s.tiles?.[0]}`
  })).toBe('raster https://raster.example.test/{z}/{x}/{y}.png')
  await expect.poll(elmKept).toBe(true)
  expect(await features(page)).toBe(1)
})

test('config.network.sprite: the built-in style loads its sprite from the given URL, not the CDN', async ({ page }) => {
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  await open(page)
  const origin = await page.evaluate(() => location.origin)
  expect(await page.evaluate(() => (window.__elementEditorTest!.map as MapLibreMap).getStyle().sprite)).toBe(origin + '/sprite')
  await expect.poll(() => urls.some((u) => u.startsWith(origin + '/sprite'))).toBe(true)
  expect(urls.filter((u) => u.includes('cdn.jsdelivr.net/npm/@element-editor/'))).toEqual([])
})
