import type { FeatureCollectionInput, Schema } from '@element-editor/core'

/**
 * Demo-only starter data: a short walk through central Prague, so the demo
 * opens on something to select, edit, and look at in the table and the
 * GeoJSON inspector. The library itself starts empty.
 */
export const SAMPLE_SCHEMA: Schema = {
  id: 'places',
  name: 'Places',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'category', label: 'Category', type: 'select', required: false, options: ['Park', 'Landmark', 'Museum', 'Café', 'Walk'] },
    { key: 'rating', label: 'Rating', type: 'number', required: false, min: 1, max: 5 },
    { key: 'free', label: 'Free entry', type: 'boolean', required: false },
    { key: 'website', label: 'Website', type: 'url', required: false },
    { key: 'notes', label: 'Notes', type: 'textarea', required: false },
  ],
}

type Props = { name: string; category: string; rating?: number; free?: boolean; website?: string; notes?: string }
const feature = (id: string, geometry: { type: string; coordinates: unknown }, p: Props) => ({
  type: 'Feature' as const,
  id,
  schemaId: SAMPLE_SCHEMA.id,
  geometry,
  properties: { website: '', notes: '', ...p },
})

export const SAMPLE_DATA = {
  type: 'FeatureCollection',
  features: [
    feature('letna', { type: 'Polygon', coordinates: [[[14.4152, 50.0962], [14.4215, 50.0974], [14.4292, 50.0976], [14.4338, 50.0957], [14.4301, 50.0934], [14.4228, 50.0936], [14.4168, 50.0941], [14.4152, 50.0962]]] },
      { name: 'Letná Park', category: 'Park', rating: 5, free: true, website: 'https://www.praha.eu', notes: 'Best view of the bridges from the beer garden.' }),
    feature('petrin', { type: 'Polygon', coordinates: [[[14.3938, 50.0852], [14.3992, 50.0869], [14.4036, 50.0866], [14.4047, 50.0823], [14.4012, 50.0789], [14.3953, 50.0797], [14.3938, 50.0852]]] },
      { name: 'Petřín Gardens', category: 'Park', rating: 4, free: true, notes: 'Funicular from Újezd, or walk up through the orchards.' }),
    feature('kampa', { type: 'Polygon', coordinates: [[[14.4064, 50.0863], [14.4086, 50.0866], [14.4091, 50.0831], [14.4076, 50.0811], [14.4061, 50.0829], [14.4064, 50.0863]]] },
      { name: 'Kampa Island', category: 'Park', rating: 4, free: true }),
    feature('old-town-square', { type: 'Polygon', coordinates: [[[14.4195, 50.0880], [14.4223, 50.0881], [14.4226, 50.0869], [14.4199, 50.0866], [14.4195, 50.0880]]] },
      { name: 'Old Town Square', category: 'Landmark', rating: 5, free: true, notes: 'The astronomical clock strikes on the hour.' }),
    feature('royal-route', { type: 'LineString', coordinates: [[14.4278, 50.0872], [14.4243, 50.0875], [14.4211, 50.0875], [14.4186, 50.0866], [14.4166, 50.0862], [14.4114, 50.0865], [14.4062, 50.0872], [14.4036, 50.0880], [14.3985, 50.0886], [14.3982, 50.0899], [14.3998, 50.0906]] },
      { name: 'Royal Route', category: 'Walk', rating: 5, free: true, notes: 'Powder Tower to the Castle, about 2.5 km.' }),
    feature('riverside', { type: 'LineString', coordinates: [[14.4141, 50.0702], [14.4136, 50.0741], [14.4129, 50.0776], [14.4126, 50.0811], [14.4131, 50.0839], [14.4136, 50.0860]] },
      { name: 'Riverside walk', category: 'Walk', rating: 4, free: true }),
    feature('castle', { type: 'Point', coordinates: [14.4003, 50.0909] },
      { name: 'Prague Castle', category: 'Landmark', rating: 5, free: false, website: 'https://www.hrad.cz' }),
    feature('charles-bridge', { type: 'Point', coordinates: [14.4114, 50.0865] },
      { name: 'Charles Bridge', category: 'Landmark', rating: 5, free: true, notes: 'Go early: by ten it is shoulder to shoulder.' }),
    feature('national-museum', { type: 'Point', coordinates: [14.4310, 50.0790] },
      { name: 'National Museum', category: 'Museum', rating: 4, free: false, website: 'https://www.nm.cz' }),
    feature('cafe-savoy', { type: 'Point', coordinates: [14.4067, 50.0806] },
      { name: 'Café Savoy', category: 'Café', rating: 4, free: false }),
  ],
} as FeatureCollectionInput
