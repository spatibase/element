/**
 * Large-dataset performance benchmark — opt-in, not part of `pnpm test:e2e`.
 *
 *   pnpm test:perf                          # both adapters
 *   pnpm test:perf --project=leaflet        # one adapter
 *   PERF_LABEL=after pnpm test:perf         # name the result set (default "run")
 *   PERF_ONLY=inspector pnpm test:perf -g mixed-5k   # load + inspector scenarios only
 *   PERF_CPU=4 pnpm test:perf               # CDP CPU throttling (4x slower)
 *
 * Leaflet runs against packages/react's bare app (:5197), MapLibre against the
 * apps/demo maplibre tab (:5199). Datasets are generated here with a seeded
 * PRNG, so nothing is committed:
 *   - mixed-5k : 5,000 features on a grid (60% polygons x 50 vertices, 25% lines x 20, 15% points)
 *   - huge-50k : 1 star-shaped polygon with 50,000 vertices (OSM-boundary-like)
 *   - lines-50k: 50,000 short lines, load + pan only (Leaflet progressive mount at scale)
 *
 * Every scenario records, in the page: rAF frame deltas (p50/p95/max), long
 * tasks via PerformanceObserver('longtask') (longest, TBT = Σ(d − 50 ms), count)
 * and wall time. mixed-5k also covers the layers panel (list-scroll,
 * list-select = row clicks + Cmd-clicks, list-reveal = programmatic selection
 * scrolled into view). Results go to e2e/perf/results/<label>-<adapter>.json plus a
 * combined <label>.md (results/ is gitignored).
 *
 * host-5k (both adapters on packages/react's bare app, `?host=inline`): the host
 * passes inline `config` / `tools` and re-renders 20x (host-rerender), then the
 * layers panel is drag-resized (panel-resize). `renderMs` / `commits` are the
 * editor subtree's React Profiler totals, i.e. how much React work each causes.
 *
 * Basemap tiles are stubbed with a 1x1 PNG so the network never shows up in the numbers.
 */
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

type Adapter = 'leaflet' | 'maplibre'
type LngLat = [number, number]
type Feature = { type: 'Feature'; id: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }

const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'results')
const LABEL = process.env.PERF_LABEL || 'run'

// ─── Deterministic datasets ─────────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

const GRID = 71
const CELL = 0.2
const ORIGIN: LngLat = [5, 44]
const MIXED_BOUNDS = [ORIGIN[0], ORIGIN[1], ORIGIN[0] + GRID * CELL, ORIGIN[1] + GRID * CELL] as const

function mixed5k() {
  const rnd = mulberry32(42)
  const features: Feature[] = []
  const polygonCenters: { id: string; c: LngLat }[] = []
  for (let i = 0; i < 5000; i++) {
    const cx = ORIGIN[0] + ((i % GRID) + 0.5) * CELL
    const cy = ORIGIN[1] + (Math.floor(i / GRID) + 0.5) * CELL
    const kind = rnd()
    let geometry: Feature['geometry']
    if (kind < 0.6) {
      const ring: LngLat[] = []
      const r = 0.055 + rnd() * 0.015
      for (let k = 0; k < 50; k++) {
        const a = (k / 50) * Math.PI * 2
        const rr = r * (0.85 + 0.15 * rnd())
        ring.push([r6(cx + Math.cos(a) * rr), r6(cy + Math.sin(a) * rr)])
      }
      ring.push(ring[0])
      geometry = { type: 'Polygon', coordinates: [ring] }
      polygonCenters.push({ id: `f${i}`, c: [cx, cy] })
    } else if (kind < 0.85) {
      const line: LngLat[] = []
      for (let k = 0; k < 20; k++) line.push([r6(cx - 0.08 + (k / 19) * 0.16), r6(cy + (rnd() - 0.5) * 0.1)])
      geometry = { type: 'LineString', coordinates: line }
    } else {
      geometry = { type: 'Point', coordinates: [r6(cx), r6(cy)] }
    }
    features.push({ type: 'Feature', id: `f${i}`, geometry, properties: { name: `Feature ${i}`, kind: geometry.type, value: Math.round(rnd() * 1000) } })
  }
  // Polygon closest to the dataset centre — the click/drag target.
  const mid: LngLat = [(MIXED_BOUNDS[0] + MIXED_BOUNDS[2]) / 2, (MIXED_BOUNDS[1] + MIXED_BOUNDS[3]) / 2]
  const target = polygonCenters.reduce((best, p) =>
    Math.hypot(p.c[0] - mid[0], p.c[1] - mid[1]) < Math.hypot(best.c[0] - mid[0], best.c[1] - mid[1]) ? p : best)
  return { fc: { type: 'FeatureCollection', features }, target }
}

