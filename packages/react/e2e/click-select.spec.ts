import { test, expect, MAP } from './fixtures'
import { waitForMap, featureCenter, selectedIds } from './helpers'

/**
 * Draw a rectangle and optionally rename it.
 * Shapes are committed directly (no save panel opens after drawing).
 */
async function drawRect(
  page: Parameters<typeof waitForMap>[0],
  cx: number,
  cy: number,
  offsetX: number,
  offsetY: number,
  name?: string,
) {
  await page.keyboard.press('r')
  await page.mouse.move(cx - offsetX, cy - offsetY)
  await page.mouse.down()
  await page.mouse.move(cx + offsetX, cy + offsetY, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  // Exit tool so subsequent map clicks select rather than draw
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  if (name) {
    // Rename via the list row
    const row = page.locator('aside li').filter({ hasText: /^/ }).first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()
    const nameInput = page.locator('aside').locator('input[type="text"]').first()
    await nameInput.fill(name)
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
}

test('click polygon on map selects it and highlights row in sidebar', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.waitForTimeout(500)
  await page.locator(MAP).click()

  const map = page.locator(MAP)
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  await drawRect(page, cx, cy, 100, 50, 'TestRect')

  // Ensure nothing selected
  await page.mouse.click(cx, cy + 200)
  await page.waitForTimeout(300)

  expect(await selectedIds(page)).toEqual([])

  // Click the polygon on the map (unselected features are drawn on the canvas)
  const rect = await featureCenter(page, 'TestRect')
  await page.mouse.click(rect.x, rect.y)
  await page.waitForTimeout(500)
  expect(await selectedIds(page)).toEqual([rect.id])

  // Feature should be selected — its row should be visible and highlighted
  await expect(page.locator('aside li').filter({ hasText: 'TestRect' })).toBeVisible()
})

test('clicking polygon then clicking edit button opens the detail panel', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.waitForTimeout(500)
  await page.locator(MAP).click()

  const map = page.locator(MAP)
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  await drawRect(page, cx, cy, 100, 50, 'ClickEdit')

  // Click polygon on map to select it
  const rect = await featureCenter(page, 'ClickEdit')
  await page.mouse.click(rect.x, rect.y)
  await page.waitForTimeout(500)
  expect(await selectedIds(page)).toEqual([rect.id])

  // Now open edit panel via sidebar row's edit button
  const row = page.locator('aside li').filter({ hasText: 'ClickEdit' }).first()
  await row.hover()
  await row.getByRole('button', { name: /^edit$/i }).click()
  await expect(page.getByLabel('Back to layers')).toBeVisible({ timeout: 3000 })
})

test.describe('feature context menu', () => {
  test('right-click opens menu and selects the feature', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.waitForTimeout(500)
    await page.locator(MAP).click()

    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await drawRect(page, cx, cy, 100, 50, 'CtxRect')

    // Right-click on the polygon
    const rect = await featureCenter(page, 'CtxRect')
    await page.mouse.click(rect.x, rect.y, { button: 'right' })
    await page.waitForTimeout(300)

    // Menu marker is present and has the expected action labels
    const menu = page.locator('[data-elm-context-menu]')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('Transform')
    await expect(menu).toContainText('Cut hole')
    await expect(menu).toContainText('Delete')

    // Clicked feature is selected
    expect(await selectedIds(page)).toEqual([rect.id])
  })

  test('first ESC closes menu and preserves selection; second ESC deselects', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.waitForTimeout(500)
    await page.locator(MAP).click()

    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await drawRect(page, cx, cy, 100, 50, 'EscRect')

    const { x: px, y: py } = await featureCenter(page, 'EscRect')

    await page.mouse.click(px, py, { button: 'right' })
    await page.waitForTimeout(300)
    await expect(page.locator('[data-elm-context-menu]')).toBeVisible()
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(1)

    // First ESC: closes menu, keeps selection.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await expect(page.locator('[data-elm-context-menu]')).toHaveCount(0)
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(1)

    // Second ESC: falls through to normal deselect.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(0)
  })
})

test('shift+click polygons multi-selects them', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.waitForTimeout(500)
  await page.locator(MAP).click()

  const map = page.locator(MAP)
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // Create first rectangle (left side)
  await drawRect(page, cx - 130, cy - 45, 70, 35, 'Rect1')
  // Create second rectangle (right side)
  await drawRect(page, cx + 130, cy - 45, 70, 35, 'Rect2')

  // Start from an empty selection
  await page.mouse.click(cx, cy + 200)
  await page.waitForTimeout(300)
  expect(await selectedIds(page)).toEqual([])
  const p1 = await featureCenter(page, 'Rect1')
  const p2 = await featureCenter(page, 'Rect2')

  // Shift+click first polygon
  await page.keyboard.down('Shift')
  await page.mouse.click(p1.x, p1.y)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(300)
  expect(await selectedIds(page)).toEqual([p1.id])

  // Shift+click should not open the detail panel (multi-select mode)
  await expect(page.getByLabel('Back to layers')).not.toBeVisible()

  // Shift+click second polygon
  await page.keyboard.down('Shift')
  await page.mouse.click(p2.x, p2.y)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(300)
  expect((await selectedIds(page)).sort()).toEqual([p1.id, p2.id].sort())

  // Still no detail panel
  await expect(page.getByLabel('Back to layers')).not.toBeVisible()
})
