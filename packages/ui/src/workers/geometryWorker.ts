import { buffer } from '@turf/buffer'
import { difference } from '@turf/difference'
import { intersect } from '@turf/intersect'
import { union } from '@turf/union'
import { simplify } from '@turf/simplify'
import { polygonSmooth } from '@turf/polygon-smooth'
import { featureCollection, lineString, polygon } from '@turf/helpers'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { GeometryWorkerRequest, GeometryWorkerResponse } from '@element-editor/core/internal'
import { smoothLine } from '../utils/lineSmooth'

type PolyFeature = Feature<Polygon | MultiPolygon>
type PolyFC = FeatureCollection<Polygon | MultiPolygon>

const polyFC = (features: PolyFeature[]): PolyFC => featureCollection(features) as PolyFC

function xor(a: PolyFeature | null, b: PolyFeature | null): Feature<Geometry> | null {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  const fc = polyFC([a, b])
  const u = union(fc)
  const i = intersect(fc)
  if (!i || !u) return u as Feature<Geometry> | null
  return difference(polyFC([u as PolyFeature, i as PolyFeature])) as Feature<Geometry> | null
}

self.onmessage = (e: MessageEvent<GeometryWorkerRequest>) => {
  const { id, payload } = e.data
  try {
    if (payload.type === 'boolean') {
      const { op, features } = payload
      let result: Feature<Geometry> | null = null
      if (op === 'union') {
        result = union(polyFC(features))
      } else if (op === 'intersect') {
        result = intersect(polyFC(features))
      } else if (op === 'subtract') {
        result = difference(polyFC(features))
      } else if (op === 'exclude') {
        result = features.reduce<Feature<Geometry> | null>((acc, curr) => xor(acc as PolyFeature | null, curr), null)
      }

      if (!result?.geometry) {
        const message =
          op === 'intersect'
            ? 'No overlap found between the selected shapes.'
            : op === 'subtract'
              ? 'Subtraction resulted in an empty shape.'
              : 'Operation failed to produce a valid shape.'
        const response: GeometryWorkerResponse = {
          id,
          ok: false,
          error: { type: 'error', message, code: 'EMPTY_RESULT' },
        }
        self.postMessage(response)
        return
      }

      const response: GeometryWorkerResponse = {
        id,
        ok: true,
        result: { type: 'boolean', geometry: result.geometry },
      }
      self.postMessage(response)
      return
    }

    if (payload.type === 'cut-hole') {
      const clip = polygon([payload.ring])
      const diff = difference(polyFC([payload.target, clip]))
      if (!diff?.geometry) {
        const response: GeometryWorkerResponse = {
          id,
          ok: false,
          error: { type: 'error', message: 'Failed to cut hole: resulting shape is empty or invalid.', code: 'EMPTY_RESULT' },
        }
        self.postMessage(response)
        return
      }
      const response: GeometryWorkerResponse = {
        id,
        ok: true,
        result: { type: 'cut-hole', geometry: diff.geometry },
      }
      self.postMessage(response)
      return
    }

    if (payload.type === 'slice-shape') {
      // Returns the cut shape as is; core's commitSliceShape applies it only when it has more parts
      // than the target had (same rule as its main-thread fallback), else the line didn't split it.
      const line = lineString(payload.line)
      const bufferedLine = buffer(line, 0.01, { units: 'meters', steps: 1 })
      const split = difference(polyFC([payload.target, bufferedLine as PolyFeature]))
      if (!split?.geometry) {
        const response: GeometryWorkerResponse = {
          id,
          ok: false,
          error: { type: 'error', message: 'Failed to slice shape: result is empty', code: 'EMPTY_RESULT' },
        }
        self.postMessage(response)
        return
      }
      const response: GeometryWorkerResponse = {
        id,
        ok: true,
        result: { type: 'slice-shape', geometry: split.geometry },
      }
      self.postMessage(response)
      return
    }

    if (payload.type === 'buffer' || payload.type === 'simplify' || payload.type === 'smooth') {
      const feature: Feature<Geometry> = { type: 'Feature', geometry: payload.geometry, properties: {} }
      let geometry: Geometry | undefined
      if (payload.type === 'buffer') {
        geometry = buffer(feature, payload.distance, { units: 'meters' })?.geometry
      } else if (payload.type === 'simplify') {
        geometry = payload.tolerance === 0
          ? payload.geometry
          : simplify(feature, { tolerance: payload.tolerance, highQuality: false, mutate: true }).geometry
      } else if (payload.geometry.type === 'LineString') {
        // polygon-smooth only closes rings; lines stay open with fixed endpoints.
        geometry = { type: 'LineString', coordinates: smoothLine(payload.geometry.coordinates, payload.iterations) }
      } else if (payload.geometry.type === 'MultiLineString') {
        geometry = { type: 'MultiLineString', coordinates: payload.geometry.coordinates.map((l) => smoothLine(l, payload.iterations)) }
      } else {
        geometry = polygonSmooth(feature as PolyFeature, { iterations: payload.iterations }).features[0]?.geometry
      }
      const response: GeometryWorkerResponse = geometry
        ? { id, ok: true, result: { type: payload.type, geometry } }
        : { id, ok: false, error: { type: 'error', message: 'Operation produced an empty shape.', code: 'EMPTY_RESULT' } }
      self.postMessage(response)
      return
    }

    const response: GeometryWorkerResponse = {
      id,
      ok: false,
      error: { type: 'error', message: 'Unknown geometry operation', code: 'UNKNOWN_OP' },
    }
    self.postMessage(response)
  } catch (err) {
    const response: GeometryWorkerResponse = {
      id,
      ok: false,
      error: {
        type: 'error',
        message: err instanceof Error ? err.message : 'Geometry operation failed',
        code: 'EXCEPTION',
      },
    }
    self.postMessage(response)
  }
}
