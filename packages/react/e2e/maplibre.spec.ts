/**
 * Maplibre adapter e2e tests — switches the demo to the @element-editor/adapter-maplibre
 * tab and verifies parity with the leaflet adapter for the gestures users hit
 * most often (and most often broke before this suite existed):
 *
 * - drag-to-draw rect / circle (mousedown anchors, drag previews, mouseup commits)
 * - Cmd-drag translates an existing feature even while a drawing tool is active
 * - Alt-drag duplicates an existing feature even while a drawing tool is active
 * - Spacebar+drag pans the map without exiting the active tool
 *
 * The maplibre demo is reached by clicking the `@element-editor/adapter-maplibre`
 * tab in the demo's top bar. State is read via the dev-only
 * `window.__elementEditorTest` handle exposed by `<ElementEditorControls>`.
 */
import { test, expect, type Page } from '@playwright/test'
import './fixtures' // global Window typings for the test hooks
import { enableStayInTool, hoverFirstEdgeMidpoint } from './helpers'

async function gotoMaplibre(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '@element-editor/adapter-maplibre' }).click()
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => !!window.__elementEditorTest)
  // Clicking the host's tab leaves focus on that button, which keyboard
  // scoping (useKeyboardShortcuts(container)) rightly treats as foreign, so
  // shortcuts would be ignored. Move focus into the editor like a user would.
  await page.locator('.maplibregl-canvas').first().focus()
  // Give style + sources another tick to settle so the first draw doesn't race.
  await page.waitForTimeout(800)
}

async function mapCenter(page: Page) {
  const cbox = await page.locator('.maplibregl-canvas').first().boundingBox()
  if (!cbox) throw new Error('no maplibre canvas')
  return { cx: cbox.x + cbox.width / 2, cy: cbox.y + cbox.height / 2 }
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const t = window.__elementEditorTest!
    const ds = t.dataStore.getState()
    return {
      count: ds.features.length,
      // For polygons return the first coordinate of the outer ring so callers
      // can compare positions before/after a drag.
      firstCoord:
        ds.features[0]?.geometry?.type === 'Polygon'
          ? ((ds.features[0].geometry.coordinates as number[][][])[0][0])
          : null,
      editingMode: t.uiStore.getState().editingMode,
    }
  })
}

async function drawSquare(page: Page) {
  const { cx, cy } = await mapCenter(page)
  await page.keyboard.press('g')
  await page.waitForTimeout(120)
  await page.mouse.click(cx - 100, cy - 80)
  await page.waitForTimeout(60)
  await page.mouse.click(cx + 100, cy - 80)
  await page.waitForTimeout(60)
  await page.mouse.click(cx + 100, cy + 80)
  await page.waitForTimeout(60)
  await page.mouse.click(cx - 100, cy + 80)
  await page.waitForTimeout(60)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  return { cx, cy }
}

test.describe('maplibre — drag-to-draw', () => {
  test('Rectangle: drag from corner to corner adds a Polygon feature', async ({ page }) => {
    await gotoMaplibre(page)
    const { cx, cy } = await mapCenter(page)
    const before = await readState(page)

    await page.keyboard.press('r')
    await page.waitForTimeout(120)
    await page.mouse.move(cx - 80, cy - 60)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 60, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    const after = await readState(page)
    expect(after.count).toBe(before.count + 1)
  })

  test('Circle: drag from centre outward adds a Polygon feature', async ({ page }) => {
    await gotoMaplibre(page)
    const { cx, cy } = await mapCenter(page)
    const before = await readState(page)

    await page.keyboard.press('o')
    await page.waitForTimeout(120)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 50, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    const after = await readState(page)
    expect(after.count).toBe(before.count + 1)
  })
})

test.describe('maplibre — modifier drag while a drawing tool is active', () => {
  // These tests exercise interactions that only make sense while the draw tool
  // is still active post-commit; opt into stay-in-tool mode (production default
  // is auto-exit-after-draw — see the "Return to select after each shape"
  // setting).
  test.beforeEach(async ({ page }) => { await enableStayInTool(page) })

  test('Cmd+drag translates a polygon (does not add a vertex)', async ({ page }) => {
    await gotoMaplibre(page)
    const { cx, cy } = await drawSquare(page)
    // Stay in draw-polygon mode. Cmd-dragging the existing polygon should
    // translate it, NOT add another vertex.
    const before = await readState(page)
    expect(before.editingMode).toBe('draw-polygon')
    expect(before.count).toBe(1)

    await page.keyboard.down('Meta')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 60, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    await page.waitForTimeout(300)

    const after = await readState(page)
    expect(after.count).toBe(1)
    expect(after.firstCoord).not.toEqual(before.firstCoord)
  })

  test('Alt+drag duplicates a polygon (count goes up by 1)', async ({ page }) => {
    await gotoMaplibre(page)
    const { cx, cy } = await drawSquare(page)
    const before = await readState(page)
    expect(before.count).toBe(1)

    await page.keyboard.down('Alt')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 120, cy + 100, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await page.waitForTimeout(300)

    const after = await readState(page)
    expect(after.count).toBe(2)
  })
})

