/**
 * Layer management e2e tests — groups, visibility toggle, feature ordering,
 * and sidebar panel interactions.
 */
import { test, expect, MAP } from './fixtures'
import { waitForMap, importGeoJSON, SAMPLE_GEOJSON } from './helpers'

test.describe('Layer list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('features are listed in the sidebar', async ({ page }) => {
    const list = page.locator('aside li')
    await expect(list.filter({ hasText: 'Paris' })).toBeVisible()
    await expect(list.filter({ hasText: 'Test Route' })).toBeVisible()
  })

  test('hovering a row reveals the edit button', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.hover()
    // Only "Edit" button is shown on hover (delete is via context menu)
    await expect(row.getByRole('button', { name: /^edit$/i })).toBeVisible()
  })

  test('clicking feature row selects it (inner div gets the selected row class)', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click()
    await page.waitForTimeout(300)
    // The inner div inside the li gets bg-(--elm-row-selected) when selected
    const innerDiv = row.locator('div').filter({ hasText: 'Paris' }).first()
    await expect(innerDiv).toHaveClass(/bg-\(--elm-row-selected\)/, { timeout: 1000 })
  })

  test('Escape deselects a selected feature', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await expect(page.locator('aside').getByRole('button', { name: /save/i })).not.toBeVisible()
  })
})

test.describe('Sidebar toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('/ key toggles sidebar (slides fully off-screen and back)', async ({ page }) => {
    // Checks where the panel is, not how it moves (it animates `right`, in
    // lockstep with the data table and docked inspector).
    const aside = page.locator('aside').first()
    const viewportWidth = page.viewportSize()!.width
    const edges = async () => {
      const box = (await aside.boundingBox())!
      return { left: Math.round(box.x), right: Math.round(box.x + box.width) }
    }
    await expect.poll(async () => (await edges()).right).toBe(viewportWidth)

    await page.locator(MAP).click()
    await page.keyboard.press('/')
    await expect.poll(async () => (await edges()).left, { timeout: 1000 }).toBeGreaterThanOrEqual(viewportWidth)

    await page.keyboard.press('/')
    await expect.poll(async () => (await edges()).right, { timeout: 1000 }).toBe(viewportWidth)
  })
})

test.describe('Group management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('add group button exists in sidebar', async ({ page }) => {
    // Look for a "New Group" or "Add Group" button
    const groupBtn = page.getByRole('button', { name: /new group|add group/i })
    await expect(groupBtn).toBeVisible()
  })

  test('creating a group adds it to the list', async ({ page }) => {
    const groupBtn = page.getByRole('button', { name: /^new group$/i })
    await groupBtn.click()
    await page.waitForTimeout(200)
    // The new group row appears in rename mode (auto-focused input) — value is "New group"
    await expect(page.locator('aside input[value="New group"]').or(
      page.locator('aside').getByText('New group').first()
    )).toBeVisible()
  })
})

test.describe('Feature visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('context menu on feature row offers hide option', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    // Context menu is a portalled div; find hide/show option directly (may have multiple, use first)
    await expect(page.getByRole('button', { name: /hide from map|show on map/i }).first()).toBeVisible()
  })

  test('hide from map flips feature.hidden and the context menu flips to "Show on map"', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /^hide from map$/i }).first().click()
    await page.waitForTimeout(200)

    // Store flag flipped
    const hidden = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().features.find((f) => f.properties.name === 'Paris')?.hidden ?? false
    })
    expect(hidden).toBe(true)

    // Re-open context menu — now offers "Show on map"
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    await expect(page.getByRole('button', { name: /^show on map$/i }).first()).toBeVisible()
  })
})

