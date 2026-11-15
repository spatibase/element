import { describe, it, expect, vi } from 'vitest'
import { createDataStore, subscribeToDataChanges } from '@element-editor/core'
import type { GeoJSONFeature } from '@element-editor/core'

const N = 1000
const pt = (i: number): GeoJSONFeature => ({ type: 'Feature', id: `f${i}`, geometry: { type: 'Point', coordinates: [i * 0.001, 45] }, properties: { name: `f${i}` } })

function setup() {
  const store = createDataStore()
  store.getState().importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: N }, (_, i) => pt(i)) }, 'replace')
  const notifications = vi.fn()
  store.subscribe(notifications)
  const onFeatureUpdate = vi.fn()
  const onChange = vi.fn()
  subscribeToDataChanges(store, () => ({ onFeatureUpdate, onChange }))
  return { store, notifications, onFeatureUpdate, onChange, undoDepth: store.getState().undoStack.length }
}

describe('updateFeatures', () => {
  it('updates 1,000 features in one commit, one undo entry, onFeatureUpdate per feature', () => {
    const loop = setup()
    let t = performance.now()
    for (let i = 0; i < N; i++) loop.store.getState().updateFeature(`f${i}`, { properties: { name: `f${i}`, status: 'done' } })
    const loopMs = performance.now() - t

    const batch = setup()
    t = performance.now()
    batch.store.getState().updateFeatures(Array.from({ length: N }, (_, i) => ({ id: `f${i}`, patch: { properties: { name: `f${i}`, status: 'done' } } })))
    const batchMs = performance.now() - t
    console.log(`1,000 property updates: updateFeature×N ${loopMs.toFixed(1)} ms, ${loop.notifications.mock.calls.length} notifications, ${loop.store.getState().undoStack.length - loop.undoDepth} undo entries; updateFeatures ${batchMs.toFixed(1)} ms, ${batch.notifications.mock.calls.length} notification(s), ${batch.store.getState().undoStack.length - batch.undoDepth} undo entry`)

    expect(loop.notifications).toHaveBeenCalledTimes(N)
    expect(loop.store.getState().undoStack.length - loop.undoDepth).toBe(25 - loop.undoDepth) // capped: only the last 25 undo
    expect(batch.notifications).toHaveBeenCalledTimes(1)
    expect(batch.onChange).toHaveBeenCalledTimes(1)
    expect(batch.onFeatureUpdate).toHaveBeenCalledTimes(N)
    expect(batch.store.getState().undoStack.length - batch.undoDepth).toBe(1)
    expect(batchMs).toBeLessThan(loopMs) // loose: N array copies vs one
    // Same result either way.
    expect(batch.store.getState().features.map((f) => f.properties)).toEqual(loop.store.getState().features.map((f) => f.properties))

    // One undo restores the whole batch.
    batch.store.getState().undo()
    expect(batch.store.getState().features.every((f) => f.properties.status === undefined)).toBe(true)
  })

  it('validates, refreshes bbox, skips unknown ids, stacks patches for one id, and adds no undo entry for geometry only', () => {
    const { store, notifications, undoDepth } = setup()
    const before = store.getState().features
    store.getState().updateFeatures([{ id: 'nope', patch: { hidden: true } }])
    expect(notifications).not.toHaveBeenCalled() // nothing to update: no commit
    store.getState().updateFeatures([
      { id: 'f1', patch: { geometry: { type: 'Point', coordinates: [5, 6] } } },
      { id: 'f1', patch: { hidden: true } },
      { id: 'missing', patch: { hidden: true } },
    ])
    const after = store.getState().features
    expect(after[1]).toMatchObject({ hidden: true, geometry: { coordinates: [5, 6] }, bbox: [5, 6, 5, 6] })
    expect(after[1]._validation).toBeDefined()
    expect(after.filter((f, i) => f !== before[i])).toHaveLength(1) // structural sharing
    expect(store.getState().undoStack.length).toBe(undoDepth)
  })
})
