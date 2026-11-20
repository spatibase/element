import { describe, it, expect, vi, afterEach } from 'vitest'
// Source imports: '@element-editor/core' resolves to packages/core/dist in vitest,
// which is stale until `pnpm build`.
import { createDataStore } from '../../../../core/src/store/dataStore'
import { createUIStore } from '../../../../core/src/store/uiStore'
import { fetchRoute, setRoutingApiKey } from '../../../../core/src/utils/routing'
import { fetchOverpassFeatures, clearOverpassCache } from '../../../../core/src/utils/overpass'
import { validateFeature } from '../../../../core/src/utils/validation'
import { DEFAULT_SCHEMAS } from '../../../../core/src/utils/schema'
import type { GeoJSONFeature } from '../../../../core/src/types/geojson'

const fc = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [14, 50] }, properties: {} },
    { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [15, 50] }, properties: {} },
    { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [16, 50] }, properties: {} },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('importGeoJSON replace mode', () => {
  it('re-importing the same ids keeps every feature', () => {
    const store = createDataStore()
    store.getState().importGeoJSON(fc, 'replace')
    const res = store.getState().importGeoJSON(fc, 'replace')
    expect(store.getState().features.map((f) => f.id)).toEqual(['a', 'b'])
    expect(res.duplicates).toBe(1) // only the in-file duplicate
  })

  it('merge mode still skips ids already present', () => {
    const store = createDataStore()
    store.getState().importGeoJSON(fc, 'replace')
    const res = store.getState().importGeoJSON(fc, 'merge')
    expect(store.getState().features).toHaveLength(2)
    expect(res.duplicates).toBe(3)
  })

  it('rejects a non-array features member with a clear error', () => {
    const store = createDataStore()
    expect(() => store.getState().importGeoJSON({ type: 'FeatureCollection', features: {} }, 'replace'))
      .toThrow(/features is not an array/)
  })
})

describe('storage blocked', () => {
  it('store creation and setters survive a throwing localStorage', () => {
    const throwing = () => { throw new DOMException('denied', 'SecurityError') }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing)
    const ds = createDataStore()
    const ui = createUIStore(ds)
    expect(ui.getState().userTheme).toBe('system')
    expect(ui.getState().autoExitAfterDraw).toBe(false)
    expect(() => {
      ui.getState().setUserTheme('dark')
      ui.getState().setShowMeasurements(true)
      ui.getState().setTopoEditEnabled(false)
      ui.getState().setAutoExitAfterDraw(true)
    }).not.toThrow()
    expect(ui.getState().userTheme).toBe('dark')
  })
})

describe('autoExitAfterDraw prop', () => {
  it('wins over the stored value, is not persisted, locks the setter and restores on unset', () => {
    localStorage.setItem('elm_autoExitAfterDraw', 'false')
    const ui = createUIStore(createDataStore())
    expect(ui.getState().autoExitAfterDraw).toBe(false)
    ui.getState().setAutoExitProp(true)
    expect(ui.getState().autoExitAfterDraw).toBe(true)
    expect(ui.getState().autoExitLocked).toBe(true)
    ui.getState().setAutoExitAfterDraw(false)
    expect(ui.getState().autoExitAfterDraw).toBe(true)
    expect(localStorage.getItem('elm_autoExitAfterDraw')).toBe('false')
    ui.getState().setAutoExitProp(undefined)
    expect(ui.getState().autoExitLocked).toBe(false)
    expect(ui.getState().autoExitAfterDraw).toBe(false)
    localStorage.removeItem('elm_autoExitAfterDraw')
  })
})

describe('fetchRoute per-call api key', () => {
  it('uses the passed key, not the global, and OSRM when no key is passed', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes('openrouteservice')
        ? { features: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }] }
        : { routes: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }] },
    }))
    vi.stubGlobal('fetch', fetchMock)
    setRoutingApiKey('global-key')
    const wps: [number, number][] = [[0, 0], [1, 1]]

    await fetchRoute(wps, { apiKey: 'instance-key' })
    expect(fetchMock.mock.calls[0][0]).toContain('openrouteservice')
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'instance-key' })

    await fetchRoute(wps, {})
    expect(fetchMock.mock.calls[1][0]).toContain('project-osrm')

    // Legacy form still reads the global.
    await fetchRoute(wps)
    expect(fetchMock.mock.calls[2][0]).toContain('openrouteservice')
    setRoutingApiKey(undefined)
  })
})

describe('overpass in-flight de-dupe', () => {
  it('dedupes per location and one abort does not reject the other caller', async () => {
    clearOverpassCache()
    const resolvers: (() => void)[] = []
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ status: 200, ok: true, json: async () => ({ elements: [] }) }))
    }))
    vi.stubGlobal('fetch', fetchMock)

    const ac = new AbortController()
    const p1 = fetchOverpassFeatures(50, 14, 80, undefined, ac.signal)
    const p2 = fetchOverpassFeatures(50, 14, 80)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A different spot gets its own request.
    const p3 = fetchOverpassFeatures(51, 15, 80)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    ac.abort()
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    resolvers.forEach((r) => r())
    await expect(p2).resolves.toEqual([])
    await expect(p3).resolves.toEqual([])
  })
})

describe('validateFeature MultiPolygon', () => {
  const schema = DEFAULT_SCHEMAS[0]
  const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]]

  it('does not copy a clean MultiPolygon', () => {
    const f = { type: 'Feature', id: 'm', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[ring]] } } as GeoJSONFeature
    const res = validateFeature(f, schema)
    expect(res.geometryFixed).toBe(false)
    expect(res.fixedFeature).toBeNull()
  })

  it('fixes duplicate vertices and keeps the zero-area error on property-only re-validation', () => {
    const dup: [number, number][] = [[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]
    const f = { type: 'Feature', id: 'm', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[dup]] } } as GeoJSONFeature
    const res = validateFeature(f, schema)
    expect(res.geometryFixed).toBe(true)
    expect((res.fixedFeature!.geometry.coordinates as number[][][][])[0][0]).toHaveLength(4)

    const flat = { type: 'Feature', id: 'z', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] } } as GeoJSONFeature
    expect(validateFeature(flat, schema).errors).toContain('Area has zero size.')
    // Same geometry ref, new properties (cache path).
    expect(validateFeature({ ...flat, properties: { name: 'x' } }, schema).errors).toContain('Area has zero size.')
  })
})
