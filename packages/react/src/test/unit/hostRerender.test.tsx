/**
 * Integrators commonly pass inline props (`config={{…}}`, `tools={[…]}`, `onChange={setState}`),
 * so the host re-renders the editor on every edit. That must not re-render the map subtree
 * (the adapter's ElementEditorControls draws every feature), and resizing the layers panel
 * must not re-render the shell root.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import type { ResolvedConfig } from '@element-editor/ui'
import { useElementEditorConfig, useAccentPalette } from '@element-editor/ui'
import * as core from '@element-editor/core'

const counts = { controls: 0 }
const Controls = () => { counts.controls++; return null }

vi.mock('@element-editor/adapter-leaflet', async (orig) => ({
  ...(await orig<object>()),
  ElementEditorControls: Controls,
}))
vi.mock('@element-editor/core', async (orig) => {
  const actual = await orig<typeof import('@element-editor/core')>()
  return { ...actual, readAccentPalette: vi.fn(actual.readAccentPalette) }
})
vi.mock('@element-editor/adapter-maplibre', () => ({
  ElementEditorControls: Controls,
  useBasemap: () => {},
  BasemapControl: () => null,
}))
vi.mock('@element-editor/adapter-maplibre/basemaps', () => ({
  loadBasemapStyle: async () => ({ version: 8, sources: {}, layers: [] }),
  resolveBasemap: (b: unknown) => b,
}))
vi.mock('maplibre-gl', () => {
  class Map {
    on() {} once() {} off() {} remove() {} resize() {} addControl() {} removeControl() {}
    getContainer() { return document.createElement('div') }
  }
  return { default: { Map, AttributionControl: class {} } }
})

const { ElementEditorShell } = await import('../../shell/ElementEditorShell')
const { ElementEditor: LeafletEditor } = await import('../../leaflet/ElementEditor')
const { ElementEditor: MapLibreEditor } = await import('../../maplibre/ElementEditor')

type Stores = { uiStore: { getState(): Record<string, (...a: unknown[]) => void> & { enabledTools: unknown } } }
const stores = () => (window as unknown as { __elementEditorTest: Stores }).__elementEditorTest

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

describe('host re-render with inline props', () => {
  for (const [name, Editor] of [['leaflet', LeafletEditor], ['maplibre', MapLibreEditor]] as const) {
    it(`${name}: 20 host renders with inline config/tools/initialView/mapOptions/onMapReady re-render neither the map controls nor the config`, async () => {
      const configs = new Set<ResolvedConfig>()
      const CfgProbe = () => { configs.add(useElementEditorConfig()); return null }
      const host = (n: number) => (
        <Editor
          config={{ ui: { hints: true, layout: { topCenter: ['toolbar'] } }, units: { length: 'metric' } }}
          tools={['polygon', 'line']}
          onChange={() => {}}
          initialView={{ center: [14.4, 50.1], zoom: 10 }}
          mapOptions={{ maxZoom: 18 }}
          onMapReady={() => {}}
          slots={{ mapOverlay: <CfgProbe key={n} /> }}
        />
      )
      counts.controls = 0
      const { rerender, unmount } = render(host(0))
      await waitFor(() => expect(counts.controls).toBeGreaterThan(0))
      const mounted = counts.controls
      const tools = stores().uiStore.getState().enabledTools
      for (let i = 1; i <= 20; i++) rerender(host(i))
      expect(counts.controls).toBe(mounted)
      expect(stores().uiStore.getState().enabledTools).toBe(tools)
      expect(configs.size).toBe(1)
      unmount()
    })
  }

  it('resizing the layers panel / docked inspector does not re-render the shell root', () => {
    const renderMap = vi.fn(() => null)
    const { unmount } = render(<ElementEditorShell renderMap={renderMap} />)
    const calls = renderMap.mock.calls.length
    const ui = stores().uiStore.getState()
    act(() => { for (let w = 300; w < 340; w += 2) ui.setSidebarWidth(w) })
    act(() => { ui.setCodeDockWidth(420) })
    expect(renderMap.mock.calls.length).toBe(calls)
    unmount()
  })

  it('layout vars written on the root (panel resize) do not re-read the accent palette', async () => {
    const root = document.body.appendChild(document.createElement('div'))
    root.setAttribute('data-elm-theme', 'light')
    const el = root.appendChild(document.createElement('div'))
    const Probe = () => { useAccentPalette(el); return null }
    const { unmount } = render(<Probe />)
    const read = vi.mocked(core.readAccentPalette)
    const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))))
    await frame()
    const calls = read.mock.calls.length
    for (let w = 300; w < 320; w++) { root.style.setProperty('--elm-panel-offset', `${w}px`); await frame() }
    expect(read.mock.calls.length).toBe(calls)
    root.style.setProperty('--elm-accent', '#ea580c')
    await frame()
    expect(read.mock.calls.length).toBe(calls + 1)
    unmount(); root.remove()
  })
})
