// Type-level test, compiled by `pnpm --filter @element-editor/react typecheck` (tsc -b includes
// src/test; the `.typetest.tsx` name keeps vitest from running it). Standard `@types/geojson` data
// must reach every input boundary under `strict` without casts, while what Element hands back
// stays the strict `FeatureCollection`. A broken expectation fails the typecheck: an assignment
// that stops compiling, or a `@ts-expect-error` that no longer has an error to expect.
import { createRef } from 'react'
import type * as GeoJSON from 'geojson'
import { ElementEditor, type ElementEditorRef, type FeatureCollection, type FeatureCollectionInput, type GeoJSONFeatureInput } from '../../index'
import { ElementEditor as LeafletEditor, type ElementEditorRef as LeafletRef } from '../../leaflet'

declare const fc: GeoJSON.FeatureCollection
declare const fcNullable: GeoJSON.FeatureCollection<GeoJSON.Geometry | null>
declare const typedProps: GeoJSON.FeatureCollection<GeoJSON.Polygon, { name: string; area: number }>
declare const feature: GeoJSON.Feature
declare const collectionFeature: GeoJSON.Feature<GeoJSON.GeometryCollection>
declare const unlocated: GeoJSON.Feature<null>
declare const output: FeatureCollection

const ref = createRef<ElementEditorRef>()
const leafletRef = createRef<LeafletRef>()

// initialData: a collection (also with null geometries or typed properties) or a single feature, on both drop-ins.
export const editors = [
  <ElementEditor initialData={fc} />,
  <ElementEditor initialData={fcNullable} />,
  <ElementEditor initialData={typedProps} />,
  <ElementEditor initialData={feature} />,
  <ElementEditor initialData={collectionFeature} />,
  <ElementEditor initialData={output} />, // round-trip: what onChange gave back
  <LeafletEditor initialData={fc} />,
  <LeafletEditor initialData={feature} />,
]

// Ref methods.
ref.current?.setFeatureCollection(fc)
ref.current?.setFeatureCollection(fcNullable, { silent: true, undoable: false })
ref.current?.setFeatureCollection(output)
ref.current?.importGeoJSON(fc, 'merge')
ref.current?.addFeature(feature)
ref.current?.addFeature(unlocated) // type-checks; returns null at runtime (nothing to show)
leafletRef.current?.setFeatureCollection(fc, { silent: true })

// 3D positions and bboxes (RFC 7946 §5 allows 6 values).
export const threeD: FeatureCollectionInput = {
  type: 'FeatureCollection',
  bbox: [0, 0, -10, 1, 1, 10],
  features: [
    { type: 'Feature', bbox: [0, 0, 5, 1, 1, 5], geometry: { type: 'Point', coordinates: [0.5, 0.5, 5] }, properties: null },
    { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [[0, 0, 1], [1, 1, 2]] }] } },
  ],
}
export const nullGeometry: GeoJSONFeatureInput = { type: 'Feature', geometry: null, properties: { note: 'unlocated' } }

// What Element hands back stays strict: `metadata` and string ids are always there.
// @ts-expect-error a plain GeoJSON collection has no `metadata`
export const notOutput: FeatureCollection = fc
export const id: string = output.features[0].id

// Still GeoJSON-shaped: a collection needs `features`, a feature needs a `geometry` key.
// @ts-expect-error missing `features`
ref.current?.setFeatureCollection({ type: 'FeatureCollection' })
// @ts-expect-error missing `geometry`
ref.current?.addFeature({ type: 'Feature', properties: {} })
// @ts-expect-error unknown option
ref.current?.setFeatureCollection(fc, { quiet: true })
