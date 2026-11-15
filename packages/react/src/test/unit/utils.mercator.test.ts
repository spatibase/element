import { describe, expect, it } from 'vitest'
import type { Feature, Geometry } from 'geojson'
import { applyVisualTransform, getMercatorLatCorrectionRatio } from '@element-editor/core/internal'

describe('getMercatorLatCorrectionRatio', () => {
  it('returns 1 at the equator', () => {
    expect(getMercatorLatCorrectionRatio(0)).toBeCloseTo(1, 10)
  })

  it('matches cosine latitude scaling in mid-latitudes', () => {
    expect(getMercatorLatCorrectionRatio(60)).toBeCloseTo(0.5, 10)
  })

  it('clamps near poles to avoid divide-by-zero instability', () => {
    expect(getMercatorLatCorrectionRatio(90)).toBe(0.001)
    expect(getMercatorLatCorrectionRatio(-90)).toBe(0.001)
  })
})

describe('applyVisualTransform', () => {
  it('keeps center point fixed', () => {
    const feature: Feature<Geometry> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [10, 45] },
    }
    const transformed = applyVisualTransform(feature, [10, 45], 2, 3, 30)
    expect(transformed.geometry).toEqual(feature.geometry)
  })

  it('scales x-axis around center for a line', () => {
    const feature: Feature<Geometry> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[10, 45], [11, 46]] },
    }
    const transformed = applyVisualTransform(feature, [10, 45], 2, 1, 0)
    expect(transformed.geometry.type).toBe('LineString')
    if (transformed.geometry.type !== 'LineString') throw new Error('Expected LineString geometry')
    const coords = transformed.geometry.coordinates as [number, number][]
    expect(coords[1][0]).toBeCloseTo(12, 10)
    expect(coords[1][1]).toBeCloseTo(46, 10)
  })

  it('rotates geometry in visual space', () => {
    const feature: Feature<Geometry> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [1, 0] },
    }
    const transformed = applyVisualTransform(feature, [0, 0], 1, 1, 90)
    if (transformed.geometry.type !== 'Point') throw new Error('Expected Point geometry')
    const [lng, lat] = transformed.geometry.coordinates as [number, number]
    expect(lng).toBeCloseTo(0, 10)
    expect(lat).toBeCloseTo(1, 10)
  })

  it('handles multipolygon coordinates and does not mutate input', () => {
    const feature: Feature<Geometry> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        ],
      },
    }
    const original = JSON.parse(JSON.stringify(feature))
    const transformed = applyVisualTransform(feature, [0, 0], 2, 1, 0)
    expect(feature).toEqual(original)
    if (transformed.geometry.type !== 'MultiPolygon') throw new Error('Expected MultiPolygon geometry')
    const coords = transformed.geometry.coordinates[0][0] as [number, number][]
    expect(coords[1][0]).toBeCloseTo(2, 10)
  })
})
