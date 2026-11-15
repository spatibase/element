import { getFeatureBBox, type GeoJSONFeature } from '@element-editor/core'

export type ViewBounds = { w: number; s: number; e: number; n: number }

/**
 * What's left to mount progressively, in mount order. Built once per data /
 * selection change (O(new features)); each mount tick then takes the next
 * chunk from `pos` (O(chunk)).
 */
export type MountQueue = { items: GeoJSONFeature[]; pos: number; bounds: ViewBounds | null }

export const EMPTY_QUEUE: MountQueue = { items: [], pos: 0, bounds: null }

/** Mount order: features in the view first, each part keeping its given order. */
export function viewportFirst(features: GeoJSONFeature[], bounds: ViewBounds | null): GeoJSONFeature[] {
  if (!bounds) return features
  // `bounds` is the view padded by 50% per side: shrink back to the view.
  const qx = (bounds.e - bounds.w) / 4, qy = (bounds.n - bounds.s) / 4
  const w = bounds.w + qx, e = bounds.e - qx, s = bounds.s + qy, n = bounds.n - qy
  const inView: GeoJSONFeature[] = [], rest: GeoJSONFeature[] = []
  for (const f of features) {
    const [minX, minY, maxX, maxY] = getFeatureBBox(f)
    ;(maxX >= w && minX <= e && maxY >= s && minY <= n ? inView : rest).push(f)
  }
  return inView.concat(rest)
}

/**
 * Full pass: the features that need mounting (`fresh`, in render order) against the
 * previous queue. Returns the first chunk to mount now and the queue of the rest.
 * A big new batch (more features the previous queue didn't hold than one chunk,
 * e.g. an import landing, even while an earlier batch is still mounting) mounts
 * nothing in the render that brought it: that render is often the import's own
 * long task. The first chunk then waits for the next tick.
 */
export function planMount(fresh: GeoJSONFeature[], prev: MountQueue, chunk: number, bounds: ViewBounds | null) {
  let arrivals = fresh.length
  if (prev.pos < prev.items.length && fresh.length > chunk) {
    const pending = new Set<string>()
    for (let i = prev.pos; i < prev.items.length; i++) pending.add(prev.items[i].id)
    arrivals = 0
    for (const f of fresh) if (!pending.has(f.id)) arrivals++
  }
  if (arrivals > chunk) chunk = 0
  const items = fresh.length > chunk ? viewportFirst(fresh, bounds) : fresh
  const now = Math.min(chunk, items.length)
  return { now: items.slice(0, now), queue: { items, pos: now, bounds } as MountQueue }
}

/**
 * Mount tick: the next `size` features of the queue, skipping any already mounted
 * (e.g. selected meanwhile). A pan since the queue was built re-sorts what's left
 * so the new view mounts first.
 */
export function nextChunk(q: MountQueue, size: number, bounds: ViewBounds | null, mounted: (id: string) => boolean) {
  let { items, pos } = q
  if (bounds !== q.bounds && pos < items.length) { items = viewportFirst(items.slice(pos), bounds); pos = 0 }
  const chunk: GeoJSONFeature[] = []
  while (pos < items.length && chunk.length < size) {
    const f = items[pos++]
    if (!mounted(f.id)) chunk.push(f)
  }
  return { chunk, queue: { items, pos, bounds } as MountQueue }
}
