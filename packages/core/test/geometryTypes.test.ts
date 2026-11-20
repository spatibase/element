/**
 * `geometryTypes`: the allowed geometry types are enforced in the store on every way a geometry gets
 * in. A refused operation reports `'geometry-type-not-allowed'`, writes nothing and pushes no undo entry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDataStore } from '../src/store/dataStore'
import { createUIStore } from '../src/store/uiStore'
import { setGeometryRunner } from '../src/utils/geometryRunner'
import { mergeResultType, breakResultTypes } from '../src/utils/geometryTypes'
import type { GeoJSONFeature, Geometry } from '../src/types/geojson'
import type { ElementEditorError } from '../src/utils/errors'

afterEach(() => setGeometryRunner(null))

const feat = (id: string, geometry: Geometry): GeoJSONFeature => ({ type: 'Feature', id, geometry, properties: {} })
const pt = (id: string, x = 0) => feat(id, { type: 'Point', coordinates: [x, 0] })
const line = (id: string) => feat(id, { type: 'LineString', coordinates: [[0, 0], [1, 1]] })
const poly = (id: string) => feat(id, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] })
const multiPt = (id: string) => feat(id, { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] })

/** A store holding `features` (put there directly, as if loaded before the restriction), restricted to `types`. */
function setup(features: GeoJSONFeature[], types?: Geometry['type'][]) {
  const onError = vi.fn<(e: ElementEditorError) => void>()
  const ds = createDataStore({ onError })
  ds.setState({ features })
  if (types) ds.getState().setGeometryTypes(types)
  const codes = () => onError.mock.calls.map(([e]) => e.code)
  return { ds, onError, codes, ui: createUIStore(ds, { onError }) }
}
const depth = (ds: ReturnType<typeof createDataStore>) => ds.getState().undoStack.length

describe('geometryTypes: helpers and state', () => {
  it('unset allows everything, an empty list allows nothing', () => {
    const { ds } = setup([])
    expect(ds.getState().isGeometryTypeAllowed('Polygon')).toBe(true)
    ds.getState().setGeometryTypes(['Point'])
    expect(ds.getState().isGeometryTypeAllowed('Point')).toBe(true)
    expect(ds.getState().isGeometryTypeAllowed('Polygon')).toBe(false)
    ds.getState().setGeometryTypes([])
    expect(ds.getState().isGeometryTypeAllowed('Point')).toBe(false)
    ds.getState().setGeometryTypes(undefined)
    expect(ds.getState().isGeometryTypeAllowed('Point')).toBe(true)
  })

  it('mergeResultType / breakResultTypes mirror what the operations produce', () => {
    expect(mergeResultType(['Point', 'Point'])).toBe('MultiPoint')
    expect(mergeResultType(['Point', 'MultiPoint'])).toBe('MultiPoint')
    expect(mergeResultType(['Polygon', 'MultiPolygon'])).toBe('MultiPolygon')
    expect(mergeResultType(['LineString', 'LineString'])).toBe('MultiLineString')
    expect(mergeResultType(['Point', 'Polygon'])).toBe('GeometryCollection')
    expect(mergeResultType(['GeometryCollection', 'GeometryCollection'])).toBe('GeometryCollection')
    expect(breakResultTypes(multiPt('m').geometry)).toEqual(['Point'])
    expect(breakResultTypes(pt('p').geometry)).toEqual([])
    expect(breakResultTypes({ type: 'GeometryCollection', geometries: [pt('a').geometry as never, line('b').geometry as never] }))
      .toEqual(['Point', 'LineString'])
  })
})