test.describe('maplibre — Enter enters vertex edit (parity with @element-editor/react)', () => {
  // Premise requires the draw tool to remain active after commit.
  test.beforeEach(async ({ page }) => { await enableStayInTool(page) })

  test('Enter on a selected polygon (still in draw-polygon mode) enters vertex edit', async ({ page }) => {
    await gotoMaplibre(page)
    await drawSquare(page)
    expect((await readState(page)).editingMode).toBe('draw-polygon')

    // The just-drawn polygon is the sole selection (per the "stay in tool"
    // convention). Press Enter — should toggle vertexEditActive AND exit the
    // drawing tool so FIL's vertex-edit branch can mount.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    const after = await page.evaluate(() => {
      const us = window.__elementEditorTest!.uiStore.getState() as { editingMode: string; vertexEditActive: boolean }
      return { editingMode: us.editingMode, vertexEditActive: us.vertexEditActive }
    })
    expect(after.vertexEditActive).toBe(true)
    expect(after.editingMode).toBe('none')
    // Vertex markers should appear (one per ring vertex, 4 for a square).
    const vertexMarkers = await page.evaluate(() =>
      document.querySelectorAll('.maplibregl-marker[data-elm-selected]').length,
    )
    expect(vertexMarkers).toBeGreaterThanOrEqual(4)
  })
})

test.describe('maplibre — undo/redo toolbar', () => {
  test('Undo / Redo buttons are mounted and functional', async ({ page }) => {
    await gotoMaplibre(page)

    // Both buttons mount on demo load. Initially Undo is disabled (empty stack).
    const undoBtn = page.getByRole('button', { name: /^undo$/i })
    const redoBtn = page.getByRole('button', { name: /^redo$/i })
    await expect(undoBtn).toBeVisible()
    await expect(redoBtn).toBeVisible()
    await expect(undoBtn).toBeDisabled()
    await expect(redoBtn).toBeDisabled()

    // Draw a polygon → Undo enables.
    await drawSquare(page)
    expect((await readState(page)).count).toBe(1)
    await expect(undoBtn).toBeEnabled()

    // Click Undo → polygon removed, Redo enables.
    await undoBtn.click()
    await page.waitForTimeout(200)
    expect((await readState(page)).count).toBe(0)
    await expect(redoBtn).toBeEnabled()

    // Click Redo → polygon comes back.
    await redoBtn.click()
    await page.waitForTimeout(200)
    expect((await readState(page)).count).toBe(1)
  })
})

test.describe('maplibre — spacebar pan during drawing', () => {
  test('Space+drag pans the map without exiting the active tool', async ({ page }) => {
    await gotoMaplibre(page)
    const { cx, cy } = await mapCenter(page)
    const initialCenter = await page.evaluate(() => {
      const c = window.__elementEditorTest!.map.getCenter()
      return [c.lng, c.lat]
    })

    // Activate polygon tool and verify mode.
    await page.keyboard.press('g')
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('draw-polygon')

    // Hold Space, drag, release Space. The map should pan; the tool stays
    // active; no polygon vertex is added.
    await page.keyboard.down('Space')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 100, cy + 80, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await page.waitForTimeout(300)

    const newCenter = await page.evaluate(() => {
      const c = window.__elementEditorTest!.map.getCenter()
      return [c.lng, c.lat]
    })
    // Map center should have shifted after the Space-drag pan.
    expect(newCenter[0]).not.toBeCloseTo(initialCenter[0], 4)

    // Tool is still active.
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('draw-polygon')

    // No polygon was committed (still no features).
    const after = await readState(page)
    expect(after.count).toBe(0)
  })
})

// ─── Tool activation + hint visibility ────────────────────────────────────────

