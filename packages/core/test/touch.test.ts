/**
 * Touch helpers: `isTouchEvent` decides per event (finger vs mouse / pen), `attachLongPress`
 * fires for a resting finger only, not for a mouse, a drift past the slop, or an early lift.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isTouchEvent, attachLongPress, LONG_PRESS_MS } from '../src/utils/touch'

function pointer(type: string, pointerType: string, x = 0, y = 0): Event {
  return Object.assign(new Event(type), { pointerType, clientX: x, clientY: y })
}

afterEach(() => vi.useRealTimers())

describe('isTouchEvent', () => {
  it('a finger is touch; a mouse or pen is not', () => {
    expect(isTouchEvent({ type: 'pointerdown', pointerType: 'touch' })).toBe(true)
    expect(isTouchEvent({ type: 'click', pointerType: 'mouse' })).toBe(false)
    expect(isTouchEvent({ type: 'pointerdown', pointerType: 'pen' })).toBe(false)
    expect(isTouchEvent({ type: 'touchstart' })).toBe(true)
    expect(isTouchEvent({ type: 'click', sourceCapabilities: { firesTouchEvents: true } })).toBe(true)
    expect(isTouchEvent(null)).toBe(false)
  })
})

describe('attachLongPress', () => {
  it('fires after a resting finger, once; fired() reports it to the following click', () => {
    vi.useFakeTimers()
    const el = new EventTarget() as unknown as HTMLElement
    const cb = vi.fn()
    const lp = attachLongPress(el, cb)
    el.dispatchEvent(pointer('pointerdown', 'touch', 10, 10))
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(lp.fired()).toBe(true)
    expect(lp.fired()).toBe(false)
    lp.detach()
  })

  it('ignores a mouse, a drift and an early lift', () => {
    vi.useFakeTimers()
    const el = new EventTarget() as unknown as HTMLElement
    const cb = vi.fn()
    attachLongPress(el, cb)
    el.dispatchEvent(pointer('pointerdown', 'mouse'))
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    el.dispatchEvent(pointer('pointerdown', 'touch', 0, 0))
    el.dispatchEvent(pointer('pointermove', 'touch', 20, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    el.dispatchEvent(pointer('pointerdown', 'touch', 0, 0))
    vi.advanceTimersByTime(100)
    el.dispatchEvent(pointer('pointerup', 'touch', 0, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(cb).not.toHaveBeenCalled()
  })
})
