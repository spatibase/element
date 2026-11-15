/**
 * Live (mid-drag) geometry updates for the `elm-features` source.
 *
 * FeatureLayer records the exact feature list it last pushed via `setData`.
 * Drag / vertex-edit / transform previews then patch only the moved features:
 *
 *   - Every rendered feature has a unique `properties.id` (the usual case) →
 *     `source.updateData()` with just the changed geometries. MapLibre applies
 *     the diff in its worker and re-tiles only the affected tiles.
 *   - Some feature is split into several render features sharing one id
 *     (GeometryCollection expansion) → `updateData` would throw, so fall back
 *     to a full `setData` of the recorded list with the live geometries swapped
 *     in. Styles, hidden features and GC expansion stay exactly as rendered.
 *
 * The store commit on drag end goes through FeatureLayer's normal `setData`.
 */
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { Geometry } from '@element-editor/core'

const SOURCE = 'elm-features'

interface Rendered {
  features: GeoJSON.Feature[]
  uniqueIds: boolean
}

const renderedByMap = new WeakMap<MapLibreMap, Rendered>()

/** Called by FeatureLayer after every `setData` on `elm-features`. */
export function setRenderedFeatures(map: MapLibreMap, features: GeoJSON.Feature[], uniqueIds: boolean) {
  renderedByMap.set(map, { features, uniqueIds })
}

/** Paint live geometries (feature id → full geometry) into `elm-features`. */
export function paintLiveGeometries(map: MapLibreMap, live: ReadonlyMap<string, Geometry>) {
  const source = map.getSource(SOURCE) as GeoJSONSource | undefined
  const rendered = renderedByMap.get(map)
  if (!source || !rendered || live.size === 0) return
  try {
    if (rendered.uniqueIds) {
      const update: { id: string; newGeometry: GeoJSON.Geometry }[] = []
      let diffable = true
      for (const [id, g] of live) {
        if (g.type === 'GeometryCollection') {
          // Uniquely-id'd GC renders as its single sub-geometry (see FeatureLayer).
          if (g.geometries.length !== 1) { diffable = false; break }
          update.push({ id, newGeometry: g.geometries[0] as unknown as GeoJSON.Geometry })
        } else {
          update.push({ id, newGeometry: g as unknown as GeoJSON.Geometry })
        }
      }
      if (diffable) {
        source.updateData({ update })
        return
      }
    }
    const subIndex = new Map<string, number>()
    const features = rendered.features.map((rf) => {
      const id = rf.properties?.id as string
      const g = live.get(id)
      if (!g) return rf
      if (g.type === 'GeometryCollection') {
        const k = subIndex.get(id) ?? 0
        subIndex.set(id, k + 1)
        const sub = g.geometries[k]
        return sub ? { ...rf, geometry: sub as unknown as GeoJSON.Geometry } : rf
      }
      return { ...rf, geometry: g as unknown as GeoJSON.Geometry }
    })
    source.setData({ type: 'FeatureCollection', features })
  } catch { /* source removed mid-drag (StrictMode / HMR race) */ }
}
