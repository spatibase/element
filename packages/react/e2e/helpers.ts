import { expect, MAP, type Page, type TestHook } from './fixtures'

/** A minimal 2-feature GeoJSON string for import tests */
export const SAMPLE_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  metadata: {
    schema: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: false },
    ],
  },
  features: [
    {
      type: 'Feature',
      id: 'e2e-point-1',
      geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
      properties: { name: 'Paris' },
    },
    {
      type: 'Feature',
      id: 'e2e-line-1',
      geometry: { type: 'LineString', coordinates: [[2.17, 41.38], [2.35, 48.85]] },
      properties: { name: 'Test Route' },
    },
  ],
})

/**
 * Wait for the map (either engine) to be visible and the editor wired to it: the test hook
 * carries the map and, on MapLibre, Element's `elm-features` source exists.
 */
export async function waitForMap(page: Page) {
  await page.waitForSelector(MAP, { state: 'visible' })
  await page.waitForFunction(() => {
    const m = window.__elementEditorTest?.map
    return !!m && (!('getSource' in m) || !!m.getSource('elm-features'))
  })
}

type DataState = ReturnType<TestHook['dataStore']['getState']>
/** Names of the data store's actions. */
export type DataAction = { [K in keyof DataState]-?: DataState[K] extends (...a: never[]) => unknown ? K : never }[keyof DataState]

/**
 * `ds(name, ...args)` calls a data-store action in the page (args and result cross as JSON):
 * `const ds = storeCaller(page); await ds('selectFeature', 'p1')`.
 */
export const storeCaller = (page: Page) => (fn: DataAction, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window.__elementEditorTest!.dataStore.getState()[f] as (...x: unknown[]) => unknown)(...a), [fn, args] as const)

/** The map container locator on either engine. */
export const mapLocator = (page: Page) => page.locator(MAP).first()

/** Number of features in the data store. */
export const featureCount = (page: Page) =>
  page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)

/** The ui store's current editing mode ('none', 'draw-polygon', ...). */
export const editingMode = (page: Page) =>
  page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)

/** Map container -> page point for a GeoJSON [lng, lat] on either engine. */
export function screenPoint(page: Page, lng: number, lat: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([lng, lat]) => {
    const m = window.__elementEditorTest!.map
    const pt = 'latLngToContainerPoint' in m ? m.latLngToContainerPoint([lat, lng]) : m.project([lng, lat])
    const r = m.getContainer().getBoundingClientRect()
    return { x: r.left + pt.x, y: r.top + pt.y }
  }, [lng, lat] as const)
}

/**
 * In vertex edit, hover the middle of the first feature's first edge so its midpoint marker shows
 * (both engines show only the hovered edge's midpoint), and return the marker's centre.
 */
export async function hoverFirstEdgeMidpoint(page: Page): Promise<{ x: number; y: number }> {
  const [a, b] = await page.evaluate(() => {
    const g = window.__elementEditorTest!.dataStore.getState().features[0].geometry as { type: string; coordinates: unknown }
    const ring = (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g.coordinates) as number[][]
    return [ring[0], ring[1]]
  })
  const p = await screenPoint(page, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  await page.mouse.move(p.x, p.y, { steps: 3 })
  const mid = page.locator('.elm-midpoint-marker:visible')
  await expect(mid).toHaveCount(1)
  const box = (await mid.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Opt-in to "stay-in-tool after commit" behavior for a test.
 *
 * The e2e fixture seeds auto-exit-after-draw (settings toggle "Return to
 * select after each shape") for the older specs, although the production
 * default is now stay-in-tool; tests that exercise interactions which only
 * make sense while a draw tool is still active post-commit (Cmd-translate,
 * Alt-duplicate, Enter→vertex-edit on the just-drawn shape, etc.) must opt in
 * by setting the localStorage flag BEFORE navigation so the store reads it on
 * mount.
 */
export async function enableStayInTool(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('elm_autoExitAfterDraw', 'false') } catch {}
  })
}

/**
 * Seed features via the dev-mode `window.__elementEditorTest` hook (exposed from
 * `<ElementEditor>` when `import.meta.env.DEV` is true). This replaces the old
 * "click Import and paste" flow — the Import button was removed from the UI,
 * so the old helper would hang waiting for a button that never appears.
 */
export async function importGeoJSON(page: Page, geojson: string) {
  const json = typeof geojson === 'string' ? geojson : JSON.stringify(geojson)
  await page.waitForFunction(() => !!window.__elementEditorTest)
  await page.evaluate((raw) => {
    const handle = window.__elementEditorTest
    if (!handle) throw new Error('window.__elementEditorTest not available — is the dev server running?')
    handle.dataStore.getState().importGeoJSON(JSON.parse(raw), 'replace')
  }, json)
}

/** Intercept Nominatim with a fixed set of results */
export async function mockNominatim(page: Page, results: object[] = []) {
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(results) })
  )
}

