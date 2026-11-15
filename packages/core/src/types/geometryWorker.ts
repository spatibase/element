import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson'

// Message types for the geometry worker in @element-editor/ui (ui/src/workers/geometryWorker.ts).
// Single source of truth: the worker and its client both import these.

type PolyFeature = Feature<Polygon | MultiPolygon>

type BooleanPayload = {
  type: 'boolean'
  op: 'union' | 'subtract' | 'intersect' | 'exclude'
  features: PolyFeature[]
}

type CutHolePayload = {
  type: 'cut-hole'
  target: PolyFeature
  ring: [number, number][]
}

type SlicePayload = {
  type: 'slice-shape'
  target: PolyFeature
  line: [number, number][]
}

// Live-preview ops for BufferPanel / SimplifyPanel / SmoothPanel.
type BufferPayload = { type: 'buffer'; geometry: Geometry; distance: number }
type SimplifyPayload = { type: 'simplify'; geometry: Geometry; tolerance: number }
type SmoothPayload = { type: 'smooth'; geometry: Geometry; iterations: number }

export type GeometryWorkerPayload =
  | BooleanPayload
  | CutHolePayload
  | SlicePayload
  | BufferPayload
  | SimplifyPayload
  | SmoothPayload

export type GeometryWorkerRequest = {
  id: string
  payload: GeometryWorkerPayload
}

type SuccessResult = { type: GeometryWorkerPayload['type']; geometry: Geometry }

type ErrorResult = {
  type: 'error'
  message: string
  code?: string
}

export type GeometryWorkerResponse = {
  id: string
  ok: boolean
  result?: SuccessResult
  error?: ErrorResult
}
