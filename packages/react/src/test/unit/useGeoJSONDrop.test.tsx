import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGeoJSONDrop } from '@element-editor/ui'

function mockDataTransfer(files: File[]): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ['Files'],
    dropEffect: 'copy',
    effectAllowed: 'all',
    getData: () => '',
    setData: () => {},
    clearData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer
}

function makeGeoJSONFile(body: unknown, name = 'features.geojson'): File {
  const blob = new Blob([JSON.stringify(body)], { type: 'application/geo+json' })
  return new File([blob], name, { type: 'application/geo+json' })
}

describe('useGeoJSONDrop', () => {
  it('calls onImport with the parsed FeatureCollection when a valid file is dropped', async () => {
    const onImport = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useGeoJSONDrop({ onImport, onError }))

    const file = makeGeoJSONFile({ type: 'FeatureCollection', features: [] })
    const dropEvent = {
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: mockDataTransfer([file]),
    } as unknown as React.DragEvent

    await act(async () => {
      result.current.getRootProps().onDrop(dropEvent)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onImport.mock.calls[0][0].type).toBe('FeatureCollection')
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports invalid-json for a file with malformed JSON', async () => {
    const onImport = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useGeoJSONDrop({ onImport, onError }))

    const file = new File(['{ not json'], 'bad.geojson', { type: 'application/geo+json' })
    await act(async () => {
      result.current.getRootProps().onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([file]),
      } as unknown as React.DragEvent)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('invalid-json')
    expect(onImport).not.toHaveBeenCalled()
  })

  it('reports not-feature-collection for a bare Feature payload', async () => {
    const onImport = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useGeoJSONDrop({ onImport, onError }))

    const file = makeGeoJSONFile({ type: 'Feature', geometry: null, properties: {} })
    await act(async () => {
      result.current.getRootProps().onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([file]),
      } as unknown as React.DragEvent)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('not-feature-collection')
  })

  it('reports wrong-type when extension/MIME are not allowed', async () => {
    const onImport = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useGeoJSONDrop({ onImport, onError }))

    const file = new File(['x'], 'cat.png', { type: 'image/png' })
    await act(async () => {
      result.current.getRootProps().onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([file]),
      } as unknown as React.DragEvent)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('wrong-type')
  })

  it('reports too-large when file size exceeds maxBytes', async () => {
    const onImport = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useGeoJSONDrop({ onImport, onError, maxBytes: 4 }),
    )

    const file = makeGeoJSONFile({ type: 'FeatureCollection', features: [] })
    await act(async () => {
      result.current.getRootProps().onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([file]),
      } as unknown as React.DragEvent)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('too-large')
  })

  it('tracks drag state across enter/leave', () => {
    const { result } = renderHook(() =>
      useGeoJSONDrop({ onImport: () => {} }),
    )

    expect(result.current.isDragActive).toBe(false)

    act(() => {
      result.current.getRootProps().onDragEnter({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([]),
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragActive).toBe(true)

    act(() => {
      result.current.getRootProps().onDragLeave({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([]),
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragActive).toBe(false)
  })

  it('disabled: true makes drop a no-op', async () => {
    const onImport = vi.fn()
    const { result } = renderHook(() =>
      useGeoJSONDrop({ onImport, disabled: true }),
    )

    const file = makeGeoJSONFile({ type: 'FeatureCollection', features: [] })
    await act(async () => {
      result.current.getRootProps().onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: mockDataTransfer([file]),
      } as unknown as React.DragEvent)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onImport).not.toHaveBeenCalled()
  })
})
