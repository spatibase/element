/**
 * `featureColor` + `getFeatureStyle` on both drop-ins (dev page params `?featureColor=` and
 * `?featureStyle=1`, which paints `properties.kind === 'hot'` red). Precedence:
 * selected > getFeatureStyle > featureColor > built-in slate. A coloured feature selects to a
 * darker shade of its own colour (`selectionStyle: 'auto'`), an uncoloured one to the accent;
 * hover is a milder shade of the feature's colour, only an uncoloured MapLibre feature turns the
 * lighter hover slate. `?selectionStyle=accent|feature` and `?featureStyle=state` cover the rest.
 *
 * MapLibre: the evaluated paint per rendered feature (feature-state included).
 * Leaflet: the path layers' style options, which both renderers draw from (the default canvas
 * has no per-feature DOM), plus the SVG attributes with `?renderer=svg`.
 */
import { test, expect, type Page } from './fixtures'
import { importGeoJSON, waitForMap, drawPolygon, featureCenter, mapBox } from './helpers'
import { deriveStateColors } from '@element-editor/core'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Map as LeafletMap, Path, Polyline } from 'leaflet'

// Each test opens the dev page up to 3 times; under full parallel load that runs past 30 s.
test.slow()

const TEAL = '#00a2f0', RED = '#ff0000', SLATE = '#475569', SLATE_ON_DARK = '#94a3b8', HOVER_SLATE = '#64748b', PIN_HOVER_SLATE = '#334155'
/** The selected / hovered shade the editor derives from a feature colour. */
const shade = (hex: string) => deriveStateColors(hex)!
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const COLORS = `featureColor=${encodeURIComponent(TEAL)}&featureStyle=1`

/** Sample data in the left half of the view: a 'hot' polygon, a plain polygon, a line, a point. */
function sample({ w, s, e, n }: { w: number; s: number; e: number; n: number }) {
  const x = (f: number) => w + (e - w) * f, y = (f: number) => s + (n - s) * f
  const box = (x0: number, y0: number, x1: number, y1: number) => [[[x(x0), y(y0)], [x(x1), y(y0)], [x(x1), y(y1)], [x(x0), y(y1)], [x(x0), y(y0)]]]
  const feat = (id: string, kind: string | null, geometry: object) => ({ type: 'Feature', id, properties: { name: id, ...(kind && { kind }) }, geometry })
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      feat('hot', 'hot', { type: 'Polygon', coordinates: box(0.1, 0.6, 0.25, 0.8) }),
      feat('plain', null, { type: 'Polygon', coordinates: box(0.1, 0.2, 0.25, 0.4) }),
      feat('line', null, { type: 'LineString', coordinates: [[x(0.3), y(0.2)], [x(0.4), y(0.8)]] }),
      feat('pt', null, { type: 'Point', coordinates: [x(0.45), y(0.5)] }),
    ],
  })
}

/** Open the dev page and import the sample data into the current view. */
async function open(page: Page, query: string) {
  await page.goto('/?' + query)
  await waitForMap(page)
  const b = await page.evaluate(() => {
    const b = window.__elementEditorTest!.map.getBounds()
    return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }
  })
  await importGeoJSON(page, sample(b))
}

