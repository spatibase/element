/** Leaflet drop-in raster basemap picker (`basemaps` prop, dev page `/?basemaps=osm,custom`). The fixture answers tile hosts offline. */
import { test, expect } from './fixtures'

test.skip(({ engine }) => engine !== 'leaflet', 'Leaflet raster basemaps prop')

test('basemaps: picker switches the TileLayer url; absent by default', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.leaflet-container')
  await expect(page.getByRole('button', { name: 'Basemap' })).toHaveCount(0)

  await page.goto('/?basemaps=osm,custom')
  await page.waitForSelector('img.leaflet-tile', { state: 'attached' })
  await expect(page.locator('img.leaflet-tile').first()).toHaveAttribute('src', /tile\.openstreetmap\.org/)
  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('button', { name: 'custom', exact: true }).click()
  await expect(page.locator('img.leaflet-tile').first()).toHaveAttribute('src', /custom\.example\.test/)
  await expect(page.locator('img.leaflet-tile[src*="openstreetmap"]')).toHaveCount(0)
})

test('basemaps: the picker stays open until the toggle or Escape closes it; no title', async ({ page }) => {
  await page.goto('/?basemaps=osm,custom')
  await page.waitForSelector('.leaflet-container')
  const toggle = page.getByRole('button', { name: 'Basemap' })
  const panel = page.getByRole('group', { name: 'Basemap' })
  await toggle.click()
  await expect(panel).toBeVisible()
  await expect(panel).not.toContainText('Basemap')
  await panel.getByRole('button', { name: 'custom', exact: true }).click()
  await expect(panel).toBeVisible()
  const box = (await page.locator('.leaflet-container').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 }); await page.mouse.up()
  await expect(panel).toBeVisible()
  await toggle.click()
  await expect(panel).toHaveCount(0)
  await toggle.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('basemaps: a single entry is used as the basemap, with no picker', async ({ page }) => {
  await page.goto('/?basemaps=custom')
  await page.waitForSelector('img.leaflet-tile', { state: 'attached' })
  await expect(page.locator('img.leaflet-tile').first()).toHaveAttribute('src', /custom\.example\.test/)
  await expect(page.locator('img.leaflet-tile[src*="openstreetmap"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Basemap' })).toHaveCount(0)
})

test('basemaps: the picked basemap is remembered across reloads', async ({ page }) => {
  await page.goto('/?basemaps=osm,custom')
  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('button', { name: 'custom', exact: true }).click()
  await expect(page.locator('img.leaflet-tile').first()).toHaveAttribute('src', /custom\.example\.test/)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('basemap')))).toEqual(['elm_basemap_leaflet'])

  await page.reload()
  await page.waitForSelector('img.leaflet-tile', { state: 'attached' })
  await expect(page.locator('img.leaflet-tile').first()).toHaveAttribute('src', /custom\.example\.test/)
  await expect(page.locator('img.leaflet-tile[src*="openstreetmap"]')).toHaveCount(0)
})

test('tileLayer overrides basemaps: its tiles, no picker', async ({ page }) => {
  await page.goto('/?basemaps=osm,custom&tileLayer=1')
  await page.waitForSelector('img.leaflet-tile', { state: 'attached' })
  await expect(page.locator('img.leaflet-tile').first()).toHaveAttribute('src', /tilelayer\.example\.test/)
  await expect(page.locator('img.leaflet-tile:not([src*="tilelayer.example.test"])')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Basemap' })).toHaveCount(0)
})