describe('geometryTypes: addFeature / updateFeature(s)', () => {
  it('addFeature refuses a forbidden type: null, nothing written, no undo entry, one error', () => {
    const { ds, codes } = setup([pt('a')], ['Point'])
    expect(ds.getState().addFeature(poly('p'))).toBeNull()
    expect(ds.getState().features.map((f) => f.id)).toEqual(['a'])
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    expect(ds.getState().addFeature(pt('b'))).not.toBeNull()
    expect(codes()).toHaveLength(1)
  })

  it('the error names the refused and the allowed types', () => {
    const { ds, onError } = setup([], ['Point', 'MultiPoint'])
    ds.getState().addFeature(poly('p'))
    const e = onError.mock.calls[0][0]
    expect(e.source).toBe('editor')
    expect(e.message).toBe('Polygon isn\'t allowed here: this editor accepts only Point, MultiPoint.')
  })

  it('updateFeature: a geometry of a new forbidden type is refused whole', () => {
    const { ds, codes } = setup([pt('a')], ['Point'])
    expect(ds.getState().updateFeature('a', { geometry: line('x').geometry, properties: { n: 1 } })).toBe(false)
    expect(ds.getState().features[0].geometry.type).toBe('Point')
    expect(ds.getState().features[0].properties).toEqual({})
    expect(codes()).toEqual(['geometry-type-not-allowed'])
  })

  it('updateFeature: keeping the feature\'s own type is never refused (drags and point edits of older data)', () => {
    const { ds, codes } = setup([poly('p')], ['Point'])
    const moved = { type: 'Polygon' as const, coordinates: [[[5, 5], [6, 5], [6, 6], [5, 5]]] }
    expect(ds.getState().updateFeature('p', { geometry: moved })).toBe(true)
    expect(ds.getState().features[0].geometry).toBe(moved)
    expect(codes()).toEqual([])
  })

  it('updateFeatures is atomic: one forbidden patch writes none of them', () => {
    const { ds, codes } = setup([pt('a'), pt('b')], ['Point'])
    const before = ds.getState().features
    const ok = ds.getState().updateFeatures([
      { id: 'a', patch: { geometry: { type: 'Point', coordinates: [9, 9] } } },
      { id: 'b', patch: { geometry: poly('x').geometry } },
    ], { undoable: true })
    expect(ok).toBe(false)
    expect(ds.getState().features).toBe(before)
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
  })

  it('unset geometryTypes: nothing is checked or reported', () => {
    const { ds, codes } = setup([pt('a')])
    expect(ds.getState().updateFeature('a', { geometry: poly('x').geometry })).toBe(true)
    expect(ds.getState().addFeature(line('l'))).not.toBeNull()
    expect(codes()).toEqual([])
  })
})

describe('geometryTypes: import', () => {
  const fc = (features: GeoJSONFeature[]) => ({ type: 'FeatureCollection', features })

  it('replace: forbidden features are skipped and counted, the rest loads, one error', () => {
    const { ds, onError } = setup([], ['Point'])
    const r = ds.getState().importGeoJSON(fc([pt('a'), poly('p'), line('l'), pt('b')]), 'replace')
    expect(ds.getState().features.map((f) => f.id)).toEqual(['a', 'b'])
    expect(r).toEqual({ skipped: 0, duplicates: 0, truncated: false, refused: 2 })
    expect(onError).toHaveBeenCalledTimes(1)
    const e = onError.mock.calls[0][0]
    expect(e.code).toBe('geometry-type-not-allowed')
    expect(e.source).toBe('import')
    expect(e.message).toContain('Skipped 2 features')
    expect(e.message).toContain('Polygon, LineString')
  })

  it('merge: forbidden features are skipped; a merge of only forbidden features changes nothing', () => {
    const { ds } = setup([pt('a')], ['Point'])
    const r = ds.getState().importGeoJSON(fc([poly('p')]), 'merge')
    expect(r.refused).toBe(1)
    expect(ds.getState().features.map((f) => f.id)).toEqual(['a'])
    expect(depth(ds)).toBe(0)
  })

  it('refused features do not count against maxFeatures', () => {
    const { ds } = setup([], ['Point'])
    ds.getState().setMaxFeatures(2)
    const r = ds.getState().importGeoJSON(fc([poly('p'), poly('q'), pt('a'), pt('b')]), 'replace')
    expect(ds.getState().features.map((f) => f.id)).toEqual(['a', 'b'])
    expect(r.truncated).toBe(false)
  })

  it('unset: refused is 0 and no error', () => {
    const { ds, codes } = setup([])
    expect(ds.getState().importGeoJSON(fc([poly('p')]), 'replace').refused).toBe(0)
    expect(codes()).toEqual([])
  })

  it('updateFeaturesFromEditor refuses text that brings in a forbidden type, keeps what was there', () => {
    const { ds, codes } = setup([pt('a')], ['Point'])
    const [a] = ds.getState().features
    ds.getState().updateFeaturesFromEditor(fc([a, poly('p')]))
    expect(ds.getState().features).toEqual([a])
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    // the features the text kept as they were cost nothing
    ds.getState().updateFeaturesFromEditor(fc([a, pt('b')]))
    expect(ds.getState().features.map((f) => f.id)).toEqual(['a', 'b'])
  })
})

