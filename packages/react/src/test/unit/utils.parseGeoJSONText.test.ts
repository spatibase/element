import { describe, it, expect } from 'vitest'
import { parseGeoJSONText, DEFAULT_MAX_IMPORT_BYTES } from '@element-editor/core'

describe('parseGeoJSONText', () => {
  it('accepts a valid empty FeatureCollection', () => {
    const r = parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', features: [] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fc.type).toBe('FeatureCollection')
      expect(r.fc.features).toEqual([])
    }
  })

  it('accepts a FeatureCollection with features and metadata', () => {
    const fc = {
      type: 'FeatureCollection',
      metadata: { schemas: [{ id: 's1', name: 'Default', fields: [] }] },
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      ],
    }
    const r = parseGeoJSONText(JSON.stringify(fc))
    expect(r.ok).toBe(true)
  })

  it('rejects malformed JSON with invalid-json', () => {
    const r = parseGeoJSONText('{ not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('invalid-json')
  })

  it('rejects non-FeatureCollection shapes with not-feature-collection', () => {
    const r = parseGeoJSONText(JSON.stringify({ type: 'Feature', geometry: null, properties: {} }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('not-feature-collection')
      if (r.error.kind === 'not-feature-collection') expect(r.error.received).toBe('Feature')
    }
  })

  it('rejects a FeatureCollection missing a features array', () => {
    const r = parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not-feature-collection')
  })

  it('rejects null and primitive JSON', () => {
    expect(parseGeoJSONText('null').ok).toBe(false)
    expect(parseGeoJSONText('42').ok).toBe(false)
    expect(parseGeoJSONText('"hi"').ok).toBe(false)
  })

  it('rejects input that exceeds maxBytes', () => {
    const text = JSON.stringify({ type: 'FeatureCollection', features: [] })
    const r = parseGeoJSONText(text, { maxBytes: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('too-large')
      if (r.error.kind === 'too-large') {
        expect(r.error.bytes).toBe(text.length)
        expect(r.error.maxBytes).toBe(5)
      }
    }
  })

  it('defaults maxBytes to DEFAULT_MAX_IMPORT_BYTES (100 MB)', () => {
    expect(DEFAULT_MAX_IMPORT_BYTES).toBe(100 * 1024 * 1024)
  })
})
