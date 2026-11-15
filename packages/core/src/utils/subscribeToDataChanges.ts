import type { StoreApi } from 'zustand'
import type { DataStore } from '../store/dataStore'
import type { FeatureCollection, GeoJSONFeature } from '../types/geojson'

export interface DataChangeCallbacks {
  /** Fires on every committed change with the full current FeatureCollection. */
  onChange?: (data: FeatureCollection) => void
  /** Fires once per newly added feature (id not present in the previous snapshot). */
  onFeatureAdd?: (feature: GeoJSONFeature) => void
  /** Fires when a feature's geometry or properties reference changes between snapshots. */
  onFeatureUpdate?: (id: string, feature: GeoJSONFeature) => void
  /** Fires once per removed feature. */
  onFeatureDelete?: (id: string) => void
  /** Fires when `selectedIds` reference changes — independent of feature commits. */
  onSelectionChange?: (ids: string[]) => void
}

// Stripped copies are cached per store feature: a feature object is never mutated
// once committed, so an unchanged feature maps to the same clean object on every
// onChange (O(1) per untouched feature, and integrators get stable references).
const cleanCache = new WeakMap<GeoJSONFeature, GeoJSONFeature>()

function stripValidation(f: GeoJSONFeature): GeoJSONFeature {
  let clean = cleanCache.get(f)
  if (!clean) {
    const { _validation, ...rest } = f
    clean = rest as GeoJSONFeature
    cleanCache.set(f, clean)
  }
  return clean
}

function dispatchFeatureChanges(
  cb: DataChangeCallbacks,
  prevFeatures: GeoJSONFeature[],
  state: DataStore,
): void {
  const wantDiff = !!(cb.onFeatureAdd || cb.onFeatureUpdate || cb.onFeatureDelete)

  if (cb.onChange) {
    cb.onChange({
      type: 'FeatureCollection',
      metadata: { schemas: state.schemas, groups: state.groups },
      features: state.features.map(stripValidation),
    })
  }

  if (!wantDiff) return
  const next = state.features
  const changed = (prev: GeoJSONFeature, f: GeoJSONFeature) => prev.geometry !== f.geometry || prev.properties !== f.properties

  // Fast path — same ids in the same order (every single-feature edit): one
  // reference compare per slot, no Map/Set allocation.
  if (prevFeatures.length === next.length && next.every((f, i) => f === prevFeatures[i] || f.id === prevFeatures[i].id)) {
    if (cb.onFeatureUpdate) {
      for (let i = 0; i < next.length; i++) {
        const f = next[i]
        if (f !== prevFeatures[i] && changed(prevFeatures[i], f)) cb.onFeatureUpdate(f.id, stripValidation(f))
      }
    }
    return
  }

  const prevById = new Map<string, GeoJSONFeature>()
  for (const f of prevFeatures) prevById.set(f.id, f)

  const seenIds = new Set<string>()
  for (const f of next) {
    seenIds.add(f.id)
    const prev = prevById.get(f.id)
    if (!prev) cb.onFeatureAdd?.(stripValidation(f))
    else if (changed(prev, f)) cb.onFeatureUpdate?.(f.id, stripValidation(f))
  }

  if (cb.onFeatureDelete) {
    for (const id of prevById.keys()) {
      if (!seenIds.has(id)) cb.onFeatureDelete(id)
    }
  }
}

/**
 * Subscribes to an Element dataStore and dispatches granular change callbacks.
 *
 * Feature-level events fire when the `features` array reference changes — the
 * canonical commit signal from Zustand's immutable update pattern. This is
 * resilient to same-millisecond mutations that can collide on `lastModifiedAt`
 * (`Date.now()` has ms resolution). Selection changes are independent.
 *
 * The `get` argument is called on every dispatch so React hosts can keep
 * callback refs mutable without tearing down the subscription on each render.
 *
 * @returns the unsubscribe function.
 */
export function subscribeToDataChanges(
  store: StoreApi<DataStore>,
  get: () => DataChangeCallbacks,
): () => void {
  let prevFeatures = store.getState().features
  let prevSelectedIds = store.getState().selectedIds

  return store.subscribe((state) => {
    const cb = get()

    if (state.features !== prevFeatures) {
      dispatchFeatureChanges(cb, prevFeatures, state)
      prevFeatures = state.features
    }

    if (state.selectedIds !== prevSelectedIds) {
      prevSelectedIds = state.selectedIds
      cb.onSelectionChange?.(state.selectedIds)
    }
  })
}
