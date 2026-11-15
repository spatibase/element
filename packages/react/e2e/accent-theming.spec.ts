/**
 * Theming on both drop-ins: `theme` is the mode only; colours go through
 * `style` (CSS variables on the editor root) or `accentColor`. The dev page takes
 * `?style=<JSON>`, `?accentColor=` and `?theme=` (a JSON object there = the removed object form).
 *
 * Every accent path must reach (a) the editor chrome, (b) the map's selection / drawing
 * colours (concrete colours read from the CSS: MapLibre evaluated paint, Leaflet path style
 * options), and (c) Element's body-level portals (schema modal, context menu, tooltip), which
 * sit outside the editor root and get its CSS variables copied on.
 */
import { test, expect, MAP, type Page } from './fixtures'
import { waitForMap, drawPolygon } from './helpers'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Map as LeafletMap, Path, Polyline } from 'leaflet'

// Each test opens the dev page several times; under full parallel load that runs past 30 s.
test.slow()

const VIOLET = '#7c3aed'
const PINK = '#ff00aa'
const DEFAULT_500 = '#3b82f6'

const q = (o: Record<string, unknown>) => encodeURIComponent(JSON.stringify(o))

async function open(page: Page, query: string) {
  await page.goto('/?' + query)
  await waitForMap(page)
}

/** Any CSS colour → #rrggbb (canvas normalises oklab / color-mix / rgb). Runs in the page. */
const TO_HEX = `(c) => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1)
  return '#' + [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')
}`

/** Computed CSS property of the first match, as #rrggbb. */
const cssHex = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, [prop, toHex]) =>
    (new Function(`return ${toHex}`)() as (c: string) => string)(getComputedStyle(el).getPropertyValue(prop)), [prop, TO_HEX] as const)

/** `--color-primary-500` as resolved inside `el` (a probe child), as #rrggbb. */
const primary500In = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el, toHex) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-primary-500)'
    el.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return (new Function(`return ${toHex}`)() as (c: string) => string)(c)
  }, TO_HEX)

/** A polygon on the map, selected (so the layers list row and the map show the selection). */
async function drawSelected(page: Page) {
  await page.locator(MAP).first().focus()
  const c = await drawPolygon(page, { width: 60, height: 45, x: 0.45 })
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const t = window.__elementEditorTest!
    window.__elementEditorRef!.select([t.dataStore.getState().features[0].id])
  })
  await expect.poll(() => page.evaluate(() => window.__elementEditorTest!.dataStore.getState().selectedIds.length)).toBe(1)
  return c
}

/** The selected feature's colour on the map: MapLibre evaluated fill paint, Leaflet path style. */
const selectedMapColor = (page: Page, engine: string) => page.evaluate(([engine, toHex]) => {
  const t = window.__elementEditorTest!
  const id = t.dataStore.getState().selectedIds[0]
  if (engine === 'maplibre') {
    const map = t.map as MapLibreMap
    const f = map.queryRenderedFeatures({ layers: ['elm-features-fill'] }).find((f) => f.properties.id === id)
    if (!f) return null
    const c = (f.layer.paint as Record<string, { r: number; g: number; b: number }>)['fill-color']
    return '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
  }
  // Leaflet: the selected polygon is an SVG path on its own; read its stroke attribute.
  const map = t.map as LeafletMap
  let out: string | null = null
  map.eachLayer((l) => {
    const p = l as Polyline & { _path?: SVGPathElement }
    if (out || !('getLatLngs' in p) || (p.options as Path['options']).opacity === 0.001 || !p._path) return
    const stroke = p._path.getAttribute('stroke')
    if (stroke && stroke !== 'none') out = (new Function(`return ${toHex}`)() as (c: string) => string)(stroke)
  })
  return out
}, [engine, TO_HEX] as const)

/** Colour of the in-progress drawing (a polygon with two points placed). */
async function drawingColor(page: Page, engine: string) {
  const map = page.locator(MAP).first()
  const box = (await map.boundingBox())!
  await map.focus()
  await page.keyboard.press('g')
  await map.click({ position: { x: box.width * 0.15, y: box.height * 0.25 } })
  await page.waitForTimeout(150)
  await map.click({ position: { x: box.width * 0.25, y: box.height * 0.25 } })
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35, { steps: 3 })
  const color = await page.evaluate(([engine, toHex]) => {
    const toHexFn = new Function(`return ${toHex}`)() as (c: string) => string
    if (engine === 'maplibre') {
      const c = (window.__elementEditorTest!.map as MapLibreMap).getPaintProperty('elm-preview-line', 'line-color')
      return typeof c === 'string' ? toHexFn(c) : null
    }
    const strokes = [...document.querySelectorAll('.leaflet-overlay-pane path')]
      .map((p) => p.getAttribute('stroke')).filter((s): s is string => !!s && s !== 'none')
    return strokes.length ? toHexFn(strokes[strokes.length - 1]) : null
  }, [engine, TO_HEX] as const)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  return color
}

/** The schema editor (a body-level portal): the active schema's right border is primary-500. */
async function schemaModalBorder(page: Page) {
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().toggleSchemaModal())
  const active = 'body > [data-elm-theme] button.border-primary-500'
  await expect(page.locator(active).first()).toBeVisible()
  // It really is outside the editor root.
  expect(await page.locator(active).first().evaluate((el) => !document.querySelector('[data-elm-theme]')!.contains(el))).toBe(true)
  const color = await cssHex(page, active, 'border-right-color')
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().toggleSchemaModal())
  return color
}

