/**
 * onError: every failure source maps to the right `code` / `source`, and the EventProvider's
 * return protocol (void → toast, false → nothing, string → that text; quiet → onError only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, render, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const toastFns = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastFns, Toaster: () => null }))

// Core source: the stores and fetch helpers throw the source build's ElementEditorError.
import { ElementEditorError, httpErrorCode, loadErrorCode } from '../../../../core/src/utils/errors'
import { fetchOverpassFeatures, clearOverpassCache, OverpassError, overpassErrorMessage } from '../../../../core/src/utils/overpass'
import { fetchRoute, routingError } from '../../../../core/src/utils/routing'
import { createDataStore } from '../../../../core/src/store/dataStore'
// UI source runs against the core dist build, so its errors are the dist class.
import { ElementEditorError as DistError } from '@element-editor/core'
import { EventProvider, useEmit } from '../../../../ui/src/contexts/EventContext'
import { ElementEditorErrorBoundary } from '../../../../ui/src/components/ElementEditorErrorBoundary'
import { useNominatim } from '../../../../ui/src/hooks/useNominatim'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

describe('code helpers', () => {
  it.each([
    [401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate-limited'],
    [502, 'busy'], [503, 'busy'], [504, 'busy'], [404, 'network'], [500, 'network'],
  ] as const)('HTTP %i → %s', (status, code) => {
    expect(httpErrorCode(status)).toBe(code)
    expect(loadErrorCode({ status })).toBe(code)
  })
  it('loadErrorCode: SyntaxError → invalid-data, TypeError → network, own code kept', () => {
    expect(loadErrorCode(new SyntaxError('x'))).toBe('invalid-data')
    expect(loadErrorCode(new TypeError('Failed to fetch'))).toBe('network')
    expect(loadErrorCode(new ElementEditorError('timeout', 'picker', 'x'))).toBe('timeout')
  })
  it('ElementEditorError is an Error with code, source, cause, featureId', () => {
    const cause = new Error('inner')
    const e = new ElementEditorError('geometry', 'geometry', 'boom', { cause, featureId: 'f1' })
    expect(e).toBeInstanceOf(Error)
    expect(e).toMatchObject({ name: 'ElementEditorError', code: 'geometry', source: 'geometry', message: 'boom', cause, featureId: 'f1' })
  })
})

describe('Overpass (picker)', () => {
  beforeEach(() => clearOverpassCache())
  const fails = async (fetchImpl: typeof fetch, timeoutMs = 15000) => {
    const err = await fetchOverpassFeatures(48.85, 2.35, 50, undefined, { fetch: fetchImpl, timeoutMs, signal: new AbortController().signal }).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(OverpassError)
    expect(err).toBeInstanceOf(ElementEditorError)
    expect(err.source).toBe('picker')
    return err as OverpassError
  }
  it('429 with a long Retry-After → rate-limited', async () => {
    expect((await fails(async () => json(429, '', { 'Retry-After': '60' }))).code).toBe('rate-limited')
  })
  it('503 with a long Retry-After → busy', async () => {
    expect((await fails(async () => json(503, '', { 'Retry-After': '60' }))).code).toBe('busy')
  })
  it('404 → network', async () => {
    expect((await fails(async () => json(404, ''))).code).toBe('network')
  })
  it('an HTML page instead of JSON → invalid-data, with its own message', async () => {
    const err = await fails(async () => json(200, '<html>oops</html>'))
    expect(err.code).toBe('invalid-data')
    expect(overpassErrorMessage(err)).toMatch(/could not be read/)
  })
  it('no answer in time → timeout', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    expect((await fails(hang, 20)).code).toBe('timeout')
  })
})

describe('routing', () => {
  const realFetch = globalThis.fetch
  const withFetch = (impl: typeof fetch) => { globalThis.fetch = impl }
  afterEach(() => { globalThis.fetch = realFetch })
  const wp: [number, number][] = [[2.35, 48.85], [2.36, 48.86]]
  it('ORS 401 → unauthorized, and the message says the key was refused', async () => {
    withFetch(async () => json(401, 'bad key'))
    const err = await fetchRoute(wp, { apiKey: 'nope' }).then(() => null, (e) => e)
    expect(err).toMatchObject({ code: 'unauthorized', source: 'routing' })
    const reported = routingError(err)
    expect(reported).toMatchObject({ code: 'unauthorized', source: 'routing', cause: err })
    expect(reported.message).toMatch(/refused the API key/)
  })
  it('OSRM 429 → rate-limited; a failed request → network with the old message', async () => {
    withFetch(async () => json(429, ''))
    expect(routingError(await fetchRoute(wp, {}).catch((e) => e)).code).toBe('rate-limited')
    withFetch(async () => { throw new TypeError('Failed to fetch') })
    const net = routingError(await fetchRoute(wp, {}).catch((e) => e))
    expect(net).toMatchObject({ code: 'network', message: "Couldn't snap to road — using straight line" })
  })
})

describe('dataStore reports', () => {
  it('maxFeatures → limit-reached (editor), truncated import → limit-reached (import)', () => {
    const onError = vi.fn()
    const s = createDataStore({ onError })
    s.getState().setMaxFeatures(1)
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [0, 1, 2].map((i) => ({ type: 'Feature', id: `p${i}`, geometry: { type: 'Point', coordinates: [i, 0] }, properties: {} })) }, 'replace')
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'limit-reached', source: 'import' })
    s.getState().canAddFeatures(1)
    expect(onError.mock.calls[1][0]).toMatchObject({ code: 'limit-reached', source: 'editor' })
  })
  it('copySelection without a system clipboard: internal copy works, reported quietly as unsupported', async () => {
    const onError = vi.fn()
    const s = createDataStore({ onError })
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] }, 'replace')
    s.getState().setSelection(['a'])
    await expect(s.getState().copySelection()).resolves.toBe(false)
    expect(s.getState().clipboard).toHaveLength(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported', source: 'clipboard' }), { quiet: true })
  })
  it('copySelection: a refused clipboard write → permission-denied, quietly', async () => {
    const onError = vi.fn()
    const writeText = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      const s = createDataStore({ onError })
      s.getState().importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] }, 'replace')
      s.getState().setSelection(['a'])
      await expect(s.getState().copySelection()).resolves.toBe(false)
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'permission-denied', source: 'clipboard' }), { quiet: true })
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    }
  })
})

describe('EventProvider return protocol', () => {
  beforeEach(() => Object.values(toastFns).forEach((f) => f.mockClear()))
  const setup = (props: { onError?: (e: DistError) => void | false | string; onEvent?: (e: unknown) => void }) => {
    const wrapper = ({ children }: { children: ReactNode }) => <EventProvider {...props}>{children}</EventProvider>
    return renderHook(() => useEmit(), { wrapper }).result.current
  }
  const fire = (emit: ReturnType<typeof useEmit>, extra: object = {}) => act(() => emit({
    type: 'error', code: 'rate-limited', source: 'picker', message: 'Too many requests', description: 'Wait', featureId: 'f1', ...extra,
  }))

  it('void: onError gets an ElementEditorError first, the toast still shows', () => {
    const onError = vi.fn()
    fire(setup({ onError }))
    const err = onError.mock.calls[0][0]
    expect(err).toBeInstanceOf(DistError)
    expect(err).toMatchObject({ code: 'rate-limited', source: 'picker', message: 'Too many requests: Wait', featureId: 'f1' })
    expect(toastFns.error).toHaveBeenCalledWith('Too many requests', expect.objectContaining({ description: 'Wait' }))
  })
  it('false: no toast and no onEvent error event', () => {
    const onEvent = vi.fn()
    const emit = setup({ onError: () => false, onEvent })
    fire(emit)
    expect(toastFns.error).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
  })
  it('string: the toast shows that text instead (no description)', () => {
    fire(setup({ onError: (e) => (e.code === 'rate-limited' ? 'Zu viele Anfragen' : undefined) }))
    expect(toastFns.error).toHaveBeenCalledWith('Zu viele Anfragen', expect.objectContaining({ description: undefined }))
  })
  it('onError fires first in managed mode too; onEvent gets code + source, without internal fields', () => {
    const order: string[] = []
    const onEvent = vi.fn(() => order.push('event'))
    fire(setup({ onError: () => { order.push('error') }, onEvent }))
    expect(order).toEqual(['error', 'event'])
    expect(onEvent).toHaveBeenCalledWith({ type: 'error', code: 'rate-limited', source: 'picker', message: 'Too many requests', description: 'Wait' })
    expect(toastFns.error).not.toHaveBeenCalled()
  })
  it('quiet: onError only', () => {
    const onError = vi.fn()
    const onEvent = vi.fn()
    fire(setup({ onError, onEvent }), { quiet: true })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalled()
  })
  it('a nested provider with only onError runs it, then hands on to the outer onEvent', () => {
    const inner = vi.fn()
    const outerEvent = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EventProvider onEvent={outerEvent}><EventProvider onError={inner}>{children}</EventProvider></EventProvider>
    )
    const emit = renderHook(() => useEmit(), { wrapper }).result.current
    fire(emit)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outerEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'rate-limited' }))
  })
  it('a throwing onError does not swallow the toast', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fire(setup({ onError: () => { throw new Error('handler bug') } }))
    expect(toastFns.error).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('ErrorBoundary', () => {
  it('a render crash → crash / editor, original error as cause', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    const Boom = () => { throw new Error('kaput') }
    render(<ElementEditorErrorBoundary onError={onError}><Boom /></ElementEditorErrorBoundary>)
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'crash', source: 'editor', message: 'The editor crashed: kaput' })
    expect((onError.mock.calls[0][0] as DistError).cause).toBeInstanceOf(Error)
    spy.mockRestore()
  })
})

describe('useNominatim', () => {
  beforeEach(() => toastFns.error.mockClear())
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const search = async (impl: typeof fetch) => {
    globalThis.fetch = impl
    const onError = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => <EventProvider onError={onError}>{children}</EventProvider>
    const { result } = renderHook(() => useNominatim('Paris'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 2000 })
    return { message: result.current.error, err: onError.mock.calls[0][0] as DistError }
  }
  it('429 → rate-limited, says to wait (not "check your connection"), reported quietly', async () => {
    const { message, err } = await search(async () => json(429, ''))
    expect(message).toBe('Too many searches — wait a moment and try again.')
    expect(err).toMatchObject({ code: 'rate-limited', source: 'search' })
    expect(toastFns.error).not.toHaveBeenCalled()
  })
  it('a failed request → network, "check your connection"', async () => {
    const { message, err } = await search(async () => { throw new TypeError('Failed to fetch') })
    expect(message).toBe('Search unavailable. Check your connection.')
    expect(err.code).toBe('network')
  })
})
