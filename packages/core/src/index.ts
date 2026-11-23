/**
 * @element-editor/core — public API (covered by semver).
 *
 * Data types, store factories and their state types, errors, and the helpers the docs describe.
 * Plumbing shared between the @element-editor/* packages lives in `@element-editor/core/internal`
 * (not covered by semver; don't import it from application code).
 */

// ─── Data types ───────────────────────────────────────────────────────────────
export type {
  GeoJSONFeature,
  FeatureCollection,
  Schema,
  SchemaField,
  FieldType,
  Group,
  Geometry,
  PointGeometry,
  MultiPointGeometry,
  LineStringGeometry,
  MultiLineStringGeometry,
  PolygonGeometry,
  MultiPolygonGeometry,
  SimpleGeometry,
  GeometryCollectionGeometry,
  EditingMode,
  DrawType,
  CoordinateGeometry,
  GeoJSONFeatureInput,
  FeatureCollectionInput,
  GeometryInput,
  PositionInput,
  BBoxInput,
} from './types/geojson'
export { isSimpleGeometry } from './types/geojson'
export type { GeometryType } from './utils/geometryTypes'
export type { FeatureStyle, FeatureStyleState } from './types/featureStyle'

// ─── Stores (headless use and tests; inside React use GeoStoreProvider / useGeoStore) ──
// The state types are the shapes of `useDataStore` / `useUIStore` / `useGeoStore()` in @element-editor/ui.
export { createDataStore, isGeometry } from './store/dataStore'
export type { DataStore, DataStoreOptions, FeaturePatch, StoreFeaturePatch, UndoEntry } from './store/dataStore'
export { createUIStore } from './store/uiStore'
export type { UIStore, UIStoreOptions, DialogState, CompletedMeasurement, PanelPrefs } from './store/uiStore'
export type { CoordinateOptions } from './utils/normaliseCoordinates'
export { subscribeToDataChanges } from './utils/subscribeToDataChanges'
export type { DataChangeCallbacks } from './utils/subscribeToDataChanges'

// ─── GeoJSON helpers ──────────────────────────────────────────────────────────
export { getGeometryBBox, getFeatureBBox, getFeatureCollectionBBox, parseGeoJSONText, DEFAULT_MAX_IMPORT_BYTES } from './utils/geojson'
export type { ParseGeoJSONOptions, ParseGeoJSONError, ParseGeoJSONResult } from './utils/geojson'
export type { BBox, LegacyLatLngBounds, BoundsInput, FlyToOptions } from './utils/coords'

// ─── Validation ───────────────────────────────────────────────────────────────
export { validateFeature } from './utils/validation'
export type { ValidationResult } from './utils/validation'

// ─── Errors (onError) ─────────────────────────────────────────────────────────
export { ElementEditorError } from './utils/errors'
export type { ErrorCode, ErrorSource } from './utils/errors'

// ─── Accent palette (one colour → 50…950 scale; mirrors the CSS color-mix block) ──
export { accentPalette, readAccentPalette, mixOklab, parseColor, resolveColor, DEFAULT_ACCENT, DEFAULT_FEATURE_COLOR, ACCENT_STEPS } from './utils/accent'
export type { AccentPalette, AccentShade } from './utils/accent'
export { deriveStateColors, usesDerivedLook, SELECTED_WEIGHT_BOOST } from './utils/selectionStyle'
export type { SelectionStyle, DerivedColors } from './utils/selectionStyle'

// ─── Third-party services (config.network) ────────────────────────────────────
export type { NetworkConfig, NetworkSource, NominatimConfig } from './utils/network'
export { fetchRoute, setRoutingApiKey } from './utils/routing'
export type { FetchRouteOptions, RoutingConfig } from './utils/routing'
export { fetchOverpassFeatures, OverpassError, overpassErrorMessage } from './utils/overpass'
export type { OverpassResult, OverpassOptions, OverpassErrorCode } from './utils/overpass'
export { extractSheetId, fetchSheetCsv, parseCsv, csvToGeoJson } from './utils/googleSheets'

// ─── Shortcuts ────────────────────────────────────────────────────────────────
export { getFixedShortcutDisplay, getFixedShortcutFullDisplay } from './shortcuts'
export type { ShortcutId, FixedShortcutId } from './shortcuts'

// ─── Geometry worker payload (runGeometryWorkerOperation in @element-editor/ui) ──
export type { GeometryWorkerPayload } from './types/geometryWorker'

// ─── Storage (versioned, never-throwing localStorage helpers) ─────────────────
export { readPersisted, writePersisted, readStorage, writeStorage, scopedKey } from './utils/persisted'
export type { PersistScope } from './utils/persisted'

// ─── Formatting ───────────────────────────────────────────────────────────────
export { formatLength, formatArea } from './utils/format'
export type { FormatOpts, FormattedQuantity } from './utils/format'
