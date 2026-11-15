/**
 * config.network: per-call routing / Overpass options, per-editor search and routing settings
 * (two editors on one page don't share them), the tools and credits each service brings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fetchRoute, routingAttribution, ORS_ATTRIBUTION } from '../../../../core/src/utils/routing'
import { fetchOverpassFeatures, clearOverpassCache } from '../../../../core/src/utils/overpass'
import { overrideSource } from '../../../../core/src/utils/network'
import type { NetworkConfig } from '@element-editor/core'
import { ElementEditorConfigProvider, useElementEditorConfig } from '../../../../ui/src/contexts/ElementEditorConfigContext'
import { useNominatim } from '../../../../ui/src/hooks/useNominatim'
import { serviceAttribution, useRouting } from '../../../../ui/src/hooks/useServiceAttribution'
import { networkUnavailableTools } from '../../../../ui/src/hooks/useAdapterControls'

const ok = (body: unknown) => new Response(JSON.stringify(body))
const ROUTE = { routes: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }] }
const ORS = { features: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }] }
const wps: [number, number][] = [[14, 50], [14.1, 50.1]]

describe('fetchRoute options', () => {
  it('OSRM on a custom url (trailing slash ok), through the given fetch', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => ok(ROUTE))
    await fetchRoute(wps, { url: 'https://osrm.example/route/v1/foot/', fetch: f as unknown as typeof fetch })
    expect(f.mock.calls[0]).toEqual(['https://osrm.example/route/v1/foot/14,50;14.1,50.1?overview=full&geometries=geojson', { signal: undefined }])
  })
  it('ORS: the key picks it; a custom url; self-hosted ORS without a key sends no Authorization', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => ok(ORS))
    await fetchRoute(wps, { apiKey: 'k', fetch: f as unknown as typeof fetch })
    expect(f.mock.calls[0][0]).toBe('https://api.openrouteservice.org/v2/directions/foot-walking/geojson')
    expect(f.mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'k' })
    await fetchRoute(wps, { provider: 'ors', url: 'https://ors.example/v2/directions/foot-walking/geojson', fetch: f as unknown as typeof fetch })
    expect(f.mock.calls[1][0]).toBe('https://ors.example/v2/directions/foot-walking/geojson')
    expect(f.mock.calls[1][1]!.headers).not.toHaveProperty('Authorization')
  })
  it('the OSRM demo default warns once that it is car-only and not for production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = vi.fn(async (_u: string) => ok(ROUTE))
    await fetchRoute(wps, { fetch: f as unknown as typeof fetch })
    await fetchRoute(wps, { fetch: f as unknown as typeof fetch })
    expect(f.mock.calls[0][0]).toContain('https://router.project-osrm.org/route/v1/foot/')
    const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('OSRM demo'))
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatch(/car-only.*not for production/)
    warn.mockRestore()
  })
  it('routingAttribution: ORS credit only for the ORS service; own credit wins; none for OSRM / off', () => {
    expect(routingAttribution({ apiKey: 'k' })).toBe(ORS_ATTRIBUTION)
    expect(routingAttribution({ provider: 'ors', url: 'https://ors.example/x' })).toBeUndefined()
    expect(routingAttribution({ url: 'https://osrm.example', attribution: 'Mine' })).toBe('Mine')
    expect(routingAttribution({})).toBeUndefined()
    expect(routingAttribution(false)).toBeUndefined()
  })
})

describe('Overpass per editor', () => {
  beforeEach(() => clearOverpassCache())
  it('keys the cache and in-flight requests by endpoint (two editors, two servers, same spot)', async () => {
    const f = vi.fn(async (_u: string) => ok({ elements: [] }))
    const opts = (endpoint: string) => ({ endpoint, fetch: f as unknown as typeof fetch })
    await Promise.all([
      fetchOverpassFeatures(45, 7, 50, undefined, opts('https://a.example/i')),
      fetchOverpassFeatures(45, 7, 50, undefined, opts('https://b.example/i')),
    ])
    await fetchOverpassFeatures(45, 7, 50, undefined, opts('https://b.example/i')) // cached for b
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual(['https://a.example/i', 'https://b.example/i'])
    await fetchOverpassFeatures(45, 7, 50, undefined, opts('https://a.example/i')) // b holds the cache now
    expect(f).toHaveBeenCalledTimes(3)
  })
})

describe('overrideSource', () => {
  it('a string or object over the base; the other locator dropped', () => {
    const base = { type: 'vector', url: 'https://d/tj', attribution: 'D' }
    expect(overrideSource(base, undefined, 'x')).toBe(base)
    expect(overrideSource(base, { tiles: ['https://n/{z}'], attribution: 'N' }, 'x')).toEqual({ type: 'vector', tiles: ['https://n/{z}'], attribution: 'N' })
    expect(overrideSource(base, { attribution: 'Only credit' }, 'x')).toEqual({ ...base, attribution: 'Only credit' })
  })
})

describe('per-editor search (useNominatim)', () => {
  const editor = (network: NetworkConfig) => ({ children }: { children: ReactNode }) =>
    <ElementEditorConfigProvider config={{ persist: false, network }}>{children}</ElementEditorConfigProvider>
  it('each editor searches its own server, with its own email and fetch, and sends no User-Agent', async () => {
    const fa = vi.fn(async (_u: string, _i?: RequestInit) => ok([]))
    const fb = vi.fn(async (_u: string, _i?: RequestInit) => ok([]))
    renderHook(() => useNominatim('Prague'), { wrapper: editor({ nominatim: { url: 'https://a.example/search', email: 'me@a.example' }, fetch: fa as unknown as typeof fetch }) })
    renderHook(() => useNominatim('Prague'), { wrapper: editor({ nominatim: { url: 'https://b.example/search?key=k' }, fetch: fb as unknown as typeof fetch }) })
    await waitFor(() => { expect(fa).toHaveBeenCalled(); expect(fb).toHaveBeenCalled() }, { timeout: 2000 })
    const a = new URL(fa.mock.calls[0][0])
    expect(a.origin + a.pathname).toBe('https://a.example/search')
    expect(a.searchParams.get('email')).toBe('me@a.example')
    expect(a.searchParams.get('q')).toBe('Prague')
    const b = new URL(fb.mock.calls[0][0])
    expect(b.searchParams.get('key')).toBe('k')
    expect(b.searchParams.get('email')).toBeNull()
    expect(fa.mock.calls[0][1]!.headers).toBeUndefined()
  })
  it('the resolved fetch is a stable wrapper around the latest one', () => {
    const f1 = vi.fn(async () => ok([]))
    const f2 = vi.fn(async () => ok([]))
    let fetchImpl: typeof fetch = f1
    const wrapper = ({ children }: { children: ReactNode }) =>
      <ElementEditorConfigProvider config={{ network: { fetch: fetchImpl } }}>{children}</ElementEditorConfigProvider>
    const { result, rerender } = renderHook(() => useElementEditorConfig(), { wrapper })
    const first = result.current
    fetchImpl = f2
    rerender()
    expect(result.current).toBe(first) // no context churn for an inline fetch
    void result.current.network.fetch!('https://x')
    expect(f2).toHaveBeenCalledWith('https://x', undefined)
    expect(f1).not.toHaveBeenCalled()
  })
})

describe('routing alias, tools and credits', () => {
  const wrap = (network?: NetworkConfig) => ({ children }: { children: ReactNode }) =>
    <ElementEditorConfigProvider config={{ network }}>{children}</ElementEditorConfigProvider>
  it('routingApiKey is the key only when network.routing has none; false stays false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(renderHook(() => useRouting('old'), { wrapper: wrap() }).result.current).toEqual({ apiKey: 'old' })
    expect(renderHook(() => useRouting('old'), { wrapper: wrap({ routing: { apiKey: 'new', url: 'u' } }) }).result.current).toEqual({ apiKey: 'new', url: 'u' })
    expect(renderHook(() => useRouting('old'), { wrapper: wrap({ routing: false }) }).result.current).toBe(false)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('`routingApiKey` prop is deprecated'))).toBe(true)
    warn.mockRestore()
  })
  it('false hides the Route tool, the search box and (Leaflet only) the Picker', () => {
    expect(networkUnavailableTools({}, 'leaflet')).toEqual([])
    expect(networkUnavailableTools({ routing: false, nominatim: false, overpass: false }, 'leaflet')).toEqual(['route', 'search', 'picker'])
    expect(networkUnavailableTools({ overpass: false }, 'maplibre')).toEqual([]) // picks from the vector tiles
  })
  it('credits: Nominatim while search is on (own credit / none on another server), ORS while routing through it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(serviceAttribution({}, { search: true, route: true }).join()).toContain('Nominatim')
    expect(serviceAttribution({}, { search: false, route: true })).toEqual([])
    expect(serviceAttribution({ nominatim: false }, { search: true, route: true })).toEqual([])
    expect(serviceAttribution({ nominatim: { url: 'https://g.example/search' } }, { search: true, route: false })).toEqual([])
    expect(serviceAttribution({ nominatim: { url: 'https://g.example/search', attribution: 'G' } }, { search: true, route: false })).toEqual(['G'])
    expect(serviceAttribution({ routing: { apiKey: 'k' } }, { search: false, route: true })).toEqual([ORS_ATTRIBUTION])
    expect(serviceAttribution({ routing: { apiKey: 'k' } }, { search: false, route: false })).toEqual([])
    warn.mockRestore()
  })
})
