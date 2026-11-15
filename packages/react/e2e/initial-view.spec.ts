/**
 * Map setup on both drop-ins: `initialView` (and its precedence over the saved view, the
 * `initialData` first-visit fit and the `bounds` fit), `mapOptions` and `onMapReady`, through the
 * dev page's `?view=` / `?data=` / `?mapOptions=` params (src/App.tsx).
 *
 * Runs on both engines (the `engine` fixture / project, e2e/fixtures.ts).
 */
import { test, expect, type Page } from './fixtures'

type AnyMap = {
  getCenter: () => { lng: number; lat: number }
  getZoom: () => number
  getMaxZoom: () => number
  getBounds: () => { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number }
}
type Hooks = {
  __elementEditorRef: { getMap: () => AnyMap | null }
  __readyMaps?: unknown[]
  __readyHadElm?: boolean[]
  __remountHost: () => void
}

const TOKYO: [number, number, number, number] = [139.70, 35.65, 139.80, 35.72] // ?data=sample's bbox
const PRAGUE: [number, number, number, number] = [14.2, 49.9, 14.7, 50.2]

/** Seeds `elm_mapView` (the saved view) before every page load of this test. */
const seedSavedView = (page: Page, lng: number, lat: number, zoom: number) =>
  page.addInitScript(([lng, lat, zoom]) => {
    localStorage.setItem('elm_mapView', JSON.stringify({ v: 1, data: { lat, lng, zoom } }))
  }, [lng, lat, zoom])

async function open(page: Page, query = '') {
  await page.goto('/?' + query) // the fixture adds engine= and serves tile hosts offline
  // onMapReady ran: the map exists and Element's layers are on it.
  await page.waitForFunction(() => ((window as unknown as Hooks).__readyMaps?.length ?? 0) > 0)
}

const view = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as Hooks).__elementEditorRef.getMap()!
  const c = m.getCenter()
  const b = m.getBounds()
  return { center: [c.lng, c.lat], zoom: m.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] }
})

const expectCenter = (actual: number[], lng: number, lat: number, tol = 0.05) => {
  expect(Math.abs(actual[0] - lng), `lng ${actual[0]} vs ${lng}`).toBeLessThan(tol)
  expect(Math.abs(actual[1] - lat), `lat ${actual[1]} vs ${lat}`).toBeLessThan(tol)
}
/** The view shows the whole bbox, and is zoomed in on it (not a world view). */
const expectFits = (v: { bounds: number[]; zoom: number }, [west, south, east, north]: number[]) => {
  const e = 1e-6
  expect(v.bounds[0]).toBeLessThanOrEqual(west + e)
  expect(v.bounds[1]).toBeLessThanOrEqual(south + e)
  expect(v.bounds[2]).toBeGreaterThanOrEqual(east - e)
  expect(v.bounds[3]).toBeGreaterThanOrEqual(north - e)
  expect(v.zoom).toBeGreaterThan(8)
}

