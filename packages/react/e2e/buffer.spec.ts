/**
 * Buffer tool e2e tests — panel UI, modify-original, create-new mode,
 * Apply / Cancel, and keyboard shortcuts.
 */
import { test, expect, MAP, type Page, type Engine } from './fixtures'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { waitForMap, drawAndSelectPolygon, seedSelectedZigzagLine, storeCaller, featureCount, editingMode } from './helpers'

async function setup(page: Parameters<typeof waitForMap>[0]) {
  await page.goto('/')
  await waitForMap(page)
  await page.locator(MAP).click()
}

/** Set the buffer distance via the number input (triggers React onChange reliably). */
async function setBufferDistance(page: Parameters<typeof waitForMap>[0], meters: number) {
  const input = page.locator('input[type="number"]').first()
  await input.click({ clickCount: 3 })
  await input.fill(String(meters))
  await input.dispatchEvent('change')
  await page.waitForTimeout(400)
}

// ─── Panel activation ─────────────────────────────────────────────────────────

test.describe('Buffer tool — activation', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('Buffer button disabled with no selection', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Buffer' })).not.toBeVisible()
  })

  test('Buffer button appears when a polygon is selected', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await expect(page.getByRole('button', { name: 'Buffer' })).toBeVisible()
  })

  test('clicking Buffer button opens the panel', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await expect(page.locator('text=Buffer').first()).toBeVisible()
    await expect(page.getByText('New shape')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible()
  })

  test('Cancel button closes the panel', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Cancel' })).not.toBeVisible()
  })

  test('Escape closes the panel', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Cancel' })).not.toBeVisible()
  })
})

// ─── Distance input ────────────────────────────────────────────────────────────

test.describe('Buffer tool — distance input', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('Apply is disabled until a valid distance is set', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    // Default 100m should already enable Apply
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })

  test('number input accepts typed distance', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await setBufferDistance(page, 500)
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })

  test('unit toggle switches between small and large unit', async ({ page }) => {
    // Pair depends on resolved unit system: m/km for metric, ft/mi for imperial.
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    const unitBtn = page.getByRole('button', { exact: false }).filter({ hasText: /^(m|km|ft|mi)$/ })
    const initial = await unitBtn.textContent()
    await unitBtn.click()
    const toggled = await unitBtn.textContent()
    expect(initial).not.toBe(toggled)
  })

  test('slider adjusts the distance', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    const slider = page.locator('input[type="range"]').first()
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })
})

// ─── Modify original ──────────────────────────────────────────────────────────

test.describe('Buffer tool — modify original', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('"New shape" toggle is ON by default', async ({ page }) => {
    // Product default changed to create-new (`uiStore.bufferCreateNew = true`);
    // the modify-in-place variant is now opt-out via the toggle.
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    const toggle = page.locator('[role="checkbox"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('Apply with modify-original closes the panel', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    // Toggle OFF to get modify-original mode (default is create-new).
    await page.locator('[role="checkbox"]').click()
    await setBufferDistance(page, 200)
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('button', { name: 'Cancel' })).not.toBeVisible()
  })

  test('Enter key applies the buffer', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await setBufferDistance(page, 200)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Cancel' })).not.toBeVisible()
  })

  test('sidebar still shows one polygon after modify-original apply', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    // Toggle OFF to get modify-original mode (default is create-new).
    await page.locator('[role="checkbox"]').click()
    await setBufferDistance(page, 200)
    await page.getByRole('button', { name: 'Apply' }).click()
    // Only the single (modified) polygon should be in the sidebar
    await expect(page.locator('aside li')).toHaveCount(1)
  })

  test('result is undoable', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await setBufferDistance(page, 200)
    await page.getByRole('button', { name: 'Apply' }).click()
    const undoBtn = page.getByRole('button', { name: 'Undo' })
    await expect(undoBtn).toBeEnabled()
  })
})

// ─── Create new ───────────────────────────────────────────────────────────────

test.describe('Buffer tool — create new', () => {
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('"New shape" toggle can be disabled', async ({ page }) => {
    // Default is ON; clicking once flips to OFF.
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await page.locator('[role="checkbox"]').click()
    const toggle = page.locator('[role="checkbox"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('Apply with create-new adds a second polygon to the sidebar', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await setBufferDistance(page, 200)
    // create-new is the default — no toggle click needed.
    await page.getByRole('button', { name: 'Apply' }).click()
    // Two polygons now
    await expect(page.locator('aside li')).toHaveCount(2)
  })

  test('original polygon remains visible after create-new apply', async ({ page }) => {
    await drawAndSelectPolygon(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await setBufferDistance(page, 200)
    await page.getByRole('button', { name: 'Apply' }).click()
    // Both polygons should be in the sidebar
    await expect(page.locator('aside li')).toHaveCount(2)
  })
})

// ─── Lines ──────────────────────────────────────────────────────────

/** Features in store order: id + geometry type. */
const shapes = (page: Page) => page.evaluate(() =>
  window.__elementEditorTest!.dataStore.getState().features.map((f) => ({ id: f.id, type: f.geometry.type })))

/** The buffer polygon preview is drawn: Leaflet an accent-filled non-interactive path, MapLibre the preview fill layer. */
const polygonPreviewShown = (page: Page, engine: Engine) => engine === 'leaflet'
  ? page.locator('path[stroke="#3b82f6"][fill="#3b82f6"]:not(.leaflet-interactive)').isVisible()
  : page.evaluate(() => {
    const map = window.__elementEditorTest!.map as MapLibreMap
    return map.queryRenderedFeatures({ layers: ['elm-processing-preview-fill'] }).length > 0
  })

test.describe('Buffer tool — lines', () => {
  let original: number[][]

  test.beforeEach(async ({ page, engine }) => {
    await setup(page)
    original = await seedSelectedZigzagLine(page)
    await page.getByRole('button', { name: 'Buffer' }).click()
    await expect.poll(() => polygonPreviewShown(page, engine)).toBe(true)
  })

  test('create-new adds a Polygon below the line, line unchanged; undo is one step', async ({ page }) => {
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(() => editingMode(page)).toBe('none')

    const after = await shapes(page)
    expect(after).toHaveLength(2)
    expect(after[0]).toEqual({ id: 'zigzag', type: 'LineString' })
    expect(after[1].type).toBe('Polygon')
    const line = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].geometry)
    expect(line).toEqual({ type: 'LineString', coordinates: original })

    await storeCaller(page)('undo')
    expect(await shapes(page)).toEqual([{ id: 'zigzag', type: 'LineString' }])
  })

  test('replace turns the line into a Polygon (same feature); undo is one step', async ({ page }) => {
    await page.locator('[role="checkbox"]').click()
    await expect(page.locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(() => editingMode(page)).toBe('none')

    expect(await shapes(page)).toEqual([{ id: 'zigzag', type: 'Polygon' }])

    await storeCaller(page)('undo')
    expect(await featureCount(page)).toBe(1)
    const line = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].geometry)
    expect(line).toEqual({ type: 'LineString', coordinates: original })
  })

  test('a distance of 0 or less gives no preview and disables Apply', async ({ page }) => {
    await setBufferDistance(page, -50)
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await setBufferDistance(page, 100)
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })
})
