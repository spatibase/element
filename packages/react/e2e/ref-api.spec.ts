/**
 * The ref API's map / basemap / selection / tool / mutation methods (getMap, getBasemap, setBasemap,
 * select, setTool, addFeature, updateFeature, removeFeatures) on both drop-ins, driven through the dev-only
 * `window.__elementEditorRef` (the same object `<ElementEditor ref>` receives).
 *
 * Runs on both engines (the `engine` fixture / project, e2e/fixtures.ts).
 */
import { test, expect, type Page } from './fixtures'
import type { ElementEditorRef } from '../src/index'

type Hooks = {
  __elementEditorRef: ElementEditorRef & { getMap: () => unknown }
  __elementEditorTest: {
    uiStore: { getState: () => { editingMode: string; lineInProgress: unknown[]; polygonInProgress: unknown[] } }
  }
}
const MAP = ':is(.leaflet-container, .maplibregl-map)'

async function open(page: Page, query = '') {
  await page.goto('/?' + query) // the fixture adds engine=
  // The ref exists on mount; the map only once the engine created it.
  await page.waitForFunction(() => !!(window as unknown as Partial<Hooks>).__elementEditorRef?.getMap())
}

const SQUARE = {
  type: 'Feature', id: 'sq',
  geometry: { type: 'Polygon', coordinates: [[[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]] },
  properties: { name: 'Square' },
}

/** Map centre as [lng, lat] on either engine (both maps have getCenter() → { lng, lat }). */
const center = (page: Page) => page.evaluate(() => {
  const c = ((window as unknown as Hooks).__elementEditorRef.getMap() as { getCenter: () => { lng: number; lat: number } }).getCenter()
  return [c.lng, c.lat]
})

const editingMode = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__elementEditorTest.uiStore.getState().editingMode)
const featureCount = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getFeatureCollection().features.length)