describe('geometryTypes: paste, merge, break apart', () => {
  it('paste is all-or-nothing', () => {
    const { ds, codes } = setup([pt('a')], ['Point'])
    ds.setState({ clipboard: [pt('a'), poly('p')] })
    expect(ds.getState().pasteSelection()).toBe(false)
    expect(ds.getState().features).toHaveLength(1)
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    ds.setState({ clipboard: [pt('a')] })
    expect(ds.getState().pasteSelection()).toBe(true)
    expect(ds.getState().features).toHaveLength(2)
  })

  it('merge of two points needs MultiPoint', () => {
    const { ds, codes } = setup([pt('a'), pt('b', 1)], ['Point'])
    ds.setState({ selectedIds: ['a', 'b'] })
    expect(ds.getState().mergeFeatures()).toBe(false)
    expect(ds.getState().features).toHaveLength(2)
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    ds.getState().setGeometryTypes(['Point', 'MultiPoint'])
    expect(ds.getState().mergeFeatures()).toBe(true)
    expect(ds.getState().features.map((f) => f.geometry.type)).toEqual(['MultiPoint'])
    expect(depth(ds)).toBe(1)
  })

  it('merge of mixed shapes needs GeometryCollection', () => {
    const { ds, codes } = setup([pt('a'), poly('p')], ['Point', 'Polygon', 'MultiPoint', 'MultiPolygon'])
    ds.setState({ selectedIds: ['a', 'p'] })
    expect(ds.getState().mergeFeatures()).toBe(false)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
  })

  it('break apart needs the part type', () => {
    const { ds, codes } = setup([multiPt('m')], ['MultiPoint'])
    expect(ds.getState().breakMultiGeometry('m')).toBe(false)
    expect(ds.getState().features).toHaveLength(1)
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    ds.getState().setGeometryTypes(['MultiPoint', 'Point'])
    expect(ds.getState().breakMultiGeometry('m')).toBe(true)
    expect(ds.getState().features).toHaveLength(2)
  })

  it('duplicate keeps the type, so it is fine', () => {
    const { ds, codes } = setup([pt('a')], ['Point'])
    ds.setState({ selectedIds: ['a'] })
    expect(ds.getState().duplicateSelection()).toBe(true)
    expect(codes()).toEqual([])
  })

  it('replaceFeatures (boolean-op results) refuses a forbidden result: nothing removed', () => {
    const { ds, codes } = setup([poly('p'), poly('q')], ['MultiPolygon'])
    const result = feat('r', poly('x').geometry)
    expect(ds.getState().replaceFeatures(['p', 'q'], [result])).toBe(false)
    expect(ds.getState().features.map((f) => f.id)).toEqual(['p', 'q'])
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
  })
})