/** 50,000 short 4-vertex lines on a 224x224 grid (canvas paths): progressive mount at scale. */
function lines50k() {
  const G = 224, C = 0.05
  const features: Feature[] = []
  for (let i = 0; i < 50_000; i++) {
    const x = ORIGIN[0] + (i % G) * C, y = ORIGIN[1] + Math.floor(i / G) * C
    features.push({ type: 'Feature', id: `l${i}`, geometry: { type: 'LineString', coordinates: [[x, y], [r6(x + C * 0.3), r6(y + C * 0.3)], [r6(x + C * 0.6), y], [r6(x + C * 0.8), r6(y + C * 0.2)]] }, properties: { name: `Line ${i}` } })
  }
  return { fc: { type: 'FeatureCollection', features }, bounds: [ORIGIN[0], ORIGIN[1], ORIGIN[0] + G * C, ORIGIN[1] + G * C] as const }
}

const HUGE_CENTER: LngLat = [2.5, 46.5]
function huge50k() {
  const rnd = mulberry32(7)
  const N = 50_000
  const ring: LngLat[] = []
  for (let k = 0; k < N; k++) {
    const t = (k / N) * Math.PI * 2
    // Star-shaped (radius > 0 for every angle) → never self-intersects.
    const r = 4 * (1 + 0.08 * Math.sin(7 * t) + 0.04 * Math.sin(23 * t) + 0.01 * Math.sin(331 * t) + 0.004 * (rnd() - 0.5))
    ring.push([r6(HUGE_CENTER[0] + Math.cos(t) * r * 1.45), r6(HUGE_CENTER[1] + Math.sin(t) * r)])
  }
  ring.push(ring[0])
  return {
    fc: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'huge', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { name: 'Huge boundary' } }] },
  }
}

// ─── In-page harness ────────────────────────────────────────────────────────

/** Installed before any page script: frame recorder, long-task observer, adapter-neutral map helpers. */
function installHarness() {
  const w = window as unknown as Record<string, unknown>
  const longTasks: [number, number][] = []
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push([e.startTime, e.duration]) })
      .observe({ type: 'longtask', buffered: true })
  } catch { /* unsupported */ }
  let frames: number[] | null = null
  let last = 0
  let t0 = 0
  let gen = 0 // a begin() right after end() must not leave the old rAF loop running too
  const loop = (g: number) => (t: number) => {
    if (!frames || g !== gen) return
    frames.push(Math.max(0, t - last)); last = Math.max(last, t); requestAnimationFrame(loop(g))
  }
  const twoFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  w.__perf = {
    begin() { frames = []; t0 = performance.now(); last = t0; requestAnimationFrame(loop(++gen)) },
    end() {
      const t1 = performance.now()
      const f = frames ?? []
      f.push(t1 - last) // trailing gap (a task still blocking at the end)
      frames = null
      return { durationMs: t1 - t0, frames: f, tasks: longTasks.filter(([s, d]) => s + d > t0 && s < t1) }
    },
  }
  type AnyMap = Record<string, (...a: unknown[]) => unknown> & { getCanvas?: () => HTMLCanvasElement }
  const map = () => (w.__elementEditorTest as { map: AnyMap }).map
  const ml = () => typeof map().getCanvas === 'function'
  w.__bench = {
    twoFrames,
    ready: () => !!(w.__elementEditorTest as { map?: unknown } | undefined)?.map,
    ml,
    fit(wst: number, s: number, e: number, n: number) {
      if (ml()) map().fitBounds([[wst, s], [e, n]], { animate: false, padding: 20 })
      else map().fitBounds([[s, wst], [n, e]], { animate: false, padding: [20, 20] })
    },
    /** `z` is a Leaflet (256 px tile) zoom; MapLibre's 512 px tiles are one level lower. */
    view(lng: number, lat: number, z: number) {
      if (ml()) map().jumpTo({ center: [lng, lat], zoom: z - 1 })
      else map().setView([lat, lng], z, { animate: false })
    },
    zoom: () => (map().getZoom() as number) + (ml() ? 1 : 0),
    pt(lng: number, lat: number) {
      const m = map()
      const p = (ml() ? m.project([lng, lat]) : m.latLngToContainerPoint([lat, lng])) as { x: number; y: number }
      const rect = (ml() ? m.getCanvas!() : (m.getContainer() as HTMLElement)).getBoundingClientRect()
      return { x: rect.left + p.x, y: rect.top + p.y }
    },
    center() {
      const rect = (ml() ? map().getCanvas!() : (map().getContainer() as HTMLElement)).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    },
    panBy(dx: number, dy: number) {
      if (ml()) map().panBy([dx, dy], { duration: 0 })
      else map().panBy([dx, dy], { animate: false })
    },
    zoomTo(z: number) {
      return new Promise<void>((r) => {
        const m = map()
        const t = setTimeout(r, 3000)
        if (ml()) { m.once('moveend', () => { clearTimeout(t); r() }); m.zoomTo(z - 1, { duration: 250 }) }
        else { m.once('zoomend', () => { clearTimeout(t); r() }); m.setZoom(z) }
      })
    },
    /** Leaflet: two frames. MapLibre: two frames + the map's `idle` (worker tiling + render done). */
    async idle() {
      await twoFrames()
      if (!ml()) return
      const m = map()
      await new Promise<void>((r) => {
        const t = setTimeout(r, 5000)
        m.once('idle', () => { clearTimeout(t); r() })
        m.triggerRepaint()
      })
    },
    domCounts: () => ({ paths: document.querySelectorAll('.leaflet-pane path').length, markers: document.querySelectorAll('.leaflet-marker-icon, .maplibregl-marker').length, dom: document.querySelectorAll('*').length }),
  }
}

