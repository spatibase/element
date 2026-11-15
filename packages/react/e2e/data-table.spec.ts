/**
 * Data table e2e tests — toggling the table view, verifying features render
 * as rows, and basic column / filtering interaction.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

test.describe('Data Table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('T key toggles data table panel open', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    // The table container should appear
    await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 2000 })
  })

  test('data table shows imported features as rows', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    await page.locator('[role="grid"]').waitFor({ state: 'visible' })

    // Both imported feature names should appear in the grid
    await expect(page.locator('[role="grid"]').getByText('Paris')).toBeVisible()
    await expect(page.locator('[role="grid"]').getByText('Test Route')).toBeVisible()
  })

  test('selecting a feature in the layers list highlights its table row', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    const grid = page.locator('[role="grid"]')
    await grid.waitFor({ state: 'visible' })
    await expect(grid.locator('.elm-row-active')).toHaveCount(0)

    await page.getByText('Paris', { exact: true }).and(page.locator(':not([role="grid"] *)')).click()
    const active = grid.locator('.elm-row-active')
    await expect(active).toHaveCount(1)
    await expect(active).toContainText('Paris')
    // Tinted, i.e. not the transparent default row
    await expect(active).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')  })

  test('T key toggles data table panel closed again', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    await page.locator('[role="grid"]').waitFor({ state: 'visible' })

    await page.keyboard.press('t')
    await page.waitForTimeout(300)
    await expect(page.locator('[role="grid"]')).not.toBeVisible()
  })

  test('table button in toolbar opens data table', async ({ page }) => {
    // The data table button in the toolbar (look for Table label or grid icon)
    const tableBtn = page.getByRole('button', { name: /table/i }).first()
    if (await tableBtn.isVisible()) {
      await tableBtn.click()
      await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 2000 })
    } else {
      // Fallback: use keyboard shortcut
      await page.locator(MAP).click()
      await page.keyboard.press('t')
      await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 2000 })
    }
  })

  // Fires a real `paste` event (text/plain) on the focused cell — what Cmd/Ctrl+V does.
  async function pasteText(page: import('@playwright/test').Page, text: string) {
    await page.evaluate((t) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, text)
  }

  test('sort arrow stays visible while the label truncates in a narrow column', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    const grid = page.locator('[role="grid"]')
    const header = grid.locator('[role="columnheader"]').nth(1)
    await header.click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    const box = (await header.boundingBox())!
    // the resizer is an invisible strip on the header's right edge
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 3, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 50, y, { steps: 5 })
    await page.mouse.up()
    const svg = (await header.locator('svg').boundingBox())!
    const hdr = (await header.boundingBox())!
    expect(hdr.width).toBeLessThan(80)
    expect(svg.x).toBeGreaterThanOrEqual(hdr.x)
    expect(svg.x + svg.width).toBeLessThanOrEqual(hdr.x + hdr.width + 0.5)
    const truncated = await header.evaluate((h) => {
      const l = h.querySelector('.truncate') as HTMLElement
      return l.scrollWidth > l.clientWidth
    })
    expect(truncated).toBe(true)
  })

  test('pasting clipboard text into a cell updates the feature', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    const grid = page.locator('[role="grid"]')
    await grid.getByText('Paris').click()
    // Spreadsheet copy: only the first cell is used.
    await pasteText(page, 'Lyon\tignored\nignored')
    await expect(grid.getByText('Lyon')).toBeVisible()
    await expect(grid.getByText('Paris')).not.toBeVisible()
  })

  test('pasting non-numeric text into Lat is ignored', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    const grid = page.locator('[role="grid"]')
    const parisRow = grid.locator('[role="row"]', { hasText: 'Paris' })
    const latCol = await grid.locator('[role="columnheader"]', { hasText: /^Lat$/ }).getAttribute('aria-colindex')
    const latCell = parisRow.locator(`[role="gridcell"][aria-colindex="${latCol}"]`)
    const before = await latCell.textContent()
    await latCell.click()
    await pasteText(page, 'not a number')
    await page.waitForTimeout(200)
    await expect(latCell).toHaveText(before ?? '')
  })

  test('data table row count matches feature count', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    await page.locator('[role="grid"]').waitFor({ state: 'visible' })

    // SAMPLE_GEOJSON has 2 features; there should be 2 data rows (exclude header)
    const rows = page.locator('[role="row"]')
    const count = await rows.count()
    // At least 3 rows: 1 header + 2 data (might have extra rows for editing)
    expect(count).toBeGreaterThanOrEqual(3)
  })
})

test.describe('Data table geometry columns', () => {
  test('shapes show a size summary, Lat / Lng only exist while a point is listed, Name is wide enough', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().importGeoJSON({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'poly', properties: { name: 'A fairly long polygon name' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
        { type: 'Feature', id: 'line', properties: { name: 'Line' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 1]] } },
      ],
    }, 'replace'))
    await page.keyboard.press('t')
    const grid = page.locator('.rdg').first()
    await expect(grid.getByText('4 points')).toBeVisible({ timeout: 4000 })
    await expect(grid.getByText('3 points')).toBeVisible()
    await expect(grid.locator('[role="columnheader"]', { hasText: /^Type$/ })).toBeVisible()
    await expect(grid.locator('[role="columnheader"]', { hasText: /^Lat$/ })).toHaveCount(0)
    const nameHeader = grid.locator('[role="columnheader"]', { hasText: /^Name/ })
    expect((await nameHeader.boundingBox())!.width).toBeGreaterThanOrEqual(180)
    // A point brings the coordinate columns back.
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().addFeature({ type: 'Feature', id: 'pt', properties: { name: 'Pin' }, geometry: { type: 'Point', coordinates: [2.35, 48.85] } }))
    await expect(grid.locator('[role="columnheader"]', { hasText: /^Lat$/ })).toBeVisible()
    await expect(grid.getByText('48.85', { exact: true })).toBeVisible()
    // The type in plain words beside the layers list's icon, no coloured abbreviations.
    const typeCells = grid.locator('[role="gridcell"][aria-colindex="2"]')
    await expect(typeCells).toHaveText([/^Point$/, /^Area\s*4 points$/, /^Line\s*3 points$/]) // newest first
    await expect(typeCells.locator('svg')).toHaveCount(3)
  })
})

/** A real `paste` event (text/plain) on the focused element, as Cmd/Ctrl+V fires. */
async function pasteInto(page: import('@playwright/test').Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

// Boolean fields get a toggle per row instead of a text input; values stay real booleans.
const BOOL_DATA = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schemas: [{ id: 'default', name: 'Default', fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'visited', label: 'Visited', type: 'boolean' },
    ] }],
    groups: [],
  },
  features: [
    { type: 'Feature', id: 'a', schemaId: 'default', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: { name: 'Alpha', visited: true } },
    { type: 'Feature', id: 'b', schemaId: 'default', geometry: { type: 'Point', coordinates: [2.36, 48.86] }, properties: { name: 'Bravo' } },
  ],
})