test.describe('ref API', () => {
  test('getMap returns the engine map', async ({ page, engine }) => {
    await open(page)
    const kind = await page.evaluate(() => {
      const m = (window as unknown as Hooks).__elementEditorRef.getMap() as unknown as Record<string, unknown>
      return typeof m.getStyle === 'function' ? 'maplibre' : typeof m.latLngToContainerPoint === 'function' ? 'leaflet' : 'unknown'
    })
    expect(kind).toBe(engine)
  })

  test('getBasemap / setBasemap: the current choice; a switch fires onBasemapChange and is not remembered', async ({ page, engine }) => {
    await open(page)
    const get = () => page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getBasemap())
    expect(await get()).toBe(engine === 'maplibre' ? 'auto' : 'osm')
    const next = engine === 'maplibre' ? 'dark' : { id: 'other', url: 'https://other.example.test/{z}/{x}/{y}.png', attribution: 'other' }
    await page.evaluate((b) => (window as unknown as Hooks).__elementEditorRef.setBasemap(b as never), next)
    expect(await get()).toEqual(next)
    expect(await page.evaluate(() => (window as unknown as { __basemapChanges?: string[] }).__basemapChanges)).toEqual([engine === 'maplibre' ? 'dark' : 'other'])
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('basemap')))).toEqual([])
  })

  test('addFeature + select({ fit }) + undo, removeFeatures', async ({ page }) => {
    await open(page)
    const before = await featureCount(page)
    const added = await page.evaluate((f) => (window as unknown as Hooks).__elementEditorRef.addFeature(f as never), SQUARE)
    expect(added).toMatchObject({ id: 'sq', properties: { name: 'Square' } })
    expect(await featureCount(page)).toBe(before + 1)
    // Programmatic adds leave the selection alone.
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getSelection())).toEqual([])

    // Fly/fit centre the target in the visible map (offset for panels that cover it); close the
    // layers panel so the map centre is the target and this test checks only the wiring.
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setSidebarOpen(false))
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.select(['sq'], { fit: true }))
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getSelection())).toEqual(['sq'])
    await expect.poll(async () => {
      const [lng, lat] = await center(page)
      return Math.abs(lng - 100.5) + Math.abs(lat - 10.5)
    }, { timeout: 5000 }).toBeLessThan(0.2)

    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.updateFeature('sq', { properties: { name: 'Renamed' } }))).toBe(true)
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.undo())
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getFeatureCollection().features.find((f) => f.id === 'sq')?.properties.name)).toBe('Square')
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.undo())
    expect(await featureCount(page)).toBe(before)

    await page.evaluate((f) => (window as unknown as Hooks).__elementEditorRef.addFeature(f as never, { undoable: false }), SQUARE)
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.removeFeatures(['sq', 'nope']))).toBe(1)
    expect(await featureCount(page)).toBe(before)
  })

  test('setTool draws with the chosen tool; null cancels a shape in progress', async ({ page }) => {
    await open(page)
    const box = (await page.locator(MAP).first().boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const before = await featureCount(page)

    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool('polygon'))).toBe(true)
    expect(await editingMode(page)).toBe('draw-polygon')
    for (const [dx, dy] of [[0, -60], [80, 40], [-80, 40]]) {
      await page.mouse.click(cx + dx, cy + dy)
      await page.waitForTimeout(250) // keep Leaflet from reading two clicks as a dblclick
    }
    await page.keyboard.press('Enter')
    await expect.poll(() => featureCount(page)).toBe(before + 1)
    const type = await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.getFeatureCollection().features[0].geometry.type)
    expect(type).toBe('Polygon')

    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool('line'))).toBe(true)
    await page.mouse.click(cx + 40, cy)
    await expect.poll(() => page.evaluate(() => (window as unknown as Hooks).__elementEditorTest.uiStore.getState().lineInProgress.length)).toBe(1)
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool(null))).toBe(true)
    expect(await editingMode(page)).toBe('none')
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorTest.uiStore.getState().lineInProgress.length)).toBe(0)
    expect(await featureCount(page)).toBe(before + 1)

    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool('search'))).toBe(false)
  })

  test('getFeature, getTool, canUndo / canRedo, validate; setFeatureCollection fires onChange unless silent', async ({ page }) => {
    await open(page, 'changes=1')
    // Runs `fn(ref)` in the page (a function can't be passed to evaluate as an argument).
    const ref = <T,>(fn: (r: Hooks['__elementEditorRef']) => T) => page.evaluate(`(${fn.toString()})(window.__elementEditorRef)`) as Promise<T>
    const changes = () => page.evaluate(() => (window as unknown as { __changes?: number[] }).__changes ?? [])

    // Silent load: no onChange, one undo step.
    await page.evaluate((f) => (window as unknown as Hooks).__elementEditorRef.setFeatureCollection({ type: 'FeatureCollection', features: [f] } as never, { silent: true }), SQUARE)
    expect(await changes()).toEqual([])
    expect(await ref((r) => [r.canUndo(), r.canRedo()])).toEqual([true, false])
    // Default load: onChange fires.
    await page.evaluate((f) => (window as unknown as Hooks).__elementEditorRef.setFeatureCollection({ type: 'FeatureCollection', features: [f, { ...f, id: 'sq2' }] } as never), SQUARE)
    expect(await changes()).toEqual([2])
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.undo())
    expect(await ref((r) => [r.canUndo(), r.canRedo()])).toEqual([true, true])

    expect(await ref((r) => r.getFeature('sq'))).toMatchObject({ id: 'sq', properties: { name: 'Square' } })
    expect(await ref((r) => r.getFeature('nope'))).toBeNull()

    expect(await ref((r) => r.getTool())).toBeNull()
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool('rectangle'))
    expect(await ref((r) => r.getTool())).toBe('rectangle')
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool(null))
    expect(await ref((r) => r.getTool())).toBeNull()

    // The default schema has no required fields: valid. A required field the feature lacks: invalid.
    expect(await ref((r) => r.validate())).toEqual({ valid: true, errors: {} })
    await page.evaluate((f) => (window as unknown as Hooks).__elementEditorRef.setFeatureCollection({
      type: 'FeatureCollection',
      metadata: { schemas: [{ id: 's', name: 'S', fields: [{ key: 'owner', label: 'Owner', type: 'text', required: true }] }] },
      features: [f],
    } as never, { silent: true }), SQUARE)
    expect(await ref((r) => r.validate())).toEqual({ valid: false, errors: { sq: ['Missing required property: Owner'] } })
  })

  test('readonly: setTool and editing shortcuts are refused; the ref still edits', async ({ page }) => {
    await open(page, 'readonly=1')
    await page.evaluate((f) => (window as unknown as Hooks).__elementEditorRef.addFeature(f as never), SQUARE)
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool('polygon'))).toBe(false)
    expect(await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool('measure'))).toBe(true)
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.setTool(null))

    // Make this editor own the keyboard (pointer inside), then try the tool and delete keys.
    const box = (await page.locator(MAP).first().boundingBox())!
    await page.mouse.click(box.x + 20, box.y + box.height / 2)
    await page.evaluate(() => (window as unknown as Hooks).__elementEditorRef.select(['sq']))
    const count = await featureCount(page)
    await page.keyboard.press('g')
    await page.keyboard.press('p')
    expect(await editingMode(page)).toBe('none')
    await page.keyboard.press('Delete')
    await page.keyboard.press('ControlOrMeta+d')
    expect(await featureCount(page)).toBe(count)
    // Measure stays available, like the readonly toolbar.
    await page.keyboard.press('m')
    expect(await editingMode(page)).toBe('measure')
  })
})
