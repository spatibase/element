import { test, expect, type Page } from './fixtures'
import { waitForMap, importGeoJSON } from './helpers'

// The editor is usable at phone and tablet widths. Widths are the
// editor's own (it fills the viewport in the dev app, but layout reads the
// container, not the viewport).

const SQUARE = JSON.stringify({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 'sq', properties: { name: 'Square' }, geometry: { type: 'Polygon', coordinates: [[[14.40, 50.08], [14.43, 50.08], [14.43, 50.10], [14.40, 50.10], [14.40, 50.08]]] } }],
})

type Box = { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

/** Every visible button that sticks out of the editor (closed panels slide out below / to the right and are inert). */
function buttonsOutside(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-elm-theme]')!.getBoundingClientRect()
    const out: string[] = []
    for (const b of document.querySelectorAll<HTMLElement>('[data-elm-theme] button')) {
      const r = b.getBoundingClientRect()
      if (r.width === 0 || b.closest('[inert]') || r.top >= root.bottom - 0.5) continue
      if (r.left < root.left - 0.5 || r.right > root.right + 0.5 || r.top < root.top - 0.5 || r.bottom > root.bottom + 0.5) {
        out.push(`${b.getAttribute('aria-label') ?? b.textContent?.trim()} @${Math.round(r.left)},${Math.round(r.top)}`)
      }
    }
    return out
  })
}

const toolbarButtons = (page: Page) => page.locator('[data-elm-slot="topCenter"] button')

async function setup(page: Page, width: number) {
  await page.setViewportSize({ width, height: 760 })
  await page.goto('/')
  await waitForMap(page)
  await importGeoJSON(page, SQUARE)
  // A selection shows the editing toolbar too.
  await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectFeature('sq'))
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
}

test.describe('narrow editor', () => {
  test('375 px: panel starts collapsed, every control is inside the editor, the toolbar compacts', async ({ page }) => {
    await setup(page, 375)
    const panel = page.locator('[data-elm-layers-panel]')
    const root = (await page.locator('[data-elm-theme]').first().boundingBox())!
    // Collapsed: off the right edge and out of the tab order.
    expect((await panel.boundingBox())!.x).toBeGreaterThanOrEqual(root.x + root.width - 1)
    await expect(page.getByRole('button', { name: 'Open layers panel' })).toBeVisible()
    expect(await buttonsOutside(page)).toEqual([])
    // Search sits behind an icon; its popup opens inside the editor.
    await expect(page.getByPlaceholder('Search places…')).toHaveCount(0)
    await page.locator('[data-elm-slot="topCenter"]').getByRole('button', { name: 'Search places' }).click()
    const input = page.getByPlaceholder('Search places…')
    await expect(input).toBeFocused()
    const ib = (await input.boundingBox())!
    expect(ib.x).toBeGreaterThanOrEqual(root.x)
    expect(ib.x + ib.width).toBeLessThanOrEqual(root.x + root.width)
    await page.keyboard.press('Escape')

    // Opened, the panel overlays the map (above the toolbar) and leaves a strip of map.
    await page.getByRole('button', { name: 'Open layers panel' }).click()
    await expect(page.getByRole('button', { name: 'Collapse layers panel' })).toBeVisible()
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeLessThan(root.x + root.width - 200)
    const pb = (await panel.boundingBox())!
    expect(pb.width).toBeLessThanOrEqual(root.width - 48)
    const tb = (await toolbarButtons(page).first().boundingBox())!
    // The controls don't move aside for an overlay panel…
    expect(tb.x).toBeLessThan(pb.x)
    // …and where they meet, the panel is on top.
    const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-elm-layers-panel]'), { x: pb.x + 8, y: tb.y + tb.height / 2 })
    expect(hit).toBe(true)
  })

  test('375 px: the editing toolbar wraps into even rows, never a lone Delete', async ({ page }) => {
    await setup(page, 375)
    const rows = () => page.evaluate(() => {
      const del = document.querySelector('button[aria-label="Delete"]')!
      const bar = del.closest('.flex-wrap')!
      const counts = new Map<number, number>()
      for (const b of bar.querySelectorAll('button')) {
        const r = b.getBoundingClientRect()
        const y = Math.round(r.top + r.height / 2)
        counts.set(y, (counts.get(y) ?? 0) + 1)
      }
      return [...counts.values()]
    })
    await expect.poll(async () => (await rows()).length).toBe(2)
    const counts = await rows()
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    // Wide again: one row.
    await page.setViewportSize({ width: 1024, height: 760 })
    await expect.poll(async () => (await rows()).length).toBe(1)
  })

  test('768 px: the toolbar and the bottom buttons stay clear of the open layers panel', async ({ page }) => {
    await setup(page, 768)
    const panel = page.locator('[data-elm-layers-panel]')
    await expect(page.getByRole('button', { name: 'Collapse layers panel' })).toBeVisible()
    const pb = (await panel.boundingBox())!
    expect(await buttonsOutside(page)).toEqual([])
    for (const slot of ['topCenter', 'bottomLeft', 'leftCenter']) {
      for (const b of await page.locator(`[data-elm-slot="${slot}"] button`).all()) {
        const bb = await b.boundingBox()
        if (bb) expect(overlap(bb, pb), `${slot} ${await b.getAttribute('aria-label')}`).toBe(false)
      }
    }
    for (const b of await page.locator('[data-elm-contextual] button').all()) {
      const bb = await b.boundingBox()
      if (bb) expect(overlap(bb, pb)).toBe(false)
    }
  })

  test('a narrow docked inspector covers the map instead of pushing the controls off it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 })
    await page.goto('/?inspector=docked')
    await waitForMap(page)
    // Nothing is squeezed out of the editor while it's open.
    expect(await buttonsOutside(page)).toEqual([])
    const offset = await page.evaluate(() => getComputedStyle(document.querySelector('[data-elm-theme]')!).getPropertyValue('--elm-panel-offset').trim())
    expect(offset).toBe('0px')
  })

  test('widening the editor puts the panel back beside the map', async ({ page }) => {
    await setup(page, 375)
    await page.setViewportSize({ width: 1024, height: 760 })
    await page.getByRole('button', { name: 'Open layers panel' }).click()
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-elm-theme]')!).getPropertyValue('--elm-panel-offset').trim())).toBe('288px')
    // The full search box is back; nothing sticks out once the panel has slid in.
    await expect(page.getByPlaceholder('Search places…')).toBeVisible()
    await expect.poll(() => buttonsOutside(page)).toEqual([])
  })
})
