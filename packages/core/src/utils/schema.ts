import type { SchemaField, FieldType, Schema } from '../types/geojson'

/**
 * Convert a human label into a safe object key.
 * "My Field Name" → "my_field_name"
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'field'
}

/**
 * Generate a unique key from a label given a set of already-used keys.
 * Appends _2, _3, … on collision.
 */
export function uniqueKey(label: string, existingKeys: Set<string>): string {
  const base = slugify(label)
  if (!existingKeys.has(base)) return base
  let n = 2
  while (existingKeys.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export const DEFAULT_SCHEMA: SchemaField[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea', required: false },
  { key: 'imageUrl', label: 'Image URL', type: 'url', required: false },
]

export const BOUNDARIES_SCHEMA_ID = 'boundaries'

export const DEFAULT_SCHEMAS: Schema[] = [
  { id: 'default', name: 'Default', fields: DEFAULT_SCHEMA },
  { id: BOUNDARIES_SCHEMA_ID, name: 'Boundaries', fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
  ]},
]

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean (Toggle)' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Select' },
  { value: 'date', label: 'Date' },
]
