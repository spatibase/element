import { describe, it, expect } from 'vitest'
import { placeBox } from '@element-editor/core/internal'

const bounds = { left: 0, top: 0, right: 1000, bottom: 800 }

describe('placeBox', () => {
  it('keeps the preferred side when it fits', () => {
    expect(placeBox(100, 100, 50, 20, { x: 'after', y: 'after', gapX: 10, gapY: 10, bounds })).toEqual({ left: 110, top: 110 })
  })
  it('flips across the point when the preferred side overflows', () => {
    expect(placeBox(980, 790, 50, 20, { x: 'after', y: 'after', gapX: 10, gapY: 10, bounds })).toEqual({ left: 920, top: 760 })
    expect(placeBox(100, 5, 50, 20, { x: 'center', y: 'before', gapY: 12, bounds })).toEqual({ left: 75, top: 17 })
  })
  it('clamps a centered box inside the margin', () => {
    expect(placeBox(10, 400, 100, 20, { x: 'center', y: 'center', bounds }).left).toBe(8)
    expect(placeBox(995, 400, 100, 20, { x: 'center', y: 'center', bounds }).left).toBe(892)
  })
})
