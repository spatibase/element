import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act } from '@testing-library/react'
import { createUIStore, createDataStore, type BBox } from '@element-editor/core'
import { normalizeBounds, normalizeFlyToTarget } from '@element-editor/core/internal'
import { useAdapterControls, useSetMapController, type ElementEditorImperativeAPI, type MapController } from '@element-editor/ui'
import { renderWithProviders, resetStores } from '../helpers'

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
afterEach(() => vi.restoreAllMocks())

describe('normalizeBounds', () => {
  it('passes a bbox through unchanged, without warning', () => {
    const warn = spyWarn()
    const bbox: BBox = [14.2, 49.9, 14.7, 50.2]
    expect(normalizeBounds(bbox)).toBe(bbox)
    expect(warn).not.toHaveBeenCalled()
  })

  it('converts the nested [[s, w], [n, e]] form to [w, s, e, n] and warns once', () => {
    const warn = spyWarn()
    expect(normalizeBounds([[49.9, 14.2], [50.2, 14.7]])).toEqual([14.2, 49.9, 14.7, 50.2])
    expect(normalizeBounds([[1, 2], [3, 4]])).toEqual([2, 1, 4, 3])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('bounds={[14.2,49.9,14.7,50.2]}')
  })

  it('returns undefined for empty or malformed input', () => {
    expect(normalizeBounds(undefined)).toBeUndefined()
    expect(normalizeBounds(null)).toBeUndefined()
    expect(normalizeBounds([1, 2, 3] as unknown as BBox)).toBeUndefined()
    expect(normalizeBounds([[1, 2]] as unknown as BBox)).toBeUndefined()
  })

  it('uiStore.setBounds stores the canonical bbox for either form', () => {
    spyWarn()
    const ui = createUIStore(createDataStore())
    ui.getState().setBounds([[49.9, 14.2], [50.2, 14.7]])
    expect(ui.getState().bounds).toEqual([14.2, 49.9, 14.7, 50.2])
    ui.getState().setBounds([1, 2, 3, 4])
    expect(ui.getState().bounds).toEqual([1, 2, 3, 4])
    ui.getState().setBounds(undefined)
    expect(ui.getState().bounds).toBeUndefined()
  })
})

describe('normalizeFlyToTarget', () => {
  it('object form: [lng, lat] centre, zoom defaults to 15, no warning', () => {
    const warn = spyWarn()
    expect(normalizeFlyToTarget({ center: [14.4, 50.1], zoom: 12 })).toEqual({ center: [14.4, 50.1], zoom: 12 })
    expect(normalizeFlyToTarget({ center: [14.4, 50.1] })).toEqual({ center: [14.4, 50.1], zoom: 15 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('deprecated [lat, lng] tuple form is swapped and warns once', () => {
    const warn = spyWarn()
    expect(normalizeFlyToTarget([50.1, 14.4], 9)).toEqual({ center: [14.4, 50.1], zoom: 9 })
    expect(normalizeFlyToTarget([50.1, 14.4])).toEqual({ center: [14.4, 50.1], zoom: 15 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('flyTo({ center: [14.4, 50.1], zoom: 9 })')
  })

  it('rejects malformed input', () => {
    expect(normalizeFlyToTarget({} as never)).toBeNull()
    expect(normalizeFlyToTarget([1, 2, 3] as never)).toBeNull()
  })
})

describe('ref.flyTo (useAdapterControls)', () => {
  it('both forms reach the map controller as the same [lat, lng] call', () => {
    spyWarn()
    resetStores()
    const flyTo = vi.fn()
    let api: ElementEditorImperativeAPI | null = null
    function Harness() {
      api = useAdapterControls({})
      const setController = useSetMapController()
      useEffect(() => {
        setController({ flyTo, panTo: null, fitBounds: null, getCenter: null, setZoom: null, getZoomBounds: null } as MapController)
      }, [setController])
      return null
    }
    renderWithProviders(<Harness />)
    act(() => {
      api!.flyTo({ center: [14.4, 50.1], zoom: 11 })
      api!.flyTo([50.1, 14.4], 11)
      api!.flyTo({ center: [2.35, 48.85] })
    })
    expect(flyTo.mock.calls).toEqual([[[50.1, 14.4], 11], [[50.1, 14.4], 11], [[48.85, 2.35], 15]])
  })
})
