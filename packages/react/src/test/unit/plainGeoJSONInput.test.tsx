// Every input boundary accepts plain RFC 7946 GeoJSON (no `metadata`, ids missing or numeric,
// `properties: null`) and stores it normalised: string ids (UUID when missing), `{}` properties,
// the default schema. The literals are typed as the public input types, without casts, so
// `pnpm typecheck` also proves the types accept them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import type { FeatureCollectionInput, GeoJSONFeatureInput } from '@element-editor/core'
import { useAdapterControls, type ElementEditorImperativeAPI } from '@element-editor/ui'
import { renderWithProviders, resetStores, testDataStore } from '../helpers'

const UUID = /^[0-9a-f-]{36}$/
const plain: FeatureCollectionInput = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: null },
    { type: 'Feature', id: 0, geometry: { type: 'Point', coordinates: [3, 4] }, properties: { name: 'zero' } },
    { type: 'Feature', id: 42, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: null },
  ],
}

function mount(opts: Parameters<typeof useAdapterControls>[0] = {}) {
  let api: ElementEditorImperativeAPI | null = null
  function Harness() {
    api = useAdapterControls(opts)
    return null
  }
  renderWithProviders(<Harness />)
  return api! as ElementEditorImperativeAPI
}

const stored = () => testDataStore.getState().features
function expectNormalised() {
  const [a, b, c] = stored()
  expect(stored()).toHaveLength(3)
  expect(a.id).toMatch(UUID)
  expect(a.properties).toEqual({})
  expect(b.id).toBe('0') // a numeric 0 is a real id, not a missing one
  expect(c.id).toBe('42')
  expect(c.properties).toEqual({})
  expect(testDataStore.getState().schemas.length).toBeGreaterThan(0) // default schema without metadata
  expect(testDataStore.getState().groups).toEqual([])
}

beforeEach(() => {
  resetStores()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('plain GeoJSON at input boundaries', () => {
  it('initialData (FeatureCollection without metadata)', () => {
    mount({ initialData: plain })
    expectNormalised()
  })

  it('initialData (a single Feature)', () => {
    const feature: GeoJSONFeatureInput = { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 6] }, properties: null }
    mount({ initialData: feature })
    expect(stored()).toHaveLength(1)
    expect(stored()[0].id).toMatch(UUID)
    expect(stored()[0].properties).toEqual({})
  })

  it('ref.setFeatureCollection', () => {
    const api = mount()
    act(() => api.setFeatureCollection(plain))
    expectNormalised()
  })

  it('ref.importGeoJSON (replace and merge)', () => {
    const api = mount()
    act(() => { api.importGeoJSON(plain, 'replace') })
    expectNormalised()
    const merged = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, id: 7, geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] }, properties: null }] }
    act(() => { api.importGeoJSON(merged, 'merge') })
    expect(stored().map((f) => f.id)).toContain('7')
    expect(stored().find((f) => f.id === '7')!.properties).toEqual({})
  })

  it('export -> import keeps hidden and _drawType (bogus _drawType dropped)', () => {
    const api = mount()
    const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]]
    act(() => api.setFeatureCollection({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'c', _drawType: 'circle', hidden: true, geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} },
        { type: 'Feature', id: 'x', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {}, ...({ _drawType: 'blob' } as object) }, // not a DrawType
      ],
    }))
    const again = JSON.parse(api.exportGeoJSON())
    act(() => api.setFeatureCollection(again))
    const [c, x] = stored()
    expect(c._drawType).toBe('circle')
    expect(c.hidden).toBe(true)
    expect(x._drawType).toBeUndefined()
  })

  it('ref.addFeature: missing / numeric id, null properties', () => {
    const api = mount()
    let a = null, b = null
    act(() => {
      a = api.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: null })
      b = api.addFeature({ type: 'Feature', id: 0, geometry: { type: 'Point', coordinates: [3, 4] } })
    })
    expect(a!.id).toMatch(UUID)
    expect(a!.properties).toEqual({})
    expect(b!.id).toBe('0')
    expect(b!.properties).toEqual({})
    // Output stays strict: what comes back is a full GeoJSONFeature, metadata included.
    const out = api.getFeatureCollection()
    expect(out.metadata.schemas.length).toBeGreaterThan(0)
    expect(out.features.every((f) => typeof f.id === 'string' && f.properties !== null)).toBe(true)
  })
})
