import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONFeature } from '@element-editor/core'
import { EMPTY_QUEUE, nextChunk, planMount, type MountQueue, type ViewBounds } from './mountQueue'

export type { ViewBounds } from './mountQueue'

/** ms of mount work per tick, and the chunk-size clamp. */
const MOUNT_BUDGET_MS = 8
const MOUNT_MIN = 50
const MOUNT_MAX = 1000

/** The features one chunk mounted; memoised so an unchanged group isn't re-reconciled. */
const FeatureGroup = memo(function FeatureGroup({ items }: { items: React.ReactElement[] }) {
  return <>{items}</>
})

/** Its effect runs before its later siblings' (the feature layers') effects: marks where they start. */
function EffectMark({ tick, onEffect }: { tick: unknown; onEffect: () => void }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(onEffect, [tick])
  return null
}

/** What the last commit rendered. Written in an effect, so a discarded (or StrictMode double) render can't leak in. */
type Committed = {
  inputs: unknown[]
  elements: React.ReactElement[]
  groups: Map<number, React.ReactElement[]>
  queue: MountQueue
}

/**
 * Progressive mounting: a batch of new features bigger than one tick's
 * budget (initial load, import, a zoom-out) mounts a chunk per tick, the
 * ones in the viewport first, instead of creating every Leaflet layer in one
 * long task. `mountedIdsRef` is what the last commit rendered; features
 * already in it, and the `alwaysMount` ones (selected / vertex-edit), always render.
 *
 * A data / selection change runs a full pass (O(culled)): it rebuilds the
 * element list and the queue of features still to mount (see `planMount`:
 * viewport first, reverse list order so the first in the list draws on top).
 * A mount tick with nothing else changed is O(chunk): it takes the next chunk
 * off the queue and appends it as one new group to the last commit's list.
 * The chunk size adapts: an EMA of ms per mounted feature, measured on ticks
 * only (render → layout effect, plus the layers' passive effects), sizes the
 * next chunk to MOUNT_BUDGET_MS.
 * Committed features also carry the group they mounted in: each group is a
 * memoised <FeatureGroup>, so a commit re-reconciles only the groups whose
 * elements changed, not every mounted feature. Render order doesn't affect
 * z-order: Leaflet stacks layers in addLayer order.
 *
 * `build(list, mounts, partial)` returns one element per feature of `list`, or
 * null to skip it (it must skip those `mounts` rejects). `partial` = a tick:
 * `list` is just the new chunk. It runs inside a useMemo over `features`, `deps`
 * and the mount tick only, so `viewBounds` (a pan) alone never rebuilds the list.
 */
export function useProgressiveMount(
  features: GeoJSONFeature[],
  alwaysMount: (f: GeoJSONFeature) => boolean,
  viewBounds: ViewBounds | null,
  build: (list: GeoJSONFeature[], mounts: (f: GeoJSONFeature) => boolean, partial: boolean) => (React.ReactElement | null)[],
  deps: unknown[],
): React.ReactElement {
  const mountedIdsRef = useRef<Map<string, number>>(new Map())
  const committedRef = useRef<Committed>({ inputs: [], elements: [], groups: new Map(), queue: EMPTY_QUEUE })
  const groupSeqRef = useRef(0)
  const [mountTick, setMountTick] = useState(0)
  const mountCostRef = useRef({ msPerFeature: 0.16, chunk: MOUNT_MIN, renderMs: 0, effectStart: 0 })
  const inputs = [features, ...deps]
  const result = useMemo(() => {
    const prev = committedRef.current
    const committed = mountedIdsRef.current
    const newGroup = groupSeqRef.current
    const chunkSize = mountCostRef.current.chunk

    // A mount tick with nothing else changed: append the next chunk as a new group.
    if (prev.inputs.length === inputs.length && prev.inputs.every((v, i) => v === inputs[i])) {
      const { chunk, queue } = nextChunk(prev.queue, chunkSize, viewBounds, (id) => committed.has(id))
      const start = performance.now()
      const items: React.ReactElement[] = []
      const added = new Map<string, number>()
      build(chunk, () => true, true).forEach((el, i) => { if (el) { items.push(el); added.set(chunk[i].id, newGroup) } })
      let { elements, groups } = prev
      if (items.length) {
        groups = new Map(groups).set(newGroup, items)
        elements = [...elements, <FeatureGroup key={newGroup} items={items} />]
      }
      return { elements, groups, queue, added, mountedIds: null, n: items.length, start }
    }

    // Full pass.
    const ordered = [...features].reverse() // first in the list mounts last = draws on top
    const isNew = (f: GeoJSONFeature) => !committed.has(f.id) && !alwaysMount(f)
    const { now, queue } = planMount(ordered.filter(isNew), prev.queue, chunkSize, viewBounds)
    const allowed = new Set(now.map((f) => f.id))
    const out = build(ordered, (f) => !isNew(f) || allowed.has(f.id), false)
    const ids = new Map<string, number>()
    const byGroup = new Map<number, React.ReactElement[]>()
    out.forEach((el, i) => {
      if (!el) return
      const id = ordered[i].id
      const g = committed.get(id) ?? newGroup
      ids.set(id, g)
      const arr = byGroup.get(g)
      if (arr) arr.push(el); else byGroup.set(g, [el])
    })
    // Reuse a group's previous array when its elements are unchanged → its memo bails out.
    const groups = new Map<number, React.ReactElement[]>()
    const elements = [...byGroup].map(([g, arr]) => {
      const old = prev.groups.get(g)
      const items = old && old.length === arr.length && old.every((e, i) => e === arr[i]) ? old : arr
      groups.set(g, items)
      return <FeatureGroup key={g} items={items} />
    })
    return { elements, groups, queue, added: null, mountedIds: ids, n: 0, start: 0 }
  // mountTick: re-run to mount the next chunk. viewBounds is read, not a dep (see above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...inputs, mountTick])
  useLayoutEffect(() => {
    mountCostRef.current.renderMs = performance.now() - result.start
  }, [result])
  const markEffectStart = useCallback(() => { mountCostRef.current.effectStart = performance.now() }, [])
  useEffect(() => {
    if (result.mountedIds) mountedIdsRef.current = result.mountedIds
    else for (const [id, g] of result.added) mountedIdsRef.current.set(id, g)
    committedRef.current = { inputs, elements: result.elements, groups: result.groups, queue: result.queue }
    if (result.groups.has(groupSeqRef.current)) groupSeqRef.current++
    const c = mountCostRef.current
    // ponytail: linear cost model from ticks only (their render is O(chunk), so
    // this is mount cost); a per-tick fixed cost still shrinks the chunk a bit.
    if (result.n >= 20) {
      const ms = c.renderMs + performance.now() - c.effectStart
      c.msPerFeature = c.msPerFeature * 0.5 + (ms / result.n) * 0.5
      c.chunk = Math.round(Math.min(MOUNT_MAX, Math.max(MOUNT_MIN, MOUNT_BUDGET_MS / c.msPerFeature)))
    }
    if (result.queue.pos >= result.queue.items.length) return
    const timer = setTimeout(() => setMountTick((t) => t + 1))
    return () => clearTimeout(timer)
  // `inputs` is what `result` was computed from.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  return (
    <>
      <EffectMark tick={result} onEffect={markEffectStart} />
      {result.elements}
    </>
  )
}
