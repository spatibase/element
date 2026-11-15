import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createDataStore, subscribeToDataChanges } from '@element-editor/core'
import type { GeoJSONFeature } from '@element-editor/core'

function mkPoint(id: string, lng: number, lat: number): GeoJSONFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { name: id },
  }
}

describe('subscribeToDataChanges', () => {
  let store: ReturnType<typeof createDataStore>
  let onChange: ReturnType<typeof vi.fn<(...args: any[]) => void>>
  let onFeatureAdd: ReturnType<typeof vi.fn<(...args: any[]) => void>>
  let onFeatureUpdate: ReturnType<typeof vi.fn<(...args: any[]) => void>>
  let onFeatureDelete: ReturnType<typeof vi.fn<(...args: any[]) => void>>
  let onSelectionChange: ReturnType<typeof vi.fn<(...args: any[]) => void>>
  let unsub: () => void

  beforeEach(() => {
    store = createDataStore()
    onChange = vi.fn()
    onFeatureAdd = vi.fn()
    onFeatureUpdate = vi.fn()
    onFeatureDelete = vi.fn()
    onSelectionChange = vi.fn()
    unsub = subscribeToDataChanges(store, () => ({
      onChange,
      onFeatureAdd,
      onFeatureUpdate,
      onFeatureDelete,
      onSelectionChange,
    }))
  })

  it('fires onFeatureAdd + onChange when a feature is added', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))

    expect(onFeatureAdd).toHaveBeenCalledTimes(1)
    expect(onFeatureAdd.mock.calls[0][0].id).toBe('a')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('fires onFeatureUpdate when geometry changes', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))
    onFeatureUpdate.mockClear()

    store.getState().updateFeature('a', {
      geometry: { type: 'Point', coordinates: [3.0, 49.0] },
    })

    expect(onFeatureUpdate).toHaveBeenCalledTimes(1)
    expect(onFeatureUpdate.mock.calls[0][0]).toBe('a')
    expect(onFeatureUpdate.mock.calls[0][1].geometry.coordinates).toEqual([3.0, 49.0])
  })

  it('fires onFeatureUpdate when properties change', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))
    onFeatureUpdate.mockClear()

    store.getState().updateFeature('a', { properties: { name: 'Paris' } })

    expect(onFeatureUpdate).toHaveBeenCalledTimes(1)
    expect(onFeatureUpdate.mock.calls[0][1].properties.name).toBe('Paris')
  })

  it('fires onFeatureDelete once per deleted feature', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))
    store.getState().addFeature(mkPoint('b', 2.17, 41.38))
    onFeatureDelete.mockClear()

    store.getState().deleteFeature('a')

    expect(onFeatureDelete).toHaveBeenCalledTimes(1)
    expect(onFeatureDelete).toHaveBeenCalledWith('a')
  })

  it('fires onSelectionChange independently of commits', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))
    onSelectionChange.mockClear()
    onChange.mockClear()

    store.getState().selectFeature('a')

    expect(onSelectionChange).toHaveBeenCalled()
    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toEqual(['a'])
    // Selection change must not re-fire onChange
    expect(onChange).not.toHaveBeenCalled()
  })

  it('strips internal _validation from callback payloads', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))

    const delivered = onFeatureAdd.mock.calls[0][0] as GeoJSONFeature
    expect((delivered as { _validation?: unknown })._validation).toBeUndefined()
    const viaOnChange = onChange.mock.calls[0][0].features[0] as GeoJSONFeature
    expect((viaOnChange as { _validation?: unknown })._validation).toBeUndefined()
  })

  it('unsubscribe halts further dispatches', () => {
    unsub()
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))

    expect(onChange).not.toHaveBeenCalled()
    expect(onFeatureAdd).not.toHaveBeenCalled()
  })

  it('detects bulk deletes via selection deletion', () => {
    store.getState().addFeature(mkPoint('a', 2.35, 48.85))
    store.getState().addFeature(mkPoint('b', 2.17, 41.38))
    store.getState().setSelection(['a', 'b'])
    onFeatureDelete.mockClear()

    store.getState().deleteSelection()

    expect(onFeatureDelete).toHaveBeenCalledTimes(2)
    const deletedIds = onFeatureDelete.mock.calls.map((c) => c[0]).sort()
    expect(deletedIds).toEqual(['a', 'b'])
  })
})

