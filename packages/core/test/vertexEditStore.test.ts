/**
 * Vertex edit in uiStore: `vertexEditFeatureId` is the source of truth, `vertexEditActive` follows it;
 * `setVertexEditActive` (the keyboard paths) maps to the single selected feature; an empty
 * selection ends vertex edit; `canVertexEdit` is the geometry rule `ref.setVertexEdit` applies.
 */
import { describe, it, expect } from 'vitest'
import { createDataStore, canVertexEdit } from '../src/store/dataStore'
import { createUIStore } from '../src/store/uiStore'
import type { GeoJSONFeature } from '../src/types/geojson'

const line = (id: string): GeoJSONFeature => ({ type: 'Feature', id, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} })

function stores() {
  const ds = createDataStore()
  ds.getState().addFeature(line('a'))
  ds.getState().addFeature(line('b'))
  ds.getState().clearSelection()
  const ui = createUIStore(ds)
  return { ds, ui }
}

describe('vertex edit state', () => {
  it('setVertexEditFeature sets the id and keeps vertexEditActive in step', () => {
    const { ui } = stores()
    ui.getState().setVertexEditFeature('a')
    expect(ui.getState()).toMatchObject({ vertexEditFeatureId: 'a', vertexEditActive: true })
    ui.getState().setVertexEditFeature(null)
    expect(ui.getState()).toMatchObject({ vertexEditFeatureId: null, vertexEditActive: false })
  })

  it('setting the same id again is not a state change', () => {
    const { ui } = stores()
    ui.getState().setVertexEditFeature('a')
    let changes = 0
    const off = ui.subscribe(() => { changes++ })
    ui.getState().setVertexEditFeature('a')
    off()
    expect(changes).toBe(0)
  })

  it('setVertexEditActive(true) uses the single selected feature, and nothing without one', () => {
    const { ds, ui } = stores()
    ui.getState().setVertexEditActive(true)
    expect(ui.getState().vertexEditActive).toBe(false)
    ds.getState().selectFeature('b')
    ui.getState().setVertexEditActive(true)
    expect(ui.getState().vertexEditFeatureId).toBe('b')
    ui.getState().setVertexEditActive(false)
    expect(ui.getState().vertexEditFeatureId).toBeNull()
  })

  it('an empty selection (deselect, delete) ends vertex edit', () => {
    const { ds, ui } = stores()
    ds.getState().selectFeature('a')
    ui.getState().setVertexEditFeature('a')
    ds.getState().deleteFeatures(['a'])
    expect(ui.getState()).toMatchObject({ vertexEditFeatureId: null, vertexEditActive: false })
  })

  it('canVertexEdit: lines and polygons only', () => {
    expect(canVertexEdit(line('x'))).toBe(true)
    expect(canVertexEdit({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })).toBe(true)
    expect(canVertexEdit({ geometry: { type: 'Point', coordinates: [0, 0] } })).toBe(false)
    expect(canVertexEdit({ geometry: { type: 'MultiPolygon', coordinates: [] } })).toBe(false)
    expect(canVertexEdit(undefined)).toBe(false)
  })
})
