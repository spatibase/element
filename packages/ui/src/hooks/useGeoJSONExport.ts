import { useCallback, useEffect, useRef } from 'react'
import type { FeatureCollection } from '@element-editor/core'
import { saveGeoJSONFile } from '../utils/download'

/**
 * Headless primitive for exporting the current Element state as GeoJSON.
 * Symmetric to {@link useGeoJSONDrop}: the caller supplies a way to read the
 * current FeatureCollection, the hook handles serialization, filename, Blob
 * construction, and the programmatic anchor-click download.
 *
 * Three return shapes because different apps want different things:
 *   - `exportToFile()` — trigger a browser download (the 99% path).
 *   - `exportToString()` — POST the text to a backend, copy to clipboard, etc.
 *   - `exportToBlob()` — wrap in FormData, upload as multipart, pipe to a
 *     Worker, hand off to `navigator.share`, etc.
 *
 * All three share the same serialization and error handling.
 */

export type GeoJSONExportError =
  | { kind: 'empty' }
  | { kind: 'serialization-error'; cause: Error }

export interface UseGeoJSONExportOptions {
  /**
   * Returns the FeatureCollection to export. Read lazily on every call so
   * the hook doesn't re-render when features mutate. Typical usage:
   * `() => ref.current?.getFeatureCollection()`.
   */
  getFeatureCollection: () => FeatureCollection | null | undefined
  /**
   * File name (without extension) or a function of the FC. Default: "features".
   * The `.geojson` extension is appended automatically.
   */
  filename?: string | ((fc: FeatureCollection) => string)
  /**
   * Called after the user has CONFIRMED the save (Chromium's
   * `showSaveFilePicker` resolved with a chosen path). Great for toasts.
   *
   * Note: in Firefox / Safari the legacy `<a download>` flow has no
   * confirmation signal, so `onExport` is NOT called there — a pre-mature
   * "exported!" toast for an action the user may have cancelled in the OS
   * Save dialog is worse than no toast. See {@link saveGeoJSONFile}.
   */
  onExport?: (fc: FeatureCollection, file: { name: string; bytes: number }) => void
  /** Called on empty FC or serialization errors. */
  onError?: (err: GeoJSONExportError) => void
  /** Pretty-print indent. Default 2. Pass 0 for compact output. */
  indent?: number
  /** When true, export methods become no-ops. Useful for readonly modes. */
  disabled?: boolean
}

export interface UseGeoJSONExportReturn {
  /**
   * Serialize, build a Blob, and trigger a browser download. Returns the
   * suggested filename immediately (`null` only when there's nothing to
   * export). Fires `onExport` ONLY after the user confirms the save in the
   * OS dialog (Chromium); Firefox / Safari fall back to the legacy
   * `<a download>` flow silently — see `onExport` doc above for why.
   * Fires `onError({ kind: 'empty' })` when the FC has no features.
   */
  exportToFile: () => string | null
  /** Return the serialized GeoJSON text, or `null` if the FC is empty. */
  exportToString: () => string | null
  /** Return a `Blob` of the serialized GeoJSON, or `null` if the FC is empty. */
  exportToBlob: () => Blob | null
}

const MIME = 'application/geo+json'

function resolveFilename(
  fc: FeatureCollection,
  filename: UseGeoJSONExportOptions['filename'],
): string {
  const base = typeof filename === 'function'
    ? filename(fc)
    : typeof filename === 'string' && filename.length > 0
      ? filename
      : 'features'
  return base.toLowerCase().endsWith('.geojson') ? base : `${base}.geojson`
}

export function useGeoJSONExport(options: UseGeoJSONExportOptions): UseGeoJSONExportReturn {
  const { getFeatureCollection, filename, indent = 2, disabled = false } = options

  // Latest-callback refs so the returned methods stay stable-by-identity.
  const getFCRef = useRef(getFeatureCollection)
  const onExportRef = useRef(options.onExport)
  const onErrorRef = useRef(options.onError)
  const filenameRef = useRef(filename)
  const indentRef = useRef(indent)
  const disabledRef = useRef(disabled)
  useEffect(() => { getFCRef.current = getFeatureCollection }, [getFeatureCollection])
  useEffect(() => { onExportRef.current = options.onExport }, [options.onExport])
  useEffect(() => { onErrorRef.current = options.onError }, [options.onError])
  useEffect(() => { filenameRef.current = filename }, [filename])
  useEffect(() => { indentRef.current = indent }, [indent])
  useEffect(() => { disabledRef.current = disabled }, [disabled])

  const readFC = useCallback((): FeatureCollection | null => {
    if (disabledRef.current) return null
    const fc = getFCRef.current()
    if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) {
      onErrorRef.current?.({ kind: 'empty' })
      return null
    }
    return fc
  }, [])

  const serialize = useCallback((fc: FeatureCollection): string | null => {
    try {
      return JSON.stringify(fc, null, indentRef.current)
    } catch (err) {
      onErrorRef.current?.({
        kind: 'serialization-error',
        cause: err instanceof Error ? err : new Error(String(err)),
      })
      return null
    }
  }, [])

  const exportToString = useCallback((): string | null => {
    const fc = readFC()
    if (!fc) return null
    return serialize(fc)
  }, [readFC, serialize])

  const exportToBlob = useCallback((): Blob | null => {
    const text = exportToString()
    if (text === null) return null
    return new Blob([text], { type: MIME })
  }, [exportToString])

  const exportToFile = useCallback((): string | null => {
    const fc = readFC()
    if (!fc) return null
    const text = serialize(fc)
    if (text === null) return null
    const suggestedName = resolveFilename(fc, filenameRef.current)
    // Fire-and-forget: callers expect the sync filename return for backwards
    // compat, while the toast/`onExport` callback only runs once we know the
    // user actually saved. Legacy fallback (Firefox/Safari) returns null and
    // the callback stays silent.
    void saveGeoJSONFile(text, suggestedName).then((result) => {
      if (result) onExportRef.current?.(fc, result)
    })
    return suggestedName
  }, [readFC, serialize])

  return { exportToFile, exportToString, exportToBlob }
}
