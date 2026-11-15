import type { GeoJSONFeature } from '../types/geojson'
import { withXY } from './positions'

/** Stable string key for exact coordinate matching. */
function coordKey(coord: [number, number]): string {
  return `${coord[0]},${coord[1]}`
}

export interface NeighborVertex {
  featureId: string
  /** Index into the polygon's coordinates array (polygon index for MultiPolygon). */
  polygonIndex: number
  /** Ring index within the polygon (0 = exterior). */
  ringIndex: number
  /** Vertex index within the ring (including the closing vertex for index 0). */
  vertexIndex: number
}

/**
 * Find all polygon vertices across features that share the exact same coordinates
 * as any of the given `movedCoords`. Excludes the source feature.
 *
 * For the closing vertex of a polygon ring (last === first), both index 0 and
 * the last index are returned so both get updated.
 */
export function findTopologicalNeighbors(
  features: GeoJSONFeature[],
  sourceFeatureId: string,
  movedCoords: [number, number][]
): NeighborVertex[] {
  if (movedCoords.length === 0) return []

  const keySet = new Set(movedCoords.map(coordKey))
  const results: NeighborVertex[] = []

  for (const f of features) {
    if (f.id === sourceFeatureId) continue
    if (f.hidden) continue

    if (f.geometry.type === 'Polygon') {
      const rings = f.geometry.coordinates as [number, number][][]
      for (let ri = 0; ri < rings.length; ri++) {
        const ring = rings[ri]
        for (let vi = 0; vi < ring.length; vi++) {
          if (keySet.has(coordKey(ring[vi]))) {
            results.push({ featureId: f.id, polygonIndex: 0, ringIndex: ri, vertexIndex: vi })
          }
        }
      }
    } else if (f.geometry.type === 'MultiPolygon') {
      const polygons = f.geometry.coordinates as [number, number][][][]
      for (let pi = 0; pi < polygons.length; pi++) {
        for (let ri = 0; ri < polygons[pi].length; ri++) {
          const ring = polygons[pi][ri]
          for (let vi = 0; vi < ring.length; vi++) {
            if (keySet.has(coordKey(ring[vi]))) {
              results.push({ featureId: f.id, polygonIndex: pi, ringIndex: ri, vertexIndex: vi })
            }
          }
        }
      }
    }
  }

  return results
}

/**
 * Find neighbors that share a specific edge (two consecutive vertices in
 * either order). Returns the position where a new vertex should be inserted.
 */
export interface SharedEdgeNeighbor {
  featureId: string
  polygonIndex: number
  ringIndex: number
  /** Insert the new vertex after this index in the ring. */
  afterVertexIndex: number
}

export function findSharedEdgeNeighbors(
  features: GeoJSONFeature[],
  sourceFeatureId: string,
  edgeStart: [number, number],
  edgeEnd: [number, number]
): SharedEdgeNeighbor[] {
  const keyA = coordKey(edgeStart)
  const keyB = coordKey(edgeEnd)
  const results: SharedEdgeNeighbor[] = []

  function scanRing(
    ring: [number, number][],
    featureId: string,
    polygonIndex: number,
    ringIndex: number
  ) {
    for (let i = 0; i < ring.length - 1; i++) {
      const kCur = coordKey(ring[i])
      const kNext = coordKey(ring[i + 1])
      // Match forward or reverse direction
      if ((kCur === keyA && kNext === keyB) || (kCur === keyB && kNext === keyA)) {
        results.push({ featureId, polygonIndex, ringIndex, afterVertexIndex: i })
      }
    }
  }

  for (const f of features) {
    if (f.id === sourceFeatureId) continue
    if (f.hidden) continue

    if (f.geometry.type === 'Polygon') {
      const rings = f.geometry.coordinates as [number, number][][]
      for (let ri = 0; ri < rings.length; ri++) {
        scanRing(rings[ri], f.id, 0, ri)
      }
    } else if (f.geometry.type === 'MultiPolygon') {
      const polygons = f.geometry.coordinates as [number, number][][][]
      for (let pi = 0; pi < polygons.length; pi++) {
        for (let ri = 0; ri < polygons[pi].length; ri++) {
          scanRing(polygons[pi][ri], f.id, pi, ri)
        }
      }
    }
  }

  return results
}

// --- Low-level apply helpers (return new geometry, no side effects) ---

/**
 * Apply a coordinate change to a neighbor feature's geometry.
 * Returns a new geometry object (does not mutate the original).
 */
