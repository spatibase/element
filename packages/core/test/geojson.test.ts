/**
 * GeoJSON import / export round trip: parseGeoJSONText → dataStore.importGeoJSON → exportGeoJSON,
 * plus the bbox helpers in utils/geojson.ts.
 */
import { describe, it, expect } from 'vitest'
import { area } from '@turf/area'
import {
  parseGeoJSONText,
  getBBox,
  getGeometryBBox,
  getFeatureBBox,
  getFeatureCollectionBBox,
  normalizeFitBoundsTarget,
  exportLayerGeoJSON,
} from '../src/utils/geojson'
import { createDataStore } from '../src/store/dataStore'
import { DEFAULT_SCHEMAS } from '../src/utils/schema'
import type { GeoJSONFeature, Geometry, Schema } from '../src/types/geojson'

const fc = (features: unknown[], metadata?: unknown) => ({ type: 'FeatureCollection', features, ...(metadata ? { metadata } : {}) })
const pt = (id: string | number | undefined, coords: number[] = [0, 0], extra: object = {}) =>
  ({ type: 'Feature', ...(id !== undefined && { id }), geometry: { type: 'Point', coordinates: coords }, properties: {}, ...extra })
const square = (x: number, y: number, s: number): [number, number][][] =>
  [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]

/** A closed circle-ish ring with `n` distinct vertices (plus the closing one). */
function ring(n: number, cx = 14.42, cy = 50.08, r = 0.05): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  out.push(out[0])
  return out
}

function roundTrip(input: unknown) {
  const a = createDataStore()
  a.getState().importGeoJSON(input, 'replace')
  const text = a.getState().exportGeoJSON()
  const parsed = parseGeoJSONText(text)
  if (!parsed.ok) throw new Error('export did not parse')
  const b = createDataStore()
  b.getState().importGeoJSON(parsed.fc, 'replace')
  return { a: a.getState(), b: b.getState(), text, exported: JSON.parse(text) }
}

// ─── parseGeoJSONText ───────────────────────────────────────────────────────

describe('parseGeoJSONText', () => {
  it('accepts a FeatureCollection with features[]', () => {
    const r = parseGeoJSONText(JSON.stringify(fc([pt('a')])))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fc.features).toHaveLength(1)
  })

  it.each([
    ['not JSON', '{', 'invalid-json'],
    ['null', 'null', 'not-feature-collection'],
    ['a number', '42', 'not-feature-collection'],
    ['a bare Feature', JSON.stringify(pt('a')), 'not-feature-collection'],
    ['a geometry', JSON.stringify({ type: 'Point', coordinates: [0, 0] }), 'not-feature-collection'],
    ['FC without features', JSON.stringify({ type: 'FeatureCollection' }), 'not-feature-collection'],
    ['FC with non-array features', JSON.stringify({ type: 'FeatureCollection', features: {} }), 'not-feature-collection'],
  ])('rejects %s', (_label, text, kind) => {
    const r = parseGeoJSONText(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe(kind)
  })

  it('enforces the size cap before parsing', () => {
    const text = JSON.stringify(fc([pt('a')]))
    const r = parseGeoJSONText(text, { maxBytes: text.length - 1 })
    expect(r).toEqual({ ok: false, error: { kind: 'too-large', bytes: text.length, maxBytes: text.length - 1 } })
    expect(parseGeoJSONText(text, { maxBytes: text.length }).ok).toBe(true)
  })

  it('names what it got instead of a FeatureCollection', () => {
    const r = parseGeoJSONText(JSON.stringify({ type: 'Feature' }))
    expect(!r.ok && r.error.kind === 'not-feature-collection' && r.error.received).toBe('Feature')
  })
})

// ─── importGeoJSON: invalid inputs ──────────────────────────────────────────

