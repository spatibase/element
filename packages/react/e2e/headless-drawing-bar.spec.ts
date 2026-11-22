/**
 * Headless hosts (only the adapter's `ElementEditorControls`, own toolbar, tools driven by the ref) get
 * the drawing bar from the controls themselves, on both adapters, in a phone context (Pixel 7): the
 * hint + Done / Undo point / Cancel appear while a tool is on, Done commits exactly the tapped points
 * (a press on the bar never reaches the map or the host), and `drawingBar={false}` renders no bar.
 * The page is apps/demo's `?headless=<engine>` (HeadlessDemo); the drop-in is checked in touch.spec.ts.
 */
import { devices } from '@playwright/test'
import { test, expect, type Page } from './fixtures'

const { defaultBrowserType: _browser, ...pixel7 } = devices['Pixel 7']
test.use({ ...pixel7, baseURL: `http://localhost:${process.env.E2E_DEMO_PORT ?? 5199}` })

const HOST = '[data-host-clicks]'

async function open(page: Page, engine: 'leaflet' | 'maplibre', query = '') {
  await page.goto(`/?headless=${engine}${query}`)
  await page.waitForFunction(() => !!window.__elementEditorTest)
  await page.waitForTimeout(500)
}

const lineCoords = (page: Page) => page.evaluate(() => {
  const g = window.__elementEditorTest!.dataStore.getState().features[0]?.geometry as { coordinates: number[][] } | undefined
  return g?.coordinates ?? null
})

for (const engine of ['leaflet', 'maplibre'] as const) {
  test.describe(`headless ${engine}`, () => {
    test('the bar shows while a tool is on; Done commits exactly the tapped points', async ({ page }) => {
      await open(page, engine)
      const bar = page.locator('[data-elm-drawing-bar]')
      await expect(bar.locator('button')).toHaveCount(0) // no tool, nothing to show
      await page.getByTestId('host-draw-line').tap()
      await expect(bar.getByRole('button', { name: 'Exit' })).toBeVisible()

      const box = (await page.locator(HOST).boundingBox())!
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2 - 60
      for (const [dx, dy] of [[-80, 0], [0, 40], [80, 0]]) {
        await page.touchscreen.tap(cx + dx, cy + dy)
        await page.waitForTimeout(350)
      }
      await expect(bar.getByRole('button', { name: 'Undo point' })).toBeVisible()
      const done = bar.getByRole('button', { name: 'Done' })
      await expect(done).toBeVisible()

      // Bottom centre of the map.
      const b = (await bar.locator(':scope > div').boundingBox())!
      expect(Math.abs(b.x + b.width / 2 - (box.x + box.width / 2))).toBeLessThan(8)
      expect(b.y).toBeGreaterThan(box.y + box.height / 2)

      const hostBefore = await page.locator(HOST).getAttribute('data-host-clicks')
      await done.tap()
      await expect.poll(() => lineCoords(page)).not.toBeNull()
      expect(await lineCoords(page)).toHaveLength(3) // not 4: the tap on Done placed no point
      // The map never saw the press (no point), and React's own click handler still ran (the commit above).
      expect(await page.locator(HOST).getAttribute('data-host-clicks')).toBe(hostBefore)
    })

    test('Undo point takes back a point without adding one', async ({ page }) => {
      await open(page, engine)
      await page.getByTestId('host-draw-line').tap()
      const box = (await page.locator(HOST).boundingBox())!
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2 - 60
      for (const dx of [-80, 0]) {
        await page.touchscreen.tap(cx + dx, cy)
        await page.waitForTimeout(350)
      }
      const inProgress = () => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().lineInProgress.length)
      await expect.poll(inProgress).toBe(2)
      await page.locator('[data-elm-drawing-bar]').getByRole('button', { name: 'Undo point' }).tap()
      await expect.poll(inProgress).toBe(1)
    })

    test('drawingBar={false} renders no bar', async ({ page }) => {
      await open(page, engine, '&drawingBar=0')
      await page.getByTestId('host-draw-line').tap()
      await page.waitForTimeout(500)
      await expect(page.locator('[data-elm-drawing-bar]')).toHaveCount(0)
      await expect(page.locator('[data-elm-hint]')).toHaveCount(0)
    })
  })
}
