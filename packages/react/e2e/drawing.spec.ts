/**
 * Drawing tools e2e tests — polygon, line, circle, rectangle, point, freehand.
 * All drawing operations use the keyboard shortcuts defined in @element-editor/core/shortcuts.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON, enableStayInTool } from './helpers'

test.describe('Drawing tools — activation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    // Focus map canvas so keyboard shortcuts fire
    await page.locator(MAP).click()
  })

  test('P activates place-point mode (hint visible)', async ({ page }) => {
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible()
  })

  test('L activates draw-line mode', async ({ page }) => {
    await page.keyboard.press('l')
    await expect(page.getByText(/click to (place the first|add) point/i)).toBeVisible()
  })

  test('G activates draw-polygon mode', async ({ page }) => {
    await page.keyboard.press('g')
    await expect(page.getByText(/click to (place the first|add) point/i)).toBeVisible()
  })

  test('R activates draw-rect mode', async ({ page }) => {
    await page.keyboard.press('r')
    await expect(page.getByText(/click and drag to size/i)).toBeVisible()
    await expect(page.locator('[data-elm-hint] li').filter({ hasText: /for a square/i })).toBeVisible()
  })

  test('O activates draw-circle mode', async ({ page }) => {
    await page.keyboard.press('o')
    await expect(page.getByText(/click and drag to size/i)).toBeVisible()
  })

  test('C activates draw-route mode', async ({ page }) => {
    await page.keyboard.press('c')
    await expect(page.getByText(/click to (add|place).*waypoint/i)).toBeVisible()
  })

  test('Escape cancels active drawing mode', async ({ page }) => {
    await page.keyboard.press('l')
    await expect(page.getByText(/click to (place the first|add) point/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/click to (place the first|add) point/i)).not.toBeVisible()
  })

  test('pressing the same key twice deactivates the mode', async ({ page }) => {
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible()
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).not.toBeVisible()
  })
})

test.describe('Place point', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('clicking map in place-point mode adds feature to list', async ({ page }) => {
    await page.keyboard.press('p')
    const map = page.locator(MAP)
    await map.click({ position: { x: 400, y: 300 } })
    await page.waitForTimeout(300)
    // Feature is added directly — list is no longer empty
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  })

  test('placed point can be renamed via the edit panel', async ({ page }) => {
    await page.keyboard.press('p')
    await page.locator(MAP).click({ position: { x: 400, y: 300 } })
    await page.waitForTimeout(300)
    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()
    await page.locator('aside').locator('input[type="text"]').first().fill('My Point')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await expect(page.getByText('My Point')).toBeVisible()
  })

  test('Escape cancels place-point mode before a click', async ({ page }) => {
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/click to place a point/i)).not.toBeVisible()
    // No feature should have been added. Scope to sidebar — the same empty-state
    // message also renders in the data-table panel, which would cause a strict-mode
    // violation against the raw `getByText(...)` query.
    await expect(page.locator('aside').getByText(/no features yet/i).first()).toBeVisible()
  })
})

test.describe('Draw rectangle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('drag-to-draw rectangle adds feature directly to list', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('r')
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 40, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    // Feature appears directly in the list (no save panel)
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  })

  test('drawn rectangle can be renamed via edit panel', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('r')
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 40, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()
    await page.locator('aside').locator('input[type="text"]').first().fill('My Rect')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await expect(page.getByText('My Rect')).toBeVisible()
  })

  // Regression: the virtualized layer list was empty after Edit → Back because
  // useVirtualizer's getScrollElement() returned null on re-mount (parent ref
  // not yet attached). Assert the row stays visible in the list, not just
  // anywhere on the page (the map text label would give a false positive).
  test('edit panel back button keeps the rectangle row visible', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('r')
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 40, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    await expect(page.locator('aside li')).toHaveCount(1)

    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByRole('button', { name: /back to layers/i })).toBeVisible()

    await page.getByRole('button', { name: /back to layers/i }).click()

    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
    await expect(page.locator('aside li')).toHaveCount(1)
    await expect(page.locator('aside [data-feature-id]')).toHaveCount(1)
  })
})

test.describe('Draw line', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('hint shows each instruction as its own item, without separator dots', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')

    await page.keyboard.press('l')
    await map.click({ position: { x: box.width / 2 - 100, y: box.height / 2 } })
    const items = page.locator('[data-elm-hint] li')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toHaveText('Click to add points')
    await expect(items.nth(1)).toHaveText('Double-click to finish')
    await expect(items.nth(2)).toContainText('Undo last')
    await expect(items.nth(2).locator('kbd')).toHaveText('⌫')
    await expect(page.locator('[data-elm-hint]')).not.toContainText('·')
  })

  test('Enter commits a line with 2+ vertices and adds it to the list', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')

    await page.keyboard.press('l')
    // Use locator.click({position}) instead of page.mouse.click(absX, absY):
    // Leaflet's click handler rejects events with originalEvent.detail > 1 to
    // guard against double-click; page.mouse.click chains within the dblclick
    // threshold can trip that guard. locator.click moves the cursor first and
    // fires a clean detail=1 event.
    await map.click({ position: { x: box.width / 2 - 100, y: box.height / 2 } })
    await page.waitForTimeout(250)
    await map.click({ position: { x: box.width / 2 + 100, y: box.height / 2 } })
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    // Line is committed directly to the list
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  })

  test('drawn line can be renamed via edit panel', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')

    await page.keyboard.press('l')
    await map.click({ position: { x: box.width / 2 - 100, y: box.height / 2 } })
    await page.waitForTimeout(250)
    await map.click({ position: { x: box.width / 2 + 100, y: box.height / 2 } })
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()
    await page.locator('aside').locator('input[type="text"]').first().fill('My Line')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await expect(page.getByText('My Line')).toBeVisible()
  })
})

test.describe('Draw area', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('Enter commits polygon and adds it directly to list', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('g')
    await page.mouse.click(cx, cy - 60)
    await page.waitForTimeout(200)
    await page.mouse.click(cx + 80, cy + 40)
    await page.waitForTimeout(200)
    await page.mouse.click(cx - 80, cy + 40)
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  })

  test('polygon can be renamed via edit panel', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('g')
    await page.mouse.click(cx, cy - 60)
    await page.waitForTimeout(200)
    await page.mouse.click(cx + 80, cy + 40)
    await page.waitForTimeout(200)
    await page.mouse.click(cx - 80, cy + 40)
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()
    await page.locator('aside').locator('input[type="text"]').first().fill('My Polygon')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await expect(page.getByText('My Polygon')).toBeVisible()
  })
})

test.describe('Draw route', () => {
  test.beforeEach(async ({ page }) => {
    // Stub OSRM so the test doesn't depend on the public demo server.
    // fetchRoute (packages/core/src/utils/routing.ts) calls router.project-osrm.org.
    // Return a straight 2-point geometry matching whatever waypoints the caller asked for.
    await page.route('**/router.project-osrm.org/route/**', (route) => {
      const url = new URL(route.request().url())
      // URL path is /route/v1/foot/LON,LAT;LON,LAT?...
      const coordsSeg = url.pathname.split('/').pop() || ''
      const coords: [number, number][] = coordsSeg.split(';').map((p) => {
        const [lon, lat] = p.split(',').map(Number)
        return [lon, lat]
      })
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'Ok',
          routes: [{ geometry: { type: 'LineString', coordinates: coords } }],
        }),
      })
    })
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('two waypoints + Enter commits a route to the list', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('c')
    await expect(page.getByText(/click to (add|place).*waypoint/i)).toBeVisible()

    await page.mouse.click(cx - 100, cy)
    await page.waitForTimeout(400)
    await page.mouse.click(cx + 100, cy)
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)

    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  })
})

test.describe('Draw circle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('drag-to-draw circle adds it directly to list', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('o')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 70, cy, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })
  })

  test('a click without drag adds a default circle and selects it (both engines)', async ({ page }) => {
    // The tool stays active (the default): its trailing click used to deselect the circle on MapLibre.
    await enableStayInTool(page)
    await page.goto('/')
    await waitForMap(page)
    const box = (await page.locator(MAP).boundingBox())!
    await page.keyboard.press('o')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(1)
    await page.waitForTimeout(300) // a trailing click must not deselect it
    const s = await page.evaluate(() => {
      const st = window.__elementEditorTest!.dataStore.getState()
      return { id: st.features[0].id, drawType: st.features[0]._drawType, selected: st.selectedIds }
    })
    expect(s.drawType).toBe('circle')
    expect(s.selected).toEqual([s.id])
  })

  test('rectangle: a click without drag creates nothing (as documented)', async ({ page }) => {
    const box = (await page.locator(MAP).boundingBox())!
    await page.keyboard.press('r')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(0)
  })
})

test.describe('Undo drawing', () => {
  test('Ctrl+Z after drawing a shape removes it from the list', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()

    // Draw a rectangle (added directly to list)
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('r')
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 40, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 3000 })

    // Press Escape first to deselect, then undo
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await page.locator(MAP).click()
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(400)
    await expect(page.getByText(/undone/i)).toBeVisible({ timeout: 2000 })
    await expect(page.locator('aside li')).toHaveCount(0, { timeout: 2000 })
  })
})
