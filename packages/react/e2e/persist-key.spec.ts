/**
 * config.persistKey / config.persist: editors with different keys on one origin keep their own
 * saved state; persist: false reads and writes nothing.
 */
import { test, expect, type Page, MAP } from './fixtures'
import { waitForMap } from './helpers'

// Minus the setting the e2e fixture seeds before every navigation.
const elmKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('elm_') && k !== 'elm_autoExitAfterDraw').sort())
const theme = (page: Page) => page.locator('[data-elm-theme]').first()

test('two persistKeys keep separate theme choices', async ({ page }) => {
  await page.goto('/?persistKey=one')
  await waitForMap(page)
  await page.evaluate(() => localStorage.clear())
  await page.getByRole('button', { name: /editor settings/i }).click()
  await page.getByRole('button', { name: /^dark$/i }).click()
  await expect(theme(page)).toHaveAttribute('data-elm-theme', 'dark')
  const keys = await elmKeys(page)
  expect(keys).toContain('elm_one_theme')
  expect(keys.filter((k) => !k.startsWith('elm_one_'))).toEqual([])

  await page.goto('/?persistKey=two')
  await waitForMap(page)
  await expect(theme(page)).toHaveAttribute('data-elm-theme', 'light')

  await page.goto('/?persistKey=one')
  await waitForMap(page)
  await expect(theme(page)).toHaveAttribute('data-elm-theme', 'dark')
})

test('persist=0 reads and writes nothing', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('elm_theme', 'dark') })
  await page.goto('/?persist=0')
  await waitForMap(page)
  await expect(theme(page)).toHaveAttribute('data-elm-theme', 'light')
  await page.getByRole('button', { name: /editor settings/i }).click()
  await page.getByText(/show measurements/i).first().click()
  await page.locator(MAP).hover()
  await page.mouse.wheel(0, -300) // moving the map would save elm_mapView
  await page.waitForTimeout(800)
  expect(await elmKeys(page)).toEqual(['elm_theme'])
})
