/**
 * The opt-in `coordinates` clean-up (wrap + precision): applied on every commit path, Z kept,
 * degenerate rounding left alone, undo holds cleaned values, off by default = identical output.
 */
import { describe, it, expect } from 'vitest'
import { createDataStore } from '../src/store/dataStore'
import { normaliseFeature } from '../src/utils/normaliseCoordinates'
import type { GeoJSONFeature } from '../src/types/geojson'

type G = GeoJSONFeature['geometry']
const feat = (id: string, geometry: unknown): GeoJSONFeature => ({ type: 'Feature', id, geometry: geometry as G, properties: {} })
const pt = (id: string, c: number[]) => feat(id, { type: 'Point', coordinates: c })
const coords = (f: GeoJSONFeature) => (f.geometry as { coordinates: unknown }).coordinates

describe('wrap', () => {
  it('shifts a point by whole turns into [-180, 180]', () => {
    expect(coords(normaliseFeature(pt('a', [190, 10]), { wrap: true }))).toEqual([-170, 10])
    expect(coords(normaliseFeature(pt('a', [-540, 10]), { wrap: true }))).toEqual([-180, 10])
    expect(coords(normaliseFeature(pt('a', [725, 10]), { wrap: true }))).toEqual([5, 10])
    expect(coords(normaliseFeature(pt('a', [180, 10]), { wrap: true }))).toEqual([180, 10])
  })

  it('shifts a polygon as a whole around its bbox centre; shape stays continuous', () => {
    const ring = [[190, 0], [200, 0], [200, 10], [190, 10], [190, 0]]
    const out = normaliseFeature(feat('p', { type: 'Polygon', coordinates: [ring] }), { wrap: true })
    expect((coords(out) as number[][][])[0]).toEqual([[-170, 0], [-160, 0], [-160, 10], [-170, 10], [-170, 0]])
    expect(out.bbox).toEqual([-170, 0, -160, 10])
  })

  it('a shape crossing the antimeridian keeps its outline (one side beyond 180)', () => {
    const line = feat('l', { type: 'LineString', coordinates: [[170, 0], [190, 0]] })
    expect(normaliseFeature(line, { wrap: true })).toBe(line) // centre 180: untouched
    const far = feat('l', { type: 'LineString', coordinates: [[530, 0], [550, 0]] })
    expect(coords(normaliseFeature(far, { wrap: true }))).toEqual([[170, 0], [190, 0]])
  })

  it('MultiPolygon and GeometryCollection move as one unit', () => {
    const mp = feat('m', { type: 'MultiPolygon', coordinates: [[[[360, 0], [361, 0], [361, 1], [360, 0]]], [[[362, 0], [363, 0], [363, 1], [362, 0]]]] })
    const out = coords(normaliseFeature(mp, { wrap: true })) as number[][][][]
    expect(out[0][0][0]).toEqual([0, 0])
    expect(out[1][0][0]).toEqual([2, 0])
    const gc = feat('g', { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [370, 1] }, { type: 'Point', coordinates: [380, 2] }] })
    const g = normaliseFeature(gc, { wrap: true }).geometry as unknown as { geometries: { coordinates: number[] }[] }
    expect(g.geometries.map((m) => m.coordinates)).toEqual([[10, 1], [20, 2]])
  })

  it('clamps invalid latitude, leaves valid latitude alone', () => {
    expect(coords(normaliseFeature(pt('a', [0, 95]), { wrap: true }))).toEqual([0, 90])
    expect(coords(normaliseFeature(pt('a', [0, 89.9]), { wrap: true }))).toEqual([0, 89.9])
  })

  it('is idempotent: returns the same object when nothing changes', () => {
    const f = pt('a', [10, 10])
    expect(normaliseFeature(f, { wrap: true })).toBe(f)
  })
})

