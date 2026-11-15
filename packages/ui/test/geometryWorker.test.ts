/**
 * Geometry worker ops (src/workers/geometryWorker.ts). The worker only exposes `self.onmessage`,
 * so the module is loaded against a fake `self` and driven with request messages.
 *
 * 'cut-hole' and 'slice-shape' are posted by core's uiStore (commitCutHole / commitSliceShape) through
 * the runner the worker client registers with core's setGeometryRunner; core keeps a main-thread
 * fallback for when no runner is registered.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import type { GeometryWorkerPayload } from '@element-editor/core'
import type { GeometryWorkerResponse } from '@element-editor/core/internal'

type PolyFeature = Feature<Polygon | MultiPolygon>

const posted: GeometryWorkerResponse[] = []
const fakeSelf: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (r: GeometryWorkerResponse) => void } = {
  onmessage: null,
  postMessage: (r) => { posted.push(r) },
}

beforeAll(async () => {
  vi.stubGlobal('self', fakeSelf)
  await import('../src/workers/geometryWorker')
  expect(typeof fakeSelf.onmessage).toBe('function')
})

let nextId = 0
function run(payload: GeometryWorkerPayload | Record<string, unknown>): GeometryWorkerResponse {
  const id = `req-${++nextId}`
  const before = posted.length
  fakeSelf.onmessage!({ data: { id, payload } })
  expect(posted.length).toBe(before + 1) // exactly one reply per request
  const r = posted[posted.length - 1]
  expect(r.id).toBe(id)
  return r
}
function ok(payload: GeometryWorkerPayload): Geometry {
  const r = run(payload)
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  expect(r.result!.type).toBe(payload.type)
  return r.result!.geometry
}

// ─── geometry measuring helpers (planar, degrees²; shapes sit at the equator) ───

function ringArea(r: Position[]): number {
  let s = 0
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return Math.abs(s) / 2
}
function polyArea(rings: Position[][]): number {
  return ringArea(rings[0]) - rings.slice(1).reduce((a, h) => a + ringArea(h), 0)
}
function area(g: Geometry): number {
  if (g.type === 'Polygon') return polyArea(g.coordinates)
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((a, p) => a + polyArea(p), 0)
  throw new Error(`no area for ${g.type}`)
}
function parts(g: Geometry): Position[][][] {
  if (g.type === 'Polygon') return [g.coordinates]
  if (g.type === 'MultiPolygon') return g.coordinates
  throw new Error(`not polygonal: ${g.type}`)
}
/** Every ring closed with ≥ 4 positions, all numbers finite. */
function expectValidPolygonal(g: Geometry) {
  for (const poly of parts(g)) {
    expect(poly.length).toBeGreaterThan(0)
    for (const ring of poly) {
      expect(ring.length).toBeGreaterThanOrEqual(4)
      expect(ring[0]).toEqual(ring[ring.length - 1])
      for (const p of ring) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true)
    }
  }
}
function vertexCount(g: Geometry): number {
  return parts(g).reduce((a, p) => a + p.reduce((b, r) => b + r.length, 0), 0)
}

const sqRing = (x: number, y: number, s: number): Position[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
const sq = (x: number, y: number, s: number): PolyFeature =>
  ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [sqRing(x, y, s)] } })
const circleRing = (n: number, r = 0.01, cx = 0, cy = 0): Position[] => {
  const out: Position[] = []
  for (let i = 0; i < n; i++) out.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)])
  out.push(out[0])
  return out
}

// A (0..1) and B (0.5..1.5) overlap in a 0.5×0.5 square.
const A = sq(0, 0, 1)
const B = sq(0.5, 0.5, 1)
const FAR = sq(5, 5, 1)

