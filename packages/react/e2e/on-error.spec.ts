/**
 * `onError` on the drop-in (both engines): each failure reaches it with the right code / source,
 * the built-in toast follows the return value (nothing → toast, false → no toast, string → that
 * text), and quiet failures (search box) reach onError only. Dev page `?onError=log|false|de`.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, flyTo, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

type Reported = { code: string; source: string; message: string }
const errors = (page: Page) => page.evaluate(() => ((window as unknown as { __elementErrors?: Reported[] }).__elementErrors ?? []))
const toast = (page: Page) => page.locator('[data-sonner-toast]')

async function open(page: Page, query: string) {
  await page.goto('/?' + query)
  await waitForMap(page)
  await page.locator(MAP).click()
}

async function pickAtCenter(page: Page) {
  await flyTo(page, [48.860, 2.340], 18)
  await page.keyboard.press('x')
  await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })
  const map = page.locator(MAP)
  const box = (await map.boundingBox())!
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } })
}

/** Cmd/Ctrl+O, then answer the file chooser with `body`. */
async function importFile(page: Page, name: string, body: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('ControlOrMeta+o')
  await (await chooser).setFiles({ name, mimeType: 'application/geo+json', buffer: Buffer.from(body) })
}

test.describe('onError', () => {
  test('Overpass 429: rate-limited / picker, and the toast still shows', async ({ page }) => {
    await page.route('**/overpass-api.de/**', (r) => r.fulfill({ status: 429, headers: { 'Retry-After': '60' }, body: '' }))
    await open(page, 'onError=log')
    await pickAtCenter(page)
    await expect(toast(page).filter({ hasText: 'Too many requests — wait a moment and try again' })).toBeVisible({ timeout: 5000 })
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'rate-limited', source: 'picker' }))
  })

  test('Overpass answering HTML: invalid-data, not a network error', async ({ page }) => {
    await page.route('**/overpass-api.de/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>maintenance</html>' }))
    await open(page, 'onError=log')
    await pickAtCenter(page)
    await expect(toast(page).filter({ hasText: /could not be read/ })).toBeVisible({ timeout: 5000 })
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'invalid-data', source: 'picker' }))
  })

  test('Overpass timeout: timeout / picker', async ({ page }) => {
    test.slow() // the per-request timeout is 15 s
    await page.route('**/overpass-api.de/**', () => { /* never answer */ })
    await open(page, 'onError=log')
    await pickAtCenter(page)
    await expect(toast(page).filter({ hasText: 'took too long' })).toBeVisible({ timeout: 25_000 })
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'timeout', source: 'picker' }))
  })

  test('returning false: onError gets it, no toast', async ({ page }) => {
    await page.route('**/overpass-api.de/**', (r) => r.fulfill({ status: 429, headers: { 'Retry-After': '60' }, body: '' }))
    await open(page, 'onError=false')
    await pickAtCenter(page)
    await expect.poll(() => errors(page)).toContainEqual(expect.objectContaining({ code: 'rate-limited' }))
    await page.waitForTimeout(300)
    await expect(toast(page).filter({ hasText: /Too many requests/ })).toHaveCount(0)
  })

  test('returning a string: maxFeatures refusal shows that text (limit-reached / editor)', async ({ page }) => {
    await open(page, 'onError=de&maxFeatures=0')
    await page.keyboard.press('g')
    await expect(toast(page).filter({ hasText: 'Maximale Anzahl erreicht' })).toBeVisible({ timeout: 3000 })
    await expect(toast(page).filter({ hasText: /Maximum of 0 features/ })).toHaveCount(0)
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'limit-reached', source: 'editor', message: 'Maximum of 0 features reached — delete some to add more.' }))
  })

  test('Cmd+O with an invalid file: invalid-data / import', async ({ page }) => {
    await open(page, 'onError=log')
    await importFile(page, 'broken.geojson', '{ "type": "FeatureCollection", ')
    await expect(toast(page).filter({ hasText: 'Import failed' })).toContainText('Not valid JSON')
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'invalid-data', source: 'import' }))
  })

  test('Cmd+O: features without a usable geometry are counted in a warning', async ({ page }) => {
    await open(page, 'onError=log')
    await importFile(page, 'mixed.geojson', JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'ok', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: {} },
        { type: 'Feature', id: 'nogeom', geometry: null, properties: {} },
      ],
    }))
    await expect(toast(page).filter({ hasText: 'Loaded mixed.geojson' })).toBeVisible()
    await expect(toast(page).filter({ hasText: 'Skipped 1 feature from mixed.geojson' })).toContainText('missing or unsupported geometry')
    expect(await errors(page)).toEqual([]) // a warning, not an error
  })

  test('search 429: the box says to wait, onError gets rate-limited / search quietly (no toast)', async ({ page }) => {
    await page.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({ status: 429, body: '' }))
    await open(page, 'onError=log')
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByText('Too many searches — wait a moment and try again.')).toBeVisible({ timeout: 3000 })
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'rate-limited', source: 'search' }))
    await expect(toast(page)).toHaveCount(0)
  })

  test('without onError nothing changes: refusals are warnings, errors still toast', async ({ page }) => {
    await open(page, '')
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().setMaxFeatures(1))
    await page.keyboard.press('g')
    await expect(toast(page).filter({ hasText: /Maximum of 1 features reached/ })).toBeVisible({ timeout: 3000 })
  })
})

test.describe('onError — MapLibre basemap', () => {
  test.skip(({ engine }) => engine !== 'maplibre', 'Leaflet has no style to load')
  test('a basemap style that fails to load: network / basemap, editor still works', async ({ page }) => {
    await page.route(/\/basemaps\/styles\/\w+\.json/, (r) => r.abort())
    await page.goto('/?onError=log')
    await waitForMap(page)
    await expect(page.getByText(/basemap could not be loaded/i)).toBeVisible()
    expect(await errors(page)).toContainEqual(expect.objectContaining({ code: 'network', source: 'basemap' }))
  })
})
