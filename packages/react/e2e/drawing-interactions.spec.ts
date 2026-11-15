/**
 * Drawing-time keys and cursors, on both engines (the fixture's `engine` picks the drop-in):
 * - Enter finishes a line/polygon even with `ui.keyboardShortcuts: false` (`?shortcuts=0`, like an
 *   embedded hero editor), while real shortcuts stay off.
 * - Dragging the map while a tool is active shows a grabbing cursor, then the tool's crosshair again.
 * - MapLibre: a Cmd-drag of a feature during a tool, and picking a Picker candidate, leave the crosshair.
 * - MapLibre Picker reads shapes from the basemap's vector tiles (stubbed here) without calling Overpass.
 * Basemap tile hosts are aborted so the suite is offline-safe.
 */
import { test, expect, type Page } from './fixtures'
import { enableStayInTool, importGeoJSON, waitForMap, featureCount, editingMode, mapBox } from './helpers'

type MapLibreMap = import('maplibre-gl').Map

async function open(page: Page, query = '') {
  await page.goto('/?' + query)
  await waitForMap(page)
}

/** The cursor the user sees at (x, y): computed style of the element under the pointer. */
const cursorAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py)
    return el ? getComputedStyle(el).cursor : null
  }, [x, y])

async function mapCenter(page: Page) {
  const box = await mapBox(page)
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

test.describe('drawing keys and cursors', () => {
  test('Enter finishes polygon and line with keyboard shortcuts off', async ({ page }) => {
    await open(page, 'shortcuts=0')
    const { cx, cy } = await mapCenter(page)

    // Shortcuts really are off: G does not pick the polygon tool.
    await page.mouse.click(cx, cy + 150)
    await page.keyboard.press('g')
    expect(await editingMode(page)).toBe('none')

    await page.getByRole('button', { name: 'Area', exact: true }).click()
    for (const [dx, dy] of [[-80, -60], [80, -60], [60, 70]]) {
      await page.mouse.click(cx + dx, cy + dy)
      await page.waitForTimeout(200)
    }
    await page.keyboard.press('Enter')
    await expect.poll(() => featureCount(page)).toBe(1)

    await page.getByRole('button', { name: 'Line' }).click()
    for (const [dx, dy] of [[-120, 100], [120, 100]]) {
      await page.mouse.click(cx + dx, cy + dy)
      await page.waitForTimeout(200)
    }
    await page.keyboard.press('Enter')
    await expect.poll(() => featureCount(page)).toBe(2)
  })

  test('dragging the map during a tool shows a grabbing cursor', async ({ page }) => {
    await open(page)
    const { cx, cy } = await mapCenter(page)
    await page.getByRole('button', { name: 'Area', exact: true }).click()
    await page.mouse.move(cx, cy)
    expect(await cursorAt(page, cx, cy)).toBe('crosshair')

    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 10, cy + i * 5)
    expect(await cursorAt(page, cx + 100, cy + 50)).toBe('grabbing')
    await page.mouse.up()

    await expect.poll(() => cursorAt(page, cx + 100, cy + 50)).toBe('crosshair')
    expect(await editingMode(page)).toBe('draw-polygon')
    // The pan placed no vertex: the draft is still empty (Escape would discard one anyway).
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length)).toBe(0)
    // ...while a plain click in the same tool does place one, so the check above can fail.
    await page.mouse.click(cx - 100, cy - 50)
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length)).toBe(1)
    await page.keyboard.press('Escape')
    expect(await featureCount(page)).toBe(0)
  })
})