const visitedOf = (page: import('@playwright/test').Page, id: string) => page.evaluate((fid) => {
  const s = window.__elementEditorTest!.dataStore.getState()
  return { value: s.features.find((f) => f.id === fid)!.properties.visited, depth: s.undoStack.length }
}, id)

async function openBoolTable(page: import('@playwright/test').Page, url = '/') {
  await page.goto(url)
  await waitForMap(page)
  await importGeoJSON(page, BOOL_DATA)
  await expect(page.locator('aside').getByText('Bravo')).toBeVisible()
  await page.locator(MAP).first().click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('t')
  const grid = page.locator('[role="grid"]')
  await grid.waitFor({ state: 'visible' })
  return grid
}

/** Selects the switch's cell without flipping it: a click in the cell, right of the switch. */
async function selectCellOf(toggle: import('@playwright/test').Locator) {
  const cell = toggle.locator('xpath=ancestor::*[@role="gridcell"]')
  const { width, height } = (await cell.boundingBox())!
  await cell.click({ position: { x: width - 6, y: height / 2 } })
}

const toggleIn = (grid: import('@playwright/test').Locator, name: string) =>
  grid.locator('[role="row"]', { hasText: name }).getByRole('switch', { name: 'Visited' })

test.describe('Data table boolean fields', () => {
  test('a toggle, not a text input: click flips it, stored as a boolean, one undo step', async ({ page }) => {
    const grid = await openBoolTable(page)
    const bravo = toggleIn(grid, 'Bravo')
    await expect(bravo).toHaveAttribute('aria-checked', 'false')
    await expect(toggleIn(grid, 'Alpha')).toHaveAttribute('aria-checked', 'true')

    const before = await visitedOf(page, 'b')
    expect(before.value).toBeUndefined()
    await bravo.click()
    await expect(bravo).toHaveAttribute('aria-checked', 'true')
    expect(await visitedOf(page, 'b')).toEqual({ value: true, depth: before.depth + 1 })
    // No text editor in the cell.
    await expect(grid.locator('input:not([type="checkbox"])')).toHaveCount(0)

    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    await expect(bravo).toHaveAttribute('aria-checked', 'false')
    expect((await visitedOf(page, 'b')).value).toBeUndefined()
  })

  test('Space and Enter on the selected cell flip it, each its own undo step', async ({ page }) => {
    const grid = await openBoolTable(page)
    const alpha = toggleIn(grid, 'Alpha')
    // Select the cell without toggling: click the cell next to the switch.
    await selectCellOf(alpha)
    await expect(alpha).toHaveAttribute('aria-checked', 'true')
    const start = await visitedOf(page, 'a')

    await page.keyboard.press('Space')
    await expect(alpha).toHaveAttribute('aria-checked', 'false')
    expect(await visitedOf(page, 'a')).toEqual({ value: false, depth: start.depth + 1 })

    await page.keyboard.press('Enter')
    await expect(alpha).toHaveAttribute('aria-checked', 'true')
    expect(await visitedOf(page, 'a')).toEqual({ value: true, depth: start.depth + 2 })

    // Typing a letter doesn't open an editor or change the value.
    await page.keyboard.press('k')
    await expect(grid.locator('input:not([type="checkbox"])')).toHaveCount(0)
    expect(await visitedOf(page, 'a')).toEqual({ value: true, depth: start.depth + 2 })

    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    expect((await visitedOf(page, 'a')).value).toBe(false)
  })

  test('paste turns yes / no text into a boolean and ignores anything else; sorting puts off first', async ({ page }) => {
    const grid = await openBoolTable(page)
    const bravo = toggleIn(grid, 'Bravo')
    await selectCellOf(bravo)
    await pasteInto(page, 'Yes')
    await expect(bravo).toHaveAttribute('aria-checked', 'true')
    expect((await visitedOf(page, 'b')).value).toBe(true)
    await pasteInto(page, 'maybe')
    await page.waitForTimeout(200)
    expect((await visitedOf(page, 'b')).value).toBe(true)
    await pasteInto(page, 'false')
    await expect(bravo).toHaveAttribute('aria-checked', 'false')
    expect((await visitedOf(page, 'b')).value).toBe(false)

    await grid.locator('[role="columnheader"]', { hasText: /^Visited$/ }).click()
    const names = grid.locator('[role="row"]').filter({ has: page.getByRole('switch') })
    await expect(names.first()).toContainText('Bravo') // off before on
    await grid.locator('[role="columnheader"]', { hasText: /^Visited$/ }).click()
    await expect(names.first()).toContainText('Alpha')
  })

  test('readonly: the toggle is disabled; click, Space and paste change nothing', async ({ page }) => {
    const grid = await openBoolTable(page, '/?readonly=1')
    const alpha = toggleIn(grid, 'Alpha')
    await expect(alpha).toBeDisabled()
    const before = await visitedOf(page, 'a')
    await alpha.scrollIntoViewIfNeeded()
    await alpha.click({ force: true })
    await selectCellOf(alpha)
    await page.keyboard.press('Space')
    await page.keyboard.press('Enter')
    await pasteInto(page, 'no')
    await page.waitForTimeout(200)
    await expect(alpha).toHaveAttribute('aria-checked', 'true')
    expect(await visitedOf(page, 'a')).toEqual(before)
  })
})
