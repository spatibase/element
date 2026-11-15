/**
 * Transform controls e2e tests — scale and rotate via transform handles.
 * Tests that selecting a polygon shows transform controls and that
 * dragging handles modifies the geometry.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, importGeoJSON, drawRect, flyTo, screenPoint, storeCaller } from './helpers'

const POLYGON_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  metadata: { schemas: [{ id: 'default', name: 'Default', fields: [{ key: 'name', label: 'Name', type: 'text', required: false }] }] },
  features: [{
    type: 'Feature',
    id: 'poly-1',
    schemaId: 'default',
    geometry: { type: 'Polygon', coordinates: [[[2.34, 48.86], [2.36, 48.86], [2.36, 48.85], [2.34, 48.85], [2.34, 48.86]]] },
    properties: { name: 'Transform Test' },
  }],
})


test.describe('Transform controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('selecting a polygon shows the editing toolbar', async ({ page }) => {
    await importGeoJSON(page, POLYGON_GEOJSON)
    // Click the polygon in the sidebar to select it
    await page.getByText('Transform Test').click()
    await page.waitForTimeout(300)
    // Editing toolbar should appear. Use exact match: the feature row
    // accessible name includes "Transform Test", so a fuzzy /transform/i
    // lookup would double-match.
    await expect(page.getByRole('button', { name: 'Transform', exact: true })).toBeVisible({ timeout: 3000 })
  })

  test('transform button activates transform mode on selection', async ({ page }) => {
    await drawRect(page)
    await page.waitForTimeout(300)
    // The drawn rectangle should be selected; check toolbar
    const transformBtn = page.getByRole('button', { name: /transform/i })
    await expect(transformBtn).toBeVisible({ timeout: 3000 })
  })

  test('Enter enters vertex edit mode for selected polygon', async ({ page }) => {
    // Old "Edit points" editing-toolbar button was removed; Enter is the
    // vertex-edit entry point for a single selection.
    await drawRect(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
  })

  test('duplicate button duplicates the selected feature', async ({ page }) => {
    await drawRect(page)
    await page.waitForTimeout(300)
    const dupBtn = page.getByRole('button', { name: /duplicate/i })
    await expect(dupBtn).toBeVisible({ timeout: 3000 })
    await dupBtn.click()
    await page.waitForTimeout(400)
    // Should now have 2 features in the list
    await expect(page.locator('aside li')).toHaveCount(2, { timeout: 3000 })
  })

  test('delete button removes the selected feature', async ({ page }) => {
    await drawRect(page)
    await page.waitForTimeout(300)
    const delBtn = page.getByRole('button', { name: /delete/i })
    await expect(delBtn).toBeVisible({ timeout: 3000 })
    await delBtn.click()
    await page.waitForTimeout(400)
    await expect(page.locator('aside li')).toHaveCount(0, { timeout: 3000 })
  })

  // Leaflet panned the map on a plain drag inside the transform box (MapLibre moved the feature).
  // Presses at [lng, lat] and drags; asserts poly-1 moved, the map did not pan, one undo step.
  async function dragInsideBox(page: Page, geojson: string, press: [number, number]) {
    await importGeoJSON(page, geojson)
    await flyTo(page, [48.855, 2.35], 13)
    await storeCaller(page)('selectFeature', 'poly-1')
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setTransformActive(true))
    await page.waitForTimeout(300)

    const state = () => page.evaluate(() => {
      const t = window.__elementEditorTest!
      const c = t.map.getCenter()
      const f = t.dataStore.getState().features.find((x) => x.id === 'poly-1')!
      return {
        ring: (f.geometry as GeoJSON.Polygon).coordinates[0],
        center: [c.lng, c.lat],
        undo: t.dataStore.getState().undoStack.length,
        transform: t.uiStore.getState().transformActive,
        selected: t.dataStore.getState().selectedIds,
      }
    })
    const before = await state()

    const start = await screenPoint(page, press[0], press[1])
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + i * 8, start.y + i * 5)
    await page.mouse.up()

    // Moved right and down.
    await expect.poll(async () => (await state()).ring[0][0]).toBeGreaterThan(before.ring[0][0] + 1e-4)
    const after = await state()
    expect(after.ring[0][1]).toBeLessThan(before.ring[0][1] - 1e-4)
    // The map did not pan.
    expect(after.center[0]).toBeCloseTo(before.center[0], 9)
    expect(after.center[1]).toBeCloseTo(before.center[1], 9)
    // The trailing click neither left transform nor dropped the selection.
    expect(after.transform).toBe(true)
    expect(after.selected).toEqual(['poly-1'])
    // One undo step, and undo restores the original geometry.
    expect(after.undo).toBe(before.undo + 1)
    await storeCaller(page)('undo')
    const undone = await state()
    expect(undone.undo).toBe(before.undo)
    expect(undone.ring).toEqual(before.ring)
  }

  test('a scale handle press without a move adds no undo step; a scale drag adds one', async ({ page }) => {
    await importGeoJSON(page, POLYGON_GEOJSON)
    await flyTo(page, [48.855, 2.35], 13)
    await storeCaller(page)('selectFeature', 'poly-1')
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setTransformActive(true))
    await page.waitForTimeout(300)
    const undo = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)
    const ring = () => page.evaluate(() => (window.__elementEditorTest!.dataStore.getState().features[0].geometry as GeoJSON.Polygon).coordinates[0])
    const before = await undo()
    const ring0 = await ring()

    // The NE corner handle.
    const ne = await screenPoint(page, 2.36, 48.86)
    await page.mouse.move(ne.x, ne.y)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect(await undo()).toBe(before)
    expect(await ring()).toEqual(ring0)
    // ...and leaves transform on (Leaflet's trailing click used to exit it and deselect).
    expect(await page.evaluate(() => [window.__elementEditorTest!.uiStore.getState().transformActive, window.__elementEditorTest!.dataStore.getState().selectedIds])).toEqual([true, ['poly-1']])

    await page.mouse.move(ne.x, ne.y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(ne.x + i * 6, ne.y - i * 6)
    await page.mouse.up()
    await expect.poll(ring).not.toEqual(ring0)
    expect(await undo()).toBe(before + 1)
  })

  // Both engines: a plain click on the transformed feature keeps transform (Leaflet used to exit);
  // Esc or a click on empty map leaves it.
  test('a click on the selected feature stays in transform; Esc and an empty-map click exit', async ({ page }) => {
    await importGeoJSON(page, POLYGON_GEOJSON)
    await flyTo(page, [48.855, 2.35], 13)
    const enter = async () => {
      await storeCaller(page)('selectFeature', 'poly-1')
      await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setTransformActive(true))
      await page.waitForTimeout(300)
    }
    const state = () => page.evaluate(() => [
      window.__elementEditorTest!.uiStore.getState().transformActive,
      window.__elementEditorTest!.dataStore.getState().selectedIds,
    ])
    await enter()
    const body = await screenPoint(page, 2.345, 48.857)
    await page.mouse.click(body.x, body.y)
    await page.waitForTimeout(400)
    expect(await state()).toEqual([true, ['poly-1']])

    await page.keyboard.press('Escape')
    await expect.poll(state).toEqual([false, ['poly-1']])

    await enter()
    const empty = await screenPoint(page, 2.375, 48.845)
    await page.mouse.click(empty.x, empty.y)
    await expect.poll(state).toEqual([false, []])
  })

  test('dragging inside the transform box moves the feature, not the map', async ({ page }) => {
    // Press on the polygon body (its centre).
    await dragInsideBox(page, POLYGON_GEOJSON, [2.35, 48.855])
  })

  test('dragging empty space inside the transform box moves the feature', async ({ page }) => {
    // A triangle: the top-right corner of its box is empty map.
    const triangle = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'poly-1', properties: { name: 'Triangle' },
        geometry: { type: 'Polygon', coordinates: [[[2.34, 48.85], [2.36, 48.85], [2.34, 48.86], [2.34, 48.85]]] },
      }],
    })
    await dragInsideBox(page, triangle, [2.357, 48.859])
  })

  test('a plain drag on one feature of a transformed multi-selection moves them all (one undo step)', async ({ page }) => {
    const two = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Polygon', coordinates: [[[2.34, 48.85], [2.345, 48.85], [2.345, 48.855], [2.34, 48.855], [2.34, 48.85]]] } },
        { type: 'Feature', id: 'b', properties: {}, geometry: { type: 'Polygon', coordinates: [[[2.355, 48.855], [2.36, 48.855], [2.36, 48.86], [2.355, 48.86], [2.355, 48.855]]] } },
      ],
    })
    await importGeoJSON(page, two)
    await flyTo(page, [48.855, 2.35], 13)
    await page.evaluate(() => {
      const t = window.__elementEditorTest!
      t.dataStore.getState().setSelection(['a', 'b'])
      t.uiStore.getState().setTransformActive(true)
    })
    await page.waitForTimeout(300)
    const state = () => page.evaluate(() => {
      const t = window.__elementEditorTest!
      const c = t.map.getCenter()
      const fs = t.dataStore.getState().features
      const x0 = (id: string) => (fs.find((f) => f.id === id)!.geometry as GeoJSON.Polygon).coordinates[0][0][0]
      return { a: x0('a'), b: x0('b'), center: [c.lng, c.lat], undo: t.dataStore.getState().undoStack.length, selected: t.dataStore.getState().selectedIds }
    })
    const before = await state()
    const start = await screenPoint(page, 2.3425, 48.8525)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + i * 8, start.y + i * 5)
    await page.mouse.up()
    await expect.poll(async () => (await state()).a).toBeGreaterThan(before.a + 1e-4)
    const after = await state()
    expect(after.b - before.b).toBeCloseTo(after.a - before.a, 9)
    expect(after.center[0]).toBeCloseTo(before.center[0], 9)
    expect(after.center[1]).toBeCloseTo(before.center[1], 9)
    expect(after.selected.sort()).toEqual(['a', 'b'])
    expect(after.undo).toBe(before.undo + 1)
  })
})

// Scale modifiers and the rotation pivot are the same on both engines. Plain = anchored at
// the opposite corner / side; Shift = uniform on every handle; Alt = from the box centre; rotation
// pivots on the box centre. Measured in screen pixels from the feature's projected points, so the
// assertions are engine-agnostic.
test.describe('Transform modifiers and pivot (both engines)', () => {
  // A 0.02° × 0.01° rectangle with extra points on its east side: the vertex mean (2.355) is east of
  // the box centre (2.35), so a vertex-mean pivot would move the box.
  const RECT = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 'poly-1', properties: { name: 'Lopsided' },
      geometry: { type: 'Polygon', coordinates: [[[2.34, 48.85], [2.36, 48.85], [2.36, 48.852], [2.36, 48.854], [2.36, 48.856], [2.36, 48.858], [2.36, 48.86], [2.34, 48.86], [2.34, 48.85]]] },
    }],
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, RECT)
    await flyTo(page, [48.855, 2.35], 13)
    await storeCaller(page)('selectFeature', 'poly-1')
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setTransformActive(true))
    await page.waitForTimeout(300)
  })

  /** The feature's screen bbox (page px) and the undo depth. */
  const box = (page: Page) => page.evaluate(() => {
    const t = window.__elementEditorTest!
    const m = t.map
    const r = m.getContainer().getBoundingClientRect()
    const ring = (t.dataStore.getState().features[0].geometry as GeoJSON.Polygon).coordinates[0]
    const xs: number[] = [], ys: number[] = []
    for (const [lng, lat] of ring) {
      const p = 'latLngToContainerPoint' in m ? m.latLngToContainerPoint([lat, lng]) : m.project([lng, lat])
      xs.push(r.left + p.x); ys.push(r.top + p.y)
    }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, undo: t.dataStore.getState().undoStack.length }
  })

  /** `a` is within `tol` px of `b`. */
  const near = (a: number, b: number, tol = 2) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol)

  /** Press at `from`, move a little, hold `modifier` (if any), drag to `to` in steps, release. */
  async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifier?: 'Shift' | 'Alt') {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + (to.x - from.x) * 0.1, from.y + (to.y - from.y) * 0.1)
    if (modifier) await page.keyboard.down(modifier)
    for (let i = 2; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10)
    await page.mouse.up()
    if (modifier) await page.keyboard.up(modifier)
  }

  test('plain side drag stretches one axis with the opposite side fixed', async ({ page }) => {
    const b0 = await box(page)
    await drag(page, { x: b0.maxX, y: b0.cy }, { x: b0.maxX + 60, y: b0.cy + 20 })
    await expect.poll(async () => (await box(page)).w).toBeGreaterThan(b0.w + 40)
    const b1 = await box(page)
    near(b1.w, b0.w + 60)
    near(b1.minX, b0.minX)
    near(b1.h, b0.h)
    near(b1.cy, b0.cy)
    expect(b1.undo).toBe(b0.undo + 1)
  })

  test('Shift + side drag scales uniformly (keeps the aspect ratio)', async ({ page }) => {
    const b0 = await box(page)
    await drag(page, { x: b0.maxX, y: b0.cy }, { x: b0.maxX + 60, y: b0.cy }, 'Shift')
    await expect.poll(async () => (await box(page)).w).toBeGreaterThan(b0.w + 40)
    const b1 = await box(page)
    expect(b1.w / b1.h).toBeCloseTo(b0.w / b0.h, 1)
    expect(b1.h).toBeGreaterThan(b0.h * 1.15)
    // Anchored at the opposite (west) side's midpoint.
    near(b1.minX, b0.minX)
    near(b1.cy, b0.cy)
    expect(b1.undo).toBe(b0.undo + 1)
  })

  test('Shift + corner drag scales uniformly with the opposite corner fixed', async ({ page }) => {
    const b0 = await box(page)
    // Mostly sideways: a non-uniform scale would change the aspect ratio.
    await drag(page, { x: b0.maxX, y: b0.minY }, { x: b0.maxX + 70, y: b0.minY - 10 }, 'Shift')
    await expect.poll(async () => (await box(page)).w).toBeGreaterThan(b0.w + 20)
    const b1 = await box(page)
    expect(b1.w / b1.h).toBeCloseTo(b0.w / b0.h, 1)
    near(b1.minX, b0.minX)
    near(b1.maxY, b0.maxY)
    expect(b1.undo).toBe(b0.undo + 1)
  })

  test('Alt + corner drag scales from the box centre', async ({ page }) => {
    const b0 = await box(page)
    await drag(page, { x: b0.maxX, y: b0.minY }, { x: b0.maxX + 40, y: b0.minY - 30 }, 'Alt')
    await expect.poll(async () => (await box(page)).w).toBeGreaterThan(b0.w + 40)
    const b1 = await box(page)
    near(b1.cx, b0.cx)
    near(b1.cy, b0.cy)
    // Both sides moved: the opposite corner is not the anchor.
    expect(b1.minX).toBeLessThan(b0.minX - 20)
    expect(b1.maxY).toBeGreaterThan(b0.maxY + 15)
    expect(b1.undo).toBe(b0.undo + 1)
  })

  test('rotating 90° pivots on the box centre', async ({ page }) => {
    const b0 = await box(page)
    const knob = await page.locator(':is(.leaflet-marker-icon .rounded-full.border-2, .maplibregl-marker div[style*="border-radius: 50%"][style*="width: 16px"])').first().boundingBox()
    expect(knob).not.toBeNull()
    const k = { x: knob!.x + knob!.width / 2, y: knob!.y + knob!.height / 2 }
    const c = { x: b0.cx, y: b0.cy }
    const r = Math.hypot(k.x - c.x, k.y - c.y)
    const a0 = Math.atan2(k.y - c.y, k.x - c.x)
    await page.mouse.move(k.x, k.y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      const a = a0 + (Math.PI / 2) * (i / 12)
      await page.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a))
    }
    await page.mouse.up()
    await expect.poll(async () => (await box(page)).undo).toBe(b0.undo + 1)
    const b1 = await box(page)
    // A quarter turn: width and height swap...
    near(b1.w, b0.h, 3)
    near(b1.h, b0.w, 3)
    // ...around the box centre, which stays put (a vertex-mean pivot moves it ~40 px).
    near(b1.cx, b0.cx, 1.5)
    near(b1.cy, b0.cy, 1.5)
  })
})
