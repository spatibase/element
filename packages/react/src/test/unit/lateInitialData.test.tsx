// initialData that arrives after mount, the silent `setFeatureCollection`, null geometries, and the
// query methods an app's own code (or agent) needs: getFeature, getTool, canUndo / canRedo, validate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import type { FeatureCollectionInput, GeoJSONFeature } from '@element-editor/core'
import { useAdapterControls, type ElementEditorImperativeAPI, type UseAdapterControlsOptions } from '@element-editor/ui'
import { renderWithProviders, resetStores, testDataStore, testUIStore } from '../helpers'

const pt = (id: string, x = 0) =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 45] }, properties: { name: id } }) as GeoJSONFeature
const fc = (...features: GeoJSONFeature[]): FeatureCollectionInput => ({ type: 'FeatureCollection', features })

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
const warned = (text: string) => warn.mock.calls.some((c: unknown[]) => String(c[0]).includes(text))

/** Mount useAdapterControls; `rerender(opts)` passes new options (e.g. a late initialData). */
function mount(opts: UseAdapterControlsOptions = {}) {
  let api: ElementEditorImperativeAPI | null = null
  function Harness(props: UseAdapterControlsOptions) {
    api = useAdapterControls(props)
    return null
  }
  const r = renderWithProviders(<Harness {...opts} />)
  return {
    api: () => api!,
    rerender: (next: UseAdapterControlsOptions) => r.rerender(<Harness {...next} />),
  }
}

const ids = () => testDataStore.getState().features.map((f) => f.id)

beforeEach(() => {
  resetStores()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('late initialData', () => {
  it('null → data is applied once, silently, without an undo step; a later change is ignored with a warning', () => {
    const onChange = vi.fn()
    const onInitialDataApplied = vi.fn()
    const { rerender } = mount({ initialData: null, onChange, onInitialDataApplied })
    expect(ids()).toEqual([])

    rerender({ initialData: fc(pt('a'), pt('b')), onChange, onInitialDataApplied })
    expect(ids()).toEqual(['a', 'b'])
    expect(testDataStore.getState().undoStack).toHaveLength(0)
    expect(onChange).not.toHaveBeenCalled()
    expect(onInitialDataApplied).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'FeatureCollection' }), true)

    // The same data in a new wrapper (inline `{ type, features }`, JSON.parse per render): no warning.
    rerender({ initialData: fc(pt('a'), pt('b')), onChange, onInitialDataApplied })
    expect(warned('initialData')).toBe(false)

    rerender({ initialData: fc(pt('c')), onChange, onInitialDataApplied })
    expect(ids()).toEqual(['a', 'b'])
    expect(warned('`initialData` changed after the editor loaded its data')).toBe(true)
    expect(warned('setFeatureCollection')).toBe(true)
  })

  it('an empty placeholder collection, then the real data: applied', () => {
    const { rerender } = mount({ initialData: fc() })
    rerender({ initialData: fc(pt('a')) })
    expect(ids()).toEqual(['a'])
  })

  it('data arriving after the user edited is ignored (their edits are kept), with a warning', () => {
    const { api, rerender } = mount({ initialData: undefined })
    act(() => { api().addFeature(pt('mine')) })
    rerender({ initialData: fc(pt('a')) })
    expect(ids()).toEqual(['mine'])
    expect(warned('arrived after the user started editing')).toBe(true)
  })

  it('the mount load fires no onChange either', () => {
    const onChange = vi.fn()
    mount({ initialData: fc(pt('a')), onChange })
    expect(ids()).toEqual(['a'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('features with a null geometry are left out and reported', () => {
    mount({ initialData: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }, pt('a')] } })
    expect(ids()).toEqual(['a'])
    expect(error.mock.calls.some((c: unknown[]) => String((c[0] as Error)?.message ?? c[0]).includes('1 feature in initialData had no usable geometry'))).toBe(true)
  })
})

describe('setFeatureCollection options', () => {
  it('fires onChange by default; { silent: true } fires no data callbacks', () => {
    const onChange = vi.fn()
    const onFeatureAdd = vi.fn()
    const { api } = mount({ onChange, onFeatureAdd })
    act(() => api().setFeatureCollection(fc(pt('a'))))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFeatureAdd).toHaveBeenCalledTimes(1)

    act(() => api().setFeatureCollection(fc(pt('b'), pt('c')), { silent: true }))
    expect(ids()).toEqual(['b', 'c'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFeatureAdd).toHaveBeenCalledTimes(1)

    // Silence lasts for that load only.
    act(() => { api().addFeature(pt('d')) })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('undoable: true by default (one step); false clears the history', () => {
    const { api } = mount()
    act(() => api().setFeatureCollection(fc(pt('a'))))
    expect(api().canUndo()).toBe(true)
    act(() => api().setFeatureCollection(fc(pt('b')), { undoable: false }))
    expect(api().canUndo()).toBe(false)
    expect(ids()).toEqual(['b'])
  })
})

describe('query methods', () => {
  it('getFeature: the stored feature without internal state, null for an unknown id', () => {
    const { api } = mount({ initialData: fc(pt('a', 3)) })
    expect(api().getFeature('a')).toMatchObject({ id: 'a', geometry: { coordinates: [3, 45] } })
    expect(api().getFeature('a')).not.toHaveProperty('_validation')
    expect(api().getFeature('nope')).toBeNull()
  })

  it('getTool / onToolChange follow the active tool; shape operations are not tools', () => {
    const onToolChange = vi.fn()
    const { api } = mount({ onToolChange })
    expect(api().getTool()).toBeNull()
    act(() => { api().setTool('polygon') })
    expect(api().getTool()).toBe('polygon')
    expect(onToolChange).toHaveBeenLastCalledWith('polygon')
    act(() => testUIStore.getState().setEditingMode('cut-hole'))
    expect(api().getTool()).toBeNull()
    expect(onToolChange).toHaveBeenLastCalledWith(null)
    act(() => { api().setTool('measure') })
    expect(onToolChange).toHaveBeenLastCalledWith('measure')
    expect(onToolChange).toHaveBeenCalledTimes(3)
  })

  it('canUndo / canRedo', () => {
    const { api } = mount({ initialData: fc(pt('a')) })
    expect([api().canUndo(), api().canRedo()]).toEqual([false, false])
    act(() => { api().addFeature(pt('b')) })
    expect([api().canUndo(), api().canRedo()]).toEqual([true, false])
    act(() => api().undo())
    expect([api().canUndo(), api().canRedo()]).toEqual([false, true])
  })

  it('validate: checks imported features against their schema, calls nothing; submit uses the same check', () => {
    const onSubmit = vi.fn()
    const onValidationError = vi.fn()
    const schema = { id: 's', name: 'S', fields: [{ key: 'owner', label: 'Owner', type: 'text' as const, required: true }] }
    const { api } = mount({
      initialData: { type: 'FeatureCollection', metadata: { schemas: [schema] }, features: [pt('ok'), { ...pt('bad'), properties: {} }].map((f, i) => (i === 0 ? { ...f, properties: { owner: 'Ann' } } : f)) },
      onSubmit,
      onValidationError,
    })
    expect(api().validate()).toEqual({ valid: false, errors: { bad: ['Missing required property: Owner'] } })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onValidationError).not.toHaveBeenCalled()

    expect(api().submit()).toBe(false)
    expect(onValidationError).toHaveBeenCalledWith({ bad: ['Missing required property: Owner'] })

    act(() => { api().updateFeature('bad', { properties: { owner: 'Bob' } }) })
    expect(api().validate()).toEqual({ valid: true, errors: {} })
    expect(api().submit()).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
