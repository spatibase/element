import { createDataStore, createUIStore } from '@element-editor/core'
import { DEFAULT_SCHEMAS } from '@element-editor/core/internal'
import { describe, it, expect, beforeEach } from 'vitest'
import type { GeoJSONFeature } from '../../types/geojson'

const POINT_FEATURE: GeoJSONFeature = {
  type: 'Feature',
  id: 'feat-1',
  geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { name: 'Paris' },
}

let dataStore = createDataStore()
let uiStore = createUIStore(dataStore)

beforeEach(() => {
  dataStore = createDataStore()
  uiStore = createUIStore(dataStore)
  uiStore.setState({ editingMode: 'none', lineInProgress: [], dialogState: { type: 'closed' } })
  dataStore.setState({
    features: [],
    schemas: [...DEFAULT_SCHEMAS],
    lastModifiedAt: null,
  })
})

// ─── setEditingMode ───────────────────────────────────────────────────────────

describe('setEditingMode', () => {
  it('sets mode to place-point', () => {
    uiStore.getState().setEditingMode('place-point')
    expect(uiStore.getState().editingMode).toBe('place-point')
  })

  it('sets mode back to none', () => {
    uiStore.setState({ editingMode: 'draw-line' })
    uiStore.getState().setEditingMode('none')
    expect(uiStore.getState().editingMode).toBe('none')
  })
})



// ─── openEditDialog ───────────────────────────────────────────────────────────

describe('openEditDialog', () => {
  it('sets dialogState to edit with the feature id', () => {
    uiStore.getState().openEditDialog('feat-1')
    const state = uiStore.getState().dialogState
    expect(state.type).toBe('edit')
    if (state.type === 'edit') {
      expect(state.featureId).toBe('feat-1')
    }
  })

  it('calls selectFeature on the data store', () => {
    uiStore.getState().openEditDialog('feat-1')
    expect(dataStore.getState().selectedIds[0]).toBe('feat-1')
  })
})

// ─── closeDialog ─────────────────────────────────────────────────────────────

describe('closeDialog', () => {
  it('sets dialogState to closed', () => {
    uiStore.setState({ dialogState: { type: 'new-point', coords: [0, 0] } })
    uiStore.getState().closeDialog()
    expect(uiStore.getState().dialogState.type).toBe('closed')
  })
})

// ─── addLineVertex ────────────────────────────────────────────────────────────

describe('addLineVertex', () => {
  it('appends a coordinate to lineInProgress', () => {
    uiStore.getState().addLineVertex([1, 2])
    uiStore.getState().addLineVertex([3, 4])
    expect(uiStore.getState().lineInProgress).toEqual([[1, 2], [3, 4]])
  })
})

// ─── commitLine ───────────────────────────────────────────────────────────────

describe('commitLine', () => {
  it('adds a LineString feature to dataStore', () => {
    uiStore.setState({ editingMode: 'draw-line', lineInProgress: [[0, 0], [1, 1]] })
    uiStore.getState().commitLine({})
    const features = dataStore.getState().features
    expect(features).toHaveLength(1)
    expect(features[0].geometry.type).toBe('LineString')
    expect(features[0].geometry.coordinates).toEqual([[0, 0], [1, 1]])
  })

  it('selects the new feature in the dataStore', () => {
    uiStore.setState({ editingMode: 'draw-line', lineInProgress: [[0, 0], [1, 1]] })
    uiStore.getState().commitLine({})
    const newFeatureId = dataStore.getState().features[0].id
    expect(dataStore.getState().selectedIds[0]).toBe(newFeatureId)
  })
})

// ─── cancelDrawing ────────────────────────────────────────────────────────────

describe('cancelDrawing', () => {
  it('clears lineInProgress', () => {
    uiStore.setState({ lineInProgress: [[1, 2], [3, 4]] })
    uiStore.getState().cancelDrawing()
    expect(uiStore.getState().lineInProgress).toHaveLength(0)
  })

  it('resets editingMode to none', () => {
    uiStore.setState({ editingMode: 'draw-line' })
    uiStore.getState().cancelDrawing()
    expect(uiStore.getState().editingMode).toBe('none')
  })
})

// ─── cross-store: commitLine + selectFeature ──────────────────────────────────

describe('commitLine + data store integration', () => {
  it('the committed feature has a valid UUID as id', () => {
    uiStore.setState({ lineInProgress: [[0, 0], [1, 1]] })
    uiStore.getState().commitLine({})
    const id = dataStore.getState().features[0].id
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

// ─── measure ──────────────────────────────────────────────────────────────────

describe('measure points', () => {
  it('a repeat click on the last point adds nothing (no zero-length "0 m" segment)', () => {
    const s = () => uiStore.getState()
    s().addMeasurePoint([14.4, 50.08])
    s().addMeasurePoint([14.5, 50.1])
    s().addMeasurePoint([14.5, 50.1]) // the first half of a finishing double-click
    expect(s().measurePoints).toEqual([[14.4, 50.08], [14.5, 50.1]])
    s().completeMeasure()
    expect(s().completedMeasurements.at(-1)!.points).toEqual([[14.4, 50.08], [14.5, 50.1]])
    expect(s().measurePoints).toEqual([])
  })

  it('the same spot again later in the path is still a point', () => {
    const s = () => uiStore.getState()
    s().addMeasurePoint([0, 0])
    s().addMeasurePoint([1, 0])
    s().addMeasurePoint([0, 0])
    expect(s().measurePoints).toHaveLength(3)
  })
})
