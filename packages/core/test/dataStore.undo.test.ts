/**
 * Undo/redo invariants for dataStore: every action that is one user step pushes exactly one undo
 * entry, no-ops push none, a new step clears redo, and both stacks are capped at 25.
 * (Replace/merge import, updateFeatures batches and feature-data coalescing are covered in
 * packages/react/src/test/unit/{importUndo,updateFeatures,dataStore}.test.ts; this file covers the rest.)
 */
import { describe, it, expect } from 'vitest'
import { createDataStore } from '../src/store/dataStore'
import type { GeoJSONFeature } from '../src/types/geojson'

const pt = (id: string, x = 0, props: Record<string, unknown> = {}): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 0] }, properties: props })
const ids = (s: ReturnType<typeof createDataStore>) => s.getState().features.map((f) => f.id)
const depth = (s: ReturnType<typeof createDataStore>) => [s.getState().undoStack.length, s.getState().redoStack.length]

function seeded(n = 3) {
  const s = createDataStore()
  s.getState().importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => pt(`f${i}`, i)) }, 'replace', { undoable: false })
  return s
}

describe('one user step = one undo entry', () => {
  it('addFeature: one entry; undo removes it, redo brings it back', () => {
    const s = seeded()
    s.getState().addFeature(pt('new'))
    expect(depth(s)).toEqual([1, 0])
    expect(ids(s)).toEqual(['new', 'f0', 'f1', 'f2'])
    s.getState().undo()
    expect(ids(s)).toEqual(['f0', 'f1', 'f2'])
    expect(depth(s)).toEqual([0, 1])
    s.getState().redo()
    expect(ids(s)).toEqual(['new', 'f0', 'f1', 'f2'])
    expect(depth(s)).toEqual([1, 0])
  })

  it('addFeature with skipSnapshot pushes nothing (the caller snapshotted)', () => {
    const s = seeded()
    s.getState().takeSnapshot()
    s.getState().addFeature(pt('a'), { skipSnapshot: true })
    s.getState().addFeature(pt('b'), { skipSnapshot: true })
    expect(depth(s)).toEqual([1, 0])
    s.getState().undo()
    expect(ids(s)).toEqual(['f0', 'f1', 'f2'])
  })

  it('addFeature undoable:false pushes nothing and is not reverted by undoing an earlier step', () => {
    const s = seeded()
    s.getState().deleteFeatures(['f0'])
    s.getState().addFeature(pt('synced'), { undoable: false })
    expect(depth(s)).toEqual([1, 0])
    s.getState().undo()
    expect(ids(s).sort()).toEqual(['f0', 'f1', 'f2', 'synced'])
  })

  it('addFeature refused by maxFeatures pushes nothing', () => {
    const s = seeded()
    s.getState().setMaxFeatures(3)
    expect(s.getState().addFeature(pt('over'))).toBeNull()
    expect(depth(s)).toEqual([0, 0])
  })

  it('deleteFeatures batch: one entry; undo restores all of them in their original order', () => {
    const s = seeded(5)
    expect(s.getState().deleteFeatures(['f1', 'f3', 'f4', 'nope'])).toBe(3)
    expect(ids(s)).toEqual(['f0', 'f2'])
    expect(depth(s)).toEqual([1, 0])
    s.getState().undo()
    expect(ids(s)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'])
    s.getState().redo()
    expect(ids(s)).toEqual(['f0', 'f2'])
  })

  it('deleteFeatures / deleteFeature of unknown ids pushes nothing and does not clear redo', () => {
    const s = seeded()
    s.getState().addFeature(pt('a'))
    s.getState().undo()
    expect(depth(s)).toEqual([0, 1])
    expect(s.getState().deleteFeatures(['ghost'])).toBe(0)
    s.getState().deleteFeature('ghost')
    expect(depth(s)).toEqual([0, 1])
  })

  it('deleteFeatures undoable:false rewrites history so undo cannot resurrect the feature', () => {
    const s = seeded()
    s.getState().updateFeatures([{ id: 'f1', patch: { properties: { name: 'x' } } }])
    s.getState().deleteFeatures(['f1'], { undoable: false })
    expect(depth(s)).toEqual([1, 0])
    s.getState().undo()
    expect(ids(s)).toEqual(['f0', 'f2'])
  })

  it('updateFeatures undoable:true counts geometry: one entry; one undo restores every geometry', () => {
    const s = seeded(4)
    const before = s.getState().features.map((f) => f.geometry)
    s.getState().updateFeatures(
      s.getState().features.map((f, i) => ({ id: f.id, patch: { geometry: { type: 'Point', coordinates: [i + 100, 5] } } })),
      { undoable: true },
    )
    expect(depth(s)).toEqual([1, 0])
    expect(s.getState().features[0].bbox).toEqual([100, 5, 100, 5])
    s.getState().undo()
    expect(s.getState().features.map((f) => f.geometry)).toEqual(before)
  })

  it('updateFeatures with only unknown ids is not a commit at all', () => {
    const s = seeded()
    const features = s.getState().features
    s.getState().updateFeatures([{ id: 'ghost', patch: { properties: { a: 1 } } }], { undoable: true })
    expect(s.getState().features).toBe(features)
    expect(depth(s)).toEqual([0, 0])
  })

  it('importGeoJSON replace and merge: one entry each; undo walks back one import at a time', () => {
    const s = seeded(1)
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('a'), pt('b')] }, 'merge')
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('r')] }, 'replace')
    expect(depth(s)).toEqual([2, 0])
    s.getState().undo()
    expect(ids(s)).toEqual(['f0', 'a', 'b'])
    s.getState().undo()
    expect(ids(s)).toEqual(['f0'])
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): a merge import that adds nothing (every id already on the map) still pushes an undo entry
  // and clears redo (dataStore.ts:1310, merge branch of importGeoJSON pushes unconditionally).
  // Every other no-op (deleteFeatures with unknown ids, updateFeatures with unknown ids,
  // no-op property edits) pushes nothing, so the user gets a Cmd+Z that does nothing and loses redo.
  it('a merge that adds nothing pushes no undo entry and keeps redo', () => {
    const s = seeded(2)
    s.getState().addFeature(pt('x'))
    s.getState().undo()
    expect(depth(s)).toEqual([0, 1])
    const r = s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('f0'), pt('f1')] }, 'merge')
    expect(r.duplicates).toBe(2)
    expect(depth(s)).toEqual([0, 1])
  })

  it('takeSnapshot + several skip-validation geometry updates (a drag) = one step', () => {
    const s = seeded()
    s.getState().takeSnapshot()
    for (let i = 1; i <= 10; i++) s.getState().updateFeature('f0', { geometry: { type: 'Point', coordinates: [i, i] } }, { skipValidation: true })
    expect(depth(s)).toEqual([1, 0])
    s.getState().undo()
    expect(s.getState().features[0].geometry).toEqual({ type: 'Point', coordinates: [0, 0] })
  })
})

