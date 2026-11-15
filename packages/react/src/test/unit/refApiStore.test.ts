import { describe, it, expect, vi } from 'vitest'
import { createDataStore, createUIStore, subscribeToDataChanges } from '@element-editor/core'
import type { GeoJSONFeature, Schema } from '@element-editor/core'
import { rewriteHistory, type UndoEntry } from '../../../../core/src/store/dataStore'

const pt = (id: string, x = 0, props: Record<string, unknown> = {}): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 45] }, properties: { name: id, ...props } })

function setup(ids = ['a', 'b', 'c']) {
  const store = createDataStore()
  store.getState().importGeoJSON({ type: 'FeatureCollection', features: ids.map((id, i) => pt(id, i)) }, 'replace')
  store.setState({ undoStack: [], redoStack: [] })
  const s = () => store.getState()
  const ids_ = () => s().features.map((f) => f.id)
  return { store, s, ids: ids_ }
}

describe('rewriteHistory', () => {
  const schemas: Schema[] = [{ id: 'default', name: 'Default', fields: [] }]
  const entries = (): UndoEntry[] => [{ features: [pt('a'), pt('b')] }, { features: [pt('b')] }]

  it('add: puts the feature on top of snapshots that lack its id', () => {
    const before = entries()
    const out = rewriteHistory(before, { type: 'add', feature: pt('a', 9) }, schemas)
    expect(out[0]).toBe(before[0]) // already has 'a': untouched, same reference
    expect(out[1].features.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('update: patches the feature where present, re-validated, other snapshots untouched', () => {
    const before = entries()
    const out = rewriteHistory(before, { type: 'update', patches: [{ id: 'a', patch: { properties: { name: 'A2' }, geometry: { type: 'Point', coordinates: [5, 6] } } }] }, schemas)
    expect(out[0].features[0]).toMatchObject({ properties: { name: 'A2' }, bbox: [5, 6, 5, 6] })
    expect(out[0].features[0]._validation).toBeDefined()
    expect(out[0].features[1]).toBe(before[0].features[1])
    expect(out[1]).toBe(before[1])
  })

  it('remove: filters the ids out; nothing to change returns the same array', () => {
    const before = entries()
    const out = rewriteHistory(before, { type: 'remove', ids: new Set(['b']) }, schemas)
    expect(out.map((e) => e.features.map((f) => f.id))).toEqual([['a'], []])
    expect(rewriteHistory(before, { type: 'remove', ids: new Set(['zzz']) }, schemas)).toBe(before)
  })
})

describe('dataStore: programmatic mutations', () => {
  it('addFeature returns the stored feature; programmatic leaves selection and group context alone', () => {
    const { s } = setup()
    s().addGroup('G')
    const groupId = s().groups[0].id
    // A user add inherits the last active group and selects the new feature.
    useLastActive(s, groupId)
    const user = s().addFeature(pt('u'))
    expect(user).toMatchObject({ id: 'u', groupId, bbox: [0, 45, 0, 45] })
    expect(s().selectedIds).toEqual(['u'])
    // A programmatic one does neither; an explicit groupId is kept only when the group exists.
    s().setSelection(['a'])
    const p = s().addFeature(pt('p'), { programmatic: true })
    expect(p?.groupId).toBeUndefined()
    expect(s().selectedIds).toEqual(['a'])
    expect(s().addFeature({ ...pt('q'), groupId }, { programmatic: true })?.groupId).toBe(groupId)
    expect(s().addFeature({ ...pt('r'), groupId: 'nope' }, { programmatic: true })?.groupId).toBeUndefined()
  })

  it('deleteFeatures: one commit, one undo step, count, selection pruned', () => {
    const { store, s, ids } = setup()
    const onFeatureDelete = vi.fn()
    const onChange = vi.fn()
    subscribeToDataChanges(store, () => ({ onFeatureDelete, onChange }))
    s().setSelection(['a', 'b'])
    expect(s().deleteFeatures(['a', 'c', 'missing'])).toBe(2)
    expect(ids()).toEqual(['b'])
    expect(s().selectedIds).toEqual(['b'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFeatureDelete.mock.calls).toEqual([['a'], ['c']])
    expect(s().undoStack).toHaveLength(1)
    s().undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
  })

  it('deleteFeatures / deleteFeature with only unknown ids: no commit, no undo entry', () => {
    const { store, s } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    expect(s().deleteFeatures(['x'])).toBe(0)
    s().deleteFeature('x')
    expect(listener).not.toHaveBeenCalled()
    expect(s().undoStack).toHaveLength(0)
  })

  it('updateFeatures undoable:true makes geometry-only patches one undo step, without coalescing', () => {
    const { s } = setup()
    s().updateFeatures([{ id: 'a', patch: { geometry: { type: 'Point', coordinates: [1, 1] } } }])
    expect(s().undoStack).toHaveLength(0) // internal callers: geometry pushes nothing (they snapshot themselves)
    s().updateFeatures([{ id: 'a', patch: { geometry: { type: 'Point', coordinates: [2, 2] } } }], { undoable: true })
    s().updateFeatures([{ id: 'a', patch: { properties: { name: 'x' } } }], { undoable: true })
    s().updateFeatures([{ id: 'a', patch: { properties: { name: 'xy' } } }], { undoable: true })
    expect(s().undoStack).toHaveLength(3) // same key within 1 s: still separate steps
    s().updateFeatures([{ id: 'a', patch: { hidden: true } }], { undoable: true })
    expect(s().undoStack).toHaveLength(3) // view state only
  })

  it('undoable:false keeps a server change through the user undoing and redoing earlier edits', () => {
    const { s, ids } = setup()
    // User edit 1: rename b.
    s().updateFeatures([{ id: 'b', patch: { properties: { name: 'user' } } }], { undoable: true })
    // Server: add s, update a, remove c — no undo steps.
    s().addFeature(pt('s', 7), { programmatic: true, undoable: false })
    s().updateFeatures([{ id: 'a', patch: { properties: { name: 'server' } } }], { undoable: false })
    expect(s().deleteFeatures(['c'], { undoable: false })).toBe(1)
    expect(s().undoStack).toHaveLength(1)
    // Undo the user's edit: the server's changes stay.
    s().undo()
    const byId = () => Object.fromEntries(s().features.map((f) => [f.id, f.properties.name]))
    expect(byId()).toEqual({ s: 's', a: 'server', b: 'b' })
    expect(ids()).toEqual(['s', 'a', 'b'])
    // A server change while the edit sits on the redo stack survives redo too.
    s().updateFeatures([{ id: 'a', patch: { properties: { name: 'server2' } } }], { undoable: false })
    s().redo()
    expect(byId()).toEqual({ s: 's', a: 'server2', b: 'user' })
  })
})

describe('uiStore.setEditingMode', () => {
  it('discards every tool draft, route / freehand / measure points included', () => {
    const ds = createDataStore()
    const us = createUIStore(ds)
    us.setState({
      editingMode: 'draw-route',
      routeWaypoints: [[0, 0], [1, 1]], routePreview: [[0, 0]], routeCursorPos: [1, 1],
      freehandPoints: [[0, 0]], measurePoints: [[0, 0]], lineInProgress: [[0, 0]],
    })
    us.getState().setEditingMode('draw-polygon')
    expect(us.getState()).toMatchObject({
      editingMode: 'draw-polygon', routeWaypoints: [], routePreview: null, routeCursorPos: null,
      freehandPoints: [], measurePoints: [], lineInProgress: [],
    })
  })
})

/** Make `groupId` the group new user-drawn shapes land in (what selecting a grouped feature does). */
function useLastActive(s: () => ReturnType<ReturnType<typeof createDataStore>['getState']>, groupId: string) {
  s().moveFeatureToGroup('a', groupId)
  s().selectFeature('a')
}
