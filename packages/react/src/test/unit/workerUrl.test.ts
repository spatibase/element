import { describe, expect, it } from 'vitest'
import { ensureWorkerUrl, workerCdnUrl } from '../../maplibre/workerUrl'

const fakeLib = (version: string, url = '') => {
  const lib = {
    url,
    getVersion: () => version,
    getWorkerUrl: () => lib.url,
    setWorkerUrl: (u: string) => { lib.url = u },
  }
  return lib
}

describe('ensureWorkerUrl', () => {
  it('MapLibre 6 with no worker URL: points it at the jsDelivr copy of the same version', () => {
    const lib = fakeLib('6.18.0')
    ensureWorkerUrl(lib)
    expect(lib.url).toBe('https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist/maplibre-gl-worker.mjs')
    expect(lib.url).toBe(workerCdnUrl('6.18.0'))
  })
  it("keeps a worker URL the app set", () => {
    const lib = fakeLib('6.18.0', '/assets/maplibre-gl-worker.mjs')
    ensureWorkerUrl(lib)
    expect(lib.url).toBe('/assets/maplibre-gl-worker.mjs')
  })
  it('MapLibre 5 (inlined worker): leaves it alone', () => {
    const lib = fakeLib('5.24.1')
    ensureWorkerUrl(lib)
    expect(lib.url).toBe('')
  })
  it('a build without the worker API: does nothing', () => {
    expect(() => ensureWorkerUrl({} as Parameters<typeof ensureWorkerUrl>[0])).not.toThrow()
  })
})
