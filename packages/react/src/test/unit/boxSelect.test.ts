import { describe, it, expect } from 'vitest'
import { bboxInside, sameIdSet } from '../../../../adapter-leaflet/src/utils/boxSelect'

describe('bboxInside', () => {
  it('accepts a bbox fully inside, edges inclusive', () => {
    expect(bboxInside([1, 1, 2, 2], 0, 0, 3, 3)).toBe(true)
    expect(bboxInside([0, 0, 3, 3], 0, 0, 3, 3)).toBe(true)
  })
  it('rejects a bbox that crosses or lies outside the box', () => {
    expect(bboxInside([-1, 1, 2, 2], 0, 0, 3, 3)).toBe(false)
    expect(bboxInside([1, 1, 2, 4], 0, 0, 3, 3)).toBe(false)
    expect(bboxInside([5, 5, 6, 6], 0, 0, 3, 3)).toBe(false)
  })
})

describe('sameIdSet', () => {
  it('ignores order', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameIdSet([], [])).toBe(true)
  })
  it('detects differences', () => {
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false)
    expect(sameIdSet(['a', 'b'], ['a', 'c'])).toBe(false)
  })
})
