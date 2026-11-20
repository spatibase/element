import { describe, it, expect, vi } from 'vitest'
// Source imports: '@element-editor/core' resolves to packages/core/dist in vitest.
import { createDataStore, featureLimitMessage } from '../../../../core/src/store/dataStore'
import { createUIStore } from '../../../../core/src/store/uiStore'
import { subscribeToDataChanges } from '../../../../core/src/utils/subscribeToDataChanges'

function setup(opts: { max?: number; replace?: boolean } = { max: 1, replace: true }) {
  const onError = vi.fn()
  const ds = createDataStore({ onError })
  const ui = createUIStore(ds)
  ds.getState().setMaxFeatures(opts.max)
  ds.getState().setReplaceAtLimit(opts.replace ?? false)
  return { ds, ui, onError, s: () => ds.getState() }
}
const limitMsgs = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(([e]) => e.code === 'limit-reached')

describe('replaceAtLimit', () => {
  it('a draw commit replaces the only feature: same id / properties / schema, one undo step', () => {
    const { ds, ui, s, onError } = setup()
    ui.getState().commitPoint([1, 2])
    const first = s().features[0]
    s().updateFeature(first.id, { properties: { name: 'Home' } })
    const undoDepth = s().undoStack.length
    ui.getState().commitPoint([5, 6])
    expect(s().features).toHaveLength(1)
    const f = s().features[0]
    expect(f.id).toBe(first.id)
    expect(f.properties).toMatchObject({ name: 'Home' })
    expect(f.schemaId).toBe(first.schemaId)
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [5, 6] })
    expect(f.bbox).toEqual([5, 6, 5, 6])
    expect(s().selectedIds).toEqual([first.id])
    expect(s().undoStack).toHaveLength(undoDepth + 1)
    expect(onError).not.toHaveBeenCalled()
    s().undo()
    expect(s().features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 2] })
    expect(ds.getState().features[0].id).toBe(first.id)
  })

  it('notifies once as an update (not add / delete)', () => {
    const { ds, ui } = setup()
    ui.getState().commitPoint([1, 2])
    const cb = { onChange: vi.fn(), onFeatureAdd: vi.fn(), onFeatureUpdate: vi.fn(), onFeatureDelete: vi.fn() }
    subscribeToDataChanges(ds, () => cb)
    ui.getState().commitPoint([5, 6])
    expect(cb.onChange).toHaveBeenCalledTimes(1)
    expect(cb.onFeatureUpdate).toHaveBeenCalledTimes(1)
    expect(cb.onFeatureAdd).not.toHaveBeenCalled()
    expect(cb.onFeatureDelete).not.toHaveBeenCalled()
  })

  it('_drawType follows the new drawing', () => {
    const { ui, s } = setup()
    ui.getState().commitCircle([0, 0], [1, 0], {})
    expect(s().features[0]._drawType).toBe('circle')
    const id = s().features[0].id
    ui.setState({ polygonInProgress: [[0, 0], [1, 0], [1, 1]] })
    ui.getState().commitPolygon({})
    expect(s().features).toHaveLength(1)
    expect(s().features[0].id).toBe(id)
    expect(s().features[0]._drawType).toBeUndefined()
    expect(s().features[0].geometry.type).toBe('Polygon')
    ui.getState().commitRect([0, 0], [1, 1], {})
    expect(s().features[0]._drawType).toBe('rectangle')
    expect(s().features[0].id).toBe(id)
  })

  it('canDraw passes at the limit with the flag, refuses without it', () => {
    const { s, ui, onError } = setup()
    ui.getState().commitPoint([1, 2])
    expect(s().canDraw()).toBe(true)
    s().setReplaceAtLimit(false)
    expect(s().canDraw()).toBe(false)
    expect(limitMsgs(onError)).toHaveLength(1)
  })

  it('paste, duplicate, addFeature and import merge still refuse at the limit', () => {
    const { s, ui, onError } = setup()
    ui.getState().commitPoint([1, 2])
    const id = s().features[0].id
    s().setSelection([id])
    s().copySelection()
    expect(s().pasteSelection()).toBe(false)
    expect(s().duplicateFeature(id)).toBe(false)
    expect(s().addFeature({ type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [9, 9] }, properties: {} })).toBeNull()
    s().importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'm', geometry: { type: 'Point', coordinates: [3, 3] }, properties: {} }] }, 'merge')
    expect(s().features).toHaveLength(1)
    expect(s().features[0].id).toBe(id)
    expect(s().features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 2] })
    expect(limitMsgs(onError).length).toBeGreaterThanOrEqual(4)
    expect(limitMsgs(onError)[0][0].message).toBe(featureLimitMessage(1))
  })

  it('search-result adds (point and shape, draw: true) replace like a draw tool', () => {
    const { s, ui, onError } = setup()
    ui.getState().commitPoint([1, 2])
    const id = s().features[0].id
    const point = { type: 'Feature' as const, id: 'n1', schemaId: s().features[0].schemaId, geometry: { type: 'Point' as const, coordinates: [7, 8] as [number, number] }, properties: { name: 'Prague' } }
    expect(s().addFeature(point, { draw: true })).toMatchObject({ id })
    const shape = { type: 'Feature' as const, id: 'n2', schemaId: 'boundaries', geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { name: 'Area' } }
    expect(s().addFeature(shape, { draw: true })).toMatchObject({ id })
    expect(s().features).toHaveLength(1)
    expect(s().features[0].geometry.type).toBe('Polygon')
    expect(s().features[0].schemaId).toBe(point.schemaId)
    expect(onError).not.toHaveBeenCalled()
  })

  it('import replace and an empty editor behave as before', () => {
    const { s, ui } = setup()
    ui.getState().commitPoint([1, 2]) // empty: a normal add
    expect(s().features).toHaveLength(1)
    s().importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'r', geometry: { type: 'Point', coordinates: [3, 3] }, properties: {} }] }, 'replace')
    expect(s().features.map((f) => f.id)).toEqual(['r'])
  })

  it('is ignored when maxFeatures is not 1', () => {
    const { s, ui, onError } = setup({ max: 2, replace: true })
    ui.getState().commitPoint([1, 2])
    ui.getState().commitPoint([3, 4])
    expect(s().features).toHaveLength(2)
    ui.getState().commitPoint([5, 6]) // at the limit: refused, not replaced
    expect(s().features).toHaveLength(2)
    expect(limitMsgs(onError)).toHaveLength(1)
    const u = setup({ max: undefined, replace: true })
    u.ui.getState().commitPoint([1, 2])
    u.ui.getState().commitPoint([3, 4])
    expect(u.s().features).toHaveLength(2)
  })
})
