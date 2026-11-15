/**
 * Picker tool: leaving the tool clears candidate overlays and cancels an in-flight lookup.
 * Overpass is stubbed like picker.spec.ts.
 */
import { test, expect, type Page, type Engine, MAP } from './fixtures'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { waitForMap, flyTo, featureCount } from './helpers'

const way = (id: number, name: string, d: number) => ({
  type: 'way', id, tags: { name, leisure: 'park' },
  geometry: [
    { lat: 48.860 + d, lon: 2.340 - d }, { lat: 48.860 + d, lon: 2.340 + d },
    { lat: 48.860 - d, lon: 2.340 + d }, { lat: 48.860 - d, lon: 2.340 - d },
    { lat: 48.860 + d, lon: 2.340 - d },
  ],
})
// Both contain the click centre (48.860, 2.340).
const MULTI = { elements: [way(111, 'Park A', 0.001), way(222, 'Park B', 0.002)] }
const SINGLE = { elements: [way(333, 'Park C', 0.001)] }


/** Candidate outlines on the map: Leaflet SVG paths (#3b82f6 / #8b5cf6), MapLibre the trace overlay layer. */
const overlays = (page: Page, engine: Engine) => engine === 'leaflet'
  ? page.locator('path[stroke="#3b82f6"], path[stroke="#8b5cf6"]').count()
  : page.evaluate(() => {
    const map = window.__elementEditorTest!.map as MapLibreMap
    return map.getLayer('elm-osm-trace-line') ? map.queryRenderedFeatures({ layers: ['elm-osm-trace-line'] }).length : 0
  })

async function pickAtCentre(page: Page) {
  await flyTo(page, [48.860, 2.340], 18)
  await page.keyboard.press('x')
  await expect(page.getByText(/click anywhere to import/i)).toBeVisible({ timeout: 3000 })
  const map = page.locator(MAP)
  const box = (await map.boundingBox())!
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.locator(MAP).click()
})

test('picker: switching tool clears the candidate overlays and chooser', async ({ page, engine }) => {
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(MULTI) }))
  await pickAtCentre(page)
  await expect(page.getByText('Park A')).toBeVisible({ timeout: 5000 })
  if (engine === 'leaflet') await expect(page.locator('path[stroke="#3b82f6"]')).toHaveCount(1)
  await expect.poll(() => overlays(page, engine)).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Area', exact: true }).click()
  await expect(page.getByText('Park A')).toHaveCount(0)
  await expect.poll(() => overlays(page, engine)).toBe(0)
  expect(await featureCount(page)).toBe(0)
})

test('picker: a lookup still in flight when the tool is left adds nothing', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/overpass-api.de/**', async (r) => {
    await held
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(SINGLE) }).catch(() => {})
  })
  await pickAtCentre(page)
  await page.keyboard.press('Escape')
  await expect(page.getByText(/click anywhere to import/i)).not.toBeVisible({ timeout: 2000 })
  release()
  await page.waitForTimeout(500)
  expect(await featureCount(page)).toBe(0)
})
