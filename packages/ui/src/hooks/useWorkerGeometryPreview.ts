import { useCallback, useContext, useEffect, useRef } from 'react'
import { ElementEditorError, type Geometry } from '@element-editor/core'
import { EventContext } from '../contexts/EventContext'
import { runGeometryWorkerOperation } from '../utils/geometryWorkerClient'
import type { GeometryWorkerRequest } from '@element-editor/core/internal'

export type PreviewPayload = Extract<GeometryWorkerRequest['payload'], { type: 'buffer' | 'simplify' | 'smooth' }>

/**
 * Computes a live geometry preview (buffer / simplify / smooth) in the geometry
 * worker so slider ticks never block the main thread.
 *
 * - At most one request is in flight. Ticks that arrive meanwhile collapse into a
 *   single queued payload (latest wins), sent when the current one settles.
 * - Every request gets a sequence number. A finished result is applied only if it
 *   is the latest request, or a newer one is queued for the SAME source geometry
 *   (an intermediate frame of the same drag). Results for a replaced source, a
 *   cleared payload or an unmounted panel are dropped.
 * - While computing, the previous preview stays on screen (no flash to empty).
 * - `whenSettled(fn)` runs fn once the preview matches the latest payload, so
 *   Apply / Enter never commits a stale preview.
 *
 * `payload` must be memoised by the caller; `null` means "no preview".
 */
export function useWorkerGeometryPreview(
  payload: PreviewPayload | null,
  setPreview: (geom: Geometry | null) => void,
) {
  // A failed or timed-out preview keeps the previous one on screen; it is reported quietly (onError only).
  const emit = useContext(EventContext)?.emit
  const emitRef = useRef(emit)
  emitRef.current = emit
  const s = useRef({
    seq: 0,
    epoch: 0,
    busy: false,
    queued: null as PreviewPayload | null,
    owned: false,
    onSettled: null as (() => void) | null,
    alive: true,
  }).current

  const flushSettled = useCallback(() => {
    const fn = s.onSettled
    s.onSettled = null
    fn?.()
  }, [s])

  const send = useCallback((p: PreviewPayload) => {
    const seq = ++s.seq
    const epoch = s.epoch
    s.busy = true
    runGeometryWorkerOperation(p)
      .then((g) => g as Geometry, (err: unknown) => {
        if (s.alive && epoch === s.epoch) {
          emitRef.current?.({
            type: 'error',
            code: err instanceof ElementEditorError ? err.code : 'geometry',
            source: 'geometry',
            message: `The ${p.type} preview failed: ${err instanceof Error ? err.message : String(err)}`,
            cause: err,
            quiet: true,
          })
        }
        return null
      })
      .then((geom) => {
        s.busy = false
        if (!s.alive || epoch !== s.epoch) { if (s.queued) { const q = s.queued; s.queued = null; send(q) } return }
        const next = s.queued
        s.queued = null
        const isLatest = seq === s.seq
        if (isLatest || (next && next.geometry === p.geometry)) {
          s.owned = true
          setPreview(geom)
        }
        if (next) send(next)
        else if (isLatest) flushSettled()
      })
  }, [s, setPreview, flushSettled])

  useEffect(() => {
    if (!payload) {
      // Invalidate whatever is in flight and clear only a preview this panel set,
      // so an idle panel never clobbers a sibling panel's preview.
      s.epoch++
      s.queued = null
      s.onSettled = null
      if (s.owned) { s.owned = false; setPreview(null) }
      return
    }
    if (s.busy) { s.queued = payload; s.seq++; return }
    send(payload)
  }, [payload, s, send, setPreview])

  useEffect(() => {
    s.alive = true
    return () => { s.alive = false; s.queued = null; s.onSettled = null }
  }, [s])

  return useCallback((fn: () => void) => {
    if (!s.busy && !s.queued) fn()
    else s.onSettled = fn
  }, [s])
}
