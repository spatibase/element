import { useState, useEffect, useRef, useContext, useCallback } from 'react'
import { ElementEditorError } from '@element-editor/core'
import { httpErrorCode } from '@element-editor/core/internal'
import { EventContext } from '../contexts/EventContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'

export interface NominatimGeometry {
  type: 'Point' | 'LineString' | 'Polygon' | 'MultiPolygon'
  coordinates: unknown
}

export interface NominatimResult {
  place_id: number
  display_name: string
  lat: string  // string — always parseFloat before use
  lon: string  // string — always parseFloat before use
  type: string
  addresstype: string
  geojson?: NominatimGeometry
}

interface UseNominatimReturn {
  results: NominatimResult[]
  loading: boolean
  error: string | null
  /** Run the pending (debounced) search now, e.g. on Enter. No-op when none is waiting. */
  flush: () => void
}

const DEBOUNCE_MS = 400
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
export const NOMINATIM_ATTRIBUTION = 'Geocoding by <a href="https://nominatim.org/" target="_blank" rel="noopener">Nominatim</a>'

/** The search box's own error line for a failed search: what happened and what to do. */
function searchError(err: unknown): ElementEditorError {
  if (err instanceof ElementEditorError) return err
  if (err instanceof SyntaxError) return new ElementEditorError('invalid-data', 'search', 'Search service sent an answer that could not be read. Try again later.', { cause: err })
  return new ElementEditorError('network', 'search', 'Search unavailable. Check your connection.', { cause: err })
}

function searchHttpError(status: number): ElementEditorError {
  const code = httpErrorCode(status)
  const message = code === 'rate-limited'
    ? 'Too many searches — wait a moment and try again.'
    : code === 'busy'
      ? 'Search service is busy — try again in a moment.'
      : `Search failed (HTTP ${status}). Try again later.`
  return new ElementEditorError(code, 'search', message)
}

export function useNominatim(query: string): UseNominatimReturn {
  const [results, setResults] = useState<NominatimResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The dropdown shows the error inline, so it goes to onError quietly (no toast).
  const emit = useContext(EventContext)?.emit
  const emitRef = useRef(emit)
  emitRef.current = emit
  // `config.network.nominatim` / `fetch`, read when a search fires (the content-keyed config keeps it stable).
  const { network } = useElementEditorConfig()
  const netRef = useRef(network)
  netRef.current = network
  // The debounced search waiting to run (cleared once it starts).
  const pendingRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const trimmed = query.trim()

    // Clear results immediately when query is empty
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    // Debounce
    if (timerRef.current) clearTimeout(timerRef.current)
    const run = async () => {
      pendingRef.current = null
      if (timerRef.current) clearTimeout(timerRef.current)
      // Cancel any in-flight request
      abortRef.current?.abort()
      abortRef.current = new AbortController()

      try {
        const { nominatim, fetch: f = fetch } = netRef.current
        const service = nominatim || {}
        const params = new URLSearchParams({
          q: trimmed,
          format: 'json',
          limit: '6',
          addressdetails: '0',
          polygon_geojson: '1',
          ...(service.email && { email: service.email }),
        })
        const url = service.url ?? NOMINATIM_URL
        const res = await f(`${url}${url.includes('?') ? '&' : '?'}${params}`, { signal: abortRef.current.signal })
        if (!res.ok) throw searchHttpError(res.status)
        const data: NominatimResult[] = await res.json()
        const seenName = new Set<string>()
        const seenCoords = new Set<string>()
        const deduped = data.filter(r => {
          const coordKey = `${r.lat},${r.lon}`
          if (seenName.has(r.display_name) || seenCoords.has(coordKey)) return false
          seenName.add(r.display_name)
          seenCoords.add(coordKey)
          return true
        })
        setResults(deduped)
        setError(null)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return // stale request — ignore
        const e = searchError(err)
        setError(e.message)
        emitRef.current?.({ type: 'error', code: e.code, source: 'search', message: e.message, error: e, quiet: true })
        setResults([])
      } finally {
        setLoading(false)
      }
    }
    pendingRef.current = run
    timerRef.current = setTimeout(run, DEBOUNCE_MS)

    return () => {
      pendingRef.current = null
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  // Abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const flush = useCallback(() => { pendingRef.current?.() }, [])

  return { results, loading, error, flush }
}
