import { describe, it, expect } from 'vitest'
import { area } from '@turf/area'
import {
  isMultiGeometry,
  getPartCount,
  getPartGeometry,
  setPartGeometry,
  getPartBBox,
  getPartLabel,
  getBaseGeometryCategory,
  mergeGeometries,
  canVertexEdit,
  getRefLat,
  offsetSimpleGeometry,
  offsetGeometry,
} from '../src/utils/multiGeometry'
import { project, applyVisualTransform, translateGeometryVisually } from '../src/mercator'
import { translateGeometrySpatially } from '../src/utils/spatial'
import { mapPositions } from '../src/utils/positions'
import type { GeoJSONFeature, Geometry, SimpleGeometry } from '../src/types/geojson'

const sq = (x: number, y: number, s: number): [number, number][][] =>
  [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]
const feat = (id: string, geometry: Geometry): GeoJSONFeature => ({ type: 'Feature', id, geometry, properties: {} })

const point: Geometry = { type: 'Point', coordinates: [1, 2] }
const line: Geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
const poly: Geometry = { type: 'Polygon', coordinates: sq(0, 0, 1) }
const mpt: Geometry = { type: 'MultiPoint', coordinates: [[0, 0], [1, 1], [2, 2]] }
const mline: Geometry = { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 6]]] }
const mpoly: Geometry = { type: 'MultiPolygon', coordinates: [sq(0, 0, 1), sq(10, 10, 2)] }
const gc: Geometry = { type: 'GeometryCollection', geometries: [point as SimpleGeometry, line as SimpleGeometry, mpoly as SimpleGeometry] }

describe('part access', () => {
  it('isMultiGeometry / getPartCount', () => {
    expect([point, line, poly].map(isMultiGeometry)).toEqual([false, false, false])
    expect([mpt, mline, mpoly, gc].map(isMultiGeometry)).toEqual([true, true, true, true])
    expect([point, line, poly, mpt, mline, mpoly, gc].map(getPartCount)).toEqual([1, 1, 1, 3, 2, 2, 3])
  })

  it('getPartGeometry returns the matching simple geometry', () => {
    expect(getPartGeometry(mpt, 1)).toEqual({ type: 'Point', coordinates: [1, 1] })
    expect(getPartGeometry(mline, 1)).toEqual({ type: 'LineString', coordinates: [[5, 5], [6, 6]] })
    expect(getPartGeometry(mpoly, 1)).toEqual({ type: 'Polygon', coordinates: sq(10, 10, 2) })
    expect(getPartGeometry(gc, 2)).toBe((gc as { geometries: SimpleGeometry[] }).geometries[2])
    expect(getPartGeometry(poly, 0)).toBe(poly)
  })

  it('setPartGeometry replaces one part immutably', () => {
    const next = setPartGeometry(mpoly, 0, { type: 'Polygon', coordinates: sq(-3, -3, 1) })
    expect(next).toEqual({ type: 'MultiPolygon', coordinates: [sq(-3, -3, 1), sq(10, 10, 2)] })
    expect((mpoly as { coordinates: unknown[] }).coordinates[0]).toEqual(sq(0, 0, 1)) // input untouched
    expect(setPartGeometry(mpt, 2, { type: 'Point', coordinates: [9, 9] })).toEqual({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1], [9, 9]] })
    expect(setPartGeometry(mline, 0, { type: 'LineString', coordinates: [[7, 7], [8, 8]] })).toEqual({ type: 'MultiLineString', coordinates: [[[7, 7], [8, 8]], [[5, 5], [6, 6]]] })
    const gcNext = setPartGeometry(gc, 0, { type: 'Point', coordinates: [4, 4] })
    expect(gcNext.type).toBe('GeometryCollection')
    expect((gcNext as { geometries: SimpleGeometry[] }).geometries[0]).toEqual({ type: 'Point', coordinates: [4, 4] })
    expect((gc as { geometries: SimpleGeometry[] }).geometries[0]).toBe(point)
  })

  it('get → set round trip is the identity for every part', () => {
    for (const g of [mpt, mline, mpoly, gc]) {
      for (let i = 0; i < getPartCount(g); i++) {
        expect(setPartGeometry(g, i, getPartGeometry(g, i))).toEqual(g)
      }
    }
  })

  it('getPartBBox / getPartLabel', () => {
    expect(getPartBBox(mpoly, 1)).toEqual([10, 10, 12, 12])
    expect(getPartBBox(gc, 1)).toEqual([0, 0, 1, 1])
    expect(getPartLabel(mpt, 0)).toBe('Point 1')
    expect(getPartLabel(mline, 1)).toBe('Line 2')
    expect(getPartLabel(mpoly, 1)).toBe('Polygon 2')
    expect([0, 1, 2].map((i) => getPartLabel(gc, i))).toEqual(['Point 1', 'Line 2', 'MultiPolygon 3'])
    expect(getPartLabel(poly, 0)).toBe('Part 1')
  })
})

