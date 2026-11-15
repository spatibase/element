/**
 * Invalid JSON in the GeoJSON inspector: a lint mark and a status line show
 * where, nothing reaches the store until it's fixed, and closing the inspector
 * (or docking / undocking it) keeps the unapplied text for the next open.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, storeCaller } from './helpers'

const INSPECTOR = '[aria-label="GeoJSON inspector"]'

async function setup(page: Page) {
  await page.goto('/')
  await waitForMap(page)
  const ds = storeCaller(page)
  const features = Array.from({ length: 4 }, (_, i) => ({ type: 'Feature', id: `p${i}`, geometry: { type: 'Point', coordinates: [i * 0.1, 45] }, properties: { name: `Point ${i}` } }))
  await ds('importGeoJSON', { type: 'FeatureCollection', features }, 'replace')
  return ds
}

const names = (page: Page) => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f) => f.properties.name as string))
const docText = (page: Page) => page.evaluate(() => (document.querySelector('.cm-content') as any).cmTile.view.state.doc.toString() as string)
const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1

async function openInspector(page: Page) {
  await page.getByRole('button', { name: /show geojson/i }).click()
  const inspector = page.locator(INSPECTOR)
  await expect(inspector).toBeVisible()
  await expect(inspector).not.toHaveAttribute('data-loading')
  return inspector
}

/** Puts the cursor at the end of a feature's name line (selecting it scrolls its code into view). */
async function clickNameEnd(page: Page, ds: ReturnType<typeof storeCaller>, id: string, name: string) {
  await ds('selectFeature', id)
  await page.locator(`${INSPECTOR} .cm-line.cm-feature-highlight`, { hasText: `"name": "${name}"` }).click()
  await page.keyboard.press('End')
}

const status = (page: Page) => page.locator(`${INSPECTOR} [role="status"]`)

test('invalid JSON is marked, applies nothing, and applies once fixed', async ({ page }) => {
  const ds = await setup(page)
  const inspector = await openInspector(page)

  // `"name": "Point 1"x` — a stray character after the value.
  await clickNameEnd(page, ds, 'p1', 'Point 1')
  await page.keyboard.type('x')
  const line = lineOf(await docText(page), '"Point 1"x')
  await expect(status(page)).toHaveText(`Invalid JSON at line ${line} — no changes apply until it's fixed`)
  await expect(inspector.locator('.cm-lintRange-error')).toHaveText('x')

  // A valid edit in another feature doesn't apply either while the text is invalid.
  await clickNameEnd(page, ds, 'p3', 'Point 3')
  await page.keyboard.press('ArrowLeft') // before the closing quote
  await page.keyboard.type('y')
  await page.waitForTimeout(600) // well past the commit debounce
  expect(await names(page)).toEqual(['Point 0', 'Point 1', 'Point 2', 'Point 3'])
  await expect(status(page)).toContainText(`line ${line}`)

  // The status line leads to the error; deleting it applies every edit at once.
  await status(page).getByRole('button').click()
  await page.keyboard.press('Delete')
  await expect.poll(() => names(page), { timeout: 3000 }).toEqual(['Point 0', 'Point 1', 'Point 2', 'Point 3y'])
  await expect(status(page)).toBeEmpty()
  await expect(inspector.locator('.cm-lintRange-error')).toHaveCount(0)
  expect(await docText(page)).toBe(await ds('exportGeoJSON'))
})

test('a feature that is valid JSON but not GeoJSON is marked as such', async ({ page }) => {
  const ds = await setup(page)
  await openInspector(page)
  await ds('selectFeature', 'p2')
  // `"type": "Point"` → `"type": "Poin"` inside p2's geometry.
  await page.locator(`${INSPECTOR} .cm-line.cm-feature-highlight`, { hasText: '"type": "Point"' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft') // before the trailing comma
  await page.keyboard.press('ArrowLeft') // before the closing quote
  await page.keyboard.press('Backspace')
  // The feature's opening `{`: the last one before its id.
  const lines = (await docText(page)).split('\n')
  const line = lines.slice(0, lineOf(lines.join('\n'), '"id": "p2"')).lastIndexOf('    {') + 1
  await expect(status(page)).toHaveText(`Invalid feature at line ${line} — no changes apply until it's fixed`)
  expect(await names(page)).toEqual(['Point 0', 'Point 1', 'Point 2', 'Point 3'])
  expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[2].geometry.type)).toBe('Point')
})

test('closing with invalid text keeps it for the next open, until the store makes it stale', async ({ page }) => {
  const ds = await setup(page)
  await openInspector(page)
  await clickNameEnd(page, ds, 'p1', 'Point 1')
  await page.keyboard.type('x')
  await expect(status(page)).toContainText('Invalid JSON')

  // Closed and reopened: the text is back, still marked.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator(INSPECTOR)).toHaveCount(0)
  expect(await names(page)).toEqual(['Point 0', 'Point 1', 'Point 2', 'Point 3'])
  await openInspector(page)
  expect(await docText(page)).toContain('"Point 1"x')
  await expect(status(page)).toContainText('Invalid JSON')
  await expect(page.locator(`${INSPECTOR} .cm-lintRange-error`)).toHaveCount(1)

  // Undocking remounts the inspector: the text survives that too.
  await page.getByRole('button', { name: /undock geojson inspector/i }).click()
  await expect(page.getByRole('dialog', { name: 'GeoJSON inspector' })).toBeVisible()
  expect(await docText(page)).toContain('"Point 1"x')
  await expect(status(page)).toContainText('Invalid JSON')

  // A store change elsewhere while closed lands around the kept text.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await ds('updateFeature', 'p3', { properties: { name: 'Store edit' } })
  await openInspector(page)
  const text = await docText(page)
  expect(text).toContain('"Point 1"x')
  expect(text).toContain('"name": "Store edit"')

  // A store change to the feature being typed into replaces the kept text.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await ds('updateFeature', 'p1', { properties: { name: 'Map edit' } })
  await openInspector(page)
  await expect.poll(() => docText(page)).toBe(await ds('exportGeoJSON'))
  await expect(status(page)).toBeEmpty()
  expect(await names(page)).toEqual(['Point 0', 'Map edit', 'Point 2', 'Store edit'])
})

test('valid typing right before closing still reaches the store', async ({ page }) => {
  const ds = await setup(page)
  await openInspector(page)
  await clickNameEnd(page, ds, 'p0', 'Point 0')
  await page.keyboard.press('ArrowLeft')
  // Close in the same task as the keystroke, inside the commit debounce.
  await page.evaluate(() => {
    const view = (document.querySelector('.cm-content') as any).cmTile.view
    const at = view.state.selection.main.head
    view.dispatch({ changes: { from: at, insert: 'z' }, userEvent: 'input.type' })
    window.__elementEditorTest!.uiStore.getState().toggleCodeModal()
  })
  await expect(page.locator(INSPECTOR)).toHaveCount(0)
  expect(await names(page)).toEqual(['Point 0z', 'Point 1', 'Point 2', 'Point 3'])
})
