import { describe, it, expect } from 'vitest'
import { canProcessShape, countShapeVertices, isLineGeometryType } from '../../../../core/src/utils/shapeProcessing'
import { smoothLine } from '../../../../ui/src/utils/lineSmooth'

describe('canProcessShape', () => {
  it('accepts polygons and lines only', () => {
    for (const t of ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']) expect(canProcessShape(t)).toBe(true)
    for (const t of ['Point', 'MultiPoint', 'GeometryCollection', null, undefined]) expect(canProcessShape(t)).toBe(false)
  })

  it('isLineGeometryType', () => {
    expect(isLineGeometryType('LineString')).toBe(true)
    expect(isLineGeometryType('MultiLineString')).toBe(true)
    expect(isLineGeometryType('Polygon')).toBe(false)
  })
})

describe('countShapeVertices', () => {
  it('counts every line point and ring points without the closing one', () => {
    expect(countShapeVertices({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] })).toBe(3)
    expect(countShapeVertices({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3], [4, 4]]] })).toBe(5)
    expect(countShapeVertices({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe(3)
    expect(countShapeVertices({ type: 'Point', coordinates: [0, 0] })).toBe(0)
  })
})

describe('smoothLine', () => {
  const line = [[0, 0], [10, 10], [20, 0]]

  it('keeps the endpoints and stays open', () => {
    const out = smoothLine(line, 3)
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([20, 0])
    expect(out[0]).not.toEqual(out[out.length - 1])
  })

  it('cuts corners: each pass doubles the point count', () => {
    const one = smoothLine(line, 1)
    expect(one).toEqual([[0, 0], [2.5, 2.5], [7.5, 7.5], [12.5, 7.5], [17.5, 2.5], [20, 0]])
    expect(smoothLine(line, 2)).toHaveLength(12)
    // The sharp apex is gone.
    expect(one.some(([x, y]) => x === 10 && y === 10)).toBe(false)
  })

  it('leaves a two-point line alone and does not mutate the input', () => {
    expect(smoothLine([[0, 0], [1, 1]], 5)).toEqual([[0, 0], [1, 1]])
    smoothLine(line, 2)
    expect(line).toEqual([[0, 0], [10, 10], [20, 0]])
  })

  it('interpolates a third (z) coordinate when every point has one', () => {
    expect(smoothLine([[0, 0, 0], [4, 4, 8], [8, 0, 0]], 1)[1]).toEqual([1, 1, 2])
  })
})
