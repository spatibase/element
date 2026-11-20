import type { GeoJSONFeature } from '../types/geojson'
import { storedBBox } from './geojson'

/**
 * Opt-in clean-up applied to every committed feature (the `coordinates` prop).
 * Both parts are off unless set; with neither set nothing runs.
 */
export interface CoordinateOptions {
  /**
   * Shift each feature as a whole by a multiple of 360 degrees so the centre of its longitude
   * range lands in [-180, 180]. Vertices stay continuous, so a shape crossing the antimeridian
   * keeps its outline (one side may then lie beyond +-180). Latitudes beyond +-90 are clamped.
   */
  wrap?: boolean
  /** Round x and y to this many decimals (integer 0 to 15). Altitude and other extra members stay untouched. */
  precision?: number
}

type Geom = GeoJSONFeature['geometry']
type Pos = number[]

/** True when `o` asks for at least one clean-up. */
export function hasCoordinateOptions(o: CoordinateOptions | undefined): o is CoordinateOptions {
  return !!o && (o.wrap === true || validPrecision(o.precision) !== undefined)
}

function validPrecision(p: number | undefined): number | undefined {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 15 ? p : undefined
}

/** Longitude range of every position in `g` (GeometryCollection members included). */
function lngRange(g: Geom, acc: [number, number]): void {
  if (g.type === 'GeometryCollection') {
    for (const m of g.geometries) lngRange(m as Geom, acc)
    return
  }
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      const x = c[0]
      if (Number.isFinite(x)) { if (x < acc[0]) acc[0] = x; if (x > acc[1]) acc[1] = x }
      return
    }
    for (const i of c) walk(i)
  }
  walk('coordinates' in g ? g.coordinates : undefined)
}

/** Multiple-of-360 shift that brings the centre of [min, max] into [-180, 180] (0 when it already is). */
function wrapShift(min: number, max: number): number {
  const c = (min + max) / 2
  if (c > 180) return -360 * Math.ceil((c - 180) / 360)
  if (c < -180) return 360 * Math.ceil((-180 - c) / 360)
  return 0
}

const same = (a: Pos, b: Pos) => a[0] === b[0] && a[1] === b[1]

/** Drops consecutive duplicate positions (xy), keeping the closing point; returns `pts` when that would leave too few. */
function dedupe(pts: Pos[], min: number): Pos[] {
  if (pts.length <= min) return pts
  const out: Pos[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) if (!same(pts[i], out[out.length - 1])) out.push(pts[i])
  const last = pts[pts.length - 1]
  if (out.length > 1 && same(last, out[out.length - 1])) out.pop()
  out.push(last)
  return out.length >= min && out.length < pts.length ? out : pts
}

interface Ctx { shift: number; factor: number; changed: boolean }

function mapPoint(p: Pos, c: Ctx): Pos {
  let x = p[0], y = p[1]
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return p
  x += c.shift
  if (y > 90) y = 90
  else if (y < -90) y = -90
  if (c.factor) { x = Math.round(x * c.factor) / c.factor; y = Math.round(y * c.factor) / c.factor }
  if (x === p[0] && y === p[1]) return p
  c.changed = true
  // extra members (altitude, ...) ride along untouched
  return p.length > 2 ? [x, y, ...p.slice(2)] : [x, y]
}

function mapGeom(g: Geom, c: Ctx): Geom {
  if (g.type === 'GeometryCollection') {
    return { ...g, geometries: g.geometries.map((m) => mapGeom(m as Geom, c)) } as Geom
  }
  const pt = (p: Pos) => mapPoint(p, c)
  const line = (l: Pos[], min: number) => {
    const m = l.map(pt)
    if (!c.factor) return m
    const d = dedupe(m, min)
    if (d !== m) c.changed = true
    return d
  }
  const co = (g as { coordinates: unknown }).coordinates as never
  let coordinates: unknown
  switch (g.type) {
    case 'Point': coordinates = pt(co); break
    case 'MultiPoint': coordinates = (co as Pos[]).map(pt); break
    case 'LineString': coordinates = line(co, 2); break
    case 'MultiLineString': coordinates = (co as Pos[][]).map((l) => line(l, 2)); break
    case 'Polygon': coordinates = (co as Pos[][]).map((r) => line(r, 4)); break
    case 'MultiPolygon': coordinates = (co as Pos[][][]).map((p) => p.map((r) => line(r, 4))); break
    default: return g
  }
  return { ...g, coordinates } as Geom
}

/**
 * `f` with the clean-up applied, or `f` itself when nothing changes (idempotent). Cost is
 * O(vertices of this feature). `bbox` is recomputed when the geometry changed.
 */
export function normaliseFeature(f: GeoJSONFeature, o: CoordinateOptions): GeoJSONFeature {
  const g = f.geometry
  if (!g) return f
  let shift = 0
  if (o.wrap) {
    const r: [number, number] = [Infinity, -Infinity]
    lngRange(g, r)
    if (r[0] <= r[1]) shift = wrapShift(r[0], r[1])
  }
  const precision = validPrecision(o.precision)
  const ctx: Ctx = { shift, factor: precision === undefined ? 0 : 10 ** precision, changed: false }
  const next = mapGeom(g, ctx)
  if (!ctx.changed) return f
  const out: GeoJSONFeature = { ...f, geometry: next }
  const bbox = storedBBox(next)
  if (bbox) out.bbox = bbox
  return out
}

/** Features already known clean for a given options object. */
const cleanFor = new WeakMap<CoordinateOptions, WeakSet<object>>()

/**
 * Applies the clean-up to `features`, skipping objects it produced or already checked. Returns the
 * same array when nothing changed, otherwise a new array that shares every untouched feature.
 */
export function normaliseFeatures(features: GeoJSONFeature[], o: CoordinateOptions): GeoJSONFeature[] {
  let clean = cleanFor.get(o)
  if (!clean) cleanFor.set(o, (clean = new WeakSet()))
  let out: GeoJSONFeature[] | null = null
  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    if (clean.has(f)) continue
    const n = normaliseFeature(f, o)
    clean.add(n)
    if (n !== f) {
      out ??= features.slice()
      out[i] = n
    }
  }
  return out ?? features
}
