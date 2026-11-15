import { area } from '@turf/area'
import type * as GeoJSON from 'geojson'
import type { GeoJSONFeature, Schema } from '../types/geojson'

export interface ValidationResult {
  errors: string[]
  warnings: string[]
  geometryFixed: boolean
  fixedFeature: GeoJSONFeature | null
}

function removeDuplicateConsecutive(coords: [number, number][]): [number, number][] {
  if (coords.length === 0) return []
  const result: [number, number][] = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    const prev = result[result.length - 1]
    const curr = coords[i]
    if (prev[0] !== curr[0] || prev[1] !== curr[1]) {
      result.push(curr)
    }
  }
  return result
}

function ensureClosed(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first]
  }
  return ring
}

/** Dedupe + close a ring; returns the SAME array when nothing changed. */
function fixRing(ring: [number, number][]): [number, number][] {
  const fixed = ensureClosed(removeDuplicateConsecutive(ring))
  if (fixed.length !== ring.length) return fixed
  return fixed.every((c, i) => c === ring[i]) ? ring : fixed
}

function fixRings(rings: [number, number][][]): [number, number][][] {
  const fixed = rings.map(fixRing)
  return fixed.some((r, i) => r !== rings[i]) ? fixed : rings
}

type GeomCheck = { geom: GeoJSONFeature['geometry']; polyArea: number | null }

/** Keyed by geometry object: features are updated immutably, so a
 *  property-only edit keeps the same geometry ref and skips the dedupe walk
 *  and turf area. In-place coordinate mutation would read stale results. */
const geomCache = new WeakMap<object, GeomCheck>()

function checkGeometry(input: GeoJSONFeature['geometry']): GeomCheck {
  const cached = geomCache.get(input)
  if (cached) return cached

  let geom = input
  // 1. Auto-fix duplicate vertices & unclosed rings
  if (geom.type === 'LineString') {
    const dedup = removeDuplicateConsecutive(geom.coordinates as [number, number][])
    if (dedup.length !== geom.coordinates.length) geom = { ...geom, coordinates: dedup }
  } else if (geom.type === 'Polygon') {
    const rings = geom.coordinates as [number, number][][]
    const fixed = fixRings(rings)
    if (fixed !== rings) geom = { ...geom, coordinates: fixed }
  } else if (geom.type === 'MultiLineString') {
    const lines = geom.coordinates as [number, number][][]
    const fixed = lines.map(removeDuplicateConsecutive)
    if (fixed.some((l, i) => l.length !== lines[i].length)) geom = { ...geom, coordinates: fixed }
  } else if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as [number, number][][][]
    const fixed = polys.map(fixRings)
    if (fixed.some((p, i) => p !== polys[i])) geom = { ...geom, coordinates: fixed }
  }

  const polyArea = geom.type === 'Polygon' || geom.type === 'MultiPolygon'
    ? area(geom as unknown as GeoJSON.Geometry)
    : null
  const out = { geom, polyArea }
  geomCache.set(input, out)
  if (geom !== input) geomCache.set(geom, { geom, polyArea })
  return out
}

export function validateFeature(feature: GeoJSONFeature, schema: Schema): ValidationResult {
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    geometryFixed: false,
    fixedFeature: null,
  }

  const { geom, polyArea } = checkGeometry(feature.geometry)

  if (geom !== feature.geometry) {
    result.geometryFixed = true
    result.fixedFeature = { ...feature, geometry: geom }
  }

  // 2. Validate Geometry (zero area, self-intersection)
  // Self-intersection (kinks) is not checked here: it blocks the UI on large
  // polygons, and no worker runs it either, so it is currently unchecked.
  if (polyArea === 0) {
    result.errors.push('Area has zero size.')
  }

  const fToTest = result.fixedFeature || feature

  // 3. Schema validation
  for (const field of schema.fields) {
    const val = fToTest.properties[field.key]
    
    if (field.required) {
      if (val === undefined || val === null || String(val).trim() === '') {
        result.errors.push(`Missing required property: ${field.label}`)
      }
    }

    if (field.type === 'number' && val !== undefined && val !== null && String(val).trim() !== '') {
      const num = Number(val)
      if (!isNaN(num)) {
        if (field.min !== undefined && num < field.min) {
          result.errors.push(`${field.label} must be ≥ ${field.min}`)
        }
        if (field.max !== undefined && num > field.max) {
          result.errors.push(`${field.label} must be ≤ ${field.max}`)
        }
      }
    }
  }

  return result
}
