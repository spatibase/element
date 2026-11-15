/**
 * A floating window focuses itself on open (tabIndex -1, for Escape and the
 * focus trap). That container must never draw a focus ring: not when opened
 * by mouse, not when opened by its shortcut (Chrome then matches
 * :focus-visible on the programmatic focus), and not when the host page has
 * its own unlayered `:focus-visible { outline }` rule, as the docs site does.
 * Controls inside still show their ring for keyboard users, and toolbar
 * buttons show the neutral ring (not a host or browser outline) when tabbed to.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap } from './helpers'

const WINDOW = '[role="dialog"][aria-label="Schema editor"]'

/** A host page's global focus style, like the docs site's. */
const HOST_CSS = ':focus-visible { outline: 2px solid rgb(61, 220, 132); outline-offset: 2px; }'

/** Ring colour: the neutral --elm-focus-ring token, resolved in the page. */
function neutralRingColor(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--elm-focus-ring, var(--_elm-focus-ring))'
    document.querySelector('[data-elm-theme]')!.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })
}

function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    // A ring is an outline, or a box-shadow with a non-transparent layer (Tailwind's ring utilities).
    const shadowRing = cs.boxShadow !== 'none' && cs.boxShadow.split(/,(?![^(]*\))/).some((s) => !/rgba\(0, 0, 0, 0\)/.test(s) && /\b0px 0px 0px [1-9]/.test(s))
    return {
      isWindow: el.matches('[role="dialog"][aria-label="Schema editor"]'),
      label: el.getAttribute('aria-label'),
      focusVisible: el.matches(':focus-visible'),
      ring: cs.outlineStyle !== 'none' || shadowRing,
      outline: cs.outlineStyle,
      shadow: cs.boxShadow,
    }
  })
}

test.describe('Floating window focus ring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMap(page)
    await page.addStyleTag({ content: HOST_CSS })
  })

  test('schema window opened by mouse shows no ring; Tab shows a control ring', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit schema' }).click()
    await expect(page.locator(WINDOW)).toBeVisible()
    expect(await focused(page)).toMatchObject({ isWindow: true, label: 'Schema editor', focusVisible: false, ring: false })

    await page.keyboard.press('Tab')
    const control = await focused(page)
    expect(control.isWindow).toBe(false)
    expect(control.focusVisible).toBe(true)
    expect(control.ring).toBe(true)
  })

  test('schema window opened by its shortcut shows no ring', async ({ page }) => {
    await page.locator(MAP).click()
    await page.keyboard.press('s')
    await expect(page.locator(WINDOW)).toBeVisible()
    // Chrome matches :focus-visible here (the last input was a key); the window still draws nothing.
    expect(await focused(page)).toMatchObject({ isWindow: true, label: 'Schema editor', focusVisible: true, ring: false })
  })
})

for (const host of [false, true]) {
  test.describe(`Toolbar button focus ring${host ? ' (host :focus-visible rule)' : ''}`, () => {
    test('tabbing onto a toolbar button shows the neutral ring', async ({ page }) => {
      await page.goto('/')
      await waitForMap(page)
      if (host) await page.addStyleTag({ content: HOST_CSS })
      await page.locator(MAP).click()
      // Tab until the schema toolbar button (an IconButton) has focus.
      let state = await focused(page)
      for (let i = 0; i < 120 && state.label !== 'Edit schema'; i++) {
        await page.keyboard.press('Tab')
        state = await focused(page)
      }
      expect(state.label).toBe('Edit schema')
      expect(state.focusVisible).toBe(true)
      expect(state.ring).toBe(true)
      // The library's own ring, not an outline (browser default or host rule) on top.
      expect(state.outline).toBe('none')
      expect(state.shadow).toContain(`${await neutralRingColor(page)} 0px 0px 0px 2px`)
    })
  })
}