test.describe('maplibre — tool activation', () => {
  test.beforeEach(async ({ page }) => { await gotoMaplibre(page) })

  test('P activates place-point mode', async ({ page }) => {
    await page.keyboard.press('p')
    await expect(page.getByText(/click to place a point/i)).toBeVisible()
  })

  test('L activates draw-line mode', async ({ page }) => {
    await page.keyboard.press('l')
    await expect(page.getByText(/click to (place the first|add) point/i)).toBeVisible()
  })

  test('G activates draw-polygon mode', async ({ page }) => {
    await page.keyboard.press('g')
    await expect(page.getByText(/click to (place the first|add) point/i)).toBeVisible()
  })

  test('R activates draw-rect mode', async ({ page }) => {
    await page.keyboard.press('r')
    await expect(page.getByText(/click and drag to size.*square/i)).toBeVisible()
  })

  test('O activates draw-circle mode', async ({ page }) => {
    await page.keyboard.press('o')
    await expect(page.getByText(/click and drag to size/i)).toBeVisible()
  })

  test('F activates draw-freehand mode', async ({ page }) => {
    await page.keyboard.press('f')
    await expect(page.getByText(/click and drag to draw/i)).toBeVisible()
  })

  test('C activates draw-route mode', async ({ page }) => {
    await page.keyboard.press('c')
    await expect(page.getByText(/click to (add|place).*waypoint/i)).toBeVisible()
  })
})

// ─── Tool lifecycle ──────────────────────────────────────────────────────────

test.describe('maplibre — tool lifecycle', () => {
  test('pressing the same key twice deactivates the mode', async ({ page }) => {
    await gotoMaplibre(page)
    await page.keyboard.press('p')
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('place-point')
    await page.keyboard.press('p')
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)).toBe('none')
  })

  test('Escape cancels in-progress polygon but keeps tool active', async ({ page }) => {
    await gotoMaplibre(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('g')
    await page.mouse.click(cx - 50, cy - 50)
    await page.waitForTimeout(60)
    await page.mouse.click(cx + 50, cy - 50)
    await page.waitForTimeout(60)
    // Two vertices placed but not committed.
    expect(
      await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length),
    ).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    // In-progress cleared, but tool stays active.
    expect(
      await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().polygonInProgress.length),
    ).toBe(0)
    expect(
      await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode),
    ).toBe('draw-polygon')
  })

  test('with "Return to select after each shape" on, the tool deactivates after commit and the new feature is the sole selection', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('elm_autoExitAfterDraw', 'true'))
    await gotoMaplibre(page)
    const { cx, cy } = await drawSquare(page)
    void cx; void cy
    const after = await page.evaluate(() => {
      const t = window.__elementEditorTest!
      return {
        editingMode: t.uiStore.getState().editingMode,
        selectedIds: t.dataStore.getState().selectedIds,
      }
    })
    expect(after.editingMode).toBe('none')
    expect(after.selectedIds.length).toBe(1) // sole selection
  })

  test('by default the tool remains active after commit', async ({ page }) => {
    await gotoMaplibre(page)
    await drawSquare(page)
    const after = await page.evaluate(() => {
      const t = window.__elementEditorTest!
      return {
        editingMode: t.uiStore.getState().editingMode,
        selectedIds: t.dataStore.getState().selectedIds,
      }
    })
    expect(after.editingMode).toBe('draw-polygon')
    expect(after.selectedIds.length).toBe(1)
  })
})

// ─── Place-point + Draw-line + Draw-freehand commit ───────────────────────────

