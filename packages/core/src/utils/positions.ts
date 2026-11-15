/**
 * Position helpers shared by every geometry transform (move, rotate, scale).
 *
 * A GeoJSON position may carry more than two numbers (altitude, RFC 7946 §3.1.1);
 * transforms only ever change x/y, so the extra members must ride along or a drag
 * silently strips elevation from imported 3D data.
 */

/** `xy` with the extra members of `pos` (altitude, …) carried over. Returns `xy` itself for a 2D `pos`. */
export function withXY(pos: readonly number[], xy: [number, number]): [number, number] {
  return pos.length > 2 ? ([xy[0], xy[1], ...pos.slice(2)] as unknown as [number, number]) : xy
}

/**
 * A position inserted at `xy` between `a` and `b` (a new point on an edge): when both ends carry
 * extra members (altitude, …), it gets their mean, so a 3D ring stays 3D. Otherwise just `xy`.
 */
export function insertedPosition(a: readonly number[] | undefined, b: readonly number[] | undefined, xy: [number, number]): [number, number] {
  if (!a || !b || a.length <= 2 || b.length <= 2) return xy
  const extra: number[] = []
  for (let i = 2; i < Math.min(a.length, b.length); i++) extra.push((a[i] + b[i]) / 2)
  return [xy[0], xy[1], ...extra] as unknown as [number, number]
}

/** Maps every position in a (possibly nested) coordinate array; extra members are kept. Never mutates. */
export function mapCoordinates<T>(coords: T, fn: (xy: [number, number]) => [number, number]): T {
  const traverse = (arr: unknown[]): unknown[] =>
    !Array.isArray(arr) ? arr
      : typeof arr[0] === 'number' ? withXY(arr as number[], fn(arr as unknown as [number, number]))
      : arr.map((item) => traverse(item as unknown[]))
  return traverse(coords as unknown[]) as T
}

interface AnyGeometry {
  type: string
  coordinates?: unknown
  geometries?: readonly AnyGeometry[]
}

/**
 * A copy of `geometry` with `fn` applied to every position's [x, y], for every
 * geometry type (GeometryCollection members included). Extra position members
 * (altitude) are kept. Never mutates.
 */
export function mapPositions<G extends AnyGeometry>(geometry: G, fn: (xy: [number, number]) => [number, number]): G {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: (geometry.geometries ?? []).map((g) => mapPositions(g, fn)) }
  }
  return { ...geometry, coordinates: mapCoordinates(geometry.coordinates, fn) }
}