describe('boolean: union', () => {
  it('overlapping squares → one polygon with area A + B − overlap', () => {
    const g = ok({ type: 'boolean', op: 'union', features: [A, B] })
    expect(g.type).toBe('Polygon')
    expect(area(g)).toBeCloseTo(1 + 1 - 0.25, 9)
    expectValidPolygonal(g)
  })

  it('disjoint squares → MultiPolygon with both parts', () => {
    const g = ok({ type: 'boolean', op: 'union', features: [A, FAR] })
    expect(g.type).toBe('MultiPolygon')
    expect(parts(g)).toHaveLength(2)
    expect(area(g)).toBeCloseTo(2, 9)
  })

  it('three features union in one request', () => {
    const g = ok({ type: 'boolean', op: 'union', features: [A, B, sq(1, 0, 1)] })
    expect(area(g)).toBeCloseTo(1.75 + 1 - 0.25 /* x1..1.5,y0.5..1 */ - 0, 9)
    expectValidPolygonal(g)
  })

  it('a contained shape adds nothing', () => {
    const g = ok({ type: 'boolean', op: 'union', features: [A, sq(0.25, 0.25, 0.5)] })
    expect(area(g)).toBeCloseTo(1, 9)
  })
})

describe('boolean: intersect', () => {
  it('overlap → the 0.5×0.5 square', () => {
    const g = ok({ type: 'boolean', op: 'intersect', features: [A, B] })
    expect(g.type).toBe('Polygon')
    expect(area(g)).toBeCloseTo(0.25, 9)
    expect(vertexCount(g)).toBe(5)
  })

  it('no overlap → EMPTY_RESULT with a user-facing message', () => {
    const r = run({ type: 'boolean', op: 'intersect', features: [A, FAR] })
    expect(r).toEqual({ id: r.id, ok: false, error: { type: 'error', message: 'No overlap found between the selected shapes.', code: 'EMPTY_RESULT' } })
  })
})

describe('boolean: subtract', () => {
  it('A − B removes the overlap from A only', () => {
    const g = ok({ type: 'boolean', op: 'subtract', features: [A, B] })
    expect(area(g)).toBeCloseTo(0.75, 9)
    expectValidPolygonal(g)
  })

  it('subtracting a shape inside A leaves a hole', () => {
    const g = ok({ type: 'boolean', op: 'subtract', features: [A, sq(0.25, 0.25, 0.5)] }) as Polygon
    expect(g.type).toBe('Polygon')
    expect(g.coordinates).toHaveLength(2)
    expect(area(g)).toBeCloseTo(0.75, 9)
  })

  it('subtracts every later feature from the first', () => {
    const g = ok({ type: 'boolean', op: 'subtract', features: [A, B, sq(-0.5, -0.5, 1)] })
    expect(area(g)).toBeCloseTo(1 - 0.25 - 0.25, 9)
  })

  it('a fully covered shape → EMPTY_RESULT', () => {
    const r = run({ type: 'boolean', op: 'subtract', features: [sq(0.25, 0.25, 0.5), A] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatchObject({ code: 'EMPTY_RESULT', message: 'Subtraction resulted in an empty shape.' })
  })
})

describe('boolean: exclude (xor)', () => {
  it('area = A + B − 2·overlap, split into two pieces', () => {
    const g = ok({ type: 'boolean', op: 'exclude', features: [A, B] })
    expect(area(g)).toBeCloseTo(2 - 0.5, 9)
    expectValidPolygonal(g)
  })

  it('disjoint shapes → their union', () => {
    const g = ok({ type: 'boolean', op: 'exclude', features: [A, FAR] })
    expect(area(g)).toBeCloseTo(2, 9)
  })

  it('identical shapes cancel out → EMPTY_RESULT', () => {
    const r = run({ type: 'boolean', op: 'exclude', features: [A, sq(0, 0, 1)] })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('EMPTY_RESULT')
  })

  it('three shapes: a point covered by an odd number of shapes stays', () => {
    // A, B, and C = (0.25..0.75)² which overlaps A only → A ⊕ B ⊕ C
    const g = ok({ type: 'boolean', op: 'exclude', features: [A, B, sq(0.25, 0.25, 0.5)] })
    // A⊕B = 1.5; C lies inside A and overlaps B in (0.5..0.75)² = 0.0625:
    // inside A\B part (0.25−0.0625=0.1875) is removed, inside A∩B part (0.0625) is added back.
    expect(area(g)).toBeCloseTo(1.5 - 0.1875 + 0.0625, 9)
  })
})

describe('cut-hole', () => {
  it('a ring inside the target becomes a hole', () => {
    const g = ok({ type: 'cut-hole', target: A, ring: sqRing(0.25, 0.25, 0.5) as [number, number][] }) as Polygon
    expect(g.type).toBe('Polygon')
    expect(g.coordinates).toHaveLength(2)
    expect(area(g)).toBeCloseTo(0.75, 9)
  })

  it('a ring covering the target → EMPTY_RESULT', () => {
    const r = run({ type: 'cut-hole', target: sq(0.25, 0.25, 0.5), ring: sqRing(0, 0, 1) as [number, number][] })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('EMPTY_RESULT')
  })

  it('an unclosed ring is reported as an EXCEPTION, not thrown', () => {
    const r = run({ type: 'cut-hole', target: A, ring: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]] })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('EXCEPTION')
    expect(r.error?.message).toBeTruthy()
  })
})