export function applyTopoMove(
  geometry: GeoJSONFeature['geometry'],
  neighbors: NeighborVertex[],
  newCoord: [number, number]
): GeoJSONFeature['geometry'] {
  if (geometry.type === 'Polygon') {
    const rings = (geometry.coordinates as [number, number][][]).map(r => [...r])
    for (const n of neighbors) {
      rings[n.ringIndex][n.vertexIndex] = withXY(rings[n.ringIndex][n.vertexIndex], newCoord)
    }
    return { type: 'Polygon', coordinates: rings }
  } else if (geometry.type === 'MultiPolygon') {
    const polygons = (geometry.coordinates as [number, number][][][]).map(
      p => p.map(r => [...r])
    )
    for (const n of neighbors) {
      polygons[n.polygonIndex][n.ringIndex][n.vertexIndex] = withXY(polygons[n.polygonIndex][n.ringIndex][n.vertexIndex], newCoord)
    }
    return { type: 'MultiPolygon', coordinates: polygons }
  }
  return geometry
}

/**
 * Apply a vertex insertion on a shared edge in a neighbor feature.
 * Returns a new geometry object.
 */
export function applyTopoInsert(
  geometry: GeoJSONFeature['geometry'],
  edgeNeighbor: SharedEdgeNeighbor,
  newCoord: [number, number]
): GeoJSONFeature['geometry'] {
  if (geometry.type === 'Polygon') {
    const rings = (geometry.coordinates as [number, number][][]).map(r => [...r])
    rings[edgeNeighbor.ringIndex].splice(edgeNeighbor.afterVertexIndex + 1, 0, newCoord)
    return { type: 'Polygon', coordinates: rings }
  } else if (geometry.type === 'MultiPolygon') {
    const polygons = (geometry.coordinates as [number, number][][][]).map(
      p => p.map(r => [...r])
    )
    polygons[edgeNeighbor.polygonIndex][edgeNeighbor.ringIndex].splice(
      edgeNeighbor.afterVertexIndex + 1, 0, newCoord
    )
    return { type: 'MultiPolygon', coordinates: polygons }
  }
  return geometry
}

/**
 * Remove all vertices at a given coordinate from a neighbor feature.
 * Returns null if removal would leave a ring with < 3 unique vertices.
 */
export function applyTopoDelete(
  geometry: GeoJSONFeature['geometry'],
  coordToDelete: [number, number]
): GeoJSONFeature['geometry'] | null {
  const key = coordKey(coordToDelete)

  if (geometry.type === 'Polygon') {
    const rings = (geometry.coordinates as [number, number][][]).map(ring => {
      const filtered = ring.filter(c => coordKey(c) !== key)
      if (filtered.length > 0 && coordKey(filtered[0]) !== coordKey(filtered[filtered.length - 1])) {
        filtered.push(filtered[0])
      }
      return filtered
    })
    if (rings[0].length < 4) return null
    return { type: 'Polygon', coordinates: rings }
  } else if (geometry.type === 'MultiPolygon') {
    const polygons = (geometry.coordinates as [number, number][][][]).map(
      poly => poly.map(ring => {
        const filtered = ring.filter(c => coordKey(c) !== key)
        if (filtered.length > 0 && coordKey(filtered[0]) !== coordKey(filtered[filtered.length - 1])) {
          filtered.push(filtered[0])
        }
        return filtered
      })
    )
    for (const poly of polygons) {
      if (poly[0].length < 4) return null
    }
    return { type: 'MultiPolygon', coordinates: polygons }
  }
  return geometry
}

// --- High-level commit helpers (find neighbors + apply + callback) ---

type UpdateFn = (featureId: string, geometry: GeoJSONFeature['geometry']) => void
/**
 * One neighbour's new geometry, in the shape `dataStore.updateFeatures` takes. A neighbour drawn as
 * a circle / rectangle / route is no longer that shape once a shared point moves, so its patch also
 * clears `_drawType` (`neighbourPatch`).
 */
export type TopoUpdate = { id: string; patch: { geometry: GeoJSONFeature['geometry']; _drawType?: undefined } }

/** The patch for a neighbour whose shared points followed an edit: `_drawType` cleared when it had one. */
export function neighbourPatch(neighbour: Pick<GeoJSONFeature, '_drawType'>, geometry: GeoJSONFeature['geometry']): TopoUpdate['patch'] {
  return neighbour._drawType ? { geometry, _drawType: undefined } : { geometry }
}

export function groupNeighborsByFeature(neighbors: NeighborVertex[]): Map<string, NeighborVertex[]> {
  const grouped = new Map<string, NeighborVertex[]>()
  for (const n of neighbors) {
    const arr = grouped.get(n.featureId) || []
    arr.push(n)
    grouped.set(n.featureId, arr)
  }
  return grouped
}

/**
 * Find all neighbors sharing `originalCoord` and apply the move. Returns the neighbours' updates
 * (commit them with one `updateFeatures`); `onUpdate`, when given, is also called for each.
 */
