import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act } from '@testing-library/react'
import type { GeoJSONFeature } from '@element-editor/core'
import { useAdapterControls, useSetMapController, type ElementEditorImperativeAPI, type MapController } from '@element-editor/ui'
import { renderWithProviders, resetStores, testDataStore, testUIStore } from '../helpers'

const pt = (id: string, x = 0): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 45] }, properties: { name: id } })

let warn: ReturnType<typeof vi.spyOn>
const warned = (text: string) => warn.mock.calls.some((c: unknown[]) => String(c[0]).includes(text))

/** Mount useAdapterControls with a fake map controller; returns the ref API, the fake map and the callbacks. */
function mount(opts: Parameters<typeof useAdapterControls>[0] = {}) {
  const fitBounds = vi.fn()
  const map = { fake: 'map' }
  let api: ElementEditorImperativeAPI<typeof map> | null = null
  function Harness() {
    api = useAdapterControls<typeof map>(opts)
    const setController = useSetMapController()
    useEffect(() => {
      setController({ flyTo: null, panTo: null, fitBounds, getCenter: null, setZoom: null, getZoomBounds: null, getMap: () => map } as MapController)
    }, [setController])
    return null
  }
  renderWithProviders(<Harness />)
  testDataStore.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('a', 0), pt('b', 10), pt('c', 20)] }, 'replace')
  testDataStore.setState({ undoStack: [], redoStack: [] })
  return { api: api! as ElementEditorImperativeAPI<typeof map>, map, fitBounds }
}

const ds = () => testDataStore.getState()
const us = () => testUIStore.getState()