test.describe('initial view', () => {
  test('defaults to Europe; { center, zoom } and { bounds } set the start view', async ({ page }) => {
    await open(page)
    const def = await view(page)
    expectCenter(def.center, 10, 48)
    expect(def.zoom).toBe(5)

    await open(page, '&view=139.7,35.6,9')
    const v = await view(page)
    expectCenter(v.center, 139.7, 35.6)
    expect(v.zoom).toBeCloseTo(9, 5)

    await open(page, `&view=${PRAGUE.join(',')}`)
    expectFits(await view(page), PRAGUE)
  })

  test('initialView wins over the saved view; without it the saved view wins', async ({ page }) => {
    await seedSavedView(page, 20, 10, 4)
    await open(page, '&view=139.7,35.6,9&data=sample')
    expectCenter((await view(page)).center, 139.7, 35.6)
    await open(page, '&data=sample')
    const v = await view(page)
    expectCenter(v.center, 20, 10)
    expect(v.zoom).toBe(4)
  })

  test('initialData is fitted on a first visit (no saved view), and with persist off', async ({ page }) => {
    await open(page, '&data=sample')
    expectFits(await view(page), TOKYO)

    await seedSavedView(page, 20, 10, 4)
    await open(page, '&data=sample&persist=0')
    expectFits(await view(page), TOKYO)
  })

  test("'data' with no features falls back to the bounds fit", async ({ page }) => {
    await open(page, `&view=data&data=empty&bounds=${PRAGUE.join(',')}`)
    // Centred on `bounds`, zoomed in (MapLibre's maxBounds then keeps the viewport inside the box,
    // so the padded fit is cropped there: check the centre, not that the whole box shows).
    const v = await view(page)
    expectCenter(v.center, 14.45, 50.05)
    expect(v.zoom).toBeGreaterThan(8)
    await open(page, `&view=data&data=sample`)
    expectFits(await view(page), TOKYO)
  })

  test.describe('initialData that arrives after mount (?data=late)', () => {
    const SAMPLE = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'tokyo-a', properties: {}, geometry: { type: 'Polygon', coordinates: [[[139.70, 35.65], [139.80, 35.65], [139.80, 35.72], [139.70, 35.72], [139.70, 35.65]]] } },
        { type: 'Feature', id: 'tokyo-b', properties: {}, geometry: { type: 'Point', coordinates: [139.76, 35.68] } },
      ],
    }
    type LateHooks = {
      __setInitialData: (fc: unknown) => void
      __changes?: number[]
      __elementEditorRef: { getFeatureCollection: () => { features: { id: string }[] }; canUndo: () => boolean; addFeature: (f: unknown) => unknown }
    }
    const setData = (page: Page, fc: unknown) => page.evaluate((fc) => (window as unknown as LateHooks).__setInitialData(fc), fc)
    const featureIds = (page: Page) => page.evaluate(() => (window as unknown as LateHooks).__elementEditorRef.getFeatureCollection().features.map((f) => f.id))

    test('applied once (no undo step, no onChange) and fitted; a later change is ignored with a warning', async ({ page }) => {
      const warnings: string[] = []
      page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
      await open(page, '&data=late&changes=1')
      expect(await featureIds(page)).toEqual([])
      expectCenter((await view(page)).center, 10, 48) // nothing to fit yet: Europe

      await setData(page, SAMPLE)
      await expect.poll(() => featureIds(page)).toEqual(['tokyo-a', 'tokyo-b'])
      // First visit (no saved view): the late data is fitted, as on mount.
      // Poll the whole fit, not just "zoomed in": the fit animates, and a mid-animation frame is
      // already zoomed in without showing the whole bbox yet.
      await expect.poll(async () => {
        const v = await view(page)
        const e = 1e-6
        return v.zoom > 8 && v.bounds[0] <= TOKYO[0] + e && v.bounds[1] <= TOKYO[1] + e && v.bounds[2] >= TOKYO[2] - e && v.bounds[3] >= TOKYO[3] - e
      }, { timeout: 10_000 }).toBe(true)
      expect(await page.evaluate(() => (window as unknown as LateHooks).__elementEditorRef.canUndo())).toBe(false)
      expect(await page.evaluate(() => (window as unknown as LateHooks).__changes ?? [])).toEqual([])

      await setData(page, { type: 'FeatureCollection', features: [SAMPLE.features[1]] })
      await page.waitForTimeout(200)
      expect(await featureIds(page)).toEqual(['tokyo-a', 'tokyo-b'])
      expect(warnings.some((t) => t.includes('`initialData` changed after the editor loaded its data') && t.includes('setFeatureCollection'))).toBe(true)
    })

    test('an explicit initialView is kept: the late data is not fitted', async ({ page }) => {
      await open(page, '&data=late&view=14.42,50.09,11')
      await setData(page, SAMPLE)
      await expect.poll(() => featureIds(page)).toEqual(['tokyo-a', 'tokyo-b'])
      await page.waitForTimeout(800) // a fit would animate away from Prague
      expectCenter((await view(page)).center, 14.42, 50.09)
    })

    test('ignored once the user has edited', async ({ page }) => {
      await open(page, '&data=late')
      await page.evaluate(() => (window as unknown as LateHooks).__elementEditorRef.addFeature({ type: 'Feature', id: 'mine', geometry: { type: 'Point', coordinates: [10, 48] }, properties: {} }))
      await setData(page, SAMPLE)
      await page.waitForTimeout(200)
      expect(await featureIds(page)).toEqual(['mine'])
    })
  })

  test('mapOptions are applied; keys Element owns are dropped with a warning', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    await open(page, '&mapOptions=' + encodeURIComponent(JSON.stringify({ maxZoom: 12, center: [0, 0] })))
    const v = await view(page)
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getMap()!.getMaxZoom())).toBe(12)
    expectCenter(v.center, 10, 48) // `center` ignored
    expect(warnings.some((t) => t.includes('mapOptions.center'))).toBe(true)
  })

  test('onMapReady: once per map (StrictMode dev page), after Element\'s layers; again after a remount', async ({ page }) => {
    await open(page)
    const first = await page.evaluate(() => ({
      calls: (window as unknown as Hooks).__readyMaps!.length,
      hadElm: (window as unknown as Hooks).__readyHadElm,
      isRefMap: (window as unknown as Hooks).__readyMaps![0] === (window as unknown as Hooks).__elementEditorRef.getMap(),
    }))
    expect(first).toEqual({ calls: 1, hadElm: [true], isRefMap: true })

    await page.evaluate(() => (window as unknown as Hooks).__remountHost())
    await page.waitForFunction(() => (window as unknown as Hooks).__readyMaps!.length === 2)
    const second = await page.evaluate(() => ({
      distinct: (window as unknown as Hooks).__readyMaps![0] !== (window as unknown as Hooks).__readyMaps![1],
      isRefMap: (window as unknown as Hooks).__readyMaps![1] === (window as unknown as Hooks).__elementEditorRef.getMap(),
      hadElm: (window as unknown as Hooks).__readyHadElm,
    }))
    expect(second).toEqual({ distinct: true, isRefMap: true, hadElm: [true, true] })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as unknown as Hooks).__readyMaps!.length)).toBe(2)
  })
})