describe('mergeGeometries', () => {
  it('throws on zero features', () => {
    expect(() => mergeGeometries([])).toThrow()
  })

  it('points + multipoints → one MultiPoint with every position', () => {
    const g = mergeGeometries([feat('a', point), feat('b', mpt)])
    expect(g).toEqual({ type: 'MultiPoint', coordinates: [[1, 2], [0, 0], [1, 1], [2, 2]] })
  })

  it('lines → MultiLineString keeps every line', () => {
    const g = mergeGeometries([feat('a', line), feat('b', mline)])
    expect(g.type).toBe('MultiLineString')
    expect(getPartCount(g)).toBe(3)
  })

  it('polygons + multipolygons → MultiPolygon whose area is the sum of the parts', () => {
    const a = feat('a', poly), b = feat('b', mpoly)
    const g = mergeGeometries([a, b])
    expect(g.type).toBe('MultiPolygon')
    expect(getPartCount(g)).toBe(3)
    expect(area(g as never)).toBeCloseTo(area(poly as never) + area(mpoly as never), 3)
  })

  it('mixed types → GeometryCollection, flattening nested collections', () => {
    const g = mergeGeometries([feat('a', point), feat('b', poly), feat('c', gc)])
    expect(g.type).toBe('GeometryCollection')
    const parts = (g as { geometries: SimpleGeometry[] }).geometries
    expect(parts.map((p) => p.type)).toEqual(['Point', 'Polygon', 'Point', 'LineString', 'MultiPolygon'])
  })

  it('a lone GeometryCollection merges into a GeometryCollection', () => {
    expect(mergeGeometries([feat('a', gc)])).toEqual(gc)
  })
})

describe('classification helpers', () => {
  it('getBaseGeometryCategory', () => {
    expect([point, mpt, line, mline, poly, mpoly, gc].map(getBaseGeometryCategory)).toEqual(['point', 'point', 'line', 'line', 'polygon', 'polygon', 'mixed'])
  })

  it('canVertexEdit: simple lines/polygons always; multi only with a part; points never', () => {
    expect(canVertexEdit(line, null)).toBe(true)
    expect(canVertexEdit(poly, null)).toBe(true)
    expect(canVertexEdit(point, 0)).toBe(false)
    expect(canVertexEdit(mpt, 0)).toBe(false)
    for (const g of [mline, mpoly, gc]) {
      expect(canVertexEdit(g, null)).toBe(false)
      expect(canVertexEdit(g, 0)).toBe(true)
    }
  })

  it('getRefLat reads the first coordinate of any geometry; 0 for empty', () => {
    expect(getRefLat(point)).toBe(2)
    expect(getRefLat({ type: 'MultiPolygon', coordinates: [sq(3, 47, 1)] })).toBe(47)
    expect(getRefLat({ type: 'MultiLineString', coordinates: [[[0, -33], [1, 1]]] })).toBe(-33)
    expect(getRefLat({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 61] }] })).toBe(61)
    expect(getRefLat({ type: 'LineString', coordinates: [] })).toBe(0)
    expect(getRefLat({ type: 'GeometryCollection', geometries: [] })).toBe(0)
  })
})