type Raw = { durationMs: number; frames: number[]; tasks: [number, number][] }
type Row = {
  dataset: string; scenario: string; wallMs: number; p50: number; p95: number; maxFrame: number
  longestTask: number; tbt: number; longTasks: number; extra?: Record<string, unknown>
}

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
}
const r1 = (n: number) => Math.round(n * 10) / 10

function summarize(dataset: string, scenario: string, raw: Raw, extra?: Record<string, unknown>): Row {
  const f = [...raw.frames].sort((a, b) => a - b)
  return {
    dataset, scenario,
    wallMs: r1(raw.durationMs),
    p50: r1(pct(f, 0.5)), p95: r1(pct(f, 0.95)), maxFrame: r1(f[f.length - 1] ?? 0),
    longestTask: r1(Math.max(0, ...raw.tasks.map((t) => t[1]))),
    tbt: r1(raw.tasks.reduce((s, t) => s + Math.max(0, t[1] - 50), 0)),
    longTasks: raw.tasks.length,
    extra,
  }
}

async function measure(page: Page, dataset: string, scenario: string, fn: () => Promise<Record<string, unknown> | void>, settleMs = 500): Promise<Row> {
  // PERF_PROFILE=load (or mixed-5k/load, comma-separated for several) writes a
  // Chrome .cpuprofile for that scenario to results/.
  const wanted = (process.env.PERF_PROFILE ?? '').split(',').filter(Boolean)
  const profile = wanted.includes(scenario) || wanted.includes(`${dataset}/${scenario}`)
  const cdp = profile ? await page.context().newCDPSession(page) : null
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
  await page.evaluate(() => (window as any).__perf.begin())
  const extra = (await fn()) ?? undefined
  await page.waitForTimeout(settleMs) // lets late tasks finish + the longtask observer deliver
  const raw = (await page.evaluate(() => (window as any).__perf.end())) as Raw
  if (cdp) {
    const { profile: prof } = await cdp.send('Profiler.stop')
    mkdirSync(RESULTS_DIR, { recursive: true })
    writeFileSync(resolve(RESULTS_DIR, `${LABEL}-${test.info().project.name}-${dataset}-${scenario}.cpuprofile`), JSON.stringify(prof))
  }
  const row = summarize(dataset, scenario, raw, extra)
  console.log(`[perf] ${dataset.padEnd(9)} ${scenario.padEnd(14)} wall ${row.wallMs}ms  p50 ${row.p50}  p95 ${row.p95}  max ${row.maxFrame}  longest ${row.longestTask}  TBT ${row.tbt}${extra ? '  ' + JSON.stringify(extra) : ''}`)
  return row
}

// ─── Results ────────────────────────────────────────────────────────────────

function saveRows(adapter: Adapter, rows: Row[]) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const file = resolve(RESULTS_DIR, `${LABEL}-${adapter}.json`)
  const prev: Row[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')).rows : []
  const keep = prev.filter((p) => !rows.some((r) => r.dataset === p.dataset && r.scenario === p.scenario))
  writeFileSync(file, JSON.stringify({ label: LABEL, adapter, date: new Date().toISOString(), rows: [...keep, ...rows] }, null, 2))
  // Combined markdown for this label (whichever adapters have run).
  let md = `# Perf benchmark — ${LABEL}\n\n${new Date().toISOString()}\n\nFrame times / tasks in ms. TBT = Σ(long task − 50 ms).\n`
  for (const a of ['leaflet', 'maplibre'] as Adapter[]) {
    const f = resolve(RESULTS_DIR, `${LABEL}-${a}.json`)
    if (!existsSync(f)) continue
    md += `\n## ${a}\n\n| dataset | scenario | wall | p50 | p95 | max frame | longest task | TBT | long tasks | notes |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---|\n`
    for (const r of JSON.parse(readFileSync(f, 'utf-8')).rows as Row[]) {
      md += `| ${r.dataset} | ${r.scenario} | ${r.wallMs} | ${r.p50} | ${r.p95} | ${r.maxFrame} | ${r.longestTask} | ${r.tbt} | ${r.longTasks} | ${r.extra ? JSON.stringify(r.extra).replace(/\|/g, '/') : ''} |\n`
    }
  }
  writeFileSync(resolve(RESULTS_DIR, `${LABEL}.md`), md)
}