test.describe('MapLibre only', () => {
  test.skip(({ engine }) => engine !== 'maplibre', 'MapLibre pitch and style layers')

  test('mapOptions.pitch is applied', async ({ page }) => {
    await open(page, '&mapOptions=' + encodeURIComponent(JSON.stringify({ pitch: 30 })))
    expect(await page.evaluate(() => ((window as unknown as Hooks).__elementEditorRef.getMap() as unknown as { getPitch: () => number }).getPitch())).toBe(30)
  })

  test('a layer added in onMapReady survives a basemap switch, in order with Element\'s layers', async ({ page }) => {
    await open(page)
    type ML = {
      addSource: (id: string, s: object) => void
      addLayer: (l: object, before?: string) => void
      getStyle: () => { name?: string; layers: { id: string }[] }
    }
    const order = () => page.evaluate(() => {
      const ids = ((window as unknown as Hooks).__elementEditorRef.getMap() as unknown as ML).getStyle().layers.map((l) => l.id)
      return ids.filter((id) => id === 'host-fill' || id === 'elm-features-fill')
    })
    await page.evaluate(() => {
      const m = (window as unknown as Hooks).__elementEditorRef.getMap() as unknown as ML
      m.addSource('host', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'host-fill', type: 'fill', source: 'host' }, 'elm-features-fill')
    })
    expect(await order()).toEqual(['host-fill', 'elm-features-fill'])
    const style = () => page.evaluate(() => {
      const s = ((window as unknown as Hooks).__elementEditorRef.getMap() as unknown as ML).getStyle()
      return { name: s.name, count: s.layers.length }
    })
    const before = await style()
    const pick = async (name: string) => {
      const option = page.getByRole('button', { name, exact: true })
      if (!(await option.isVisible())) await page.getByRole('button', { name: 'Basemap' }).click()
      await option.click()
    }
    await pick('Dark')
    await expect.poll(async () => (await style()).name).toBe('Lab Dark')
    expect(before.name).not.toBe('Lab Dark')
    expect(await order()).toEqual(['host-fill', 'elm-features-fill'])
    // The old basemap's layers are gone: switching back gives the same layer count as before.
    await pick('Auto')
    await expect.poll(style).toEqual(before)
    expect(await order()).toEqual(['host-fill', 'elm-features-fill'])
  })
})