describe('importGeoJSON input validation', () => {
  it.each([
    ['null', null],
    ['a string', 'FeatureCollection'],
    ['a Feature', pt('a')],
    ['an array', [pt('a')]],
  ])('throws on %s and leaves the store untouched', (_label, raw) => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([pt('keep')]), 'replace')
    const before = s.getState()
    expect(() => s.getState().importGeoJSON(raw, 'replace')).toThrow()
    expect(s.getState().features).toBe(before.features)
    expect(s.getState().undoStack).toBe(before.undoStack)
  })

  it('a FeatureCollection without features replaces with an empty map', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([pt('a')]), 'replace')
    expect(s.getState().importGeoJSON({ type: 'FeatureCollection' }, 'replace')).toEqual({ skipped: 0, duplicates: 0, truncated: false, refused: 0 })
    expect(s.getState().features).toEqual([])
  })

  it('skips features with null, missing or unknown geometry and counts them', () => {
    const s = createDataStore()
    const r = s.getState().importGeoJSON(fc([
      { type: 'Feature', id: 'null-geom', geometry: null, properties: {} },
      { type: 'Feature', id: 'no-geom', properties: {} },
      { type: 'Feature', id: 'circle', geometry: { type: 'Circle', coordinates: [0, 0], radius: 5 }, properties: {} },
      null,
      'garbage',
      pt('ok'),
    ]), 'replace')
    expect(r.skipped).toBe(5)
    expect(s.getState().features.map((f) => f.id)).toEqual(['ok'])
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): importGeoJSON only checks `geometry.type`, not that coordinates exist (dataStore.ts:1213,
  // `GEOMETRY_TYPES.includes(f?.geometry?.type)`); `getGeometryBBox` (dataStore.ts:1250) then throws inside `set`, so one
  // malformed feature aborts the whole import instead of being counted in `skipped`. `isGeometry()`
  // (same file) already does the right check and is not used here.
  it('skips a feature whose geometry has a type but no coordinates instead of throwing', () => {
    const s = createDataStore()
    const r = s.getState().importGeoJSON(fc([
      { type: 'Feature', id: 'bad', geometry: { type: 'Polygon' }, properties: {} },
      pt('ok'),
    ]), 'replace')
    expect(r.skipped).toBe(1)
    expect(s.getState().features.map((f) => f.id)).toEqual(['ok'])
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): same root cause: a Polygon with `coordinates: []` (no rings) crashes getGeometryBBox
  // (`getBBox(coordinates[0])` → reading 'length' of undefined) and aborts the import.
  it('skips a Polygon with no rings instead of throwing', () => {
    const s = createDataStore()
    expect(() => s.getState().importGeoJSON(fc([
      { type: 'Feature', id: 'empty', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
      pt('ok'),
    ]), 'replace')).not.toThrow()
  })

  it('numeric ids (including 0) become strings; missing / empty ids get a UUID', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([pt(0), pt(7), pt(undefined), pt('')]), 'replace')
    const ids = s.getState().features.map((f) => f.id)
    expect(ids.slice(0, 2)).toEqual(['0', '7'])
    expect(ids[2]).toMatch(/^[0-9a-f-]{36}$/)
    expect(ids[3]).toMatch(/^[0-9a-f-]{36}$/)
    expect(ids[2]).not.toBe(ids[3])
  })

  it('missing / null properties are stored as {}', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([
      { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [0, 0] }, properties: null },
    ]), 'replace')
    expect(s.getState().features.map((f) => f.properties)).toEqual([{}, {}])
  })
})

// ─── importGeoJSON: foreign members, schemas, groups ────────────────────────

