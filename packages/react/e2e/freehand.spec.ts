/**
 * Freehand drawing e2e tests — draw shapes by clicking and dragging.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, editingMode, featureCount, selectedIds } from './helpers'

test.describe('Freehand drawing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('F activates freehand mode', async ({ page }) => {
    await page.keyboard.press('f')
    await expect(page.getByText(/click and drag/i)).toBeVisible({ timeout: 3000 })
  })

  test('the open/closed toggle is a plain-language pressed button', async ({ page }) => {
    await page.keyboard.press('f')
    const toggle = page.getByRole('button', { name: 'Closed shape', exact: true })
    const pressed = await toggle.getAttribute('aria-pressed')
    expect(pressed === 'true' || pressed === 'false').toBe(true)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true')
  })

  test('freehand drawing adds a feature after mouse release', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('f')
    await expect.poll(() => editingMode(page)).toBe('draw-freehand')

    // Draw a freehand shape
    await page.mouse.move(cx - 60, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 60, cy - 40, { steps: 10 })
    await page.mouse.move(cx + 60, cy + 40, { steps: 10 })
    await page.mouse.move(cx - 60, cy + 40, { steps: 10 })
    await page.mouse.move(cx - 60, cy - 40, { steps: 10 })
    await page.mouse.up()

    // Feature should be added to the list
    await expect(page.locator('aside li')).not.toHaveCount(0)
  })

  test('freehand shape stays selected after release (consistent with other tools)', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('f')
    await expect.poll(() => editingMode(page)).toBe('draw-freehand')

    await page.mouse.move(cx - 60, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 60, cy - 40, { steps: 10 })
    await page.mouse.move(cx + 60, cy + 40, { steps: 10 })
    await page.mouse.move(cx - 60, cy + 40, { steps: 10 })
    await page.mouse.move(cx - 60, cy - 40, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => featureCount(page)).toBe(1)
    // The trailing click (fired with the mouseup) must not have cleared the new selection.
    expect(await selectedIds(page)).toHaveLength(1)
  })

  test('Escape cancels freehand mode', async ({ page }) => {
    await page.keyboard.press('f')
    await expect(page.getByText(/click and drag/i)).toBeVisible({ timeout: 3000 })
    await page.keyboard.press('Escape')
    await expect(page.getByText(/click and drag/i)).not.toBeVisible()
  })
})
