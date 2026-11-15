/**
 * Vertex editing and the drawn-shape tags, on both engines:
 * - a circle / rectangle / route stays one until the first committed point change, which drops
 *   `_drawType` (and a route's `properties._waypoints`) in the same update — one undo brings it back;
 * - deleting a rectangle corner is a plain point delete (it used to be refused);
 * - a 3D polygon keeps every point's altitude through a point drag, and a point
 *   inserted on an edge gets the edge's mean altitude.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawPolygon, drawLine, drawRect, hoverFirstEdgeMidpoint } from './helpers'

type Shape = { drawType?: string; waypoints: unknown; ring: number[][] }

/** Patch the only feature in the store (no undo entry): tag / extra props / altitude. */
function patchFirst(page: Page, patch: { drawType?: string; waypoints?: number[][]; z?: boolean }) {
  return page.evaluate((p) => {
    const ds = window.__elementEditorTest!.dataStore
    ds.setState({
      features: ds.getState().features.map((f, i) => {
        if (i > 0) return f
        const g = f.geometry as { type: string; coordinates: unknown }
        const addZ = (c: number[], k: number) => [c[0], c[1], 100 + k * 10]
        const coordinates = !p.z ? g.coordinates
          : g.type === 'Polygon'
            ? (g.coordinates as number[][][]).map((r) => r.map((c, k) => addZ(c, k === r.length - 1 ? 0 : k)))
            : (g.coordinates as number[][]).map(addZ)
        return {
          ...f,
          ...(p.drawType ? { _drawType: p.drawType as 'circle' } : {}),
          properties: p.waypoints ? { ...f.properties, _waypoints: p.waypoints } : f.properties,
          geometry: { ...f.geometry, coordinates } as typeof f.geometry,
        }
      }),
    })
  }, patch)
}

function first(page: Page): Promise<Shape> {
  return page.evaluate(() => {
    const f = window.__elementEditorTest!.dataStore.getState().features[0]
    const g = f.geometry as { type: string; coordinates: unknown }
    const ring = (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g.coordinates) as number[][]
    return { drawType: f._drawType, waypoints: f.properties._waypoints, ring }
  })
}

const vertexEdit = (page: Page) => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)

async function enterVertexEdit(page: Page) {
  await page.keyboard.press('Enter')
  await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
}