describe('slice-shape', () => {
  it('a line crossing the shape splits it into two parts of (almost) the original area', () => {
    const g = ok({ type: 'slice-shape', target: A, line: [[0.5, -1], [0.5, 2]] })
    expect(g.type).toBe('MultiPolygon')
    expect(parts(g)).toHaveLength(2)
    expect(area(g)).toBeCloseTo(1, 6) // the 1 cm sliver is ~1e-7 deg wide
    const [p1, p2] = parts(g).map((p) => polyArea(p))
    expect(p1).toBeCloseTo(0.5, 6)
    expect(p2).toBeCloseTo(0.5, 6)
  })

  it('a line that misses the shape leaves it whole', () => {
    const g = ok({ type: 'slice-shape', target: A, line: [[3, -1], [3, 2]] })
    expect(g.type).toBe('Polygon')
    expect(area(g)).toBeCloseTo(1, 9)
  })

  it('a zig-zag line through the shape yields three pieces', () => {
    const g = ok({ type: 'slice-shape', target: A, line: [[0.3, -1], [0.3, 0.5], [0.7, 0.5], [0.7, 2]] })
    // the S-shaped cut separates A into a left/bottom region and a right/top region
    expect(parts(g)).toHaveLength(2)
    expect(area(g)).toBeCloseTo(1, 6)
  })
})

describe('buffer preview', () => {
  it('a 100 m point buffer is a circle of area ≈ π·100² m²', () => {
    const g = ok({ type: 'buffer', geometry: { type: 'Point', coordinates: [0, 0] }, distance: 100 })
    expect(g.type).toBe('Polygon')
    const m2 = area(g) * 111_319.49 ** 2 // degrees² → m² at the equator
    expect(m2 / (Math.PI * 100 * 100)).toBeGreaterThan(0.98)
    expect(m2 / (Math.PI * 100 * 100)).toBeLessThan(1.01)
    expectValidPolygonal(g)
  })

  it('a positive buffer grows a polygon, a negative one shrinks it', () => {
    const square = { type: 'Polygon' as const, coordinates: [sqRing(0, 0, 0.01)] }
    const grown = ok({ type: 'buffer', geometry: square, distance: 50 })
    const shrunk = ok({ type: 'buffer', geometry: square, distance: -50 })
    expect(area(grown)).toBeGreaterThan(area(square))
    expect(area(shrunk)).toBeLessThan(area(square))
    // shrinking a ~1113 m square by 50 m on each side
    const side = Math.sqrt(area(shrunk)) * 111_319.49
    expect(side).toBeCloseTo(1113.2 - 100, -1)
  })

  it('a line buffer is a polygon around the line', () => {
    const g = ok({ type: 'buffer', geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] }, distance: 10 })
    expect(g.type).toBe('Polygon')
    const m2 = area(g) * 111_319.49 ** 2
    expect(m2).toBeGreaterThan(1113 * 20) // rectangle part alone
    expect(m2).toBeLessThan((1113.2 * 20 + Math.PI * 100) * 1.01) // + two 10 m half-caps
  })

  it('a negative buffer that consumes the polygon → EMPTY_RESULT', () => {
    const r = run({ type: 'buffer', geometry: { type: 'Polygon', coordinates: [sqRing(0, 0, 0.001)] }, distance: -500 })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('EMPTY_RESULT')
  })
})

