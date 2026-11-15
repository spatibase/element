import { describe, it, expect } from 'vitest'
import { tileCandidates, tileCandidateResult, tileFeatureToResult, unionPieces, type TileFeature } from '../../../../core/src/utils/overpass'

// A feature clipped into a 3x3 block of tiles, each piece overlapping its
// neighbours by the tile buffer, with `n` vertices per edge (wavy, as real
// landcover is) so merging costs what it does on a real map.
const wavy = (x0: number, y0: number, x1: number, y1: number, n: number, seed: number) => {
  const ring: [number, number][] = []
  const j = (k: number) => Math.sin(k * 12.9898 + seed) * 0.00002
  for (let k = 0; k < n; k++) ring.push([x0 + ((x1 - x0) * k) / n, y0 + j(k)])
  for (let k = 0; k < n; k++) ring.push([x1 + j(k + n), y0 + ((y1 - y0) * k) / n])
  for (let k = 0; k < n; k++) ring.push([x1 - ((x1 - x0) * k) / n, y1 + j(k + 2 * n)])
  for (let k = 0; k < n; k++) ring.push([x0 + j(k + 3 * n), y1 - ((y1 - y0) * k) / n])
  ring.push(ring[0])
  return [ring]
}
const T = 0.01 // tile size (deg)
const B = 0.0004 // tile buffer overlap
function feature(id: number, sourceLayer: string, size: number, n = 200): TileFeature[] {
  const pieces: TileFeature[] = []
  for (let tx = 0; tx < 3; tx++) for (let ty = 0; ty < 3; ty++) {
    const x0 = (tx - 1.5) * T * size
    const y0 = (ty - 1.5) * T * size
    pieces.push({ source: 'osm', sourceLayer, id, properties: { class: 'wood', name: `F${id}` }, geometry: { type: 'Polygon', coordinates: wavy(x0 - B, y0 - B, x0 + T * size + B, y0 + T * size + B, n, id * 9 + tx * 3 + ty) } })
  }
  return pieces
}
const click: [number, number] = [0.0001, 0.0001]

describe('tileCandidates (shape picker from tiles)', () => {
  it('groups pieces per feature, dedupes the same id across tiles and park/landcover, smallest first', () => {
    const a = feature(1, 'landcover', 1, 8)
    const parkCopy = feature(1, 'park', 1, 8)
    const b = feature(2, 'landcover', 2, 8)
    const building = feature(1, 'building', 0.1, 8) // same id, other group: its own candidate
    const rendered = [building[4], parkCopy[4], a[4], a[4], b[4]]
    const cs = tileCandidates(rendered, [...a, ...parkCopy, ...b, ...building])
    expect(cs.map((c) => c.key)).toEqual(['osm/building/1', 'osm/area/1', 'osm/area/2'])
    expect(cs[1].pieces).toHaveLength(9)
    expect(cs[1].type).toBe('Wood')
    // A feature without loaded pieces uses its rendered one.
    expect(tileCandidates([{ ...a[4], id: 99 }], [])[0].pieces).toHaveLength(1)
  })

  it('merging only the chosen candidate gives what merging every candidate gave', async () => {
    const fs = Array.from({ length: 3 }, (_, i) => feature(i + 1, 'landcover', 1 + i, 20))
    const cs = tileCandidates(fs.map((f) => f[4]), fs.flat())
    const chosen = cs[1]
    const r = tileCandidateResult(chosen, await unionPieces(chosen.pieces), click)!
    const old = (await tileFeatureToResult(fs[1], 2, click))!
    expect(r.geometry).toEqual(old.geometry)
    expect(r).toMatchObject({ osmId: 2, name: 'F2', type: 'Wood' })
    // Merging failed: the piece under the click.
    expect(tileCandidateResult(chosen, null, click)!.geometry.coordinates).toEqual(chosen.pieces[4].geometry.coordinates)
  })

  it('builds 20 large candidates without merging them (main-thread time)', async () => {
    const fs = Array.from({ length: 20 }, (_, i) => feature(i + 1, i % 2 ? 'landcover' : 'landuse', 1 + i * 0.1, 100))
    const rendered = fs.map((f) => f[4])
    const pieces = fs.flat()
    await tileFeatureToResult(fs[0], 1, click) // loads @turf/union outside the timing
    let t = performance.now()
    const before: unknown[] = []
    for (const [i, f] of fs.entries()) before.push(await tileFeatureToResult(f, i + 1, click)) // what the picker did per click
    const beforeMs = performance.now() - t
    t = performance.now()
    const cs = tileCandidates(rendered, pieces)
    const afterMs = performance.now() - t
    t = performance.now()
    await unionPieces(cs[0].pieces) // the one chosen (in the geometry worker in the app)
    const chosenMs = performance.now() - t
    console.log(`picker candidates, 20 features x 9 pieces x 400 vertices: union all ${beforeMs.toFixed(0)} ms -> group + area ${afterMs.toFixed(1)} ms (+ chosen union ${chosenMs.toFixed(0)} ms, off the main thread)`)
    expect(before.every(Boolean)).toBe(true)
    expect(cs).toHaveLength(20)
    expect(afterMs).toBeLessThan(beforeMs / 5)
  }, 30_000)
})
