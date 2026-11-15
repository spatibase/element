/**
 * Design tokens on both drop-ins: a custom token set must reach the editor chrome
 * (a panel, a toolbar button) and Element's body-level portals (context menu, schema modal,
 * tooltip), through both channels:
 *   - `style` on <ElementEditor> (the dev page's `?style=<JSON>`),
 *   - a stylesheet rule on the editor root (`?demoTheme=warm`: `.elm-demo-warm[data-elm-theme="light"]`),
 *     which portals don't match: useRootTokens() copies the root's resolved values onto them.
 * Without tokens, the defaults are the old greys (one spot check here; the full pixel diff is
 * run by hand, see docs/guides/theming.md).
 */
import { test, expect, type Page } from './fixtures'
import { waitForMap } from './helpers'

// Several page loads per test; slow under the full parallel suite.
test.slow()

const TOKENS = {
  '--elm-surface': 'rgb(250, 240, 230)',
  '--elm-text': 'rgb(60, 40, 30)',
  '--elm-text-secondary': 'rgb(90, 60, 40)',
  '--elm-border': 'rgb(200, 180, 150)',
  '--elm-radius': '20px',
  '--elm-radius-control': '11px',
  '--elm-font': 'Georgia, serif',
  '--elm-tooltip': 'rgb(70, 30, 10)',
  '--elm-tooltip-text': 'rgb(255, 250, 240)',
}
const q = (o: Record<string, unknown>) => encodeURIComponent(JSON.stringify(o))

async function open(page: Page, query: string) {
  await page.goto('/?view=139.75,35.685,12&data=sample&theme=light&' + query)
  await waitForMap(page)
}

const css = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)

/** The open layers panel's surface (an opaque bg-elm-surface box inside the root). */
const PANEL = '[data-elm-theme] aside div.bg-elm-surface'
/** The toolbar's Point tool button. */
const TOOL_BUTTON = '[data-elm-slot] button[data-elm-shortcut="place-point"]'

/** Right-click the polygon → the context menu portal (outside the root). */
async function openContextMenu(page: Page) {
  await page.evaluate(() => window.__elementEditorRef!.select(['tokyo-a']))
  const at = await page.evaluate(() => {
    const t = window.__elementEditorTest!
    const box = document.querySelector(':is(.leaflet-container, .maplibregl-map)')!.getBoundingClientRect()
    const m = t.map as unknown as { project?: (c: [number, number]) => { x: number; y: number }; latLngToContainerPoint?: (c: [number, number]) => { x: number; y: number } }
    const p = m.latLngToContainerPoint ? m.latLngToContainerPoint([35.685, 139.75]) : m.project!([139.75, 35.685])
    return { x: box.left + p.x, y: box.top + p.y }
  })
  await page.mouse.click(at.x, at.y, { button: 'right' })
  const menu = 'body > [data-elm-portal][data-elm-context-menu]'
  await expect(page.locator(menu)).toBeVisible()
  expect(await page.locator(menu).evaluate((el) => !document.querySelector('[data-elm-theme]')!.contains(el))).toBe(true)
  return menu
}

async function chromeAndPortals(page: Page) {
  const menu = await openContextMenu(page)
  const out = {
    panelBg: await css(page, PANEL, 'background-color'),
    buttonColor: await css(page, TOOL_BUTTON, 'color'),
    buttonRadius: await css(page, TOOL_BUTTON, 'border-top-left-radius'),
    menuText: await css(page, menu, 'color'),
    menuRadius: await css(page, menu, 'border-top-left-radius'),
    menuFont: await css(page, menu, 'font-family'),
  }
  await page.keyboard.press('Escape')
  // The schema editor: a body-level modal window.
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().toggleSchemaModal())
  const modal = 'body > [data-elm-theme] > [role="dialog"][aria-label="Schema editor"]'
  await expect(page.locator(modal).first()).toBeVisible()
  const modalRadius = await css(page, modal, 'border-top-left-radius')
  const modalFont = await css(page, modal, 'font-family')
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().toggleSchemaModal())
  // A toolbar tooltip (inverted surface, its own tokens).
  await page.locator(TOOL_BUTTON).first().hover()
  const tip = 'body > [data-elm-portal].pointer-events-none > div'
  await expect(page.locator(tip).first()).toBeVisible()
  const tooltipText = await css(page, tip, 'color')
  await page.mouse.move(5, 5)
  return { ...out, modalRadius, modalFont, tooltipText }
}

test('custom tokens through `style` reach a panel, a toolbar button and the portals', async ({ page }) => {
  await open(page, `style=${q(TOKENS)}`)
  const got = await chromeAndPortals(page)
  expect(got).toEqual({
    panelBg: TOKENS['--elm-surface'],
    buttonColor: TOKENS['--elm-text'],
    buttonRadius: TOKENS['--elm-radius-control'],
    menuText: TOKENS['--elm-text-secondary'],
    menuRadius: TOKENS['--elm-radius'],
    menuFont: TOKENS['--elm-font'],
    modalRadius: '24px', // windows: container radius + 4px
    modalFont: TOKENS['--elm-font'],
    tooltipText: TOKENS['--elm-tooltip-text'],
  })
})

test('a stylesheet rule on the editor root reaches the portals too (no `style`)', async ({ page }) => {
  // ?demoTheme=warm: `.elm-demo-warm[data-elm-theme="light"] { --elm-text-secondary: #5c4331; … }`
  await open(page, 'demoTheme=warm')
  const got = await chromeAndPortals(page)
  expect(got.panelBg).toBe('rgb(251, 246, 238)') // #fbf6ee
  expect(got.buttonColor).toBe('rgb(59, 42, 30)') // #3b2a1e
  expect(got.buttonRadius).toBe('12px')
  expect(got.menuText).toBe('rgb(92, 67, 49)') // #5c4331, copied from the root onto the portal
  expect(got.menuRadius).toBe('18px')
  expect(got.modalRadius).toBe('22px')
  expect(got.menuFont).toContain('Avenir Next')
  expect(got.modalFont).toContain('Avenir Next')
  expect(got.tooltipText).toBe('rgb(251, 246, 238)')
})

test('per-mode rules follow a mode switch, and portals follow with them', async ({ page }) => {
  await open(page, 'demoTheme=warm')
  await page.evaluate(() => window.__elementEditorTest!.uiStore.setState({ userTheme: 'dark' }))
  await expect(page.locator('[data-elm-theme]').first()).toHaveAttribute('data-elm-theme', 'dark')
  const got = await chromeAndPortals(page)
  expect(got.panelBg).toBe('rgb(42, 33, 27)') // #2a211b
  expect(got.menuText).toBe('rgb(226, 210, 191)') // #e2d2bf
  expect(got.tooltipText).toBe('rgb(42, 33, 27)')
})

test('without tokens the defaults are the old greys', async ({ page }) => {
  await open(page, '')
  const got = await chromeAndPortals(page)
  expect(got.panelBg).toBe('rgb(255, 255, 255)')
  expect(got.buttonColor).toBe('oklch(0.21 0.034 264.665)') // gray-900
  expect(got.buttonRadius).toBe('6px')
  expect(got.menuText).toBe('oklch(0.373 0.034 259.733)') // gray-700
  expect(got.menuRadius).toBe('12px')
  expect(got.modalRadius).toBe('16px')
  expect(got.tooltipText).toBe('rgb(255, 255, 255)')
})
