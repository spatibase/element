import { test, expect, MAP } from './fixtures'
import { waitForMap, SAMPLE_GEOJSON, importGeoJSON } from './helpers'

/** Click the edit (pencil) button for a named feature row */
async function clickEditFor(page: Parameters<typeof importGeoJSON>[0], name: string) {
  const row = page.locator('aside li').filter({ hasText: name }).first()
  await row.hover()
  await row.getByRole('button', { name: /edit/i }).click()
}

test.describe('Feature CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('clicking edit button opens the feature side panel', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).toBeVisible()
  })

  test('side panel is pre-filled with the feature name', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    const nameInput = page.locator('aside').locator('input[type="text"]').first()
    await expect(nameInput).toHaveValue('Paris')
  })

  test('editing the name and saving updates the list', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    const nameInput = page.locator('aside').locator('input[type="text"]').first()

    await nameInput.fill('Renamed Paris')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()

    await expect(page.getByText('Renamed Paris')).toBeVisible()
    await expect(page.locator('aside').getByText('Paris', { exact: true })).not.toBeVisible()
  })

  test('Cmd+E opens the edit/detail side panel and focuses the first field', async ({ page }) => {
    // Select Paris in the layer list.
    await page.locator('aside li').filter({ hasText: 'Paris' }).first().click()
    await page.waitForTimeout(150)
    // Cmd+E should open the side panel form.
    await page.keyboard.press('Meta+e')
    await page.waitForTimeout(300)
    const nameInput = page.locator('aside').locator('input[type="text"]').first()
    await expect(nameInput).toHaveValue('Paris')
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).toBeVisible()
    // The first input is auto-focused so the user can start typing immediately.
    await expect(nameInput).toBeFocused()
  })

  // Regression: when a polygon is selected and the edit panel is open, the
  // window-level Enter handlers (FIL + useKeyboardShortcuts) used to toggle
  // vertex-edit even when a section header / Save button had focus. They now
  // bail when `dialogState.type !== 'closed'` so the focused control handles
  // Enter natively (toggle, copy, submit).
  test('Tab through the edit panel reaches Source / Copy / Coordinates / Save and Enter on Source toggles the section', async ({ page }) => {
    // Seed a polygon and open its edit panel.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      handle.dataStore.getState().importGeoJSON({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 'tab-poly',
          geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] },
          properties: { name: 'TabTest' },
        }],
      }, 'replace')
    })
    await page.locator('aside li').filter({ hasText: 'TabTest' }).first().click()
    await page.waitForTimeout(150)
    await page.keyboard.press('Meta+e')
    await page.waitForTimeout(300)

    // Walk Tab from the last visible input to confirm Source → Copy → Coordinates → Save.
    const inputs = page.locator('aside input, aside textarea')
    await inputs.last().focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('aside button:focus')).toContainText(/source/i)

    // Enter should expand the Source section (not toggle vertex-edit).
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    await expect(page.locator('aside pre')).toBeVisible()
    const ve = await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)
    expect(ve).toBe(false)

    await page.keyboard.press('Tab')
    await expect(page.locator('aside button:focus')).toHaveAttribute('aria-label', 'Copy source')

    await page.keyboard.press('Tab')
    await expect(page.locator('aside button:focus')).toContainText(/coordinates/i)

    await page.keyboard.press('Tab')
    await expect(page.locator('aside button:focus')).toContainText(/save/i)
  })

  test('Cmd+E with no selection is a no-op', async ({ page }) => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    await page.keyboard.press('Meta+e')
    await page.waitForTimeout(300)
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
  })

  test('Cmd+Enter saves and closes the side panel', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    await page.locator('aside').locator('input[type="text"]').first().fill('Paris via shortcut')
    await page.keyboard.press('Meta+Enter')
    await page.waitForTimeout(300)
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
    await expect(page.getByText('Paris via shortcut')).toBeVisible()
  })

  // Regression: when a user has stay-in-tool enabled (the "Return to select
  // after each shape" setting toggled OFF), editingMode can linger as
  // 'draw-polygon' (or similar) even when they've clicked Edit on a feature.
  // The side panel's `if (editingMode !== 'none') return` previously bailed in
  // that case and Cmd+Enter did nothing. The gate now looks at actual
  // in-progress geometry, not just the tool name.
  test('Cmd+Enter saves the panel even while a drawing tool is idle (stay-in-tool)', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    // Simulate "stay-in-tool" by setting editingMode without any in-progress shape.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      handle.uiStore.getState().setEditingMode('draw-polygon')
    })
    await page.waitForTimeout(150)
    await page.locator('aside').locator('input[type="text"]').first().fill('Paris stay-in-tool')
    await page.keyboard.press('Meta+Enter')
    await page.waitForTimeout(300)
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
    await expect(page.getByText('Paris stay-in-tool')).toBeVisible()
  })

  test('back button closes the panel without saving', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    await page.locator('aside').locator('input[type="text"]').first().fill('Should Not Save')
    await page.getByRole('button', { name: /back to layers/i }).click()

    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('failed save focuses the first input with an error', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    const nameInput = page.locator('aside').locator('input[type="text"]').first()
    await nameInput.fill('') // clear required field
    // Click Save (focus moves to Save button) — handleSave should now jump
    // focus back to the empty Name input.
    await page.locator('aside').getByRole('button', { name: /save/i }).click()
    await page.waitForTimeout(200)
    await expect(nameInput).toBeFocused()
  })

  test('save is blocked when required field is empty', async ({ page }) => {
    await clickEditFor(page, 'Paris')
    await page.locator('aside').locator('input[type="text"]').first().fill('')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()

    await expect(page.locator('aside').getByRole('button', { name: /save/i })).toBeVisible()
    await expect(page.locator('aside').getByText(/is required/i)).toBeVisible()
  })

  test('right-click context menu delete removes the feature from the list', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    // Context menu is a portalled div — find Delete button by text
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await page.waitForTimeout(300)

    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).not.toBeVisible()
  })

  test('undo after context menu delete restores the feature', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await page.waitForTimeout(300)
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).not.toBeVisible()

    // No toast on delete — the disappearance is its own confirmation. Undo via Cmd+Z.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await page.waitForTimeout(300)
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).toBeVisible()
  })

  test('delete via panel removes the feature immediately', async ({ page }) => {
    await clickEditFor(page, 'Paris')

    await page.locator('aside').getByRole('button', { name: /delete feature/i }).click()
    await page.waitForTimeout(300)

    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).not.toBeVisible()
  })
})

