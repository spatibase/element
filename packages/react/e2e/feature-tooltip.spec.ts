/**
 * Hover-name tooltip after a shape is committed under a stationary cursor (both engines):
 * none until the cursor leaves the fresh shape and comes back, and never a far feature's.
 * MapLibre regression:
 * FeatureInteractionLayer fires a synthetic `mousemove` there; it once carried a plain
 * `{ x, y }` as `e.point`, which `queryRenderedFeatures` reads as "whole viewport", so
 * the tooltip named whichever feature was on top anywhere on the map.
 */
import { test, expect } from './fixtures'
import { waitForMap, mapBox } from './helpers'

test('finishing a line with Enter names the line, not a far-away feature', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  const box = await mapBox(page)
  const cx = box.width / 2, cy = box.height / 2

  // A named point 150px above the line, never hovered.
  await page.evaluate(([x, y]) => {
    const t = window.__elementEditorTest!
    const ll = 'containerPointToLatLng' in t.map ? t.map.containerPointToLatLng([x, y]) : t.map.unproject([x, y])
    t.dataStore.getState().importGeoJSON({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'cafe', properties: { name: 'Café' }, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } },
    ] }, 'replace')
  }, [cx, cy - 150])

  await page.keyboard.press('l')
  await page.mouse.click(box.x + cx - 100, box.y + cy)
  await page.mouse.move(box.x + cx + 100, box.y + cy, { steps: 10 })
  await page.mouse.click(box.x + cx + 100, box.y + cy)
  await page.keyboard.press('Enter') // mouse stays still on the line's end
  await page.waitForTimeout(500)
  // The fresh line under the cursor shows no name yet (hover-feedback.spec), and never the point's.
  await expect(page.locator('.elm-feature-tooltip')).toHaveCount(0)

  // Off and back on: the line is named.
  await page.mouse.move(box.x + cx + 60, box.y + cy - 60, { steps: 5 })
  await page.mouse.move(box.x + cx + 40, box.y + cy, { steps: 5 })
  await expect(page.locator('.elm-feature-tooltip')).toHaveText('Line')
})