describe('importGeoJSON foreign members', () => {
  const schemas: Schema[] = [
    { id: 'trees', name: 'Trees', fields: [{ key: 'species', label: 'Species', type: 'text', required: true }] },
    { id: 'roads', name: 'Roads', fields: [] },
  ]

  it('keeps _drawType (only known values), schemaId, groupId and hidden', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([
      { ...pt('c'), _drawType: 'circle', schemaId: 'trees', groupId: 'g1', hidden: true },
      { ...pt('r'), _drawType: 'rectangle' },
      { ...pt('route'), _drawType: 'route' },
      { ...pt('bogus'), _drawType: 'spiral', hidden: 'yes' },
    ], { schemas, groups: [{ id: 'g1', name: 'Park', collapsed: false }] }), 'replace')
    const byId = Object.fromEntries(s.getState().features.map((f) => [f.id, f]))
    expect(byId.c).toMatchObject({ _drawType: 'circle', schemaId: 'trees', groupId: 'g1', hidden: true })
    expect(byId.r._drawType).toBe('rectangle')
    expect(byId.route._drawType).toBe('route')
    expect(byId.bogus).not.toHaveProperty('_drawType')
    expect(byId.bogus).not.toHaveProperty('hidden')
  })

  it('takes metadata.schemas as the runtime schemas on replace; falls back to the defaults', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([pt('a', [0, 0], { schemaId: 'trees' })], { schemas }), 'replace')
    expect(s.getState().schemas).toEqual(schemas)
    expect(s.getState().getSchemaForFeature('a').id).toBe('trees')
    s.getState().importGeoJSON(fc([pt('b')]), 'replace')
    expect(s.getState().schemas).toEqual(DEFAULT_SCHEMAS)
  })

  it('accepts the legacy single-schema metadata (an array of fields)', () => {
    const s = createDataStore()
    const fields = [{ key: 'height', label: 'Height', type: 'number', required: false }]
    s.getState().importGeoJSON(fc([pt('a')], { schema: fields }), 'replace')
    expect(s.getState().schemas).toEqual([{ id: 'default', name: 'Default schema', fields }])
  })

  it('drops a groupId that names no group (replace), keeps one that does', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([pt('a', [0, 0], { groupId: 'ghost' }), pt('b', [0, 0], { groupId: 'g1' })], {
      groups: [{ id: 'g1', name: 'G', collapsed: false }],
    }), 'replace')
    const [a, b] = s.getState().features
    expect(a.groupId).toBeUndefined()
    expect(b.groupId).toBe('g1')
  })

  it('merge: adds new schemas / groups, existing ids win, existing features stay first', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([pt('a', [0, 0], { groupId: 'g1' })], {
      schemas: [schemas[0]], groups: [{ id: 'g1', name: 'Mine', collapsed: false }],
    }), 'replace')
    const r = s.getState().importGeoJSON(fc([
      pt('a'), // duplicate id: skipped
      pt('b', [0, 0], { groupId: 'g1' }), // existing group on the map: kept
      pt('c', [0, 0], { groupId: 'g2' }), // group from the incoming file: kept
      pt('d', [0, 0], { groupId: 'nowhere' }), // orphan: dropped
    ], {
      schemas: [{ id: 'trees', name: 'Renamed', fields: [] }, schemas[1]],
      groups: [{ id: 'g1', name: 'Theirs', collapsed: true }, { id: 'g2', name: 'New', collapsed: false }],
    }), 'merge')
    expect(r).toEqual({ skipped: 0, duplicates: 1, truncated: false, refused: 0 })
    const st = s.getState()
    expect(st.features.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(st.features.map((f) => f.groupId)).toEqual(['g1', 'g1', 'g2', undefined])
    expect(st.schemas.map((x) => [x.id, x.name])).toEqual([['trees', 'Trees'], ['roads', 'Roads']])
    expect(st.groups.map((g) => [g.id, g.name])).toEqual([['g1', 'Mine'], ['g2', 'New']])
  })

  it('replace dedupes repeated ids within the incoming file', () => {
    const s = createDataStore()
    const r = s.getState().importGeoJSON(fc([pt('x', [1, 1]), pt('x', [2, 2])]), 'replace')
    expect(r.duplicates).toBe(1)
    expect(s.getState().features).toHaveLength(1)
    expect(s.getState().features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 1] })
  })
})

// ─── importGeoJSON: geometry edge cases ─────────────────────────────────────

