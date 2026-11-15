/**
 * `config.ui.geojsonEditorOpen`: the GeoJSON inspector open (and docked) on mount.
 * Dev app params: `?inspector=docked|1`, `?geojson=0` (see src/App.tsx).
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, importGeoJSON, featureCenter, mapBox } from './helpers'

const INSPECTOR = '[aria-label="GeoJSON inspector"]'
const TOP_RIGHT = encodeURIComponent(JSON.stringify({ topCenter: ['toolbar'], topRight: ['settings', 'geojson'] }))

async function open(page: Page, query: string, docked?: '0' | '1') {
  // Each test gets a fresh context (empty localStorage) and navigates once.
  if (docked) await page.addInitScript((v) => localStorage.setItem('elm_code_docked', v), docked)
  await page.goto('/?' + query)
  await waitForMap(page)
}

const focusInInspector = (page: Page) =>
  page.evaluate((sel) => !!document.activeElement?.closest(sel), INSPECTOR)

test.describe('GeoJSON inspector open on load', () => {
  test('docked: open, not focused, and the controls clear the dock', async ({ page }) => {
    // The top-right slot's right edge every frame: it must sit clear of the dock
    // from its first paint (the fallback holds the dock while the chunk loads).
    await page.addInitScript(() => {
      const xs: number[] = []
      ;(window as unknown as { __slotRight: number[] }).__slotRight = xs
      const tick = () => {
        const el = document.querySelector('[data-elm-slot="topRight"]')
        if (el?.children.length) xs.push(Math.round(el.getBoundingClientRect().right))
        if (xs.length < 90) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await open(page, `inspector=docked&layout=${TOP_RIGHT}`)
    const dock = page.locator(`${INSPECTOR}[data-elm-code-docked]`)
    await expect(dock).toBeVisible()
    await expect(dock.locator('.cm-content')).toContainText('FeatureCollection')
    expect(await focusInInspector(page)).toBe(false)

    const dockBox = (await dock.boundingBox())!
    const slotBox = (await page.locator('[data-elm-slot="topRight"]').boundingBox())!
    expect(slotBox.x + slotBox.width).toBeLessThanOrEqual(dockBox.x)
    const dockWidth = await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().codeDockWidth)
    expect(dockWidth).toBe(Math.round(dockBox.width))
    await page.waitForFunction(() => (window as unknown as { __slotRight: number[] }).__slotRight.length >= 90)
    expect(new Set(await page.evaluate(() => (window as unknown as { __slotRight: number[] }).__slotRight)).size).toBe(1)

    // Closed by the user, reopened from the button: now it takes focus as before.
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator(INSPECTOR)).toHaveCount(0)
    await page.getByRole('button', { name: /show geojson/i }).click()
    await expect(dock.locator('.cm-content')).toBeFocused()
  })

  test("the user's saved floating choice wins over 'docked'", async ({ page }) => {
    await open(page, 'inspector=docked', '0')
    const win = page.getByRole('dialog', { name: 'GeoJSON inspector' })
    await expect(win).toBeVisible()
    await expect(win).not.toHaveAttribute('data-elm-code-docked')
    expect(await focusInInspector(page)).toBe(false)
  })

  test('without the option it starts closed', async ({ page }) => {
    await open(page, '')
    await expect(page.getByRole('button', { name: /show geojson/i })).toBeVisible()
    await expect(page.locator(INSPECTOR)).toHaveCount(0)
  })

  test('geojsonEditor: false keeps it closed', async ({ page }) => {
    await open(page, 'inspector=docked&geojson=0')
    await expect(page.getByRole('button', { name: 'Editor settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: /show geojson/i })).toHaveCount(0)
    await expect(page.locator(INSPECTOR)).toHaveCount(0)
  })

  test('minimal layout, readonly', async ({ page }) => {
    await open(page, 'editorLayout=minimal&readonly=1&inspector=docked')
    const dock = page.locator(`${INSPECTOR}[data-elm-code-docked]`)
    await expect(dock.locator('.cm-content')).toBeVisible()
    const dockBox = (await dock.boundingBox())!
    expect(Math.round(dockBox.x + dockBox.width)).toBe(page.viewportSize()!.width)
    expect(await focusInInspector(page)).toBe(false)
  })
})

test.describe('fit with the inspector docked', () => {
  // Far from the start view, so selecting from the list has to move the map.
  const DATA = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'far-poly', properties: { name: 'Far polygon' }, geometry: { type: 'Polygon', coordinates: [[[24.90, 60.15], [24.98, 60.15], [24.98, 60.19], [24.90, 60.19], [24.90, 60.15]]] } },
      { type: 'Feature', id: 'far-pt', properties: { name: 'Far point' }, geometry: { type: 'Point', coordinates: [-9.14, 38.72] } },
    ],
  })

  test('selecting a layer centres it in the visible map, not under the inspector, without layout loop errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(() => window.addEventListener('error', (e) => { if (/ResizeObserver/.test(e.message)) (window as unknown as { __roErr: string[] }).__roErr = [e.message] }))
    await open(page, 'inspector=docked')
    await expect(page.locator(INSPECTOR)).toBeVisible()
    await importGeoJSON(page, DATA)
    const map = await mapBox(page)
    const offset = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-elm-theme]')!).getPropertyValue('--elm-panel-offset')))
    expect(offset).toBeGreaterThan(400) // layers panel + dock
    const visibleCenterX = map.x + (map.width - offset) / 2
    for (const name of ['Far polygon', 'Far point']) {
      await page.locator('[data-elm-layers-panel]').getByText(name, { exact: true }).click()
      await expect.poll(async () => Math.abs((await featureCenter(page, name)).x - visibleCenterX), { timeout: 8000 }).toBeLessThan(30)
      const c = await featureCenter(page, name)
      expect(c.x).toBeLessThan(map.x + map.width - offset)
    }
    expect(await page.evaluate(() => (window as unknown as { __roErr?: string[] }).__roErr ?? [])).toEqual([])
    expect(errors.filter((e) => /ResizeObserver/.test(e))).toEqual([])
  })
})
