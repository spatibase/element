/**
 * Drawn-shape tags (`_drawType`, a route's `properties._waypoints`) after geometry edits, and
 * altitude through point edits:
 * - clearing `_drawType` (freeGeometry / vertexEditPatch) drops `_waypoints` in the same update;
 * - a point edit frees a circle, rectangle or route (vertexEditPatch), one undo restores the tag;
 * - simplify / smooth / buffer of a route leave a plain line or polygon (no route metadata);
 * - a topology neighbour that follows a shared point stops being a circle / rectangle / route
 *   and keeps its altitude;
 * - a point inserted between two 3D points gets their mean altitude.
 */
import { describe, it, expect } from 'vitest'
import { createDataStore, freeGeometry, vertexEditNotice, vertexEditPatch } from '../src/store/dataStore'
import { createUIStore } from '../src/store/uiStore'
import { commitTopoMove, commitTopoInsert, transformUpdates } from '../src/utils/topology'
import { insertedPosition } from '../src/utils/positions'
import type { GeoJSONFeature } from '../src/types/geojson'

const line: GeoJSONFeature['geometry'] = { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] }
const route: GeoJSONFeature = {
  type: 'Feature', id: 'r', _drawType: 'route', geometry: line,
  properties: { name: 'Walk', _waypoints: [[0, 0], [2, 0]] },
}
const square = (id: string, x0: number, z = false): GeoJSONFeature => {
  const c = (x: number, y: number, k: number) => (z ? [x, y, 10 * k] : [x, y]) as [number, number]
  return {
    type: 'Feature', id, properties: {},
    geometry: { type: 'Polygon', coordinates: [[c(x0, 0, 1), c(x0 + 1, 0, 2), c(x0 + 1, 1, 3), c(x0, 1, 4), c(x0, 0, 1)]] },
  }
}

function seeded(features: GeoJSONFeature[]) {
  const ds = createDataStore()
  ds.getState().importGeoJSON({ type: 'FeatureCollection', features }, 'replace', { undoable: false })
  return ds
}

describe('route metadata goes with _drawType', () => {
  it('updateFeature with freeGeometry drops _drawType and _waypoints, keeps other properties', () => {
    const ds = seeded([route])
    ds.getState().updateFeature('r', freeGeometry(line))
    const f = ds.getState().features[0]
    expect('_drawType' in f).toBe(false)
    expect(f.properties).toEqual({ name: 'Walk' })
  })

  it('a geometry-only patch keeps the route', () => {
    const ds = seeded([route])
    ds.getState().updateFeature('r', { geometry: line })
    const f = ds.getState().features[0]
    expect(f._drawType).toBe('route')
    expect(f.properties._waypoints).toEqual([[0, 0], [2, 0]])
  })

  it('a feature added with `...freeGeometry(g)` (slice parts, boolean results) carries no _waypoints', () => {
    const ds = seeded([])
    ds.getState().addFeature({ ...route, id: 'copy', ...freeGeometry(line) })
    const f = ds.getState().features[0]
    expect('_drawType' in f).toBe(false)
    expect(f.properties).toEqual({ name: 'Walk' })
  })

  it.each(['simplify-shape', 'smooth-shape'] as const)('%s of a route leaves a plain line', (mode) => {
    const ds = seeded([route])
    ds.setState({ selectedIds: ['r'] })
    const ui = createUIStore(ds)
    ui.setState({ editingMode: mode, geometryPreview: { type: 'LineString', coordinates: [[0, 0], [2, 0]] } })
    ui.getState().commitGeometryProcess()
    const f = ds.getState().features[0]
    expect(f._drawType).toBeUndefined()
    expect(f.properties._waypoints).toBeUndefined()
    expect(f.properties.name).toBe('Walk')
    ds.getState().undo()
    expect(ds.getState().features[0].properties._waypoints).toEqual([[0, 0], [2, 0]])
  })

  it('buffer (in place and as a new feature) drops route metadata', () => {
    const poly: GeoJSONFeature['geometry'] = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 0]]] }
    for (const createNew of [false, true]) {
      const ds = seeded([route])
      ds.setState({ selectedIds: ['r'] })
      const ui = createUIStore(ds)
      ui.setState({ editingMode: 'buffer-shape', geometryPreview: poly, bufferCreateNew: createNew })
      ui.getState().commitBufferProcess()
      const buffered = ds.getState().features.find((f) => f.geometry.type === 'Polygon')!
      expect(buffered._drawType).toBeUndefined()
      expect(buffered.properties._waypoints).toBeUndefined()
      // "Create new" leaves the source route as it was.
      if (createNew) expect(ds.getState().features.find((f) => f.id === 'r')!.properties._waypoints).toBeDefined()
    }
  })
})

