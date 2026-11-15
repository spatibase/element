import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, render, screen, fireEvent } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { BasemapInput } from '../../../../adapter-maplibre/src/basemaps'

const setBasemap = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('../../../../adapter-maplibre/src/basemaps/style', () => ({
  resolveBasemap: (b: BasemapInput, theme: string) => (b === 'auto' ? (theme === 'dark' ? 'dark' : 'streets') : b),
  setBasemap: (...args: unknown[]) => setBasemap(...args),
}))
vi.mock('../../../../adapter-maplibre/src/basemaps/catalog', () => ({ BASEMAPS: [] }))

const { useBasemap, BasemapControl } = await import('../../../../adapter-maplibre/src/BasemapControl')

const fakeMap = () => ({ isStyleLoaded: () => true, getSource: () => undefined, on: vi.fn(), off: vi.fn() }) as unknown as MapLibreMap

const tick = () => new Promise((r) => setTimeout(r, 0))
const styleOf = (color: string) => ({ version: 8 as const, sources: {}, layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': color } }] })

describe('useBasemap', () => {
  it('switches between two id-less style objects', async () => {
    setBasemap.mockClear()
    const map = fakeMap()
    const a: BasemapInput = { style: styleOf('#f00') }
    const b: BasemapInput = { style: styleOf('#00f') }
    const { rerender } = renderHook(({ basemap }: { basemap: BasemapInput }) => useBasemap(map, basemap, { theme: 'light' }), { initialProps: { basemap: a } })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(1))
    rerender({ basemap: b })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(2))
    expect(setBasemap).toHaveBeenLastCalledWith(map, b, { theme: 'light', network: {} })
  })

  it('keys a custom style on its id: an inline copy with the same id is not re-applied', async () => {
    setBasemap.mockClear()
    const map = fakeMap()
    const { rerender } = renderHook(({ basemap }: { basemap: BasemapInput }) => useBasemap(map, basemap, { theme: 'light' }), { initialProps: { basemap: { id: 'mine', style: styleOf('#f00') } as BasemapInput } })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(1))
    rerender({ basemap: { id: 'mine', style: styleOf('#f00') } })
    await tick()
    expect(setBasemap).toHaveBeenCalledTimes(1)
  })

  it("keeps 'auto' following the theme without a picker; skips the initial and unchanged applies", async () => {
    setBasemap.mockClear()
    const map = fakeMap()
    const { rerender } = renderHook(
      ({ basemap, theme }: { basemap: BasemapInput; theme: 'light' | 'dark' }) => useBasemap(map, basemap, { theme, initialApplied: true }),
      { initialProps: { basemap: 'auto', theme: 'light' } },
    )
    await new Promise((r) => setTimeout(r, 0)) // lazy catalog import
    expect(setBasemap).not.toHaveBeenCalled() // initial basemap is already in the map's style

    rerender({ basemap: 'auto', theme: 'dark' })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(1))
    expect(setBasemap).toHaveBeenLastCalledWith(map, 'auto', { theme: 'dark', network: {} })

    rerender({ basemap: 'dark', theme: 'dark' }) // same resolved style: no reload
    rerender({ basemap: 'terrain', theme: 'dark' })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(2))
    expect(setBasemap).toHaveBeenLastCalledWith(map, 'terrain', { theme: 'dark', network: {} })

    rerender({ basemap: 'terrain', theme: 'light' }) // non-auto ignores the theme
    await new Promise((r) => setTimeout(r, 0))
    expect(setBasemap).toHaveBeenCalledTimes(2)
  })

  it('initialApplied: a basemap or theme change while the map is still loading is applied once it arrives', async () => {
    type P = { map: MapLibreMap | null; basemap: BasemapInput; theme: 'light' | 'dark' }
    const hook = ({ map, basemap, theme }: P) => useBasemap(map, basemap, { theme, initialApplied: true })
    // The map was created with 'auto' + light (streets); the prop moved to 'dark' before it arrived.
    setBasemap.mockClear()
    const map = fakeMap()
    const a = renderHook(hook, { initialProps: { map: null, basemap: 'auto', theme: 'light' } as P })
    a.rerender({ map: null, basemap: 'dark', theme: 'light' })
    a.rerender({ map, basemap: 'dark', theme: 'light' })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(1))
    expect(setBasemap).toHaveBeenLastCalledWith(map, 'dark', { theme: 'light', network: {} })

    // 'auto' and the theme flipped to dark during the load.
    setBasemap.mockClear()
    const b = renderHook(hook, { initialProps: { map: null, basemap: 'auto', theme: 'light' } as P })
    b.rerender({ map, basemap: 'auto', theme: 'dark' })
    await waitFor(() => expect(setBasemap).toHaveBeenCalledTimes(1))
    expect(setBasemap).toHaveBeenLastCalledWith(map, 'auto', { theme: 'dark', network: {} })

    // Unchanged by the time the map arrives: nothing to apply.
    setBasemap.mockClear()
    const c = renderHook(hook, { initialProps: { map: null, basemap: 'terrain', theme: 'light' } as P })
    c.rerender({ map, basemap: 'terrain', theme: 'dark' })
    await tick(); await tick()
    expect(setBasemap).not.toHaveBeenCalled()
  })
})

// The component's lazy catalog import isn't always the mocked module here, so assert on the map itself.
const styledMap = () => ({ ...fakeMap(), listImages: () => [], setStyle: vi.fn(), once: vi.fn() }) as unknown as MapLibreMap & { setStyle: ReturnType<typeof vi.fn> }
const applies = (map: { setStyle: ReturnType<typeof vi.fn> }) => map.setStyle.mock.calls.length + setBasemap.mock.calls.length

describe('BasemapControl', () => {
  it("bring-your-own map: leaves the map's style alone until the user picks", async () => {
    setBasemap.mockClear()
    const map = styledMap()
    const basemaps: BasemapInput[] = ['auto', { id: 'red', label: 'Red', style: styleOf('#f00') }, { id: 'blue', label: 'Blue', style: styleOf('#00f') }]
    render(<BasemapControl map={map} basemaps={basemaps} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Basemap' }))
    await tick()
    expect(applies(map)).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await waitFor(() => expect(applies(map)).toBe(1))
    expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('an explicit defaultValue is applied on mount', async () => {
    setBasemap.mockClear()
    const map = styledMap()
    render(<BasemapControl map={map} defaultValue={{ id: 'red', style: styleOf('#f00') }} />)
    await waitFor(() => expect(applies(map)).toBe(1))
  })

  it('marks an inline controlled value by its id', async () => {
    render(<BasemapControl basemaps={[{ id: 'a', label: 'A', style: styleOf('#f00') }, { id: 'b', label: 'B', style: styleOf('#00f') }]} value={{ id: 'b', label: 'B', style: styleOf('#00f') }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Basemap' }))
    expect(screen.getByRole('button', { name: 'B' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows no option selected for a value that is not in the list', async () => {
    render(<BasemapControl basemaps={[{ id: 'a', label: 'A', style: styleOf('#f00') }, { id: 'b', label: 'B', style: styleOf('#00f') }]} value={{ id: 'elsewhere', style: styleOf('#0f0') }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Basemap' }))
    for (const name of ['A', 'B']) expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
  })
})
