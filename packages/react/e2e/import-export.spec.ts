import { test, expect } from './fixtures'
import { waitForMap, SAMPLE_GEOJSON, importGeoJSON } from './helpers'

/** Call a method on the demo app's exposed `window.__elementEditorRef`. */
async function callRef<T = unknown>(
  page: Parameters<typeof importGeoJSON>[0],
  invoke: string,
): Promise<T> {
  await page.waitForFunction(() => !!window.__elementEditorRef)
  return page.evaluate<T, string>((src) => {
    const fn = new Function('ref', `return ref.${src}`)
    const ref = window.__elementEditorRef!
    return fn(ref) as T
  }, invoke)
}

test.describe('ElementEditorRef — import/export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('ref.importGeoJSON loads features and returns an ImportResult', async ({ page }) => {
    const escaped = SAMPLE_GEOJSON.replace(/`/g, '\\`')
    const result = await callRef<{ skipped: number; duplicates: number; truncated: boolean }>(
      page,
      `importGeoJSON(JSON.parse(\`${escaped}\`))`,
    )
    expect(result).toMatchObject({ skipped: 0, duplicates: 0, truncated: false })
    await expect(page.getByText('Paris')).toBeVisible()
    await expect(page.getByText('Test Route')).toBeVisible()
  })

  test('ref.importGeoJSON with mode="merge" appends without removing existing features', async ({ page }) => {
    const first = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Point One' } }],
    })
    const second = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'p2', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'Point Two' } }],
    })

    await callRef(page, `importGeoJSON(${first})`)
    await expect(page.getByText('Point One')).toBeVisible()

    await callRef(page, `importGeoJSON(${second}, 'merge')`)
    await expect(page.getByText('Point One')).toBeVisible()
    await expect(page.getByText('Point Two')).toBeVisible()
  })

  test('ref.importGeoJSON defaults to replace mode', async ({ page }) => {
    const first = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Old Feature' } }],
    })
    const second = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'p2', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'New Feature' } }],
    })

    await callRef(page, `importGeoJSON(${first})`)
    await expect(page.getByText('Old Feature')).toBeVisible()

    await callRef(page, `importGeoJSON(${second})`)
    await expect(page.getByText('New Feature')).toBeVisible()
    await expect(page.getByText('Old Feature')).not.toBeVisible()
  })

  test('ref.importGeoJSON throws on non-FeatureCollection input', async ({ page }) => {
    await page.waitForFunction(() => !!window.__elementEditorRef)
    const err = await page.evaluate(() => {
      try {
        const ref = window.__elementEditorRef!
        ref.importGeoJSON({ type: 'Feature', geometry: null, properties: {} })
        return null
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(err).toMatch(/FeatureCollection/i)
  })

  test('ref.exportGeoJSON returns a parseable string round-trip', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const text = await callRef<string>(page, 'exportGeoJSON()')
    expect(typeof text).toBe('string')
    const parsed = JSON.parse(text)
    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toHaveLength(2)
    const names = parsed.features.map((f: { properties: { name: string } }) => f.properties.name)
    expect(names).toContain('Paris')
    expect(names).toContain('Test Route')
  })

  test('ref.exportAs("geojson") triggers a features.geojson download', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => {
        const ref = window.__elementEditorRef!
        ref.exportAs('geojson')
      }),
    ])
    expect(download.suggestedFilename()).toBe('features.geojson')
  })
})

test.describe('Replace import is one undo step (no file backup)', () => {
  test('Cmd+O replaces the features; one Cmd+Z restores the previous ones, Cmd+Shift+Z re-applies', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
    const names = () => page.evaluate(() =>
      window.__elementEditorTest!.dataStore.getState().features.map((f) => String(f.properties.name)).sort())

    await page.locator('body').click()
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('ControlOrMeta+o')
    await (await chooser).setFiles({
      name: 'other.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'Imported' } }],
      })),
    })
    await expect.poll(names).toEqual(['Imported'])

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(names).toEqual(['Paris', 'Test Route'])
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(names).toEqual(['Imported'])
  })
})

test.describe('GeoJSON modal — paste / copy / download', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  async function openGeoJSONModal(page: Parameters<typeof importGeoJSON>[0]) {
    await page.getByRole('button', { name: /show geojson/i }).click()
    await expect(page.locator('[aria-label="GeoJSON inspector"]')).toBeVisible()
  }

  test('modal Download button triggers a features.geojson download', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await openGeoJSONModal(page)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /download geojson/i }).click(),
    ])
    expect(download.suggestedFilename()).toBe('features.geojson')
  })

  test('modal Copy button writes current GeoJSON to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await openGeoJSONModal(page)

    await page.getByRole('button', { name: /^copy$/i }).click()
    await expect(page.getByRole('button', { name: /copied/i })).toBeVisible()

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    const parsed = JSON.parse(clipboard)
    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toHaveLength(2)
  })
})
