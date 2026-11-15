import { describe, it, expect } from 'vitest'
import type { GeoJSONFeature } from '@element-editor/core'
import { EMPTY_QUEUE, nextChunk, planMount, viewportFirst } from '../../../../adapter-leaflet/src/components/featureLayers/mountQueue'

const pt = (id: string, x: number): GeoJSONFeature =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 0] }, properties: {} }) as GeoJSONFeature
const ids = (fs: GeoJSONFeature[]) => fs.map((f) => f.id)
// Padded bounds −4..4 → the view itself is −2..2.
const VIEW = { w: -4, e: 4, s: -4, n: 4 }

describe('mountQueue', () => {
  it('viewportFirst puts in-view features first, keeping order within each part', () => {
    const fs = [pt('a', 10), pt('b', 0), pt('c', 3), pt('d', 1)]
    expect(ids(viewportFirst(fs, VIEW))).toEqual(['b', 'd', 'a', 'c'])
    expect(viewportFirst(fs, null)).toBe(fs)
  })

  it('a big new batch mounts nothing now; ticks then take chunks in queue order', () => {
    const fs = Array.from({ length: 5 }, (_, i) => pt(`f${i}`, i < 2 ? 50 : 0))
    const plan = planMount(fs, EMPTY_QUEUE, 2, VIEW)
    expect(plan.now).toEqual([])
    expect(ids(plan.queue.items)).toEqual(['f2', 'f3', 'f4', 'f0', 'f1'])
    const t1 = nextChunk(plan.queue, 2, VIEW, () => false)
    expect(ids(t1.chunk)).toEqual(['f2', 'f3'])
    // f4 got mounted meanwhile (e.g. selected): skipped.
    const t2 = nextChunk(t1.queue, 2, VIEW, (id) => id === 'f4')
    expect(ids(t2.chunk)).toEqual(['f0', 'f1'])
    expect(t2.queue.pos).toBe(t2.queue.items.length)
  })

  it('a small batch mounts at once', () => {
    const plan = planMount([pt('a', 0), pt('b', 0)], EMPTY_QUEUE, 5, VIEW)
    expect(ids(plan.now)).toEqual(['a', 'b'])
    expect(plan.queue.pos).toBe(plan.queue.items.length)
  })

  it('an update while mounting keeps mounting; a new batch while mounting waits a tick', () => {
    const fs = Array.from({ length: 6 }, (_, i) => pt(`f${i}`, 0))
    const q = nextChunk(planMount(fs, EMPTY_QUEUE, 2, null).queue, 2, null, () => false).queue
    // Same pending features (e.g. a validation update): a chunk mounts in this render.
    const rest = fs.slice(2)
    expect(ids(planMount(rest, q, 2, null).now)).toEqual(['f2', 'f3'])
    // An import lands while the batch is pending: nothing mounts in the import's render.
    const imported = rest.concat(Array.from({ length: 3 }, (_, i) => pt(`n${i}`, 0)))
    expect(planMount(imported, q, 2, null).now).toEqual([])
  })

  it('a removed queued feature drops out of the rebuilt queue', () => {
    const fs = Array.from({ length: 4 }, (_, i) => pt(`f${i}`, 0))
    const q = planMount(fs, EMPTY_QUEUE, 1, null).queue
    const plan = planMount(fs.filter((f) => f.id !== 'f1'), q, 1, null)
    expect(ids(plan.now).concat(ids(plan.queue.items))).not.toContain('f1')
  })

  it('a pan re-sorts what is left so the new view mounts first', () => {
    const fs = [pt('a', 0), pt('b', 100), pt('c', 1), pt('d', 101)]
    const q = planMount(fs, EMPTY_QUEUE, 1, VIEW).queue // a c b d
    const t1 = nextChunk(q, 1, VIEW, () => false)
    expect(ids(t1.chunk)).toEqual(['a'])
    const panned = { w: 96, e: 104, s: -4, n: 4 }
    const t2 = nextChunk(t1.queue, 2, panned, () => false)
    expect(ids(t2.chunk)).toEqual(['b', 'd'])
    expect(ids(nextChunk(t2.queue, 2, panned, () => false).chunk)).toEqual(['c'])
  })
})
