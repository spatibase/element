/**
 * Interaction-conventions e2e — locks in the cross-adapter interaction
 * invariants: the modifier-key contract and the selection rules. Runs on both drop-ins (the fixture's `engine`), so the
 * same gesture is proven to do the same thing in both adapters;
 * `e2e/maplibre.spec.ts` covers the bare adapter in apps/demo.
 *
 * State is read via the dev-only `window.__elementEditorTest` handle exposed by
 * `<ElementEditor>` (and `<ElementEditorControls>`).
 */
import { test, expect, type Page, MAP } from './fixtures'
import { waitForMap, enableStayInTool } from './helpers'

async function mapCenter(page: Page) {
  const cbox = await page.locator(MAP).first().boundingBox()
  if (!cbox) throw new Error('no map container')
  return { cx: cbox.x + cbox.width / 2, cy: cbox.y + cbox.height / 2 }
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const t = window.__elementEditorTest!
    const ds = t.dataStore.getState()
    return {
      count: ds.features.length,
      firstCoord:
        ds.features[0]?.geometry?.type === 'Polygon'
          ? ((ds.features[0].geometry.coordinates as number[][][])[0][0])
          : null,
      editingMode: t.uiStore.getState().editingMode,
    }
  })
}

async function drawSquare(page: Page) {
  // Polygon centred on the map: vertices at (cx±100, cy±80).
  const { cx, cy } = await mapCenter(page)
  await page.keyboard.press('g')
  await page.waitForTimeout(120)
  await page.mouse.click(cx - 100, cy - 80)
  await page.waitForTimeout(60)
  await page.mouse.click(cx + 100, cy - 80)
  await page.waitForTimeout(60)
  await page.mouse.click(cx + 100, cy + 80)
  await page.waitForTimeout(60)
  await page.mouse.click(cx - 100, cy + 80)
  await page.waitForTimeout(60)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  return { cx, cy }
}

test.describe('modifier drag while a drawing tool is active', () => {
  // Production default is auto-exit-after-draw; these tests exercise gestures
  // that only make sense while the draw tool stays active post-commit, so opt
  // into stay-in-tool mode (matches the "Return to select after each shape"
  // setting being toggled OFF).
  test.beforeEach(async ({ page }) => { await enableStayInTool(page) })

  test('Cmd+drag translates a polygon (does not add a vertex)', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    const { cx, cy } = await drawSquare(page)
    // Stay in draw-polygon mode (post-commit, per the "stay in tool" convention).
    const before = await readState(page)
    expect(before.editingMode).toBe('draw-polygon')
    expect(before.count).toBe(1)

    await page.keyboard.down('Meta')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 60, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    await page.waitForTimeout(300)

    const after = await readState(page)
    expect(after.count).toBe(1)
    expect(after.firstCoord).not.toEqual(before.firstCoord)
  })

  test('Alt+drag duplicates a polygon (count goes up by 1)', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    const { cx, cy } = await drawSquare(page)
    const before = await readState(page)
    expect(before.count).toBe(1)

    await page.keyboard.down('Alt')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 120, cy + 100, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await page.waitForTimeout(300)

    const after = await readState(page)
    expect(after.count).toBe(2)
  })
})

test.describe('spacebar pan during drawing', () => {
  test('Space+drag pans the map without exiting the active tool', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    const { cx, cy } = await mapCenter(page)

    // The map centre changes when the map pans (either engine).
    function readPanePos() {
      return page.evaluate(() => {
        const c = window.__elementEditorTest!.map.getCenter()
        return `${c.lng},${c.lat}`
      })
    }
    const beforePos = await readPanePos()

    await page.keyboard.press('g')
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('draw-polygon')

    await page.keyboard.down('Space')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 100, cy + 80, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await page.waitForTimeout(300)

    const afterPos = await readPanePos()
    expect(afterPos).not.toBe(beforePos)
    // Tool stays active.
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('draw-polygon')
    // No polygon committed (still no features).
    const after = await readState(page)
    expect(after.count).toBe(0)
  })
})

test.describe('polygon close-tap', () => {
  test('clicking near the first vertex closes the polygon', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('g')
    await page.waitForTimeout(120)
    await page.mouse.click(cx - 80, cy - 80)
    await page.waitForTimeout(60)
    await page.mouse.click(cx + 80, cy - 80)
    await page.waitForTimeout(60)
    await page.mouse.click(cx + 80, cy + 80)
    await page.waitForTimeout(60)
    // Click near the first vertex (within the smart-close 48 px radius)
    // — should commit the polygon without an explicit Enter press.
    await page.mouse.click(cx - 80, cy - 80)
    await page.waitForTimeout(400)
    expect((await readState(page)).count).toBe(before.count + 1)
  })
})

test.describe('Shift constraints during drag-to-draw', () => {
  test('Rectangle: Shift+drag forces a square (mercator-corrected width ≈ height)', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('r')
    await page.waitForTimeout(120)
    await page.keyboard.down('Shift')
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    // Intentionally non-square drag: width 200, height 100. Shift squares it.
    await page.mouse.move(cx + 120, cy + 60, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(400)
    expect((await readState(page)).count).toBe(before.count + 1)

    const wh = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features.at(-1)!
      const ring = (f.geometry.coordinates as number[][][])[0]
      const xs = ring.map(([x]) => x)
      const ys = ring.map(([, y]) => y)
      const dlng = Math.max(...xs) - Math.min(...xs)
      const dlat = Math.max(...ys) - Math.min(...ys)
      const latMid = (Math.max(...ys) + Math.min(...ys)) / 2
      const lngEquivOfLat = dlat / Math.cos((latMid * Math.PI) / 180)
      return { dlng, lngEquivOfLat }
    })
    expect(wh.dlng).toBeGreaterThan(0)
    // 10 % tolerance — screen→geo conversion isn't exact integer-perfect.
    expect(Math.abs(wh.dlng - wh.lngEquivOfLat) / wh.dlng).toBeLessThan(0.1)
  })
})

test.describe('Tab walks selection', () => {
  test('Tab cycles selection forward, Shift+Tab cycles backward', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    // Seed three points so we have something to walk through.
    await page.evaluate(() => {
      window.__elementEditorTest!.dataStore.getState().importGeoJSON({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'A' } },
          { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { name: 'B' } },
          { type: 'Feature', id: 'c', geometry: { type: 'Point', coordinates: [2, 0] }, properties: { name: 'C' } },
        ],
      }, 'replace')
    })
    await page.waitForTimeout(300)
    // Click a sidebar row to give Tab an anchor.
    await page.locator('aside li').filter({ hasText: 'A' }).first().click()
    await page.waitForTimeout(200)

    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    let sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel).toEqual(['b'])

    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel).toEqual(['c'])

    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(150)
    sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel).toEqual(['b'])
  })
})
