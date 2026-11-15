/**
 * Escape and the GeoJSON inspector, floating and docked: CodeMirror handles its
 * own Escape first (search panel, a text selection), the next one closes the
 * inspector and focus goes back to the button that opened it. Unapplied typing
 * survives the close. Escape from the map closes the floating window (the top
 * one) but not the docked panel.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, storeCaller } from './helpers'

const INSPECTOR = '[aria-label="GeoJSON inspector"]'
// The 'Desktop Chrome' device reports Windows, so CodeMirror's Mod is Ctrl even on a Mac host.
const MOD = 'Control'
const docText = (page: Page) => page.evaluate(() => (document.querySelector('.cm-content') as any).cmTile.view.state.doc.toString() as string)

async function setup(page: Page, docked: '0' | '1') {
  await page.addInitScript((v) => localStorage.setItem('elm_code_docked', v), docked)
  await page.goto('/')
  await waitForMap(page)
  const ds = storeCaller(page)
  const features = Array.from({ length: 3 }, (_, i) => ({ type: 'Feature', id: `p${i}`, geometry: { type: 'Point', coordinates: [i * 0.1, 45] }, properties: { name: `Point ${i}` } }))
  await ds('importGeoJSON', { type: 'FeatureCollection', features }, 'replace')
  // Opened from the keyboard, as a keyboard user would.
  const opener = page.getByRole('button', { name: /show geojson/i })
  await opener.focus()
  await page.keyboard.press('Enter')
  const inspector = page.locator(INSPECTOR)
  await expect(inspector).toBeVisible()
  await expect(inspector).not.toHaveAttribute('data-loading')
  await expect(inspector.locator('.cm-content')).toBeFocused()
  return { inspector, opener, ds }
}

for (const docked of ['0', '1'] as const) {
  test.describe(docked === '1' ? 'docked' : 'floating', () => {
    test('CodeMirror takes Escape first, then it closes and focus goes back to the button', async ({ page }) => {
      const { inspector, opener } = await setup(page, docked)
      // Search panel: Escape closes the panel only.
      await page.keyboard.press(`${MOD}+f`)
      const search = inspector.locator('.cm-search input[name="search"]')
      await expect(search).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(inspector.locator('.cm-search')).toHaveCount(0)
      await expect(inspector).toBeVisible()
      // A text selection: Escape collapses it.
      await page.keyboard.press(`${MOD}+a`)
      await page.keyboard.press('Escape')
      await expect(inspector).toBeVisible()
      expect(await page.evaluate(() => (document.querySelector('.cm-content') as any).cmTile.view.state.selection.main.empty)).toBe(true)
      // Nothing left for CodeMirror: the inspector closes.
      await page.keyboard.press('Escape')
      await expect(inspector).toHaveCount(0)
      await expect(opener).toBeFocused()
    })

    test('unapplied typing survives an Escape close', async ({ page }) => {
      const { inspector, ds } = await setup(page, docked)
      await ds('selectFeature', 'p1') // scrolls its code into view
      await inspector.locator('.cm-line.cm-feature-highlight', { hasText: '"Point 1"' }).click()
      await page.keyboard.press('End')
      await page.keyboard.type('x')
      await expect(inspector.locator('[data-elm-inspector-problem]')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(inspector).toHaveCount(0)
      await page.getByRole('button', { name: /show geojson/i }).click()
      await expect(inspector).not.toHaveAttribute('data-loading')
      expect(await docText(page)).toContain('"Point 1"x')
    })

    test(docked === '1' ? 'Escape from the map leaves the docked panel open' : 'Escape from the map closes the floating window', async ({ page }) => {
      const { inspector } = await setup(page, docked)
      await page.locator(MAP).click({ position: { x: 20, y: 300 } })
      await page.keyboard.press('Escape')
      if (docked === '1') await expect(inspector).toBeVisible()
      else await expect(inspector).toHaveCount(0)
    })
  })
}
