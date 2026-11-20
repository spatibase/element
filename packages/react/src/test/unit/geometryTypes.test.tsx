/**
 * `geometryTypes` through the prop plumbing (`useAdapterControls`) and the ref API: the prop reaches
 * the data store, tools that can't draw an allowed type are refused, and the ref methods that put
 * geometry in (addFeature, updateFeature, importGeoJSON, setFeatureCollection, initialData) refuse
 * or skip forbidden types and report them through `onError`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import type { GeoJSONFeature } from '@element-editor/core'
import { useAdapterControls, type ElementEditorImperativeAPI } from '@element-editor/ui'
import { renderWithProviders, resetStores, testDataStore, testUIStore } from '../helpers'

const pt = (id: string, x = 0): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 45] }, properties: { name: id } })
const poly = (id: string): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: {} })

const ds = () => testDataStore.getState()

function mount(opts: Parameters<typeof useAdapterControls>[0]) {
  let api: ElementEditorImperativeAPI<unknown> | null = null
  function Harness(props: typeof opts) {
    api = useAdapterControls<unknown>(props)
    return null
  }
  const view = renderWithProviders(<Harness {...opts} />)
  return { api: () => api!, rerender: (next: typeof opts) => view.rerender(<Harness {...next} />) }
}

let onError: ReturnType<typeof vi.fn>
beforeEach(() => {
  resetStores()
  onError = vi.fn()
  testDataStore.setState({ features: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The stores report through the test helpers' error sink.
  vi.spyOn(console, 'error').mockImplementation((e: unknown) => onError(e))
})
afterEach(() => vi.restoreAllMocks())

const codes = () => onError.mock.calls.map(([e]) => (e as { code?: string }).code)

describe('geometryTypes prop', () => {
  it('syncs to the data store and follows later changes', () => {
    const { rerender } = mount({ geometryTypes: ['Point'] })
    expect(ds().geometryTypes).toEqual(['Point'])
    rerender({ geometryTypes: ['Point', 'LineString'] })
    expect(ds().geometryTypes).toEqual(['Point', 'LineString'])
    rerender({ geometryTypes: undefined })
    expect(ds().geometryTypes).toBeUndefined() // removing the prop allows every type again
  })

  it('setTool refuses a tool that can only draw forbidden types', () => {
    const { api } = mount({ geometryTypes: ['Point'] })
    expect(api().setTool('polygon')).toBe(false)
    expect(api().setTool('line')).toBe(false)
    expect(api().setTool('point')).toBe(true)
    expect(testUIStore.getState().editingMode).toBe('place-point')
    expect(api().setTool('measure')).toBe(true)
  })

  it('addFeature / updateFeature refuse a forbidden type, the allowed one goes through', () => {
    const { api } = mount({ geometryTypes: ['Point'] })
    expect(api().addFeature(poly('p'))).toBeNull()
    expect(api().addFeature(pt('a'))).not.toBeNull()
    expect(ds().features.map((f) => f.id)).toEqual(['a'])
    expect(api().updateFeature('a', { geometry: poly('x').geometry })).toBe(false)
    expect(ds().features[0].geometry.type).toBe('Point')
    expect(api().updateFeature('a', { geometry: { type: 'Point', coordinates: [3, 3] } })).toBe(true)
    expect(codes().filter((c) => c === 'geometry-type-not-allowed')).toHaveLength(2)
  })

  it('importGeoJSON reports refused; setFeatureCollection and initialData skip them', () => {
    const fc = { type: 'FeatureCollection' as const, features: [pt('a'), poly('p'), pt('b', 1)] }
    const { api } = mount({ geometryTypes: ['Point'], initialData: fc })
    expect(ds().features.map((f) => f.id)).toEqual(['a', 'b']) // initialData
    expect(codes()).toContain('geometry-type-not-allowed')
    expect(api().importGeoJSON(fc, 'replace')).toMatchObject({ refused: 1, skipped: 0 })
    act(() => api().setFeatureCollection({ type: 'FeatureCollection', features: [poly('p'), pt('c')] }))
    expect(ds().features.map((f) => f.id)).toEqual(['c'])
  })
})
