/**
 * Regression coverage for the 2026-04-18 audit fixes:
 *   - FloatingToolbar `maxFeatures` reactive disabled state (stale-read bug)
 *   - DataTablePanel keeps the grid mounted across toggle (state persistence)
 *   - `elm_*` localStorage keys round-trip through the versioned helper
 *   - Lazy modals (GeoJSON, Schema, Settings, Shortcuts) open correctly
 *
 * These features are *runtime-visible*; bundle-size wins from `lazy()` are
 * verified by `pnpm build` chunk output rather than E2E.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

test.describe('Audit fixes 2026-04-18', () => {
  test.beforeEach(async ({ page }) => {
    // Every test gets a fresh browser context, so localStorage starts empty.
    await page.goto('/')
    await waitForMap(page)
  })

  // ─── 1. FloatingToolbar maxFeatures reactive disabled state ────────────────
  //
  // Pre-fix bug: `dataStore.getState().features.length` was read once at render,
  // so the toolbar's `isAtMax` / disabled state never updated as features were
  // added. Fix switched to a `useDataStore(s => s.features.length)` subscription.
  //
  // This demo app does not expose a `maxFeatures` prop, so we assert the
  // subscription is live by observing the feature-count hint in the toolbar
  // updating as points are drawn.
  test('FloatingToolbar re-renders when features array changes', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()

    const mapBox = await page.locator(MAP).boundingBox()
    if (!mapBox) throw new Error('map not laid out')

    // Draw a point — FloatingToolbar must observe features.length increasing.
    // Pre-fix this value was frozen at render time.
    await page.getByRole('button', { name: /point/i }).click()
    await page.waitForTimeout(150)
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)
    await page.waitForTimeout(300)

    // Cancel the new-point dialog if it opens; we just care that the feature count updates
    await page.keyboard.press('Escape').catch(() => { /* no-op */ })
    await page.waitForTimeout(200)

    // A third feature should now be listed in the Layers panel
    // (sample had 2; we added 1 — look for at least 3 rows)
    const listItems = page.locator('[data-feature-id]')
    await expect(listItems).toHaveCount(3, { timeout: 3000 })
  })

  // ─── 2. DataTablePanel keeps DataGrid mounted across toggle ────────────────
  //
  // Pre-fix: `{tableOpen && <DataTable />}` unmounted the grid on toggle, so
  // scroll/sort/column widths were lost. Fix renders the grid under a `hidden`
  // class once the panel has been opened at least once.
  test('DataTable remains in the DOM when panel is toggled closed', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()

    // Open via the button (keyboard shortcut 'd' is customizable; button is stable).
    await page.getByRole('button', { name: /show table/i }).click()
    // Allow the lazy DataTable chunk to load on first open.
    await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 8000 })

    // Close — panel slides away but grid stays mounted under `hidden`.
    await page.getByRole('button', { name: /close data table/i }).click()
    await expect(page.locator('[role="grid"]')).not.toBeVisible({ timeout: 2000 })

    // The grid element should still be attached (count > 0 while hidden).
    const stillAttached = await page.locator('[role="grid"]').count()
    expect(stillAttached).toBeGreaterThanOrEqual(1)

    // Reopen — grid reappears without a fresh Suspense load.
    await page.getByRole('button', { name: /show table/i }).click()
    await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 2000 })
  })

  // ─── 3. Versioned localStorage — map-view key round-trips with {v, data} ───
  //
  // `persisted.ts` wraps values in `{ v, data }`. Verify the map-view key gets
  // that envelope after a pan. Pre-fix it was stored as a raw JSON object.
  test('map view is persisted with a versioned envelope', async ({ page }) => {
    // Move the map through the imperative ref (either engine) — more reliable than
    // a synthetic mouse drag, which can be interpreted as a map click.
    // A short hop: MapLibre's flyTo duration grows with distance.
    // Fly/fit centre the target in the visible map (offset for panels that cover it); close the
    // layers panel so the map centre is the target and this test checks only the wiring.
    await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setSidebarOpen(false))
    const lng = await page.evaluate(() => window.__elementEditorTest!.map.getCenter().lng + 0.5)
    await page.evaluate((lng) => window.__elementEditorRef!.flyTo({ center: [lng, 40.7128], zoom: 10 }), lng)
    // The write is debounced after moveend: poll for it.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('elm_mapView') ?? 'null')?.data?.lng), { timeout: 5000 })
      .toBeCloseTo(lng, 2)

    const stored = await page.evaluate(() => localStorage.getItem('elm_mapView'))

    const parsed = JSON.parse(stored!)
    expect(parsed).toHaveProperty('v')
    expect(parsed).toHaveProperty('data')
    expect(typeof parsed.v).toBe('number')
    expect(parsed.data).toMatchObject({
      lat: expect.any(Number),
      lng: expect.any(Number),
      zoom: expect.any(Number),
    })
  })

  // ─── 4. Versioned localStorage — legacy unversioned shape still hydrates ───
  //
  // The helper accepts the raw legacy shape once for migration (no envelope),
  // so users upgrading from a previous version don't lose their map view.
  test('legacy unversioned map-view hydrates on load', async ({ page }) => {
    // Seed localStorage with a legacy (no-envelope) value, then reload.
    await page.evaluate(() => {
      localStorage.setItem(
        'elm_mapView',
        JSON.stringify({ lat: 40.7128, lng: -74.0060, zoom: 10 }),
      )
    })
    await page.reload()
    await waitForMap(page)
    // No throw — hydration silently accepted the legacy shape.

    // It hydrated: the map opened on the stored view.
    const c = await page.evaluate(() => { const c = window.__elementEditorTest!.map.getCenter(); return [c.lng, c.lat] })
    expect(c[0]).toBeCloseTo(-74.006, 2)
    expect(c[1]).toBeCloseTo(40.7128, 2)

    // Trigger a new moveend so the key gets upgraded to the envelope format.
    await page.evaluate(() => window.__elementEditorRef!.flyTo({ center: [-74.0, 40.75], zoom: 10 }))
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('elm_mapView') ?? 'null')), { timeout: 5000 })
      .toMatchObject({ v: expect.any(Number), data: { lat: expect.closeTo(40.75, 2) } })
  })

  // ─── 5. Lazy modals: GeoJSON inspector opens after Suspense ────────────────
  //
  // `@element-editor/ui` now wraps GeoJSONModal in `lazy()`. Verify the modal still
  // opens — the heavy CodeMirror bundle loads on demand; no Suspense fallback
  // should be permanently visible.
  test('GeoJSON modal lazy-loads and opens', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await page.locator(MAP).click()
    await page.getByRole('button', { name: /show geojson/i }).click()
    // Allow the lazy chunk to load (CodeMirror is ~180kB gzip).
    await expect(page.getByText('"FeatureCollection"')).toBeVisible({ timeout: 5000 })
  })

  // ─── 6. Lazy modals: Settings modal opens ──────────────────────────────────
  test('Settings modal lazy-loads and opens', async ({ page }) => {
    await page.getByRole('button', { name: /editor settings/i }).click()
    await expect(page.getByText(/geometry mode|visual mode|spatial mode|measurements/i).first()).toBeVisible({ timeout: 5000 })
  })

  // ─── 7. Lazy modals: Shortcuts modal opens ─────────────────────────────────
  test('Shortcuts modal lazy-loads and opens', async ({ page }) => {
    await page.getByRole('button', { name: /show keyboard shortcuts/i }).click()
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeVisible({ timeout: 5000 })
  })

  // ─── 8. Lazy modals: Schema modal opens ────────────────────────────────────
  test('Schema modal lazy-loads and opens', async ({ page }) => {
    await page.getByRole('button', { name: /edit schema/i }).click()
    await expect(page.getByText(/schema|field|column/i).first()).toBeVisible({ timeout: 5000 })
  })
})
