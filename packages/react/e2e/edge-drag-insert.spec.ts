/**
 * Vertex edit: grabbing an edge anywhere along it (where the edge-snap diamond
 * shows under the cursor) and dragging inserts a new point at the drop
 * position — live preview during the drag, one undo step. Real mouse events,
 * both engines, polygon and line.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawPolygon, drawLine, screenPoint } from './helpers'

type Pt = { x: number; y: number }

function ringOf(page: Page): Promise<number[][]> {
  return page.evaluate(() => {
    const g = window.__elementEditorTest!.dataStore.getState().features[0].geometry as { type: string; coordinates: unknown }
    return (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g.coordinates) as number[][]
  })
}

const undoDepth = (page: Page) => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)

/** Mouse-drag from a point 1/4 along edge 0 (moved `off` px up, i.e. beside the
 *  edge but inside the snap band where the diamond shows) to `offset` away. */
async function dragEdge(page: Page, offset: Pt, off = 0): Promise<{ start: Pt; drop: Pt }> {
  const ring = await ringOf(page)
  const [a, b] = [ring[0], ring[1]]
  const onEdge = await screenPoint(page, a[0] + (b[0] - a[0]) / 4, a[1] + (b[1] - a[1]) / 4)
  const start = { x: onEdge.x, y: onEdge.y - off }
  // Approach like a real user: come from inside the map, hover the edge.
  await page.mouse.move(start.x + 5, start.y + 30)
  await page.mouse.move(start.x, start.y, { steps: 5 })
  await page.waitForTimeout(100)
  await page.mouse.down()
  const drop = { x: start.x + offset.x, y: start.y + offset.y }
  await page.mouse.move(drop.x, drop.y, { steps: 10 })
  return { start, drop }
}

async function expectInsertedAt(page: Page, before: number[][], drop: Pt) {
  const after = await ringOf(page)
  expect(after.length).toBe(before.length + 1)
  const p = await screenPoint(page, after[1][0], after[1][1])
  expect(Math.hypot(p.x - drop.x, p.y - drop.y)).toBeLessThan(3)
}

test.describe('Vertex edit — drag an edge to insert a point', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('polygon: drag from anywhere on an edge inserts a point, live preview, one undo', async ({ page }) => {
    await drawPolygon(page)
    await page.keyboard.press('Enter')
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    const before = await ringOf(page)
    const undoBefore = await undoDepth(page)

    const { drop } = await dragEdge(page, { x: 0, y: -50 })
    // Live preview: the map shows the new point under the cursor before mouseup.
    // (Store is committed only on mouseup.)
    expect((await ringOf(page)).length).toBe(before.length)
    // Map did not pan during the drag.
    const a0 = await screenPoint(page, before[0][0], before[0][1])
    await page.mouse.up()
    const a1 = await screenPoint(page, before[0][0], before[0][1])
    expect(Math.hypot(a1.x - a0.x, a1.y - a0.y)).toBeLessThan(1)

    await expectInsertedAt(page, before, drop)
    expect(await undoDepth(page)).toBe(undoBefore + 1)
    // Still in vertex edit.
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)

    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    expect(await ringOf(page)).toEqual(before)
  })

  for (const off of [12, -12]) {
    test(`polygon: grabbing ${Math.abs(off)} px ${off > 0 ? 'outside' : 'inside'} the edge (diamond showing) inserts a point`, async ({ page }) => {
      await drawPolygon(page)
      await page.keyboard.press('Enter')
      await expect(page.locator('.elm-vertex').first()).toBeVisible()
      const before = await ringOf(page)
      const undoBefore = await undoDepth(page)

      const { drop } = await dragEdge(page, { x: 15, y: -40 }, off)
      await page.mouse.up()

      await expectInsertedAt(page, before, drop)
      expect(await undoDepth(page)).toBe(undoBefore + 1)
    })
  }

  test('dragging inside the polygon, away from its edges, does not insert a point', async ({ page }) => {
    const { cx, cy } = await drawPolygon(page)
    await page.keyboard.press('Enter')
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    const before = await ringOf(page)
    await page.mouse.move(cx, cy, { steps: 3 })
    await page.mouse.down()
    await page.mouse.move(cx + 20, cy + 10, { steps: 5 })
    await page.mouse.up()
    expect(await ringOf(page)).toEqual(before)
  })

  test('line: drag from anywhere on a segment inserts a point', async ({ page }) => {
    await drawLine(page)
    await page.keyboard.press('Enter')
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    const before = await ringOf(page)
    const undoBefore = await undoDepth(page)

    const { drop } = await dragEdge(page, { x: 10, y: 50 })
    await page.mouse.up()

    await expectInsertedAt(page, before, drop)
    expect(await undoDepth(page)).toBe(undoBefore + 1)
  })

  test('polygon: dragging the hovered midpoint diamond inserts a point at the drop position', async ({ page }) => {
    await drawPolygon(page)
    await page.keyboard.press('Enter')
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    const before = await ringOf(page)
    const undoBefore = await undoDepth(page)

    const mid = await screenPoint(page, (before[0][0] + before[1][0]) / 2, (before[0][1] + before[1][1]) / 2)
    await page.mouse.move(mid.x, mid.y + 30)
    await page.mouse.move(mid.x, mid.y, { steps: 5 })
    await expect(page.locator('.elm-midpoint-marker:visible')).toHaveCount(1)
    await page.mouse.down()
    const drop = { x: mid.x + 20, y: mid.y - 50 }
    await page.mouse.move(drop.x, drop.y, { steps: 10 })
    await page.mouse.up()

    await expectInsertedAt(page, before, drop)
    expect(await undoDepth(page)).toBe(undoBefore + 1)
  })
})
