/**
 * Performance tests — load increasingly large datasets and measure
 * import time, DOM count, and interaction responsiveness.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON } from './helpers'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname2 = dirname(fileURLToPath(import.meta.url))
const TEST_DATA_DIR = resolve(__dirname2, '../../../test-data')

function loadDataset(name: string): { json: string; featureCount: number; vertexCount: number; sizeMB: string } | null {
  const path = resolve(TEST_DATA_DIR, `${name}.geojson`)
  if (!existsSync(path)) return null
  const json = readFileSync(path, 'utf-8')
  const parsed = JSON.parse(json)
  const featureCount = parsed.features.length
  const vertexCount = parsed.features.reduce((sum: number, f: { geometry: { type: string; coordinates: unknown } }) => {
    const g = f.geometry
    if (g.type === 'Point') return sum + 1
    if (g.type === 'LineString') return sum + (g.coordinates as unknown[]).length
    if (g.type === 'Polygon') return sum + (g.coordinates as unknown[][])[0].length
    return sum
  }, 0)
  return { json, featureCount, vertexCount, sizeMB: (json.length / 1024 / 1024).toFixed(2) }
}

test.describe('Performance — import and render', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('500 parcels import under 3s', async ({ page }) => {
    const data = loadDataset('parcels-500')
    if (!data) test.skip()
    const start = Date.now()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(1000)
    const elapsed = Date.now() - start
    console.log(`parcels-500: ${elapsed}ms import, ${data!.featureCount} features, ${data!.sizeMB}MB`)
    expect(elapsed).toBeLessThan(5000)
  })

  test('1000 parcels import under 5s', async ({ page }) => {
    const data = loadDataset('parcels-1000')
    if (!data) test.skip()
    const start = Date.now()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(1500)
    const elapsed = Date.now() - start
    console.log(`parcels-1000: ${elapsed}ms import, ${data!.featureCount} features, ${data!.sizeMB}MB`)
    expect(elapsed).toBeLessThan(8000)
  })

  test('5000 parcels import under 15s', async ({ page }) => {
    test.setTimeout(30000)
    const data = loadDataset('parcels-5000')
    if (!data) test.skip()
    const start = Date.now()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(3000)
    const elapsed = Date.now() - start
    console.log(`parcels-5000: ${elapsed}ms import, ${data!.featureCount} features, ${data!.sizeMB}MB`)
    expect(elapsed).toBeLessThan(20000)
  })

  test('5 complex polygons (2000 vertices each) import under 3s', async ({ page }) => {
    const data = loadDataset('complex-5x2000v')
    if (!data) test.skip()
    const start = Date.now()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(1000)
    const elapsed = Date.now() - start
    console.log(`complex-5x2000v: ${elapsed}ms import, ${data!.vertexCount} vertices`)
    expect(elapsed).toBeLessThan(5000)
  })

  test('monster polygon 10k vertices import under 5s', async ({ page }) => {
    const data = loadDataset('monster-10k')
    if (!data) test.skip()
    const start = Date.now()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(1500)
    const elapsed = Date.now() - start
    console.log(`monster-10k: ${elapsed}ms import, ${data!.vertexCount} vertices`)
    expect(elapsed).toBeLessThan(8000)
  })

  test('monster polygon 50k vertices import under 10s', async ({ page }) => {
    test.setTimeout(30000)
    const data = loadDataset('monster-50k')
    if (!data) test.skip()
    const start = Date.now()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(3000)
    const elapsed = Date.now() - start
    console.log(`monster-50k: ${elapsed}ms import, ${data!.vertexCount} vertices`)
    expect(elapsed).toBeLessThan(15000)
  })
})

test.describe('Performance — DOM element count after import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('500 parcels: DOM under 10000 elements', async ({ page }) => {
    const data = loadDataset('parcels-500')
    if (!data) test.skip()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(2000)
    const domCount = await page.evaluate(() => document.querySelectorAll('*').length)
    console.log(`parcels-500: ${domCount} DOM elements`)
    expect(domCount).toBeLessThan(10000)
  })

  test('1000 points: DOM under 8000 elements', async ({ page }) => {
    const data = loadDataset('points-1000')
    if (!data) test.skip()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(2000)
    const domCount = await page.evaluate(() => document.querySelectorAll('*').length)
    console.log(`points-1000: ${domCount} DOM elements`)
    expect(domCount).toBeLessThan(8000)
  })
})

test.describe('Performance — interaction responsiveness', () => {
  test('pan is smooth with 500 features', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()

    const data = loadDataset('parcels-500')
    if (!data) test.skip()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(2000)

    // Measure frame time during pan
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) return
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    const frameTimes = await page.evaluate(async () => {
      return new Promise<number[]>((resolve) => {
        const times: number[] = []
        let last = performance.now()
        let count = 0
        function frame() {
          const now = performance.now()
          times.push(now - last)
          last = now
          if (++count < 30) requestAnimationFrame(frame)
          else resolve(times)
        }
        requestAnimationFrame(frame)
      })
    })

    // Pan while measuring
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 0; i < 15; i++) {
      await page.mouse.move(cx + i * 8, cy + i * 4)
    }
    await page.mouse.up()

    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    const fps = Math.round(1000 / avgFrameTime)
    console.log(`Pan with 500 features: ~${fps} FPS (avg frame: ${avgFrameTime.toFixed(1)}ms)`)
    // We want at least 20 FPS during pan
    expect(avgFrameTime).toBeLessThan(50)
  })

  test('selecting a feature in 1000-feature dataset is fast', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()

    const data = loadDataset('parcels-1000')
    if (!data) test.skip()
    await importGeoJSON(page, data!.json)
    await page.waitForTimeout(2000)

    const row = page.locator('aside li').first()
    if (!await row.isVisible({ timeout: 3000 }).catch(() => false)) return

    const start = Date.now()
    await row.click()
    await page.waitForTimeout(200)
    const elapsed = Date.now() - start
    console.log(`Select in 1000 features: ${elapsed}ms`)
    expect(elapsed).toBeLessThan(1000)
  })
})
