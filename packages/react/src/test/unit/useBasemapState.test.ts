import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBasemapState } from '../../shell/useBasemapState'

type Args = { value?: string; onChange?: (b: string) => void }

function setup(initialProps: Args) {
  const initial = vi.fn(() => 'remembered')
  const remember = vi.fn()
  const hook = renderHook((p: Args) => useBasemapState<string>(p.value, initial, p.onChange, remember, true), { initialProps })
  return { ...hook, initial, remember }
}

describe('useBasemapState', () => {
  it('uncontrolled: starts from initial(); a user pick switches and is remembered, setBasemap is not', () => {
    const onChange = vi.fn()
    const { result, initial, remember } = setup({ onChange })
    expect(initial).toHaveBeenCalledTimes(1)
    expect(result.current.current).toBe('remembered')

    act(() => result.current.pick('dark', true))
    expect(result.current.current).toBe('dark')
    expect(remember).toHaveBeenCalledWith('dark')
    expect(onChange).toHaveBeenLastCalledWith('dark')

    act(() => result.current.api.setBasemap('osm'))
    expect(result.current.api.getBasemap()).toBe('osm')
    expect(remember).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('osm')
  })

  it('controlled: the prop wins, picks only call onChange, storage is never read or written', () => {
    const onChange = vi.fn()
    const { result, rerender, initial, remember } = setup({ value: 'light', onChange })
    expect(initial).not.toHaveBeenCalled()
    act(() => result.current.pick('dark', true))
    act(() => result.current.api.setBasemap('osm'))
    expect(result.current.current).toBe('light')
    expect(onChange.mock.calls).toEqual([['dark'], ['osm']])
    expect(remember).not.toHaveBeenCalled()

    rerender({ value: 'terrain', onChange })
    expect(result.current.api.getBasemap()).toBe('terrain')
    expect(onChange).toHaveBeenCalledTimes(2) // prop changes don't fire it
  })

  it('warns when controlled with a picker but no onChange', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup({ value: 'light' })
    expect(warn.mock.calls.some((c) => String(c[0]).includes('onBasemapChange'))).toBe(true)
    warn.mockRestore()
  })
})
