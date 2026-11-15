/**
 * Every user command is exactly ONE undo step: the undo stack grows by one, and one undo
 * restores the state from before the command. (Boolean ops used to push one entry per deleted
 * feature + one for the added result, so the first Cmd+Z showed an empty map.)
 */
import { describe, it, expect } from 'vitest'
import { createDataStore, type DataStore } from '../../../../core/src/store/dataStore'
import { createUIStore } from '../../../../core/src/store/uiStore'
import type { GeoJSONFeature } from '../../types/geojson'

type Store = ReturnType<typeof createDataStore>

const square = (id: string, x: number, extra: Partial<GeoJSONFeature> = {}): GeoJSONFeature => ({
  type: 'Feature', id, properties: { name: id },
  geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
  ...extra,
})
const multi = (id: string): GeoJSONFeature => ({
  type: 'Feature', id, properties: {},
  geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1], [2, 2]] },
})

function seeded(features: GeoJSONFeature[] = [square('a', 0), square('b', 2), square('c', 4)]): Store {
  const s = createDataStore()
  s.getState().importGeoJSON({ type: 'FeatureCollection', features }, 'replace', { undoable: false })
  return s
}

/** Runs `action`, asserts it pushed exactly one undo entry and that one undo restores the features/groups/schemas. */
function expectOneStep(s: Store, action: (st: DataStore) => unknown) {
  const before = { features: s.getState().features, groups: s.getState().groups, schemas: s.getState().schemas }
  const depth = s.getState().undoStack.length
  action(s.getState())
  expect(s.getState().undoStack).toHaveLength(depth + 1)
  s.getState().undo()
  expect(s.getState().features).toEqual(before.features)
  expect(s.getState().groups).toEqual(before.groups)
  expect(s.getState().schemas).toEqual(before.schemas)
}

describe('one undo step per command', () => {
  it('replaceFeatures (boolean ops) — even with more selected features than the undo depth', () => {
    const many = Array.from({ length: 30 }, (_, i) => square(`f${i}`, i * 2))
    const s = seeded(many)
    expectOneStep(s, (st) => st.replaceFeatures(many.map((f) => f.id), [square('u', 0)]))
    expect(s.getState().features).toHaveLength(30)
  })

  it('replaceFeatures selects the result and drops _drawType from a freeGeometry patch', async () => {
    const { freeGeometry } = await import('../../../../core/src/store/dataStore')
    const s = seeded([square('a', 0, { _drawType: 'rectangle' }), square('b', 2)])
    s.getState().replaceFeatures(['a', 'b'], [{ ...s.getState().features[0], id: 'u', ...freeGeometry(square('x', 0).geometry) }])
    const u = s.getState().features.find((f) => f.id === 'u')!
    expect('_drawType' in u).toBe(false)
    expect(s.getState().selectedIds).toEqual(['u'])
    expect(s.getState().features.map((f) => f.id)).toEqual(['u'])
  })

  it('duplicateFeature', () => expectOneStep(seeded(), (st) => st.duplicateFeature('a')))
  it('duplicateSelection', () => { const s = seeded(); s.getState().setSelection(['a', 'b']); expectOneStep(s, (st) => st.duplicateSelection()) })
  it('pasteSelection', async () => {
    const s = seeded(); s.getState().setSelection(['a', 'b'])
    await s.getState().copySelection()
    expectOneStep(s, (st) => st.pasteSelection())
  })
  it('deleteSelection (several features)', () => { const s = seeded(); s.getState().setSelection(['a', 'b', 'c']); expectOneStep(s, (st) => st.deleteSelection()) })
  it('deleteFeatures', () => expectOneStep(seeded(), (st) => st.deleteFeatures(['a', 'c'])))
  it('groupSelection', () => { const s = seeded(); s.getState().setSelection(['a', 'b']); expectOneStep(s, (st) => st.groupSelection('G')) })
  it('ungroupSelection', () => {
    const s = seeded(); s.getState().setSelection(['a', 'b']); s.getState().groupSelection('G'); s.getState().setSelection(['a', 'b'])
    expectOneStep(s, (st) => st.ungroupSelection())
  })
  it('renaming a group', () => {
    const s = seeded(); s.getState().setSelection(['a']); const g = s.getState().groupSelection('G')!
    expectOneStep(s, (st) => st.updateGroup(g, { name: 'Renamed' }))
  })
  it('deleteGroup with its features', () => {
    const s = seeded(); s.getState().setSelection(['a', 'b']); const g = s.getState().groupSelection('G')!
    expectOneStep(s, (st) => st.deleteGroup(g, 'delete-features'))
  })
  it('mergeFeatures', () => { const s = seeded(); s.getState().setSelection(['a', 'b', 'c']); expectOneStep(s, (st) => st.mergeFeatures()) })
  it('breakMultiGeometry', () => expectOneStep(seeded([multi('m')]), (st) => st.breakMultiGeometry('m')))
  it('importGeoJSON merge', () => expectOneStep(seeded(), (st) => st.importGeoJSON({ type: 'FeatureCollection', features: [square('x', 9), square('y', 11)] }, 'merge')))
  it('schema add / field add / field remove / delete', () => {
    const s = seeded()
    let id = ''
    expectOneStep(s, (st) => { id = st.addSchema('Trees') })
    id = s.getState().addSchema('Trees')
    expectOneStep(s, (st) => st.addSchemaField(id, { key: 'height', label: 'Height', type: 'number' } as never))
    s.getState().addSchemaField(id, { key: 'height', label: 'Height', type: 'number' } as never)
    expectOneStep(s, (st) => st.removeSchemaField(id, 'height'))
    expectOneStep(s, (st) => st.deleteSchema(id))
  })
})

