import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractSheetId, fetchSheetCsv, parseCsv, csvToGeoJson } from '@element-editor/core'

// ---------------------------------------------------------------------------
// extractSheetId
// ---------------------------------------------------------------------------

describe('extractSheetId', () => {
  it('extracts ID from /edit?usp=sharing URL', () => {
    expect(extractSheetId('https://docs.google.com/spreadsheets/d/1ExampleSheetIdAbCdEfGhIjKlMnOpQrStUvWxYz012/edit?usp=sharing'))
      .toBe('1ExampleSheetIdAbCdEfGhIjKlMnOpQrStUvWxYz012')
  })

  it('extracts ID from bare trailing slash URL', () => {
    expect(extractSheetId('https://docs.google.com/spreadsheets/d/abc123/'))
      .toBe('abc123')
  })

  it('returns null for a non-Sheets URL', () => {
    expect(extractSheetId('https://example.com/foo')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(extractSheetId('')).toBeNull()
  })

  it('returns null for a URL missing the ID segment', () => {
    expect(extractSheetId('https://docs.google.com/spreadsheets/d/')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('parses a simple two-column two-row CSV', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('"hello, world",b\n1,2')).toEqual([['hello, world', 'b'], ['1', '2']])
  })

  it('handles a quoted field containing a newline', () => {
    const result = parseCsv('"line1\nline2",b')
    expect(result).toEqual([['line1\nline2', 'b']])
  })

  it('handles doubled quotes inside a quoted field', () => {
    expect(parseCsv('"He said ""hi""",b')).toEqual([['He said "hi"', 'b']])
  })

  it('normalises Windows line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('handles an empty last field', () => {
    expect(parseCsv('a,b,\n1,2,')).toEqual([['a', 'b', ''], ['1', '2', '']])
  })
})

// ---------------------------------------------------------------------------
// csvToGeoJson
// ---------------------------------------------------------------------------

describe('csvToGeoJson', () => {
  const minimal = 'lat,lng,name\n48.8566,2.3522,Paris'

  it('builds a Point Feature from lat/lng columns', () => {
    const { geojson } = csvToGeoJson(minimal, 'Test')
    const fc = geojson as { type: string; features: { geometry: { coordinates: number[] } }[] }
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry.coordinates).toEqual([2.3522, 48.8566])
  })

  it('detects canonical latitude/longitude headers', () => {
    const csv = 'latitude,longitude,name\n48.8566,2.3522,Paris'
    const { geojson } = csvToGeoJson(csv, 'Test')
    const fc = geojson as { features: { geometry: { coordinates: number[] } }[] }
    expect(fc.features[0].geometry.coordinates).toEqual([2.3522, 48.8566])
  })

  it('is case-insensitive for lat/lng headers', () => {
    const csv = 'Latitude,Longitude,name\n48.8566,2.3522,Paris'
    const { geojson } = csvToGeoJson(csv, 'Test')
    const fc = geojson as { features: { geometry: { coordinates: number[] } }[] }
    expect(fc.features[0].geometry.coordinates).toEqual([2.3522, 48.8566])
  })

  it('throws when latitude column is missing', () => {
    expect(() => csvToGeoJson('lng,name\n2.35,Paris', 'Test'))
      .toThrow('No lat/lng columns found')
  })

  it('throws when longitude column is missing', () => {
    expect(() => csvToGeoJson('lat,name\n48.85,Paris', 'Test'))
      .toThrow('No lat/lng columns found')
  })

  it('skips rows with non-numeric coordinates and records a warning', () => {
    const csv = 'lat,lng,name\nabc,2.35,Bad\n48.85,2.35,Good'
    const { geojson, warnings } = csvToGeoJson(csv, 'Test')
    const fc = geojson as { features: unknown[] }
    expect(fc.features).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/Row 2/)
  })

  it('skips rows with out-of-range coordinates', () => {
    const csv = 'lat,lng,name\n200,2.35,Bad\n48.85,2.35,Good'
    const { geojson, warnings } = csvToGeoJson(csv, 'Test')
    const fc = geojson as { features: unknown[] }
    expect(fc.features).toHaveLength(1)
    expect(warnings).toHaveLength(1)
  })

  it('puts non-lat/lng columns into properties', () => {
    const csv = 'lat,lng,name,desc\n48.85,2.35,Paris,Capital'
    const { geojson } = csvToGeoJson(csv, 'Test')
    const fc = geojson as { features: { properties: Record<string, string> }[] }
    expect(fc.features[0].properties).toMatchObject({ name: 'Paris', desc: 'Capital' })
  })

  it('schema fields do not include lat/lng columns', () => {
    const { schema } = csvToGeoJson(minimal, 'Test')
    const keys = schema.fields.map((f) => f.key)
    expect(keys).not.toContain('lat')
    expect(keys).not.toContain('lng')
    expect(keys).toContain('name')
  })

  it('schema id is a valid UUID', () => {
    const { schema } = csvToGeoJson(minimal, 'Test')
    expect(schema.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('each feature schemaId matches schema.id', () => {
    const { geojson, schema } = csvToGeoJson(minimal, 'Test')
    const fc = geojson as { features: { schemaId: string }[] }
    expect(fc.features[0].schemaId).toBe(schema.id)
  })

  it('throws when sheet is empty (no data rows)', () => {
    expect(() => csvToGeoJson('lat,lng,name', 'Test'))
      .toThrow('empty')
  })

  it('throws when no valid features are produced', () => {
    const csv = 'lat,lng,name\nabc,xyz,Bad'
    expect(() => csvToGeoJson(csv, 'Test'))
      .toThrow('No valid features found')
  })
})

// ---------------------------------------------------------------------------
// fetchSheetCsv
// ---------------------------------------------------------------------------

describe('fetchSheetCsv', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns text on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('lat,lng\n1,2'),
    }))
    await expect(fetchSheetCsv('SHEET_ID')).resolves.toBe('lat,lng\n1,2')
  })

  it('throws a "not publicly shared" error on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve(''),
    }))
    await expect(fetchSheetCsv('SHEET_ID')).rejects.toThrow('not publicly shared')
  })

  it('throws a generic error on other non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(''),
    }))
    await expect(fetchSheetCsv('SHEET_ID')).rejects.toThrow('HTTP 500')
  })

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    await expect(fetchSheetCsv('SHEET_ID')).rejects.toThrow('Network error')
  })
})
