/**
 * Undo / Redo e2e tests — keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) and
 * toolbar buttons. Covers multi-step stacks and the undo-toast action.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON, featureCount } from './helpers'

/**
 * Draw + name a rectangle in the centre of the map.
 * Shapes are committed directly — no save panel opens. We rename via the edit button.
 */
async function drawAndSaveRect(page: Parameters<typeof importGeoJSON>[0], name: string) {
  await page.locator(MAP).click()
  const map = page.locator(MAP)
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // Offset so multiple rects don't overlap exactly
  const offset = Math.floor(Math.random() * 40) - 20
  const before = await featureCount(page)
  await page.keyboard.press('r')
  await page.mouse.move(cx - 90 + offset, cy - 45)
  await page.mouse.down()
  await page.mouse.move(cx + 90 + offset, cy + 45, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => featureCount(page)).toBe(before + 1)

  // Rename via the list row's edit button
  const row = page.locator('aside li').filter({ hasText: /^/ }).first()
  await row.hover()
  await row.getByRole('button', { name: /^edit$/i }).click()
  await page.locator('aside').locator('input[type="text"]').first().fill(name)
  await page.locator('aside').getByRole('button', { name: /save/i }).click()
  await expect(page.locator('aside li').filter({ hasText: name })).toBeVisible()
  // Press Escape to close panel
  await page.keyboard.press('Escape')
}

test('the initialData load is not an undo step: Cmd+Z right after load keeps the features', async ({ page }) => {
  await page.goto('/?data=sample')
  await waitForMap(page)
  await expect.poll(() => featureCount(page)).toBe(2)
  await page.locator(MAP).click()
  await page.keyboard.press('Meta+z')
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)).toBe(0)
  expect(await featureCount(page)).toBe(2)
})

test.describe('Undo/Redo — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('Ctrl+Z (or Cmd+Z) undoes the last operation and shows toast', async ({ page }) => {
    await drawAndSaveRect(page, 'Shape A')
    await page.keyboard.press('Meta+z')
    await expect(page.getByText(/undone/i)).toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'Shape A' })).not.toBeVisible()
  })

  test('Ctrl+Shift+Z (Cmd+Shift+Z) redoes an undone operation', async ({ page }) => {
    await drawAndSaveRect(page, 'Shape B')
    await page.keyboard.press('Meta+z')
    await expect(page.locator('aside li').filter({ hasText: 'Shape B' })).not.toBeVisible()

    await page.keyboard.press('Meta+Shift+z')
    await expect(page.getByText(/redone/i)).toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'Shape B' })).toBeVisible()
  })

  // Regression: real browsers emit `e.key === 'Z'` (uppercase) when Shift is
  // held, so a `e.key === 'z'` check would silently miss redo. Playwright's
  // `keyboard.press('Meta+Shift+z')` sends lowercase regardless and was
  // hiding the bug. This test dispatches a synthetic KeyboardEvent with the
  // uppercase key the real browser produces.
  test('redo handler accepts uppercase Z (real-browser Cmd+Shift+Z behaviour)', async ({ page }) => {
    await drawAndSaveRect(page, 'Shape Real')
    await page.keyboard.press('Meta+z')
    await expect(page.locator('aside li').filter({ hasText: 'Shape Real' })).not.toBeVisible()

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
      }))
    })
    await expect(page.locator('aside li').filter({ hasText: 'Shape Real' })).toBeVisible()
  })

  // Regression: Cmd+Z (and Cmd+Shift+Z) used to fire our store undo even when
  // a text input was focused, double-undoing alongside the browser's native
  // text-undo. Now skipped while in INPUT/TEXTAREA/etc.
  test('Cmd+Z does NOT trigger store undo while a text input is focused', async ({ page }) => {
    await drawAndSaveRect(page, 'Pre-input Shape')
    // Focus an input — easiest one is the search box in the floating toolbar.
    const search = page.getByPlaceholder(/search places/i)
    await search.click()

    const undoLength = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)
    const undoLengthBefore = await undoLength()
    // keydown handlers run synchronously inside press(), so the store has already reacted (or not).
    await page.keyboard.press('Meta+z')
    expect(await undoLength()).toBe(undoLengthBefore)
    await expect(page.locator('aside li').filter({ hasText: 'Pre-input Shape' })).toBeVisible()
  })

  test('multiple undo steps', async ({ page }) => {
    await drawAndSaveRect(page, 'First')
    await drawAndSaveRect(page, 'Second')

    // Each shape is two steps: draw, then the rename.
    await page.keyboard.press('Meta+z')
    await expect(page.locator('aside li').filter({ hasText: 'Second' })).not.toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'First' })).toBeVisible()
    await expect(page.locator('aside li')).toHaveCount(2)

    await page.keyboard.press('Meta+z')
    await expect(page.locator('aside li')).toHaveCount(1)

    await page.keyboard.press('Meta+z')
    await expect(page.locator('aside li').filter({ hasText: 'First' })).not.toBeVisible()
  })

  test('redo after multiple undos', async ({ page }) => {
    await drawAndSaveRect(page, 'Step1')
    await drawAndSaveRect(page, 'Step2')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')

    // Redo once
    await page.keyboard.press('Meta+Shift+z')
    await expect(page.locator('aside li').filter({ hasText: 'Step1' })).toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'Step2' })).not.toBeVisible()
  })
})

