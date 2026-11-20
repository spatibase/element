/**
 * Touch, on both engines, in a phone context (Pixel 7: touch, coarse pointer, mobile viewport):
 * drawing an area and a line by taps and finishing with Done, Undo point; a second tap on the
 * selected shape (or "Edit points") enters point editing; tap a point → Delete in the action bar;
 * long-press a point → the right-click menu; midpoints always shown; dragging a point or a midpoint
 * moves / inserts without panning the map; one finger on a selected point moves it (elsewhere it
 * pans, a pinch never moves it). Drags go through CDP `Input.dispatchTouchEvent`.
 */
import { devices } from '@playwright/test'
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, selectedIds, featureCount, screenPoint } from './helpers'

const { defaultBrowserType: _browser, ...pixel7 } = devices['Pixel 7']
test.use(pixel7)

type Pt = { x: number; y: number }

async function mapBox(page: Page) {
  return (await page.locator(MAP).first().boundingBox())!
}

/** One finger: down at `from`, move to `to` in steps, up. */
async function touchDrag(page: Page, from: Pt, to: Pt, steps = 8, holdMs = 0) {
  const cdp = await page.context().newCDPSession(page)
  const point = (p: Pt) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) })
  if (holdMs) await page.waitForTimeout(holdMs)
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/** A finger resting on `at` for `ms`. */
async function longPress(page: Page, at: Pt, ms = 700) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] })
  await page.waitForTimeout(ms)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

const center = (page: Page) => page.evaluate(() => {
  const m = window.__elementEditorTest!.map
  const c = m.getCenter()
  return { lng: c.lng, lat: c.lat }
})

/** The first feature's outer ring (or line) coordinates. */
const ring = (page: Page) => page.evaluate(() => {
  const g = window.__elementEditorTest!.dataStore.getState().features[0].geometry as { type: string; coordinates: unknown }
  return (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g.coordinates) as number[][]
})

const vertexEdit = (page: Page) => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditFeatureId)

/** Tap an area of 4 points around the map centre (as a finger), and finish with Done. */
async function tapArea(page: Page): Promise<Pt> {
  const b = await mapBox(page)
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  await page.getByRole('button', { name: 'Area' }).tap()
  for (const [dx, dy] of [[-70, -60], [70, -60], [70, 60], [-70, 60]]) {
    await page.touchscreen.tap(cx + dx, cy + dy)
    await page.waitForTimeout(350)
  }
  await page.getByRole('button', { name: 'Done' }).tap()
  await expect.poll(() => featureCount(page)).toBe(1)
  return { x: cx, y: cy }
}

/** Seed one selected polygon around the map centre and put it in point editing from code. */
async function seedVertexEdit(page: Page) {
  const b = await mapBox(page)
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  // The user's finger has touched the map before (touch UI follows the last press).
  await page.touchscreen.tap(b.x + 20, b.y + b.height / 2)
  const pts = await page.evaluate(([cx, cy]) => {
    const m = window.__elementEditorTest!.map
    const r = m.getContainer().getBoundingClientRect()
    const un = (x: number, y: number) => {
      const p = { x: x - r.left, y: y - r.top }
      const ll = 'containerPointToLatLng' in m ? m.containerPointToLatLng([p.x, p.y]) : m.unproject([p.x, p.y])
      return [ll.lng, ll.lat]
    }
    return [un(cx - 90, cy - 80), un(cx + 90, cy - 80), un(cx + 90, cy + 80), un(cx - 90, cy + 80)]
  }, [cx, cy] as const)
  await page.evaluate((pts) => {
    const ref = window.__elementEditorRef!
    ref.setFeatureCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'sq', properties: { name: 'Square' }, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } }] })
    ref.setVertexEdit('sq')
  }, pts)
  await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
}

async function vertexBox(page: Page, i = 0): Promise<Pt> {
  const r = await ring(page)
  return screenPoint(page, r[i][0], r[i][1])
}

