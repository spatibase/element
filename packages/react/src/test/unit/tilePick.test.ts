import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchOverpassFeatures, tileFeatureToResult, overpassErrorMessage, clearOverpassCache, OverpassError, type OverpassOptions } from '../../../../core/src/utils/overpass'

const sq = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]

describe('tileFeatureToResult', () => {
  it('unions pieces split at a tile edge into one polygon', async () => {
    // A park clipped by a tile edge at x=0.001, with the tile buffer overlap.
    const r = await tileFeatureToResult([
      { sourceLayer: 'park', properties: { class: 'park', name: 'Ciutadella' }, geometry: { type: 'Polygon', coordinates: sq(0, 0, 0.0011, 0.001) } },
      { sourceLayer: 'park', properties: { class: 'park', name: 'Ciutadella' }, geometry: { type: 'Polygon', coordinates: sq(0.0009, 0, 0.002, 0.001) } },
    ], 7, [0.0015, 0.0005])
    expect(r).not.toBeNull()
    expect(r!.geometry.type).toBe('Polygon')
    const xs = r!.geometry.coordinates[0].map((c) => c[0])
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(0.002)
    expect(r!.name).toBe('Ciutadella')
    expect(r!.type).toBe('Park')
    expect(r!.osmId).toBe(7)
  })

  it('keeps the multipolygon part under the click', async () => {
    const r = await tileFeatureToResult([
      { sourceLayer: 'building', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [sq(0, 0, 0.001, 0.001), sq(0.005, 0, 0.006, 0.001)] } },
    ], 1, [0.0055, 0.0005])
    expect(r!.geometry.coordinates[0][0]).toEqual([0.005, 0])
    expect(r!.type).toBe('Building')
    expect(r!.name).toBeNull()
  })

  it('retries a busy Overpass server, then reports busy', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response('at capacity', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const p = fetchOverpassFeatures(41.1, 2.1, 50).catch((e: Error) => e)
      await vi.advanceTimersByTimeAsync(5000)
      expect(((await p) as Error).message).toBe('busy')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('maps errors to messages', () => {
    expect(overpassErrorMessage(new Error('busy'))).toMatch(/busy/)
    expect(overpassErrorMessage(new Error('rate-limited'))).toMatch(/Too many/)
    expect(overpassErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Could not reach/)
    expect(overpassErrorMessage(new OverpassError('timeout'))).toMatch(/too long/)
    expect(overpassErrorMessage(new OverpassError('network'))).toMatch(/Could not reach/)
  })
})

describe('Overpass requests', () => {
  let n = 0
  const at = () => 40 + ++n * 0.01 // a fresh spot per call: no cache / in-flight sharing between tests
  const fail = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e)
  // Per-call options (what the adapters pass from config.network.overpass + fetch).
  let opts: OverpassOptions = {}
  const setup = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
    const f = vi.fn(impl)
    opts.fetch = f as unknown as typeof fetch
    return f
  }
  beforeEach(() => { vi.useFakeTimers(); clearOverpassCache() })
  afterEach(() => { opts = {}; vi.useRealTimers() })

  it('uses the configured endpoint and fetch', async () => {
    Object.assign(opts, { endpoint: 'https://overpass.example/api/interpreter' })
    const f = setup(async () => new Response(JSON.stringify({ elements: [] })))
    expect(await fetchOverpassFeatures(at(), 2, 50, undefined, opts)).toEqual([])
    expect(f.mock.calls[0][0]).toBe('https://overpass.example/api/interpreter')
  })

  it('does not retry a network error', async () => {
    const f = setup(async () => { throw new TypeError('Failed to fetch') })
    const err = await fail(fetchOverpassFeatures(at(), 2, 50, undefined, opts))
    expect((err as OverpassError).code).toBe('network')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does not retry other HTTP errors', async () => {
    const f = setup(async () => new Response('bad query', { status: 400 }))
    expect(((await fail(fetchOverpassFeatures(at(), 2, 50, undefined, opts))) as OverpassError).code).toBe('network')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('retries 429 after Retry-After, and gives up at once when it asks for too long', async () => {
    let calls = 0
    const f = setup(async () => (++calls === 1
      ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
      : new Response(JSON.stringify({ elements: [] }))))
    const p = fetchOverpassFeatures(at(), 2, 50, undefined, opts)
    await vi.advanceTimersByTimeAsync(1500)
    expect(f).toHaveBeenCalledTimes(1) // still waiting out Retry-After: 2
    await vi.advanceTimersByTimeAsync(600)
    expect(await p).toEqual([])
    expect(f).toHaveBeenCalledTimes(2)

    const g = setup(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
    expect(((await fail(fetchOverpassFeatures(at(), 2, 50, undefined, opts))) as OverpassError).code).toBe('rate-limited')
    expect(g).toHaveBeenCalledTimes(1)
  })

  it('times out a hung request', async () => {
    Object.assign(opts, { timeoutMs: 5000 })
    const f = setup((_url, init) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const p = fail(fetchOverpassFeatures(at(), 2, 50, undefined, opts))
    await vi.advanceTimersByTimeAsync(5000)
    expect(((await p) as OverpassError).code).toBe('timeout')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("the caller's abort cancels the request and its retries", async () => {
    const f = setup(async () => new Response('', { status: 504 }))
    const ac = new AbortController()
    const p = fail(fetchOverpassFeatures(at(), 2, 50, undefined, { ...opts, signal: ac.signal }))
    await vi.advanceTimersByTimeAsync(10) // first attempt failed, waiting to retry
    ac.abort()
    expect(((await p) as Error).name).toBe('AbortError')
    await vi.advanceTimersByTimeAsync(5000)
    expect(f).toHaveBeenCalledTimes(1)

    let signal: AbortSignal | undefined
    setup((_url, init) => { signal = init.signal!; return new Promise(() => {}) }) // hangs
    const ac2 = new AbortController()
    const p2 = fail(fetchOverpassFeatures(at(), 2, 50, undefined, { ...opts, signal: ac2.signal }))
    await vi.advanceTimersByTimeAsync(10)
    ac2.abort()
    await p2
    expect(signal!.aborted).toBe(true) // the in-flight fetch is cancelled, not left running
  })

  it('a joined request keeps running while another caller still waits', async () => {
    const f = setup(async () => new Response(JSON.stringify({ elements: [] })))
    const lat = at()
    const ac = new AbortController()
    const first = fail(fetchOverpassFeatures(lat, 2, 50, undefined, { ...opts, signal: ac.signal }))
    const second = fetchOverpassFeatures(lat, 2, 50, undefined, opts)
    ac.abort()
    expect(((await first) as Error).name).toBe('AbortError')
    expect(await second).toEqual([])
    expect(f).toHaveBeenCalledTimes(1)
  })
})
