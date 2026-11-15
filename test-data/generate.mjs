/**
 * Generate GeoJSON test datasets for performance testing.
 *
 * Datasets model real-world GIS scenarios:
 * 1. Many simple features (city parcels — 500/1000/5000 rectangles)
 * 2. Few complex features (national park boundaries — 1/5/10 polygons with 500-5000 vertices)
 * 3. Mixed workload (100 simple + 10 complex polygons)
 * 4. Dense points (POI datasets — 1000/5000/10000 points)
 * 5. One monster polygon (coastline — 10000/50000 vertices)
 */

import { writeFileSync } from 'fs'

const CENTER = [2.35, 48.86] // Paris

function randomOffset(range = 0.1) {
  return (Math.random() - 0.5) * range * 2
}

function makeRect(cx, cy, size = 0.002) {
  const hw = size / 2
  const hh = size / 2
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
    [cx - hw, cy - hh],
  ]
}

function makeComplexPolygon(cx, cy, vertexCount, radius = 0.01) {
  const ring = []
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount
    const r = radius * (0.7 + Math.random() * 0.6) // jagged coastline effect
    ring.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
  }
  ring.push(ring[0]) // close ring
  return ring
}

function makeFeatureCollection(features) {
  return {
    type: 'FeatureCollection',
    metadata: {
      schemas: [{ id: 'default', name: 'Default', fields: [
        { key: 'name', label: 'Name', type: 'text', required: false },
        { key: 'category', label: 'Category', type: 'text', required: false },
      ]}],
      groups: [],
    },
    features,
  }
}

// --- Dataset 1: Many simple rectangles (city parcels) ---
function generateParcels(count) {
  const features = []
  const cols = Math.ceil(Math.sqrt(count))
  const spacing = 0.003
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const cx = CENTER[0] + col * spacing - (cols * spacing) / 2
    const cy = CENTER[1] + row * spacing - (cols * spacing) / 2
    features.push({
      type: 'Feature',
      id: `parcel-${i}`,
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [makeRect(cx, cy)] },
      properties: { name: `Parcel ${i + 1}`, category: 'parcel' },
    })
  }
  return makeFeatureCollection(features)
}

// --- Dataset 2: Complex polygons (park boundaries) ---
function generateComplexPolygons(count, verticesPerPolygon) {
  const features = []
  for (let i = 0; i < count; i++) {
    const cx = CENTER[0] + randomOffset(0.05)
    const cy = CENTER[1] + randomOffset(0.05)
    features.push({
      type: 'Feature',
      id: `complex-${i}`,
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [makeComplexPolygon(cx, cy, verticesPerPolygon, 0.01 + Math.random() * 0.02)] },
      properties: { name: `Park Boundary ${i + 1}`, category: 'boundary' },
    })
  }
  return makeFeatureCollection(features)
}

// --- Dataset 3: Mixed workload ---
function generateMixed() {
  const features = []
  // 100 simple parcels
  const cols = 10
  const spacing = 0.003
  for (let i = 0; i < 100; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    features.push({
      type: 'Feature',
      id: `mixed-parcel-${i}`,
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [makeRect(CENTER[0] + col * spacing - 0.015, CENTER[1] + row * spacing - 0.015)] },
      properties: { name: `Parcel ${i + 1}`, category: 'parcel' },
    })
  }
  // 10 complex polygons with 500 vertices each
  for (let i = 0; i < 10; i++) {
    features.push({
      type: 'Feature',
      id: `mixed-complex-${i}`,
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [makeComplexPolygon(CENTER[0] + randomOffset(0.03), CENTER[1] + randomOffset(0.03), 500)] },
      properties: { name: `Complex Area ${i + 1}`, category: 'boundary' },
    })
  }
  return makeFeatureCollection(features)
}

// --- Dataset 4: Dense points (POI) ---
function generatePoints(count) {
  const features = []
  for (let i = 0; i < count; i++) {
    features.push({
      type: 'Feature',
      id: `poi-${i}`,
      schemaId: 'default',
      geometry: { type: 'Point', coordinates: [CENTER[0] + randomOffset(0.05), CENTER[1] + randomOffset(0.05)] },
      properties: { name: `POI ${i + 1}`, category: 'poi' },
    })
  }
  return makeFeatureCollection(features)
}

// --- Dataset 5: Monster polygon (coastline simulation) ---
function generateMonsterPolygon(vertexCount) {
  const ring = []
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount
    const r = 0.05 * (0.8 + 0.4 * Math.sin(angle * 37) * Math.cos(angle * 13) + 0.1 * Math.random())
    ring.push([CENTER[0] + r * Math.cos(angle), CENTER[1] + r * Math.sin(angle)])
  }
  ring.push(ring[0])
  return makeFeatureCollection([{
    type: 'Feature',
    id: 'monster-1',
    schemaId: 'default',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { name: `Coastline (${vertexCount} vertices)`, category: 'coastline' },
  }])
}

// --- Dataset 6: Lines (road network) ---
function generateLines(count, verticesPerLine = 20) {
  const features = []
  for (let i = 0; i < count; i++) {
    const start = [CENTER[0] + randomOffset(0.05), CENTER[1] + randomOffset(0.05)]
    const coords = [start]
    for (let j = 1; j < verticesPerLine; j++) {
      const prev = coords[j - 1]
      coords.push([prev[0] + (Math.random() - 0.5) * 0.005, prev[1] + (Math.random() - 0.5) * 0.005])
    }
    features.push({
      type: 'Feature',
      id: `road-${i}`,
      schemaId: 'default',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { name: `Road ${i + 1}`, category: 'road' },
    })
  }
  return makeFeatureCollection(features)
}

