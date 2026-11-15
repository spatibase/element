import { test, expect, ATTRIBUTION, type Page, type Locator } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON, mapBox, featureCount } from './helpers'

// Fail on React's setState-in-render warning (and any other console error).
function watchConsole(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  return () => expect(errors.filter((e) => /Cannot update a component|while rendering a different component/.test(e) || !/Failed to load resource|tile/i.test(e))).toEqual([])
}

const box = async (l: Locator) => (await l.boundingBox())!
const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function selectFeature(page: Page, id: string) {
  await page.evaluate((fid) => window.__elementEditorTest!.dataStore.getState().selectFeature(fid), id)
}

const CUSTOM = {
  leftCenter: [{ group: ['fitBounds', 'separator', 'locate'] }],
  bottomLeft: [{ group: ['table', 'schema'] }, 'settings'],
  bottomRight: ['toolbar'],
  statusLeft: ['undo'],
  statusRight: [{ group: ['redo', 'keyboard'] }, 'separator', 'attribution'],
}

test.describe('config.ui.layout', () => {
  // Dev-only `[element-editor]` warnings (warnOnce) logged by the page.
  const elmWarnings = (page: Page) => {
    const out: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[element-editor]')) out.push(m.text()) })
    return out
  }

  test('withLayout moves one control and keeps the rest of the default, with no warnings', async ({ page }) => {
    const check = watchConsole(page)
    const warnings = elmWarnings(page)
    await page.goto('/?layoutPatch=' + encodeURIComponent(JSON.stringify({ move: { table: 'bottomRight', attribution: 'statusRight' }, hide: ['keyboard'] })))
    await waitForMap(page)
    const slot = (s: string) => page.locator(`[data-elm-slot="${s}"]`)
    await expect(slot('bottomRight').getByRole('button', { name: /show table|hide table/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /show table|hide table/i })).toHaveCount(1)
    // The rest of the default stays where it was.
    await expect(slot('topCenter').getByRole('button', { name: 'Area', exact: true }).first()).toBeVisible()
    await expect(slot('leftCenter').getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(slot('bottomLeft').getByRole('button', { name: /editor settings/i })).toBeVisible()
    await expect(page.locator(`[data-elm-status-bar] [data-elm-slot="statusRight"] [data-elm-attribution] ${ATTRIBUTION}`)).toBeVisible()
    await expect(page.getByRole('button', { name: /keyboard shortcuts/i })).toHaveCount(0)
    expect(warnings).toEqual([])
    check()
  })

  test('a layout without the toolbar or Apply changes warns once in development', async ({ page }) => {
    const warnings = elmWarnings(page)
    await page.goto('/?submit=1&layout=' + encodeURIComponent(JSON.stringify({ bottomLeft: ['fitBounds'] })))
    await waitForMap(page)
    await expect(page.locator('[data-elm-slot="bottomLeft"]').getByRole('button', { name: /fit map/i })).toBeVisible()
    await expect.poll(() => warnings.length).toBeGreaterThanOrEqual(2)
    expect(warnings.filter((w) => w.includes("'toolbar' isn't placed, so the drawing tools are reachable only by keyboard shortcut"))).toHaveLength(1)
    expect(warnings.filter((w) => w.includes("onSubmit is set but 'applyChanges' isn't placed"))).toHaveLength(1)
  })

  test('places controls, groups and separators where the layout says', async ({ page }) => {
    const check = watchConsole(page)
    await page.goto('/?layout=' + encodeURIComponent(JSON.stringify(CUSTOM)))
    await waitForMap(page)
    const slot = (s: string) => page.locator(`[data-elm-slot="${s}"]`)

    // leftCenter: one vertical pill with a divider between the two buttons.
    const lc = slot('leftCenter').locator('[data-elm-group]')
    await expect(lc).toHaveCount(1)
    await expect(lc.getByRole('button', { name: /fit map to features/i })).toBeVisible()
    await expect(lc.getByRole('button', { name: /show my location/i })).toBeVisible()
    await expect(lc.locator('[data-elm-separator]')).toHaveCount(1)
    const [fit, loc] = [await box(lc.getByRole('button', { name: /fit map/i })), await box(lc.getByRole('button', { name: /my location/i }))]
    expect(loc.y).toBeGreaterThan(fit.y + fit.height) // vertical

    // bottomLeft: group (table + schema), settings.
    const bl = slot('bottomLeft')
    await expect(bl.locator('[data-elm-group]').getByRole('button')).toHaveCount(2)
    await expect(bl.getByRole('button', { name: /editor settings/i })).toBeVisible()

    // Toolbar in bottomRight only; nothing at the top.
    await expect(slot('bottomRight').getByRole('button', { name: 'Area', exact: true }).first()).toBeVisible()
    await expect(page.locator('[data-elm-slot="topCenter"] > *')).toHaveCount(0)

    // Status bar: undo left; redo + keyboard group, then attribution, right.
    const bar = page.locator('[data-elm-status-bar]')
    await expect(bar.locator('[data-elm-slot="statusLeft"]').getByRole('button', { name: 'Undo' })).toBeVisible()
    const sr = bar.locator('[data-elm-slot="statusRight"]')
    await expect(sr.locator('[data-elm-group]').getByRole('button', { name: 'Redo' })).toBeVisible()
    await expect(sr.locator('[data-elm-group]').getByRole('button', { name: /keyboard shortcuts/i })).toBeVisible()
    await expect(sr.locator(`[data-elm-attribution] ${ATTRIBUTION}`)).toBeVisible()

    // Unlisted controls are hidden (GeoJSON, zoom indicator); each control renders once.
    await expect(page.getByRole('button', { name: /show geojson/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /set map zoom level/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(1)

    // Undo/redo shortcuts keep working with the buttons moved.
    await importGeoJSON(page, SAMPLE_GEOJSON)
    const count = () => featureCount(page)
    await bar.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(count).toBe(0)
    await sr.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(count).toBe(2)
    check()
  })

  test('right slots clear the open layers panel; a crowded bottom row wraps instead', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    const check = watchConsole(page)
    await page.goto('/?layout=' + encodeURIComponent(JSON.stringify({ ...CUSTOM, bottomLeft: ['zoomIndicator', { group: ['table', 'schema', 'geojson'] }, 'settings', 'keyboard'], statusRight: [] })))
    await waitForMap(page)
    const panel = await box(page.locator('aside')) // the layers panel
    const br = await box(page.locator('[data-elm-slot="bottomRight"]'))
    const bl = await box(page.locator('[data-elm-slot="bottomLeft"]'))
    expect(br.x + br.width).toBeLessThanOrEqual(panel.x)
    expect(intersects(br, bl)).toBe(false)
    const edge = page.locator('[data-elm-edge="bottom"]')
    await expect(edge).toHaveAttribute('data-elm-wrap', '')
    // Room again → back on one row.
    await page.setViewportSize({ width: 1700, height: 800 })
    await expect(edge).not.toHaveAttribute('data-elm-wrap', '')
    check()
  })

  test('default layout at 1000px: bottom-left buttons never overlap the editing toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const check = watchConsole(page)
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await selectFeature(page, 'e2e-line-1')
    const ctx = page.locator('[data-elm-contextual]')
    await expect(ctx.getByRole('button').first()).toBeVisible()
    const a = await box(page.locator('[data-elm-slot="bottomLeft"]'))
    const b = await box(ctx)
    expect(intersects(a, b)).toBe(false)
    // Lifted above the row, not merely beside it.
    expect(b.y + b.height).toBeLessThanOrEqual(a.y)
    check()
  })

  test('split layout: no render warnings, the map adapter keeps layout="split"', async ({ page }) => {
    const check = watchConsole(page)
    await page.goto('/?editorLayout=split')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await selectFeature(page, 'e2e-line-1')
    await expect(page.locator('[data-elm-contextual]').getByRole('button').first()).toBeVisible()
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().layout)).toBe('split')
    check()
  })

  test('default layout at 1800px keeps the editing toolbar on the row when it fits', async ({ page }) => {
    // 1800, not 1600: since lines got Simplify / Smooth / Buffer, the centred line toolbar is ~276 px
    // and at 1600 it comes within the gap of MapLibre's 9-button bottomLeft group, so it (correctly) lifts.
    await page.setViewportSize({ width: 1800, height: 800 })
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    // A point: its toolbar (duplicate, delete) fits between the bottom slots. A line's
    // got wider when lines gained simplify / smooth / buffer and lifts above the row.
    await selectFeature(page, 'e2e-point-1')
    const ctx = page.locator('[data-elm-contextual]')
    await expect(ctx.getByRole('button').first()).toBeVisible()
    // The row settles after the slots are measured (a frame or two).
    await expect.poll(async () => {
      const a = await box(page.locator('[data-elm-slot="bottomLeft"]'))
      const b = await box(ctx)
      return !intersects(a, b) && Math.abs((b.y + b.height) - (a.y + a.height)) < 2
    }).toBe(true)
  })

  const SIX = ['fitBounds', 'locate', 'zoomIndicator', 'table', 'schema', 'geojson', 'settings']
  const noOverlap = async (page: Page, slots: string[]) => {
    const boxes = await Promise.all(slots.map((s) => box(page.locator(`[data-elm-slot="${s}"]`))))
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].height, slots[i]).toBeGreaterThan(0)
      for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j]), `${slots[i]} × ${slots[j]}`).toBe(false)
    }
    return boxes
  }

  test('left edge: a tall vertical topLeft column pushes leftCenter down instead of overlapping', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 })
    const check = watchConsole(page)
    await page.goto('/?layout=' + encodeURIComponent(JSON.stringify({
      topCenter: ['toolbar'],
      topLeft: { items: SIX, direction: 'vertical' },
      leftCenter: [{ group: ['undo', 'redo'] }],
      bottomLeft: { items: ['keyboard'], direction: 'vertical' },
    })))
    await waitForMap(page)
    const [tl, lc] = await noOverlap(page, ['topLeft', 'leftCenter', 'bottomLeft'])
    // Pushed to sit right below the column (8px gap), not merely somewhere else.
    expect(Math.abs(lc.y - (tl.y + tl.height + 8))).toBeLessThan(2)
    // Room again → centered on the map.
    await page.setViewportSize({ width: 1000, height: 1100 })
    await expect.poll(async () => {
      const [b, m] = [await box(page.locator('[data-elm-slot="leftCenter"]')), await mapBox(page)]
      return Math.abs((b.y + b.height / 2) - (m.y + m.height / 2))
    }).toBeLessThan(2)
    check()
  })

  test('right edge with the layers panel open: topRight column, rightCenter and bottomRight never overlap or cover the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 })
    const check = watchConsole(page)
    await page.goto('/?layout=' + encodeURIComponent(JSON.stringify({
      topCenter: ['toolbar'],
      topRight: { items: SIX, direction: 'vertical' },
      rightCenter: [{ group: ['undo', 'redo'] }],
      bottomRight: ['keyboard'],
    })))
    await waitForMap(page)
    const panel = await box(page.locator('aside')) // the layers panel
    await expect.poll(async () => (await noOverlap(page, ['topRight', 'rightCenter', 'bottomRight']))
      .every((b) => b.x + b.width <= panel.x)).toBe(true)
    check()
  })
})