/** Default Nominatim stub result */
export const NOMINATIM_EIFFEL = {
  place_id: 1,
  display_name: 'Eiffel Tower, Paris, France',
  lat: '48.8584',
  lon: '2.2945',
  type: 'attraction',
  addresstype: 'attraction',
}

// ─── Drawing helpers ────────────────────────────────────────────────────────
//
// Consolidated versions of the per-spec drawPolygon / drawLine / drawRect
// functions. Each uses `locator.click({ position })` (not `page.mouse.click`)
// so Leaflet's `e.originalEvent.detail > 1` dblclick guard doesn't drop the
// 2nd click when tests run faster than the dblclick threshold.

export async function mapBox(page: Page) {
  const box = await mapLocator(page).boundingBox()
  if (!box) throw new Error('map container not mounted')
  return box
}

interface ShapeOpts {
  /** Half-width of the shape in CSS pixels from the map centre. Default 100. */
  width?: number
  /** Half-height. Default 60. */
  height?: number
  /** Centre as a fraction of the map width. Default 0.5 (the layers panel covers the right ~25%). */
  x?: number
}

/**
 * Activate polygon mode, click 4 vertices around the map centre, press Enter
 * to commit. Auto-exit-after-draw (the production default) drops the tool back
 * to 'none' on commit (the fixture's seeded setting), leaving the polygon selected in single-selection mode.
 * If a test needs the tool to remain active, call enableStayInTool(page) first.
 */
export async function drawPolygon(page: Page, opts: ShapeOpts = {}): Promise<{ cx: number; cy: number }> {
  const { width = 80, height = 60, x = 0.5 } = opts
  const map = mapLocator(page)
  const box = await mapBox(page)
  const cx = box.width * x
  const cy = box.height / 2
  const before = await featureCount(page)
  await page.keyboard.press('g')
  await map.click({ position: { x: cx - width, y: cy - height } })
  await page.waitForTimeout(200)
  await map.click({ position: { x: cx + width, y: cy - height } })
  await page.waitForTimeout(200)
  await map.click({ position: { x: cx + width, y: cy + height } })
  await page.waitForTimeout(200)
  await map.click({ position: { x: cx - width, y: cy + height } })
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await expect.poll(() => featureCount(page)).toBe(before + 1)
  /** Page coordinates of the polygon's centre. */
  return { cx: box.x + cx, cy: box.y + cy }
}

/** Activate line mode, place 3 vertices, press Enter to commit. Tool exits to
 *  'none' after commit (the fixture's seeded setting — call enableStayInTool to keep it). */
export async function drawLine(page: Page, opts: ShapeOpts = {}) {
  const { width = 100, height = 50 } = opts
  const map = mapLocator(page)
  const box = await mapBox(page)
  const cx = box.width / 2
  const cy = box.height / 2
  await page.keyboard.press('l')
  await map.click({ position: { x: cx - width, y: cy } })
  await page.waitForTimeout(250)
  await map.click({ position: { x: cx, y: cy - height } })
  await page.waitForTimeout(250)
  await map.click({ position: { x: cx + width, y: cy } })
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
}

/** Activate rectangle mode, drag to draw a rectangle. Tool exits after commit
 *  under the fixture's seeded setting; call enableStayInTool(page) if you need it to remain active. */
