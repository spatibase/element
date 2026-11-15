import { test, expect, MAP, type Page, type Engine } from './fixtures'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { waitForMap, editingMode, featureCount, selectedIds, seedSelectedZigzagLine, storeCaller } from './helpers'

/** A 7-point irregular polygon (helpers.drawPolygon's rectangle has nothing to simplify), closed on its first point. */
async function drawIrregularPolygon(page: Page, cx: number, cy: number) {
  // Activate polygon tool via keyboard shortcut ('g' = draw-polygon)
  await page.keyboard.press('g')
  await expect.poll(() => editingMode(page)).toBe('draw-polygon')

  // Click a series of vertices to form a polygon
  const pts = [
    [cx - 80, cy - 60],
    [cx - 30, cy - 100],
    [cx + 50, cy - 80],
    [cx + 90, cy - 10],
    [cx + 60, cy + 60],
    [cx - 20, cy + 80],
    [cx - 80, cy + 30],
  ]
  for (const [x, y] of pts) {
    await page.mouse.click(x, y)
    await page.waitForTimeout(100)
  }
  // Close by clicking first point: commits, and (auto-exit after draw) selects the new polygon.
  await page.mouse.click(cx - 80, cy - 60)
  await expect.poll(() => featureCount(page)).toBe(1)
}

/** The live preview: Leaflet draws an SVG path (stroke and fill #3b82f6); MapLibre a fill layer. */
const previewShown = (page: Page, engine: Engine) => engine === 'leaflet'
  ? page.locator('path[stroke="#3b82f6"][fill="#3b82f6"]').isVisible()
  : page.evaluate(() => {
    const map = window.__elementEditorTest!.map as MapLibreMap
    return !!map.getLayer('elm-processing-preview-fill') && map.queryRenderedFeatures({ layers: ['elm-processing-preview-fill'] }).length > 0
  })

test.describe('Simplify / Smooth tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()

    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map bounding box')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await drawIrregularPolygon(page, cx, cy)
    // The commit selects the polygon. (This used to click it as well: on MapLibre the
    // click hit-tests rendered features, and when the new polygon hadn't been drawn yet,
    // on a loaded machine, the click landed on "empty map" and deselected it.)
    await expect.poll(() => selectedIds(page)).toHaveLength(1)
  })

  test('simplify button is enabled for selected polygon', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Simplify shape' })
    await expect(btn).toBeVisible({ timeout: 3000 })
    await expect(btn).not.toBeDisabled()
  })

  test('smooth button is enabled for selected polygon', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Smooth shape' })
    await expect(btn).toBeVisible({ timeout: 3000 })
    await expect(btn).not.toBeDisabled()
  })

  test('opening simplify panel shows preview and cancel restores', async ({ page, engine }) => {
    await page.getByRole('button', { name: 'Simplify shape' }).click()

    // Panel label visible
    await expect(page.getByText('Simplify')).toBeVisible()

    // Preview polygon (non-interactive, blue) rendered by GeometryProcessingPreview
    await expect.poll(() => previewShown(page, engine)).toBe(true)

    // Cancel closes the panel
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Simplify')).not.toBeVisible()
  })

  test('opening smooth panel shows preview and cancel restores', async ({ page, engine }) => {
    await page.getByRole('button', { name: 'Smooth shape' }).click()

    await expect(page.getByText('Smooth')).toBeVisible()

    // Preview polygon (non-interactive, blue) rendered by GeometryProcessingPreview
    await expect.poll(() => previewShown(page, engine)).toBe(true)

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Smooth')).not.toBeVisible()
  })
})

// ─── Lines ──────────────────────────────────────────────────────────

/** A feature's geometry from the store. */
const geometryOf = (page: Page, id: string) => page.evaluate((fid) =>
  window.__elementEditorTest!.dataStore.getState().features.find((f) => f.id === fid)?.geometry as { type: string; coordinates: number[][] } | undefined, id)

