import { describe, it, expect, beforeEach } from 'vitest'
import { createDataStore } from '@element-editor/core'
import { DEFAULT_SCHEMAS } from '@element-editor/core/internal'
import { createDataStore as createSrcDataStore } from '../../../../core/src/store/dataStore'
import type { GeoJSONFeature } from '../../types/geojson'

let store = createDataStore()

const INITIAL_STATE = {
  features: [],
  schemas: [...DEFAULT_SCHEMAS],
  groups: [],
  selectedIds: [],
  featureSnapshot: null,
  lastExportedAt: null,
  lastModifiedAt: null,
}

const pointA: GeoJSONFeature = {
  type: 'Feature',
  id: 'a',
  geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { name: 'Paris' },
}

const pointB: GeoJSONFeature = {
  type: 'Feature',
  id: 'b',
  geometry: { type: 'Point', coordinates: [2.17, 41.38] },
  properties: { name: 'Barcelona' },
}

const lineC: GeoJSONFeature = {
  type: 'Feature',
  id: 'c',
  geometry: { type: 'LineString', coordinates: [[2.17, 41.38], [2.35, 48.85]] },
  properties: { name: 'Route' },
}

/** Helper: get the default schema from current store state */
function defaultSchema() {
  return store.getState().getDefaultSchema()
}

beforeEach(() => {
  store = createDataStore()
  store.setState(INITIAL_STATE)
})

// ─── addFeature ───────────────────────────────────────────────────────────────

describe('addFeature', () => {
  it('appends the feature to the list', () => {
    store.getState().addFeature(pointA)
    expect(store.getState().features).toHaveLength(1)
    expect(store.getState().features[0].id).toBe('a')
  })
})

// ─── updateFeature ────────────────────────────────────────────────────────────

describe('updateFeature', () => {
  beforeEach(() => {
    store.setState({ features: [pointA, pointB] })
  })

  it('updates only the target feature properties', () => {
    store.getState().updateFeature('a', { properties: { name: 'Updated Paris' } })
    const updated = store.getState().features.find((f) => f.id === 'a')
    expect(updated?.properties.name).toBe('Updated Paris')
  })
})

// ─── deleteFeature ────────────────────────────────────────────────────────────

describe('deleteFeature', () => {
  beforeEach(() => {
    store.setState({ features: [pointA, pointB] })
  })

  it('removes the feature from the list', () => {
    store.getState().deleteFeature('a')
    const ids = store.getState().features.map((f) => f.id)
    expect(ids).not.toContain('a')
  })

  it('selects the next feature when the single selected feature is deleted', () => {
    store.setState({ selectedIds: ['a'] })
    store.getState().deleteFeature('a')
    expect(store.getState().selectedIds).toEqual(['b'])
  })

  it('clears selection when the last remaining feature is deleted', () => {
    store.setState({ features: [pointA], selectedIds: ['a'] })
    store.getState().deleteFeature('a')
    expect(store.getState().selectedIds).toEqual([])
  })

  it('does not clear selection when a different feature is deleted', () => {
    store.setState({ selectedIds: ['b'] })
    store.getState().deleteFeature('a')
    expect(store.getState().selectedIds).toEqual(['b'])
  })
})

// ─── selectFeature ────────────────────────────────────────────────────────────

describe('selectFeature', () => {
  it('sets selectedIds to a single item', () => {
    store.getState().selectFeature('a')
    expect(store.getState().selectedIds).toEqual(['a'])
  })

  it('clears selection with null', () => {
    store.setState({ selectedIds: ['a'] })
    store.getState().selectFeature(null)
    expect(store.getState().selectedIds).toEqual([])
  })
})

// ─── toggleSelection ────────────────────────────────────────────────────────

describe('toggleSelection', () => {
  it('adds a feature to selectedIds', () => {
    store.getState().toggleSelection('a')
    expect(store.getState().selectedIds).toContain('a')
  })

  it('removes a feature from selectedIds if already present', () => {
    store.setState({ selectedIds: ['a', 'b'] })
    store.getState().toggleSelection('a')
    expect(store.getState().selectedIds).toEqual(['b'])
  })
})

// ─── undo ─────────────────────────────────────────────────────────────────────