beforeEach(() => {
  resetStores()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('ref API', () => {
  it('getMap returns the map from the controller, null before one is registered', () => {
    let early: unknown = 'unset'
    function Early() {
      const api = useAdapterControls({})
      early = api.getMap()
      return null
    }
    renderWithProviders(<Early />)
    expect(early).toBeNull()
    const { api, map } = mount()
    expect(api.getMap()).toBe(map)
  })

  it('addFeature: stored feature, events, undo; leaves selection; rejects bad input', () => {
    const onFeatureAdd = vi.fn()
    const onSelectionChange = vi.fn()
    const { api } = mount({ onFeatureAdd, onSelectionChange })
    api.select(['a'])
    onSelectionChange.mockClear()
    onFeatureAdd.mockClear() // the seed import
    let added: GeoJSONFeature | null = null
    act(() => { added = api.addFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }) }) // no id: the ref assigns a UUID
    expect(added!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(added!).not.toHaveProperty('_validation')
    expect(ds().features[0].id).toBe(added!.id)
    expect(onFeatureAdd).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(api.getSelection()).toEqual(['a'])
    expect(ds().undoStack).toHaveLength(1)

    expect(api.addFeature(pt('a'))).toBeNull()
    expect(warned('already exists')).toBe(true)
    expect(api.addFeature({ type: 'Feature', id: 'z', geometry: { type: 'Nope' }, properties: {} } as never)).toBeNull()
    expect(warned('valid GeoJSON geometry')).toBe(true)
    expect(ds().features).toHaveLength(4)
  })

  it('addFeature honours maxFeatures', () => {
    const { api } = mount()
    ds().setMaxFeatures(3)
    expect(api.addFeature(pt('d'))).toBeNull()
    expect(ds().features).toHaveLength(3)
  })

  it('updateFeature: only patch keys, undoable geometry, unknown id / bad patch → false', () => {
    const onFeatureUpdate = vi.fn()
    const { api } = mount({ onFeatureUpdate })
    expect(api.updateFeature('a', { geometry: { type: 'Point', coordinates: [5, 5] }, id: 'hijack' } as never)).toBe(true)
    expect(ds().features.find((f) => f.id === 'a')!.geometry).toEqual({ type: 'Point', coordinates: [5, 5] })
    expect(ds().features.some((f) => f.id === 'hijack')).toBe(false)
    expect(onFeatureUpdate).toHaveBeenCalledTimes(1)
    expect(ds().undoStack).toHaveLength(1)
    api.undo()
    expect(ds().features.find((f) => f.id === 'a')!.geometry).toEqual({ type: 'Point', coordinates: [0, 45] })

    expect(api.updateFeature('missing', { hidden: true })).toBe(false)
    expect(warned('no feature with id "missing"')).toBe(true)
    expect(api.updateFeature('a', { geometry: { type: 'Point' } } as never)).toBe(false)
    expect(api.updateFeature('a', { properties: [] } as never)).toBe(false)
  })

  it('updateFeature undoable:false adds no undo step', () => {
    const { api } = mount()
    api.updateFeature('a', { properties: { name: 'server' } }, { undoable: false })
    expect(ds().undoStack).toHaveLength(0)
  })

  it('updateFeatures through the ref: one undo step, geometry included; skips unknown ids', () => {
    const { api } = mount()
    api.updateFeatures([
      { id: 'a', patch: { geometry: { type: 'Point', coordinates: [1, 1] } } },
      { id: 'zz', patch: { hidden: true } },
    ])
    expect(ds().undoStack).toHaveLength(1)
    expect(warned('no feature with id "zz"')).toBe(true)
  })

  it('removeFeatures: count, one undo step, onFeatureDelete per feature', () => {
    const onFeatureDelete = vi.fn()
    const { api } = mount({ onFeatureDelete })
    expect(api.removeFeatures(['a', 'b', 'nope'])).toBe(2)
    expect(onFeatureDelete).toHaveBeenCalledTimes(2)
    expect(ds().undoStack).toHaveLength(1)
    expect(warned('"nope"')).toBe(true)
    api.undo()
    expect(ds().features).toHaveLength(3)
  })

  it('select: drops unknown / hidden, fires onSelectionChange, fits the map', () => {
    const onSelectionChange = vi.fn()
    const { api, fitBounds } = mount({ onSelectionChange })
    ds().updateFeature('c', { hidden: true })
    api.select(['a', 'b', 'c', 'ghost'], { fit: true })
    expect(api.getSelection()).toEqual(['a', 'b'])
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 'b'])
    expect(fitBounds).toHaveBeenCalledWith([0, 45, 10, 45])
    expect(warned('"c", "ghost"')).toBe(true)
    // One id goes through selectFeature: the group context follows it.
    ds().addGroup('G')
    const g = ds().groups[0].id
    ds().moveFeatureToGroup('b', g)
    api.select(['b'])
    expect(ds().lastActiveGroupId).toBe(g)
    // Features of a hidden group are not selectable.
    ds().toggleGroupHidden(g)
    api.select(['b'])
    expect(api.getSelection()).toEqual([])
    // getSelection is a copy.
    api.select(['a'])
    api.getSelection().push('x')
    expect(api.getSelection()).toEqual(['a'])
  })

  it('setTool: maps tools to modes, null exits, refuses unknown / search / disabled / readonly / maxFeatures', () => {
    const { api } = mount()
    expect(api.setTool('polygon')).toBe(true)
    expect(us().editingMode).toBe('draw-polygon')
    // Same tool again keeps the shape in progress.
    testUIStore.setState({ polygonInProgress: [[0, 0], [1, 1]] })
    expect(api.setTool('polygon')).toBe(true)
    expect(us().polygonInProgress).toHaveLength(2)
    // Switching discards it.
    expect(api.setTool('rectangle')).toBe(true)
    expect(us()).toMatchObject({ editingMode: 'draw-rect', polygonInProgress: [] })
    expect(api.setTool('picker')).toBe(true)
    expect(us().editingMode).toBe('pick-shape')
    expect(api.setTool(null)).toBe(true)
    expect(us().editingMode).toBe('none')

    expect(api.setTool('search')).toBe(false)
    expect(api.setTool('lasso' as never)).toBe(false)
    expect(api.setTool('toString' as never)).toBe(false)

    us().setEnabledTools(['line', 'measure'])
    expect(api.setTool('polygon')).toBe(false)
    expect(api.setTool('line')).toBe(true)
    us().setEnabledTools(null)

    us().setReadonly(true)
    expect(api.setTool('point')).toBe(false)
    expect(warned('readonly')).toBe(true)
    expect(api.setTool('measure')).toBe(true) // the readonly toolbar keeps Measure
    us().setReadonly(false)

    api.setTool(null)
    ds().setMaxFeatures(3)
    expect(api.setTool('point')).toBe(false)
    expect(api.setTool('measure')).toBe(true)
    expect(us().editingMode).toBe('measure')
  })

  it('mutations and select work in readonly', () => {
    const { api } = mount()
    us().setReadonly(true)
    expect(api.addFeature(pt('d'))).not.toBeNull()
    expect(api.updateFeature('a', { properties: { name: 'x' } })).toBe(true)
    expect(api.removeFeatures(['b'])).toBe(1)
    api.select(['a'])
    expect(api.getSelection()).toEqual(['a'])
  })
})
