/**
 * Shared Playwright fixtures for the react dev page (`src/App.tsx`).
 *
 * - `engine` option ('leaflet' | 'maplibre', set per project in playwright.config.ts).
 * - `page`: `goto` appends `engine=<engine>` to the dev-page URL (unless the URL already names an
 *   engine), and tile hosts are answered offline (raster PNGs get a transparent pixel, the rest abort).
 * - Global `Window` typings for the dev-only test hooks, so `page.evaluate(() => window.__elementEditorTest!...)`
 *   type-checks against the real store / map types instead of per-file `Win` casts.
 *
 * Mark engine-specific specs with `test.skip(({ engine }) => engine !== 'leaflet', 'why')` at file or
 * describe level (or `test.skip(engine !== 'leaflet', 'why')` inside a test).
 */
import { test as base, expect, type Page, type Locator } from '@playwright/test'
import type { Map as LeafletMap } from 'leaflet'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { createDataStore, createUIStore } from '@element-editor/core'
import type { ElementEditorRef } from '../src/index'

export type Engine = 'leaflet' | 'maplibre'

export type TestHook = {
  dataStore: ReturnType<typeof createDataStore>
  uiStore: ReturnType<typeof createUIStore>
  /** Leaflet `L.Map` or MapLibre `maplibregl.Map`, depending on the engine. */
  map: LeafletMap | MapLibreMap
}

declare global {
  interface Window {
    __elementEditorTest?: TestHook
    __elementEditorRef?: ElementEditorRef
    /** Leaflet drop-in only (react/src/leaflet/MapView.tsx). */
    __leafletMap?: LeafletMap
  }
}

/** Basemap / tile hosts the dev pages touch. Never hit them from tests. */
export const OFFLINE = /tile\.openstreetmap\.org|tiles\.openfreemap\.org|tiles\.mapterhorn\.com|\.example\.test/
/** The map container on either engine. */
export const MAP = ':is(.leaflet-container, .maplibregl-map)'
/** The map's attribution control on either engine (it moves into the status bar with `'attribution'`). */
export const ATTRIBUTION = ':is(.leaflet-control-attribution, .maplibregl-ctrl-attrib)'
/** The on-map compact attribution toggle on either engine. */
export const ATTRIBUTION_TOGGLE = ':is(.elm-attribution-toggle, .maplibregl-ctrl-attrib-button)'

// 1×1 transparent PNG: raster tiles "load" so Leaflet/MapLibre log no errors.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Append `engine=` to a dev-page URL unless it already picks one. */
export function withEngine(url: string, engine: Engine): string {
  if (/[?&]engine=/.test(url) || /^https?:/.test(url)) return url
  return url + (url.includes('?') ? '&' : '?') + 'engine=' + engine
}

export const test = base.extend<{ engine: Engine }>({
  engine: ['leaflet', { option: true }],
  page: async ({ page, engine }, use) => {
    await page.route(OFFLINE, (r) =>
      /\.png(\?|$)/.test(r.request().url())
        ? r.fulfill({ contentType: 'image/png', body: PIXEL })
        : r.abort(),
    )
    // Most specs were written when tools returned to select after each shape.
    // Keep that for them (a stored choice wins, like a real user's); the new
    // stay-in-tool default is covered by `editor-defaults.spec.ts`.
    await page.addInitScript(() => {
      try { if (localStorage.getItem('elm_autoExitAfterDraw') === null) localStorage.setItem('elm_autoExitAfterDraw', 'true') } catch {}
    })
    const goto = page.goto.bind(page)
    page.goto = (url, opts) => goto(withEngine(url, engine), opts)
    await use(page)
  },
})

export { expect }
export type { Page, Locator }
