import { test, expect, ATTRIBUTION, ATTRIBUTION_TOGGLE, MAP, type Page } from './fixtures'
import { waitForMap } from './helpers'

/**
 * The map attribution is a licence requirement. Per the OSM Foundation attribution guidelines
 * (https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) it must be visible at load
 * without any interaction; the compact attribution may then collapse to its "i" button on the
 * first map interaction or after five seconds, and that button opens it again.
 *
 * With the default layout it must also be fully on screen and never under a control, at every
 * common width. The drop-in moves the compact attribution into the bottom-right end of its slot
 * row ([data-elm-attribution-corner]), so the row wraps around it instead of covering it.
 *
 * Timing runs on Playwright's fake clock (`page.clock`): it ticks in real time while the page
 * loads, then is paused once the attribution is up, so nothing collapses behind a check's back.
 */
const WIDTHS = [375, 768, 1124, 1440]

/** Expanded attribution's box, plus every editor control that overlaps it. */
async function attributionCheck(page: Page) {
  return page.evaluate((sel) => {
    const attr = document.querySelector<HTMLElement>(sel)!
    const a = attr.getBoundingClientRect()
    const overlapping: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('[data-elm-slot] button, [data-elm-contextual] > *, [data-elm-edge] [data-elm-slot] > *, aside')) {
      if (attr.contains(el) || el.contains(attr) || el.closest('[data-elm-attribution-corner]')) continue
      const b = el.getBoundingClientRect()
      if (b.width && b.height && b.left < a.right - 0.5 && a.left < b.right - 0.5 && b.top < a.bottom - 0.5 && a.top < b.bottom - 0.5) {
        overlapping.push(el.getAttribute('aria-label') ?? el.tagName)
      }
    }
    // What is painted on top of the attribution, sampled along its middle.
    const coveredBy: string[] = []
    for (let i = 1; i < 10; i++) {
      const t = document.elementFromPoint(a.left + (a.width * i) / 10, a.top + a.height / 2)
      if (t && !attr.contains(t) && !t.closest('[data-elm-attribution-corner]')) coveredBy.push(t.getAttribute('aria-label') ?? t.tagName)
    }
    return {
      box: { left: a.left, top: a.top, right: a.right, bottom: a.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      text: attr.textContent ?? '',
      overlapping,
      coveredBy,
    }
  }, ATTRIBUTION)
}

/** The licence link: visible only while the attribution is expanded (on either engine). */
const osmLink = (page: Page) => page.locator(ATTRIBUTION).first().getByRole('link', { name: /OpenStreetMap/ })

/**
 * Loads the default editor with the fake clock installed, waits until the attribution shows its
 * credits, then pauses the clock (the 5 s timer can then only fire through `page.clock`).
 */
async function load(page: Page): Promise<{ mountedAgo: number }> {
  await page.clock.install()
  // Record (on the fake clock) when the map container appears: the collapse timer starts after it.
  await page.addInitScript(() => {
    const w = window as unknown as { __elmMapMountedAt?: number }
    const mo = new MutationObserver(() => {
      if (!document.querySelector('.leaflet-container, .maplibregl-map')) return
      w.__elmMapMountedAt = Date.now()
      mo.disconnect()
    })
    mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  })
  // Offline, MapLibre would only credit the sources that loaded: serve OpenFreeMap's TileJSON
  // (no tiles) so the default basemap's full, widest credit line shows.
  await page.route('https://tiles.openfreemap.org/planet', (r) => r.fulfill({
    json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/none/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 },
  }))
  await page.goto('/')
  await waitForMap(page)
  await expect(page.locator(ATTRIBUTION).first()).toContainText(/OpenStreetMap/)
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250))
  // Let the slot layout settle (it measures in animation frames, which the clock drives now).
  await page.clock.runFor(500)
  // How long ago the map mounted: an upper bound on how long the collapse timer has run. On a slow
  // CI runner the map takes over a second to show its credits.
  return page.evaluate(() => ({ mountedAgo: Date.now() - (window as unknown as { __elmMapMountedAt: number }).__elmMapMountedAt }))
}

test.describe('Map attribution stays visible (default layout)', () => {
  for (const width of WIDTHS) {
    test(`expanded, fully visible and uncovered at load at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await load(page)
      const attr = page.locator(ATTRIBUTION).first()
      // It sits at the end of the shell's bottom slot row, not in the map's own corner.
      await expect(page.locator(`[data-elm-attribution-corner] ${ATTRIBUTION}`)).toHaveCount(1)
      // Expanded without any interaction (both engines).
      await expect(osmLink(page)).toBeVisible()
      await expect(attr).toBeVisible()
      await expect.poll(async () => {
        await page.clock.runFor(50)
        return (await attributionCheck(page)).overlapping
      }).toEqual([])
      const r = await attributionCheck(page)
      expect(r.coveredBy).toEqual([])
      expect(r.box.left).toBeGreaterThanOrEqual(0)
      expect(r.box.top).toBeGreaterThanOrEqual(0)
      expect(r.box.right).toBeLessThanOrEqual(r.viewport.width)
      expect(r.box.bottom).toBeLessThanOrEqual(r.viewport.height)
    })
  }
})

test.describe('Map attribution collapses as the OSMF guidelines allow', () => {
  test('stays expanded under five seconds, collapses after five, the "i" opens it again', async ({ page }) => {
    // The timer started at most `mountedAgo` ms ago (at or after map mount), so it fires between
    // 5000 - mountedAgo and 5000 ms from now. Check just before the earliest and just after the
    // latest, instead of fixed steps that assume the credits showed right after mount.
    const { mountedAgo } = await load(page)
    expect(mountedAgo, 'the map took too long to show its credits for this check').toBeLessThan(4500)
    await page.clock.runFor(4900 - mountedAgo)
    await expect(osmLink(page)).toBeVisible()
    await page.clock.runFor(mountedAgo + 200)
    await expect(osmLink(page)).toBeHidden()
    const toggle = page.locator(ATTRIBUTION_TOGGLE).first()
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(osmLink(page)).toBeVisible()
    // Opened by the user: no timer closes it again.
    await page.clock.runFor(10_000)
    await expect(osmLink(page)).toBeVisible()
  })

  test('collapses on the first map click, before five seconds', async ({ page }) => {
    await load(page)
    await expect(osmLink(page)).toBeVisible()
    const box = (await page.locator(MAP).first().boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(osmLink(page)).toBeHidden()
    await page.locator(ATTRIBUTION_TOGGLE).first().click()
    await expect(osmLink(page)).toBeVisible()
  })

  test('collapses on the first wheel zoom', async ({ page }) => {
    await load(page)
    await expect(osmLink(page)).toBeVisible()
    const box = (await page.locator(MAP).first().boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -200)
    await expect(osmLink(page)).toBeHidden()
  })

  test('using the attribution itself does not count as map interaction', async ({ page }) => {
    await load(page)
    // A press on the attribution text (not on a link) leaves it open.
    const attr = page.locator(ATTRIBUTION).first()
    await attr.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    await expect(osmLink(page)).toBeVisible()
  })
})