// ─── Page setup ─────────────────────────────────────────────────────────────

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function open(page: Page, adapter: Adapter, url?: string) {
  await page.addInitScript(installHarness)
  await page.route((u) => u.hostname !== 'localhost' && /\.(png|jpe?g|webp)$/.test(u.pathname), (r) => r.fulfill({ contentType: 'image/png', body: PNG_1x1 }))
  // PERF_CPU=4 → CDP CPU throttling (4x slower), to check slow machines.
  if (process.env.PERF_CPU) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_CPU) })
  await page.goto(url ?? '/')
  if (adapter === 'maplibre') {
    if (!url) await page.getByRole('button', { name: '@element-editor/adapter-maplibre' }).click()
    await page.waitForSelector('.maplibregl-canvas')
    await page.waitForFunction(() => (window as any).__bench.ready() && (window as any).__bench.ml())
    await page.locator('.maplibregl-canvas').first().focus()
  } else {
    await page.waitForSelector('.leaflet-container')
    await page.waitForFunction(() => (window as any).__bench.ready())
  }
  await page.waitForTimeout(800)
}

async function load(page: Page, dataset: string, fc: unknown, fit: readonly [number, number, number, number]) {
  await page.evaluate(([w, s, e, n]) => (window as any).__bench.fit(w, s, e, n), fit)
  await page.evaluate((json) => { (window as any).__fcJson = json }, JSON.stringify(fc))
  return measure(page, dataset, 'load', async () => page.evaluate(async () => {
    const w = window as any
    const t0 = performance.now()
    const parsed = JSON.parse(w.__fcJson)
    const t1 = performance.now()
    w.__elementEditorTest.dataStore.getState().importGeoJSON(parsed, 'replace')
    const t2 = performance.now()
    await w.__bench.idle()
    const t3 = performance.now()
    delete w.__fcJson
    const counts = w.__bench.domCounts()
    // Leaflet mounts big batches progressively: wait until the map's layer count
    // has been stable for 30 frames (60 s cap) and report when it last changed.
    let mountedMs = Math.round(t3 - t0)
    if (!w.__bench.ml()) {
      const layers = () => Object.keys(w.__elementEditorTest.map._layers).length
      let n = layers(), stable = 0
      while (stable < 30 && performance.now() - t0 < 60_000) {
        await new Promise((r) => requestAnimationFrame(r))
        const m = layers()
        if (m !== n) { n = m; stable = 0; mountedMs = Math.round(performance.now() - t0) } else stable++
      }
    }
    return { parseMs: Math.round(t1 - t0), importCallMs: Math.round(t2 - t1), toPaintMs: Math.round(t3 - t0), mountedMs, ...counts }
  }), 1000)
}

async function pan(page: Page, dataset: string) {
  return measure(page, dataset, 'pan', async () => page.evaluate(async () => {
    const b = (window as any).__bench
    for (let i = 0; i < 60; i++) { b.panBy(i < 30 ? 15 : -15, 0); await new Promise((r) => requestAnimationFrame(r)) }
    await b.idle()
  }))
}

async function zoom(page: Page, dataset: string) {
  return measure(page, dataset, 'zoom', async () => page.evaluate(async () => {
    const b = (window as any).__bench
    const z = Math.round(b.zoom())
    for (let i = 0; i < 2; i++) { await b.zoomTo(z + 1); await b.idle(); await b.zoomTo(z); await b.idle() }
  }))
}

/** The host re-renders 10× with a fresh inline `config` object (equal values), all features mounted. */
async function hostRerender(page: Page, dataset: string) {
  return measure(page, dataset, 'host-rerender', async () => page.evaluate(async () => {
    const w = window as any
    if (!w.__rerenderHost) return { skipped: true } // the apps/demo host has no hook
    for (let i = 0; i < 10; i++) { w.__rerenderHost(); await w.__bench.twoFrames() }
    await w.__bench.idle()
  }))
}