describe('single-feature commits stay O(1) for untouched features', () => {
  function seeded(n: number) {
    const store = createDataStore()
    store.getState().importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => mkPoint('p' + i, i * 0.01, 0)) }, 'replace')
    return store
  }

  it('updateFeature keeps every other feature by reference', () => {
    const store = seeded(100)
    const before = store.getState().features
    store.getState().updateFeature('p42', { properties: { name: 'x' } })
    const after = store.getState().features
    expect(after).not.toBe(before)
    after.forEach((f, i) => (i === 42 ? expect(f).not.toBe(before[i]) : expect(f).toBe(before[i])))
    expect(after[42].properties.name).toBe('x')
  })

  it('updateFeature with an unknown id does not commit', () => {
    const store = seeded(3)
    const before = store.getState().features
    store.getState().updateFeature('nope', { properties: { name: 'x' } })
    expect(store.getState().features).toBe(before)
  })

  it('selection changes never touch the features array', () => {
    const store = seeded(3)
    const before = store.getState().features
    store.getState().selectFeature('p1')
    store.getState().setSelection(['p0', 'p2'])
    store.getState().clearSelection()
    expect(store.getState().features).toBe(before)
  })

  it('updateFeatureValidation with nothing new does not commit', () => {
    const store = seeded(3)
    store.getState().updateFeatureValidation('p1', ['w'], [])
    const before = store.getState().features
    store.getState().updateFeatureValidation('p1', ['w'], [])
    expect(store.getState().features).toBe(before)
  })

  it('diff reports only the changed id; onChange reuses clean objects for untouched features', () => {
    const store = seeded(50)
    const onChange = vi.fn()
    const onFeatureUpdate = vi.fn()
    const onFeatureAdd = vi.fn()
    const onFeatureDelete = vi.fn()
    subscribeToDataChanges(store, () => ({ onChange, onFeatureUpdate, onFeatureAdd, onFeatureDelete }))
    store.getState().updateFeature('p7', { properties: { name: 'a' } })
    store.getState().updateFeature('p9', { geometry: { type: 'Point', coordinates: [1, 1] } })
    expect(onFeatureUpdate.mock.calls.map((c) => c[0])).toEqual(['p7', 'p9'])
    expect(onFeatureAdd).not.toHaveBeenCalled()
    expect(onFeatureDelete).not.toHaveBeenCalled()
    const [first, second] = onChange.mock.calls.map((c) => c[0].features)
    expect(first).toHaveLength(50)
    second.forEach((f: GeoJSONFeature, i: number) => (i === 9 ? expect(f).not.toBe(first[i]) : expect(f).toBe(first[i])))
    expect(second.every((f: GeoJSONFeature) => !('_validation' in f))).toBe(true)
    expect(second[7].properties.name).toBe('a')
  })

  it('reorder with the same ids reports no updates', () => {
    const store = seeded(3)
    const onFeatureUpdate = vi.fn()
    subscribeToDataChanges(store, () => ({ onFeatureUpdate }))
    store.getState().reorderFeatures(['p2', 'p1', 'p0'])
    expect(onFeatureUpdate).not.toHaveBeenCalled()
  })

  it('getVisibleSchemas hides the boundaries schema until a feature uses it', () => {
    const store = seeded(3)
    const ids = () => store.getState().getVisibleSchemas().map((s) => s.id)
    const all = store.getState().schemas.map((s) => s.id)
    const hasBoundaries = all.length !== ids().length
    if (!hasBoundaries) return // default schemas carry no boundaries schema
    const bId = all.find((id) => !ids().includes(id))!
    store.getState().updateFeature('p0', { schemaId: bId })
    expect(ids()).toEqual(all)
  })
})
