/**
 * A plain drag (no modifier) that starts on an already-selected feature moves it, on both
 * engines: point, line, area, and a multi-selection as a whole. One undo step restores it.
 * A plain drag on an unselected feature still pans; Cmd/Ctrl-drag still moves any feature;
 * a click on the selected feature stays a click; a press that moves less than the click
 * slop (8 px) moves nothing. Cursor: `move` over a selected feature, `grabbing` while moving.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, importGeoJSON, flyTo, screenPoint, storeCaller } from './helpers'

const FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'pt', properties: { name: 'Pin' }, geometry: { type: 'Point', coordinates: [2.33, 48.857] } },
    { type: 'Feature', id: 'ln', properties: { name: 'Line' }, geometry: { type: 'LineString', coordinates: [[2.335, 48.861], [2.345, 48.861]] } },
    { type: 'Feature', id: 'ar', properties: { name: 'Area' }, geometry: { type: 'Polygon', coordinates: [[[2.35, 48.86], [2.36, 48.86], [2.36, 48.852], [2.35, 48.852], [2.35, 48.86]]] } },
    { type: 'Feature', id: 'ar2', properties: { name: 'Area 2' }, geometry: { type: 'Polygon', coordinates: [[[2.335, 48.853], [2.345, 48.853], [2.345, 48.849], [2.335, 48.849], [2.335, 48.853]]] } },
  ],
})

/** Where to press each feature: on the pin's body, on the line, inside the area. */
const PRESS: Record<string, [number, number]> = {
  pt: [2.33, 48.857],
  ln: [2.34, 48.861],
  ar: [2.355, 48.856],
  ar2: [2.34, 48.851],
}

type State = { coords: string; center: [number, number]; undo: number; selected: string[] }
const state = (page: Page, id: string) => page.evaluate((id) => {
  const t = window.__elementEditorTest!
  const c = t.map.getCenter()
  const ds = t.dataStore.getState()
  return {
    coords: JSON.stringify(ds.features.find((f) => f.id === id)!.geometry.coordinates),
    center: [c.lng, c.lat] as [number, number],
    undo: ds.undoStack.length,
    selected: ds.selectedIds,
  }
}, id) as Promise<State>

/** Screen point of a press on feature `id` (a pin is grabbed 10 px above its tip). */
async function pressPoint(page: Page, id: string) {
  const p = await screenPoint(page, ...PRESS[id])
  return id === 'pt' ? { x: p.x, y: p.y - 10 } : p
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, steps = 8) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + dx * i / steps, from.y + dy * i / steps)
  await page.mouse.up()
}

const cursorAt = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, [p.x, p.y] as const)