async function clickSelect(page: Page, dataset: string, id: string, at: LngLat) {
  const p = await page.evaluate(([lng, lat]) => (window as any).__bench.pt(lng, lat), at)
  return measure(page, dataset, 'click-select', async () => {
    await page.mouse.click(p.x, p.y)
    await page.waitForFunction((fid) => (window as any).__elementEditorTest.dataStore.getState().selectedIds.includes(fid), id, { timeout: 15000 })
    await page.evaluate(() => (window as any).__bench.idle())
  })
}

function firstCoord(page: Page, id: string) {
  return page.evaluate((fid) => {
    const f = (window as any).__elementEditorTest.dataStore.getState().features.find((x: any) => x.id === fid)
    return JSON.stringify(f.geometry.coordinates[0][0])
  }, id)
}

async function dragSelected(page: Page, dataset: string, id: string, at: LngLat) {
  const p = await page.evaluate(([lng, lat]) => (window as any).__bench.pt(lng, lat), at)
  const before = await firstCoord(page, id)
  const row = await measure(page, dataset, 'drag', async () => {
    await page.mouse.move(p.x, p.y)
    await page.keyboard.down('Meta')
    await page.mouse.down()
    await page.mouse.move(p.x + 120, p.y + 40, { steps: 40 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    await page.evaluate(() => (window as any).__bench.idle())
  })
  row.extra = { moved: before !== (await firstCoord(page, id)) }
  return row
}

async function boxSelect(page: Page, dataset: string) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const c = await page.evaluate(() => (window as any).__bench.center())
  // Start on a grid-cell boundary (no feature under the pointer).
  const row = await measure(page, dataset, 'box-select', async () => {
    await page.keyboard.down('Shift')
    await page.mouse.move(c.x - 250, c.y - 160)
    await page.mouse.down()
    await page.mouse.move(c.x + 250, c.y + 160, { steps: 30 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.evaluate(() => (window as any).__bench.idle())
  })
  row.extra = { selected: await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().selectedIds.length) }
  await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().clearSelection())
  return row
}

/** The layers panel's scroll container (the virtualiser's scroll element). */
const LIST_SCROLLER = 'aside .overflow-y-auto'

async function listScroll(page: Page, dataset: string) {
  await page.locator(LIST_SCROLLER).first().waitFor({ state: 'visible' })
  return measure(page, dataset, 'list-scroll', async () => page.evaluate(async (sel) => {
    const el = document.querySelector(sel) as HTMLElement
    for (let i = 0; i < 60; i++) { el.scrollTop += 400; await new Promise((r) => requestAnimationFrame(r)) }
    const scrollTop = el.scrollTop
    for (let i = 0; i < 30; i++) { el.scrollTop -= 800; await new Promise((r) => requestAnimationFrame(r)) }
    await (window as any).__bench.twoFrames()
    return { scrollTop, rows: document.querySelectorAll('aside [data-feature-id]').length }
  }, LIST_SCROLLER))
}

/** Click 10 visible rows in turn (select + map fit), then Cmd-click 10 more (multi-select). */
async function listSelect(page: Page, dataset: string) {
  await page.evaluate((sel) => { (document.querySelector(sel) as HTMLElement).scrollTop = 0 }, LIST_SCROLLER)
  await page.evaluate(() => (window as any).__bench.twoFrames())
  const rows = page.locator('aside [data-feature-id]')
  const ids = await rows.evaluateAll((els) => els.slice(0, 20).map((e) => (e as HTMLElement).dataset.featureId!))
  const row = await measure(page, dataset, 'list-select', async () => {
    for (let i = 0; i < ids.length; i++) {
      const r = page.locator(`aside [data-feature-id="${ids[i]}"]`)
      if (i < 10) await r.click({ position: { x: 10, y: 10 } })
      else await r.click({ position: { x: 10, y: 10 }, modifiers: ['Meta'] })
      await page.evaluate(() => (window as any).__bench.twoFrames())
    }
    await page.evaluate(() => (window as any).__bench.idle())
  })
  row.extra = { selected: await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().selectedIds.length) }
  // Programmatic selection far down the list → scroll-into-view of the row.
  const reveal = await measure(page, dataset, 'list-reveal', async () => page.evaluate(async () => {
    const w = window as any
    const s = w.__elementEditorTest.dataStore.getState()
    for (const id of ['f4999', 'f10', 'f2500', 'f4000']) {
      s.setSelection([id])
      await new Promise((r) => setTimeout(r, 400)) // smooth scroll
    }
    await w.__bench.twoFrames()
    return { rowVisible: !!document.querySelector('aside [data-feature-id="f4000"]') }
  }))
  await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().clearSelection())
  return [row, reveal]
}

