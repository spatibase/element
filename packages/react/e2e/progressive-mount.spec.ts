/**
 * Leaflet mounts a big batch of features progressively (a chunk per frame), so
 * a 3,000-feature import doesn't freeze the page. Interactions must work while
 * it's still mounting, and the final set of canvas layers must be complete.
 */
import { test, expect, type Page } from './fixtures'
import type { Map as LeafletMap } from 'leaflet'
import { waitForMap, selectedIds, screenPoint } from './helpers'

test.skip(({ engine }) => engine !== 'leaflet', 'Leaflet progressive (chunked) layer mount')

const COLS = 60, ROWS = 50, CELL = 0.02, SIZE = 0.012
const N = COLS * ROWS
/** Cell in the middle of the test view, moved to the end of the list: the last feature mounts first. */
const CENTER = 7 * COLS + 10
const cells = Array.from({ length: N }, (_, i) => {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL
  return {
    type: 'Feature', id: `p${i}`, properties: { name: `P${i}` },
    geometry: { type: 'Polygon', coordinates: [[[x, y], [x + SIZE, y], [x + SIZE, y + SIZE], [x, y + SIZE], [x, y]]] },
  }
})
const FC = JSON.stringify({ type: 'FeatureCollection', features: [...cells.filter((_, i) => i !== CENTER), cells[CENTER]] })

/** Feature paths drawn: canvas layers (one per unselected polygon) + SVG paths. */
const drawnPaths = (page: Page) => page.evaluate(() => {
  const renderers = new Set<{ _layers: object }>()
  ;(window.__elementEditorTest!.map as LeafletMap).eachLayer((l: any) => { if (l._renderer?._container?.tagName === 'CANVAS') renderers.add(l._renderer) })
  return [...renderers].reduce((n, r) => n + Object.keys(r._layers).length, 0) + document.querySelectorAll('.leaflet-overlay-pane path').length
})

for (const renderer of ['canvas', 'svg'] as const) test(`${renderer}: a 3,000-feature import mounts progressively; click and box-select work right away`, async ({ page }) => {
  await page.goto(renderer === 'svg' ? '/?renderer=svg' : '/')
  await waitForMap(page)
  await page.waitForFunction(() => !!window.__elementEditorTest?.map)
  await page.evaluate(([w, s, e, n]) => (window.__elementEditorTest!.map as LeafletMap).fitBounds([[s, w], [n, e]], { animate: false }),
    [0, 0, 20 * CELL, 15 * CELL])
  // Features in the culled view (the map's bounds padded by 50%).
  const expected = await page.evaluate(([cols, rows, cell, size]) => {
    const b = (window.__elementEditorTest!.map as LeafletMap).getBounds().pad(0.5)
    let n = 0
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell
      if (x + size >= b.getWest() && x <= b.getEast() && y + size >= b.getSouth() && y <= b.getNorth()) n++
    }
    return n
  }, [COLS, ROWS, CELL, SIZE])
  expect(expected).toBeGreaterThan(300)

  // Import, then count: nothing mounts in the import's own (synchronous) task;
  // a frame or two later the first chunk is in, but not everything.
  const [syncCount, firstChunk] = await page.evaluate(async (raw) => {
    const t = window.__elementEditorTest!
    const count = () => {
      const renderers = new Set<{ _layers: object }>()
      ;(t.map as LeafletMap).eachLayer((l: any) => { if (l._renderer?._container?.tagName === 'CANVAS') renderers.add(l._renderer) })
      return [...renderers].reduce((n, r) => n + Object.keys(r._layers).length, 0) + document.querySelectorAll('.leaflet-overlay-pane path').length
    }
    t.dataStore.getState().importGeoJSON(JSON.parse(raw), 'replace')
    await new Promise<void>((r) => queueMicrotask(r))
    const sync = count()
    const t0 = performance.now()
    while (count() === 0 && performance.now() - t0 < 2000) await new Promise((r) => requestAnimationFrame(r))
    return [sync, count()]
  }, FC)
  expect(syncCount).toBe(0)
  expect(firstChunk).toBeGreaterThan(0)
  expect(firstChunk).toBeLessThan(expected)

  // The view (bottom-left 20 x 15 cells) mounts first, the last in the list
  // first (it draws at the bottom): the centre cell is in the first chunk.
  const id = CENTER
  const p = await screenPoint(page, (id % COLS) * CELL + SIZE / 2, Math.floor(id / COLS) * CELL + SIZE / 2)
  await page.mouse.click(p.x, p.y)
  await expect.poll(() => selectedIds(page)).toEqual([`p${id}`])
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([])

  // Box-select rows 0-3: the first features in the list, the last in view to mount.
  // It works from the store, so it finds every feature in the box either way.
  const box = [0, 0, 5 * CELL - 0.004, 4 * CELL - 0.004] as const
  const a = await screenPoint(page, box[0] - 0.004, box[3])
  const b = await screenPoint(page, box[2], box[1] - 0.004)
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await selectedIds(page)).length).toBe(5 * 4)

  // Every feature in the culled view ends up drawn, nothing else.
  await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().clearSelection())
  await expect.poll(() => drawnPaths(page), { timeout: 10_000 }).toBe(expected)
})
