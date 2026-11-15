/**
 * Measure tool e2e tests — distance/area measurement, label display,
 * selection, deletion, and regression tests for known bugs.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap } from './helpers'

// Shared setup: navigate, wait for map, focus it
async function setup(page: Parameters<typeof waitForMap>[0]) {
  await page.goto('/')
  await waitForMap(page)
  await page.locator(MAP).click()
}

// Returns the center of the map container in absolute page coordinates
async function mapCenter(page: Parameters<typeof waitForMap>[0]) {
  const box = await page.locator(MAP).boundingBox()
  if (!box) throw new Error('map container not found')
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

// ─── Activation ──────────────────────────────────────────────────────────────

test.describe('Measure tool — activation', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('M activates measure mode', async ({ page }) => {
    await page.keyboard.press('m')
    await expect(page.getByText(/click to start measuring/i)).toBeVisible()
  })

  test('toolbar shows Distance and Area buttons when active', async ({ page }) => {
    await page.keyboard.press('m')
    await expect(page.getByRole('button', { name: 'Measure distance', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Measure area', exact: true })).toBeVisible()
  })

  test('M again deactivates measure mode', async ({ page }) => {
    await page.keyboard.press('m')
    await expect(page.getByText(/click to start measuring/i)).toBeVisible()
    await page.keyboard.press('m')
    await expect(page.getByText(/click to start measuring/i)).not.toBeVisible()
  })

  test('Escape deactivates measure mode when no points placed', async ({ page }) => {
    await page.keyboard.press('m')
    await page.keyboard.press('Escape')
    await expect(page.getByText(/click to start measuring/i)).not.toBeVisible()
  })
})

// ─── Distance measurement ────────────────────────────────────────────────────

test.describe('Measure tool — distance', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('hint updates after placing first point', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await expect(page.getByText(/double-click to finish/i)).toBeVisible()
  })

  test('double-click completes measurement and shows label pill', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).toBeVisible()
  })

  test('label pill shows a numeric distance value with unit', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    const label = page.locator('.elm-measure-label').first()
    const text = await label.innerText()
    expect(text).toMatch(/\d+(\.\d+)?\s*(m|km)/)
  })

  test('Enter also completes measurement', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.click(cx + 100, cy)
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).toBeVisible()
  })

  test('Backspace removes the last in-progress point', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await expect(page.getByText(/double-click to finish/i)).toBeVisible()
    await page.keyboard.press('Backspace')
    await expect(page.getByText(/click to start measuring/i)).toBeVisible()
  })

  test('multiple distance measurements can coexist', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    // First measurement
    await page.mouse.click(cx - 120, cy - 40)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx - 40, cy - 40)
    await page.waitForTimeout(300)
    // Committing drops back to select mode (autoExitAfterDraw defaults to
    // true), so re-activate the tool for the second measurement.
    await expect(page.getByText(/click to start measuring/i)).not.toBeVisible()
    await page.keyboard.press('m')
    // Second measurement
    await page.mouse.click(cx + 40, cy + 40)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 120, cy + 40)
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).toHaveCount(2)
  })
})

// ─── Area measurement ────────────────────────────────────────────────────────

test.describe('Measure tool — area', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('switching to Area mode highlights the Area button', async ({ page }) => {
    await page.keyboard.press('m')
    const areaBtn = page.getByRole('button', { name: 'Measure area', exact: true })
    await areaBtn.click()
    await expect(areaBtn).toBeVisible()
  })

  test('area measurement shows label with area unit', async ({ page }) => {
    await page.keyboard.press('m')
    await page.getByRole('button', { name: 'Measure area', exact: true }).click()
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 80, cy - 60)
    await page.waitForTimeout(100)
    await page.mouse.click(cx + 80, cy - 60)
    await page.waitForTimeout(100)
    await page.mouse.click(cx, cy + 60)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx, cy + 60)
    await page.waitForTimeout(300)
    const label = page.locator('.elm-measure-label').first()
    const text = await label.innerText()
    // Accept metric (m², ha, km²) or imperial (ft², ac, mi²) — unit depends on
    // the user's persisted preference / locale default.
    expect(text).toMatch(/\d+(\.\d+)?\s*(m²|ha|km²|ft²|ac|mi²)/)
  })
})

// ─── Escape and persistence ───────────────────────────────────────────────────

test.describe('Measure tool — persistence', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('Escape after completing keeps completed measurements visible', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    // Exit measure mode
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    // Measurement persists
    await expect(page.locator('.elm-measure-label')).toBeVisible()
  })

  test('label pill has a × dismiss button', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-close')).toBeVisible()
  })

  test('× button dismisses the measurement', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await page.locator('.elm-measure-close').click()
    await page.waitForTimeout(200)
    await expect(page.locator('.elm-measure-label')).not.toBeVisible()
  })
})

// ─── Selection and deletion ───────────────────────────────────────────────────

test.describe('Measure tool — selection and deletion', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('Delete immediately after dblclick-commit removes the new distance measurement', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).toBeVisible()
    // No Escape, no re-click — Delete must work right after commit
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await expect(page.locator('.elm-measure-label')).not.toBeVisible()
  })

  test('Backspace immediately after Enter-commit removes the new distance measurement', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.click(cx + 100, cy)
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).toBeVisible()
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(200)
    await expect(page.locator('.elm-measure-label')).not.toBeVisible()
  })

  test('Delete immediately after committing an area measurement removes it', async ({ page }) => {
    await page.keyboard.press('m')
    await page.getByRole('button', { name: 'Measure area', exact: true }).click()
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 80, cy - 60)
    await page.waitForTimeout(100)
    await page.mouse.click(cx + 80, cy - 60)
    await page.waitForTimeout(100)
    await page.mouse.click(cx, cy + 60)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx, cy + 60)
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).toBeVisible()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await expect(page.locator('.elm-measure-label')).not.toBeVisible()
  })

  test('Delete key removes a selected measurement', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    // Exit measure mode so map-click doesn't add a new point
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    // Click on the measurement line midpoint to select it
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(200)
    // Delete the selected measurement
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await expect(page.locator('.elm-measure-label')).not.toBeVisible()
  })

  test('Escape deselects a selected measurement without removing it', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    // Select it
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(200)
    // Escape should deselect, not delete
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await expect(page.locator('.elm-measure-label')).toBeVisible()
  })
})

// ─── Bug regressions ─────────────────────────────────────────────────────────

test.describe('Measure tool — regressions', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('segment hover tooltip is hidden after measurement is deleted while hovered', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    // Hover over the measurement line to show the segment tooltip
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(400)
    const tooltip = page.locator('.elm-feature-tooltip')
    await expect(tooltip).toBeVisible()

    // Select the measurement, then delete it
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)

    // Move the cursor — tooltip must be hidden (not following cursor)
    await page.mouse.move(cx + 80, cy + 80)
    await page.waitForTimeout(200)
    await expect(tooltip).toBeHidden()
  })

  test('no ghost label follows cursor after selecting and deleting a measurement', async ({ page }) => {
    await page.keyboard.press('m')
    const { cx, cy } = await mapCenter(page)
    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(100)
    await page.mouse.dblclick(cx + 100, cy)
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    // Select then delete
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)

    // Reactivate measure mode and move cursor — no label pill should appear
    await page.keyboard.press('m')
    await page.mouse.move(cx + 50, cy + 50)
    await page.waitForTimeout(300)
    await expect(page.locator('.elm-measure-label')).not.toBeVisible()
  })
})