describe('uiStore commands are one undo step', () => {
  function withUi(features: GeoJSONFeature[]) {
    const ds = seeded(features)
    const ui = createUIStore(ds)
    return { ds, ui }
  }

  it('commitGeometryProcess (simplify / smooth) clears _drawType', () => {
    const { ds, ui } = withUi([square('r', 0, { _drawType: 'rectangle' })])
    ds.getState().selectFeature('r')
    ui.setState({ geometryPreview: square('x', 0).geometry, editingMode: 'simplify' as never })
    expectOneStep(ds, () => ui.getState().commitGeometryProcess())
    ds.getState().redo()
    expect('_drawType' in ds.getState().features[0]).toBe(false)
  })

  it('commitBufferProcess (replace and create-new) clears _drawType', () => {
    const { ds, ui } = withUi([square('c', 0, { _drawType: 'circle' })])
    ds.getState().selectFeature('c')
    ui.setState({ geometryPreview: square('x', 0).geometry, bufferCreateNew: false })
    expectOneStep(ds, () => ui.getState().commitBufferProcess())
    ds.getState().redo()
    expect('_drawType' in ds.getState().features[0]).toBe(false)
    ds.getState().selectFeature('c')
    ui.setState({ geometryPreview: square('x', 0).geometry, bufferCreateNew: true })
    expectOneStep(ds, () => ui.getState().commitBufferProcess())
  })

  it('commitCutHole clears _drawType', async () => {
    const big: GeoJSONFeature = { ...square('r', 0), _drawType: 'rectangle', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } }
    const { ds, ui } = withUi([big])
    ds.getState().selectFeature('r')
    const depth = ds.getState().undoStack.length
    ui.setState({ polygonInProgress: [[2, 2], [4, 2], [4, 4]] })
    await ui.getState().commitCutHole()
    expect(ds.getState().undoStack).toHaveLength(depth + 1)
    const r = ds.getState().features[0]
    expect((r.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2)
    expect('_drawType' in r).toBe(false)
  })

  it('commitSliceShape: one step, no part keeps _drawType', async () => {
    const big: GeoJSONFeature = { ...square('r', 0), _drawType: 'rectangle', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } }
    const { ds, ui } = withUi([big])
    ds.getState().selectFeature('r')
    const depth = ds.getState().undoStack.length
    ui.setState({ lineInProgress: [[5, -1], [5, 11]] })
    await ui.getState().commitSliceShape()
    expect(ds.getState().undoStack).toHaveLength(depth + 1)
    expect(ds.getState().features).toHaveLength(2)
    for (const f of ds.getState().features) expect('_drawType' in f).toBe(false)
    ds.getState().undo()
    expect(ds.getState().features).toHaveLength(1)
    expect(ds.getState().features[0]._drawType).toBe('rectangle')
  })
})
