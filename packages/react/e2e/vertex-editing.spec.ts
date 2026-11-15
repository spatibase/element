/**
 * Vertex editing e2e tests — enter vertex edit mode, verify vertex markers
 * appear, and test basic vertex manipulation.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawPolygon, drawLine } from './helpers'

test.describe('Vertex editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  // Entry point: press Enter on a selected LineString/Polygon to enter
  // vertex edit mode. The old "Edit points" editing-toolbar button was
  // removed — see FeatureInteractionLayer.tsx:1397 for the Enter handler.
  test('Enter enters vertex edit mode for polygon', async ({ page }) => {
    await drawPolygon(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    // Vertex handles should appear on the map
    const vertexMarkers = page.locator('.elm-vertex')
    await expect(vertexMarkers.first()).toBeVisible({ timeout: 3000 })
  })

  test('vertex edit mode shows midpoint marker on the hovered edge only', async ({ page }) => {
    await drawPolygon(page)
    const box = (await page.locator(MAP).first().boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // drawPolygon leaves the cursor on the last corner, which is on two edges. Rest it
    // away from the shape: MapLibre re-runs hover at the cursor once the new feature has
    // rendered (map idle), which may land after Enter and would rightly show a midpoint.
    await page.mouse.move(cx, cy + 150, { steps: 5 })
    await page.keyboard.press('Enter')
    await expect(page.locator('.elm-vertex').first()).toBeVisible()

    // At rest no midpoint is shown — they appear only when the cursor hovers
    // an edge. (Pre-2026-04-27 behaviour rendered all four midpoints by
    // default, which cluttered the view.) MapLibre keeps them in the DOM, hidden.
    const shown = page.locator('.elm-midpoint-marker:visible')
    await expect(shown).toHaveCount(0)

    // Hover near the top edge of the drawn polygon (drawPolygon places its
    // top edge at cy - 60 with default 80×60 size).
    await page.mouse.move(cx, cy - 60, { steps: 5 })
    await expect(shown).toHaveCount(1)

    // Move the cursor well away from every edge (still over the map) — the midpoint goes.
    await page.mouse.move(cx, cy + 150, { steps: 5 })
    await expect(shown).toHaveCount(0)
  })

  test('Enter enters vertex edit mode for line features', async ({ page }) => {
    await drawLine(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const markers = page.locator('.elm-vertex')
    await expect(markers.first()).toBeVisible({ timeout: 3000 })
  })

  test('Escape exits vertex edit mode', async ({ page }) => {
    await drawPolygon(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    // After escaping, the vertex handles are gone (the polygon stays selected).
    await expect(page.locator('.elm-vertex')).toHaveCount(0)
  })

  // Ground-truth test: confirm @element-editor/react (Leaflet) BLOCKS Cmd+drag while
  // in vertex edit mode. An invisible overlay polygon (bubblingMouseEvents=false)
  // intercepts all polygon-body mousedowns (near an edge: drag-to-insert; else a pan).
  // MapLibre parity: translate/duplicate return early when vertexEditActive.
  test('Cmd+drag does NOT translate the feature while in vertex edit mode', async ({ page }) => {
    await drawPolygon(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })

    const before = await page.evaluate(() => {
      const t = window.__elementEditorTest
      const f = t?.dataStore.getState().features[0]
      return (f?.geometry.coordinates as number[][][])?.[0]?.[0] ?? null
    })
    expect(before).not.toBeNull()

    const box = await page.locator(MAP).boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.down('Meta')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 60, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    await page.waitForTimeout(300)

    const after = await page.evaluate(() => {
      const t = window.__elementEditorTest
      const f = t?.dataStore.getState().features[0]
      return (f?.geometry.coordinates as number[][][])?.[0]?.[0] ?? null
    })
    // Feature must NOT have translated — translate is blocked in vertex edit.
    expect(after).toEqual(before)
    // Vertex edit must still be active.
    expect(await page.evaluate(() => {
      const t = window.__elementEditorTest
      return t?.uiStore.getState().vertexEditActive
    })).toBe(true)
  })

  // Mirrors maplibre.spec.ts:592 — drag a midpoint diamond on a polygon edge to
  // insert a new vertex. Catches regressions where midpoint pointer-events are
  // missing or the drag handler doesn't commit the inserted vertex.
  test('dragging a midpoint diamond inserts a new vertex', async ({ page }) => {
    await drawPolygon(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    // Polygon outer ring vertex count BEFORE the insert (closing point included).
    const before = await page.evaluate(() => {
      const t = window.__elementEditorTest
      const f = t?.dataStore.getState().features[0]
      return ((f?.geometry.coordinates as number[][][])?.[0])?.length ?? 0
    })
    expect(before).toBeGreaterThanOrEqual(5)  // 4 corners + 1 closing for the test polygon

    // Hover an edge to trigger the midpoint marker. drawPolygon places its top
    // edge at cy - height (default 60) — hover halfway along it.
    const box = await page.locator(MAP).boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy - 60, { steps: 5 })
    const midBox = (await page.locator('.elm-midpoint-marker:visible').boundingBox())!
    const midPos = { x: midBox.x + midBox.width / 2, y: midBox.y + midBox.height / 2 }

    // Drag the diamond outward to insert a vertex at the dropped position.
    await page.mouse.move(midPos.x, midPos.y)
    await page.mouse.down()
    await page.mouse.move(midPos.x + 60, midPos.y - 40, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    const after = await page.evaluate(() => {
      const t = window.__elementEditorTest
      const f = t?.dataStore.getState().features[0]
      return ((f?.geometry.coordinates as number[][][])?.[0])?.length ?? 0
    })
    expect(after).toBe(before + 1)  // one new vertex inserted
  })
})

// Point selection + right-click menu. A plain click must never delete: it
// selects only that point; Shift+click toggles; right-click opens a menu with
// "Edit coordinates…" and "Delete point". Mirrored in maplibre.spec.ts.
test.describe('Vertex editing — point click, selection and menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await drawPolygon(page)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await expect(page.locator('.elm-vertex').first()).toBeVisible({ timeout: 3000 })
  })

  const ringLength = (page: Page) => page.evaluate(() => {
    const t = window.__elementEditorTest
    return ((t?.dataStore.getState().features[0]?.geometry.coordinates as number[][][])?.[0])?.length ?? 0
  })
  const pointCenters = (page: Page) => page.evaluate(() =>
    Array.from(document.querySelectorAll('.elm-vertex')).map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }),
  )

  test('plain click selects the point and does not delete it', async ({ page }) => {
    const before = await ringLength(page)
    const [p] = await pointCenters(page)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(200)
    expect(await ringLength(page)).toBe(before)
    await expect(page.getByText('1 point selected')).toBeVisible()
    // Still in vertex edit.
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
    // A second plain click on another point replaces the selection.
    const pts = await pointCenters(page)
    await page.mouse.click(pts[1].x, pts[1].y)
    await page.waitForTimeout(200)
    await expect(page.getByText('1 point selected')).toBeVisible()
  })

  test('right-click → Delete point removes exactly one point', async ({ page }) => {
    const before = await ringLength(page)
    const [p] = await pointCenters(page)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await page.getByRole('button', { name: 'Delete point' }).click()
    await page.waitForTimeout(200)
    expect(await ringLength(page)).toBe(before - 1)
  })

  test('Shift+click two points, then Delete removes both', async ({ page }) => {
    // Pentagon-ish: add a point first so 5 → 3 stays a valid shape.
    const pts0 = await pointCenters(page)
    await page.mouse.click((pts0[0].x + pts0[1].x) / 2, (pts0[0].y + pts0[1].y) / 2)
    await page.waitForTimeout(300)
    const before = await ringLength(page)
    const pts = await pointCenters(page)
    await page.keyboard.down('Shift')
    await page.mouse.click(pts[0].x, pts[0].y)
    await page.mouse.click(pts[1].x, pts[1].y)
    await page.keyboard.up('Shift')
    await expect(page.getByText('2 points selected')).toBeVisible()
    // The selection bar stacks above the bottom-center EditingToolbar, never on it.
    const bar = await page.getByText('2 points selected').boundingBox()
    const toolbar = await page.getByRole('button', { name: 'Duplicate' }).boundingBox()
    expect(bar!.y + bar!.height).toBeLessThan(toolbar!.y)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    expect(await ringLength(page)).toBe(before - 2)
  })

  test('dragging a point moves it without selecting or deleting it', async ({ page }) => {
    const before = await ringLength(page)
    const [p] = await pointCenters(page)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x - 50, p.y - 30, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(await ringLength(page)).toBe(before)
    const moved = await pointCenters(page)
    expect(moved.some((m) => Math.abs(m.x - (p.x - 50)) < 3 && Math.abs(m.y - (p.y - 30)) < 3)).toBe(true)
    await expect(page.getByText(/points? selected/)).toHaveCount(0)
  })

  test('right-click → Edit coordinates… opens the coordinate editor', async ({ page }) => {
    const [p] = await pointCenters(page)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await page.getByRole('button', { name: 'Edit coordinates…' }).click()
    await expect(page.getByText('Precise coordinates')).toBeVisible()
  })
})