async function table(page: Page, dataset: string) {
  const openRow = await measure(page, dataset, 'table-open', async () => {
    await page.evaluate(() => (window as any).__elementEditorTest.uiStore.getState().toggleTable())
    await page.locator('[role="grid"]').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.evaluate(() => (window as any).__bench.twoFrames())
  })
  const scrollRow = await measure(page, dataset, 'table-scroll', async () => page.evaluate(async () => {
    const g = document.querySelector('[role="grid"]') as HTMLElement
    for (let i = 0; i < 60; i++) { g.scrollTop += 400; await new Promise((r) => requestAnimationFrame(r)) }
    return { scrollTop: g.scrollTop }
  }))
  await page.evaluate(() => (window as any).__elementEditorTest.uiStore.getState().toggleTable())
  await page.waitForTimeout(400)
  return [openRow, scrollRow]
}

/**
 * Opens the inspector, waits for the full document (the modal sets data-loading
 * while it fills), then — with it still open — commits `edits` geometry changes
 * to `id` one frame apart, like a drag or a series of nudges.
 */
async function inspector(page: Page, dataset: string, id: string) {
  const dialog = page.locator('[role="dialog"][aria-label="GeoJSON inspector"]')
  const openRow = await measure(page, dataset, 'inspector-open', async () => {
    // Timed inside the page with a MutationObserver: Playwright's waitFor polls
    // with a backoff (0/20/50/100/…/500 ms), which alone added a constant
    // ~800 ms to these numbers regardless of dataset size.
    return page.evaluate(() => new Promise<{ shellMs: number; filledMs: number }>((resolve, reject) => {
      const t0 = performance.now()
      let shell = -1
      const sel = '[role="dialog"][aria-label="GeoJSON inspector"]'
      const check = () => {
        const now = performance.now()
        if (shell < 0 && document.querySelector('.cm-content')) shell = now - t0
        const d = document.querySelector(sel)
        if (shell >= 0 && d && !d.hasAttribute('data-loading')) {
          mo.disconnect(); clearTimeout(timer)
          resolve({ shellMs: Math.round(shell), filledMs: Math.round(now - t0) })
        }
      }
      const mo = new MutationObserver(check)
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-loading'] })
      const timer = setTimeout(() => { mo.disconnect(); reject(new Error('inspector did not fill in 30 s')) }, 30000)
      ;(window as any).__elementEditorTest.uiStore.getState().toggleCodeModal()
      check()
    }))
  }, 1000)
  await expect(dialog).toBeVisible()
  // Settle 1.5 s: covers the editor's 600 ms text → store debounce.
  const editRow = await measure(page, dataset, 'inspector-edit', async () => page.evaluate(async (fid) => {
    const w = window as any
    const ds = w.__elementEditorTest.dataStore
    const shift = (c: unknown): unknown => Array.isArray(c) && typeof c[0] === 'number' ? [c[0] + 0.001, c[1]] : (c as unknown[]).map(shift)
    for (let i = 0; i < 10; i++) {
      const f = ds.getState().features.find((x: any) => x.id === fid)
      ds.getState().updateFeature(fid, { geometry: { ...f.geometry, coordinates: shift(f.geometry.coordinates) } })
      await w.__bench.twoFrames()
    }
    return { undo: ds.getState().undoStack.length }
  }, id), 1500)
  // Typing needs the name line rendered: a Point mid-collection (a polygon's name sits ~200 lines down).
  const typeRows = dataset === 'mixed-5k' ? [await inspectorType(page, dataset), await inspectorSpanType(page, dataset)] : []
  await page.evaluate(() => (window as any).__elementEditorTest.uiStore.getState().toggleCodeModal())
  await page.waitForTimeout(400)
  return [openRow, editRow, ...typeRows]
}

/**
 * An edit across the separator of two features (`},\n    {` → `}, {`: still
 * two features, out of the per-feature layout), then 8 keystrokes into a later
 * feature's name, each followed by a pause past the commit debounce. Before the
 * fix the first commit dropped the inspector's per-feature map and every pause
 * after it re-parsed the whole document. `commits` counts store commits.
 */