/** Right-click the selected feature → the context menu portal; its resolved primary-500. */
async function contextMenuPrimary(page: Page, at: { cx: number; cy: number }) {
  await page.mouse.click(at.cx, at.cy, { button: 'right' })
  const menu = 'body > [data-elm-portal][data-elm-context-menu]'
  await expect(page.locator(menu).first()).toBeVisible()
  const color = await primary500In(page, menu)
  await page.keyboard.press('Escape')
  return color
}

/** Hover a toolbar button → its tooltip portal; the resolved primary-500 there. */
async function tooltipPrimary(page: Page) {
  const btn = page.locator('[data-elm-slot] button[aria-label]').first()
  await btn.hover()
  const tip = 'body > [data-elm-portal].pointer-events-none'
  await expect(page.locator(tip).first()).toBeVisible()
  const color = await primary500In(page, tip)
  await page.mouse.move(5, 5)
  return color
}

/** The active drawing tool's button background (in the editor root). */
async function activeToolBg(page: Page) {
  await page.evaluate(() => window.__elementEditorRef!.setTool('polygon'))
  const sel = '[data-elm-slot] button.bg-primary-500'
  await expect(page.locator(sel).first()).toBeVisible()
  const color = await cssHex(page, sel, 'background-color')
  await page.evaluate(() => window.__elementEditorRef!.setTool(null))
  return color
}

/** Everything the accent colours, in one record. */
async function fingerprint(page: Page, engine: string) {
  const at = await drawSelected(page)
  const out = {
    root500: await primary500In(page, '[data-elm-theme]'),
    row: await cssHex(page, 'aside li div[class*="bg-(--elm-row-selected)"]', 'background-color'),
    map: await selectedMapColor(page, engine),
    contextMenu: await contextMenuPrimary(page, at),
    schemaModal: await schemaModalBorder(page),
    tooltip: await tooltipPrimary(page),
    tool: await activeToolBg(page),
  }
  // A settings switch that's on (snapping is on by default): bg-primary-500, inside the root.
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setSettingsModalOpen(true))
  const sw = page.getByRole('dialog', { name: 'Settings' }).locator('.rounded-full.bg-primary-500').first()
  await expect(sw).toBeVisible()
  const settingsSwitch = await sw.evaluate((el, toHex) => (new Function(`return ${toHex}`)() as (c: string) => string)(getComputedStyle(el).backgroundColor), TO_HEX)
  await page.evaluate(() => window.__elementEditorTest!.uiStore.getState().setSettingsModalOpen(false))
  return { ...out, settingsSwitch, drawing: await drawingColor(page, engine) }
}

test('style --elm-accent recolours chrome, portals and the map, exactly like accentColor', async ({ page, engine }) => {
  await open(page, '')
  const base = await fingerprint(page, engine)
  expect(base.root500).toBe(DEFAULT_500)

  await open(page, `accentColor=${encodeURIComponent(VIOLET)}`)
  const viaProp = await fingerprint(page, engine)

  await open(page, `style=${q({ '--elm-accent': VIOLET })}`)
  const viaStyle = await fingerprint(page, engine)

  // The 500 shade is the accent itself everywhere it's used.
  for (const k of ['root500', 'map', 'contextMenu', 'schemaModal', 'tooltip', 'tool', 'settingsSwitch', 'drawing'] as const) {
    expect(viaStyle[k], k).toBe(VIOLET)
  }
  // Derived shades (the selected row's tint) match the accentColor path and differ from blue.
  expect(viaStyle).toEqual(viaProp)
  for (const k of Object.keys(base) as (keyof typeof base)[]) expect(viaStyle[k], k).not.toBe(base[k])
})

test('style --elm-primary-500 overrides that one shade everywhere', async ({ page, engine }) => {
  await open(page, `style=${q({ '--elm-primary-500': PINK })}`)
  const at = await drawSelected(page)
  expect(await primary500In(page, '[data-elm-theme]')).toBe(PINK)
  await expect.poll(() => selectedMapColor(page, engine)).toBe(PINK)
  expect(await contextMenuPrimary(page, at)).toBe(PINK)
  expect(await schemaModalBorder(page)).toBe(PINK)
  expect(await activeToolBg(page)).toBe(PINK)
  expect(await drawingColor(page, engine)).toBe(PINK)
})

test('a style accent survives a theme switch (map selection and chrome)', async ({ page, engine }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await open(page, `style=${q({ '--elm-accent': VIOLET })}`)
  const at = await drawSelected(page)
  await expect.poll(() => selectedMapColor(page, engine)).toBe(VIOLET)
  await page.evaluate(() => window.__elementEditorTest!.uiStore.setState({ userTheme: 'dark' }))
  await expect(page.locator('[data-elm-theme]').first()).toHaveAttribute('data-elm-theme', 'dark')
  // MapLibre swaps to the dark basemap (setStyle drops and re-adds Element's layers).
  if (engine === 'maplibre') await page.waitForTimeout(500)
  await expect.poll(() => selectedMapColor(page, engine), { timeout: 10_000 }).toBe(VIOLET)
  expect(await primary500In(page, '[data-elm-theme]')).toBe(VIOLET)
  expect(await contextMenuPrimary(page, at)).toBe(VIOLET)
  expect(await activeToolBg(page)).toBe(VIOLET)
})

test('theme as an object is ignored with a dev warning pointing to style / accentColor', async ({ page }) => {
  const warnings: string[] = []
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page, `theme=${q({ '--elm-accent': VIOLET })}`)
  // Not applied: the accent stays the default blue …
  expect(await primary500In(page, '[data-elm-theme]')).toBe(DEFAULT_500)
  // … and the mode falls back to config.mode / the OS (dark here).
  await expect(page.locator('[data-elm-theme]').first()).toHaveAttribute('data-elm-theme', 'dark')
  await expect.poll(() => warnings.find((w) => w.includes('<ElementEditor theme>'))).toMatch(/style.*accentColor/)
})