test.describe('MapLibre: cursor after tool side-interactions', () => {
  test.skip(({ engine }) => engine !== 'maplibre', 'MapLibre-only: jumpTo, vector-tile picker, MapLibre cursor handling')
  const SQUARE = (lng: number, lat: number, d = 0.002) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'sq', properties: { name: 'Square' }, geometry: { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] } }],
  })

  async function openAt(page: Page, zoom: number) {
    await open(page)
    await page.evaluate((z) => (window.__elementEditorTest!.map as MapLibreMap).jumpTo({ center: [2.17, 41.387], zoom: z }), zoom)
    await page.waitForFunction(() => !(window.__elementEditorTest!.map as MapLibreMap).isMoving())
  }

  test('Cmd-drag of a feature during a tool ends on the crosshair', async ({ page }) => {
    await openAt(page, 15)
    await importGeoJSON(page, JSON.stringify(SQUARE(2.17, 41.387)))
    const { cx, cy } = await mapCenter(page)
    await page.getByRole('button', { name: 'Area', exact: true }).click()

    await page.mouse.move(cx, cy)
    await page.keyboard.down('Meta')
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 8, cy + i * 4)
    expect(await cursorAt(page, cx + 80, cy + 40)).toBe('grabbing')
    await page.mouse.up()
    await page.keyboard.up('Meta')

    await page.mouse.move(cx + 200, cy + 200)
    await expect.poll(() => cursorAt(page, cx + 200, cy + 200)).toBe('crosshair')
    expect(await editingMode(page)).toBe('draw-polygon')
  })

  test('Picker takes the shape from the vector tiles, merging tile pieces, without Overpass', async ({ page }) => {
    let overpassCalls = 0
    await page.route('**/overpass-api.de/**', (r) => { overpassCalls++; return r.abort() })
    await openAt(page, 17)
    // Stub the basemap: one building under the click, split in two pieces at a tile edge.
    await page.evaluate(() => {
      const map = window.__elementEditorTest!.map as MapLibreMap
      const { lng, lat } = map.getCenter()
      const d = 0.0003
      const ring = (x0: number, x1: number) => [[[x0, lat - d], [x1, lat - d], [x1, lat + d], [x0, lat + d], [x0, lat - d]]]
      const whole = { type: 'Polygon', coordinates: ring(lng - d, lng + d) }
      const pieces = [ring(lng - d, lng + d * 0.1), ring(lng - d * 0.1, lng + d)].map((c) => ({ properties: { render_height: 10 }, geometry: { type: 'Polygon', coordinates: c } }))
      const m = map as unknown as { queryRenderedFeatures: (...a: unknown[]) => unknown[]; querySourceFeatures: (...a: unknown[]) => unknown[] }
      const qrf = m.queryRenderedFeatures.bind(map)
      const qsf = m.querySourceFeatures.bind(map)
      // Only the picker queries a bare point (no options); Element's own hover queries pass layers.
      m.queryRenderedFeatures = (...a: unknown[]) => a.length === 1
        ? [...qrf(...a), { id: 42, source: 'openmaptiles', sourceLayer: 'building', properties: { render_height: 10 }, geometry: whole, layer: { id: 'building' } }]
        : qrf(...a)
      m.querySourceFeatures = (...a: unknown[]) => ((a[1] as { sourceLayer?: string } | undefined)?.sourceLayer === 'building' ? pieces : qsf(...a))
    })
    const { cx, cy } = await mapCenter(page)
    await page.getByRole('button', { name: 'Picker' }).click()
    await page.mouse.click(cx, cy)

    await expect.poll(() => featureCount(page)).toBe(1)
    const xs = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return { type: f.geometry.type, lngs: (f.geometry as GeoJSON.Polygon).coordinates[0].map((c) => c[0]) }
    })
    expect(xs.type).toBe('Polygon')
    const center = await page.evaluate(() => window.__elementEditorTest!.map.getCenter().lng)
    // The merged outline spans both pieces.
    expect(Math.min(...xs.lngs)).toBeCloseTo(center - 0.0003, 6)
    expect(Math.max(...xs.lngs)).toBeCloseTo(center + 0.0003, 6)
    expect(overpassCalls).toBe(0)
  })

  test('picking a Picker candidate keeps the tool and its crosshair', async ({ page }) => {
    await enableStayInTool(page)
    await openAt(page, 17)
    // Tiles are offline, so the picker falls back to (mocked) Overpass: two candidates around the click.
    const { lng, lat } = await page.evaluate(() => { const c = window.__elementEditorTest!.map.getCenter(); return { lng: c.lng, lat: c.lat } })
    const way = (id: number, name: string, d: number) => ({
      type: 'way', id, tags: { name, leisure: 'park' },
      geometry: [[-d, -d], [d, -d], [d, d], [-d, d], [-d, -d]].map(([x, y]) => ({ lat: lat + y, lon: lng + x })),
    })
    await page.route('**/overpass-api.de/**', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ elements: [way(111, 'Park A', 0.0005), way(222, 'Park B', 0.001)] }),
    }))
    const { cx, cy } = await mapCenter(page)
    await page.getByRole('button', { name: 'Picker' }).click()
    await page.mouse.click(cx, cy)
    await expect(page.getByText('Park A')).toBeVisible()

    // Hovering a candidate outline turns the cursor into a pointer... Re-move on every
    // poll: the list can show before MapLibre renders the overlay, and a single early
    // move then never produces a mouseenter.
    let wiggle = 0
    await expect.poll(async () => {
      await page.mouse.move(cx + 5 + (wiggle ^= 1), cy + 5)
      return cursorAt(page, cx + 5, cy + 5)
    }).toBe('pointer')
    // ...and choosing one must hand the crosshair back (the overlay goes without a mouseleave).
    await page.getByText('Park A').click()
    await expect.poll(() => featureCount(page)).toBe(1)
    expect(await editingMode(page)).toBe('pick-shape')
    await page.mouse.move(cx + 5, cy + 5)
    await expect.poll(() => cursorAt(page, cx + 5, cy + 5)).toBe('crosshair')
  })
})
