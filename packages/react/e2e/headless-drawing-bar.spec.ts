/**
 * Headless hosts (only the adapter's `ElementEditorControls`, own toolbar, tools driven by the ref) get
 * the drawing bar from the controls themselves, on both adapters, in a phone context (Pixel 7): the
 * hint + Done / Undo point / Cancel appear while a tool is on, Done commits exactly the tapped points
 * (a press on the bar never reaches the map or the host), and `drawingBar={false}` renders no bar.
 * The page is apps/demo's `?headless=<engine>` (HeadlessDemo); the drop-in is checked in touch.spec.ts.
 */
import { devices } from '@playwright/test'
import { test, expect, type Page, type Locator } from './fixtures'

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

/** Tap three points in the map area (left of the host cluster is avoided: they sit mid-map). */
async function tapThree(page: Page) {
  const box = (await page.locator(HOST).boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2 - 60
  for (const [dx, dy] of [[-80, 0], [0, 40], [80, 0]]) {
    await page.touchscreen.tap(cx + dx, cy + dy)
    await page.waitForTimeout(350)
  }
  return box
}

/** The element at the centre of `loc` is `loc` itself (or inside it): nothing covers it. */
const uncovered = (loc: Locator) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return !!top && (el === top || el.contains(top))
})

for (const engine of ['leaflet', 'maplibre'] as const) {
  test.describe(`headless ${engine} placement`, () => {
    test('narrow map: compact bar, at most 2 rows, Done reachable above the host cluster via --elm-drawing-bar-bottom', async ({ page }) => {
      await open(page, engine, '&width=380&cluster=1&lift=72')
      await page.getByTestId('host-draw-line').tap()
      const box = await tapThree(page)
      const bar = page.locator('[data-elm-drawing-bar]')
      const done = bar.getByRole('button', { name: 'Done' })
      await expect(done).toBeVisible()
      const b = (await bar.locator(':scope > div').boundingBox())!
      expect(b.height).toBeLessThanOrEqual(2 * 44 + 26) // one or two rows of 44 px targets
      expect(b.x).toBeGreaterThanOrEqual(box.x)
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width)
      // One-line hint, cut with an ellipsis; the full text is in the title.
      const hint = bar.locator('[data-elm-hint]')
      expect(await hint.evaluate((e) => e.tagName)).toBe('P')
      expect((await hint.boundingBox())!.height).toBeLessThan(28)
      // Tap targets >= 44 px.
      for (const name of ['Done', 'Undo point', 'Cancel']) expect((await bar.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
      // The lift keeps the bar clear of the cluster.
      const cluster = (await page.getByTestId('host-cluster').boundingBox())!
      expect(b.y + b.height).toBeLessThanOrEqual(cluster.y + 1)
      expect(await uncovered(done)).toBe(true)
      await done.tap()
      await expect.poll(() => lineCoords(page)).not.toBeNull()
      expect(await lineCoords(page)).toHaveLength(3)
    })

    test('{ container }: the bar renders in the host slot under the map, Done commits the tapped points', async ({ page }) => {
      await open(page, engine, '&slot=1')
      await page.getByTestId('host-draw-line').tap()
      await tapThree(page)
      const slot = page.getByTestId('host-slot')
      const bar = slot.locator('[data-elm-drawing-bar]')
      await expect(bar.getByRole('button', { name: 'Done' })).toBeVisible()
      await expect(page.locator('[data-elm-drawing-bar]')).toHaveCount(1)
      const sb = (await slot.boundingBox())!
      const bb = (await bar.boundingBox())!
      expect(bb.width).toBeGreaterThan(sb.width - 4) // static, full width of the slot
      expect(bb.y).toBeGreaterThanOrEqual(sb.y - 1)
      expect(bb.y + bb.height).toBeLessThanOrEqual(sb.y + sb.height + 1)
      const hostBefore = await page.locator(HOST).getAttribute('data-host-clicks')
      await bar.getByRole('button', { name: 'Done' }).tap()
      await expect.poll(() => lineCoords(page)).not.toBeNull()
      expect(await lineCoords(page)).toHaveLength(3)
      expect(await page.locator(HOST).getAttribute('data-host-clicks')).toBe(hostBefore)
    })

    test('{ container: null } shows nothing (not in the map either) until the slot is set', async ({ page }) => {
      await open(page, engine, '&slot=late')
      await page.getByTestId('host-draw-line').tap()
      await page.waitForTimeout(500)
      await expect(page.locator('[data-elm-drawing-bar]')).toHaveCount(0)
      await page.getByTestId('host-mount-slot').tap()
      await expect(page.getByTestId('host-slot').locator('[data-elm-drawing-bar]')).toHaveCount(1, { timeout: 5000 })
    })
  })
}

for (const engine of ['leaflet', 'maplibre'] as const) {
  test.describe(`headless ${engine}`, () => {
    test('the bar shows while a tool is on; Done commits exactly the tapped points', async ({ page }) => {
      await open(page, engine)
      const bar = page.locator('[data-elm-drawing-bar]')
      await expect(bar).toHaveCount(0) // no tool: no wrapper in the DOM either
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

test.describe('headless desktop wide map', () => {
  test.use({ viewport: { width: 1100, height: 700 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' })
  for (const engine of ['leaflet', 'maplibre'] as const) {
    test(`${engine}: unchanged full hint, one row, centred, 16px above the bottom`, async ({ page }) => {
      await open(page, engine)
      await page.getByTestId('host-draw-line').click()
      const box = (await page.locator(HOST).boundingBox())!
      await page.mouse.click(box.x + 400, box.y + 300)
      await page.waitForTimeout(300)
      await page.mouse.click(box.x + 600, box.y + 340)
      await page.waitForTimeout(300)
      const bar = page.locator('[data-elm-drawing-bar]')
      await expect(bar.getByRole('button', { name: /Finish/ })).toBeVisible()
      expect(await bar.locator('[data-elm-hint]').evaluate((e) => e.tagName)).toBe('UL') // not the compact hint
      const b = (await bar.locator(':scope > div').boundingBox())!
      expect(b.height).toBeLessThan(56)
      expect(Math.abs(b.x + b.width / 2 - (box.x + box.width / 2))).toBeLessThan(8)
      expect(Math.abs(box.y + box.height - 16 - (b.y + b.height))).toBeLessThan(2)
    })
  }
})
