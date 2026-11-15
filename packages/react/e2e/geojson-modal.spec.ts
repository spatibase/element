/**
 * GeoJSON inspector modal e2e tests — opening, viewing, copying GeoJSON.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON, expectModalContains, storeCaller } from './helpers'

test.describe('GeoJSON modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('GeoJSON button opens the code modal', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)

    await page.getByRole('button', { name: /show geojson/i }).click()

    await expect(page.locator('.cm-content')).toBeVisible()
    await expectModalContains(page, 'FeatureCollection')
  })

  test('GeoJSON modal shows valid JSON with features', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)

    await page.getByRole('button', { name: /show geojson/i }).click()

    // Feature id lives near the top of the JSON — "Paris" is below the
    // virtualized viewport.
    await expectModalContains(page, 'e2e-point-1')
  })

  test('Copy button copies GeoJSON to clipboard', async ({ page, context }) => {
    // Grant clipboard-write so navigator.clipboard.writeText resolves.
    // Without it, GeoJSONModal's handleCopy rejects silently.
    await context.grantPermissions(['clipboard-write'])
    await importGeoJSON(page, SAMPLE_GEOJSON)

    await page.getByRole('button', { name: /show geojson/i }).click()

    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible({ timeout: 3000 })
  })

  test('close button closes the modal', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)

    await page.getByRole('button', { name: /show geojson/i }).click()

    // Two "Close" buttons exist app-wide ("Close data table" + modal "Close").
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await expect(page.locator('.cm-content')).not.toBeVisible({ timeout: 2000 })
  })

  test('store edits patch the open inspector, typing updates the map, selection highlights', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await page.getByRole('button', { name: /show geojson/i }).click()
    const dialog = page.locator('[aria-label="GeoJSON inspector"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveAttribute('data-loading')

    // The editor's text (via Copy) must equal exportGeoJSON() after each patch.
    const copied = async () => {
      await page.getByRole('button', { name: 'Copy', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
      const text = await page.evaluate(() => navigator.clipboard.readText())
      await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible({ timeout: 4000 })
      return text
    }
    const exported = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().exportGeoJSON() as string)
    const store = storeCaller(page)

    await store('updateFeature', 'e2e-point-1', { properties: { name: 'Lyon' } })
    await store('addFeature', { type: 'Feature', id: 'e2e-added', geometry: { type: 'Point', coordinates: [4.83, 45.76] }, properties: { name: 'Added' } })
    expect(await copied()).toBe(await exported())
    await store('deleteFeature', 'e2e-point-1')
    expect(await copied()).toBe(await exported())

    // Selecting a feature highlights its lines.
    await store('selectFeature', 'e2e-added')
    await expect(page.locator('.cm-feature-highlight').first()).toBeVisible()
    await expect(page.locator('.cm-feature-highlight')).toContainText(['{'])
    await store('selectFeature', null)
    await expect(page.locator('.cm-feature-highlight')).toHaveCount(0)

    // Typing into the editor updates the features (debounced) and the map.
    const fc = JSON.parse(await exported())
    fc.features[0].properties.name = 'Typed name'
    fc.features[0].geometry.coordinates = [2.5, 48.5]
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText(JSON.stringify(fc, null, 2))
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].properties.name), { timeout: 5000 }).toBe('Typed name')
    await expect(page.getByText('Typed name').first()).toBeVisible()
    const coords = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[0].geometry.coordinates)
    expect(coords).toEqual([2.5, 48.5])
  })

  test('typing into one feature among many replaces only that feature', async ({ page }) => {
    // Fake timers from the start (time still flows); the test pauses them around the debounce.
    await page.clock.install()
    await page.goto('/')
    await waitForMap(page)
    const ds = storeCaller(page)
    const features = Array.from({ length: 40 }, (_, i) => ({ type: 'Feature', id: `p${i}`, geometry: { type: 'Point', coordinates: [i * 0.1, 45] }, properties: { name: `Point ${i}` } }))
    await ds('importGeoJSON', { type: 'FeatureCollection', features }, 'replace')
    await page.getByRole('button', { name: /show geojson/i }).click()
    const dialog = page.locator('[aria-label="GeoJSON inspector"]')
    await expect(dialog).not.toHaveAttribute('data-loading')

    await ds('selectFeature', 'p20')
    const nameLine = page.locator('.cm-line.cm-feature-highlight', { hasText: '"name": "Point 20"' })
    await nameLine.click()
    await page.evaluate(() => {
      const w = window as any
      w.__before = w.__elementEditorTest.dataStore.getState().features
      w.__undo = w.__elementEditorTest.dataStore.getState().undoStack.length
    })
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft') // before the closing quote (no comma: name is the last property)

    // Mid-edit text that doesn't parse (the closing quote deleted): nothing is written. Freeze the
    // page clock, then run it past the editor's commit debounce, so the debounced commit has
    // certainly fired (and been refused) before we look, without a wall-clock sleep.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    await page.keyboard.press('Delete')
    await page.keyboard.type(' edited')
    await page.clock.runFor(1000)
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features === (window as any).__before)).toBe(true)

    await page.keyboard.type('"')
    await page.clock.resume()
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[20].properties.name), { timeout: 5000 }).toBe('Point 20 edited')
    const result = await page.evaluate(() => {
      const w = window as any
      const s = w.__elementEditorTest.dataStore.getState()
      return { changed: s.features.map((f: unknown, i: number) => (f !== w.__before[i] ? i : -1)).filter((i: number) => i >= 0), undo: s.undoStack.length - w.__undo }
    })
    expect(result).toEqual({ changed: [20], undo: 1 })

    // The editor keeps tracking features after the commit: a store patch lands in the right place.
    await ds('updateFeature', 'p30', { properties: { name: 'Store edit' } })
    await ds('selectFeature', 'p30')
    await expect(page.locator('.cm-line.cm-feature-highlight', { hasText: '"name": "Store edit"' })).toBeVisible()
    const text = await page.evaluate(() => (document.querySelector('.cm-content') as HTMLElement).innerText)
    expect(text).toContain('"name": "Point 20 edited"')

    // A store change elsewhere while typing is uncommitted is patched around the typing, not over it.
    await page.locator('.cm-line.cm-feature-highlight', { hasText: '"name": "Store edit"' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type(' typed')
    await ds('updateFeature', 'p5', { properties: { name: 'Meanwhile' } })
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[30].properties.name), { timeout: 5000 }).toBe('Store edit typed')
    expect(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features[5].properties.name)).toBe('Meanwhile')
  })

  test('empty state shows empty FeatureCollection', async ({ page }) => {
    await page.getByRole('button', { name: /show geojson/i }).click()

    await expectModalContains(page, 'FeatureCollection')
  })

  test('clicking a feature in the code selects it and moves the map; list selection highlights the code', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await page.getByRole('button', { name: /show geojson/i }).click()
    const dialog = page.locator('[aria-label="GeoJSON inspector"]')
    await expect(dialog).not.toHaveAttribute('data-loading')
    const selected = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds as string[])
    // Where a position lands relative to the centre of the map left of the right-hand panels
    // (layers panel, docked inspector): the jump centres the feature there, not under a panel.
    const offCentre = (lng: number, lat: number) => page.evaluate(({ lng, lat }) => {
      const m = window.__elementEditorTest!.map as unknown as {
        getContainer(): HTMLElement
        project?: (p: [number, number]) => { x: number; y: number }
        latLngToContainerPoint?: (p: [number, number]) => { x: number; y: number }
      }
      const p = m.latLngToContainerPoint ? m.latLngToContainerPoint([lat, lng]) : m.project!([lng, lat])
      const el = m.getContainer()
      const offset = parseFloat(getComputedStyle(el.closest('[data-elm-theme]')!).getPropertyValue('--elm-panel-offset')) || 0
      return Math.hypot(p.x - (el.clientWidth - offset) / 2, p.y - el.clientHeight / 2)
    }, { lng, lat })

    // Code → selection + map.
    await dialog.locator('.cm-line', { hasText: '"e2e-point-1"' }).click()
    await expect.poll(selected).toEqual(['e2e-point-1'])
    const pt = JSON.parse(SAMPLE_GEOJSON).features.find((f: { id: string }) => f.id === 'e2e-point-1').geometry.coordinates as [number, number]
    await expect.poll(() => offCentre(pt[0], pt[1]), { timeout: 3000 }).toBeLessThan(2)

    // Selection elsewhere → its code is highlighted.
    await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectFeature('e2e-line-1'))
    await expect(dialog.locator('.cm-line', { hasText: '"e2e-line-1"' })).toHaveClass(/cm-feature-highlight/)
  })

  test('deleting features in the code removes them from the store and the layer list; clearing it empties both', async ({ page }) => {
    const ds = storeCaller(page)
    const ids = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f: { id: string }) => f.id) as string[])
    const features = Array.from({ length: 40 }, (_, i) => ({ type: 'Feature', id: `p${i}`, geometry: { type: 'Point', coordinates: [i * 0.1, 45] }, properties: { name: `Point ${i}` } }))
    await ds('importGeoJSON', { type: 'FeatureCollection', features }, 'replace')
    await page.getByRole('button', { name: /show geojson/i }).click()
    const dialog = page.locator('[aria-label="GeoJSON inspector"]')
    await expect(dialog).not.toHaveAttribute('data-loading')

    // Select p20's whole lines (from column 0 of its first line) and delete them.
    await ds('selectFeature', 'p20')
    const lines = dialog.locator('.cm-line.cm-feature-highlight')
    await expect(lines.first()).toHaveText('    {')
    const n = await lines.count()
    await ds('selectFeature', null)
    await expect(lines).toHaveCount(0)
    await dialog.locator('.cm-line', { hasText: '"id": "p20"' }).click()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.press('Home') // past the indentation, to column 0
    for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Backspace')
    await expect.poll(ids, { timeout: 2000 }).toEqual(features.map((f) => f.id).filter((id) => id !== 'p20'))
    // The document is still exactly what the store serialises to. Read the editor, not the
    // clipboard: parallel workers share the OS pasteboard, so another test's Copy can land in between.
    const docText = await page.evaluate(() => (document.querySelector('.cm-content') as any).cmTile.view.state.doc.toString() as string)
    expect(docText).toBe(await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().exportGeoJSON()))

    // Clear the whole document: no features, the layer list's empty state.
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await expect.poll(ids, { timeout: 2000 }).toEqual([])
    await expect(page.getByText(/No features yet/).first()).toBeVisible()
  })
})
