/** A replace import is exactly one undo step that restores the previous features, schemas and groups (no file backup). */
import { describe, it, expect } from 'vitest'
import { createDataStore } from '../../../../core/src/store/dataStore'

const pt = (id: string, extra: object = {}) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [0, 0] }, properties: {}, ...extra })

describe('replace import undo', () => {
  it('one Cmd+Z restores the previous features, schemas and groups; redo re-applies the import', () => {
    const s = createDataStore()
    const before = {
      type: 'FeatureCollection',
      features: [pt('old1', { schemaId: 'trees', groupId: 'g1' }), pt('old2')],
      metadata: { schemas: [{ id: 'trees', name: 'Trees', fields: [] }], groups: [{ id: 'g1', name: 'Park' }] },
    }
    s.getState().importGeoJSON(before, 'replace')
    const prev = { features: s.getState().features, schemas: s.getState().schemas, groups: s.getState().groups }
    const depth = s.getState().undoStack.length

    s.getState().importGeoJSON({
      type: 'FeatureCollection',
      features: [pt('new1', { schemaId: 'roads' })],
      metadata: { schemas: [{ id: 'roads', name: 'Roads', fields: [] }] },
    }, 'replace')
    expect(s.getState().features.map((f) => f.id)).toEqual(['new1'])
    expect(s.getState().schemas.map((x) => x.id)).toEqual(['roads'])
    expect(s.getState().groups).toEqual([])
    expect(s.getState().undoStack).toHaveLength(depth + 1)

    s.getState().undo()
    expect(s.getState().features).toEqual(prev.features)
    expect(s.getState().schemas).toEqual(prev.schemas)
    expect(s.getState().groups).toEqual(prev.groups)
    expect(s.getState().undoStack).toHaveLength(depth)

    s.getState().redo()
    expect(s.getState().features.map((f) => f.id)).toEqual(['new1'])
    expect(s.getState().schemas.map((x) => x.id)).toEqual(['roads'])
  })

  it('a merge import is one undo step too', () => {
    const s = createDataStore()
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('a')] }, 'replace')
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('b'), pt('c')] }, 'merge')
    expect(s.getState().features.map((f) => f.id)).toEqual(['a', 'b', 'c'])
    s.getState().undo()
    expect(s.getState().features.map((f) => f.id)).toEqual(['a'])
  })

  it('the initialData load (undoable: false) is not an undo step and clears the history', () => {
    const s = createDataStore()
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('old')] }, 'replace')
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('a'), pt('b')] }, 'replace', { undoable: false })
    expect(s.getState().undoStack).toHaveLength(0)
    expect(s.getState().redoStack).toHaveLength(0)
    s.getState().undo()
    expect(s.getState().features.map((f) => f.id)).toEqual(['a', 'b'])
  })
})
