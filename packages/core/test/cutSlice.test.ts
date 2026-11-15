/**
 * uiStore commitCutHole / commitSliceShape: routed through the registered geometry runner (the
 * worker client in @element-editor/ui), with a main-thread fallback when none is registered.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Geometry, Polygon } from 'geojson'
import { createDataStore } from '../src/store/dataStore'
import { createUIStore } from '../src/store/uiStore'
import { setGeometryRunner, type GeometryRunner } from '../src/utils/geometryRunner'
import type { GeoJSONFeature } from '../src/types/geojson'

const square: GeoJSONFeature = {
  type: 'Feature', id: 'sq', properties: { name: 'A' },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
}

function setup() {
  const ds = createDataStore()
  ds.getState().importGeoJSON({ type: 'FeatureCollection', features: [square] }, 'replace', { undoable: false })
  ds.setState({ selectedIds: ['sq'] })
  const onError = vi.fn()
  const ui = createUIStore(ds, { onError })
  return { ds, ui, onError }
}

afterEach(() => setGeometryRunner(null))

describe('cut hole / slice routing', () => {
  it('cut hole runs on the main thread when no runner is registered', async () => {
    const { ds, ui, onError } = setup()
    ui.setState({ editingMode: 'cut-hole', polygonInProgress: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75]] })
    await ui.getState().commitCutHole()
    expect(onError).not.toHaveBeenCalled()
    expect((ds.getState().features[0].geometry as Polygon).coordinates).toHaveLength(2) // outer + hole
    expect(ds.getState().undoStack).toHaveLength(1)
  })

  it('cut hole and slice post to the registered runner and apply its result', async () => {
    const result: Geometry = { type: 'MultiPolygon', coordinates: [
      [[[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]],
      [[[0.5, 0], [1, 0], [1, 1], [0.5, 1], [0.5, 0]]],
    ] }
    const runner = vi.fn<GeometryRunner>(async () => result)
    setGeometryRunner(runner)
    const { ds, ui, onError } = setup()
    ui.setState({ editingMode: 'slice-shape', lineInProgress: [[0.5, -1], [0.5, 2]] })
    await ui.getState().commitSliceShape()
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ type: 'slice-shape', line: [[0.5, -1], [0.5, 2]] }))
    expect(onError).not.toHaveBeenCalled()
    expect(ds.getState().features).toHaveLength(2)
    expect(ds.getState().features.every((f) => f.properties.name === 'A')).toBe(true)
    expect(ds.getState().undoStack).toHaveLength(1)
    expect(ui.getState().geometryProcessing).toBe(false)
  })

  it('a runner error is reported, the feature is untouched and processing ends', async () => {
    setGeometryRunner(async () => { throw new Error('Failed to cut hole: resulting shape is empty or invalid.') })
    const { ds, ui, onError } = setup()
    ui.setState({ editingMode: 'cut-hole', polygonInProgress: [[5, 5], [6, 5], [6, 6]] })
    await ui.getState().commitCutHole()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(ds.getState().features[0].geometry).toEqual(square.geometry)
    expect(ui.getState().geometryProcessing).toBe(false)
  })
})

describe('slice only changes the shape when it splits it', () => {
  const sliceWith = async (line: [number, number][], ui: ReturnType<typeof setup>['ui']) => {
    ui.setState({ editingMode: 'slice-shape', lineInProgress: line })
    await ui.getState().commitSliceShape()
  }

  it('main thread: a line across the shape splits it in one undo step', async () => {
    const { ds, ui, onError } = setup()
    await sliceWith([[0.5, -1], [0.5, 2]], ui)
    expect(onError).not.toHaveBeenCalled()
    expect(ds.getState().features).toHaveLength(2)
    expect(ds.getState().undoStack).toHaveLength(1)
  })

  it('main thread: a line that stops inside the shape changes nothing, adds no undo step, and says so', async () => {
    const { ds, ui, onError } = setup()
    const before = ds.getState().features
    await sliceWith([[0.5, -1], [0.5, 0.6]], ui)
    expect(ds.getState().features).toBe(before) // no store write at all
    expect(ds.getState().features[0].geometry).toEqual(square.geometry)
    expect(ds.getState().undoStack).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].message).toMatch(/didn't cut the shape apart, so nothing changed/)
    expect(ui.getState().geometryProcessing).toBe(false)
  })

  it('main thread: a line that misses the shape changes nothing', async () => {
    const { ds, ui, onError } = setup()
    const before = ds.getState().features
    await sliceWith([[2, -1], [2, 2]], ui)
    expect(ds.getState().features).toBe(before)
    expect(ds.getState().undoStack).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('runner: a notched single polygon back from the worker is not applied', async () => {
    const notched: Geometry = { type: 'Polygon', coordinates: [[[0, 0], [0.49, 0], [0.49, 0.6], [0.51, 0.6], [0.51, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    setGeometryRunner(async () => notched)
    const { ds, ui, onError } = setup()
    const before = ds.getState().features
    await sliceWith([[0.5, -1], [0.5, 0.6]], ui)
    expect(ds.getState().features).toBe(before)
    expect(ds.getState().undoStack).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('a two-part shape that comes back in two parts was not split: nothing changes', async () => {
    const twoParts: GeoJSONFeature = {
      type: 'Feature', id: 'mp', properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]],
      ] },
    }
    const ds = createDataStore()
    ds.getState().importGeoJSON({ type: 'FeatureCollection', features: [twoParts] }, 'replace', { undoable: false })
    ds.setState({ selectedIds: ['mp'] })
    const onError = vi.fn()
    const ui = createUIStore(ds, { onError })
    const before = ds.getState().features
    await sliceWith([[0.5, -1], [0.5, 0.6]], ui) // notches the first part only
    expect(ds.getState().features).toBe(before)
    expect(ds.getState().undoStack).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)

    await sliceWith([[0.5, -1], [0.5, 2]], ui) // splits the first part: 3 pieces
    expect(ds.getState().features).toHaveLength(3)
    expect(ds.getState().undoStack).toHaveLength(1)
  })
})