/** The accent's 500 shade as the editor's CSS resolves it (selected features take it), as #rrggbb. */
const accent500 = (page: Page) => page.evaluate(() => {
  const probe = document.createElement('span')
  probe.style.color = 'var(--color-primary-500)'
  document.querySelector('[data-elm-theme]')!.appendChild(probe)
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.fillStyle = getComputedStyle(probe).color
  probe.remove()
  ctx.fillRect(0, 0, 1, 1)
  return '#' + [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')
})

/** Move the real mouse onto a feature's bbox centre. */
async function hover(page: Page, name: string) {
  const p = await featureCenter(page, name)
  await page.mouse.move(p.x, p.y, { steps: 5 })
}

test.describe('MapLibre', () => {
  test.skip(({ engine }) => engine !== 'maplibre', 'MapLibre paint expressions')

  /** Evaluated paint colour per feature id (feature-state included) for one layer. */
  const paintColors = (page: Page, layer: string, prop: string) => page.evaluate(([layer, prop]) => {
    const out: Record<string, string> = {}
    const map = window.__elementEditorTest!.map as MapLibreMap
    for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
      const c = (f.layer.paint as Record<string, { r: number; g: number; b: number }>)[prop]
      out[f.properties.id] = '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
    }
    return out
  }, [layer, prop])

  /** Evaluated fill-opacity of one polygon. */
  const fillOpacityOf = (page: Page, id: string) => page.evaluate((id) => {
    const map = window.__elementEditorTest!.map as MapLibreMap
    const f = map.queryRenderedFeatures({ layers: ['elm-features-fill'] }).find((f) => f.properties.id === id)!
    return (f.layer.paint as Record<string, unknown>)['fill-opacity'] as number
  }, id)

  test('featureColor + getFeatureStyle colour features, with precedence; hover keeps the colour', async ({ page }) => {
    // Default stays slate when neither option is set.
    await open(page, '')
    await expect.poll(() => paintColors(page, 'elm-features-fill', 'fill-color')).toEqual({ hot: SLATE, plain: SLATE })
    // An uncoloured feature keeps the old hover look: lighter slate (plus the fill boost).
    await hover(page, 'plain')
    await expect.poll(() => paintColors(page, 'elm-features-fill', 'fill-color')).toEqual({ hot: SLATE, plain: HOVER_SLATE })
    expect(await fillOpacityOf(page, 'plain')).toBe(0.22)

    await open(page, COLORS)
    await page.locator('.maplibregl-canvas').first().focus()
    const { cx, cy } = await drawPolygon(page, { width: 60, height: 50, x: 0.55 })
    await page.keyboard.press('Escape')
    await page.mouse.move(5, 5) // not hovering the drawn polygon (hover is a shade)
    // The store has it at once; the map renders it a frame or two later.
    await expect.poll(async () => Object.keys(await paintColors(page, 'elm-features-fill', 'fill-color')).length).toBe(3)
    const fills = await paintColors(page, 'elm-features-fill', 'fill-color')
    const drawnId = Object.keys(fills).find((id) => !['hot', 'plain'].includes(id))!
    // getFeatureStyle ({ color: red }) wins over featureColor, and its fill follows its colour.
    expect(fills).toEqual({ hot: RED, plain: TEAL, [drawnId]: TEAL })
    expect(await paintColors(page, 'elm-features-line', 'line-color')).toEqual({ hot: RED, plain: TEAL, line: TEAL, [drawnId]: TEAL })
    expect(await paintColors(page, 'elm-features-point', 'circle-color')).toEqual({ pt: TEAL })
    // Fill opacity keeps its default when only colours are given.
    expect(await fillOpacityOf(page, 'plain')).toBe(0.13)
    // Selected: the drawn polygon (featureColor) takes a darker shade of its own colour, not the accent.
    const accent = await accent500(page)
    expect(accent).not.toBe(TEAL)
    await page.mouse.click(cx, cy)
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color'))[drawnId]).toBe(shade(TEAL).selected)
    expect((await paintColors(page, 'elm-features-line', 'line-color'))[drawnId]).toBe(shade(TEAL).selected)
    // ...with a heavier outline as the second cue (the plain selected outline is 2.5 px).
    expect((await paintColors(page, 'elm-features-line', 'line-color'))[drawnId]).not.toBe(accent)
    // Hover: a milder shade of the feature's own colour; the fill gets denser.
    await page.keyboard.press('Escape')
    await hover(page, 'plain')
    await expect.poll(() => fillOpacityOf(page, 'plain')).toBe(0.22)
    expect((await paintColors(page, 'elm-features-fill', 'fill-color')).plain).toBe(shade(TEAL).hovered)
    expect((await paintColors(page, 'elm-features-line', 'line-color')).plain).toBe(shade(TEAL).hovered)
    await hover(page, 'hot')
    await expect.poll(() => fillOpacityOf(page, 'hot')).toBe(0.22)
    expect((await paintColors(page, 'elm-features-fill', 'fill-color')).hot).toBe(shade(RED).hovered)
  })

  /** Evaluated line-width of one outline / line. */
  const lineWidthOf = (page: Page, id: string) => page.evaluate((id) => {
    const map = window.__elementEditorTest!.map as MapLibreMap
    const f = map.queryRenderedFeatures({ layers: ['elm-features-line'] }).find((f) => f.properties.id === id)!
    return (f.layer.paint as Record<string, number>)['line-width']
  }, id)

  /** Select by id through the store (the feature may sit under another one at its bbox centre). */
  const select = (page: Page, id: string) => page.evaluate((id) => window.__elementEditorTest!.dataStore.getState().selectFeature(id), id)

  test('selectionStyle: auto = own colour derives, default slate keeps the accent; accent / feature force a side', async ({ page }) => {
    await open(page, COLORS.replace(/featureColor=[^&]+&/, ''))
    const accent = await accent500(page)
    // Default colour (slate): accent, as before. A getFeatureStyle colour (red): a darker red + heavier stroke.
    await select(page, 'plain')
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).plain).toBe(accent)
    expect(await lineWidthOf(page, 'plain')).toBe(2.5)
    await select(page, 'hot')
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).hot).toBe(shade(RED).selected)
    expect((await paintColors(page, 'elm-features-line', 'line-color')).hot).toBe(shade(RED).selected)
    expect(await lineWidthOf(page, 'hot')).toBe(4)
    expect(shade(RED).selected).not.toBe(RED)

    // 'accent': today's look everywhere.
    await open(page, COLORS + '&selectionStyle=accent')
    await select(page, 'hot')
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).hot).toBe(accent)
    expect(await lineWidthOf(page, 'hot')).toBe(2.5)

    // 'feature': even the default slate derives.
    await open(page, 'selectionStyle=feature')
    await select(page, 'plain')
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).plain).toBe(shade(SLATE).selected)
  })

  test('getFeatureStyle(feature, state): the state style wins over the derived look', async ({ page }) => {
    await open(page, 'featureStyle=state')
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).hot).toBe(RED)
    await select(page, 'hot')
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).hot).toBe('#00ff00')
    expect(await lineWidthOf(page, 'hot')).toBe(8)
  })

  test('on a dark basemap the default colour is a lighter slate; lines are drawn heavier than outlines', async ({ page }) => {
    // Dark theme → the 'auto' basemap is the dark style.
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page, '')
    await expect.poll(() => paintColors(page, 'elm-features-fill', 'fill-color')).toEqual({ hot: SLATE_ON_DARK, plain: SLATE_ON_DARK })
    expect(await paintColors(page, 'elm-features-point', 'circle-color')).toEqual({ pt: SLATE_ON_DARK })
    const widths = await page.evaluate(() => {
      const map = window.__elementEditorTest!.map as MapLibreMap
      const out: Record<string, number> = {}
      for (const f of map.queryRenderedFeatures({ layers: ['elm-features-line'] })) out[f.properties.id] = (f.layer.paint as Record<string, number>)['line-width']
      return out
    })
    expect(widths.line).toBe(3.5)
    expect(widths.plain).toBe(1.8)
    // Lines (not outlines) sit on a casing 1.5 px each side: dark on a dark basemap.
    const casing = await page.evaluate(() => {
      const map = window.__elementEditorTest!.map as MapLibreMap
      return map.queryRenderedFeatures({ layers: ['elm-features-line-casing'] }).map((f) => [f.properties.id, (f.layer.paint as Record<string, number>)['line-width']])
    })
    expect(Object.fromEntries(casing)).toEqual({ line: 6.5 })
    expect(await page.evaluate(() => (window.__elementEditorTest!.map as MapLibreMap).getPaintProperty('elm-features-line-casing', 'line-color'))).toBe('rgba(15, 23, 42, 0.5)')
    // featureColor still wins on a dark basemap.
    await open(page, `featureColor=${encodeURIComponent(TEAL)}`)
    await expect.poll(async () => (await paintColors(page, 'elm-features-fill', 'fill-color')).plain).toBe(TEAL)
  })
})