describe('undo', () => {
  it('restores features from snapshot', () => {
    store.setState({ features: [pointA, pointB], undoStack: [{ features: [pointA, pointB, lineC] }] })
    store.getState().undo()
    expect(store.getState().features).toHaveLength(3)
  })

  it('clears selection after undo', () => {
    store.setState({ selectedIds: ['a'], undoStack: [{ features: [] }] })
    store.getState().undo()
    expect(store.getState().selectedIds).toEqual([])
  })
})

describe('updateFeaturesFromEditor', () => {
  it('keeps the store objects passed through and pushes one undo entry', () => {
    store.getState().addFeature(pointA)
    store.getState().addFeature(pointB)
    const [a, b] = store.getState().features
    const undo = store.getState().undoStack.length
    store.getState().updateFeaturesFromEditor({ type: 'FeatureCollection', features: [a, { ...b, properties: { name: 'Typed' } }] })
    const [a2, b2] = store.getState().features
    expect(a2).toBe(a)
    expect(b2).not.toBe(b)
    expect(b2.properties.name).toBe('Typed')
    expect(store.getState().undoStack.length).toBe(undo + 1)
  })

  it('removes features deleted in the text, and drops them from the selection', () => {
    store.getState().addFeature(pointA)
    store.getState().addFeature(pointB)
    const [a, b] = store.getState().features
    store.getState().setSelection([a.id, b.id])
    store.getState().updateFeaturesFromEditor({ type: 'FeatureCollection', features: [a] })
    expect(store.getState().features).toEqual([a])
    expect(store.getState().selectedIds).toEqual([a.id])
    store.getState().updateFeaturesFromEditor({ type: 'FeatureCollection', features: [] })
    expect(store.getState().features).toEqual([])
    expect(store.getState().selectedIds).toEqual([])
  })

  it('writes nothing while a feature has no valid geometry or isn\'t a Feature', () => {
    const store = createSrcDataStore() // this file's store is core's dist; the guard is in source
    store.getState().addFeature(pointA)
    store.getState().addFeature(pointB)
    const before = store.getState().features
    const undo = store.getState().undoStack.length
    const { geometry, ...noGeometry } = before[1]
    void geometry
    for (const bad of [
      noGeometry,
      { ...before[1], geometry: null },
      { ...before[1], geometry: { type: 'Poin', coordinates: [1, 2] } },
      { ...before[1], geometry: { type: 'Point' } },
      { ...before[1], geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point' }] } },
      { ...before[1], type: 'Featur' },
      null,
    ]) {
      store.getState().updateFeaturesFromEditor({ type: 'FeatureCollection', features: [before[0], bad] })
      expect(store.getState().features).toBe(before)
    }
    expect(store.getState().undoStack.length).toBe(undo)
  })
})

// ─── schema undo ──────────────────────────────────────────────────────────────

describe('schema undo', () => {
  it('delete schema → undo restores the schema and features keep their schemaId; redo deletes again', () => {
    const id = store.getState().addSchema('Trees', [{ key: 'height', label: 'Height', type: 'number', required: false }])
    store.getState().addFeature({ ...pointA, schemaId: id })
    const before = store.getState().schemas
    store.getState().deleteSchema(id)
    expect(store.getState().schemas.some((s) => s.id === id)).toBe(false)
    store.getState().undo()
    expect(store.getState().schemas).toBe(before)
    expect(store.getState().features[0].schemaId).toBe(id)
    store.getState().redo()
    expect(store.getState().schemas.some((s) => s.id === id)).toBe(false)
  })

  it('refuses to delete the last schema', () => {
    store.setState({ schemas: [DEFAULT_SCHEMAS[0]], undoStack: [] })
    store.getState().deleteSchema(DEFAULT_SCHEMAS[0].id)
    expect(store.getState().schemas).toHaveLength(1)
    expect(store.getState().undoStack).toHaveLength(0)
  })

  it('remove field → undo restores it, property data untouched throughout', () => {
    const id = store.getState().addSchema('Trees', [{ key: 'height', label: 'Height', type: 'number', required: false }])
    store.getState().addFeature({ ...pointA, schemaId: id, properties: { name: 'Oak', height: 12 } })
    store.getState().removeSchemaField(id, 'height')
    const fields = () => store.getState().schemas.find((s) => s.id === id)!.fields.map((f) => f.key)
    expect(fields()).not.toContain('height')
    expect(store.getState().features[0].properties.height).toBe(12)
    store.getState().undo()
    expect(fields()).toContain('height')
    expect(store.getState().features[0].properties.height).toBe(12)
    store.getState().redo()
    expect(fields()).not.toContain('height')
  })

  it('rename field → undo restores key on schema and features', () => {
    const id = store.getState().addSchema('Trees', [{ key: 'h', label: 'h', type: 'text', required: false }])
    store.getState().addFeature({ ...pointA, schemaId: id, properties: { name: 'Oak', h: 'tall' } })
    store.getState().updateSchemaField(id, 'h', { key: 'height', label: 'Height' })
    expect(store.getState().features[0].properties.height).toBe('tall')
    store.getState().undo()
    expect(store.getState().features[0].properties.h).toBe('tall')
    expect(store.getState().schemas.find((s) => s.id === id)!.fields[0].key).toBe('h')
  })

  it('consecutive edits of the same field props coalesce into one undo step', () => {
    const id = store.getState().addSchema('Trees', [{ key: 'height', label: 'Height', type: 'number', required: false }])
    const depth = store.getState().undoStack.length
    store.getState().updateSchemaField(id, 'height', { min: 1 })
    store.getState().updateSchemaField(id, 'height', { min: 12 })
    store.getState().updateSchemaField(id, 'height', { min: 123 })
    expect(store.getState().undoStack.length).toBe(depth + 1)
    store.getState().undo()
    expect(store.getState().schemas.find((s) => s.id === id)!.fields[0].min).toBeUndefined()
  })

  it('add schema / rename schema are undoable', () => {
    const id = store.getState().addSchema('Trees')
    store.getState().updateSchema(id, { name: 'Forest' })
    store.getState().undo()
    expect(store.getState().schemas.find((s) => s.id === id)!.name).toBe('Trees')
    store.getState().undo()
    expect(store.getState().schemas.some((s) => s.id === id)).toBe(false)
  })
})

// ─── feature data undo ────────────────────────────────────────────────────────

describe('feature data undo', () => {
  beforeEach(() => {
    store.setState({ features: [pointA, pointB], undoStack: [], redoStack: [] })
  })
  const a = () => store.getState().features.find((f) => f.id === 'a')!
  const depth = () => store.getState().undoStack.length

  it('cell edit (one property) → undo restores, redo reapplies', () => {
    store.getState().updateFeature('a', { properties: { ...pointA.properties, pop: 2 } })
    expect(depth()).toBe(1)
    store.getState().undo()
    expect(a().properties.pop).toBeUndefined()
    store.getState().redo()
    expect(a().properties.pop).toBe(2)
  })

  it('no-op edit (same values, new object) pushes no step', () => {
    store.getState().updateFeature('a', { properties: { ...pointA.properties } })
    store.getState().updateFeature('a', { schemaId: a().schemaId })
    store.getState().updateFeature('a', { hidden: true })
    expect(depth()).toBe(0)
  })

  it('schemaId change → undo restores the old schemaId', () => {
    const id = store.getState().addSchema('Trees')
    const old = a().schemaId
    store.getState().updateFeature('a', { schemaId: id })
    store.getState().undo()
    expect(a().schemaId).toBe(old)
  })

  it('rename → undo; per-keystroke typing of the same key coalesces', () => {
    for (const name of ['P', 'Pa', 'Par']) store.getState().updateFeature('a', { properties: { ...a().properties, name } })
    expect(depth()).toBe(1)
    store.getState().undo()
    expect(a().properties.name).toBe('Paris')
  })

  it('edits of different features are separate steps', () => {
    store.getState().updateFeature('a', { properties: { name: 'A' } })
    store.getState().updateFeature('b', { properties: { name: 'B' } })
    expect(depth()).toBe(2)
  })

  it('geometry + properties = one step (caller snapshots, updateFeature does not push)', () => {
    store.getState().takeSnapshot()
    store.getState().updateFeature('a', { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Moved' } })
    expect(depth()).toBe(1)
    store.getState().undo()
    expect(a().properties.name).toBe('Paris')
    expect(a().geometry.coordinates).toEqual([2.35, 48.85])
  })
})
