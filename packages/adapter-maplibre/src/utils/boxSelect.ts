/** True when bbox [w, s, e, n] lies fully inside the lng/lat box (edges inclusive). */
export function bboxInside(
  [w, s, e, n]: readonly number[],
  lngMin: number, latMin: number, lngMax: number, latMax: number,
): boolean {
  return w >= lngMin && e <= lngMax && s >= latMin && n <= latMax
}

/** Order-insensitive equality of two id lists (assumes neither has duplicates). */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