describe('geometryTypes: tools and geometry operations (uiStore)', () => {
  it('isToolAvailable leaves out tools that can only draw forbidden types', () => {
    const { ds, ui } = setup([], ['Point'])
    const avail = (t: string) => ui.getState().isToolAvailable(t)
    expect(avail('point')).toBe(true)
    for (const t of ['line', 'route', 'polygon', 'circle', 'rectangle', 'freehand', 'picker']) expect(avail(t)).toBe(false)
    expect(avail('measure')).toBe(true)
    expect(avail('search')).toBe(true)
    ds.getState().setGeometryTypes(['LineString'])
    expect(['line', 'route', 'freehand'].every(avail)).toBe(true)
    expect(avail('polygon')).toBe(false)
    ds.getState().setGeometryTypes(['MultiPolygon'])
    expect(avail('picker')).toBe(true) // can draw a MultiPolygon
    expect(avail('rectangle')).toBe(false)
    ds.getState().setGeometryTypes(undefined)
    expect(avail('rectangle')).toBe(true)
  })

  it('isToolAvailable keeps honouring `tools`', () => {
    const { ui } = setup([], ['Point', 'Polygon'])
    ui.getState().setEnabledTools(['point'])
    expect(ui.getState().isToolAvailable('point')).toBe(true)
    expect(ui.getState().isToolAvailable('polygon')).toBe(false)
  })

  it('a drawing commit of a forbidden type is refused and the shape in progress is kept', () => {
    const { ds, ui, codes } = setup([], ['Point'])
    ui.setState({ editingMode: 'draw-rect' })
    ui.getState().commitRect([0, 0], [1, 1], {})
    expect(ds.getState().features).toHaveLength(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
  })

  it('buffer of a point (a Polygon) is refused before any snapshot', () => {
    const { ds, ui, codes } = setup([pt('a')], ['Point'])
    ds.setState({ selectedIds: ['a'] })
    ui.setState({ editingMode: 'buffer-shape', geometryPreview: poly('x').geometry, bufferCreateNew: false })
    ui.getState().commitBufferProcess()
    expect(ds.getState().features[0].geometry.type).toBe('Point')
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    expect(ui.getState().editingMode).toBe('none')
  })

  it('simplify / smooth commit keeps the type and passes', () => {
    const { ds, ui, codes } = setup([line('l')], ['LineString'])
    ds.setState({ selectedIds: ['l'] })
    ui.setState({ editingMode: 'simplify-shape', geometryPreview: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } })
    ui.getState().commitGeometryProcess()
    expect(ds.getState().features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [2, 2]] })
    expect(codes()).toEqual([])
  })

  it('cut hole whose result type is forbidden changes nothing and leaves no undo entry', async () => {
    const { ds, ui, codes } = setup([poly('sq')], ['MultiPolygon'])
    ds.setState({ selectedIds: ['sq'] })
    setGeometryRunner(async () => ({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))
    ui.setState({ editingMode: 'cut-hole', polygonInProgress: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75]] })
    await ui.getState().commitCutHole()
    expect(depth(ds)).toBe(0)
    expect(ds.getState().features[0].geometry).toEqual(poly('sq').geometry)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
    expect(ui.getState().geometryProcessing).toBe(false)
  })

  it('slice (every piece a Polygon) is refused when only MultiPolygon is allowed', async () => {
    const { ds, ui, codes } = setup([poly('sq')], ['MultiPolygon'])
    ds.setState({ selectedIds: ['sq'] })
    setGeometryRunner(async () => ({ type: 'MultiPolygon', coordinates: [
      [[[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]],
      [[[0.5, 0], [1, 0], [1, 1], [0.5, 1], [0.5, 0]]],
    ] }))
    ui.setState({ editingMode: 'slice-shape', lineInProgress: [[0.5, -1], [0.5, 2]] })
    await ui.getState().commitSliceShape()
    expect(ds.getState().features).toHaveLength(1)
    expect(depth(ds)).toBe(0)
    expect(codes()).toEqual(['geometry-type-not-allowed'])
  })
})