test.describe('Touch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('draw an area by taps: Done finishes it, Undo point removes the last one', async ({ page }) => {
    const b = await mapBox(page)
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    await page.getByRole('button', { name: 'Area' }).tap()
    for (const [dx, dy] of [[-70, -60], [70, -60], [70, 60], [0, 90]]) {
      await page.touchscreen.tap(cx + dx, cy + dy)
      await page.waitForTimeout(350)
    }
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length)).toBe(4)
    await page.getByRole('button', { name: 'Undo point' }).tap()
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length)).toBe(3)
    await page.getByRole('button', { name: 'Done' }).tap()
    await expect.poll(() => featureCount(page)).toBe(1)
    expect((await ring(page)).length).toBe(4) // 3 points, closed
  })

  test('tapping the first point closes an area', async ({ page }) => {
    const b = await mapBox(page)
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    await page.getByRole('button', { name: 'Area' }).tap()
    for (const [dx, dy] of [[-70, -60], [70, -60], [70, 60], [-70, -60]]) {
      await page.touchscreen.tap(cx + dx, cy + dy)
      await page.waitForTimeout(350)
    }
    await expect.poll(() => featureCount(page)).toBe(1)
    expect((await ring(page)).length).toBe(4)
  })

  test('draw a line by taps and finish with Done', async ({ page }) => {
    const b = await mapBox(page)
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    await page.getByRole('button', { name: 'Line' }).tap()
    for (const [dx, dy] of [[-80, 0], [0, -60], [80, 0]]) {
      await page.touchscreen.tap(cx + dx, cy + dy)
      await page.waitForTimeout(350)
    }
    await page.getByRole('button', { name: 'Done' }).tap()
    await expect.poll(() => featureCount(page)).toBe(1)
    expect((await ring(page)).length).toBe(3)
  })

  test('a second tap on the selected area enters point editing; Edit points does too', async ({ page }) => {
    const c = await tapArea(page)
    await expect.poll(() => selectedIds(page)).toHaveLength(1)
    await page.waitForTimeout(400)
    await page.touchscreen.tap(c.x + 10, c.y + 10)
    await expect.poll(() => vertexEdit(page)).not.toBeNull()
    await expect(page.locator('.elm-vertex').first()).toBeVisible()

    await page.evaluate(() => window.__elementEditorRef!.setVertexEdit(null))
    await page.getByRole('button', { name: 'Edit points' }).tap()
    await expect.poll(() => vertexEdit(page)).not.toBeNull()
  })

  test('tap a point → Delete in the action bar removes it', async ({ page }) => {
    await seedVertexEdit(page)
    const p = await vertexBox(page, 1)
    await page.touchscreen.tap(p.x, p.y)
    const del = page.getByRole('button', { name: 'Delete selected points' })
    await expect(del).toBeVisible()
    await del.tap()
    await expect.poll(async () => (await ring(page)).length).toBe(4)
    expect(await vertexEdit(page)).toBe('sq')
  })

  test('long-press a point opens the point menu', async ({ page }) => {
    await seedVertexEdit(page)
    const p = await vertexBox(page, 2)
    await longPress(page, p)
    const item = page.getByRole('button', { name: 'Delete point' })
    await expect(item).toBeVisible()
    await item.tap()
    await expect.poll(async () => (await ring(page)).length).toBe(4)
  })

  test('midpoints are all shown; touch handles are at least 44 px', async ({ page }) => {
    await seedVertexEdit(page)
    await expect(page.locator('.elm-midpoint-marker:visible')).toHaveCount(4)
    // The handle you see stays small; a finger 20 px off its centre still hits it (44 px area).
    const box = (await page.locator('.elm-vertex').first().boundingBox())!
    expect(box.width).toBeLessThan(20)
    const p = await vertexBox(page, 1)
    const hit = (dx: number, dy: number) => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.elm-vertex'), [p.x + dx, p.y + dy] as const)
    expect(await hit(20, 0)).toBe(true)
    expect(await hit(0, -20)).toBe(true)
    expect(await hit(30, 0)).toBe(false)
    // A tap 18 px off the point selects it.
    await page.touchscreen.tap(p.x + 18, p.y + 6)
    await expect(page.getByRole('button', { name: 'Delete selected points' })).toBeVisible()
  })

  test('dragging a point moves it without panning the map', async ({ page }) => {
    await seedVertexEdit(page)
    const before = await center(page)
    const r0 = await ring(page)
    const p = await vertexBox(page, 0)
    await touchDrag(page, p, { x: p.x - 40, y: p.y - 30 })
    await expect.poll(async () => (await ring(page))[0]).not.toEqual(r0[0])
    expect(await center(page)).toEqual(before)
    expect((await ring(page)).length).toBe(5)
  })

  test('one finger on a selected point moves it; elsewhere it pans; a pinch on it moves nothing', async ({ page }) => {
    const b = await mapBox(page)
    await page.touchscreen.tap(b.x + 20, b.y + b.height / 2)
    const at = await page.evaluate(([x, y]) => {
      const m = window.__elementEditorTest!.map
      const r = m.getContainer().getBoundingClientRect()
      const p = { x: x - r.left, y: y - r.top }
      const ll = 'containerPointToLatLng' in m ? m.containerPointToLatLng([p.x, p.y]) : m.unproject([p.x, p.y])
      return [ll.lng, ll.lat]
    }, [b.x + b.width / 2, b.y + b.height / 2] as const)
    await page.evaluate((at) => {
      const ref = window.__elementEditorRef!
      ref.setFeatureCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'pin', properties: { name: 'Pin' }, geometry: { type: 'Point', coordinates: at } }] })
      window.__elementEditorTest!.dataStore.getState().selectFeature('pin')
    }, at)
    await page.waitForTimeout(300)
    const pin = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].geometry.coordinates as number[])
    const p0 = await pin()
    const s = await screenPoint(page, p0[0], p0[1])
    const grab = { x: s.x, y: s.y - 10 } // the pin's body (Leaflet draws it above the point)

    // Drag the selected point: it moves, the map doesn't pan, one undo step.
    const before = await center(page)
    const undo0 = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)
    await touchDrag(page, grab, { x: grab.x + 60, y: grab.y + 40 })
    await expect.poll(pin).not.toEqual(p0)
    expect(await center(page)).toEqual(before)
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)).toBe(undo0 + 1)
    expect(await selectedIds(page)).toEqual(['pin'])

    // Drag away from it: the map pans, the point stays.
    const p1 = await pin()
    const from = { x: b.x + b.width / 2 - 100, y: b.y + b.height / 2 + 120 }
    await touchDrag(page, from, { x: from.x + 80, y: from.y + 60 })
    await expect.poll(async () => (await center(page)).lng).not.toBe(before.lng)
    expect(await pin()).toEqual(p1)

    // Two fingers, the first on the point: a pinch, never a move.
    const s1 = await screenPoint(page, p1[0], p1[1])
    const g1 = { x: s1.x, y: s1.y - 10 }
    const cdp = await page.context().newCDPSession(page)
    const tp = (a: Pt, c?: Pt) => [{ x: a.x, y: a.y, id: 1 }, ...(c ? [{ x: c.x, y: c.y, id: 2 }] : [])]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(g1) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: g1.x + 12, y: g1.y }) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp({ x: g1.x + 12, y: g1.y }, { x: g1.x + 80, y: g1.y + 80 }) })
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: g1.x + 12 - i * 8, y: g1.y - i * 8 }, { x: g1.x + 80 + i * 8, y: g1.y + 80 + i * 8 }) })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
    await page.waitForTimeout(300)
    expect(await pin()).toEqual(p1)
  })

  test('dragging a midpoint inserts a point without panning the map', async ({ page }) => {
    await seedVertexEdit(page)
    const before = await center(page)
    const r0 = await ring(page)
    const m = await screenPoint(page, (r0[0][0] + r0[1][0]) / 2, (r0[0][1] + r0[1][1]) / 2)
    await touchDrag(page, m, { x: m.x, y: m.y - 40 })
    await expect.poll(async () => (await ring(page)).length).toBe(6)
    expect(await center(page)).toEqual(before)
  })
})