test.describe('Inline feature rename', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
  })

  test('double-click label → type → Enter commits the new name', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    const label = row.getByText('Paris', { exact: true })
    await label.dblclick()
    const input = page.locator('aside input').first()
    await expect(input).toBeFocused()
    await input.fill('Paris Renamed')
    await input.press('Enter')
    await expect(page.locator('aside li').filter({ hasText: 'Paris Renamed' })).toBeVisible()
  })

  test('Escape during inline rename cancels (keeps old name)', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.getByText('Paris', { exact: true }).dblclick()
    const input = page.locator('aside input').first()
    await input.fill('Should Not Save')
    await input.press('Escape')
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'Should Not Save' })).not.toBeVisible()
  })

  // Regression: the window-level capture Enter listener in FeatureInteractionLayer
  // used to hijack Enter from the rename input and enter vertex-edit mode instead
  // of committing the new name. The fix skips the listener when the target is an
  // INPUT/TEXTAREA/contentEditable.
  test('Enter during inline rename commits the name and does NOT enter vertex edit', async ({ page }) => {
    // Use a Polygon (Paris is a Point, which wouldn't trigger vertex edit anyway).
    // Test Route is a LineString in SAMPLE_GEOJSON — selecting it + Enter would enter vertex edit.
    const row = page.locator('aside li').filter({ hasText: 'Test Route' }).first()
    // Select first so selectedIds.length === 1 (the trigger condition for vertex-edit shortcut)
    await row.click()
    await page.waitForTimeout(200)

    await row.getByText('Test Route', { exact: true }).dblclick()
    const input = page.locator('aside input').first()
    await expect(input).toBeFocused()
    await input.fill('Renamed Line')
    await input.press('Enter')
    await page.waitForTimeout(200)

    // Name saved
    await expect(page.locator('aside li').filter({ hasText: 'Renamed Line' })).toBeVisible()
    // Vertex-edit mode NOT active
    const vertexMode = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.uiStore.getState()
      return { vertexEditActive: s.vertexEditActive, editingMode: s.editingMode }
    })
    // (Was `vertexEditFeatureId`, a field the store doesn't have: the check could never fail.)
    expect(vertexMode.vertexEditActive).toBe(false)
    expect(vertexMode.editingMode).toBe('none')
  })

  // Regression for issue #6: dblclicking the layer name used to also fire the
  // row's pan/fit (because the two underlying clicks bubbled to the row's
  // onClick), so the map jumped while the rename input opened. The fix defers
  // the row-click on plain clicks of the name span and cancels it on dblclick.
  test('double-click name opens rename without changing the map zoom', async ({ page }) => {
    // Test Route is a long LineString — its fitBounds would change zoom from
    // the default ~14 down to ~5, which is easy to detect.
    const row = page.locator('aside li').filter({ hasText: 'Test Route' }).first()
    const zoomBefore = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().currentZoom
    })

    await row.getByText('Test Route', { exact: true }).dblclick()
    const input = page.locator('aside input').first()
    await expect(input).toBeFocused()
    // Wait past the deferred row-click window so a missed cancel would have fired by now.
    await page.waitForTimeout(450)

    const zoomAfter = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().currentZoom
    })
    expect(zoomAfter).toBe(zoomBefore)
  })
})