test.describe('maplibre — place point / line / freehand commit', () => {
  test('Place-point: a single click adds a Point feature', async ({ page }) => {
    await gotoMaplibre(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('p')
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(300)
    expect((await readState(page)).count).toBe(before.count + 1)
  })

  test('Line: two clicks + Enter commits a LineString', async ({ page }) => {
    await gotoMaplibre(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('l')
    await page.mouse.click(cx - 80, cy)
    await page.waitForTimeout(80)
    await page.mouse.click(cx + 80, cy)
    await page.waitForTimeout(80)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const after = await readState(page)
    expect(after.count).toBe(before.count + 1)
    const lastFeature = await page.evaluate(() => {
      const fs = window.__elementEditorTest!.dataStore.getState().features
      return fs[fs.length - 1]?.geometry.type
    })
    expect(lastFeature).toBe('LineString')
  })

  test('Freehand: drag commits a LineString', async ({ page }) => {
    await gotoMaplibre(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('f')
    await page.mouse.move(cx - 80, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy + 30, { steps: 4 })
    await page.mouse.move(cx + 80, cy, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    expect((await readState(page)).count).toBe(before.count + 1)
  })
})

// ─── Polygon close-tap ────────────────────────────────────────────────────────

test.describe('maplibre — polygon close-tap', () => {
  test('clicking near the first vertex closes the polygon', async ({ page }) => {
    await gotoMaplibre(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('g')
    await page.mouse.click(cx - 80, cy - 80)
    await page.waitForTimeout(60)
    await page.mouse.click(cx + 80, cy - 80)
    await page.waitForTimeout(60)
    await page.mouse.click(cx + 80, cy + 80)
    await page.waitForTimeout(60)
    // Click near the first vertex (within the smart-close 48 px radius)
    // — should commit the polygon without an explicit Enter press.
    await page.mouse.click(cx - 80, cy - 80)
    await page.waitForTimeout(400)
    expect((await readState(page)).count).toBe(before.count + 1)
  })
})

// ─── Selection ────────────────────────────────────────────────────────────────

test.describe('maplibre — selection', () => {
  test('clicking a feature selects it; clicking empty map deselects', async ({ page }) => {
    // Return to select after each shape, so later clicks select rather than draw.
    await page.addInitScript(() => localStorage.setItem('elm_autoExitAfterDraw', 'true'))
    await gotoMaplibre(page)
    const { cx, cy } = await drawSquare(page)

    // Initial: still selected from the post-commit auto-selection.
    expect((await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)).length).toBe(1)

    // Click empty map far from the polygon — but inside the canvas (sidebar
    // overlays the right edge, so we go up-left instead).
    await page.mouse.click(cx - 250, cy - 200)
    await page.waitForTimeout(200)
    expect((await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)).length).toBe(0)

    // Click on the polygon body — should reselect.
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(200)
    expect((await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)).length).toBe(1)
  })
})

// ─── Tab / Shift+Tab walking ─────────────────────────────────────────────────

test.describe('maplibre — Tab walks selection', () => {
  test('Tab cycles selection through visible features', async ({ page }) => {
    await gotoMaplibre(page)
    // Seed three features so we have something to walk through.
    await page.evaluate(() => {
      window.__elementEditorTest!.dataStore.getState().importGeoJSON({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'A' } },
          { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { name: 'B' } },
          { type: 'Feature', id: 'c', geometry: { type: 'Point', coordinates: [2, 0] }, properties: { name: 'C' } },
        ],
      }, 'replace')
    })
    await page.waitForTimeout(300)
    // Click a sidebar row to give Tab an anchor.
    await page.locator('aside li').filter({ hasText: 'A' }).first().click()
    await page.waitForTimeout(200)

    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    let sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel).toEqual(['b'])

    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel).toEqual(['c'])

    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(150)
    sel = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds)
    expect(sel).toEqual(['b'])
  })
})

// ─── Vertex editing ───────────────────────────────────────────────────────────

test.describe('maplibre — vertex editing', () => {
  test('Escape exits vertex edit', async ({ page }) => {
    await gotoMaplibre(page)
    await drawSquare(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(false)
  })

  test('dragging a vertex marker updates the polygon geometry', async ({ page }) => {
    await gotoMaplibre(page)
    await drawSquare(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    const before = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0][0]
    })
    // Find the first vertex marker (the leftmost one).
    const markerPos = await page.evaluate(() => {
      const ms = Array.from(document.querySelectorAll('.maplibregl-marker[data-elm-selected]'))
      const sorted = ms.map((m) => {
        const r = m.getBoundingClientRect()
        return { m, x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }).sort((a, b) => a.x - b.x)
      return sorted[0] ? { x: sorted[0].x, y: sorted[0].y } : null
    })
    expect(markerPos).not.toBeNull()
    await page.mouse.move(markerPos!.x, markerPos!.y)
    await page.mouse.down()
    await page.mouse.move(markerPos!.x - 60, markerPos!.y - 40, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0][0]
    })
    expect(after).not.toEqual(before)
    // The click the browser fires after the drag must not select the point.
    await expect(page.getByText(/points? selected/)).toHaveCount(0)
  })
})

// ─── Vertex editing — midpoints and modifier drag ────────────────────────────