describe('vertexEditPatch', () => {
  it('frees circles, rectangles and routes; untagged features just get the geometry', () => {
    expect(vertexEditPatch({ _drawType: 'circle' }, line)).toEqual({ geometry: line, _drawType: undefined })
    expect(vertexEditPatch({ _drawType: 'route' }, line)).toEqual({ geometry: line, _drawType: undefined })
    expect(vertexEditPatch({ _drawType: 'rectangle' }, line)).toEqual({ geometry: line, _drawType: undefined })
    expect(vertexEditPatch({}, line)).toEqual({ geometry: line })
  })

  it('a rectangle point edit in the store drops the tag; one undo brings it back', () => {
    const rect = { ...square('r', 0), _drawType: 'rectangle' as const }
    const ds = seeded([rect])
    const moved = { type: 'Polygon' as const, coordinates: [[[0, 0], [1.3, 0], [1, 1], [0, 1], [0, 0]]] as [number, number][][] }
    ds.getState().takeSnapshot()
    ds.getState().updateFeature('r', vertexEditPatch(rect, moved))
    expect('_drawType' in ds.getState().features[0]).toBe(false)
    ds.getState().undo()
    expect(ds.getState().features[0]._drawType).toBe('rectangle')
    expect(ds.getState().features[0].geometry).toEqual(rect.geometry)
  })
})

describe('vertexEditNotice', () => {
  it('names what a point edit will do to each drawn shape, nothing for plain features', () => {
    expect(vertexEditNotice({ _drawType: 'circle' })).toBe('Editing points will turn this circle into a plain shape.')
    expect(vertexEditNotice({ _drawType: 'rectangle' })).toBe('Editing points will turn this rectangle into a plain shape.')
    expect(vertexEditNotice({ _drawType: 'route' })).toBe('Editing points will turn this route into a plain line.')
    expect(vertexEditNotice({})).toBeNull()
    expect(vertexEditNotice(undefined)).toBeNull()
  })
})

describe('topology neighbours', () => {
  it('a circle neighbour that follows a shared point stops being a circle; a plain one gets geometry only', () => {
    const a = square('a', 0)
    const circle = { ...square('b', 1), _drawType: 'circle' as const }
    const plain = square('c', 1)
    expect(commitTopoMove([a, circle], 'a', [1, 0], [1.2, 0])[0].patch).toEqual(expect.objectContaining({ _drawType: undefined }))
    expect('_drawType' in commitTopoMove([a, plain], 'a', [1, 0], [1.2, 0])[0].patch).toBe(false)
    expect(commitTopoInsert([a, circle], 'a', [1, 0], [1, 1], [1, 0.5])[0].patch).toEqual(expect.objectContaining({ _drawType: undefined }))
  })

  it('a transformed rectangle keeps its tag; a rectangle neighbour that followed loses it', () => {
    const a = { ...square('a', 0), _drawType: 'rectangle' as const }
    const b = { ...square('b', 1), _drawType: 'rectangle' as const }
    const moved = { type: 'Polygon' as const, coordinates: [[[0, 0], [1.1, 0], [1.1, 1], [0, 1], [0, 0]]] as [number, number][][] }
    const out = transformUpdates([a, b], [{ id: 'a', geometry: moved }], true)
    expect('_drawType' in out.find((u) => u.id === 'a')!.patch).toBe(false)
    expect(out.find((u) => u.id === 'b')!.patch).toEqual(expect.objectContaining({ _drawType: undefined }))
  })

  it('a neighbour point that follows keeps its altitude', () => {
    const a = square('a', 0, true)
    const b = square('b', 1, true) // shares (1,0) at index 0 (z 10) and (1,1) at index 3 (z 40)
    const [u] = commitTopoMove([a, b], 'a', [1, 0], [1.2, 0])
    const ring = (u.patch.geometry.coordinates as number[][][])[0]
    expect(ring[0]).toEqual([1.2, 0, 10])
    expect(ring.every((c) => c.length === 3)).toBe(true)
  })
})

describe('insertedPosition', () => {
  it('averages the extra members of two 3D ends, else returns xy', () => {
    expect(insertedPosition([0, 0, 10], [2, 0, 30], [1, 0])).toEqual([1, 0, 20])
    expect(insertedPosition([0, 0], [2, 0, 30], [1, 0])).toEqual([1, 0])
    expect(insertedPosition(undefined, [2, 0, 30], [1, 0])).toEqual([1, 0])
  })
})
