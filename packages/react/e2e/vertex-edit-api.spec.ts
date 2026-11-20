/**
 * Vertex edit from code, on both engines: `ref.setVertexEdit(id)` / `setVertexEdit(null)` /
 * `getVertexEdit()`, and the `onVertexEditChange` prop (the dev page pushes each call to
 * `window.__vertexEditChanges`) for double-click, Enter, Esc and ref entries/exits alike.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawRect, drawPolygon, selectedIds } from './helpers'

const changes = (page: Page) => page.evaluate(() => (window as unknown as { __vertexEditChanges?: (string | null)[] }).__vertexEditChanges ?? [])
const firstId = (page: Page) => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].id)
const getVertexEdit = (page: Page) => page.evaluate(() => window.__elementEditorRef!.getVertexEdit())
const setVertexEdit = (page: Page, id: string | null) => page.evaluate((i) => window.__elementEditorRef!.setVertexEdit(i), id)

test.describe('Vertex edit from code', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('setVertexEdit on a deselected rectangle: selects it, shows handles and the notice; null leaves', async ({ page }) => {
    await drawRect(page)
    const id = await firstId(page)
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().clearSelection())
    await expect.poll(() => selectedIds(page)).toEqual([])

    expect(await setVertexEdit(page, id)).toBe(true)
    await expect.poll(() => selectedIds(page)).toEqual([id])
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Editing points will turn this rectangle into a plain shape.')).toBeVisible()
    expect(await getVertexEdit(page)).toBe(id)

    expect(await setVertexEdit(page, null)).toBe(true)
    await expect(page.locator('.elm-vertex')).toHaveCount(0)
    expect(await getVertexEdit(page)).toBeNull()
    expect(await selectedIds(page)).toEqual([id]) // selection kept
    expect(await changes(page)).toEqual([id, null])
  })

  test('a map click after a ref entry leaves vertex edit (no click to swallow)', async ({ page }) => {
    await drawPolygon(page)
    const id = await firstId(page)
    await setVertexEdit(page, id)
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
    const box = (await page.locator(MAP).first().boundingBox())!
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.75)
    await expect.poll(() => getVertexEdit(page)).toBeNull()
  })

  test('onVertexEditChange fires once per transition for Enter, Esc, double-click and the ref', async ({ page }) => {
    const { cx, cy } = await drawPolygon(page)
    const id = await firstId(page)
    await page.waitForTimeout(300)

    await page.keyboard.press('Enter')
    await expect.poll(() => getVertexEdit(page)).toBe(id)
    await page.keyboard.press('Escape')
    await expect.poll(() => getVertexEdit(page)).toBeNull()
    await page.waitForTimeout(300)

    await page.mouse.dblclick(cx, cy)
    await expect.poll(() => getVertexEdit(page)).toBe(id)
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    expect(await setVertexEdit(page, null)).toBe(true)
    expect(await setVertexEdit(page, id)).toBe(true)
    expect(await setVertexEdit(page, id)).toBe(true) // already on: no event
    await page.keyboard.press('Escape')
    await expect.poll(() => getVertexEdit(page)).toBeNull()

    expect(await changes(page)).toEqual([id, null, id, null, id, null])
  })

  test('refuses a point and turns a drawing tool off', async ({ page }) => {
    await drawPolygon(page)
    const id = await firstId(page)
    const pointId = await page.evaluate(() => window.__elementEditorRef!.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })!.id)
    expect(await setVertexEdit(page, pointId)).toBe(false)
    expect(await setVertexEdit(page, 'nope')).toBe(false)
    expect(await getVertexEdit(page)).toBeNull()

    await page.evaluate(() => window.__elementEditorRef!.setTool('line'))
    expect(await setVertexEdit(page, id)).toBe(true)
    expect(await page.evaluate(() => window.__elementEditorRef!.getTool())).toBeNull()
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
  })
})
