import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, ChangeEvent } from 'react'
import {
  parseGeoJSONText,
  DEFAULT_MAX_IMPORT_BYTES,
  type FeatureCollection,
  type ParseGeoJSONError,
} from '@element-editor/core'

/**
 * Headless drag-and-drop + file-picker primitive for loading GeoJSON into a
 * Element instance. Returns spread-friendly prop getters (react-dropzone-style)
 * plus a programmatic `open()` trigger.
 *
 * The hook deliberately does **not** call `importGeoJSON` itself — the caller
 * routes the parsed `FeatureCollection` wherever it needs to go (ref API,
 * `initialData`, custom preprocessing, merge vs replace).
 */

const DEFAULT_ACCEPT = [
  '.geojson',
  '.json',
  'application/geo+json',
  'application/json',
]

export type GeoJSONDropError =
  | { kind: 'wrong-type'; file: File }
  | ParseGeoJSONError

export interface UseGeoJSONDropOptions {
  /** Called with the parsed FeatureCollection + original File handle. */
  onImport: (fc: FeatureCollection, file: File) => void
  /** Called for any reject reason (wrong MIME/extension, too big, malformed, not a FC). */
  onError?: (err: GeoJSONDropError) => void
  /** Max accepted byte length of the file. Defaults to core's DEFAULT_MAX_IMPORT_BYTES (100 MB). */
  maxBytes?: number
  /** File extensions + MIME types to accept. Defaults to `.geojson`, `.json`, and their MIME equivalents. */
  accept?: string[]
  /** When true, drag/drop + file picker become no-ops and `isDragActive` stays false. */
  disabled?: boolean
}

export interface UseGeoJSONDropReturn {
  getRootProps: () => {
    onDragEnter: (e: ReactDragEvent) => void
    onDragOver: (e: ReactDragEvent) => void
    onDragLeave: (e: ReactDragEvent) => void
    onDrop: (e: ReactDragEvent) => void
  }
  getInputProps: () => {
    type: 'file'
    accept: string
    style: { display: 'none' }
    ref: (el: HTMLInputElement | null) => void
    onChange: (e: ChangeEvent<HTMLInputElement>) => void
  }
  isDragActive: boolean
  isProcessing: boolean
  /** Programmatically open the native file picker. No-op when `disabled`. */
  open: () => void
}

function fileMatchesAccept(file: File, accept: string[]): boolean {
  const name = file.name.toLowerCase()
  for (const entry of accept) {
    const e = entry.toLowerCase()
    if (e.startsWith('.')) {
      if (name.endsWith(e)) return true
    } else if (e.endsWith('/*')) {
      const prefix = e.slice(0, -1)
      if (file.type.toLowerCase().startsWith(prefix)) return true
    } else if (file.type.toLowerCase() === e) {
      return true
    }
  }
  return false
}

export function useGeoJSONDrop(options: UseGeoJSONDropOptions): UseGeoJSONDropReturn {
  const {
    onImport,
    onError,
    maxBytes = DEFAULT_MAX_IMPORT_BYTES,
    accept = DEFAULT_ACCEPT,
    disabled = false,
  } = options

  const [isDragActive, setIsDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(true)

  // Latest-callback refs so we don't rebuild handlers on every render of the caller.
  const onImportRef = useRef(onImport)
  const onErrorRef = useRef(onError)
  useEffect(() => { onImportRef.current = onImport }, [onImport])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const acceptAttr = useMemo(() => accept.join(','), [accept])

  const processFile = useCallback(async (file: File) => {
    if (!fileMatchesAccept(file, accept)) {
      onErrorRef.current?.({ kind: 'wrong-type', file })
      return
    }
    if (file.size > maxBytes) {
      onErrorRef.current?.({ kind: 'too-large', bytes: file.size, maxBytes })
      return
    }
    setIsProcessing(true)
    try {
      const text = await file.text()
      if (!mountedRef.current) return
      const result = parseGeoJSONText(text, { maxBytes })
      if (!mountedRef.current) return
      if (!result.ok) {
        onErrorRef.current?.(result.error)
        return
      }
      onImportRef.current(result.fc, file)
    } catch (err) {
      if (!mountedRef.current) return
      onErrorRef.current?.({
        kind: 'invalid-json',
        cause: err instanceof Error ? err : new Error(String(err)),
      })
    } finally {
      if (mountedRef.current) setIsProcessing(false)
    }
  }, [accept, maxBytes])

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (disabled) return
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setIsDragActive(true)
  }, [disabled])

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (disabled) return
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragActive(false)
  }, [disabled])

  const onDrop = useCallback((e: ReactDragEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setIsDragActive(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    void processFile(file)
  }, [disabled, processFile])

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const file = e.target.files?.[0]
    // Reset the input so selecting the same file twice still fires onChange.
    e.target.value = ''
    if (!file) return
    void processFile(file)
  }, [disabled, processFile])

  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
  }, [])

  const open = useCallback(() => {
    if (disabled) return
    inputRef.current?.click()
  }, [disabled])

  const getRootProps = useCallback(() => ({
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  }), [onDragEnter, onDragOver, onDragLeave, onDrop])

  const getInputProps = useCallback(() => ({
    type: 'file' as const,
    accept: acceptAttr,
    style: { display: 'none' as const },
    ref: setInputRef,
    onChange: onInputChange,
  }), [acceptAttr, setInputRef, onInputChange])

  return { getRootProps, getInputProps, isDragActive, isProcessing, open }
}
