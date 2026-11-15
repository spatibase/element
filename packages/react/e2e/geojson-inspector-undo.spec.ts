/**
 * Undo in the GeoJSON inspector reverts only the user's typing: never the
 * store's fill (back to an empty document, which committed as "delete every
 * feature") nor a store patch (a map edit silently reverted through the text).
 */
import { test, expect } from './fixtures'
import { waitForMap, storeCaller } from './helpers'

test('undo in the GeoJSON inspector stops at the store\'s text', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  const ds = storeCaller(page)
  const names = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f) => f.properties.name as string))
  const features = Array.from({ length: 4 }, (_, i) => ({ type: 'Feature', id: `p${i}`, geometry: { type: 'Point', coordinates: [i * 0.1, 45] }, properties: { name: `Point ${i}` } }))
  await ds('importGeoJSON', { type: 'FeatureCollection', features }, 'replace')
  await page.getByRole('button', { name: /show geojson/i }).click()
  const dialog = page.locator('[aria-label="GeoJSON inspector"]')
  await expect(dialog).not.toHaveAttribute('data-loading')

  // The editor renders only its viewport (the schemas header comes first):
  // selecting p1 scrolls its code into view.
  const docText = () => page.evaluate(() => (document.querySelector('.cm-content') as any).cmTile.view.state.doc.toString() as string)
  await ds('selectFeature', 'p1')

  // Type into p1's name and let it commit.
  await dialog.locator('.cm-line.cm-feature-highlight', { hasText: '"name": "Point 1"' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft') // before the closing quote
  await page.keyboard.type('x')
  await expect.poll(names, { timeout: 3000 }).toEqual(['Point 0', 'Point 1x', 'Point 2', 'Point 3'])

  // A store edit (as a map edit would be) lands in the text.
  await ds('updateFeature', 'p3', { properties: { name: 'Store edit' } })
  await expect.poll(docText).toContain('"name": "Store edit"')

  // Undo well past the typing: it reverts only that.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ControlOrMeta+z')
  await page.waitForTimeout(600) // past the commit debounce
  expect(await names()).toEqual(['Point 0', 'Point 1', 'Point 2', 'Store edit'])
  expect(await docText()).toBe(await ds('exportGeoJSON'))
})