export async function drawRect(page: Page, opts: ShapeOpts = {}) {
  const { width = 100, height = 60 } = opts
  const box = await mapBox(page)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.keyboard.press('r')
  await page.mouse.move(cx - width, cy - height)
  await page.mouse.down()
  await page.mouse.move(cx + width, cy + height, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

/**
 * drawPolygon, then wait until the committed polygon is the selection (the commit selects it).
 * No click on it: MapLibre hit-tests rendered features, so a click before the new polygon is
 * drawn (a loaded machine) lands on "empty map" and deselects it.
 */
export async function drawAndSelectPolygon(page: Page, opts: ShapeOpts = {}) {
  await drawPolygon(page, opts)
  await expect.poll(() => selectedIds(page)).toHaveLength(1)
}

/**
 * Move the map to `[lat, lng]` at `zoom` without animation (MapLibre's flyTo from the
 * default view to z18 takes longer than a test should wait). Used when you need the
 * viewport zoomed in on a specific feature so screen-space clicks land on it.
 * `ref.flyTo` itself is covered by maplibre-dropin.spec.ts.
 *
 * Note MapLibre's 512 px tiles: the same zoom shows twice Leaflet's scale. Project
 * coordinates (`screenPoint`) rather than assuming pixel sizes.
 *
 * Waits for the store's `currentZoom` (synced on moveend) to reach the target.
 */
export async function flyTo(page: Page, latlng: [number, number], zoom = 13) {
  await page.waitForFunction(() => !!window.__elementEditorTest?.map)
  await page.evaluate(([lat, lng, z]) => {
    const m = window.__elementEditorTest!.map
    if ('jumpTo' in m) m.jumpTo({ center: [lng, lat], zoom: z })
    else m.setView([lat, lng], z, { animate: false })
  }, [latlng[0], latlng[1], zoom] as const)
  await page.waitForFunction(
    (target) => {
      const s = window.__elementEditorTest
      return !!s && Math.round(s.dataStore.getState().currentZoom) === target
    },
    zoom,
    { timeout: 4000 },
  )
}

/** Click a feature row in the sidebar by its visible name. */
export async function selectByName(page: Page, name: string) {
  await page.getByText(name).click()
  await page.waitForTimeout(300)
}

// ─── CodeMirror assertions ──────────────────────────────────────────────────

/**
 * Assert the modal's CodeMirror viewport contains a substring.
 *
 * CodeMirror 6 splits syntax-highlighted strings across spans (so
 * `getByText('"Paris"')` doesn't match) AND virtualizes long documents
 * (content more than ~1 KB below the viewport isn't in the DOM at all).
 * For populated-state assertions, prefer content near the top of the JSON
 * (feature id, schema field name, etc.).
 */
export async function expectModalContains(page: Page, text: string, timeout = 3000) {
  await expect(page.locator('.cm-content')).toContainText(text, { timeout })
}

/**
 * Screen point at the centre of a feature's bbox, looked up by name in the store.
 * Unselected Leaflet features are drawn on a shared canvas (no per-feature DOM
 * element), so tests locate them through the store + map projection instead of
 * querying `path` elements.
 */
export async function featureCenter(page: Page, name: string): Promise<{ id: string; x: number; y: number }> {
  const f = await page.evaluate((n) => {
    const f = window.__elementEditorTest!.dataStore.getState().features.find((x) => x.properties?.name === n)
    if (!f) return null
    const flat = (JSON.stringify(f.geometry).match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)
    const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1)
    return { id: f.id, lng: (Math.min(...xs) + Math.max(...xs)) / 2, lat: (Math.min(...ys) + Math.max(...ys)) / 2 }
  }, name)
  if (!f) throw new Error(`no feature named ${name}`)
  return { id: f.id, ...(await screenPoint(page, f.lng, f.lat)) }
}

/** Ids currently selected in the data store. */
export function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
}

/**
 * Seed one selected LineString (`id: 'zigzag'`) across the middle of the current view:
 * 13 points with big zigzags and tiny wiggles, so Simplify has points to drop and Smooth
 * corners to round. Replaces any existing features. Returns its coordinates.
 */
export async function seedSelectedZigzagLine(page: Page): Promise<number[][]> {
  await page.waitForFunction(() => !!window.__elementEditorTest?.map)
  const coords = await page.evaluate(() => {
    const b = window.__elementEditorTest!.map.getBounds()
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth()
    const midY = (s + n) / 2, h = n - s
    // 20%..60% of the width keeps the line clear of the layers panel on the right.
    return Array.from({ length: 13 }, (_, i) => [
      w + (e - w) * (0.2 + 0.4 * i / 12),
      midY + (i % 4 === 1 ? 0.15 * h : i % 4 === 3 ? -0.15 * h : i % 8 === 2 ? 0.002 * h : 0),
    ])
  })
  await importGeoJSON(page, JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'zigzag', geometry: { type: 'LineString', coordinates: coords }, properties: { name: 'Zigzag' } }],
  }))
  await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectFeature('zigzag'))
  await expect.poll(() => selectedIds(page)).toEqual(['zigzag'])
  return coords
}