describe('precision', () => {
  it('rounds x and y, keeps Z untouched', () => {
    const f = pt('a', [1.123456789012345, 2.987654321098765, 123.456789012345])
    expect(coords(normaliseFeature(f, { precision: 6 }))).toEqual([1.123457, 2.987654, 123.456789012345])
    const line = feat('l', { type: 'LineString', coordinates: [[0.123456789, 1.5, 7.77777], [2.123456789, 1.5, 8.88888]] })
    expect(coords(normaliseFeature(line, { precision: 3 }))).toEqual([[0.123, 1.5, 7.77777], [2.123, 1.5, 8.88888]])
  })

  it('wrap + precision together keep Z', () => {
    expect(coords(normaliseFeature(pt('a', [190.123456789, 1.1111111, 5]), { wrap: true, precision: 4 }))).toEqual([-169.8765, 1.1111, 5])
  })

  it('drops consecutive duplicates created by rounding when the shape stays valid', () => {
    const line = feat('l', { type: 'LineString', coordinates: [[0, 0], [0.0000001, 0], [1, 1], [2, 2]] })
    expect(coords(normaliseFeature(line, { precision: 3 }))).toEqual([[0, 0], [1, 1], [2, 2]])
    const ring = feat('p', { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [10.0000001, 10], [0, 10], [0, 0]]] })
    expect((coords(normaliseFeature(ring, { precision: 3 })) as number[][][])[0]).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
  })

  it('keeps the closing point when the last vertex rounds onto it', () => {
    const ring = feat('p', { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0.0000001, 0], [0, 0]]] })
    const r = (coords(normaliseFeature(ring, { precision: 3 })) as number[][][])[0]
    expect(r[0]).toEqual(r[r.length - 1])
    expect(r.length).toBe(5)
  })

  it('does not collapse a tiny shape: rounding only, no vertex dropped', () => {
    const tri = [[0, 0], [0.0001, 0], [0.0001, 0.0001], [0, 0]]
    const out = normaliseFeature(feat('p', { type: 'Polygon', coordinates: [tri] }), { precision: 2 })
    expect((coords(out) as number[][][])[0]).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]])
    const line = feat('l', { type: 'LineString', coordinates: [[0, 0], [0.0001, 0]] })
    expect(coords(normaliseFeature(line, { precision: 2 }))).toEqual([[0, 0], [0, 0]])
  })

  it('ignores an invalid precision', () => {
    const f = pt('a', [1.23456789, 1])
    expect(normaliseFeature(f, { precision: -1 })).toBe(f)
    expect(normaliseFeature(f, { precision: 2.5 })).toBe(f)
  })
})

describe('store', () => {
  const raw = [190.123456789012345, 10.123456789012345]

  it('off by default: output identical to input', () => {
    const s = createDataStore()
    s.getState().addFeature(pt('a', raw))
    expect(coords(s.getState().features[0])).toEqual(raw)
  })

  it('every commit path stores clean values', () => {
    const s = createDataStore()
    s.getState().setCoordinateOptions({ wrap: true, precision: 3 })
    s.getState().addFeature(pt('a', raw))
    expect(coords(s.getState().features[0])).toEqual([-169.877, 10.123])
    s.getState().updateFeature('a', { geometry: { type: 'Point', coordinates: [-540.11111, 1.55555] } })
    expect(coords(s.getState().features[0])).toEqual([179.889, 1.556])
    s.getState().updateFeatures([{ id: 'a', patch: { geometry: { type: 'Point', coordinates: [370.5556, 0] } } }])
    expect(coords(s.getState().features[0])).toEqual([10.556, 0])
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('b', [200.5, 1.23456])] }, 'merge')
    expect(coords(s.getState().features.find((f) => f.id === 'b')!)).toEqual([-159.5, 1.235])
    s.getState().importGeoJSON({ type: 'FeatureCollection', features: [pt('c', [1.00001, 89.9999])] }, 'replace')
    expect(coords(s.getState().features[0])).toEqual([1, 90])
  })

  it('paste is cleaned too', () => {
    const s = createDataStore()
    s.getState().setCoordinateOptions({ precision: 2 })
    s.setState({ clipboard: [pt('x', [1.23456, 2.34567])] })
    s.getState().pasteSelection()
    for (const n of coords(s.getState().features[0]) as number[]) expect(Math.round(n * 100) / 100).toBe(n)
  })

  it('bbox follows the cleaned geometry', () => {
    const s = createDataStore()
    s.getState().setCoordinateOptions({ wrap: true })
    s.getState().addFeature(feat('p', { type: 'Polygon', coordinates: [[[190, 0], [200, 0], [200, 10], [190, 0]]] }))
    expect(s.getState().features[0].bbox).toEqual([-170, 0, -160, 10])
  })

  it('undo and redo hold the cleaned values', () => {
    const s = createDataStore()
    s.getState().setCoordinateOptions({ wrap: true, precision: 2 })
    s.getState().addFeature(pt('a', [190.111, 1.111]))
    s.getState().takeSnapshot()
    s.getState().updateFeature('a', { geometry: { type: 'Point', coordinates: [-300.456, 2.222] } })
    expect(coords(s.getState().features[0])).toEqual([59.54, 2.22])
    s.getState().undo()
    expect(coords(s.getState().features[0])).toEqual([-169.89, 1.11])
    s.getState().redo()
    expect(coords(s.getState().features[0])).toEqual([59.54, 2.22])
  })

  it('turning it on cleans what is already stored, without an undo step', () => {
    const s = createDataStore()
    s.getState().addFeature(pt('a', raw))
    const depth = s.getState().undoStack.length
    s.getState().setCoordinateOptions({ wrap: true })
    expect((coords(s.getState().features[0]) as number[])[0]).toBeCloseTo(-169.876543210987655, 9)
    expect(s.getState().undoStack.length).toBe(depth)
    s.getState().setCoordinateOptions(undefined)
    expect(s.getState().coordinates).toBeUndefined()
  })

  it('untouched features keep their reference (O(changed))', () => {
    const s = createDataStore()
    s.getState().setCoordinateOptions({ wrap: true })
    s.getState().addFeature(pt('a', [1, 1]))
    const a = s.getState().features[0]
    s.getState().addFeature(pt('c', [300, 2]))
    expect(s.getState().features[1]).toBe(a)
  })
})
