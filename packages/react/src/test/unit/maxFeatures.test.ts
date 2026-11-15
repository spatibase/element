import { describe, it, expect, vi } from 'vitest'
// Source imports: '@element-editor/core' resolves to packages/core/dist in vitest.
import { createDataStore, featureLimitMessage } from '../../../../core/src/store/dataStore'
import { createUIStore } from '../../../../core/src/store/uiStore'
import type { GeoJSONFeature } from '../../../../core/src/types/geojson'

const pt = (id: string, x = 14): GeoJSONFeature => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 50] }, properties: {},
})
const fc = (n: number, prefix = 'f') => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => pt(`${prefix}${i}`, i)),
})

/** Messages of the `maxFeatures` refusals reported to `onError` (each an ElementEditorError, code 'limit-reached'). */
const limitMsgs = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.filter(([e]) => e.code === 'limit-reached').map(([e]) => e.message as string)

function setup(max: number | undefined, count: number) {
  const onError = vi.fn()
  const store = createDataStore({ onError })
  store.getState().importGeoJSON(fc(count), 'replace')
  store.getState().setMaxFeatures(max)
  return { store, onError, s: () => store.getState() }
}

describe('maxFeatures enforced in dataStore', () => {
  it('refuses addFeature at the limit and reports why', () => {
    const { s, onError } = setup(2, 2)
    expect(s().addFeature(pt('x'))).toBeNull()
    expect(s().features).toHaveLength(2)
    expect(s().undoStack).toHaveLength(1) // only the import
    expect(limitMsgs(onError)).toContain(featureLimitMessage(2))
    expect(featureLimitMessage(2)).toBe('Maximum of 2 features reached — delete some to add more.')
  })

  it('allows addFeature under the limit', () => {
    const { s, onError } = setup(3, 2)
    expect(s().addFeature(pt('x'))).toMatchObject({ id: 'x' })
    expect(s().features).toHaveLength(3)
    expect(onError).not.toHaveBeenCalled()
  })

  it('refuses duplicateFeature, duplicateSelection and Alt-drag duplicates', () => {
    const { s, onError } = setup(2, 2)
    expect(s().duplicateFeature('f0')).toBe(false)
    s().setSelection(['f0'])
    expect(s().duplicateSelection()).toBe(false)
    expect(s().duplicateFeaturesAtPosition([{ sourceId: 'f0', geometry: pt('g').geometry }])).toBe(false)
    expect(s().features).toHaveLength(2)
    expect(limitMsgs(onError)).toHaveLength(3)
  })

  it('paste is all-or-nothing: refused when the whole clipboard does not fit', () => {
    const { s, onError } = setup(3, 2)
    s().setSelection(['f0', 'f1'])
    s().copySelection()
    expect(s().pasteSelection()).toBe(false) // 2 + 2 > 3
    expect(s().features).toHaveLength(2)
    expect(limitMsgs(onError)).toHaveLength(1)
    s().setMaxFeatures(4)
    expect(s().pasteSelection()).toBe(true)
    expect(s().features).toHaveLength(4)
  })

  it('truncates merge imports to the remaining capacity and reports it', () => {
    const { s, onError } = setup(5, 2)
    const res = s().importGeoJSON(fc(10, 'm'), 'merge')
    expect(res.truncated).toBe(true)
    expect(s().features).toHaveLength(5)
    expect(limitMsgs(onError)).toContain(`Imported 3 of 10 features — ${featureLimitMessage(5)}`)
  })

  it('replace imports ignore existing features but still cap at the limit', () => {
    const { s } = setup(5, 4)
    const res = s().importGeoJSON(fc(7, 'r'), 'replace')
    expect(res.truncated).toBe(true)
    expect(s().features.map((f) => f.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    expect(s().importGeoJSON(fc(5, 'q'), 'replace').truncated).toBe(false)
  })

  it('refuses break-apart when the extra parts would exceed the limit', () => {
    const { s, onError } = setup(3, 1)
    s().addFeature({
      type: 'Feature', id: 'multi', properties: {},
      geometry: { type: 'MultiPoint', coordinates: [[1, 1], [2, 2], [3, 3]] },
    })
    expect(s().breakMultiGeometry('multi')).toBe(false) // 2 + 2 > 3
    expect(s().features).toHaveLength(2)
    expect(limitMsgs(onError)).toContain(featureLimitMessage(3))
    s().setMaxFeatures(4)
    expect(s().breakMultiGeometry('multi')).toBe(true)
    expect(s().features).toHaveLength(4)
  })

  it('allows merge (net change ≤ 0) and undo/redo at the limit', () => {
    const { s, onError } = setup(2, 2)
    s().setSelection(['f0', 'f1'])
    s().mergeFeatures()
    expect(s().features).toHaveLength(1)
    s().undo()
    expect(s().features).toHaveLength(2)
    s().redo()
    s().undo()
    expect(s().features).toHaveLength(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it('drawing commit at the limit is refused and keeps the in-progress shape', () => {
    const onError = vi.fn()
    const ds = createDataStore({ onError })
    const ui = createUIStore(ds)
    ds.getState().setMaxFeatures(0)
    ui.getState().setEditingMode('draw-line')
    ui.setState({ lineInProgress: [[0, 0], [1, 1]] })
    ui.getState().commitLine({})
    expect(ds.getState().features).toHaveLength(0)
    expect(ui.getState().lineInProgress).toHaveLength(2)
    expect(limitMsgs(onError)).toContain(featureLimitMessage(0))
  })

  it('undefined / null maxFeatures means unlimited (unchanged behaviour)', () => {
    for (const max of [undefined, null as unknown as undefined]) {
      const { s, onError } = setup(max, 3)
      expect(s().addFeature(pt('x'))).toMatchObject({ id: 'x' })
      expect(s().duplicateFeature('f0')).toBe(true)
      s().setSelection(['f0', 'f1'])
      expect(s().duplicateSelection()).toBe(true)
      expect(s().importGeoJSON(fc(10, 'm'), 'merge').truncated).toBe(false)
      expect(s().features).toHaveLength(3 + 1 + 1 + 2 + 10)
      expect(onError).not.toHaveBeenCalled()
    }
  })
})
