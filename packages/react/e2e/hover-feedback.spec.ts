/**
 * Hover feedback on both engines: the line hit band, the map cursor (one hit test decides
 * pointer / grab / crosshair / grabbing), no name tooltip in vertex edit, and the "fresh"
 * feature (just added under a still cursor: no name, no snap ring, a darker point) until
 * the cursor leaves it.
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap, importGeoJSON, screenPoint, selectedIds, mapBox } from './helpers'

const FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'L', geometry: { type: 'LineString', coordinates: [[0.1, 0.5], [0.9, 0.5]] }, properties: { name: 'Lin' } },
    { type: 'Feature', id: 'P', geometry: { type: 'Point', coordinates: [0.5, 0.2] }, properties: { name: 'Pt' } },
  ],
})

const cursorAt = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, [x, y] as const)
/** The visible name tooltip's text, or null. */
const tooltip = (page: Page) => page.evaluate(() => {
  const t = document.querySelector<HTMLElement>('.elm-feature-tooltip')
  return t && t.style.display !== 'none' ? t.textContent : null
})
const setMode = (page: Page, mode: string) =>
  page.evaluate((m) => window.__elementEditorTest!.uiStore.getState().setEditingMode(m as never), mode)

async function seed(page: Page) {
  await page.goto('/')
  await waitForMap(page)
  await importGeoJSON(page, FC)
  await page.evaluate(() => window.__elementEditorTest!.map.fitBounds([[0, 0], [1, 1]], { animate: false }))
  await page.waitForTimeout(500)
  return screenPoint(page, 0.4, 0.5) // on the line, clear of the point
}

test('a thin line is hovered, named and clicked from 7 px away, not from 12 px', async ({ page }) => {
  const on = await seed(page)
  await page.mouse.move(on.x, on.y - 60)
  await page.mouse.move(on.x, on.y - 7, { steps: 4 })
  await expect.poll(() => tooltip(page)).toBe('Lin')
  expect(await cursorAt(page, on.x, on.y - 7)).toBe('pointer')
  await page.mouse.click(on.x, on.y + 7)
  await expect.poll(() => selectedIds(page)).toEqual(['L'])

  await page.mouse.click(on.x, on.y - 12)
  await expect.poll(() => selectedIds(page)).toEqual([])
  await expect.poll(() => tooltip(page)).toBe(null)
})

test('cursor: pointer on a feature, move on a selected one, grab off it (also after a quick exit and a selection), crosshair with a tool, grabbing while panning', async ({ page }) => {
  const on = await seed(page)
  const off = { x: on.x, y: on.y - 80 }
  await page.mouse.move(off.x, off.y)
  expect(await cursorAt(page, off.x, off.y)).toBe('grab')

  // In and straight back out in few, fast moves: the last move must still be hit-tested.
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(on.x, on.y, { steps: 2 })
    await expect.poll(() => cursorAt(page, on.x, on.y)).toBe('pointer')
    await page.mouse.move(off.x, off.y)
    await expect.poll(() => cursorAt(page, off.x, off.y)).toBe('grab')
    await expect.poll(() => tooltip(page)).toBe(null)
  }

  // Selected, then left.
  await page.mouse.click(on.x, on.y)
  await expect.poll(() => selectedIds(page)).toEqual(['L'])
  // A selected feature moves on a plain drag: move cursor.
  await expect.poll(() => cursorAt(page, on.x, on.y)).toBe('move')
  await page.mouse.move(off.x, off.y, { steps: 2 })
  await expect.poll(() => cursorAt(page, off.x, off.y)).toBe('grab')
  await page.keyboard.press('Escape')

  // A tool keeps its crosshair on and off features; leaving the tool restores grab.
  await setMode(page, 'draw-line')
  await expect.poll(() => cursorAt(page, off.x, off.y)).toBe('crosshair')
  await page.mouse.move(on.x, on.y, { steps: 2 })
  await expect.poll(() => cursorAt(page, on.x, on.y)).toBe('crosshair')
  await page.mouse.move(off.x, off.y, { steps: 2 })
  await expect.poll(() => cursorAt(page, off.x, off.y)).toBe('crosshair')
  await setMode(page, 'none')
  await page.mouse.move(off.x + 5, off.y)
  await expect.poll(() => cursorAt(page, off.x + 5, off.y)).toBe('grab')

  // Panning shows grabbing, then grab again.
  await page.mouse.move(on.x - 100, on.y - 40)
  await page.mouse.down()
  await page.mouse.move(on.x - 90, on.y - 30, { steps: 3 })
  await page.mouse.move(on.x - 90, on.y + 40, { steps: 6 })
  const now = { x: on.x - 90, y: on.y + 40 }
  expect(await cursorAt(page, now.x, now.y)).toBe('grabbing')
  await page.mouse.up()
  await page.mouse.move(now.x + 3, now.y + 3)
  await expect.poll(() => cursorAt(page, now.x + 3, now.y + 3)).toBe('grab')
})

