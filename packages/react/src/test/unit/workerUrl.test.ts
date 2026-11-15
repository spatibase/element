import { describe, expect, it } from 'vitest'
import { ensureWorkerUrl, resolveWorkerUrl, workerCdnUrl } from '../../maplibre/workerUrl'

const CDN_6 = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist/maplibre-gl-worker.mjs'

const fakeLib = (version: string, url = '') => {
  const lib = {
    url,
    calls: 0,
    getVersion: () => version,
    getWorkerUrl: () => lib.url,
    setWorkerUrl: (u: string) => { lib.url = u; lib.calls++ },
  }
  return lib
}

describe('config.network.maplibreWorker resolution', () => {
  it('default (omitted) on MapLibre 6: the jsDelivr copy of the installed version', () => {
    expect(resolveWorkerUrl(undefined, '6.18.0', '')).toBe(CDN_6)
    expect(workerCdnUrl('6.18.0')).toBe(CDN_6)
  })
  it('a URL on MapLibre 6: that URL', () => {
    expect(resolveWorkerUrl('/assets/maplibre-gl-worker.mjs', '6.18.0', '')).toBe('/assets/maplibre-gl-worker.mjs')
  })
  it('false: leaves the worker URL to the app', () => {
    expect(resolveWorkerUrl(false, '6.18.0', '')).toBeNull()
  })
  it('MapLibre 5 (worker built in): untouched, whatever the setting', () => {
    for (const setting of [undefined, '/w.mjs', false] as const) expect(resolveWorkerUrl(setting, '5.24.1', '')).toBeNull()
  })
  it('the app already called setWorkerUrl: untouched, whatever the setting', () => {
    for (const setting of [undefined, '/w.mjs', false] as const) expect(resolveWorkerUrl(setting, '6.18.0', '/app-worker.mjs')).toBeNull()
  })
})

describe('ensureWorkerUrl', () => {
  it('sets the resolved URL on MapLibre 6', () => {
    const lib = fakeLib('6.18.0')
    ensureWorkerUrl(undefined, lib)
    expect(lib.url).toBe(CDN_6)
    const custom = fakeLib('6.18.0')
    ensureWorkerUrl('https://maps.example.test/maplibre-gl-worker.mjs', custom)
    expect(custom.url).toBe('https://maps.example.test/maplibre-gl-worker.mjs')
  })
  it('never calls setWorkerUrl with false, on MapLibre 5, or over an app-set URL', () => {
    const off = fakeLib('6.18.0')
    ensureWorkerUrl(false, off)
    const v5 = fakeLib('5.24.1')
    ensureWorkerUrl(undefined, v5)
    const appSet = fakeLib('6.18.0', '/app-worker.mjs')
    ensureWorkerUrl('/other.mjs', appSet)
    expect([off.calls, v5.calls, appSet.calls]).toEqual([0, 0, 0])
    expect(appSet.url).toBe('/app-worker.mjs')
  })
  it('a build without the worker API: does nothing', () => {
    expect(() => ensureWorkerUrl(undefined, {} as Parameters<typeof ensureWorkerUrl>[1])).not.toThrow()
  })
})