describe('redo is cleared by any new step', () => {
  const steps: Array<[string, (s: ReturnType<typeof createDataStore>) => void]> = [
    ['addFeature', (s) => { s.getState().addFeature(pt('n')) }],
    ['deleteFeatures', (s) => { s.getState().deleteFeatures(['f0']) }],
    ['deleteFeature', (s) => s.getState().deleteFeature('f0')],
    ['updateFeatures (data)', (s) => s.getState().updateFeatures([{ id: 'f0', patch: { properties: { name: 'x' } } }])],
    ['updateFeature (data)', (s) => s.getState().updateFeature('f0', { properties: { name: 'y' } })],
    ['importGeoJSON merge', (s) => { s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('m')] }, 'merge') }],
    ['importGeoJSON replace', (s) => { s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('m')] }, 'replace') }],
    ['takeSnapshot', (s) => s.getState().takeSnapshot()],
  ]
  it.each(steps)('%s', (_name, step) => {
    const s = seeded()
    s.getState().addFeature(pt('a'))
    s.getState().addFeature(pt('b'))
    s.getState().undo()
    expect(depth(s)).toEqual([1, 1])
    step(s)
    expect(s.getState().redoStack).toHaveLength(0)
    expect(s.getState().undoStack).toHaveLength(2)
    // redo is now a no-op
    const features = s.getState().features
    s.getState().redo()
    expect(s.getState().features).toBe(features)
  })
})

describe('25-level cap', () => {
  it('keeps only the newest 25 entries; undoing all of them stops at step 5 of 30', () => {
    const s = createDataStore()
    for (let i = 0; i < 30; i++) s.getState().addFeature(pt(`p${i}`))
    expect(s.getState().undoStack).toHaveLength(25)
    for (let i = 0; i < 25; i++) s.getState().undo()
    expect(s.getState().features).toHaveLength(5)
    expect(ids(s)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0'])
    // A 26th undo is a no-op
    const features = s.getState().features
    s.getState().undo()
    expect(s.getState().features).toBe(features)
    expect(depth(s)).toEqual([0, 25])
    // Redo replays all 25 back to the full state
    for (let i = 0; i < 25; i++) s.getState().redo()
    expect(s.getState().features).toHaveLength(30)
    expect(depth(s)).toEqual([25, 0])
  })

  it('every pushing action respects the cap', () => {
    const s = seeded(40)
    for (let i = 0; i < 40; i++) s.getState().deleteFeatures([`f${i}`])
    expect(s.getState().undoStack).toHaveLength(25)
    for (let i = 0; i < 40; i++) s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt(`m${i}`)] }, 'merge')
    expect(s.getState().undoStack).toHaveLength(25)
    for (let i = 0; i < 40; i++) s.getState().updateFeatures([{ id: 'm0', patch: { properties: { v: i } } }])
    expect(s.getState().undoStack).toHaveLength(25)
  })
})

describe('undo / redo symmetry', () => {
  it('undo then redo of a mixed history returns the exact same feature objects', () => {
    const s = seeded()
    const states: GeoJSONFeature[][] = [s.getState().features]
    s.getState().addFeature(pt('a')); states.push(s.getState().features)
    s.getState().updateFeatures([{ id: 'a', patch: { properties: { name: 'A' } } }]); states.push(s.getState().features)
    s.getState().deleteFeatures(['f1', 'f2']); states.push(s.getState().features)
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('m')] }, 'merge'); states.push(s.getState().features)

    for (let i = states.length - 2; i >= 0; i--) {
      s.getState().undo()
      expect(s.getState().features).toBe(states[i])
    }
    for (let i = 1; i < states.length; i++) {
      s.getState().redo()
      expect(s.getState().features).toBe(states[i])
    }
  })

  it('undo and redo keep the selected features that still exist (and drop the rest)', () => {
    const s = seeded()
    s.getState().addFeature(pt('a'))
    expect(s.getState().selectedIds).toEqual(['a'])
    s.getState().undo()
    expect(s.getState().selectedIds).toEqual([]) // 'a' is gone
    s.getState().setSelection(['f0'])
    s.getState().redo()
    expect(s.getState().selectedIds).toEqual(['f0']) // f0 still exists: stays selected
  })
})
