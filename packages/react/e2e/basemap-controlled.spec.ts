/**
 * Controlled `basemap` / `defaultBasemap` / `onBasemapChange` on both drop-ins, via the dev page's
 * `?basemapControlled=1|frozen` harness (src/App.tsx): `window.__setBasemapProp(id)` sets the
 * prop, `window.__basemapChanges` lists the ids `onBasemapChange` got.
 * MapLibre uses the built-in Light / Dark (plus the custom `style` entry as an off-list value);
 * Leaflet uses `osm` / `custom` (plus an off-list `elsewhere` raster).
 */
import { test, expect, type Page, type Engine } from './fixtures'
import { waitForMap } from './helpers'
import type { Map as MapLibreMap } from 'maplibre-gl'

type Win = { __setBasemapProp: (id: string) => void; __basemapChanges?: string[] }

const CASE = {
  maplibre: { list: 'light,dark', a: 'light', b: 'dark', aLabel: 'Light', bLabel: 'Dark', off: 'style' },
  leaflet: { list: 'osm,custom', a: 'osm', b: 'custom', aLabel: 'OpenStreetMap', bLabel: 'custom', off: 'elsewhere' },
} as const

const STYLE_IDS: Record<string, string> = { 'Lab Light': 'light', 'Lab Dark': 'dark', 'Custom style': 'style' }

/** Id of the basemap the map shows: MapLibre style name, Leaflet tile host. */
function shown(page: Page, engine: Engine) {
  return engine === 'maplibre'
    ? page.evaluate(() => (window.__elementEditorTest!.map as MapLibreMap).getStyle().name ?? '').then((n) => STYLE_IDS[n] ?? n)
    : page.locator('img.leaflet-tile').first().getAttribute('src').then((src) =>
      !src ? '' : src.includes('tile.openstreetmap.org') ? 'osm' : new URL(src).hostname.split('.')[0])
}

async function open(page: Page, query: string) {
  await page.goto('/?' + query)
  await waitForMap(page)
}

const changes = (page: Page) => page.evaluate(() => (window as unknown as Win).__basemapChanges ?? [])
const setProp = (page: Page, id: string) => page.evaluate((v) => (window as unknown as Win).__setBasemapProp(v), id)
const storedBasemapKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('basemap')))

async function pickInPicker(page: Page, label: string) {
  const panel = page.getByRole('group', { name: 'Basemap' })
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Basemap' }).click()
  await panel.getByRole('button', { name: label, exact: true }).click()
}

async function pressed(page: Page) {
  const panel = page.getByRole('group', { name: 'Basemap' })
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Basemap' }).click()
  return panel.locator('[aria-pressed="true"]').allTextContents()
}

test('controlled: the app sets the basemap, the picker marks it, an off-list value shows none selected', async ({ page, engine }) => {
  const c = CASE[engine]
  await open(page, `basemaps=${c.list}&basemapControlled=1&basemap=${c.a}`)
  await expect.poll(() => shown(page, engine)).toBe(c.a)

  await setProp(page, c.b)
  await expect.poll(() => shown(page, engine)).toBe(c.b)
  expect((await pressed(page)).join()).toContain(c.bLabel)

  await setProp(page, c.off)
  await expect.poll(() => shown(page, engine)).toBe(c.off)
  expect(await pressed(page)).toEqual([])
  expect(await changes(page)).toEqual([]) // prop changes don't call onBasemapChange
})

test('controlled: a pick calls onBasemapChange; the map follows only when the app updates basemap; nothing is stored', async ({ page, engine }) => {
  const c = CASE[engine]
  await open(page, `basemaps=${c.list}&basemapControlled=frozen&basemap=${c.a}`)
  await expect.poll(() => shown(page, engine)).toBe(c.a)
  await pickInPicker(page, c.bLabel)
  await expect.poll(() => changes(page)).toEqual([c.b])
  await page.waitForTimeout(300)
  expect(await shown(page, engine)).toBe(c.a) // the app ignored it
  expect((await pressed(page)).join()).toContain(c.aLabel)

  await open(page, `basemaps=${c.list}&basemapControlled=1&basemap=${c.a}`)
  await pickInPicker(page, c.bLabel)
  await expect.poll(() => shown(page, engine)).toBe(c.b)
  expect(await storedBasemapKeys(page)).toEqual([])
  await page.reload()
  await waitForMap(page)
  await expect.poll(() => shown(page, engine)).toBe(c.a) // the prop, not a remembered pick
})

test('uncontrolled: defaultBasemap starts, a pick is remembered and wins on reload; ref.setBasemap is not remembered', async ({ page, engine }) => {
  const c = CASE[engine]
  await open(page, `basemaps=${c.list}&basemap=${c.b}`)
  await expect.poll(() => shown(page, engine)).toBe(c.b)

  await page.evaluate((v) => window.__elementEditorRef!.setBasemap(v as never), c.a)
  await expect.poll(() => shown(page, engine)).toBe(c.a)
  expect(await changes(page)).toEqual([c.a])
  expect(await storedBasemapKeys(page)).toEqual([])
  await page.reload()
  await waitForMap(page)
  await expect.poll(() => shown(page, engine)).toBe(c.b)

  await pickInPicker(page, c.aLabel)
  await expect.poll(() => shown(page, engine)).toBe(c.a)
  expect(await storedBasemapKeys(page)).toHaveLength(1)
  await page.reload()
  await waitForMap(page)
  await expect.poll(() => shown(page, engine)).toBe(c.a)
})

test.describe('MapLibre', () => {
  test.skip(({ engine }) => engine !== 'maplibre', 'style switching / auto theme / style load timing')

  test('a controlled switch keeps host layers; controlled auto follows the theme without onBasemapChange', async ({ page }) => {
    await open(page, 'basemapControlled=1&basemap=auto')
    const setTheme = (t: 'light' | 'dark') => page.evaluate((v) => window.__elementEditorTest!.uiStore.setState({ userTheme: v }), t)
    await setTheme('dark')
    await expect.poll(() => shown(page, 'maplibre')).toBe('dark')
    await setTheme('light')
    await expect.poll(() => shown(page, 'maplibre')).not.toBe('dark')
    expect(await changes(page)).toEqual([])

    await page.evaluate(() => {
      const map = window.__elementEditorTest!.map as MapLibreMap
      map.addSource('host-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'host-layer', type: 'line', source: 'host-src' })
    })
    await setProp(page, 'light')
    await expect.poll(() => shown(page, 'maplibre')).toBe('light')
    expect(await page.evaluate(() => {
      const map = window.__elementEditorTest!.map as MapLibreMap
      return [!!map.getLayer('host-layer'), !!map.getSource('elm-features')]
    })).toEqual([true, true])
  })

  test('a controlled change while the first style is still loading is applied once the map exists', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    await page.route(/\/basemaps\/styles\/light\.json/, async (r) => { await held; await r.continue() })
    await page.goto('/?basemapControlled=1&basemap=light')
    await page.waitForFunction(() => typeof (window as unknown as Partial<Win>).__setBasemapProp === 'function')
    expect(await page.evaluate(() => window.__elementEditorRef?.getMap() ?? null)).toBeNull()
    await setProp(page, 'dark')
    release()
    await waitForMap(page)
    await expect.poll(() => shown(page, 'maplibre')).toBe('dark')
  })
})