describe('importGeoJSON geometry edge cases', () => {
  it('keeps 3D coordinates untouched; bbox is 2D', () => {
    const s = createDataStore()
    const line = [[14.4, 50.0, 230], [14.5, 50.1, 255.5], [14.6, 50.05, 210]]
    s.getState().importGeoJSON(fc([
      { type: 'Feature', id: 'l', geometry: { type: 'LineString', coordinates: line }, properties: {} },
      pt('p', [14.4, 50.0, 300]),
    ]), 'replace')
    const [l, p] = s.getState().features
    expect(l.geometry).toEqual({ type: 'LineString', coordinates: line })
    expect(l.bbox).toEqual([14.4, 50.0, 14.6, 50.1])
    expect(p.geometry).toEqual({ type: 'Point', coordinates: [14.4, 50.0, 300] })
    expect(p.bbox).toEqual([14.4, 50.0, 14.4, 50.0])
  })

  it('a 6-element (3D) input bbox is replaced by a 2D bbox computed from the geometry', () => {
    const s = createDataStore()
    s.getState().importGeoJSON(fc([{
      type: 'Feature', id: 'a',
      bbox: [-999, -999, 0, 999, 999, 100], // deliberately wrong: must not be trusted
      geometry: { type: 'Polygon', coordinates: square(10, 20, 1) },
      properties: {},
    }]), 'replace')
    expect(s.getState().features[0].bbox).toEqual([10, 20, 11, 21])
  })

  it('imports a GeometryCollection (including a nested one) with a bbox over every member', () => {
    const s = createDataStore()
    const geometry = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [-5, 2] },
        { type: 'LineString', coordinates: [[0, 0], [3, 4]] },
        { type: 'GeometryCollection', geometries: [{ type: 'Polygon', coordinates: square(10, -3, 2) }] },
      ],
    }
    const r = s.getState().importGeoJSON(fc([{ type: 'Feature', id: 'gc', geometry, properties: {} }]), 'replace')
    expect(r.skipped).toBe(0)
    expect(s.getState().features[0].geometry).toEqual(geometry)
    expect(s.getState().features[0].bbox).toEqual([-5, -3, 12, 4])
  })

  it('antimeridian-crossing coordinates are stored as given (no wrapping)', () => {
    const s = createDataStore()
    const coords = [[[179.5, -17], [-179.5, -17], [-179.5, -16], [179.5, -16], [179.5, -17]]]
    s.getState().importGeoJSON(fc([{ type: 'Feature', id: 'fiji', geometry: { type: 'Polygon', coordinates: coords }, properties: {} }]), 'replace')
    expect(s.getState().features[0].geometry.coordinates).toEqual(coords)
  })

  // KNOWN LIMITATION (left as it.fails; a west > east bbox needs every bbox consumer, i.e. viewport culling, snapping, box select, fitBounds, to handle wrap-around): bboxes are naive min/max over longitudes (utils/geojson.ts getBBox), so a
  // 1°-wide shape crossing the antimeridian gets a 359°-wide bbox. Viewport culling then treats it
  // as visible everywhere, snapping's bbox cull never rejects it, and fitBounds on the import
  // (getFeatureCollectionBBox) zooms out to the whole world. RFC 7946 §5.2 says such a bbox has
  // west > east.
  it.fails('a shape crossing the antimeridian gets a narrow bbox (west > east per RFC 7946 §5.2)', () => {
    const coords: [number, number][][] = [[[179.5, -17], [-179.5, -17], [-179.5, -16], [179.5, -16], [179.5, -17]]]
    const [w, , e] = getGeometryBBox({ type: 'Polygon', coordinates: coords })
    const width = e >= w ? e - w : e + 360 - w
    expect(width).toBeCloseTo(1, 6)
  })
})

// ─── export → import round trip ─────────────────────────────────────────────

