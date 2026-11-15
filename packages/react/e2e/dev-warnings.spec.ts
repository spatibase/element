/**
 * Development-only setup warnings (shell/useDevChecks.ts): the stylesheet isn't loaded, or the
 * editor has no height. The dev page is a correct setup (no warning); each mistake is simulated
 * with a style injected before the app mounts.
 *
 * Runs on both engines (the `engine` fixture / project, e2e/fixtures.ts).
 */
import { test, expect, type Page } from './fixtures'

/** Adds `css` to the page as soon as the document exists, before the editor mounts. */
const injectCss = (page: Page, css: string) => page.addInitScript((css) => {
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style')
    s.textContent = css
    document.head.appendChild(s)
  })
}, css)

async function warningsAfterLoad(page: Page): Promise<string[]> {
  const warnings: string[] = []
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__elementEditorRef)
  await page.waitForTimeout(2000) // the stylesheet check waits 1.5 s for late-loading CSS
  return warnings
}

test.describe('development warnings', () => {
  test('a correct setup warns about neither', async ({ page }) => {
    const warnings = await warningsAfterLoad(page)
    expect(warnings.filter((t) => t.includes('stylesheet') || t.includes('map is blank'))).toEqual([])
  })

  test('missing stylesheet: says which file to import', async ({ page, engine }) => {
    // `initial` makes the probed variable empty, as if the stylesheet weren't there.
    await injectCss(page, '[data-elm-theme] { --elm-row-hover: initial !important; }')
    const warnings = await warningsAfterLoad(page)
    const css = engine === 'leaflet' ? "'@element-editor/react/leaflet/style.css'" : "'@element-editor/react/style.css'"
    expect(warnings.some((t) => t.includes('stylesheet is not loaded') && t.includes(css))).toBe(true)
  })

  test('zero height: says the map is blank and how to size the parent', async ({ page }) => {
    await injectCss(page, '.w-screen.h-screen { height: 0 !important; }')
    const warnings = await warningsAfterLoad(page)
    expect(warnings.some((t) => t.includes('map is blank') && t.includes('explicit size'))).toBe(true)
  })
})