// --- Dataset 7: Mega-mix (realistic worst-case mixed workload) ---
function generateMegaMix() {
  const features = []
  // 2000 parcels in a grid
  const cols = 50
  const spacing = 0.0025
  for (let i = 0; i < 2000; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    features.push({
      type: 'Feature',
      id: `mm-parcel-${i}`,
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [makeRect(CENTER[0] + col * spacing - 0.06, CENTER[1] + row * spacing - 0.05)] },
      properties: { name: `Parcel ${i + 1}`, category: 'parcel' },
    })
  }
  // 50 complex polygons (1000 vertices each)
  for (let i = 0; i < 50; i++) {
    features.push({
      type: 'Feature',
      id: `mm-complex-${i}`,
      schemaId: 'default',
      geometry: { type: 'Polygon', coordinates: [makeComplexPolygon(CENTER[0] + randomOffset(0.08), CENTER[1] + randomOffset(0.08), 1000)] },
      properties: { name: `Complex ${i + 1}`, category: 'boundary' },
    })
  }
  // 5000 POI points
  for (let i = 0; i < 5000; i++) {
    features.push({
      type: 'Feature',
      id: `mm-poi-${i}`,
      schemaId: 'default',
      geometry: { type: 'Point', coordinates: [CENTER[0] + randomOffset(0.1), CENTER[1] + randomOffset(0.1)] },
      properties: { name: `POI ${i + 1}`, category: 'poi' },
    })
  }
  // 200 roads (50 vertices each)
  for (let i = 0; i < 200; i++) {
    const start = [CENTER[0] + randomOffset(0.08), CENTER[1] + randomOffset(0.08)]
    const coords = [start]
    for (let j = 1; j < 50; j++) {
      const prev = coords[j - 1]
      coords.push([prev[0] + (Math.random() - 0.5) * 0.005, prev[1] + (Math.random() - 0.5) * 0.005])
    }
    features.push({
      type: 'Feature',
      id: `mm-road-${i}`,
      schemaId: 'default',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { name: `Road ${i + 1}`, category: 'road' },
    })
  }
  return makeFeatureCollection(features)
}

// --- Dataset 8: Huge MultiPolygon (multi-part architecture stress) ---
function generateMultiPolygon(partCount, verticesPerPart) {
  const polygons = []
  const cols = Math.ceil(Math.sqrt(partCount))
  const spacing = 0.004
  for (let i = 0; i < partCount; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const cx = CENTER[0] + col * spacing - (cols * spacing) / 2
    const cy = CENTER[1] + row * spacing - (cols * spacing) / 2
    polygons.push([makeComplexPolygon(cx, cy, verticesPerPart, 0.0015)])
  }
  return makeFeatureCollection([{
    type: 'Feature',
    id: 'multipoly-1',
    schemaId: 'default',
    geometry: { type: 'MultiPolygon', coordinates: polygons },
    properties: { name: `MultiPolygon (${partCount} parts × ${verticesPerPart}v)`, category: 'archipelago' },
  }])
}

// Generate all datasets
const datasets = {
  // Many simple features
  'parcels-500': generateParcels(500),
  'parcels-1000': generateParcels(1000),
  'parcels-5000': generateParcels(5000),

  // Complex polygons
  'complex-5x500v': generateComplexPolygons(5, 500),
  'complex-5x2000v': generateComplexPolygons(5, 2000),
  'complex-10x1000v': generateComplexPolygons(10, 1000),

  // Mixed
  'mixed-100p-10c': generateMixed(),

  // Points
  'points-1000': generatePoints(1000),
  'points-5000': generatePoints(5000),

  // Monster polygons
  'monster-10k': generateMonsterPolygon(10000),
  'monster-50k': generateMonsterPolygon(50000),

  // Lines
  'roads-200': generateLines(200, 30),
  'roads-500': generateLines(500, 50),

  // --- Edge-case stress (added 2026-04-20) ---
  // Massive feature count — pushes layer rendering, viewport culling, list virtualization
  'stress-parcels-25000': generateParcels(25000),
  // Dense point cloud — pushes marker rendering & hit-testing
  'stress-points-50000': generatePoints(50000),
  // Single huge polygon — pushes vertex editing & polygon rendering
  'stress-monster-200k': generateMonsterPolygon(200000),
  // Realistic worst-case mixed workload (2000 parcels + 50 complex + 5000 POIs + 200 roads)
  'stress-mega-mix': generateMegaMix(),
  // Huge MultiPolygon (500 parts × 200v) — multi-part architecture stress
  'stress-multipoly-500x200v': generateMultiPolygon(500, 200),
}

for (const [name, data] of Object.entries(datasets)) {
  const json = JSON.stringify(data)
  const sizeMB = (json.length / 1024 / 1024).toFixed(2)
  const featureCount = data.features.length
  const totalVertices = data.features.reduce((sum, f) => {
    const g = f.geometry
    if (g.type === 'Point') return sum + 1
    if (g.type === 'LineString') return sum + g.coordinates.length
    if (g.type === 'Polygon') return sum + g.coordinates[0].length
    if (g.type === 'MultiPolygon') return sum + g.coordinates.reduce((s, poly) => s + poly[0].length, 0)
    if (g.type === 'MultiLineString') return sum + g.coordinates.reduce((s, line) => s + line.length, 0)
    if (g.type === 'MultiPoint') return sum + g.coordinates.length
    return sum
  }, 0)
  writeFileSync(`test-data/${name}.geojson`, json)
  console.log(`${name}: ${featureCount} features, ${totalVertices} vertices, ${sizeMB} MB`)
}
