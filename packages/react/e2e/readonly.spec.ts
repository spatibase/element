/**
 * readonly: no UI path changes the data. Viewing (selection, show / hide, zoom, details, export,
 * the inspector's text) still works. The map keys / ref API are covered in ref-api.spec.ts.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, importGeoJSON, mockNominatim, NOMINATIM_EIFFEL } from './helpers'

const DATA = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [
      { id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text' }] },
      { id: 'trees', name: 'Trees', fields: [{ key: 'name', label: 'Name', type: 'text' }] },
    ],
    groups: [{ id: 'g1', name: 'Park', collapsed: false }],
  },
  features: [
    { type: 'Feature', id: 'p1', schemaId: 'default', geometry: { type: 'Point', coordinates: [2.3522, 48.8566] }, properties: { name: 'Paris' } },
    { type: 'Feature', id: 'p2', schemaId: 'trees', groupId: 'g1', geometry: { type: 'Point', coordinates: [2.36, 48.86] }, properties: { name: 'Oak' } },
  ],
})

/** Store data that readonly must leave alone. */
const snapshot = (page: Page) => page.evaluate(() => {
  const s = window.__elementEditorTest!.dataStore.getState()
  return JSON.stringify({ f: s.features.map(({ id, geometry, properties, groupId, schemaId }) => ({ id, geometry, properties, groupId, schemaId })), g: s.groups.map((g) => g.name), s: s.schemas.map((x) => x.name), u: s.undoStack.length })
})

test.describe('readonly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?readonly=1')
    await waitForMap(page)
    await importGeoJSON(page, DATA)
    await expect(page.locator('aside').getByText('Paris')).toBeVisible()
  })

  test('data table: no cell editing, paste, row delete or Add new; schema tabs are not renamed', async ({ page }) => {
    const before = await snapshot(page)
    await page.locator(MAP).first().click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('t')
    const grid = page.locator('[role="grid"]')
    await grid.waitFor({ state: 'visible' })
    await expect(page.getByRole('button', { name: 'Add new' })).toHaveCount(0)
    await expect(grid.getByRole('button', { name: /delete/i })).toHaveCount(0)

    await grid.getByText('Paris', { exact: true }).dblclick()
    await expect(grid.locator('input:not([type="checkbox"]), select')).toHaveCount(0)
    await page.keyboard.type('Lutetia')
    await page.keyboard.press('Enter')
    // Paste into the selected cell.
    await grid.getByText('Paris', { exact: true }).click()
    await page.evaluate(() => {
      const d = new DataTransfer(); d.setData('text/plain', 'Pasted')
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true }))
    })
    // Checking a row offers no bulk delete.
    await grid.getByRole('checkbox').nth(1).check()
    await expect(page.getByRole('button', { name: /delete 1 selected/i })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Trees' }).dblclick()
    await expect(page.getByRole('tablist', { name: 'Filter by schema' }).locator('input')).toHaveCount(0)
    expect(await snapshot(page)).toBe(before)
  })

  test('layers panel: no rename, no editing menu items, rows are not draggable', async ({ page }) => {
    const before = await snapshot(page)
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.getByText('Paris', { exact: true }).dblclick()
    await expect(page.locator('aside input[type="text"]')).toHaveCount(0)

    await row.click({ button: 'right' })
    const menu = page.locator('[data-elm-context-menu]')
    await expect(menu.getByText('Zoom to feature')).toBeVisible()
    await expect(menu.getByText('Hide from map')).toBeVisible()
    for (const label of ['Duplicate', 'Delete', 'Group', 'Ungroup']) await expect(menu.getByText(label, { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    const groupName = page.locator('aside').getByText('Park', { exact: true })
    await groupName.dblclick()
    await expect(page.locator('aside input[type="text"]')).toHaveCount(0)
    await groupName.click({ button: 'right' })
    await expect(page.locator('[data-elm-context-menu]').getByText('Hide from map')).toBeVisible()
    for (const label of ['Rename', 'Ungroup', 'Delete group']) await expect(page.locator('[data-elm-context-menu]').getByText(label, { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Drag-reorder is off: dragging a row changes nothing.
    await row.hover()
    const box = (await row.boundingBox())!
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 8 })
    await page.mouse.up()
    expect(await snapshot(page)).toBe(before)
  })

  test('hiding a feature (view state) still works', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click({ button: 'right' })
    await page.locator('[data-elm-context-menu]').getByText('Hide from map').click()
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.find((f) => f.id === 'p1')!.hidden)).toBe(true)
  })

  test('undo / redo: buttons hidden, keys ignored', async ({ page }) => {
    // The host app edits through the ref (allowed in readonly) — the user can't undo it.
    await page.evaluate(() => window.__elementEditorRef!.addFeature({ type: 'Feature', id: 'host', geometry: { type: 'Point', coordinates: [2.3, 48.8] }, properties: {} } as never))
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Redo' })).toHaveCount(0)
    await page.locator(MAP).first().click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('ControlOrMeta+z')
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.some((f) => f.id === 'host'))).toBe(true)
  })

  test('schema editor shortcut, paste, inspector typing and search Add are refused', async ({ page }) => {
    const before = await snapshot(page)
    await page.locator(MAP).first().click({ position: { x: 10, y: 10 } })
    // Schema editor: no button, no shortcut.
    await expect(page.getByRole('button', { name: /schema/i })).toHaveCount(0)
    await page.keyboard.press('s')
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().schemaModalOpen)).toBe(false)

    // Cmd+V with GeoJSON on the clipboard.
    await page.evaluate(() => {
      const d = new DataTransfer()
      d.setData('text', JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} }))
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d }))
    })

    // GeoJSON inspector: read-only text.
    await page.keyboard.press('i')
    const content = page.locator('.cm-content')
    await expect(content).toContainText('Paris')
    const text = await content.textContent()
    await content.click()
    await page.keyboard.type('xyz')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(800) // past the inspector's commit delay
    expect(await content.textContent()).toBe(text)

    expect(await snapshot(page)).toBe(before)
  })

  test('search: Go only, no Add / Shape', async ({ page }) => {
    await mockNominatim(page, [NOMINATIM_EIFFEL])
    await page.getByPlaceholder(/search/i).fill('Eiffel Tower')
    await expect(page.getByRole('button', { name: 'Go' }).first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Shape' })).toHaveCount(0)
  })
})
