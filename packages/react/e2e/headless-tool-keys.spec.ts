/**
 * Headless hosts start a tool from their OWN button, outside the editor root, so focus stays on that
 * button. While a tool is on, Escape / Backspace / Delete still drive it (and are `defaultPrevented`
 * so host handlers can tell); text fields, outside modals and Enter keep their normal behaviour.
 * Page: apps/demo `?headless=<engine>` (HeadlessDemo); the host button is added outside `[data-elm-theme]`.
 */
import { test, expect, type Page } from './fixtures'

test.use({ baseURL: `http://localhost:${process.env.E2E_DEMO_PORT ?? 5199}` })

type Keys = { key: string; prevented: boolean }[]

async function open(page: Page, engine: 'leaflet' | 'maplibre') {
  await page.goto(`/?headless=${engine}`)
  await page.waitForFunction(() => !!window.__elementEditorTest && !!window.__elementEditorRef)
  await page.waitForTimeout(500)
  // A host button + input outside the editor root, and a recorder that runs after the editor's
  // window listeners (registered later, same phase) and sees the final `defaultPrevented`.
  await page.evaluate(() => {
    const w = window as unknown as { __keys: Keys }
    w.__keys = []
    const btn = document.createElement('button')
    btn.id = 'outside-btn'
    btn.textContent = 'Host draw'
    btn.onclick = () => (window.__elementEditorRef as unknown as { setTool: (t: string) => void }).setTool('line')
    const input = document.createElement('input')
    input.id = 'outside-input'
    document.body.append(btn, input)
    window.addEventListener('keydown', (e) => w.__keys.push({ key: e.key, prevented: e.defaultPrevented }))
  })
}

const mode = (page: Page) => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().editingMode)
const verts = (page: Page) => page.evaluate(() => window.__elementEditorTest!.uiStore.getState().lineInProgress.length)
const keys = (page: Page) => page.evaluate(() => (window as unknown as { __keys: Keys }).__keys)

async function startLineFromHost(page: Page, points = 0) {
  await page.locator('#outside-btn').click()
  await expect.poll(() => mode(page)).toBe('draw-line')
  const box = (await page.locator('[data-host-clicks]').boundingBox())!
  for (let i = 0; i < points; i++) {
    await page.mouse.click(box.x + box.width / 2 + i * 60 - 60, box.y + box.height / 2 + (i % 2) * 40)
    await page.waitForTimeout(400)
  }
  // Focus back on the host button (a map click may have moved it).
  await page.locator('#outside-btn').focus()
}

for (const engine of ['leaflet', 'maplibre'] as const) {
  test.describe(`headless tool keys ${engine}`, () => {
    test('Escape exits the tool with focus on a host button outside the root, and is defaultPrevented', async ({ page }) => {
      await open(page, engine)
      await startLineFromHost(page, 2)
      // Escape is two-step by design: first drops the points drawn so far, then exits the tool.
      await page.keyboard.press('Escape')
      await expect.poll(() => verts(page)).toBe(0)
      expect(await mode(page)).toBe('draw-line')
      await page.keyboard.press('Escape')
      await expect.poll(() => mode(page)).toBe('none')
      expect((await keys(page)).find((k) => k.key === 'Escape')?.prevented).toBe(true)
    })

    test('Backspace and Delete remove the last vertex with focus on the host button', async ({ page }) => {
      await open(page, engine)
      await startLineFromHost(page, 3)
      expect(await verts(page)).toBe(3)
      await page.keyboard.press('Backspace')
      await expect.poll(() => verts(page)).toBe(2)
      await page.keyboard.press('Delete')
      await expect.poll(() => verts(page)).toBe(1)
      expect(await mode(page)).toBe('draw-line')
    })

    test('Escape and Backspace in a host text input do not touch the tool', async ({ page }) => {
      await open(page, engine)
      await startLineFromHost(page, 1)
      await page.locator('#outside-input').focus()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(200)
      expect(await mode(page)).toBe('draw-line')
      expect(await verts(page)).toBe(1)
    })

    test('Escape inside an open host modal does not cancel the tool; Enter on the host button is left alone', async ({ page }) => {
      await open(page, engine)
      await startLineFromHost(page, 1)
      await page.evaluate(() => {
        const d = document.createElement('div')
        d.setAttribute('aria-modal', 'true')
        d.innerHTML = '<button id="modal-btn">ok</button>'
        document.body.append(d)
        document.getElementById('modal-btn')!.focus()
      })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      expect(await mode(page)).toBe('draw-line')
      await page.locator('#outside-btn').focus()
      await page.keyboard.press('Enter')
      expect((await keys(page)).find((k) => k.key === 'Enter')?.prevented).toBe(false)
    })

    test('with no tool on, Escape on a host button is untouched', async ({ page }) => {
      await open(page, engine)
      await page.locator('#outside-btn').focus()
      await page.keyboard.press('Escape')
      expect((await keys(page)).find((k) => k.key === 'Escape')?.prevented).toBe(false)
    })
  })
}