test.describe('maplibre — vertex editing: midpoints and modifier drag', () => {
  async function drawRect(page: Page) {
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('r')
    await page.waitForTimeout(120)
    await page.mouse.move(cx - 80, cy - 50)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 50, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    return { cx, cy }
  }

  test('rectangle in vertex edit shows midpoint markers on each edge', async ({ page }) => {
    await gotoMaplibre(page)
    await drawRect(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)

    // A rectangle has 4 edges → 4 midpoints. They are in the DOM but only visible
    // when the cursor hovers near the edge. Assert they are mounted (count ≥ 4).
    const midpointCount = await page.evaluate(
      () => document.querySelectorAll('.elm-midpoint-marker').length,
    )
    expect(midpointCount).toBeGreaterThanOrEqual(4)
  })

  test('dragging a midpoint marker inserts a new vertex', async ({ page }) => {
    await gotoMaplibre(page)
    await drawRect(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    const before = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0].length
    })
    // Rectangle outer ring has 5 coords (4 vertices + closing point).
    expect(before).toBe(5)

    // Hover an edge so its midpoint marker shows, then drag it to insert a new vertex.
    const midPos = await hoverFirstEdgeMidpoint(page)

    await page.mouse.move(midPos.x, midPos.y)
    await page.mouse.down()
    await page.mouse.move(midPos.x + 60, midPos.y + 40, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const after = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0].length
    })
    // One new vertex was inserted → 6 coords (5 vertices + closing).
    expect(after).toBe(6)
  })

  test('Cmd+drag does NOT translate the feature while in vertex edit mode', async ({ page }) => {
    // Ground truth: Leaflet blocks translate/duplicate in vertex edit mode via
    // an invisible overlay that intercepts polygon-body mousedowns. MapLibre
    // matches by returning early in the drag handler when vertexEditActive.
    await gotoMaplibre(page)
    const { cx, cy } = await drawRect(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)

    const before = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0][0]
    })

    await page.keyboard.down('Meta')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 60, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    await page.waitForTimeout(300)

    const after = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0][0]
    })
    // Feature must NOT have moved — translate is forbidden in vertex edit.
    expect(after).toEqual(before)
  })

  test('Alt+drag does NOT duplicate the feature while in vertex edit mode', async ({ page }) => {
    // Same principle: translate/duplicate are blocked in vertex edit mode.
    await gotoMaplibre(page)
    const { cx, cy } = await drawRect(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    const before = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)

    await page.keyboard.down('Alt')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 100, cy + 80, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await page.waitForTimeout(300)

    const after = await page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.length)
    // Feature count must stay the same — duplicate is forbidden in vertex edit.
    expect(after).toBe(before)
  })

  test('clicking (not dragging) a midpoint marker inserts a vertex at the midpoint', async ({ page }) => {
    await gotoMaplibre(page)
    await drawRect(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)

    const before = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0].length
    })
    expect(before).toBe(5) // rectangle: 4 verts + closing point

    // Hover an edge so its midpoint marker shows, then plain-click it (no drag).
    const midPos = await hoverFirstEdgeMidpoint(page)
    await page.mouse.click(midPos.x, midPos.y)

    // One new vertex inserted at the midpoint position → 6 coords (5 verts + closing).
    await expect.poll(() => page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features[0]
      return (f.geometry.coordinates as number[][][])[0].length
    })).toBe(6)

    // Vertex edit must still be active after the click.
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
  })
})

// ─── Shift constraints during drag-to-draw ────────────────────────────────────