test.describe('Group operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()
    // Seed a group + assign Paris to it so we can exercise the group UI.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const ds = handle.dataStore
      const parisId = ds.getState().features.find((f) => f.properties.name === 'Paris')?.id
      ;(ds as unknown as { setState: (s: unknown) => void }).setState({
        groups: [{ id: 'test-group-1', name: 'My Places', collapsed: false }],
        features: ds.getState().features.map((f) =>
          f.id === parisId ? { ...f, groupId: 'test-group-1' } : f
        ),
      })
    })
    await expect(page.getByText('My Places')).toBeVisible()
  })

  test('group rename via double-click commits on Enter', async ({ page }) => {
    await page.getByText('My Places', { exact: true }).dblclick()
    const input = page.locator('aside input:focus')
    await expect(input).toHaveValue('My Places')
    await input.fill('Favorite Cities')
    await input.press('Enter')
    await expect(page.getByText('Favorite Cities')).toBeVisible()
    await expect(page.getByText('My Places', { exact: true })).not.toBeVisible()
  })

  test('double-clicking the group name opens rename without changing the map zoom', async ({ page }) => {
    const zoomBefore = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().currentZoom
    })

    await page.getByText('My Places', { exact: true }).dblclick()
    await expect(page.locator('aside input:focus')).toHaveValue('My Places')
    // Wait past the deferred select+zoom timer so a missed cancel would have fired by now.
    await page.waitForTimeout(450)

    const zoomAfter = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().currentZoom
    })
    expect(zoomAfter).toBe(zoomBefore)
  })

  test('a single-feature group can be selected separately from its lone child feature', async ({ page }) => {
    // Pre-condition: test-group-1 has only Paris in it.
    // Click the feature row → only the feature is highlighted.
    const featureRow = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await featureRow.click()
    await page.waitForTimeout(150)
    let state = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      return { selectedIds: s.selectedIds, selectedGroupId: s.selectedGroupId }
    })
    expect(state.selectedIds.length).toBe(1)
    expect(state.selectedGroupId).toBeNull()

    const groupRow = page.locator('aside').locator('div').filter({ hasText: /^My Places.*\d+$/ }).first()
    await expect(groupRow).not.toHaveClass(/bg-\(--elm-row-selected\)/)

    // Click the group name → group is selected, feature row is no longer
    // visually highlighted (group selection only, "high level").
    await page.getByText('My Places', { exact: true }).click()
    await page.waitForTimeout(450)
    state = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      return { selectedIds: s.selectedIds, selectedGroupId: s.selectedGroupId }
    })
    expect(state.selectedGroupId).toBe('test-group-1')
    expect(state.selectedIds.length).toBe(1) // Paris is still in selectedIds for ops

    await expect(groupRow).toHaveClass(/bg-\(--elm-row-selected\)/)
    // The inner feature row is NOT highlighted — group selection is high-level only.
    const innerRow = featureRow.locator('div').filter({ hasText: 'Paris' }).first()
    await expect(innerRow).not.toHaveClass(/bg-\(--elm-row-selected\)/)
  })

  test('clicking the group name selects all its features and highlights the group row', async ({ page }) => {
    // Add a second feature to the group so we can verify "all members selected".
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const ds = handle.dataStore
      ds.setState({
        features: [
          ...ds.getState().features,
          { type: 'Feature', id: 'g-extra', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { name: 'Extra' }, groupId: 'test-group-1' },
        ],
      })
    })
    await expect(page.getByText('Extra')).toBeVisible()

    const groupName = page.locator('aside').getByText('My Places', { exact: true })
    await groupName.click()
    // Wait past the deferred select+zoom timer (300 ms).
    await page.waitForTimeout(450)

    // Both group members are selected.
    const ids = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().selectedIds
    })
    expect(ids).toEqual(expect.arrayContaining(['g-extra']))
    expect(ids.length).toBe(2)

    // The group row visually shows the selected (primary-tinted) state.
    const groupRow = page.locator('aside').locator('div').filter({ hasText: /^My Places.*\d+$/ }).first()
    await expect(groupRow).toHaveClass(/bg-\(--elm-row-selected\)/)
  })

  test('clicking the group folder icon toggles collapse', async ({ page }) => {
    // Initially expanded — child feature visible in the list
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).toBeVisible()

    // Only the folder icon should toggle collapse — clicking the name selects
    // the group and clicking padding/count also delegates to select.
    const folderIcon = page.locator('aside').locator('button[aria-label="Collapse group"], span[aria-label="Collapse group"]').first()
    await folderIcon.click()
    await page.waitForTimeout(200)
    const collapsed = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().groups.find((g) => g.id === 'test-group-1')?.collapsed
    })
    expect(collapsed).toBe(true)

    const folderIconExpand = page.locator('aside').locator('button[aria-label="Expand group"], span[aria-label="Expand group"]').first()
    await folderIconExpand.click()
    await page.waitForTimeout(200)
    const expanded = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().groups.find((g) => g.id === 'test-group-1')?.collapsed
    })
    expect(expanded).toBe(false)
  })

  test('group delete via context menu removes the group and its features', async ({ page }) => {
    const groupRow = page.locator('aside').locator('div').filter({ hasText: /^My Places.*\d+$/ }).first()
    await groupRow.click({ button: 'right' })
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /delete group/i }).click()
    await page.waitForTimeout(300)

    // Group gone from the list
    await expect(page.getByText('My Places')).not.toBeVisible()
    // Its feature (Paris) also gone because default mode is 'delete-features'
    const state = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      return { groups: s.groups.length, hasParis: s.features.some((f) => f.properties.name === 'Paris') }
    })
    expect(state.groups).toBe(0)
    expect(state.hasParis).toBe(false)
  })

  // Regression for issue #7: deleting a group used to snapshot only `features`,
  // so undo restored the polygons but not the group — the layers panel went
  // empty because the orphaned features pointed at a missing group.
  test('undo after group delete restores both the group and its features into the layers panel', async ({ page }) => {
    const groupRow = page.locator('aside').locator('div').filter({ hasText: /^My Places.*\d+$/ }).first()
    await groupRow.click({ button: 'right' })
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /delete group/i }).click()
    await page.waitForTimeout(300)
    await expect(page.getByText('My Places')).not.toBeVisible()

    // Undo
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+z`)
    await page.waitForTimeout(300)

    // Both the group AND the feature row come back in the panel.
    await expect(page.getByText('My Places')).toBeVisible()
    await expect(page.locator('aside li').filter({ hasText: 'Paris' })).toBeVisible()

    // Verify the underlying state too — feature's groupId points back at a real group.
    const state = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      const paris = s.features.find((f) => f.properties.name === 'Paris')
      return {
        groupIds: s.groups.map((g) => g.id),
        parisGroupId: paris?.groupId ?? null,
      }
    })
    expect(state.groupIds).toContain('test-group-1')
    expect(state.parisGroupId).toBe('test-group-1')
  })

  test('new feature inherits the group when a group member is selected', async ({ page }) => {
    // Select Paris (in test-group-1).
    await page.locator('aside li').filter({ hasText: 'Paris' }).first().click()
    await page.waitForTimeout(150)

    // Drag-to-draw a rectangle.
    await page.keyboard.press('r')
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx - 50, cy - 30)
    await page.mouse.down()
    await page.mouse.move(cx + 50, cy + 30, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const inGroup = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const newest = [...handle.dataStore.getState().features].reverse().find((f) => f.geometry.type === 'Polygon' && f.id !== 'e2e-point-1' && f.id !== 'e2e-line-1')
      return newest?.groupId ?? null
    })
    expect(inGroup).toBe('test-group-1')
  })

  test('new feature lands outside the group after Escape clears selection', async ({ page }) => {
    // Select then deselect — this is the exact flow the user reported as broken.
    await page.locator('aside li').filter({ hasText: 'Paris' }).first().click()
    await page.waitForTimeout(150)
    // Click the map first to ensure keyboard focus is there, then Escape clears selection.
    await page.locator(MAP).click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(150)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)

    // Sanity: nothing selected now.
    const sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel.length).toBe(0)

    // Drag-to-draw a rectangle.
    await page.keyboard.press('r')
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx - 50, cy - 30)
    await page.mouse.down()
    await page.mouse.move(cx + 50, cy + 30, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const groupId = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const newest = [...handle.dataStore.getState().features].reverse().find((f) => f.geometry.type === 'Polygon' && f.id !== 'e2e-point-1' && f.id !== 'e2e-line-1')
      return newest?.groupId ?? null
    })
    expect(groupId).toBeNull()
  })

  test('top-level "ungrouped" droppable is mounted (so layers can be dragged out of a group)', async ({ page }) => {
    // We can't reliably simulate hello-pangea-dnd through Playwright's mouse
    // events, so instead verify the structural prerequisite: the ungrouped
    // Droppable IS in the DOM and tall enough to accept drops, even when no
    // ungrouped features exist. Without this, drag-out would just snap back
    // to the source group.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const ds = handle.dataStore
      ds.setState({ features: ds.getState().features.map((f) => ({ ...f, groupId: 'test-group-1' })) })
    })
    await page.waitForTimeout(150)

    const ungroupedDroppable = page.locator('aside [data-rfd-droppable-id="ungrouped"]')
    await expect(ungroupedDroppable).toBeVisible()
    const boundingBox = await ungroupedDroppable.boundingBox()
    expect(boundingBox?.height ?? 0).toBeGreaterThanOrEqual(36)
  })

  test('top-level drop zone is silent (no pill) when every layer is in a group', async ({ page }) => {
    // Move every feature into the group so the ungrouped scope is empty.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const ds = handle.dataStore
      ds.setState({
        features: ds.getState().features.map((f) => ({ ...f, groupId: 'test-group-1' })),
      })
    })
    await page.waitForTimeout(150)

    const ungroupedCount = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().features.filter((f) => !f.groupId).length
    })
    expect(ungroupedCount).toBe(0)

    // The ungrouped Droppable is rendered (so drag-out-of-group works) but it
    // shouldn't show any visible "Drag here" pill — only empty *groups* do.
    const dropPills = page.locator('aside').getByText('Drag here', { exact: true })
    await expect(dropPills).toHaveCount(0)
  })

  test('feature-row context menu offers Group when feature has no groupId', async ({ page }) => {
    // Test Route is ungrouped (only Paris is in test-group-1).
    const row = page.locator('aside li').filter({ hasText: 'Test Route' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    const groupBtn = page.getByRole('button', { name: /^group(\s|$)/i }).first()
    await expect(groupBtn).toBeVisible()
    await groupBtn.click()
    await page.waitForTimeout(300)
    // Test Route should now be in a new group (different id from test-group-1).
    const groupId = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().features.find((f) => f.properties.name === 'Test Route')?.groupId ?? null
    })
    expect(groupId).not.toBeNull()
    expect(groupId).not.toBe('test-group-1')
  })

  test('feature-row context menu offers Ungroup when feature has a groupId', async ({ page }) => {
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    const ungroupBtn = page.getByRole('button', { name: /^ungroup(\s|$)/i }).first()
    await expect(ungroupBtn).toBeVisible()
    await ungroupBtn.click()
    await page.waitForTimeout(300)
    const parisGroupId = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().features.find((f) => f.properties.name === 'Paris')?.groupId ?? null
    })
    expect(parisGroupId).toBeNull()
  })

  test('group-row context menu Ungroup keeps features but removes the group', async ({ page }) => {
    const groupRow = page.locator('aside').locator('div').filter({ hasText: /^My Places.*\d+$/ }).first()
    await groupRow.click({ button: 'right' })
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /^ungroup$/i }).first().click()
    await page.waitForTimeout(300)
    const state = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      return { groups: s.groups.length, hasParis: s.features.some((f) => f.properties.name === 'Paris'), parisGroupId: s.features.find((f) => f.properties.name === 'Paris')?.groupId ?? null }
    })
    expect(state.groups).toBe(0)
    expect(state.hasParis).toBe(true)
    expect(state.parisGroupId).toBeNull()
  })

  test('empty group shows a "Drag here" drop-zone affordance', async ({ page }) => {
    // Move Paris out of the group so test-group-1 is empty.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const ds = handle.dataStore
      ds.setState({
        features: ds.getState().features.map((f) => f.id === 'e2e-point-1' ? { ...f, groupId: undefined } : f),
      })
    })
    await page.waitForTimeout(150)

    // The drop-zone label appears under the empty group.
    await expect(page.locator('aside').getByText('Drag here', { exact: true })).toBeVisible()
  })
})

test.describe('Multi-select + bulk actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    // Seed three features so we can range-select across them.
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      handle.dataStore.getState().importGeoJSON({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'f-a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Alpha' } },
          { type: 'Feature', id: 'f-b', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { name: 'Bravo' } },
          { type: 'Feature', id: 'f-c', geometry: { type: 'Point', coordinates: [2, 0] }, properties: { name: 'Charlie' } },
        ],
      }, 'replace')
    })
    await expect(page.getByText('Alpha')).toBeVisible()
    await expect(page.getByText('Bravo')).toBeVisible()
    await expect(page.getByText('Charlie')).toBeVisible()
  })

  // Cmd on macOS, Control elsewhere. Playwright normalizes Meta → ⌘ on Mac,
  // Control on Windows/Linux. Chrome under Playwright/Darwin accepts Meta.
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  test(`${modifier}+click adds to multi-selection`, async ({ page }) => {
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Charlie' }).first().click({ modifiers: [modifier] })
    await page.waitForTimeout(200)

    const ids = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().selectedIds
    })
    expect(ids).toEqual(expect.arrayContaining(['f-a', 'f-c']))
    expect(ids.length).toBe(2)
  })

  test('Shift+click range-selects across rows', async ({ page }) => {
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Charlie' }).first().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(200)

    const ids = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().selectedIds
    })
    expect(ids.length).toBe(3)
    expect(ids).toEqual(expect.arrayContaining(['f-a', 'f-b', 'f-c']))
  })

  test('bulk toolbar appears at 2+ selected with Clear and Delete all', async ({ page }) => {
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Charlie' }).first().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(200)
    await expect(page.locator('aside').getByText(/3 selected/i)).toBeVisible()
    await expect(page.locator('aside').getByRole('button', { name: /^clear$/i })).toBeVisible()
    await expect(page.locator('aside').getByRole('button', { name: /^delete all$/i })).toBeVisible()
  })

  test('Clear button empties the selection', async ({ page }) => {
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Charlie' }).first().click({ modifiers: ['Shift'] })
    await page.locator('aside').getByRole('button', { name: /^clear$/i }).click()
    await page.waitForTimeout(200)

    const ids = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().selectedIds
    })
    expect(ids.length).toBe(0)
  })

  test('Delete all removes every selected feature', async ({ page }) => {
    await page.locator('aside li').filter({ hasText: 'Alpha' }).first().click()
    await page.locator('aside li').filter({ hasText: 'Charlie' }).first().click({ modifiers: ['Shift'] })
    await page.locator('aside').getByRole('button', { name: /^delete all$/i }).click()
    await page.waitForTimeout(300)

    const count = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().features.length
    })
    expect(count).toBe(0)
  })
})

// Regression: right after drawing (which auto-selects the new feature),
// Shift+clicking a row in the list used to select only 2 features instead of
// the full range. Root cause: `handleRangeSelect` used a stored "last clicked
// row" as anchor; after programmatic selection (commitDraw) it was either null
// or pointing at a stale row the user had clicked earlier. Fixed by preferring
// the currently-selected single feature over the stored anchor.
test.describe('Shift+click range after drawing (regression)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.locator(MAP).click()
  })

  test('after placing 5 points with the point tool, Shift+click bottom row selects all 5', async ({ page }) => {
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Auto-exit-after-draw (the default) would drop the point tool after the
    // first click; this flow needs the tool to stay active for all 5 points.
    await page.evaluate(() => {
      (window as unknown as { __elementEditorTest: { uiStore: { getState: () => { setAutoExitAfterDraw: (v: boolean) => void } } } })
        .__elementEditorTest.uiStore.getState().setAutoExitAfterDraw(false)
    })
    await page.keyboard.press('p')
    // 5 points along a horizontal strip, well-separated to avoid dblclick-detect.
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(cx - 150 + i * 60, cy)
      await page.waitForTimeout(250)
    }

    // After drawing, exactly one feature is selected (the last-placed one).
    // Don't press Escape — that clears selection, and it isn't part of the
    // real-world flow the user reported.
    const initialSelected = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      return { total: s.features.length, selected: s.selectedIds.length }
    })
    expect(initialSelected.total).toBe(5)
    expect(initialSelected.selected).toBe(1)

    // Shift+click the LAST row in the list — without the fix this selects only
    // 2 (anchor was null → fell through to toggleSelection).
    const rows = page.locator('aside li')
    await expect(rows).toHaveCount(5)
    await rows.last().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(200)

    const selectedCount = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().selectedIds.length
    })
    expect(selectedCount).toBe(5)
  })

  // Second variant: user previously clicked a row (so lastClickedIdRef is set
  // to a stale value), then drew a polygon on top, then shift+clicks the
  // bottom row. The stored anchor would compute a range that excludes the new
  // polygon; the fix prefers the current single-selected feature (new polygon)
  // over the stale click anchor.
  test('shift+click after draw ignores stale list-click anchor and uses current selection', async ({ page }) => {
    // Seed 3 existing points
    await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      handle.dataStore.getState().importGeoJSON({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'ex-1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Existing 1' } },
          { type: 'Feature', id: 'ex-2', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { name: 'Existing 2' } },
          { type: 'Feature', id: 'ex-3', geometry: { type: 'Point', coordinates: [2, 0] }, properties: { name: 'Existing 3' } },
        ],
      }, 'replace')
    })
    await expect(page.locator('aside li')).toHaveCount(3)

    // Step 1 — click a middle row, pinning lastClickedIdRef to ex-2.
    await page.locator('aside li').filter({ hasText: 'Existing 2' }).first().click()
    await page.waitForTimeout(150)

    // Step 2 — draw a polygon on the map; it auto-selects.
    const map = page.locator(MAP)
    const box = await map.boundingBox()
    if (!box) throw new Error('no map')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.keyboard.press('g')
    await page.mouse.click(cx - 80, cy - 40)
    await page.waitForTimeout(250)
    await page.mouse.click(cx + 80, cy - 40)
    await page.waitForTimeout(250)
    await page.mouse.click(cx, cy + 40)
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    // 4 features total, 1 selected (the new polygon).
    const afterDraw = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      const s = handle.dataStore.getState()
      return { total: s.features.length, selected: s.selectedIds.length }
    })
    expect(afterDraw.total).toBe(4)
    expect(afterDraw.selected).toBe(1)

    // Step 3 — shift+click the last row. Expected: all 4 selected.
    await page.locator('aside li').last().click({ modifiers: ['Shift'] })
    await page.waitForTimeout(200)

    const finalCount = await page.evaluate(() => {
      const handle = window.__elementEditorTest!
      return handle.dataStore.getState().selectedIds.length
    })
    expect(finalCount).toBe(4)
  })
})

test.describe('Large layer list (virtualised)', () => {
  /** Ids of the feature rows actually inside the list's visible viewport. */
  const visibleRowIds = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const sc = document.querySelector('aside .overflow-y-auto')!.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('aside [data-feature-id]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > sc.top && r.top < sc.bottom })
      .map((el) => el.dataset.featureId!)
  })

  test('rows render when scrolled deep into a large group, and selection scrolls its row into view', async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    // 3,000 points: 1,500 in group A, 1,400 in group B, 100 ungrouped.
    await page.evaluate(() => {
      const features = Array.from({ length: 3000 }, (_, i) => ({
        type: 'Feature', id: `f${i}`, properties: { name: `Feature ${i}` },
        geometry: { type: 'Point', coordinates: [2 + (i % 60) * 0.01, 48 + Math.floor(i / 60) * 0.01] },
      }))
      const ds = window.__elementEditorTest!.dataStore
      ds.getState().importGeoJSON({ type: 'FeatureCollection', features }, 'replace')
      ds.setState((s: any) => ({
        groups: [{ id: 'gA', name: 'Group A', collapsed: false }, { id: 'gB', name: 'Group B', collapsed: false }],
        features: s.features.map((f: any, i: number) => ({ ...f, groupId: i < 1500 ? 'gA' : i < 2900 ? 'gB' : undefined })),
      }))
    })
    await expect(page.locator('aside [data-feature-id="f0"]')).toBeVisible()

    // ~2,000 rows down = in the middle of group B. Each group has its own
    // virtualiser on the shared scroll element; without its offset the list was blank here.
    await page.evaluate(() => { document.querySelector('aside .overflow-y-auto')!.scrollTop = 2000 * 36 })
    await expect.poll(async () => (await visibleRowIds(page)).length).toBeGreaterThan(10)
    const ids = (await visibleRowIds(page)).map((id) => Number(id.slice(1)))
    expect(Math.min(...ids)).toBeGreaterThan(1900)
    expect(Math.max(...ids)).toBeLessThan(2100)

    // Programmatic selection far away (group A, then ungrouped) scrolls its row into view.
    for (const id of ['f300', 'f2950']) {
      await page.evaluate((fid) => window.__elementEditorTest!.dataStore.getState().setSelection([fid]), id)
      await expect.poll(() => visibleRowIds(page)).toContain(id)
    }
  })
})
