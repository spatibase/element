/**
 * MapLibre: Element repairs itself after a host's `map.setStyle` (full rebuild and diff, object and
 * URL): features render again, the selection highlight, the snap image and vertex editing come
 * back, undo still works, five quick swaps leave one copy, and a commit made while a new style is
 * still loading shows up. MapLibre only (Leaflet has no style): skipped on the Leaflet project.
 */
import { test, expect, type Page } from './fixtures'
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { hoverFirstEdgeMidpoint } from './helpers'

const IGNORED_ERR = /openfreemap|mapterhorn|openstreetmap|ERR_FAILED|Failed to load resource|net::|glyph|font/i
const STYLE_URL = 'https://style.example.test/style.json'

type Hooks = {
  __elementEditorTest: {
    map: MapLibreMap
    dataStore: { getState: () => { features: { id: string; geometry: { coordinates: number[][][] } }[]; selectedIds: string[]; undo: () => void } }
  }
  __elementEditorRef: {
    addFeature: (f: unknown) => unknown
    select: (ids: string[], o?: { fit?: boolean }) => void
    flyTo: (o: { center: [number, number]; zoom?: number }) => void
  }
}

/** A plain host style: one background layer, glyphs on a host that's aborted (fine for Element). */
const hostStyle = (color: string): StyleSpecification => ({
  version: 8,
  name: `host-${color}`,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'host-bg', type: 'background', paint: { 'background-color': color } }],
})

const SQUARE = {
  type: 'Feature', id: 'sq', properties: { name: 'Square' },
  geometry: { type: 'Polygon', coordinates: [[[10, 50], [10.2, 50], [10.2, 50.2], [10, 50.2], [10, 50]]] },
}

async function open(page: Page) {
  await page.goto('/') // the fixture adds engine= and serves the tile hosts offline
  await page.waitForFunction(() => !!(window as unknown as Partial<Hooks>).__elementEditorTest?.map?.getSource('elm-features'))
  await page.evaluate((f) => {
    const w = window as unknown as Hooks
    w.__elementEditorRef.addFeature(f)
    w.__elementEditorTest.map.jumpTo({ center: [10.1, 50.1], zoom: 9 })
  }, SQUARE)
  await expect.poll(() => rendered(page)).toBeGreaterThan(0)
}

/** Rendered `sq` fills (0 when Element's layer is missing). */
const rendered = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as Hooks).__elementEditorTest.map
  if (!m.getLayer('elm-features-fill')) return 0
  return m.queryRenderedFeatures({ layers: ['elm-features-fill'] }).filter((f) => f.properties.id === 'sq').length
})

/** Everything the repair has to bring back, in one read. */
const repairState = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as Hooks).__elementEditorTest.map
  const ids = m.getStyle().layers.map((l) => l.id)
  const elm = ids.filter((id) => id.startsWith('elm-'))
  return {
    style: m.getStyle().name,
    selected: m.getSource('elm-features') ? !!m.getFeatureState({ source: 'elm-features', id: 'sq' }).selected : false,
    diamond: m.hasImage('elm-snap-diamond'),
    elm,
    // Element's layers are the top of the stack.
    onTop: ids.slice(-elm.length).every((id) => id.startsWith('elm-')),
  }
})

const setStyle = (page: Page, style: StyleSpecification | string, diff: boolean) =>
  // The arg goes in as `unknown`: Playwright's serialisable-arg typing of StyleSpecification is too deep for tsc (TS2589).
  page.evaluate(({ s, d }) => { (window as unknown as Hooks).__elementEditorTest.map.setStyle(s as StyleSpecification, { diff: d }) }, { s: style as unknown, d: diff })

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_ERR.test(m.text())) errors.push(m.text()) })
  return errors
}

