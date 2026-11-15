/** transformUpdates: one batch for a transform commit, with topology neighbours following every shared vertex. */
import { describe, it, expect } from 'vitest'
import { transformUpdates } from '../../../../core/src/utils/topology'
import type { GeoJSONFeature } from '../../../../core/src/types/geojson'

const poly = (id: string, ring: [number, number][]) =>
  ({ type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }) as unknown as GeoJSONFeature

describe('transformUpdates', () => {
  // A and B share the edge (1,0)-(1,1).
  const a = poly('a', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
  const b = poly('b', [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]])
  const moved = { type: 'Polygon', coordinates: [[[0.5, 0], [1.5, 0], [1.5, 1], [0.5, 1], [0.5, 0]]] } as GeoJSONFeature['geometry']

  it('without topo: only the transformed features', () => {
    expect(transformUpdates([a, b], [{ id: 'a', geometry: moved }], false)).toEqual([{ id: 'a', patch: { geometry: moved } }])
  })

  it('with topo: the neighbour follows BOTH shared vertices (not just the last one)', () => {
    const ups = transformUpdates([a, b], [{ id: 'a', geometry: moved }], true)
    expect(ups.map((u) => u.id)).toEqual(['a', 'b'])
    expect((ups[1].patch.geometry as { coordinates: number[][][] }).coordinates[0])
      .toEqual([[1.5, 0], [2, 0], [2, 1], [1.5, 1], [1.5, 0]])
  })
})