test.describe('Plain drag on a selected feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, FC)
    await flyTo(page, [48.856, 2.345], 14)
    await page.waitForTimeout(300)
    // MapLibre: the areas are rendered at their press points (WebKit's worker can lag the fly).
    for (const id of ['ar', 'ar2']) {
      const p = await pressPoint(page, id)
      await expect.poll(() => page.evaluate(([x, y]) => {
        const map = window.__elementEditorTest!.map as unknown as { queryRenderedFeatures?: (p: [number, number]) => unknown[] }
        return !map.queryRenderedFeatures || map.queryRenderedFeatures([x, y]).length > 0
      }, [p.x, p.y] as [number, number])).toBe(true)
    }
  })

  for (const id of ['pt', 'ln', 'ar']) {
    test(`moves a selected ${id === 'pt' ? 'point' : id === 'ln' ? 'line' : 'area'}; one undo restores it; the map does not pan`, async ({ page }) => {
      await storeCaller(page)('selectFeature', id)
      await page.waitForTimeout(250)
      const before = await state(page, id)
      await drag(page, await pressPoint(page, id), 60, 40)
      await expect.poll(async () => (await state(page, id)).coords).not.toBe(before.coords)
      const after = await state(page, id)
      expect(after.center[0]).toBeCloseTo(before.center[0], 9)
      expect(after.center[1]).toBeCloseTo(before.center[1], 9)
      expect(after.selected).toEqual([id])
      expect(after.undo).toBe(before.undo + 1)
      await storeCaller(page)('undo')
      expect((await state(page, id)).coords).toBe(before.coords)
    })
  }

  test('a plain drag on an unselected feature pans the map and moves nothing', async ({ page }) => {
    await storeCaller(page)('selectFeature', 'pt')
    await page.waitForTimeout(250)
    const before = await state(page, 'ar')
    await drag(page, await pressPoint(page, 'ar'), 60, 40)
    await expect.poll(async () => (await state(page, 'ar')).center[0]).not.toBeCloseTo(before.center[0], 9)
    const after = await state(page, 'ar')
    expect(after.coords).toBe(before.coords)
    expect(after.undo).toBe(before.undo)
  })

  test('Cmd/Ctrl-drag still moves an unselected feature', async ({ page }) => {
    const before = await state(page, 'ar')
    await page.keyboard.down('ControlOrMeta')
    await drag(page, await pressPoint(page, 'ar'), 60, 40)
    await page.keyboard.up('ControlOrMeta')
    await expect.poll(async () => (await state(page, 'ar')).coords).not.toBe(before.coords)
    const after = await state(page, 'ar')
    expect(after.center[0]).toBeCloseTo(before.center[0], 9)
    expect(after.undo).toBe(before.undo + 1)
  })

  // MapLibre's own dragRotate takes Ctrl+left-drag (Windows/Linux); Element must own the gesture
  // when it starts on a feature. ControlOrMeta hides this on macOS (and Chrome there remaps a real
  // Ctrl+click to a right click), so send DOM mouse events with ctrlKey set explicitly.
  test('Ctrl-drag moves an unselected feature and does not rotate the map', async ({ page }) => {
    const before = await state(page, 'ar')
    const from = await pressPoint(page, 'ar')
    const bearing = () => page.evaluate(() => (window.__elementEditorTest!.map as { getBearing?: () => number }).getBearing?.() ?? 0)
    const b0 = await bearing()
    await page.keyboard.down('Control')
    await page.mouse.move(from.x, from.y) // hover first: canvas hit testing happens on mousemove
    await page.evaluate(async ({ x, y }) => {
      const target = document.elementFromPoint(x, y)!
      const ev = (type: string, px: number, py: number, buttons: number) =>
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, buttons, ctrlKey: true, view: window })
      target.dispatchEvent(ev('mousedown', x, y, 1))
      for (let i = 1; i <= 8; i++) {
        target.dispatchEvent(ev('mousemove', x + (60 * i) / 8, y + (40 * i) / 8, 1))
        await new Promise((r) => requestAnimationFrame(r))
      }
      target.dispatchEvent(ev('mouseup', x + 60, y + 40, 0))
    }, from)
    await page.keyboard.up('Control')
    await expect.poll(async () => (await state(page, 'ar')).coords).not.toBe(before.coords)
    expect(await bearing()).toBe(b0)
    expect((await state(page, 'ar')).undo).toBe(before.undo + 1)
  })

  test('a drag on one feature of a multi-selection moves them all (one undo step)', async ({ page }) => {
    await storeCaller(page)('setSelection', ['ar', 'ar2'])
    await page.waitForTimeout(250)
    const a = await state(page, 'ar')
    const b = await state(page, 'ar2')
    await drag(page, await pressPoint(page, 'ar2'), 50, -30)
    await expect.poll(async () => (await state(page, 'ar')).coords).not.toBe(a.coords)
    const a2 = await state(page, 'ar')
    expect((await state(page, 'ar2')).coords).not.toBe(b.coords)
    expect(a2.center[0]).toBeCloseTo(a.center[0], 9)
    expect(a2.undo).toBe(a.undo + 1)
    expect([...a2.selected].sort()).toEqual(['ar', 'ar2'])
    await storeCaller(page)('undo')
    expect((await state(page, 'ar')).coords).toBe(a.coords)
    expect((await state(page, 'ar2')).coords).toBe(b.coords)
  })

  test('Cmd/Ctrl-drag on a multi-selection keeps the selection', async ({ page }) => {
    await storeCaller(page)('setSelection', ['ar', 'ar2'])
    await page.waitForTimeout(250)
    const a = await state(page, 'ar')
    await page.keyboard.down('ControlOrMeta')
    await drag(page, await pressPoint(page, 'ar2'), 50, -30)
    await page.keyboard.up('ControlOrMeta')
    await expect.poll(async () => (await state(page, 'ar')).coords).not.toBe(a.coords)
    await page.waitForTimeout(200)
    expect([...(await state(page, 'ar')).selected].sort()).toEqual(['ar', 'ar2'])
  })

  test('a click on the selected area stays a click, a press under the slop moves nothing', async ({ page }) => {
    await storeCaller(page)('selectFeature', 'ar')
    await page.waitForTimeout(250)
    const before = await state(page, 'ar')
    const p = await pressPoint(page, 'ar')
    // Jitter: 5 px, under the 8 px slop.
    await drag(page, p, 4, 3, 3)
    await page.waitForTimeout(150)
    let now = await state(page, 'ar')
    expect(now.coords).toBe(before.coords)
    expect(now.undo).toBe(before.undo)
    expect(now.selected).toEqual(['ar'])
    // A click on another feature still selects it.
    await page.mouse.click(...Object.values(await pressPoint(page, 'ar2')) as [number, number])
    await expect.poll(async () => (await state(page, 'ar')).selected).toEqual(['ar2'])
    // A double-click on the selected area still enters point editing.
    await storeCaller(page)('selectFeature', 'ar')
    await page.waitForTimeout(300)
    await page.mouse.dblclick(p.x, p.y)
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
    now = await state(page, 'ar')
    expect(now.coords).toBe(before.coords)
  })

  test('cursor: move over a selected feature, unchanged over an unselected one, grabbing while moving', async ({ page }) => {
    await storeCaller(page)('selectFeature', 'ar')
    await page.waitForTimeout(250)
    const p = await pressPoint(page, 'ar')
    const q = await pressPoint(page, 'ar2')
    await page.mouse.move(q.x, q.y)
    await page.mouse.move(q.x + 1, q.y + 1)
    await expect.poll(() => cursorAt(page, { x: q.x + 1, y: q.y + 1 })).toBe('pointer')
    await page.mouse.move(p.x, p.y)
    await expect.poll(async () => { await page.mouse.move(p.x + 1, p.y); await page.mouse.move(p.x, p.y); return cursorAt(page, p) }).toBe('move')
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(p.x + i * 6, p.y)
    expect(await cursorAt(page, { x: p.x + 30, y: p.y })).toBe('grabbing')
    await page.mouse.up()
  })

  test('readonly: a plain drag on the selected feature pans instead', async ({ page }) => {
    await page.goto('/?readonly=1')
    await waitForMap(page)
    await importGeoJSON(page, FC)
    await flyTo(page, [48.856, 2.345], 14)
    await page.waitForTimeout(300)
    await storeCaller(page)('selectFeature', 'ar')
    await page.waitForTimeout(250)
    const before = await state(page, 'ar')
    await drag(page, await pressPoint(page, 'ar'), 60, 40)
    await expect.poll(async () => (await state(page, 'ar')).center[0]).not.toBeCloseTo(before.center[0], 9)
    expect((await state(page, 'ar')).coords).toBe(before.coords)
  })
})