test.describe('maplibre — Shift constraints', () => {
  test('Rectangle: Shift+drag forces a square (width ≈ height in projected space)', async ({ page }) => {
    await gotoMaplibre(page)
    const before = await readState(page)
    const { cx, cy } = await mapCenter(page)
    await page.keyboard.press('r')
    await page.waitForTimeout(120)
    await page.keyboard.down('Shift')
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    // Intentionally non-square drag: width 200, height 100. Shift should square it.
    await page.mouse.move(cx + 120, cy + 60, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(400)
    expect((await readState(page)).count).toBe(before.count + 1)

    // Read the rect's bbox in projected (mercator) pixel space and verify
    // width ≈ height. Geographic lat/lng would be biased by projection.
    const wh = await page.evaluate(() => {
      const f = window.__elementEditorTest!.dataStore.getState().features.at(-1)!
      const ring = (f.geometry.coordinates as number[][][])[0]
      const xs = ring.map(([x]) => x)
      const ys = ring.map(([, y]) => y)
      const dlng = Math.max(...xs) - Math.min(...xs)
      const dlat = Math.max(...ys) - Math.min(...ys)
      // Convert lat extent → lng-equivalent at this latitude (mercator).
      const latMid = (Math.max(...ys) + Math.min(...ys)) / 2
      const lngEquivOfLat = dlat / Math.cos((latMid * Math.PI) / 180)
      return { dlng, lngEquivOfLat }
    })
    // Allow 10 % tolerance — the test moves through ints so the screen→geo
    // conversion isn't exact.
    expect(wh.dlng).toBeGreaterThan(0)
    expect(Math.abs(wh.dlng - wh.lngEquivOfLat) / wh.dlng).toBeLessThan(0.1)
  })
})


// ─── Vertex editing — point click, selection and menu ────────────────────────
// Parity with vertex-editing.spec.ts: click selects (never deletes), Shift+click
// toggles, right-click opens "Edit coordinates…" / "Delete point".
test.describe('maplibre — vertex editing: point click, selection and menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMaplibre(page)
    await drawSquare(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
  })

  const ringLength = (page: Page) => page.evaluate(() =>
    (window.__elementEditorTest!.dataStore.getState().features[0].geometry.coordinates as number[][][])[0].length)
  const pointCenters = (page: Page) => page.evaluate(() =>
    Array.from(document.querySelectorAll('.maplibregl-marker[data-elm-selected]')).map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }),
  )

  test('plain click selects the point and does not delete it', async ({ page }) => {
    const before = await ringLength(page)
    const [p] = await pointCenters(page)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(200)
    expect(await ringLength(page)).toBe(before)
    await expect(page.getByText('1 point selected')).toBeVisible()
    expect(await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().vertexEditActive)).toBe(true)
    const pts = await pointCenters(page)
    await page.mouse.click(pts[1].x, pts[1].y)
    await page.waitForTimeout(200)
    await expect(page.getByText('1 point selected')).toBeVisible()
  })

  test('right-click → Delete point removes exactly one point', async ({ page }) => {
    const before = await ringLength(page)
    const [p] = await pointCenters(page)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await page.getByRole('button', { name: 'Delete point' }).click()
    await page.waitForTimeout(300)
    expect(await ringLength(page)).toBe(before - 1)
  })

  test('Shift+click two points, then Delete removes both', async ({ page }) => {
    // Insert a point first (midpoint click) so 5 → 3 stays a valid shape.
    const before0 = await ringLength(page)
    const mid = await hoverFirstEdgeMidpoint(page)
    await page.mouse.click(mid.x, mid.y)
    await expect.poll(() => ringLength(page)).toBe(before0 + 1)
    const before = await ringLength(page)
    const pts = await pointCenters(page)
    await page.keyboard.down('Shift')
    await page.mouse.click(pts[0].x, pts[0].y)
    await page.mouse.click(pts[1].x, pts[1].y)
    await page.keyboard.up('Shift')
    await expect(page.getByText('2 points selected')).toBeVisible()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(300)
    expect(await ringLength(page)).toBe(before - 2)
  })

  test('right-click → Edit coordinates… opens the coordinate editor', async ({ page }) => {
    const [p] = await pointCenters(page)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await page.getByRole('button', { name: 'Edit coordinates…' }).click()
    await expect(page.getByText('Precise coordinates')).toBeVisible()
  })
})

// apps/demo's drop-in tab used to wrap the editor in its own drop zone (useGeoJSONDropzone), which
// competed with the drop-in's built-in file drop. Now the editor's is the only one there.
test.describe('demo — @element-editor/react tab file drop', () => {
  test('a dropped file is imported once, by the editor, with one toast', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.maplibregl-canvas')
    await page.waitForFunction(() => !!window.__elementEditorTest)
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File([JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', id: 'drop-1', properties: {}, geometry: { type: 'Point', coordinates: [151.2, -33.86] } }],
      })], 'drop.geojson', { type: 'application/geo+json' }))
      return d
    })
    const depth = () => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().undoStack.length)
    const before = await depth()
    const map = page.locator('.maplibregl-map').first()
    await map.dispatchEvent('dragenter', { dataTransfer: dt })
    await map.dispatchEvent('dragover', { dataTransfer: dt })
    await expect(page.locator('[data-elm-file-drop]')).toBeVisible()
    await expect(page.getByTestId('geojson-drop-overlay-active')).toHaveCount(0)
    await map.dispatchEvent('drop', { dataTransfer: dt })
    await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().features.map((f) => f.id))).toEqual(['drop-1'])
    expect(await depth()).toBe(before + 1)
    await expect(page.getByText('Loaded drop.geojson')).toHaveCount(1)
  })
})