describe('offsetGeometry', () => {
  it('degree offset moves every vertex of every type by exactly the delta', () => {
    const d: [number, number] = [0.5, -0.25]
    for (const g of [point, line, poly, mpt, mline, mpoly]) {
      const moved = offsetGeometry(g, d, false)
      expect(moved.type).toBe(g.type)
      const before = JSON.stringify(g).match(/-?\d+(\.\d+)?/g)!.map(Number)
      const after = JSON.stringify(moved).match(/-?\d+(\.\d+)?/g)!.map(Number)
      expect(after).toHaveLength(before.length)
      after.forEach((v, i) => expect(v).toBeCloseTo(before[i] + (i % 2 === 0 ? d[0] : d[1]), 12))
    }
  })

  it('GeometryCollection offsets each member; input is not mutated', () => {
    const snapshot = JSON.stringify(gc)
    const moved = offsetGeometry(gc, [1, 1], false) as { geometries: SimpleGeometry[] }
    expect(moved.geometries[0]).toEqual({ type: 'Point', coordinates: [2, 3] })
    expect(JSON.stringify(gc)).toBe(snapshot)
  })

  it('visual offset keeps the projected (on-screen) shape: a square stays a square at 60°N', () => {
    const square: SimpleGeometry = { type: 'Polygon', coordinates: sq(10, 60, 0.1) }
    const moved = offsetSimpleGeometry(square, [3, -7], true) as { coordinates: [number, number][][] }
    const pBefore = (square.coordinates as [number, number][][])[0].map(project)
    const pAfter = moved.coordinates[0].map(project)
    pAfter.forEach(([x, y], i) => {
      expect(x - pBefore[i][0]).toBeCloseTo(3, 9)
      expect(y - pBefore[i][1]).toBeCloseTo(-7, 9)
    })
  })

  it('a zero visual offset is the identity (within float error)', () => {
    const moved = offsetGeometry(mpoly, [0, 0], true) as { coordinates: [number, number][][][] }
    moved.coordinates.flat(2).forEach((c, i) => {
      const orig = (mpoly as { coordinates: [number, number][][][] }).coordinates.flat(2)[i]
      expect(c[0]).toBeCloseTo(orig[0], 9)
      expect(c[1]).toBeCloseTo(orig[1], 9)
    })
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): moving a feature drops the Z (altitude) of every vertex. `offsetSimpleGeometry`
  // (multiGeometry.ts:198, `oc = ([lng, lat]) => [lng + dx, lat + dy]`) and the visual path
  // (`translateGeometryVisually` → `unproject` returns 2 numbers, mercator/index.ts:83) both
  // rebuild positions as [lng, lat]. Import keeps 3D coordinates, so a drag silently strips elevation
  // (same for `applyVisualTransform` and `translateGeometrySpatially`).
  it('keeps the third (altitude) coordinate when offsetting', () => {
    const g = { type: 'LineString', coordinates: [[0, 0, 120], [1, 1, 130]] } as unknown as SimpleGeometry
    const moved = offsetSimpleGeometry(g, [1, 1], false) as { coordinates: number[][] }
    expect(moved.coordinates.map((c) => c[2])).toEqual([120, 130])
  })

  it('every transform helper keeps altitude: visual offset, visual/spatial translate, rotate/scale, mapPositions', () => {
    const line = [[10, 45, 120], [10.01, 45.01, 130]] as unknown as [number, number][]
    const z = (cs: number[][]) => cs.map((c) => c[2])
    const g = { type: 'LineString', coordinates: line } as unknown as SimpleGeometry
    expect(z((offsetSimpleGeometry(g, [0.5, 0.5], true) as { coordinates: number[][] }).coordinates)).toEqual([120, 130])
    expect(z(translateGeometryVisually(line, 1, 1))).toEqual([120, 130])
    expect(z(translateGeometrySpatially(line, [10, 45], [11, 46]))).toEqual([120, 130])
    const rotated = applyVisualTransform({ type: 'Feature', geometry: g, properties: {} } as never, [10, 45], 2, 2, 30)
    expect(z((rotated.geometry as { coordinates: number[][] }).coordinates)).toEqual([120, 130])
    const gc = mapPositions({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2, 3] }] } as unknown as Geometry, ([x, y]) => [x + 1, y])
    expect(gc).toEqual({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [2, 2, 3] }] })
    expect(line[0]).toEqual([10, 45, 120]) // inputs untouched
  })
})
