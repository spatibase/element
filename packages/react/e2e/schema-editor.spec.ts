import { test, expect, MAP } from './fixtures'
import { waitForMap, SAMPLE_GEOJSON, importGeoJSON } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'

/**
 * Open the Schema editor modal.
 * The schema is now accessible via keyboard shortcut 'S' (toggle-schema default binding)
 * or via the TreeStructure icon button in the sidebar header.
 */
async function openSchemaTab(page: Parameters<typeof importGeoJSON>[0]) {
  // Focus the map area first so keyboard shortcut fires
  await page.locator(MAP).click()
  await page.keyboard.press('s')
  // Wait for the modal to appear
  await page.locator('[role="dialog"], .schema-modal, [data-testid="schema-modal"]')
    .or(page.getByRole('button', { name: /add field/i }))
    .first()
    .waitFor({ state: 'visible', timeout: 3000 })
    .catch(async () => {
      // Fallback: click via tooltip title
      await page.locator('button').filter({ has: page.locator('[data-phosphor-icon]') }).nth(2).click()
    })
}

test.describe('Schema Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
  })

  test('schema tab shows default schema expanded with fields', async ({ page }) => {
    await openSchemaTab(page)
    // Default schema is expanded by default; Add field button should be visible
    await expect(page.getByRole('button', { name: /add field/i })).toBeVisible()
  })

  test('default schema is selected by default in the left panel', async ({ page }) => {
    await openSchemaTab(page)
    // The left panel shows schema names; Default should be visible and active
    await expect(page.getByRole('button', { name: /default/i }).first()).toBeVisible()
  })

  test('default schema fields are listed', async ({ page }) => {
    await openSchemaTab(page)
    // The default schema has Name, Description, and Image URL fields
    const labels = page.getByPlaceholder('Field label')
    const count = await labels.count()
    expect(count).toBeGreaterThanOrEqual(2)
    const values = await Promise.all(Array.from({ length: count }, (_, i) => labels.nth(i).inputValue()))
    expect(values).toContain('Name')
    expect(values).toContain('Description')
  })

  test('adding a field creates a new row', async ({ page }) => {
    await openSchemaTab(page)
    const initialCount = await page.getByPlaceholder('Field label').count()

    await page.getByRole('button', { name: /add field/i }).click()

    expect(await page.getByPlaceholder('Field label').count()).toBe(initialCount + 1)
  })

  test('new field appears in the edit panel after being added', async ({ page }) => {
    await importGeoJSON(page, SAMPLE_GEOJSON)
    await expect(page.getByText('Paris')).toBeVisible()

    await openSchemaTab(page)
    await page.getByRole('button', { name: /add field/i }).click()
    await page.getByPlaceholder('Field label').last().fill('Rating')
    await page.keyboard.press('Tab') // blur to commit

    // Close the schema modal (Escape or click X)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Open edit panel for Paris
    const row = page.locator('aside li').filter({ hasText: 'Paris' }).first()
    await row.hover()
    await row.getByRole('button', { name: /^edit$/i }).click()

    await expect(page.locator('aside').getByText('Rating')).toBeVisible()
  })

  test('name field delete button is disabled (protected)', async ({ page }) => {
    await openSchemaTab(page)
    const nameInput = page.getByPlaceholder('Field label').first()
    const nameRow = nameInput.locator('xpath=..')
    const deleteBtn = nameRow.locator('button').last()
    await expect(deleteBtn).toBeDisabled()
  })

  test('non-protected field can be deleted', async ({ page }) => {
    await openSchemaTab(page)
    const descInput = page.getByPlaceholder('Field label').nth(1)
    const descRow = descInput.locator('xpath=..')
    await descRow.locator('button').last().click()

    expect(await page.getByPlaceholder('Field label').count()).toBe(2)
  })

  test('schema is preserved in export and restored on import', async ({ page }, testInfo) => {
    await openSchemaTab(page)
    await page.getByRole('button', { name: /add field/i }).click()
    // The schema-editor label input commits to store on blur/Enter — a plain
    // .fill() never fires blur, so the label stays as draft state and is
    // missing from the export.
    const newField = page.getByPlaceholder('Field label').last()
    await newField.fill('Rating')
    await newField.press('Enter')
    await page.waitForTimeout(200)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => {
        const ref = window.__elementEditorRef!
        ref.exportAs('geojson')
      }),
    ])
    const exportedPath = path.join(os.tmpdir(), `element-editor-schema-export-${testInfo.workerIndex}.geojson`)
    await download.saveAs(exportedPath)

    await page.reload()
    await waitForMap(page)
    await importGeoJSON(page, fs.readFileSync(exportedPath, 'utf-8'))

    await openSchemaTab(page)
    const inputs = await page.getByPlaceholder('Field label').all()
    const values = await Promise.all(inputs.map((i) => i.inputValue()))
    expect(values).toContain('Rating')

    fs.unlinkSync(exportedPath)
  })
})
