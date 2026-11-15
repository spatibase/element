/**
 * Trigger a browser download of a GeoJSON text payload via a synthetic
 * `<a download>` click. Centralises the Blob → object-URL → click → revoke
 * dance so adapter-leaflet's `ref.exportAs('geojson')`, adapter-maplibre's
 * `ref.exportAs('geojson')`, and `useGeoJSONExport.exportToFile()` all share
 * one implementation.
 *
 * Returns the resolved filename and the byte size of the downloaded blob,
 * so callers don't have to allocate a second Blob just to measure bytes.
 *
 * NOTE: completion is not observable. The browser may show a "Save As" dialog
 * the user can cancel; this function returns immediately regardless. Use
 * {@link saveGeoJSONFile} when you need to know whether the user actually
 * saved (e.g. to gate a success toast).
 */
export function triggerGeoJSONDownload(
  text: string,
  filename = 'features.geojson',
): { name: string; bytes: number } {
  const name = filename.toLowerCase().endsWith('.geojson') ? filename : `${filename}.geojson`
  const blob = new Blob([text], { type: 'application/geo+json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return { name, bytes: blob.size }
}

/**
 * Same payload as {@link triggerGeoJSONDownload}, but uses the File System
 * Access API (`showSaveFilePicker`) when available so the caller can `await`
 * an actual save confirmation:
 *
 *   const result = await saveGeoJSONFile(text)
 *   if (result) toast.success(`Exported ${result.name}`)  // user saved
 *   // result === null → user cancelled, OR legacy fallback (we can't tell)
 *
 * Resolves with `{ name, bytes }` ONLY when we know the file was written
 * to disk (Chromium with the API). Resolves with `null` when:
 *   - the user cancelled the picker (Chromium), or
 *   - the browser doesn't support the API (Firefox / Safari) — falls back
 *     to the legacy `<a download>` flow silently, returning `null` so callers
 *     don't show pre-mature "exported!" feedback for an action the user may
 *     have aborted in the OS Save dialog.
 *
 * Pattern intentional: a pre-mature success toast is worse than no toast.
 */
export async function saveGeoJSONFile(
  text: string,
  filename = 'features.geojson',
): Promise<{ name: string; bytes: number } | null> {
  const name = filename.toLowerCase().endsWith('.geojson') ? filename : `${filename}.geojson`
  const blob = new Blob([text], { type: 'application/geo+json' })

  type FsAccessWindow = typeof window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
  }
  const w = window as FsAccessWindow
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'GeoJSON', accept: { 'application/geo+json': ['.geojson', '.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { name: handle.name || name, bytes: blob.size }
    } catch (err) {
      // AbortError: user dismissed the picker. Anything else is a real failure
      // we still surface as "no confirmation"; legacy callers without toasts
      // wouldn't have reported it anyway.
      if (err instanceof Error && err.name === 'AbortError') return null
      // Fall through to legacy below for non-abort errors (e.g. permission).
    }
  }

  // Legacy fallback for Firefox / Safari (and post-error retry above): fire the
  // download intent. We have no way to detect whether the user accepted the OS
  // Save dialog, so per the no-pre-mature-toast contract, return null.
  triggerGeoJSONDownload(text, filename)
  return null
}