test.describe('Undo/Redo — toolbar buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('undo button in toolbar undoes last action', async ({ page }) => {
    await drawAndSaveRect(page, 'Toolbar Undo Shape')
    // Click away to deselect before interacting with toolbar
    await page.keyboard.press('Escape')

    const undoBtn = page.getByRole('button', { name: /^undo$/i }).first()
    await expect(undoBtn).toBeVisible()
    await undoBtn.click()
    await expect(page.locator('aside li').filter({ hasText: 'Toolbar Undo Shape' })).not.toBeVisible()
  })
})

test.describe('Delete + undo via Cmd+Z', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('Delete key removes selected feature', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click()
    await page.keyboard.press('Delete')
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).not.toBeVisible()
  })

  test('Cmd+Z restores a deleted feature', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click()
    await page.keyboard.press('Delete')

    // Feature should be gone — no toast on delete (would be obtrusive given
    // the disappearance is its own confirmation).
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).not.toBeVisible()

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).toBeVisible()
  })
})

test.describe('Feature data edits are undoable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('data table cell edit → Cmd+Z restores the old value', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('t')
    const grid = page.locator('[role="grid"]')
    await grid.waitFor({ state: 'visible' })
    await grid.getByText('Paris', { exact: true }).dblclick()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Lutetia')
    await page.keyboard.press('Enter')
    await expect(grid.getByText('Lutetia', { exact: true })).toBeVisible()

    await page.locator(MAP).click()
    await page.keyboard.press('Meta+z')
    await expect(grid.getByText('Paris', { exact: true })).toBeVisible()
    await expect(grid.getByText('Lutetia', { exact: true })).not.toBeVisible()
    await page.keyboard.press('Meta+Shift+z')
    await expect(grid.getByText('Lutetia', { exact: true })).toBeVisible()
  })

  test('side panel save → undo restores the name and the open form shows it', async ({ page }) => {
    const openEdit = async (name: string) => {
      const row = page.locator('aside li').filter({ hasText: name }).first()
      await row.hover()
      await row.getByRole('button', { name: /^edit$/i }).click()
    }
    await openEdit('Paris')
    const nameInput = page.locator('aside').locator('input[type="text"]').first()
    await nameInput.fill('Renamed Paris')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await expect(page.locator('aside li').filter({ hasText: 'Renamed Paris' })).toBeVisible()

    // Reopen the form, then undo while it is open (focus outside any input).
    await openEdit('Renamed Paris')
    await expect(nameInput).toHaveValue('Renamed Paris')
    await page.getByRole('button', { name: /^undo$/i }).first().click()
    await expect(nameInput).toHaveValue('Paris')
  })
})
