import { useCallback } from 'react'
import { getFeatureCollectionBBox, parseGeoJSONText, type ErrorCode } from '@element-editor/core'
import { useGeoStore } from '../store/StoreContext'
import { useEmit } from '../contexts/EventContext'
import { useMapController } from '../contexts/MapControllerContext'

type ImportFn = (raw: unknown, mode: 'replace' | 'merge') => { skipped: number; duplicates: number }

/** Reads, parses and imports (replace) a GeoJSON file. Exported for tests; the UI uses `useGeoJSONFileImport`. */
export async function importGeoJSONFromFile(
  file: File,
  importFn: ImportFn,
  countAfter: () => number,
): Promise<{ ok: true; count: number; skipped: number; duplicates: number } | { ok: false; code: ErrorCode; reason: string; cause?: unknown }> {
  let text: string
  try { text = await file.text() } catch (e) {
    return { ok: false, code: 'unknown', reason: 'The file could not be read', cause: e }
  }
  const parsed = parseGeoJSONText(text)
  if (!parsed.ok) {
    const err = parsed.error
    if (err.kind === 'too-large') return { ok: false, code: 'too-large', reason: `The file is over the ${Math.round(err.maxBytes / 1024 / 1024)} MB import limit` }
    if (err.kind === 'invalid-json') return { ok: false, code: 'invalid-data', reason: `Not valid JSON (${err.cause.message})`, cause: err.cause }
    return { ok: false, code: 'invalid-data', reason: 'Not a FeatureCollection' }
  }
  try {
    const { skipped, duplicates } = importFn(parsed.fc, 'replace')
    // Replace mode: the store now holds exactly what was imported (after
    // `maxFeatures` truncation / skipped geometries), so report that count.
    return { ok: true, count: countAfter(), skipped, duplicates }
  } catch (e) {
    return { ok: false, code: 'invalid-data', reason: e instanceof Error ? e.message : 'Not a FeatureCollection', cause: e }
  }
}

/**
 * The one user-initiated file import (Cmd+O, dropping a file on the map): replaces the data in one
 * undo step (`maxFeatures` truncates and reports), fits the map to what was imported, and reports
 * the result as events (toasts). Refused in readonly.
 */
export function useGeoJSONFileImport() {
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const { fitBounds } = useMapController()
  return useCallback(async (file: File) => {
    if (uiStore.getState().readonly) return
    if (!/\.(geo)?json$/i.test(file.name) && !/json/i.test(file.type)) {
      emit({ type: 'error', code: 'invalid-data', source: 'import', message: 'Import failed', description: `${file.name} is not a .geojson or .json file` })
      return
    }
    const ds = dataStore.getState()
    const result = await importGeoJSONFromFile(file, ds.importGeoJSON, () => dataStore.getState().features.length)
    if (!result.ok) {
      emit({ type: 'error', code: result.code, source: 'import', message: 'Import failed', description: result.reason, cause: result.cause })
      return
    }
    const { features, schemas, groups } = dataStore.getState()
    const bbox = getFeatureCollectionBBox({ type: 'FeatureCollection', metadata: { schemas, groups }, features })
    if (bbox) fitBounds?.(bbox)
    emit({
      type: 'success',
      message: `Loaded ${file.name}`,
      description: result.count === 1 ? '1 feature' : `${result.count} features`,
    })
    const left = result.skipped + result.duplicates
    if (left > 0) {
      emit({
        type: 'warning',
        message: `Skipped ${left === 1 ? '1 feature' : `${left} features`} from ${file.name}`,
        description: [
          result.skipped > 0 && `${result.skipped} with a missing or unsupported geometry`,
          result.duplicates > 0 && `${result.duplicates} with a repeated id`,
        ].filter(Boolean).join(', '),
      })
    }
  }, [dataStore, uiStore, emit, fitBounds])
}
