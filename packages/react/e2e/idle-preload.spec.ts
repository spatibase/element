/**
 * The lazy editor panels (GeoJSON inspector, data table, modals) are fetched when the browser is
 * idle, without opening them. Guards the self-registering `lazyWithPreload`: a bundler that drops
 * the registration (it sits inside a call marked pure) would silently turn idle preloading off.
 * Runs on both engines (the project's `engine` option).
 */
import { test, expect } from './fixtures'
import { waitForMap } from './helpers'

test('lazy panel chunks are requested at idle, with no panel open', async ({ page }) => {
  const urls: string[] = []
  page.on('request', (r) => { if (/\.(m?js|tsx?)(\?|$)/.test(r.url())) urls.push(r.url()) })
  await page.goto('/')
  await waitForMap(page)
  // requestIdleCallback has a 3 s timeout, so by then every registered panel has been requested.
  await expect.poll(() => urls.some((u) => /DataTable/.test(u)), { timeout: 15_000 }).toBe(true)
  await expect.poll(() => urls.some((u) => /GeoJSONModal/.test(u)), { timeout: 15_000 }).toBe(true)
  await expect.poll(() => urls.some((u) => /FeatureList/.test(u)), { timeout: 15_000 }).toBe(true)
})
