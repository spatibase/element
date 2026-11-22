// ref.setVertexEdit / getVertexEdit and onVertexEditChange (useAdapterControls), against the stores.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect, useRef } from 'react'
import { act, configure } from '@testing-library/react'
import type { FeatureCollectionInput, GeoJSONFeature } from '@element-editor/core'
import { useAdapterControls, type ElementEditorImperativeAPI, type UseAdapterControlsOptions } from '@element-editor/ui'
import { renderWithProviders, resetStores, testDataStore, testUIStore } from '../helpers'

const line = (id: string, extra: Partial<GeoJSONFeature> = {}) =>
  ({ type: 'Feature', id, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {}, ...extra }) as GeoJSONFeature
const pt = (id: string) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }) as GeoJSONFeature
const data: FeatureCollectionInput = { type: 'FeatureCollection', features: [line('a'), line('b'), pt('p'), line('h', { hidden: true })] }

let warn: ReturnType<typeof vi.spyOn>
const warned = (text: string) => warn.mock.calls.some((c: unknown[]) => String(c[0]).includes(text))

function mount(opts: UseAdapterControlsOptions = {}) {
  let api: ElementEditorImperativeAPI | null = null
  function Harness(props: UseAdapterControlsOptions) {
    api = useAdapterControls(props)
    return null
  }
  renderWithProviders(<Harness {...opts} />)
  return () => api!
}

beforeEach(() => {
  resetStores()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('ref.setVertexEdit', () => {
  it('selects the feature, enters vertex edit, and fires onVertexEditChange once per change', () => {
    const onVertexEditChange = vi.fn()
    const api = mount({ initialData: data, onVertexEditChange })
    let ok = false
    act(() => { ok = api().setVertexEdit('a') })
    expect(ok).toBe(true)
    expect(testDataStore.getState().selectedIds).toEqual(['a'])
    expect(testUIStore.getState()).toMatchObject({ vertexEditFeatureId: 'a', vertexEditActive: true })
    expect(api().getVertexEdit()).toBe('a')
    expect(onVertexEditChange).toHaveBeenCalledTimes(1)
    expect(onVertexEditChange).toHaveBeenLastCalledWith('a')

    act(() => { ok = api().setVertexEdit('a') }) // already on: no-op
    expect(ok).toBe(true)
    expect(onVertexEditChange).toHaveBeenCalledTimes(1)

    act(() => { api().setVertexEdit('b') }) // straight to another feature: one change
    expect(onVertexEditChange).toHaveBeenCalledTimes(2)
    expect(onVertexEditChange).toHaveBeenLastCalledWith('b')

    act(() => { ok = api().setVertexEdit(null) })
    expect(ok).toBe(true)
    expect(api().getVertexEdit()).toBeNull()
    expect(testDataStore.getState().selectedIds).toEqual(['b']) // selection kept
    expect(onVertexEditChange).toHaveBeenLastCalledWith(null)
    expect(onVertexEditChange).toHaveBeenCalledTimes(3)
  })

  it('fires for user-side changes too: Esc-style store flag, deselect, delete', () => {
    const onVertexEditChange = vi.fn()
    const api = mount({ initialData: data, onVertexEditChange })
    act(() => { api().setVertexEdit('a') })
    act(() => testUIStore.getState().setVertexEditActive(false))
    expect(onVertexEditChange).toHaveBeenLastCalledWith(null)
    act(() => testUIStore.getState().setVertexEditActive(true)) // Enter on the selected feature
    expect(onVertexEditChange).toHaveBeenLastCalledWith('a')
    act(() => testDataStore.getState().clearSelection())
    expect(onVertexEditChange).toHaveBeenLastCalledWith(null)
    act(() => { api().setVertexEdit('b') })
    act(() => { api().removeFeatures(['b']) })
    expect(onVertexEditChange).toHaveBeenLastCalledWith(null)
    expect(onVertexEditChange).toHaveBeenCalledTimes(6)
  })

  it('turns a drawing tool off first', () => {
    const api = mount({ initialData: data })
    act(() => { api().setTool('polygon') })
    act(() => { api().setVertexEdit('a') })
    expect(api().getTool()).toBeNull()
    expect(api().getVertexEdit()).toBe('a')
  })

  it('refuses unknown, hidden, point features and readonly, changing nothing', () => {
    const onVertexEditChange = vi.fn()
    const api = mount({ initialData: data, onVertexEditChange })
    act(() => { api().select(['b']) })
    for (const id of ['nope', 'h', 'p']) {
      let ok = true
      act(() => { ok = api().setVertexEdit(id) })
      expect(ok).toBe(false)
    }
    expect(warned('setVertexEdit: no visible feature')).toBe(true)
    expect(warned('setVertexEdit: a Point has no points to edit')).toBe(true)
    act(() => testUIStore.getState().setReadonly(true))
    let ok = true
    act(() => { ok = api().setVertexEdit('a') })
    expect(ok).toBe(false)
    expect(warned('setVertexEdit: the editor is readonly')).toBe(true)
    expect(testDataStore.getState().selectedIds).toEqual(['b'])
    expect(api().getVertexEdit()).toBeNull()
    expect(onVertexEditChange).not.toHaveBeenCalled()
  })
})

describe('ref.setVertexEdit while the editor mounts (StrictMode re-runs effects)', () => {
  // A host's `onReady` runs from an effect declared after the hook's (once per map, ref-guarded
  // like the adapters' onReady). StrictMode runs the mount effects twice; the second pass must not
  // re-apply `initialData` over the entry (a replace load clears the selection, which ends vertex edit).
  beforeEach(() => { configure({ reactStrictMode: true }) })
  afterEach(() => { configure({ reactStrictMode: false }) })
  it('an entry made from a mount effect survives StrictMode and fires onVertexEditChange once', () => {
    const onVertexEditChange = vi.fn()
    let result: boolean | null = null
    function Host() {
      const api = useAdapterControls({ initialData: data, onVertexEditChange })
      const done = useRef(false)
      useEffect(() => {
        if (done.current) return
        done.current = true
        result = api.setVertexEdit('a')
      }, [api])
      return null
    }
    renderWithProviders(<Host />)
    expect(result).toBe(true)
    expect(testUIStore.getState().vertexEditFeatureId).toBe('a')
    expect(testDataStore.getState().selectedIds).toEqual(['a'])
    expect(onVertexEditChange).toHaveBeenCalledTimes(1)
    expect(onVertexEditChange).toHaveBeenCalledWith('a')
  })
})
