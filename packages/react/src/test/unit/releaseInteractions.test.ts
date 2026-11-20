import { describe, it, expect, vi } from 'vitest'
// Source imports: '@element-editor/core' resolves to packages/core/dist in vitest.
import { createDataStore } from '../../../../core/src/store/dataStore'
import { createUIStore } from '../../../../core/src/store/uiStore'

// Features that ship together in one release must also work together.
function setup() {
  const onError = vi.fn()
  const ds = createDataStore({ onError })
  const ui = createUIStore(ds)
  return { ds, ui, onError, s: () => ds.getState() }
}

describe('replaceAtLimit x coordinates / geometryTypes', () => {
  it('the replacing geometry is rounded by coordinates.precision', () => {
    const { ui, s } = setup()
    s().setMaxFeatures(1)
    s().setReplaceAtLimit(true)
    s().setCoordinateOptions({ precision: 2 })
    ui.getState().commitPoint([1.23456, 2.34567])
    ui.getState().commitPoint([5.55555, 6.66666]) // replaces
    expect(s().features).toHaveLength(1)
    expect(s().features[0].geometry).toEqual({ type: 'Point', coordinates: [5.56, 6.67] })
  })

  it('a replacing draw of a forbidden type is refused and keeps the old shape', () => {
    const { ui, s, onError } = setup()
    s().setMaxFeatures(1)
    s().setReplaceAtLimit(true)
    s().setGeometryTypes(['Point'])
    ui.getState().commitPoint([1, 2])
    const out = s().addFeature({ id: 'x', type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } } as never, { draw: true })
    expect(out).toBeNull()
    expect(s().features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 2] })
    expect(onError.mock.calls.some(([e]) => e.code === 'geometry-type-not-allowed')).toBe(true)
  })
})