test.describe('Add Point via map click', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('keyboard shortcut P activates place-point mode', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('p')
    // Hint bar should appear
    await expect(page.getByText(/click to place a point/i)).toBeVisible()
  })

  test('pressing P again toggles off place-point mode', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/click to place a point/i)).not.toBeVisible()
  })

  test('clicking map in place-point mode adds a feature directly to the list', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible()

    const map = page.locator(MAP)
    await map.click({ position: { x: 400, y: 300 } })
    await page.waitForTimeout(300)

    // Feature is added directly (no new-point form) — feature list should have a new entry
    const items = page.locator('aside li')
    await expect(items).not.toHaveCount(0, { timeout: 3000 })
  })

  test('placed point can be edited via the list row', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('p')
    const map = page.locator(MAP)
    await map.click({ position: { x: 400, y: 300 } })
    await page.waitForTimeout(300)

    // Open edit panel via the edit button on the newly added row
    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()

    await expect(page.locator('aside').getByRole('button', { name: /save/i })).toBeVisible()
  })

  test('placed point name can be edited and saved', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('p')
    const map = page.locator(MAP)
    await map.click({ position: { x: 400, y: 300 } })
    await page.waitForTimeout(300)

    const row = page.locator('aside li').first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()

    const nameInput = page.locator('aside').locator('input[type="text"]').first()
    await nameInput.fill('My New Point')
    await page.locator('aside').getByRole('button', { name: /save/i }).click()

    await expect(page.getByText('My New Point')).toBeVisible()
  })
})
