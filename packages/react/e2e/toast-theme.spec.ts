import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawRect } from './helpers'

// Toasts follow the editor's resolved theme (a dark toast on a dark editor),
// on the panels' surface colour.
async function copyToast(page: Page) {
  await page.goto('/')
  await waitForMap(page)
  // The drawn shape stays selected; copying it confirms with a toast.
  await drawRect(page)
  await page.locator(MAP).focus()
  await page.keyboard.press('ControlOrMeta+c')
  const toast = page.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  return toast.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test('dark editor → dark toast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await copyToast(page)).toBe('rgb(23, 23, 23)')
  await expect(page.locator('[data-elm-theme]').first()).toHaveAttribute('data-elm-theme', 'dark')
})

test('light editor → light toast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  expect(await copyToast(page)).toBe('rgb(255, 255, 255)')
})