async function inspectorSpanType(page: Page, dataset: string) {
  return measure(page, dataset, 'inspector-span-type', () => page.evaluate(async () => {
    const w = window as any
    const ds = w.__elementEditorTest.dataStore
    const view = (document.querySelector('.cm-content') as any).cmTile.view
    const fs = ds.getState().features
    const doc = view.state.doc
    const text: string = doc.toString()
    const at = text.indexOf(`"id": "${fs[3001].id}"`)
    const sep = text.lastIndexOf('    },\n    {', at) + 4
    let commits = 0
    const unsub = ds.subscribe((s: any, p: any) => { if (s.features !== p.features) commits++ })
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
    view.dispatch({ changes: { from: sep, to: sep + '},\n    {'.length, insert: '}, {' }, userEvent: 'input' })
    await pause(400)
    const t = view.state.doc.toString()
    const name = t.indexOf('"name": "', t.indexOf(`"id": "${fs[3010].id}"`)) + '"name": "'.length
    for (let i = 0; i < 8; i++) {
      view.dispatch({ changes: { from: name, insert: 'x' }, userEvent: 'input.type' })
      await pause(250)
    }
    unsub()
    return { docMB: Math.round(doc.length / 1e5) / 10, commits, name: ds.getState().features[3010].properties.name.slice(0, 8) }
  }), 800)
}

/**
 * Types into a mid-collection Point's `"name"` value in the open inspector and times the
 * commit after the editor's 600 ms debounce, in the page: last keyup → store
 * change (commitMs, includes the debounce) and store change → next frame
 * (frameMs). `changed` counts features whose object reference changed.
 */
async function inspectorType(page: Page, dataset: string) {
  const id = await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().features.find((f: any, i: number) => i >= 2500 && f.geometry.type === 'Point').id as string)
  await page.evaluate((fid) => (window as any).__elementEditorTest.dataStore.getState().selectFeature(fid), id)
  const line = page.locator('.cm-line.cm-feature-highlight', { hasText: '"name": "' }).first()
  await line.waitFor({ timeout: 10000 })
  await line.click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft') // before the closing quote (the line ends `",`)
  const row = await measure(page, dataset, 'inspector-type', async () => {
    await page.evaluate(() => {
      const w = window as any
      const ds = w.__elementEditorTest.dataStore
      const before = ds.getState().features
      w.__typeDone = new Promise((resolve) => {
        let last = performance.now()
        const onKey = () => { last = performance.now() }
        document.addEventListener('keyup', onKey, true)
        const unsub = ds.subscribe((s: any) => {
          if (s.features === before) return
          const t = performance.now()
          unsub(); document.removeEventListener('keyup', onKey, true)
          const changed = s.features.filter((f: unknown, i: number) => f !== before[i]).length
          requestAnimationFrame(() => resolve({ commitMs: Math.round(t - last), frameMs: Math.round(performance.now() - t), changed, undo: s.undoStack.length }))
        })
      })
    })
    await page.keyboard.type(' typed', { delay: 40 })
    return page.evaluate(() => (window as any).__typeDone)
  }, 800)
  const name = await page.evaluate((fid) => (window as any).__elementEditorTest.dataStore.getState().features.find((f: any) => f.id === fid).properties.name, id)
  expect(name).toMatch(/ typed$/)
  await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().clearSelection())
  return row
}

// ─── Tests ──────────────────────────────────────────────────────────────────

/** PERF_ONLY=inspector: mixed-5k runs just load + the inspector scenarios (quick iteration). */
const ONLY_INSPECTOR = process.env.PERF_ONLY === 'inspector'

const adapterOf = (name: string): Adapter => (name === 'maplibre' ? 'maplibre' : 'leaflet')

test('mixed-5k', async ({ page }, info) => {
  const adapter = adapterOf(info.project.name)
  const { fc, target } = mixed5k()
  await open(page, adapter)
  const rows: Row[] = []
  try {
  rows.push(await load(page, 'mixed-5k', fc, MIXED_BOUNDS))
  expect(await page.evaluate(() => (window as any).__elementEditorTest.dataStore.getState().features.length)).toBe(5000)
  if (!ONLY_INSPECTOR) {
  rows.push(await pan(page, 'mixed-5k'))
  rows.push(await zoom(page, 'mixed-5k'))
  rows.push(await hostRerender(page, 'mixed-5k'))
  }
  // Zoom 8 (Leaflet scale) on the target: polygons ~25x40 px, ~2k features in the padded view.
  await page.evaluate(([lng, lat]) => (window as any).__bench.view(lng, lat, 8), target.c)
  await page.evaluate(() => (window as any).__bench.idle())
  await page.waitForTimeout(500)
  if (!ONLY_INSPECTOR) {
  rows.push(await clickSelect(page, 'mixed-5k', target.id, target.c))
  rows.push(await dragSelected(page, 'mixed-5k', target.id, target.c))
  rows.push(await boxSelect(page, 'mixed-5k'))
  rows.push(await listScroll(page, 'mixed-5k'))
  rows.push(...(await listSelect(page, 'mixed-5k')))
  rows.push(...(await table(page, 'mixed-5k')))
  }
  rows.push(...(await inspector(page, 'mixed-5k', target.id)))
  } finally { saveRows(adapter, rows) }
})