test('no name tooltip in vertex edit', async ({ page }) => {
  const on = await seed(page)
  const pt = await screenPoint(page, 0.5, 0.2)
  await page.mouse.move(on.x, on.y - 40)
  await page.mouse.move(on.x, on.y, { steps: 3 })
  await expect.poll(() => tooltip(page)).toBe('Lin')
  await page.mouse.dblclick(on.x, on.y)
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
  await expect.poll(() => tooltip(page)).toBe(null)
  // Hovering the edited line or another feature still shows no name.
  await page.mouse.move(on.x + 30, on.y - 2, { steps: 3 })
  await page.waitForTimeout(150)
  expect(await tooltip(page)).toBe(null)
  await page.mouse.move(pt.x, pt.y - 40, { steps: 3 })
  await page.mouse.move(pt.x, pt.y - 6, { steps: 3 })
  await page.waitForTimeout(150)
  expect(await tooltip(page)).toBe(null)
})

test('a line just finished under the cursor shows its name only after the cursor leaves and comes back', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  const box = await mapBox(page)
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await setMode(page, 'draw-line')
  await page.mouse.click(cx - 100, cy)
  await page.mouse.move(cx + 100, cy, { steps: 10 })
  await page.mouse.click(cx + 100, cy)
  await page.keyboard.press('Enter') // the cursor stays on the line's end
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(1)
  await page.waitForTimeout(500)
  expect(await tooltip(page)).toBe(null)

  // Moving along the line: still no name.
  await page.mouse.move(cx + 60, cy, { steps: 5 })
  await page.waitForTimeout(300)
  expect(await tooltip(page)).toBe(null)

  // Off and back on: named.
  await page.mouse.move(cx + 60, cy - 60, { steps: 5 })
  await page.mouse.move(cx + 40, cy, { steps: 5 })
  await expect.poll(() => tooltip(page)).toBe('Line')
})

test('a point just placed under the cursor: no snap ring on it, a darker accent instead, until the cursor leaves', async ({ page, engine }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setAutoExitAfterDraw(false))
  const box = await mapBox(page)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await setMode(page, 'place-point')
  await page.mouse.move(x - 50, y)
  await page.mouse.move(x, y, { steps: 5 })
  await page.mouse.click(x, y)
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)).toBe(1)
  const id = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].id)

  const snapped = () => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().snappedCoord)
  const fresh = () => page.evaluate(([e, id]) => {
    if (e === 'leaflet') return !!document.querySelector('.leaflet-marker-pane .elm-pin-fresh')
    const m = window.__elementEditorTest!.map as import('maplibre-gl').Map
    return !!m.getFeatureState({ source: 'elm-features', id }).fresh
  }, [engine, id] as const)

  await expect.poll(fresh).toBe(true)
  await page.mouse.move(x + 2, y - 3, { steps: 2 }) // still on the point
  await page.waitForTimeout(300)
  expect(await snapped()).toBe(null)
  expect(await tooltip(page)).toBe(null)
  expect(await fresh()).toBe(true)
  if (engine === 'leaflet') {
    // The darker accent is the resolved primary-600, not the selected pin's 500.
    const fills = await page.evaluate(() => {
      const path = document.querySelector('.leaflet-marker-pane .elm-pin-fresh path')!
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-primary-600)'
      path.closest('.leaflet-container')!.appendChild(probe)
      const want = getComputedStyle(probe).color
      probe.remove()
      return { got: getComputedStyle(path).fill, want }
    })
    expect(fills.got).toBe(fills.want)
  }

  // Leave, come back: an ordinary point again (it snaps, no tint).
  await page.mouse.move(x + 80, y - 80, { steps: 5 })
  await expect.poll(fresh).toBe(false)
  await page.mouse.move(x + 4, y + (engine === 'leaflet' ? 4 : 2), { steps: 5 })
  await expect.poll(snapped).not.toBe(null)
  expect(await fresh()).toBe(false)
})
