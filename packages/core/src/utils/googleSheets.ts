import type { FieldType, Schema, SchemaField } from '../types/geojson'
import { uniqueKey } from './schema'

export function extractSheetId(url: string): string | null {
  return url.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? null
}

export async function fetchSheetCsv(sheetId: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Sheet is not publicly shared. Set sharing to "Anyone with the link".')
    }
    throw new Error(`Failed to fetch sheet (HTTP ${res.status})`)
  }
  return res.text()
}

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  type State = 'field' | 'quoted' | 'quote-end'
  let state: State = 'field'

  // Normalise Windows line endings
  const text = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (state === 'field') {
      if (ch === '"') {
        state = 'quoted'
      } else if (ch === ',') {
        row.push(field)
        field = ''
      } else if (ch === '\n') {
        row.push(field)
        field = ''
        rows.push(row)
        row = []
      } else {
        field += ch
      }
    } else if (state === 'quoted') {
      if (ch === '"') {
        state = 'quote-end'
      } else {
        field += ch
      }
    } else {
      // quote-end
      if (ch === '"') {
        field += '"'
        state = 'quoted'
      } else if (ch === ',') {
        row.push(field)
        field = ''
        state = 'field'
      } else if (ch === '\n') {
        row.push(field)
        field = ''
        rows.push(row)
        row = []
        state = 'field'
      } else {
        // Malformed but tolerate
        field += ch
        state = 'field'
      }
    }
  }

  // Flush final field/row
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

const LAT_NAMES = new Set(['lat', 'latitude'])
const LNG_NAMES = new Set(['lng', 'lon', 'long', 'longitude'])

function inferFieldType(label: string): FieldType {
  const l = label.toLowerCase()
  if (/url|web|link|image|img|gmap/.test(l)) return 'url'
  if (/date|time/.test(l)) return 'date'
  if (/price|num|count/.test(l)) return 'number'
  if (/desc|info|notes|address|transport|hours/.test(l)) return 'textarea'
  return 'text'
}

export interface CsvToGeoJsonResult {
  geojson: Record<string, unknown>
  schema: Schema
  warnings: string[]
}

export function csvToGeoJson(csv: string, sourceName: string): CsvToGeoJsonResult {
  const rows = parseCsv(csv)

  if (rows.length === 0) throw new Error('Sheet appears to be empty.')

  const headers = rows[0].map((h) => h.trim())

  const latIdx = headers.findIndex((h) => LAT_NAMES.has(h.toLowerCase()))
  const lngIdx = headers.findIndex((h) => LNG_NAMES.has(h.toLowerCase()))

  if (latIdx === -1 || lngIdx === -1) {
    throw new Error(
      'No lat/lng columns found. Expected columns named: lat or latitude, and lng, lon, or longitude.',
    )
  }

  if (rows.length <= 1) {
    throw new Error('Sheet appears to be empty (no data rows).')
  }

  // Build schema fields from non-lat/lng columns
  const usedKeys = new Set<string>()
  const fields: SchemaField[] = []
  const propertyColIndices: number[] = []

  for (let i = 0; i < headers.length; i++) {
    if (i === latIdx || i === lngIdx) continue
    const label = headers[i] || `Column ${i + 1}`
    const key = uniqueKey(label, usedKeys)
    usedKeys.add(key)
    fields.push({ key, label, type: inferFieldType(label), required: false })
    propertyColIndices.push(i)
  }

  const schema: Schema = {
    id: crypto.randomUUID(),
    name: sourceName,
    fields,
  }

  const warnings: string[] = []
  const features: Record<string, unknown>[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]

    // Skip all-empty rows
    if (row.every((c) => c.trim() === '')) continue

    const latStr = row[latIdx]?.trim() ?? ''
    const lngStr = row[lngIdx]?.trim() ?? ''
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)

    if (isNaN(lat) || isNaN(lng)) {
      warnings.push(`Row ${r + 1}: invalid coordinates (${latStr}, ${lngStr})`)
      continue
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      warnings.push(`Row ${r + 1}: coordinates out of range (${lat}, ${lng})`)
      continue
    }

    const properties: Record<string, string | number> = {}
    for (let pi = 0; pi < propertyColIndices.length; pi++) {
      const colIdx = propertyColIndices[pi]
      const raw = row[colIdx]?.trim() ?? ''
      const field = fields[pi]
      properties[field.key] = field.type === 'number' && raw !== '' && !isNaN(Number(raw))
        ? Number(raw)
        : raw
    }

    features.push({
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: schema.id,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties,
    })
  }

  if (features.length === 0) {
    throw new Error('No valid features found — check that lat/lng columns contain numeric values.')
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: { schemas: [schema], groups: [] },
    features,
  }

  return { geojson, schema, warnings }
}
