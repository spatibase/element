import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGeoJSONExport } from '@element-editor/ui'
import type { FeatureCollection } from '@element-editor/core'

const SAMPLE_FC: FeatureCollection = {
  type: 'FeatureCollection',
  metadata: { schemas: [], groups: [] },
  features: [
    { type: 'Feature', id: 'paris', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: { name: 'Paris' } },
    { type: 'Feature', id: 'london', geometry: { type: 'Point', coordinates: [-0.1, 51.5] }, properties: { name: 'London' } },
  ],
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [], metadata: { schemas: [], groups: [] } }

describe('useGeoJSONExport', () => {
  let createObjectURL: ReturnType<typeof vi.spyOn>
  let revokeObjectURL: ReturnType<typeof vi.spyOn>
  let anchorClick: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // jsdom has no URL.createObjectURL out of the box — stub the lifecycle.
    if (!URL.createObjectURL) (URL.createObjectURL as unknown) = () => ''
    if (!URL.revokeObjectURL) (URL.revokeObjectURL as unknown) = () => {}
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    anchorClick.mockRestore()
  })

  it('exportToString returns pretty-printed JSON by default', () => {
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC }),
    )
    const text = result.current.exportToString()
    expect(text).toContain('"Paris"')
    expect(text).toMatch(/\n {2}/) // default indent 2
  })

  it('exportToString honors indent=0 for compact output', () => {
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC, indent: 0 }),
    )
    const text = result.current.exportToString()
    expect(text).not.toContain('\n')
  })

  it('exportToBlob returns a Blob with application/geo+json MIME', () => {
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC }),
    )
    const blob = result.current.exportToBlob()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('application/geo+json')
    expect(blob?.size).toBeGreaterThan(0)
  })

  it('exportToFile triggers an anchor download and returns the filename', async () => {
    const onExport = vi.fn()
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC, onExport }),
    )
    let name: string | null = null
    act(() => { name = result.current.exportToFile() })
    expect(name).toBe('features.geojson')
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
    // Legacy <a download> flow has no save confirmation, so onExport must stay
    // silent (no pre-mature "exported" toast). See saveGeoJSONFile.
    await new Promise((r) => setTimeout(r, 0))
    expect(onExport).not.toHaveBeenCalled()
  })

  it('exportToFile fires onExport after a confirmed File System Access save', async () => {
    const write = vi.fn()
    const close = vi.fn()
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'features.geojson',
      createWritable: async () => ({ write, close }),
    })
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker
    try {
      const onExport = vi.fn()
      const { result } = renderHook(() =>
        useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC, onExport }),
      )
      let name: string | null = null
      act(() => { name = result.current.exportToFile() })
      expect(name).toBe('features.geojson')
      await vi.waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
      expect(showSaveFilePicker).toHaveBeenCalledTimes(1)
      expect(write).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
      expect(anchorClick).not.toHaveBeenCalled()
      const [fc, file] = onExport.mock.calls[0]
      expect(fc).toBe(SAMPLE_FC)
      expect(file.name).toBe('features.geojson')
      expect(file.bytes).toBeGreaterThan(0)
    } finally {
      delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
    }
  })

  it('exportToFile uses a string filename option', () => {
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC, filename: 'my-export' }),
    )
    let name: string | null = null
    act(() => { name = result.current.exportToFile() })
    expect(name).toBe('my-export.geojson')
  })

  it('exportToFile uses a function filename option', () => {
    const { result } = renderHook(() =>
      useGeoJSONExport({
        getFeatureCollection: () => SAMPLE_FC,
        filename: (fc) => `element-editor-${fc.features.length}`,
      }),
    )
    let name: string | null = null
    act(() => { name = result.current.exportToFile() })
    expect(name).toBe('element-editor-2.geojson')
  })

  it('does not double-append .geojson when filename already ends with it', () => {
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => SAMPLE_FC, filename: 'foo.geojson' }),
    )
    let name: string | null = null
    act(() => { name = result.current.exportToFile() })
    expect(name).toBe('foo.geojson')
  })

  it('fires onError { kind: "empty" } when FC has no features', () => {
    const onError = vi.fn()
    const onExport = vi.fn()
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => EMPTY_FC, onExport, onError }),
    )
    expect(result.current.exportToString()).toBeNull()
    expect(result.current.exportToBlob()).toBeNull()
    act(() => { expect(result.current.exportToFile()).toBeNull() })
    expect(onError).toHaveBeenCalledTimes(3) // one per method
    expect(onError.mock.calls[0][0].kind).toBe('empty')
    expect(onExport).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('fires onError { kind: "empty" } when getFeatureCollection returns null', () => {
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useGeoJSONExport({ getFeatureCollection: () => null, onError }),
    )
    expect(result.current.exportToString()).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('empty')
  })

  it('disabled: true makes all export methods no-ops', () => {
    const onExport = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useGeoJSONExport({
        getFeatureCollection: () => SAMPLE_FC,
        onExport,
        onError,
        disabled: true,
      }),
    )
    expect(result.current.exportToString()).toBeNull()
    act(() => { expect(result.current.exportToFile()).toBeNull() })
    expect(onExport).not.toHaveBeenCalled()
    // disabled short-circuits before the empty check too
    expect(onError).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('reads the FeatureCollection lazily on every call', () => {
    let counter = 0
    const { result } = renderHook(() =>
      useGeoJSONExport({
        indent: 0,
        getFeatureCollection: () => ({
          type: 'FeatureCollection',
          metadata: { schemas: [], groups: [] },
          features: [
            { type: 'Feature', id: 'p', geometry: { type: 'Point', coordinates: [counter++, 0] }, properties: {} },
          ],
        }),
      }),
    )
    const first = result.current.exportToString()
    const second = result.current.exportToString()
    expect(first).not.toEqual(second)
    expect(first).toContain('[0,0]')
    expect(second).toContain('[1,0]')
  })
})
