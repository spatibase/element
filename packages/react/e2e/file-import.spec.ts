/**
 * User file import: dropping a .geojson file on the map and Cmd+O behave the same — replace the
 * data in ONE undo step, fit the map to it, honour maxFeatures, refused in readonly.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

// Far from the dev page's start view (Prague / Europe), so fitting is observable.
const SYDNEY = {
  type: 'FeatureCollection',
  features: [1, 2, 3].map((i) => ({
    type: 'Feature', id: `syd-${i}`, properties: { name: `Sydney ${i}` },
    geometry: { type: 'Point', coordinates: [151.2 + i * 0.01, -33.86] },
  })),
}

async function dragFile(page: Page, json: object, name = 'sydney.geojson') {
  const dt = await page.evaluateHandle(([text, n]) => {
    const d = new DataTransfer()
    d.items.add(new File([text], n, { type: 'application/geo+json' }))
    return d
  }, [JSON.stringify(json), name] as const)
  const map = page.locator(MAP).first()
  await map.dispatchEvent('dragenter', { dataTransfer: dt })
  await map.dispatchEvent('dragover', { dataTransfer: dt })
  return { dt, map }
}

const state = (page: Page) => page.evaluate(() => {
  const s = window.__elementEditorTest!.dataStore.getState()
  return { ids: s.features.map((f) => f.id).sort(), depth: s.undoStack.length }
})

/** Map center as [lng, lat] on either engine. */
const center = (page: Page) => page.evaluate(() => {
  const c = window.__elementEditorTest!.map.getCenter()
  return [c.lng, c.lat]
})

test.describe('Importing a GeoJSON file', () => {
  test('drop on the map: overlay, replace in one undo step, fit to the data', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const before = await state(page)

    const { dt, map } = await dragFile(page, SYDNEY)
    await expect(page.locator('[data-elm-file-drop]')).toBeVisible()
    await expect(page.locator('[data-elm-file-drop]')).toContainText('Drop GeoJSON to import')
    await map.dispatchEvent('drop', { dataTransfer: dt })
    await expect(page.locator('[data-elm-file-drop]')).toHaveCount(0)

    await expect.poll(async () => (await state(page)).ids).toEqual(['syd-1', 'syd-2', 'syd-3'])
    expect((await state(page)).depth).toBe(before.depth + 1)
    // Fitted: the map flies to Sydney.
    await expect.poll(async () => (await center(page))[0], { timeout: 5000 }).toBeGreaterThan(150)
    await expect(page.getByText('Loaded sydney.geojson')).toBeVisible()

    // One undo restores the previous data.
    await page.locator(MAP).first().hover()
    await page.keyboard.press('ControlOrMeta+z')
    expect((await state(page)).ids).toEqual(before.ids)
  })

  test('Cmd+O imports the same way: replace, one undo step, fit', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const before = await state(page)
    await page.locator(MAP).first().click({ position: { x: 10, y: 10 } })
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('ControlOrMeta+o')
    await (await chooser).setFiles({ name: 'sydney.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(SYDNEY)) })
    await expect.poll(async () => (await state(page)).ids).toEqual(['syd-1', 'syd-2', 'syd-3'])
    expect((await state(page)).depth).toBe(before.depth + 1)
    await expect.poll(async () => (await center(page))[0], { timeout: 5000 }).toBeGreaterThan(150)
  })

  test('a dropped file over maxFeatures is truncated and reported', async ({ page }) => {
    await page.goto('/?maxFeatures=2')
    await waitForMap(page)
    const { dt, map } = await dragFile(page, SYDNEY)
    await map.dispatchEvent('drop', { dataTransfer: dt })
    await expect.poll(async () => (await state(page)).ids.length).toBe(2)
    await expect(page.getByText(/Imported 2 of 3 features/)).toBeVisible()
  })

  test('a non-GeoJSON file is refused with a message', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const before = await state(page)
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
      return d
    })
    await page.locator(MAP).first().dispatchEvent('drop', { dataTransfer: dt })
    await expect(page.getByText('notes.txt is not a .geojson or .json file')).toBeVisible()
    expect(await state(page)).toEqual(before)
  })

  // The drop-in handles a drop anywhere on it, status bar included, and the drop never bubbles to
  // a host drop zone around it (apps/demo used to wrap the editor in one: two import paths).
  test('a drop on the status bar imports once and never reaches a host drop zone', async ({ page }) => {
    await page.goto('/?layout=' + encodeURIComponent(JSON.stringify({ topCenter: ['toolbar'], statusRight: ['zoomIndicator'] })))
    await waitForMap(page)
    await page.evaluate(() => {
      const w = window as unknown as { hostDrops: number }
      w.hostDrops = 0
      document.addEventListener('drop', () => { w.hostDrops++ })
    })
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer()
      d.items.add(new File([text], 'sydney.geojson', { type: 'application/geo+json' }))
      return d
    }, JSON.stringify(SYDNEY))
    const bar = page.locator('[data-elm-status-bar]')
    await expect(bar).toBeVisible()
    await bar.dispatchEvent('dragenter', { dataTransfer: dt })
    await bar.dispatchEvent('dragover', { dataTransfer: dt })
    await expect(page.locator('[data-elm-file-drop]')).toBeVisible()
    await bar.dispatchEvent('drop', { dataTransfer: dt })
    await expect.poll(async () => (await state(page)).ids).toEqual(['syd-1', 'syd-2', 'syd-3'])
    await expect(page.getByText('Loaded sydney.geojson')).toHaveCount(1)
    expect(await page.evaluate(() => (window as unknown as { hostDrops: number }).hostDrops)).toBe(0)
  })

  test('readonly: no drop overlay, the drop changes nothing', async ({ page }) => {
    await page.goto('/?readonly=1')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const before = await state(page)
    const { dt, map } = await dragFile(page, SYDNEY)
    await expect(page.locator('[data-elm-file-drop]')).toHaveCount(0)
    await map.dispatchEvent('drop', { dataTransfer: dt })
    await page.waitForTimeout(300)
    expect(await state(page)).toEqual(before)
  })
})