/** Drag the first point marker by (dx, dy) px. */
async function dragFirstPoint(page: Page, dx = 40, dy = -30) {
  const box = (await page.locator('.elm-vertex').first().boundingBox())!
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

test.describe('Vertex edit: circle, rectangle and route tags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('a circle stays a circle until the first point change, which drops _drawType (one undo restores it)', async ({ page }) => {
    await drawPolygon(page)
    await patchFirst(page, { drawType: 'circle' })
    await enterVertexEdit(page)
    await expect(page.getByText('Editing points will turn this circle into a plain shape.')).toBeVisible()

    // In and out without a change: still a circle.
    await page.keyboard.press('Escape')
    await expect.poll(() => vertexEdit(page)).toBe(false)
    await page.waitForTimeout(300) // Leaflet: let the exit settle before the next Enter
    expect((await first(page)).drawType).toBe('circle')

    // First committed point drag converts it, in that same update.
    await enterVertexEdit(page)
    const before = (await first(page)).ring
    await dragFirstPoint(page)
    const after = await first(page)
    expect(after.ring[0]).not.toEqual(before[0])
    expect(after.drawType).toBeUndefined()
    expect(await page.evaluate(() => '_drawType' in window.__elementEditorTest!.dataStore.getState().features[0])).toBe(false)

    // One undo: the circle (geometry and tag) is back.
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    const undone = await first(page)
    expect(undone.drawType).toBe('circle')
    expect(undone.ring).toEqual(before)
  })

  test('inserting a point on a circle converts it too', async ({ page }) => {
    await drawPolygon(page)
    await patchFirst(page, { drawType: 'circle' })
    await enterVertexEdit(page)
    const n = (await first(page)).ring.length
    const mid = await hoverFirstEdgeMidpoint(page)
    await page.mouse.move(mid.x, mid.y)
    await page.mouse.down()
    await page.mouse.move(mid.x + 30, mid.y - 30, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await first(page)).ring.length).toBe(n + 1)
    expect((await first(page)).drawType).toBeUndefined()
  })

  test('a rectangle stays one until the first point change, which drops _drawType (one undo restores it)', async ({ page }) => {
    await drawRect(page)
    expect((await first(page)).drawType).toBe('rectangle')
    await enterVertexEdit(page)
    await expect(page.getByText('Editing points will turn this rectangle into a plain shape.')).toBeVisible()

    // In and out without a change: still a rectangle.
    await page.keyboard.press('Escape')
    await expect.poll(() => vertexEdit(page)).toBe(false)
    await page.waitForTimeout(300) // Leaflet: let the exit settle before the next Enter
    expect((await first(page)).drawType).toBe('rectangle')

    // Dragging a corner moves only that corner and frees the shape, in that same update.
    await enterVertexEdit(page)
    const before = (await first(page)).ring
    await dragFirstPoint(page)
    const after = await first(page)
    expect(after.ring[0]).not.toEqual(before[0])
    expect(after.ring.slice(1, -1)).toEqual(before.slice(1, -1))
    expect(after.drawType).toBeUndefined()
    expect(await page.evaluate(() => '_drawType' in window.__elementEditorTest!.dataStore.getState().features[0])).toBe(false)

    // One undo: the rectangle (geometry and tag) is back.
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    const undone = await first(page)
    expect(undone.drawType).toBe('rectangle')
    expect(undone.ring).toEqual(before)
  })

  test('deleting a rectangle corner works and turns it into a plain shape', async ({ page }) => {
    await drawRect(page)
    await enterVertexEdit(page)
    const n = (await first(page)).ring.length // 4 corners + the closing point
    const box = (await page.locator('.elm-vertex').first().boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.getByRole('button', { name: 'Delete point' }).click()
    await expect.poll(async () => (await first(page)).ring.length).toBe(n - 1)
    expect((await first(page)).drawType).toBeUndefined()
    await expect(page.getByText(/cannot be deleted/)).toHaveCount(0)

    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    const undone = await first(page)
    expect(undone.drawType).toBe('rectangle')
    expect(undone.ring).toHaveLength(n)
  })

  test('a route becomes a plain line on the first point change: _drawType and _waypoints go', async ({ page }) => {
    await drawLine(page)
    await page.waitForTimeout(300)
    const ring = (await first(page)).ring
    await patchFirst(page, { drawType: 'route', waypoints: [ring[0], ring[ring.length - 1]] })
    await enterVertexEdit(page)
    await expect(page.getByText('Editing points will turn this route into a plain line.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => vertexEdit(page)).toBe(false)
    await page.waitForTimeout(300) // Leaflet: let the exit settle before the next Enter
    expect((await first(page)).drawType).toBe('route')

    await enterVertexEdit(page)
    await dragFirstPoint(page)
    const after = await first(page)
    expect(after.drawType).toBeUndefined()
    expect(after.waypoints).toBeUndefined()

    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undo())
    const undone = await first(page)
    expect(undone.drawType).toBe('route')
    expect(undone.waypoints).toHaveLength(2)
  })
})

test.describe('Vertex edit keeps altitude', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('dragging a point of a 3D polygon keeps every Z', async ({ page }) => {
    await drawPolygon(page)
    await patchFirst(page, { z: true })
    const before = (await first(page)).ring
    expect(before.every((c) => c.length === 3)).toBe(true)
    await enterVertexEdit(page)
    await dragFirstPoint(page)
    const after = (await first(page)).ring
    expect(after[0].slice(0, 2)).not.toEqual(before[0].slice(0, 2))
    expect(after.map((c) => c[2])).toEqual(before.map((c) => c[2]))
    // The ring stays closed, with the same altitude at both ends.
    expect(after[after.length - 1]).toEqual(after[0])
  })

  test('a point inserted on a 3D edge gets the mean altitude of its ends', async ({ page }) => {
    await drawPolygon(page)
    await patchFirst(page, { z: true })
    const before = (await first(page)).ring
    await enterVertexEdit(page)
    const mid = await hoverFirstEdgeMidpoint(page)
    await page.mouse.move(mid.x, mid.y)
    await page.mouse.down()
    await page.mouse.move(mid.x + 20, mid.y - 30, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await first(page)).ring.length).toBe(before.length + 1)
    const after = (await first(page)).ring
    expect(after.every((c) => c.length === 3)).toBe(true)
    expect(after[1][2]).toBe((before[0][2] + before[1][2]) / 2)
  })
})