describe('simplify preview', () => {
  const dense = { type: 'Polygon' as const, coordinates: [circleRing(1000)] }

  it('tolerance 0 returns the geometry unchanged', () => {
    const g = ok({ type: 'simplify', geometry: dense, tolerance: 0 })
    expect(g).toEqual(dense)
  })

  it('reduces vertices monotonically with tolerance and keeps a valid closed ring', () => {
    let prev = Infinity
    for (const tolerance of [1e-6, 1e-5, 1e-4, 1e-3]) {
      const input = structuredClone(dense) // the worker simplifies in place (mutate: true)
      const g = ok({ type: 'simplify', geometry: input, tolerance })
      expectValidPolygonal(g)
      const n = vertexCount(g)
      expect(n).toBeLessThanOrEqual(prev)
      prev = n
      expect(area(g) / area(dense)).toBeGreaterThan(0.85)
    }
    expect(prev).toBeLessThan(50)
  })

  it('simplifies a LineString too', () => {
    const coords: Position[] = Array.from({ length: 500 }, (_, i) => [i * 1e-5, Math.sin(i / 50) * 1e-4])
    const g = ok({ type: 'simplify', geometry: { type: 'LineString', coordinates: coords }, tolerance: 1e-5 })
    expect(g.type).toBe('LineString')
    const out = (g as { coordinates: Position[] }).coordinates
    expect(out.length).toBeLessThan(coords.length)
    expect(out[0]).toEqual(coords[0])
    expect(out[out.length - 1]).toEqual(coords[coords.length - 1])
  })
})

describe('smooth preview', () => {
  const square = { type: 'Polygon' as const, coordinates: [sqRing(0, 0, 1)] }

  it('one Chaikin iteration doubles the vertices and cuts the corners', () => {
    const g = ok({ type: 'smooth', geometry: square, iterations: 1 })
    expectValidPolygonal(g)
    expect(vertexCount(g)).toBe(9) // 4 corners → 8 points + closing
    expect(area(g)).toBeCloseTo(1 - 4 * (0.25 * 0.25) / 2, 9)
  })

  it('more iterations → more vertices, area converges and stays inside the original', () => {
    let prevN = 0, prevA = Infinity
    for (const iterations of [1, 2, 3, 4]) {
      const g = ok({ type: 'smooth', geometry: square, iterations })
      const n = vertexCount(g), a = area(g)
      expect(n).toBeGreaterThan(prevN)
      expect(a).toBeLessThan(prevA)
      expect(a).toBeGreaterThan(0.6)
      for (const [x, y] of parts(g)[0][0]) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1)
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1)
      }
      prevN = n; prevA = a
    }
  })

  it('keeps holes and smooths each part of a MultiPolygon', () => {
    const mp = { type: 'MultiPolygon' as const, coordinates: [[sqRing(0, 0, 1), sqRing(0.4, 0.4, 0.2).reverse()], [sqRing(3, 3, 1)]] }
    const g = ok({ type: 'smooth', geometry: mp, iterations: 2 })
    expect(g.type).toBe('MultiPolygon')
    expect(parts(g)).toHaveLength(2)
    expect(parts(g)[0]).toHaveLength(2)
    expectValidPolygonal(g)
  })
})

describe('protocol', () => {
  it('unknown op → UNKNOWN_OP', () => {
    const r = run({ type: 'rotate', geometry: { type: 'Point', coordinates: [0, 0] } })
    expect(r).toEqual({ id: r.id, ok: false, error: { type: 'error', message: 'Unknown geometry operation', code: 'UNKNOWN_OP' } })
  })

  it('malformed input → EXCEPTION reply instead of a crashed worker', () => {
    const r = run({ type: 'boolean', op: 'union', features: [{ type: 'Feature', properties: {}, geometry: null } as unknown as PolyFeature, A] })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('EXCEPTION')
    // and the worker keeps serving requests afterwards
    expect(area(ok({ type: 'boolean', op: 'intersect', features: [A, B] }))).toBeCloseTo(0.25, 9)
  })

  it('a 10k-vertex union finishes (no pathological slowdown)', () => {
    const big = (cx: number): PolyFeature => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(5_000, 0.01, cx, 0)] } })
    const t = performance.now()
    const g = ok({ type: 'boolean', op: 'union', features: [big(0), big(0.01)] })
    expect(performance.now() - t).toBeLessThan(8000) // generous: machines under parallel load take ~1 s
    expect(g.type).toBe('Polygon')
    expectValidPolygonal(g)
  })
})
