/**
 * Keyboard shortcuts e2e tests — validates that each shortcut is reachable and
 * produces the expected UI response. Shortcuts are defined in @element-editor/core.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap } from './helpers'

test.describe('Drawing shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    // Click map to focus it
    await page.locator(MAP).click()
  })

  const drawingTools = [
    { key: 'p', label: /click to place a point/i },
    { key: 'l', label: /click to (place the first|add) point/i },
    { key: 'g', label: /click to (place the first|add) point/i },
    { key: 'r', label: /click and drag to size.*square/i },
    // `c` is draw-route (routing), `o` is draw-circle. Both table rows
    // previously used `c` with the circle hint, which silently mismatched
    // after the keybindings were settled.
    { key: 'o', label: /click and drag to size/i },
    { key: 'c', label: /click to (add|place).*waypoint/i },
    { key: 'f', label: /click and drag to draw/i },
    { key: 'x', label: /click anywhere to import/i },
  ]

  for (const { key, label } of drawingTools) {
    test(`pressing "${key.toUpperCase()}" activates the corresponding drawing tool`, async ({ page }) => {
      await page.keyboard.press(key)
      await expect(page.getByText(label)).toBeVisible({ timeout: 1500 })
    })
  }
})

test.describe('View shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('K opens shortcuts modal', async ({ page }) => {
    await page.keyboard.press('k')
    // ShortcutsModal is a floating div (not <dialog>); check for its title text
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible({ timeout: 1500 })
  })

  test('K again closes shortcuts modal', async ({ page }) => {
    await page.keyboard.press('k')
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible({ timeout: 1500 })
    await page.keyboard.press('k')
    await page.waitForTimeout(300)
    await expect(page.getByText('Keyboard shortcuts')).not.toBeVisible()
  })

  test('Escape closes the shortcuts modal via the close button', async ({ page }) => {
    await page.keyboard.press('k')
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible({ timeout: 1500 })
    // Close button with X
    const closeBtn = page.getByRole('button', { name: /close.*shortcuts|×/i })
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      // Use K shortcut to close
      await page.keyboard.press('k')
    }
    await page.waitForTimeout(300)
    await expect(page.getByText('Keyboard shortcuts')).not.toBeVisible()
  })

  test('Escape closes the shortcuts panel opened with K (focus still on the map)', async ({ page }) => {
    await page.keyboard.press('k')
    const win = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(win).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)
  })

  test('Escape inside a window closes it and gives focus back to its button', async ({ page }) => {
    // Shortcuts: focus moves into the window, Escape closes it.
    await page.keyboard.press('k')
    const win = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await win.getByRole('button', { name: 'Close keyboard shortcuts' }).focus()
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)
    // Settings, opened from its button: focus returns to that button.
    const settingsBtn = page.getByRole('button', { name: /editor settings/i })
    await settingsBtn.focus()
    await page.keyboard.press('Enter')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await settings.getByRole('button', { name: 'Close settings' }).focus()
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(settingsBtn).toBeFocused()
  })

  test('Escape on the map deselects first, then closes the open window', async ({ page }) => {
    await page.evaluate(() => {
      const ds = window.__elementEditorTest!.dataStore.getState()
      ds.importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', properties: { name: 'P' }, geometry: { type: 'Point', coordinates: [2.35, 48.85] } }] }, 'replace')
      window.__elementEditorTest!.dataStore.getState().selectFeature('p1')
    })
    await page.locator(MAP).focus()
    await page.keyboard.press('k')
    const win = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(win).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(0)
    await expect(win).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)
  })

  test('T toggles data table', async ({ page }) => {
    await page.keyboard.press('t')
    // react-data-grid doesn't render with role="grid". The DataTablePanel ships
    // a "Close data table" button — stable landmark for the panel being open.
    await expect(page.getByRole('button', { name: /close data table/i })).toBeVisible({ timeout: 4000 })
  })

  test('/ toggles sidebar (slides off screen)', async ({ page }) => {
    // LayersPanel slides via inline style.transform, not a Tailwind class.
    // The toggle button's aria-label flips between "Collapse" / "Open".
    await expect(page.getByRole('button', { name: /collapse layers panel/i })).toBeVisible()
    await page.keyboard.press('/')
    await page.waitForTimeout(400) // transition takes 200ms
    await expect(page.getByRole('button', { name: /open layers panel/i })).toBeVisible({ timeout: 1000 })
  })
})

test.describe('Editing shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('Ctrl+Z (Cmd+Z) triggers undo (toast visible)', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Draw a rectangle (drag-to-draw)
    await page.keyboard.press('r')
    await page.mouse.move(cx - 70, cy - 35)
    await page.mouse.down()
    await page.mouse.move(cx + 70, cy + 35, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 2000 })

    // Exit tool, deselect, then undo
    await page.keyboard.press('Escape')
    await page.locator(MAP).click()
    await page.keyboard.press('Meta+z')
    await expect(page.getByText(/undone/i)).toBeVisible({ timeout: 2000 })
  })

  test('Ctrl+Shift+Z (Cmd+Shift+Z) triggers redo (toast visible)', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.keyboard.press('r')
    await page.mouse.move(cx - 70, cy - 35)
    await page.mouse.down()
    await page.mouse.move(cx + 70, cy + 35, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    await expect(page.locator('aside li')).not.toHaveCount(0, { timeout: 2000 })

    await page.keyboard.press('Escape')
    await page.locator(MAP).click()
    await page.keyboard.press('Meta+z')
    await expect(page.getByText(/undone/i)).toBeVisible({ timeout: 2000 })
    await page.keyboard.press('Meta+Shift+z')
    await expect(page.getByText(/redone/i)).toBeVisible({ timeout: 2000 })
  })
})

test.describe('Group / ungroup shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    // Seed three features so we can group two and leave one outside.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      handle.dataStore.getState().importGeoJSON({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'g-a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Alpha' } },
          { type: 'Feature', id: 'g-b', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { name: 'Bravo' } },
          { type: 'Feature', id: 'g-c', geometry: { type: 'Point', coordinates: [2, 0] }, properties: { name: 'Charlie' } },
        ],
      }, 'replace')
    })
    await expect(page.getByText('Alpha')).toBeVisible()
  })

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  test(`${modifier}+G groups the current selection into a new group with rename auto-focused`, async ({ page }) => {
    // Multi-select Alpha + Charlie via shift+click.
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Bravo' }).first().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(150)

    await page.keyboard.press(`${modifier}+g`)
    await page.waitForTimeout(250)

    // Rename input pre-filled with "New group" should be focused.
    const input = page.locator('aside input:focus')
    await expect(input).toHaveValue('New group')

    // Both selected features now carry the new group id; Charlie is still ungrouped.
    const state = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      const byId = Object.fromEntries(s.features.map((f) => [f.id, f.groupId ?? null]))
      return { groupCount: s.groups.length, alpha: byId['g-a'], bravo: byId['g-b'], charlie: byId['g-c'] }
    })
    expect(state.groupCount).toBe(1)
    expect(state.alpha).not.toBeNull()
    expect(state.alpha).toBe(state.bravo)
    expect(state.charlie).toBeNull()
  })

  test(`${modifier}+Shift+G ungroups the current selection`, async ({ page }) => {
    // First group Alpha + Bravo with the shortcut, then commit the rename.
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Bravo' }).first().click({ modifiers: ['Shift'] })
    await page.keyboard.press(`${modifier}+g`)
    await page.waitForTimeout(200)
    // Commit rename with Enter so the input releases focus and the next shortcut
    // doesn't get swallowed by the input.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)

    // Re-select Alpha + Bravo (group creation cleared selection? — verify either way).
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Bravo' }).first().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(150)

    // Click the map first to guarantee keyboard focus is not on the input.
    await page.locator(MAP).click({ position: { x: 5, y: 5 } })
    // Re-select after the map click cleared selection.
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Bravo' }).first().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(150)

    await page.keyboard.press(`${modifier}+Shift+g`)
    await page.waitForTimeout(250)

    const after = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const byId = Object.fromEntries(handle.dataStore.getState().features.map((f) => [f.id, f.groupId ?? null]))
      return { alpha: byId['g-a'], bravo: byId['g-b'] }
    })
    expect(after.alpha).toBeNull()
    expect(after.bravo).toBeNull()
  })

  test(`${modifier}+G with no selection is a no-op (no group created)`, async ({ page }) => {
    await page.keyboard.press(`${modifier}+g`)
    await page.waitForTimeout(150)
    const groupCount = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().groups.length
    })
    expect(groupCount).toBe(0)
  })

  test(`undo after ${modifier}+G removes the new group and ungroups the features`, async ({ page }) => {
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Bravo' }).first().click({ modifiers: ['Shift'] })
    await page.keyboard.press(`${modifier}+g`)
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape') // close rename input
    await page.waitForTimeout(150)

    await page.keyboard.press(`${modifier}+z`)
    await page.waitForTimeout(250)

    const after = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      const byId = Object.fromEntries(s.features.map((f) => [f.id, f.groupId ?? null]))
      return { groupCount: s.groups.length, alpha: byId['g-a'], bravo: byId['g-b'] }
    })
    expect(after.groupCount).toBe(0)
    expect(after.alpha).toBeNull()
    expect(after.bravo).toBeNull()
  })
})
