import { useCallback } from 'react'
import { toast } from 'sonner'
import { Upload, Download, FileArrowUp } from '@phosphor-icons/react'
import {
  IconButton,
  useGeoJSONDrop,
  useGeoJSONExport,
  type GeoJSONDropError,
  type GeoJSONExportError,
} from '@element-editor/ui'
import type { FeatureCollection } from '@element-editor/core'

interface Props {
  onImport: (fc: FeatureCollection, file: File) => void
}

interface ExportProps {
  /** Returns the current FeatureCollection. Usually wraps a ref's getFeatureCollection. */
  getFeatureCollection: () => FeatureCollection | null | undefined
}

function describeError(err: GeoJSONDropError): string {
  if (err.kind === 'wrong-type') return `"${err.file.name}" isn't a .geojson or .json file`
  if (err.kind === 'too-large') return `File too large (${Math.round(err.bytes / 1024 / 1024)} MB, max ${err.maxBytes / 1024 / 1024} MB)`
  if (err.kind === 'invalid-json') return `Couldn't parse GeoJSON: ${err.cause.message}`
  return `Not a FeatureCollection (received ${err.received})`
}

/**
 * Single hook instance → handlers + UI pieces. Host spreads `rootProps` on
 * whatever element it wants to be the drop target (must have pointer-events:
 * auto), renders `<Button />` wherever it wants, and `<Overlay />` inside the
 * same root container for the "drop here" visual.
 */
export function useGeoJSONDropzone({ onImport }: Props) {
  const handleImport = useCallback((fc: FeatureCollection, file: File) => {
    const count = Array.isArray(fc.features) ? fc.features.length : 0
    onImport(fc, file)
    toast.success(`Loaded ${file.name}`, {
      description: count === 1 ? '1 feature' : `${count} features`,
    })
  }, [onImport])

  const handleError = useCallback((err: GeoJSONDropError) => {
    toast.error('Import failed', { description: describeError(err) })
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useGeoJSONDrop({
    onImport: handleImport,
    onError: handleError,
  })

  const Button = () => (
    <>
      <IconButton
        label="Import GeoJSON file"
        tooltipContent="Import GeoJSON"
        onClick={open}
      >
        <Upload size={24} />
      </IconButton>
      <input {...getInputProps()} aria-label="GeoJSON file input" />
    </>
  )

  const Overlay = () => (
    isDragActive
      ? (
        <div
          className="absolute inset-0 z-[999] flex items-center justify-center bg-blue-500/10 backdrop-blur-sm border-4 border-dashed border-blue-500 pointer-events-none"
          data-testid="geojson-drop-overlay-active"
        >
          {/* Outside [data-elm-theme]: ElementEditor's scoped reset doesn't apply, so set font/margins here. */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl px-8 py-6 flex items-center gap-4" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
            <FileArrowUp size={40} className="text-blue-500" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100" style={{ margin: 0 }}>Drop to import</p>
              <p className="text-sm text-gray-500 dark:text-gray-400" style={{ margin: 0 }}>.geojson or .json file</p>
            </div>
          </div>
        </div>
      )
      : null
  )

  return { rootProps: getRootProps(), Button, Overlay }
}

function describeExportError(err: GeoJSONExportError): string {
  if (err.kind === 'empty') return 'No features to export — draw or import something first.'
  return `Couldn't serialize GeoJSON: ${err.cause.message}`
}

/**
 * Demo's download counterpart to the import button. Symmetric to
 * `GeoJSONImportButton` — uses `useGeoJSONExport` with toast feedback and
 * leaves all UI / filename / formatting choices to the host.
 */
export function GeoJSONExportButton({ getFeatureCollection }: ExportProps) {
  const handleExport = useCallback((fc: FeatureCollection, file: { name: string; bytes: number }) => {
    const count = fc.features.length
    toast.success(`Exported ${file.name}`, {
      description: `${count === 1 ? '1 feature' : `${count} features`} · ${(file.bytes / 1024).toFixed(1)} KB`,
    })
  }, [])

  const handleError = useCallback((err: GeoJSONExportError) => {
    toast.error('Export failed', { description: describeExportError(err) })
  }, [])

  const { exportToFile } = useGeoJSONExport({
    getFeatureCollection,
    onExport: handleExport,
    onError: handleError,
  })

  return (
    <IconButton
      label="Export GeoJSON file"
      tooltipContent="Export GeoJSON"
      onClick={exportToFile}
    >
      <Download size={24} />
    </IconButton>
  )
}
