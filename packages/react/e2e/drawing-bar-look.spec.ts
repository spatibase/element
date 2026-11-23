/**
 * The drawing bar's public look: `--elm-drawing-bar-height` sizes the bar and its buttons (50 px / 32 px by
 * default), several hints are separated by dividers, and with `config.ui.hints: false` the desktop bar still
 * offers an Undo point button. (The wrapper not being in the DOM while idle is checked in headless-drawing-bar.spec.ts.)
 */
import { test, expect } from './fixtures'
import { waitForMap } from './helpers'

const BAR = '[data-elm-drawing-toolbar]'

async function startPolygon(page: import('@playwright/test').Page, points = 4) {
  await waitForMap(page)
  await page.evaluate((n) => {
    const pts = [[0, 0], [0, 1], [1, 1], [1, 0]].slice(0, n)
    window.__elementEditorTest!.uiStore.setState({ editingMode: 'draw-polygon', polygonInProgress: pts as never })
  }, points)
  await expect(page.locator(BAR)).toBeVisible()
}

test('default bar is 50 px with 32 px buttons; the token resizes both, hint dividers sit between hints', async ({ page }) => {
  await page.goto('/')
  await startPolygon(page)
  const bar = page.locator(BAR)
  expect((await bar.boundingBox())!.height).toBe(50)
  expect((await bar.getByRole('button', { name: /^Cancel/ }).boundingBox())!.height).toBe(32)
  // 3 hints, 2 dividers between them.
  await expect(page.locator('[data-elm-hint] > li:not([data-elm-row-divider])')).toHaveCount(3)
  await expect(page.locator('[data-elm-hint] [data-elm-row-divider]')).toHaveCount(2)

  await page.evaluate(() => document.querySelector<HTMLElement>('[data-elm-theme]')!.style.setProperty('--elm-drawing-bar-height', '40px'))
  await expect.poll(async () => (await bar.boundingBox())!.height).toBe(40)
  expect((await bar.getByRole('button', { name: /^Cancel/ }).boundingBox())!.height).toBe(22)
})

test('hints off: the desktop bar shows Undo point while there is something to undo', async ({ page }) => {
  await page.goto('/?hints=0')
  await startPolygon(page)
  const bar = page.locator(BAR)
  await expect(page.locator('[data-elm-hint]')).toHaveCount(0)
  const undo = bar.getByRole('button', { name: /^Undo point/ })
  await expect(undo).toBeVisible()
  await undo.click()
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length)).toBe(3)
})

test('hints on: no Undo point button on desktop', async ({ page }) => {
  await page.goto('/')
  await startPolygon(page)
  await expect(page.locator(BAR).getByRole('button', { name: /^Undo point/ })).toHaveCount(0)
})