test('lines-50k', async ({ page }, info) => {
  const adapter = adapterOf(info.project.name)
  const { fc, bounds } = lines50k()
  await open(page, adapter)
  const rows: Row[] = []
  try {
  rows.push(await load(page, 'lines-50k', fc, bounds))
  rows.push(await pan(page, 'lines-50k'))
  } finally { saveRows(adapter, rows) }
})

test('huge-50k', async ({ page }, info) => {
  const adapter = adapterOf(info.project.name)
  const { fc } = huge50k()
  await open(page, adapter)
  const fit = [HUGE_CENTER[0] - 6.5, HUGE_CENTER[1] - 4.8, HUGE_CENTER[0] + 6.5, HUGE_CENTER[1] + 4.8] as const
  const rows: Row[] = []
  try {
  rows.push(await load(page, 'huge-50k', fc, fit))
  rows.push(await pan(page, 'huge-50k'))
  rows.push(await zoom(page, 'huge-50k'))
  rows.push(await clickSelect(page, 'huge-50k', 'huge', HUGE_CENTER))
  rows.push(await measure(page, 'huge-50k', 'vertex-enter', async () => {
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => (window as any).__elementEditorTest.uiStore.getState().vertexEditActive, null, { timeout: 15000 })
    await page.evaluate(() => (window as any).__bench.idle())
  }, 800))
  // Drag the rendered vertex marker closest to the top of the map.
  const sel = adapter === 'maplibre' ? '.maplibregl-marker[data-elm-selected]' : '.elm-vertex'
  const v = await page.evaluate((s) => {
    const els = [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
    const r = els.sort((a, b) => a.top - b.top)[0]
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, count: els.length } : null
  }, sel)
  expect(v, 'a vertex marker is rendered').not.toBeNull()
  const before = await firstCoord(page, 'huge')
  const before2 = await page.evaluate(() => JSON.stringify((window as any).__elementEditorTest.dataStore.getState().features[0].geometry))
  const dragRow = await measure(page, 'huge-50k', 'vertex-drag', async () => {
    await page.mouse.move(v!.x, v!.y)
    await page.mouse.down()
    await page.mouse.move(v!.x + 30, v!.y - 40, { steps: 40 })
    await page.mouse.up()
    await page.evaluate(() => (window as any).__bench.idle())
  }, 800)
  const after2 = await page.evaluate(() => JSON.stringify((window as any).__elementEditorTest.dataStore.getState().features[0].geometry))
  dragRow.extra = { markers: v!.count, changed: before2 !== after2 || before !== (await firstCoord(page, 'huge')) }
  rows.push(dragRow)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  rows.push(...(await inspector(page, 'huge-50k', 'huge')))
  } finally { saveRows(adapter, rows) }
})

/** Editor React work (Profiler) during `fn`. */
async function profiled(page: Page, fn: () => Promise<void>) {
  await page.evaluate(() => { const h = (window as any).__hostRender; h.commits = 0; h.ms = 0 })
  await fn()
  await page.evaluate(() => (window as any).__bench.twoFrames())
  return page.evaluate(() => { const h = (window as any).__hostRender; return { commits: h.commits, renderMs: Math.round(h.ms) } })
}

test('host-5k', async ({ page }, info) => {
  const adapter = adapterOf(info.project.name)
  const { fc, target } = mixed5k()
  const lib = `http://localhost:${process.env.PERF_PORT ?? 5197}/?host=inline${adapter === 'maplibre' ? '&engine=maplibre' : ''}`
  await open(page, adapter, lib)
  const rows: Row[] = []
  try {
  rows.push(await load(page, 'host-5k', fc, MIXED_BOUNDS))
  await page.evaluate(([lng, lat]) => (window as any).__bench.view(lng, lat, 8), target.c)
  await page.evaluate(() => (window as any).__bench.idle())
  await page.waitForTimeout(500)
  // Like onChange={setState}: the host re-renders with fresh inline props (nothing really changed).
  rows.push(await measure(page, 'host-5k', 'host-rerender', () => profiled(page, () => page.evaluate(async () => {
    for (let i = 0; i < 20; i++) { (window as any).__rerenderHost(); await (window as any).__bench.twoFrames() }
  }))))
  const h = await page.locator('[title="Drag to resize panel"]').boundingBox()
  expect(h, 'layers panel resize handle').not.toBeNull()
  const x = h!.x + h!.width / 2, y = h!.y + h!.height / 2
  rows.push(await measure(page, 'host-5k', 'panel-resize', () => profiled(page, async () => {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 150, y, { steps: 40 })
    await page.mouse.up()
  })))
  } finally { saveRows(adapter, rows) }
})