test.describe('MapLibre: self-repair after map.setStyle', () => {
  test.skip(({ engine }) => engine !== 'maplibre', 'Leaflet has no style to replace')

  for (const diff of [false, true]) {
    test(`${diff ? 'diff' : 'full'} setStyle(object): features, selection, snap image come back on top; vertex edit + undo work`, async ({ page }) => {
      const errors = trackErrors(page)
      await open(page)
      await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.select(['sq']))
      const before = await repairState(page)
      expect(before.selected).toBe(true)
      expect(before.diamond).toBe(true)

      await setStyle(page, hostStyle('#eef'), diff)
      await expect.poll(() => rendered(page)).toBeGreaterThan(0)
      const after = await repairState(page)
      expect(after.style).toBe('host-#eef')
      expect(after.elm).toEqual(before.elm)
      expect(after.onTop).toBe(true)
      expect(after.selected).toBe(true)
      expect(after.diamond).toBe(true)

      // Vertex edit still works: drag a midpoint to insert a vertex, then undo it.
      await page.locator('.maplibregl-canvas').first().focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => page.locator('.elm-midpoint-marker').count()).toBeGreaterThanOrEqual(4)
      const ring = () => page.evaluate(() => (window as unknown as Hooks).__elementEditorTest.dataStore.getState().features[0].geometry.coordinates[0].length)
      expect(await ring()).toBe(5)
      const { x, y } = await hoverFirstEdgeMidpoint(page)
      const canvas = (await page.locator('.maplibregl-canvas').first().boundingBox())!
      await page.mouse.move(x, y)
      await page.mouse.down()
      // Towards the map centre, so the pointer stays over the map.
      await page.mouse.move(x + Math.sign(canvas.x + canvas.width / 2 - x) * 30, y + Math.sign(canvas.y + canvas.height / 2 - y) * 30, { steps: 6 })
      await page.mouse.up()
      await expect.poll(ring).toBe(6)
      await page.evaluate(() => (window as unknown as Hooks).__elementEditorTest.dataStore.getState().undo())
      await expect.poll(ring).toBe(5)
      expect(errors).toEqual([])
    })
  }

  test('setStyle(map.getStyle(), { diff: false }) (Element carried, sources recreated) keeps the selection highlight', async ({ page }) => {
    await open(page)
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.select(['sq']))
    await page.evaluate(() => { const m = (window as unknown as Hooks).__elementEditorTest.map; m.setStyle(m.getStyle(), { diff: false }) })
    await expect.poll(() => rendered(page)).toBeGreaterThan(0)
    await expect.poll(async () => (await repairState(page)).selected).toBe(true)
    expect((await repairState(page)).diamond).toBe(true)
  })

  test("a host style.load listener added after mount runs after the repair (can use an elm-* beforeId)", async ({ page }) => {
    const errors = trackErrors(page)
    await open(page)
    await page.evaluate(() => {
      const m = (window as unknown as Hooks).__elementEditorTest.map
      m.on('style.load', () => {
        if (!m.getLayer('host-overlay')) m.addLayer({ id: 'host-overlay', type: 'background', paint: { 'background-opacity': 0 } }, 'elm-features-fill')
      })
    })
    await setStyle(page, hostStyle('#efe'), false)
    await expect.poll(() => rendered(page)).toBeGreaterThan(0)
    const ids = await page.evaluate(() => (window as unknown as Hooks).__elementEditorTest.map.getStyle().layers.map((l) => l.id))
    expect(ids.indexOf('host-overlay')).toBe(ids.indexOf('elm-features-fill') - 1)
    expect(errors).toEqual([])
  })

  test('5 quick swaps (object + URL, full + diff) end with one copy of Element, on top, selected', async ({ page }) => {
    const errors = trackErrors(page)
    await open(page)
    await page.route(STYLE_URL, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(hostStyle('#fee')) }))
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.select(['sq']))
    const before = await repairState(page)
    await page.evaluate(([url, a, b]) => {
      const m = (window as unknown as Hooks).__elementEditorTest.map
      m.setStyle(a as StyleSpecification, { diff: false })
      m.setStyle(url as string, { diff: false })
      m.setStyle(b as StyleSpecification)
      m.setStyle(url as string)
      m.setStyle(a as StyleSpecification, { diff: false })
    }, [STYLE_URL, hostStyle('#ffe'), hostStyle('#eff')] as unknown[])
    await expect.poll(() => rendered(page)).toBeGreaterThan(0)
    await page.waitForTimeout(500) // let any late style.load land
    const after = await repairState(page)
    expect(after.style).toBe('host-#ffe')
    expect(after.elm).toEqual(before.elm)
    expect(after.onTop).toBe(true)
    expect(after.selected).toBe(true)
    expect(after.diamond).toBe(true)
    expect(errors).toEqual([])
  })

  test('a feature committed while a style URL is still loading is drawn once it loads', async ({ page }) => {
    await open(page)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    await page.route(STYLE_URL, async (r) => { await gate; await r.fulfill({ contentType: 'application/json', body: JSON.stringify(hostStyle('#fef')) }) })
    await setStyle(page, STYLE_URL, false)
    // Old style gone, new one not loaded: Element's source is missing.
    await expect.poll(() => page.evaluate(() => !!(window as unknown as Hooks).__elementEditorTest.map.getSource('elm-features'))).toBe(false)
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.addFeature({
      type: 'Feature', id: 'late', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[10.05, 50.05], [10.1, 50.05], [10.1, 50.1], [10.05, 50.05]]] },
    }))
    release()
    await expect.poll(() => page.evaluate(() => {
      const m = (window as unknown as Hooks).__elementEditorTest.map
      if (!m.getLayer('elm-features-fill')) return []
      return [...new Set(m.queryRenderedFeatures({ layers: ['elm-features-fill'] }).map((f) => f.properties.id))].sort()
    })).toEqual(['late', 'sq'])
  })
})
