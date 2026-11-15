import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { BoundsInput } from '@element-editor/core'
import { render, screen } from '@testing-library/react'
import { ElementEditorShell } from '../../shell/ElementEditorShell'
import { useUIStore } from '../../store/StoreContext'

function Probe() {
  const bounds = useUIStore((s) => s.bounds)
  return <output data-testid="bounds">{JSON.stringify(bounds ?? null)}</output>
}

const shell = (bounds?: BoundsInput) => <ElementEditorShell bounds={bounds} renderMap={() => <Probe />} />

describe('bounds prop → uiStore', () => {
  beforeAll(() => {
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  })

  it('applies on mount and on every change; undefined clears', () => {
    const a: BoundsInput = [2.2, 48.8, 2.4, 48.9]
    const b: BoundsInput = [14, 50, 14.7, 50.2]
    const { rerender } = render(shell(a))
    expect(screen.getByTestId('bounds').textContent).toBe(JSON.stringify(a))
    rerender(shell(b))
    expect(screen.getByTestId('bounds').textContent).toBe(JSON.stringify(b))
    rerender(shell())
    expect(screen.getByTestId('bounds').textContent).toBe('null')
  })

  it('stores the deprecated [[s, w], [n, e]] form as a bbox', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(shell([[48.8, 2.2], [48.9, 2.4]]))
    expect(screen.getByTestId('bounds').textContent).toBe(JSON.stringify([2.2, 48.8, 2.4, 48.9]))
    vi.restoreAllMocks()
  })
})
