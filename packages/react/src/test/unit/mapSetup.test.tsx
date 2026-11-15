/** `initialView` resolution, the `mapOptions` owned-key filter and what the MapLibre map is created with. */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { FeatureCollection } from '@element-editor/core'
import { resolveInitialView, pickMapOptions, saveView, DEFAULT_VIEW } from '../../shell/savedView'

const created: Record<string, unknown>[] = []
vi.mock('@element-editor/adapter-maplibre', () => ({ ElementEditorControls: () => null, useBasemap: () => {}, BasemapControl: () => null }))
vi.mock('@element-editor/adapter-maplibre/basemaps', () => ({
  loadBasemapStyle: async () => ({ version: 8, sources: {}, layers: [] }),
  resolveBasemap: (b: unknown) => b,
}))
vi.mock('maplibre-gl', () => {
  class Map {
    constructor(o: Record<string, unknown>) { created.push(o) }
    on() {} once() {} off() {} remove() {} resize() {} addControl() {} removeControl() {}
    getContainer() { return document.createElement('div') }
  }
  const lib = { Map, AttributionControl: class {}, getVersion: () => '6.0.0', getWorkerUrl: () => 'worker.mjs', setWorkerUrl() {} }
  return { ...lib, default: lib }
})
const { ElementEditor: MapLibreEditor } = await import('../../maplibre/ElementEditor')

const fc = (...coords: [number, number][]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: coords.map((c, i) => ({ type: 'Feature', id: String(i), properties: {}, geometry: { type: 'Point', coordinates: c } })),
} as unknown as FeatureCollection)
const DATA = fc([139.7, 35.6], [139.8, 35.7])
const BOUNDS: [number, number, number, number] = [14.2, 49.9, 14.7, 50.2]

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
beforeEach(() => { localStorage.clear(); created.length = 0 })

describe('resolveInitialView', () => {
  it('falls back to Europe with nothing given', () => {
    expect(resolveInitialView({})).toEqual(DEFAULT_VIEW)
  })
  it('precedence: initialView > saved view > initialData fit > bounds fit > Europe', () => {
    const all = { initialView: { center: [1, 2] as [number, number], zoom: 3 }, initialData: DATA, bounds: BOUNDS }
    saveView(50, 14, 9) // lat, lng
    expect(resolveInitialView(all)).toEqual({ center: [1, 2], zoom: 3 })
    expect(resolveInitialView({ ...all, initialView: undefined })).toEqual({ center: [14, 50], zoom: 9 })
    localStorage.clear()
    expect(resolveInitialView({ ...all, initialView: undefined })).toEqual({ bounds: [139.7, 35.6, 139.8, 35.7] })
    expect(resolveInitialView({ bounds: BOUNDS })).toEqual({ bounds: BOUNDS })
  })
  it('{ bounds } and "data" fit; "data" accepts a single Feature', () => {
    expect(resolveInitialView({ initialView: { bounds: BOUNDS } })).toEqual({ bounds: BOUNDS })
    saveView(50, 14, 9)
    expect(resolveInitialView({ initialView: 'data', initialData: DATA })).toEqual({ bounds: [139.7, 35.6, 139.8, 35.7] })
    expect(resolveInitialView({ initialView: 'data', initialData: DATA.features[0] as unknown as FeatureCollection }))
      .toEqual({ bounds: [139.7, 35.6, 139.7, 35.6] })
  })
  it("'data' with no usable geometry falls through (saved view, then bounds)", () => {
    const empty = fc()
    const broken = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon' } }] } as unknown as FeatureCollection
    expect(resolveInitialView({ initialView: 'data', initialData: empty, bounds: BOUNDS })).toEqual({ bounds: BOUNDS })
    expect(resolveInitialView({ initialView: 'data', initialData: broken })).toEqual(DEFAULT_VIEW)
    saveView(50, 14, 9)
    expect(resolveInitialView({ initialView: 'data', initialData: empty })).toEqual({ center: [14, 50], zoom: 9 })
  })
  it('persist: false ignores the saved view; persistKey reads its own', () => {
    saveView(50, 14, 9)
    expect(resolveInitialView({ initialData: DATA }, { persist: false })).toEqual({ bounds: [139.7, 35.6, 139.8, 35.7] })
    expect(resolveInitialView({}, { persistKey: 'a' })).toEqual(DEFAULT_VIEW)
    saveView(10, 20, 4, { persistKey: 'a' })
    expect(resolveInitialView({}, { persistKey: 'a' })).toEqual({ center: [20, 10], zoom: 4 })
  })
  it('a malformed initialView warns and is ignored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveInitialView({ initialView: { center: [Number.NaN, 1], zoom: 3 }, bounds: BOUNDS })).toEqual({ bounds: BOUNDS })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('initialView'))
    warn.mockRestore()
  })
})

describe('pickMapOptions', () => {
  it('drops owned keys with a warning and keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = pickMapOptions({ maxZoom: 12, center: [0, 0], style: 'x' }, { center: 'Use `initialView`.', style: 'Use `basemap`.' }, 'test')
    expect(out).toEqual({ maxZoom: 12 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mapOptions.center'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mapOptions.style'))
    expect(pickMapOptions(undefined, {}, 'test')).toEqual({})
    warn.mockRestore()
  })
})

describe('MapLibre drop-in map creation', () => {
  it('creates the map with the start view and the allowed mapOptions', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const opts = { pitch: 30, maxZoom: 12, center: [0, 0], attributionControl: {} } as never
    const { unmount } = render(<MapLibreEditor initialView={{ center: [14.4, 50.1], zoom: 11 }} mapOptions={opts} />)
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toMatchObject({ center: [14.4, 50.1], zoom: 11, pitch: 30, maxZoom: 12, attributionControl: false })
    unmount()
    render(<MapLibreEditor initialData={DATA} />)
    await waitFor(() => expect(created).toHaveLength(2))
    expect(created[1]).toMatchObject({ bounds: [[139.7, 35.6], [139.8, 35.7]], fitBoundsOptions: { padding: 40, maxZoom: 16 } })
    expect(created[1]).not.toHaveProperty('center')
    warn.mockRestore()
  })
})