test.describe('Leaflet', () => {
  test.skip(({ engine }) => engine !== 'leaflet', 'Leaflet path styles and divIcon pins')

  type Style = { color?: string; fill: string; fillOpacity?: number; canvas: boolean }
  /**
   * Style options of each feature's visible path layer, keyed by feature id (matched by bbox centre;
   * the transparent line hit paths are skipped). Canvas and SVG both draw from these options.
   */
  const pathStyles = (page: Page) => page.evaluate(() => {
    const t = window.__elementEditorTest!
    const map = t.map as LeafletMap
    const centre = (coords: unknown) => {
      const flat = (JSON.stringify(coords).match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)
      const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1)
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    }
    const feats = t.dataStore.getState().features.map((f) => ({ id: f.id, c: centre(f.geometry) }))
    const out: Record<string, Style> = {}
    map.eachLayer((l) => {
      const p = l as Polyline & { _renderer?: { _container?: HTMLElement } }
      if (!('getLatLngs' in p) || p.options.opacity === 0.001) return
      const ll = p.getLatLngs()
      const c = centre(JSON.parse(JSON.stringify(ll, (k, v) => (v && typeof v === 'object' && 'lat' in v ? [v.lng, v.lat] : v))))
      const f = feats.find((f) => Math.abs(f.c[0] - c[0]) < 1e-9 && Math.abs(f.c[1] - c[1]) < 1e-9)
      if (!f || out[f.id]) return
      const o = p.options as Path['options'] & { fill?: boolean; fillColor?: string; fillOpacity?: number }
      out[f.id] = {
        color: o.color,
        fill: o.fill ? (o.fillColor ?? o.color!) : 'none',
        fillOpacity: o.fill ? o.fillOpacity : undefined,
        canvas: p._renderer?._container?.tagName === 'CANVAS',
      }
    })
    return out
  })
  const weightOf = (page: Page, id: string) => page.evaluate((id) => {
    const t = window.__elementEditorTest!
    const f = t.dataStore.getState().features.find((f) => f.id === id)!
    const flat = (JSON.stringify(f.geometry.coordinates).match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)
    const cx = (Math.min(...flat.filter((_, i) => i % 2 === 0)) + Math.max(...flat.filter((_, i) => i % 2 === 0))) / 2
    const cy = (Math.min(...flat.filter((_, i) => i % 2 === 1)) + Math.max(...flat.filter((_, i) => i % 2 === 1))) / 2
    let w: number | undefined
    ;(t.map as LeafletMap).eachLayer((l) => {
      const p = l as Polyline
      if (!('getLatLngs' in p) || p.options.opacity === 0.001 || w !== undefined) return
      const b = p.getBounds()
      if (Math.abs((b.getWest() + b.getEast()) / 2 - cx) < 1e-9 && Math.abs((b.getSouth() + b.getNorth()) / 2 - cy) < 1e-9) w = p.options.weight
    })
    return w
  }, id)
  const colorsOf = async (page: Page) => Object.fromEntries(Object.entries(await pathStyles(page)).map(([id, s]) => [id, [s.color, s.fill]]))

  test('canvas: a line is stroked over a light casing, an outline is not', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __strokes: [number, string][] }
      w.__strokes = []
      const stroke = CanvasRenderingContext2D.prototype.stroke
      CanvasRenderingContext2D.prototype.stroke = function (this: CanvasRenderingContext2D, ...a: [Path2D?]) {
        w.__strokes.push([this.lineWidth, String(this.strokeStyle)])
        return (stroke as (this: CanvasRenderingContext2D, ...args: [Path2D?]) => void).apply(this, a)
      }
    })
    await open(page, '')
    const strokes = () => page.evaluate(() => (window as unknown as { __strokes: [number, string][] }).__strokes)
    // Casing (line weight + 2 × 1.5, white) right before the line itself (3.5).
    await expect.poll(async () => {
      const s = await strokes()
      return s.some(([w, c], i) => w === 6.5 && c === '#ffffff' && s[i + 1]?.[0] === 3.5)
    }).toBe(true)
    // Polygon outlines (weight 2) get none.
    expect((await strokes()).some(([w, c]) => w === 5 && c === '#ffffff')).toBe(false)
  })

  test('canvas (default): colours with precedence; hover keeps them; selected takes the accent', async ({ page }) => {
    await open(page, '')
    await expect.poll(() => colorsOf(page)).toEqual({ hot: [SLATE, SLATE], plain: [SLATE, SLATE], line: [SLATE, 'none'] })

    await open(page, COLORS)
    await expect.poll(() => colorsOf(page)).toEqual({ hot: [RED, RED], plain: [TEAL, TEAL], line: [TEAL, 'none'] })
    const styles = await pathStyles(page)
    expect(Object.values(styles).every((s) => s.canvas)).toBe(true)
    expect(styles.plain.fillOpacity).toBe(0.15)

    // Hover: a milder shade of the custom colour; the fill gets denser. L.Canvas hit-tests at most one
    // mousemove per 32 ms, so keep nudging the pointer until the hover lands.
    const plain = await featureCenter(page, 'plain')
    let nudge = 0
    await expect.poll(async () => {
      await page.mouse.move(plain.x + (nudge ^= 1), plain.y)
      return (await pathStyles(page)).plain.fillOpacity
    }).toBe(0.28)
    expect((await colorsOf(page)).plain).toEqual([shade(TEAL).hovered, shade(TEAL).hovered])

    // Selected: the red polygon moves to SVG in a darker red (not the accent), with a heavier outline.
    const accent = await accent500(page)
    expect(shade(RED).selected).not.toBe(accent)
    const hot = await featureCenter(page, 'hot')
    await page.mouse.click(hot.x, hot.y)
    await expect.poll(async () => (await pathStyles(page)).hot).toMatchObject({ color: shade(RED).selected, fill: shade(RED).selected, canvas: false })
    expect(await weightOf(page, 'hot')).toBe(4.5)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await pathStyles(page)).hot).toMatchObject({ color: RED, fill: RED, canvas: true })
  })

  test('selectionStyle: auto keeps the accent for the default slate; accent / feature force a side; state style wins', async ({ page }) => {
    const select = (id: string) => page.evaluate((id) => window.__elementEditorTest!.dataStore.getState().selectFeature(id), id)
    await open(page, COLORS.replace(/featureColor=[^&]+&/, ''))
    const accent = await accent500(page)
    await select('plain')
    await expect.poll(async () => (await pathStyles(page)).plain).toMatchObject({ color: accent, canvas: false })
    await select('hot')
    await expect.poll(async () => (await pathStyles(page)).hot).toMatchObject({ color: shade(RED).selected, fill: shade(RED).selected })

    await open(page, COLORS + '&selectionStyle=accent')
    await select('hot')
    await expect.poll(async () => (await pathStyles(page)).hot).toMatchObject({ color: accent, fill: accent })
    expect(await weightOf(page, 'hot')).toBe(3)

    await open(page, 'selectionStyle=feature')
    await select('plain')
    await expect.poll(async () => (await pathStyles(page)).plain).toMatchObject({ color: shade(SLATE).selected })

    await open(page, 'featureStyle=state')
    await select('hot')
    await expect.poll(async () => (await pathStyles(page)).hot).toMatchObject({ color: '#00ff00' })
    expect(await weightOf(page, 'hot')).toBe(8)
  })

  test('vertex handles follow the feature colour (--elm-handle), the accent otherwise', async ({ page }) => {
    const handle = () => page.evaluate(() => document.querySelector<HTMLElement>('.leaflet-container')!.style.getPropertyValue('--elm-handle'))
    await open(page, COLORS.replace(/featureColor=[^&]+&/, ''))
    const edit = (id: string) => page.evaluate((id) => {
      const t = window.__elementEditorTest!
      t.dataStore.getState().selectFeature(id)
    }, id)
    await edit('hot')
    const c = await featureCenter(page, 'hot')
    await page.mouse.dblclick(c.x, c.y)
    await expect.poll(handle).toBe(shade(RED).selected)
    await page.keyboard.press('Escape')
    await expect.poll(handle).toBe('')
    await edit('plain')
    const p = await featureCenter(page, 'plain')
    await page.mouse.dblclick(p.x, p.y)
    await expect(page.locator('.elm-vertex').first()).toBeVisible()
    expect(await handle()).toBe('') // default slate: the accent
  })

  test('svg: the path attributes carry the colours', async ({ page }) => {
    await open(page, 'renderer=svg&' + COLORS)
    await page.locator('.leaflet-container').focus()
    await drawPolygon(page, { width: 60, height: 50, x: 0.55 })
    await page.keyboard.press('Escape')
    await page.mouse.move(5, 5) // not hovering the drawn polygon (hover is a shade)
    const paths = () => page.locator('.leaflet-overlay-pane path').evaluateAll((els) =>
      els.map((el) => ({ stroke: el.getAttribute('stroke'), fill: el.getAttribute('fill'), so: el.getAttribute('stroke-opacity') }))
        .filter((p) => p.so !== '0.001')) // drop the transparent line hit paths
    await expect.poll(async () => (await paths()).length).toBe(4) // 3 polygons + 1 line
    const ps = await paths()
    expect(ps.filter((p) => p.stroke === RED && p.fill === RED)).toHaveLength(1)
    expect(ps.filter((p) => p.stroke === TEAL && p.fill === TEAL)).toHaveLength(2)
    expect(ps.filter((p) => p.stroke === TEAL && p.fill === 'none')).toHaveLength(1)
    expect(ps.some((p) => p.stroke === SLATE || p.fill === SLATE)).toBe(false)
    await expect(page.locator('.leaflet-marker-pane path').first()).toHaveAttribute('style', `fill:${TEAL}`)
  })

  test('pins: hover and selected are shades of a custom colour, an uncoloured pin darkens', async ({ page }) => {
    const pin = page.locator('.leaflet-marker-pane path').first()
    const hoverPin = async () => {
      const b = (await pin.boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3, { steps: 5 })
    }
    const away = async () => {
      const m = await mapBox(page)
      await page.mouse.move(m.x + m.width * 0.6, m.y + 10, { steps: 3 })
    }

    await open(page, COLORS)
    await expect(pin).toHaveAttribute('style', `fill:${TEAL}`)
    await hoverPin()
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.leaflet-marker-pane .leaflet-marker-icon:hover').length)).toBe(1)
    await expect(pin).toHaveCSS('fill', rgb(shade(TEAL).hovered)) // a milder shade of its own colour
    await pin.click()
    await expect(pin).toHaveAttribute('style', `fill:${shade(TEAL).selected}`) // selected: a darker shade, not the accent

    await away() // the reloaded pin would mount under the cursor, already hovered
    await open(page, '')
    await expect(pin).toHaveAttribute('style', `fill:${SLATE}`)
    // The hover tint is set on the pin's own element (computed style: the inline value is re-serialised).
    await hoverPin()
    await expect(pin).toHaveCSS('fill', rgb(PIN_HOVER_SLATE))
    await away()
    await expect(pin).toHaveCSS('fill', rgb(SLATE))
  })
})