export function commitTopoMove(
  features: GeoJSONFeature[],
  sourceFeatureId: string,
  originalCoord: [number, number],
  newCoord: [number, number],
  onUpdate?: UpdateFn
): TopoUpdate[] {
  const out: TopoUpdate[] = []
  const neighbors = findTopologicalNeighbors(features, sourceFeatureId, [originalCoord])
  if (neighbors.length === 0) return out
  const grouped = groupNeighborsByFeature(neighbors)
  const featMap = new Map(features.map(f => [f.id, f]))
  for (const [fid, nvs] of grouped) {
    const nf = featMap.get(fid)
    if (!nf) continue
    const geometry = applyTopoMove(nf.geometry, nvs, newCoord)
    out.push({ id: fid, patch: neighbourPatch(nf, geometry) })
    onUpdate?.(fid, geometry)
  }
  return out
}

/** Find neighbors sharing the edge and insert a new vertex. Returns the updates, as `commitTopoMove`. */
export function commitTopoInsert(
  features: GeoJSONFeature[],
  sourceFeatureId: string,
  edgeStart: [number, number],
  edgeEnd: [number, number],
  newCoord: [number, number],
  onUpdate?: UpdateFn
): TopoUpdate[] {
  const out: TopoUpdate[] = []
  const edgeNeighbors = findSharedEdgeNeighbors(features, sourceFeatureId, edgeStart, edgeEnd)
  const featMap = new Map(features.map(f => [f.id, f]))
  for (const en of edgeNeighbors) {
    const nf = featMap.get(en.featureId)
    if (!nf) continue
    const geometry = applyTopoInsert(nf.geometry, en, newCoord)
    out.push({ id: en.featureId, patch: neighbourPatch(nf, geometry) })
    onUpdate?.(en.featureId, geometry)
  }
  return out
}

/** Find neighbors sharing any of the deleted coords and remove them. Returns the updates, as `commitTopoMove`. */
export function commitTopoDelete(
  features: GeoJSONFeature[],
  sourceFeatureId: string,
  deletedCoords: [number, number][],
  onUpdate?: UpdateFn
): TopoUpdate[] {
  const out: TopoUpdate[] = []
  const neighbors = findTopologicalNeighbors(features, sourceFeatureId, deletedCoords)
  if (neighbors.length === 0) return out
  const affectedIds = new Set(neighbors.map(n => n.featureId))
  const featMap = new Map(features.map(f => [f.id, f]))
  for (const fid of affectedIds) {
    const nf = featMap.get(fid)
    if (!nf) continue
    let geom: GeoJSONFeature['geometry'] | null = nf.geometry
    for (const coord of deletedCoords) {
      if (!geom) break
      geom = applyTopoDelete(geom, coord)
    }
    if (geom) {
      out.push({ id: fid, patch: neighbourPatch(nf, geom) })
      onUpdate?.(fid, geom)
    }
  }
  return out
}

/** All vertices of a Polygon / MultiPolygon in order, or null for other types. */
function polygonVertices(g: GeoJSONFeature['geometry']): [number, number][] | null {
  if (g.type === 'Polygon') return (g.coordinates as [number, number][][]).flat()
  if (g.type === 'MultiPolygon') return (g.coordinates as [number, number][][][]).flat(2)
  return null
}

/**
 * The updates for committing a transform (move / scale / rotate) of `transformed`: each
 * transformed feature's geometry, then, with `topo`, every neighbour vertex shared with a
 * transformed polygon follows it. Vertices match by index (a transform keeps count and order).
 * Successive moves on one neighbour accumulate (each sees the previous ones). Commit the result
 * with one `updateFeatures`.
 */
export function transformUpdates(
  features: GeoJSONFeature[],
  transformed: ReadonlyArray<{ id: string; geometry: GeoJSONFeature['geometry'] }>,
  topo: boolean,
): TopoUpdate[] {
  const index = new Map(features.map((f, i) => [f.id, i]))
  const working = features.slice()
  const geoms = new Map<string, GeoJSONFeature['geometry']>()
  const apply = (id: string, geometry: GeoJSONFeature['geometry']) => {
    geoms.set(id, geometry)
    const i = index.get(id)
    if (i !== undefined) working[i] = { ...working[i], geometry }
  }
  for (const t of transformed) if (index.has(t.id)) apply(t.id, t.geometry)
  if (topo) {
    for (const t of transformed) {
      const i = index.get(t.id)
      if (i === undefined) continue
      const before = polygonVertices(features[i].geometry)
      const after = polygonVertices(t.geometry)
      if (!before || !after) continue
      for (let v = 0; v < before.length && v < after.length; v++) {
        if (before[v][0] !== after[v][0] || before[v][1] !== after[v][1]) {
          commitTopoMove(working, t.id, before[v], after[v], apply)
        }
      }
    }
  }
  // A transformed feature keeps its tag (the transform keeps its shape); a neighbour that only
  // followed at shared points doesn't.
  const moved = new Set(transformed.map((t) => t.id))
  return [...geoms].map(([id, geometry]) => {
    const i = index.get(id)
    return { id, patch: moved.has(id) || i === undefined ? { geometry } : neighbourPatch(features[i], geometry) }
  })
}
