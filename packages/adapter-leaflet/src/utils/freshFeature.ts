/**
 * The "fresh" feature: one just added under a still cursor (a placed point, a line
 * finished with Enter on its last vertex). Until the cursor leaves it, it shows no
 * name tooltip and is no snap target (the snap ring would sit on the point you just
 * placed); a fresh point is tinted one accent step darker instead. Shared by every
 * editor on the page, like the name tooltip.
 */
import { useSyncExternalStore } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { getGeometryBBox, type GeoJSONFeature } from '@element-editor/core'

let freshId: string | null = null
/** Added features whose bbox holds the cursor but that weren't hovered yet (Leaflet only
 *  hit-tests on mousemove): the first hover of one makes it fresh. */
let pending: GeoJSONFeature[] = []
const listeners = new Set<() => void>()

export const freshFeatureId = () => freshId

export function setFreshFeature(id: string | null) {
  pending = []
  if (freshId === id) return
  freshId = id
  for (const l of listeners) l()
}

/** Remember just-added features that sit under the cursor (container point `p`). */
export function markAddedUnderCursor(map: LeafletMap, added: GeoJSONFeature[], p: { x: number; y: number }) {
  pending = added.filter((f) => f.geometry.type !== 'Point' && bboxHolds(map, f, p))
}

/** Drop pending features the cursor has moved away from (cheap: a handful of bboxes). */
export function prunePending(map: LeafletMap, p: { x: number; y: number }) {
  if (pending.length) pending = pending.filter((f) => bboxHolds(map, f, p))
}

/** Hovering `id`: true when it's the fresh feature (its first hover may make it so). */
export function claimFresh(id: string): boolean {
  if (pending.some((f) => f.id === id)) setFreshFeature(id)
  return freshId === id
}

export function useIsFreshFeature(id: string): boolean {
  return useSyncExternalStore(subscribe, () => freshId === id)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

const PAD = 10
function bboxHolds(map: LeafletMap, f: GeoJSONFeature, p: { x: number; y: number }) {
  const b = f.bbox ?? getGeometryBBox(f.geometry)
  const sw = map.latLngToContainerPoint([b[1], b[0]])
  const ne = map.latLngToContainerPoint([b[3], b[2]])
  return p.x >= sw.x - PAD && p.x <= ne.x + PAD && p.y >= ne.y - PAD && p.y <= sw.y + PAD
}
