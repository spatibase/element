import type { Geometry } from 'geojson'
import type { GeometryWorkerPayload } from '../types/geometryWorker'

/** Runs a geometry operation off the main thread; rejects with the operation's error. */
export type GeometryRunner = (payload: GeometryWorkerPayload) => Promise<Geometry>

let runner: GeometryRunner | null = null

/**
 * Registers the off-main-thread runner the stores use for heavy ops (cut hole, slice).
 * `@element-editor/ui` registers its geometry worker client when it loads; without one
 * (core used on its own, unit tests) the stores run the same Turf ops on the main thread.
 * Pass `null` to unregister.
 */
export function setGeometryRunner(next: GeometryRunner | null): void {
  runner = next
}

/** The registered runner, or `null`. */
export function getGeometryRunner(): GeometryRunner | null {
  return runner
}
