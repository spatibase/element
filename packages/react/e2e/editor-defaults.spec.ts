/**
 * Defaults for a new user (nothing in localStorage), shortcut press feedback
 * on buttons, and no focus ring on the map surface after a shortcut.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawRect, editingMode, featureCount } from './helpers'

const INSPECTOR = '[aria-label="GeoJSON inspector"]'

/** A new user: drop the settings the e2e fixture seeds for older specs. */
async function freshUser(page: Page) {
  await page.addInitScript(() => { try { localStorage.removeItem('elm_autoExitAfterDraw') } catch {} })
  await page.goto('/')
  await waitForMap(page)
}

/** Record every `data-elm-shortcut` button that gets `data-pressed`. */
async function recordPresses(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __pressed: string[] }
    w.__pressed = []
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement
        if (el.hasAttribute('data-pressed')) w.__pressed.push(el.dataset.elmShortcut!)
      }
    }).observe(document.body, { subtree: true, attributeFilter: ['data-pressed'] })
  })
}
const presses = (page: Page) => page.evaluate(() => (window as unknown as { __pressed: string[] }).__pressed)

test.describe('New-user defaults', () => {
  test('drawing tools stay active after each shape', async ({ page }) => {
    await freshUser(page)
    await drawRect(page)
    await expect.poll(() => featureCount(page)).toBe(1)
    expect(await editingMode(page)).toBe('draw-rect')
  })

  test('a stored "return to select" choice still applies', async ({ page }) => {
    // The fixture stores 'true', as a user who turned the toggle on would have.
    await page.goto('/')
    await waitForMap(page)
    await drawRect(page)
    await expect.poll(() => featureCount(page)).toBe(1)
    expect(await editingMode(page)).toBe('none')
  })

  test('the GeoJSON inspector opens docked', async ({ page }) => {
    await freshUser(page)
    await page.locator(MAP).click()
    await page.keyboard.press('i')
    const dock = page.locator(`${INSPECTOR}[data-elm-code-docked]`)
    await expect(dock).toBeVisible()
    await expect(dock.locator('.cm-content')).toBeFocused()
    // The key that opened it is not typed into the focused editor.
    await expect(dock.locator('.cm-line').first()).toHaveText('{')
    // The toolbar ends at the dock instead of covering its header.
    const [toolbar, header] = [await page.locator('[data-elm-edge="top"]').boundingBox(), await dock.boundingBox()]
    expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(header!.x)
  })
})

test.describe('Shortcut feedback', () => {
  test('a shortcut flashes its button pressed, then releases it', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await recordPresses(page)

    await page.keyboard.press('l')
    await page.keyboard.press('Escape')
    await drawRect(page)
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    // Last: opening the inspector focuses its editor, which keeps Cmd+Z for text.
    await page.keyboard.press('i')
    await expect.poll(() => presses(page)).toEqual(['draw-line', 'draw-rect', 'undo', 'redo', 'toggle-geojson'])
    await expect(page.locator('[data-pressed]')).toHaveCount(0)
  })

  test('a disabled button does not flash (undo with nothing to undo)', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
    await recordPresses(page)
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForTimeout(200)
    expect(await presses(page)).toEqual([])
  })
})

test('no focus ring around the map after interacting and pressing a tool key', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.locator(MAP).click()
  await page.keyboard.press('x')
  await page.keyboard.press('Escape')
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return { focusVisible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, isMap: !!el.closest('.leaflet-container, .maplibregl-map') }
  })
  // Chrome turns on :focus-visible for the clicked (focused) map at the first plain key press.
  expect(focus).toEqual({ focusVisible: true, outline: 'none', isMap: true })
})