/** The line preview is drawn: Leaflet a non-interactive unfilled accent path, MapLibre the preview line layer. */
const linePreviewShown = (page: Page, engine: Engine) => engine === 'leaflet'
  ? page.locator('path[stroke="#3b82f6"][fill="none"]:not(.leaflet-interactive)').isVisible()
  : page.evaluate(() => {
    const map = window.__elementEditorTest!.map as MapLibreMap
    return map.queryRenderedFeatures({ layers: ['elm-processing-preview-line'] }).some((f) => f.geometry.type === 'LineString')
  })

test.describe('Simplify / Smooth on a line', () => {
  let original: number[][]

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    original = await seedSelectedZigzagLine(page)
  })

  test('both tools are offered for a selected LineString', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Simplify shape' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Smooth shape' })).toBeVisible()
  })

  test('simplify keeps a LineString with fewer points and its endpoints; undo is one step', async ({ page, engine }) => {
    await page.getByRole('button', { name: 'Simplify shape' }).click()
    await expect.poll(() => linePreviewShown(page, engine)).toBe(true)
    const apply = page.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeEnabled()
    await apply.click()
    await expect.poll(() => editingMode(page)).toBe('none')

    const g = (await geometryOf(page, 'zigzag'))!
    expect(g.type).toBe('LineString')
    expect(g.coordinates.length).toBeLessThan(original.length)
    expect(g.coordinates.length).toBeGreaterThanOrEqual(2)
    expect(g.coordinates[0]).toEqual(original[0])
    expect(g.coordinates[g.coordinates.length - 1]).toEqual(original[original.length - 1])

    await storeCaller(page)('undo')
    expect(await geometryOf(page, 'zigzag')).toEqual({ type: 'LineString', coordinates: original })
    expect(await featureCount(page)).toBe(1)
  })

  test('smooth keeps an open LineString with more points and the same endpoints; undo is one step', async ({ page, engine }) => {
    await page.getByRole('button', { name: 'Smooth shape' }).click()
    await expect.poll(() => linePreviewShown(page, engine)).toBe(true)
    const apply = page.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeEnabled()
    await apply.click()
    await expect.poll(() => editingMode(page)).toBe('none')

    const g = (await geometryOf(page, 'zigzag'))!
    expect(g.type).toBe('LineString')
    expect(g.coordinates.length).toBeGreaterThan(original.length)
    expect(g.coordinates[0]).toEqual(original[0])
    expect(g.coordinates[g.coordinates.length - 1]).toEqual(original[original.length - 1])

    await storeCaller(page)('undo')
    expect(await geometryOf(page, 'zigzag')).toEqual({ type: 'LineString', coordinates: original })
  })

  test('smooth on a MultiLineString keeps each part open; smooth on a MultiPolygon stays a MultiPolygon', async ({ page }) => {
    const ds = storeCaller(page)
    const [a, b] = [original.slice(0, 7), original.slice(6)]
    const ring = [original[0], original[4], original[8], original[0]]
    await ds('importGeoJSON', {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'mls', geometry: { type: 'MultiLineString', coordinates: [a, b] }, properties: {} },
        { type: 'Feature', id: 'mp', geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: {} },
      ],
    }, 'replace')

    for (const id of ['mls', 'mp']) {
      await ds('selectFeature', id)
      await page.getByRole('button', { name: 'Smooth shape' }).click()
      const apply = page.getByRole('button', { name: 'Apply' })
      await expect(apply).toBeEnabled()
      await apply.click()
      await expect.poll(() => editingMode(page)).toBe('none')
    }

    const mls = (await geometryOf(page, 'mls')) as unknown as { type: string; coordinates: number[][][] }
    expect(mls.type).toBe('MultiLineString')
    mls.coordinates.forEach((part, i) => {
      const src = [a, b][i]
      expect(part.length).toBeGreaterThan(src.length)
      expect(part[0]).toEqual(src[0])
      expect(part[part.length - 1]).toEqual(src[src.length - 1])
    })
    expect((await geometryOf(page, 'mp'))!.type).toBe('MultiPolygon')
  })
})