describe('exportGeoJSON round trip', () => {
  const schemas: Schema[] = [{ id: 'trees', name: 'Trees', fields: [{ key: 'species', label: 'Species', type: 'text', required: true }] }]
  const groups = [{ id: 'g1', name: 'Park', collapsed: true, hidden: false }]
  const input = fc([
    { type: 'Feature', id: 'circle', _drawType: 'circle', schemaId: 'trees', groupId: 'g1', geometry: { type: 'Polygon', coordinates: [ring(64)] }, properties: { species: 'Oak', n: 3, tags: ['a', 'b'], nested: { x: null } } },
    { type: 'Feature', id: 'hidden-line', hidden: true, geometry: { type: 'LineString', coordinates: [[1, 2, 3], [4, 5, 6]] }, properties: { name: 'Z line' } },
    { type: 'Feature', id: 'mp', _drawType: 'rectangle', geometry: { type: 'MultiPolygon', coordinates: [square(0, 0, 1), [...square(5, 5, 2), [[5.5, 5.5], [6, 5.5], [6, 6], [5.5, 5.5]]]] }, properties: {} },
    { type: 'Feature', id: 'gc', geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 1] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }] }, properties: {} },
    { type: 'Feature', id: 42, geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, properties: {} },
  ], { schemas, groups })

  it('writes metadata.schemas + metadata.groups and no internal _validation', () => {
    const { exported } = roundTrip(input)
    expect(exported.type).toBe('FeatureCollection')
    expect(exported.metadata.schemas).toEqual(schemas)
    expect(exported.metadata.groups).toEqual(groups)
    for (const f of exported.features) expect(f).not.toHaveProperty('_validation')
  })

  it('import(export(x)) preserves every feature exactly', () => {
    const { a, b } = roundTrip(input)
    const strip = (f: GeoJSONFeature) => ({ ...f, _validation: undefined })
    expect(b.features.map(strip)).toEqual(a.features.map(strip))
    expect(b.schemas).toEqual(a.schemas)
    expect(b.groups).toEqual(a.groups)
    expect(b.features.map((f) => f.id)).toEqual(['circle', 'hidden-line', 'mp', 'gc', '42'])
    const circle = b.features[0]
    expect(circle).toMatchObject({ _drawType: 'circle', schemaId: 'trees', groupId: 'g1' })
    expect(circle.properties).toEqual({ species: 'Oak', n: 3, tags: ['a', 'b'], nested: { x: null } })
    expect(b.features[1].hidden).toBe(true)
    expect(b.features[1].geometry.coordinates).toEqual([[1, 2, 3], [4, 5, 6]])
  })

  it('export is a fixed point: export(import(export(x))) === export(x)', () => {
    const { text, b } = roundTrip(input)
    const again = createDataStore()
    again.setState({ features: b.features, schemas: b.schemas, groups: b.groups })
    expect(again.getState().exportGeoJSON()).toBe(text)
  })

  it('the round trip keeps polygon area and vertex counts', () => {
    const { a, b } = roundTrip(input)
    for (let i = 0; i < a.features.length; i++) {
      const ga = a.features[i].geometry, gb = b.features[i].geometry
      if (ga.type === 'Polygon' || ga.type === 'MultiPolygon') {
        expect(area(gb as never)).toBeCloseTo(area(ga as never), 6)
      }
      expect(JSON.stringify(gb).length).toBe(JSON.stringify(ga).length)
    }
  })

  it('exportLayerGeoJSON writes the same wire shape (schemas under metadata)', () => {
    const f: GeoJSONFeature = { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
    const out = JSON.parse(exportLayerGeoJSON([f], schemas))
    expect(out).toEqual({ type: 'FeatureCollection', metadata: { schemas }, features: [f] })
    const r = parseGeoJSONText(JSON.stringify(out))
    expect(r.ok).toBe(true)
  })

  // Fixed bug, kept as a regression test (describes the old behaviour): an empty GeometryCollection (or a LineString/MultiPoint with no coordinates) imports with
  // bbox [Infinity, Infinity, -Infinity, -Infinity] (utils/geojson.ts getBBox / getGeometryBBox);
  // JSON.stringify turns that into `"bbox": [null, null, null, null]`, which is invalid GeoJSON and
  // fails strict parsers on re-import elsewhere.
  it('never exports a bbox with null / non-finite numbers', () => {
    const { exported } = roundTrip(fc([
      { type: 'Feature', id: 'empty-gc', geometry: { type: 'GeometryCollection', geometries: [] }, properties: {} },
    ]))
    const bbox = exported.features[0].bbox
    expect(bbox === undefined || bbox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))).toBe(true)
  })
})

// ─── performance sanity ─────────────────────────────────────────────────────

describe('large input', () => {
  it('a 50k-point polygon parses, imports and exports well under a second each', () => {
    const big = ring(50_000)
    const text = JSON.stringify(fc([{ type: 'Feature', id: 'big', geometry: { type: 'Polygon', coordinates: [big] }, properties: {} }]))

    let t = performance.now()
    const parsed = parseGeoJSONText(text)
    const parseMs = performance.now() - t
    expect(parsed.ok).toBe(true)

    const s = createDataStore()
    t = performance.now()
    s.getState().importGeoJSON(parsed.ok ? parsed.fc : null, 'replace')
    const importMs = performance.now() - t

    t = performance.now()
    const out = s.getState().exportGeoJSON()
    const exportMs = performance.now() - t

    const f = s.getState().features[0]
    expect(f.geometry.type).toBe('Polygon')
    expect((f.geometry.coordinates as number[][][])[0]).toHaveLength(50_001)
    expect(f.bbox![0]).toBeCloseTo(14.37, 6)
    expect(f.bbox![2]).toBeCloseTo(14.47, 6)
    // Generous bounds: this is a "no accidental O(n²)" guard, not a benchmark.
    expect(parseMs).toBeLessThan(1000)
    expect(importMs).toBeLessThan(1000)
    expect(exportMs).toBeLessThan(2000)
    expect(out.length).toBeGreaterThan(text.length) // pretty-printed
  })

  it('50k point features import in under 2 s; the 50,001st is truncated', () => {
    const features = Array.from({ length: 50_001 }, (_, i) => pt(`p${i}`, [i * 1e-4, 0]))
    const s = createDataStore()
    const t = performance.now()
    const r = s.getState().importGeoJSON(fc(features), 'replace')
    expect(performance.now() - t).toBeLessThan(2000)
    expect(r.truncated).toBe(true)
    expect(s.getState().features).toHaveLength(50_000)
  })
})

