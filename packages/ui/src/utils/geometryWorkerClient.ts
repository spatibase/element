import type { Geometry } from 'geojson'
import { ElementEditorError, type ErrorCode } from '@element-editor/core'
import { setGeometryRunner, type GeometryWorkerRequest, type GeometryWorkerResponse } from '@element-editor/core/internal'

/** Per-request ceiling. A JSTS buffer on a huge OSM polygon can take seconds; anything past this is treated as hung. */
const DEFAULT_TIMEOUT_MS = 30_000

let _worker: Worker | null = null
const _pending = new Map<
  string,
  { resolve: (value: Geometry) => void; reject: (reason?: unknown) => void; timer: ReturnType<typeof setTimeout> }
>()

/** Terminate the worker and reject everything in flight — a terminated worker never answers. */
function resetWorker(reason: string, code: ErrorCode) {
  _worker?.terminate()
  _worker = null
  const pending = [..._pending.values()]
  _pending.clear()
  for (const p of pending) {
    clearTimeout(p.timer)
    p.reject(new ElementEditorError(code, 'geometry', reason))
  }
}

async function ensureWorker(): Promise<Worker> {
  if (_worker) return _worker
  // Inline (blob URL) worker in its own lazily-loaded chunk. A URL-referenced
  // worker file 404s once a consumer's bundler pre-bundles @element-editor/ui (Vite
  // dev puts it in .vite/deps without the asset), and the ~350 KB of Turf/JSTS
  // only downloads on the first geometry operation.
  const { default: GeometryWorker } = await import('../workers/geometryWorker.ts?worker&inline')
  if (_worker) return _worker // a concurrent first call won the race
  _worker = new GeometryWorker()

  _worker.onmessage = (e: MessageEvent<GeometryWorkerResponse>) => {
    const { id, ok, result, error } = e.data
    const pending = _pending.get(id)
    if (!pending) return
    _pending.delete(id)
    clearTimeout(pending.timer)
    if (ok && result?.geometry) {
      pending.resolve(result.geometry)
      return
    }
    pending.reject(new ElementEditorError('geometry', 'geometry', error?.message || 'Geometry operation failed'))
  }

  // Reset so ensureWorker() creates a fresh instance on next call
  _worker.onerror = () => resetWorker('Geometry worker failed', 'geometry')

  return _worker
}

export function runGeometryWorkerOperation(
  payload: GeometryWorkerRequest['payload'],
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Geometry> {
  return ensureWorker().then((worker) => new Promise<Geometry>((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      // The worker is single-threaded and still stuck on this job; recreate it.
      // Other in-flight requests die with it and are rejected too.
      resetWorker(`Geometry operation timed out after ${timeoutMs} ms`, 'timeout')
    }, timeoutMs)
    _pending.set(id, { resolve, reject, timer })
    const message: GeometryWorkerRequest = { id, payload }
    worker.postMessage(message)
  }))
}

// The stores' cut hole / slice (core uiStore) run here instead of on the main thread
// (where they block for seconds on a 50k-vertex shape). Without Worker (SSR, jsdom) core
// keeps its main-thread fallback.
if (typeof Worker !== 'undefined') setGeometryRunner(runGeometryWorkerOperation)

export function disposeGeometryWorker() {
  resetWorker('Geometry worker disposed', 'unknown')
}