// ─── bbox helpers ───────────────────────────────────────────────────────────

describe('bbox helpers', () => {
  const geoms: Array<[string, Geometry, [number, number, number, number]]> = [
    ['Point', { type: 'Point', coordinates: [3, 4] }, [3, 4, 3, 4]],
    ['MultiPoint', { type: 'MultiPoint', coordinates: [[3, 4], [-1, 9]] }, [-1, 4, 3, 9]],
    ['LineString', { type: 'LineString', coordinates: [[0, 0], [2, -3], [1, 5]] }, [0, -3, 2, 5]],
    ['MultiLineString', { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[-4, 2], [-3, 8]]] }, [-4, 0, 1, 8]],
    ['Polygon (holes ignored)', { type: 'Polygon', coordinates: [square(0, 0, 10)[0], square(2, 2, 1)[0]] }, [0, 0, 10, 10]],
    ['MultiPolygon', { type: 'MultiPolygon', coordinates: [square(0, 0, 1), square(-5, 7, 2)] }, [-5, 0, 1, 9]],
  ]
  it.each(geoms)('getGeometryBBox %s', (_n, g, expected) => {
    expect(getGeometryBBox(g)).toEqual(expected)
  })

  it('getBBox of an empty array is the inverted infinite box', () => {
    expect(getBBox([])).toEqual([Infinity, Infinity, -Infinity, -Infinity])
  })

  it('getFeatureBBox caches per feature object; a replaced feature is recomputed', () => {
    const f: GeoJSONFeature = { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
    const b1 = getFeatureBBox(f)
    expect(getFeatureBBox(f)).toBe(b1)
    const g = { ...f, geometry: { type: 'Point' as const, coordinates: [5, 6] as [number, number] } }
    expect(getFeatureBBox(g)).toEqual([5, 6, 5, 6])
  })

  it('getFeatureCollectionBBox spans all features, skips empty / geometry-less ones, null when none', () => {
    expect(getFeatureCollectionBBox({ type: 'FeatureCollection', metadata: { schemas: [], groups: [] }, features: [] })).toBeNull()
    const features = [
      { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
      { type: 'Feature', id: 'b', geometry: null, properties: {} },
      { type: 'Feature', id: 'c', geometry: { type: 'GeometryCollection', geometries: [] }, properties: {} },
      { type: 'Feature', id: 'd', geometry: { type: 'LineString', coordinates: [[-3, 0], [4, 7]] }, properties: {} },
    ] as unknown as GeoJSONFeature[]
    expect(getFeatureCollectionBBox({ type: 'FeatureCollection', metadata: { schemas: [], groups: [] }, features })).toEqual([-3, 0, 4, 7])
  })

  it('normalizeFitBoundsTarget accepts a bbox tuple or a point list; null for empty / non-finite', () => {
    expect(normalizeFitBoundsTarget([1, 2, 3, 4])).toEqual({ minLng: 1, minLat: 2, maxLng: 3, maxLat: 4 })
    expect(normalizeFitBoundsTarget([[5, 1], [-2, 8], [NaN, 0], [3, 3]])).toEqual({ minLng: -2, minLat: 1, maxLng: 5, maxLat: 8 })
    expect(normalizeFitBoundsTarget([])).toBeNull()
    expect(normalizeFitBoundsTarget([1, NaN, 3, 4])).toBeNull()
    expect(normalizeFitBoundsTarget([[NaN, NaN]])).toBeNull()
  })
})
