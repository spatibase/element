import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { getFeatureCollectionBBox, isGeometry, ElementEditorError, subscribeToDataChanges, validateFeature } from '@element-editor/core'
import { canVertexEdit, normalizeFlyToTarget, warnOnce } from '@element-editor/core/internal'
import type { DataChangeCallbacks, DataStore, CoordinateOptions, EditingMode, FeatureCollection, FeatureCollectionInput, FeaturePatch, FlyToOptions, GeoJSONFeature, GeoJSONFeatureInput, GeometryType, Schema } from '@element-editor/core'
import { TOOL_MODES, useElementEditorConfig, type DrawTool } from '../contexts/ElementEditorConfigContext'
import { useDataStore, useGeoStore, useUIStore } from '../store/StoreContext'
import { useMapController } from '../contexts/MapControllerContext'
import { triggerGeoJSONDownload } from '../utils/download'

/**
 * `useAdapterControls` — single source of truth for the editor-shell wiring
 * shared by `@element-editor/adapter-leaflet`, `@element-editor/adapter-maplibre`, and
 * `@element-editor/react`.
 *
 * Owns:
 *   - prop → store sync (readonly / tools / maxFeatures / layout; network-disabled tools)
 *   - one-time mounts (initialData, schema)
 *   - data-change subscription (onChange / per-feature callbacks / selection)
 *   - onZoomChange + onFeatureSelect subscriptions
 *   - the FC-shaped imperative API (return value — caller wires it through
 *     `useImperativeHandle`)
 *
 * Caller still owns: bounds / maxBounds (different APIs across map libs),
 * the map-bridge wiring, the layer tree, and any wrapper-only concerns
 * (slots, tile layer, theme persistence, dev affordances).
 */

export interface ImportResult {
  /** Features skipped due to unsupported geometry type. */
  skipped: number
  /** Features skipped because their id collided with an existing feature. */
  duplicates: number
  /** True if the import was capped by `maxFeatures` / internal safety limits. */
  truncated: boolean
  /** Features skipped because their geometry type isn't in `geometryTypes` (0 when it isn't set). */
  refused: number
}

/**
 * Options of the ref's data-changing methods (`addFeature`, `updateFeature(s)`, `removeFeatures`).
 */
export interface MutationOptions {
  /**
   * Default `true`: the change is one undo step, like the same edit made by the user.
   * `false` (e.g. applying a change from your server): no undo step, and the change is also
   * applied to every undo/redo snapshot, so undoing an earlier user edit doesn't revert it.
   */
  undoable?: boolean
}

/** Options of `ref.setFeatureCollection`. */
export interface SetFeatureCollectionOptions {
  /**
   * Default `false`: the load fires `onChange` (and `onFeatureAdd` / `onFeatureUpdate` /
   * `onFeatureDelete`) like any other change. `true`: those callbacks don't fire for this load,
   * so data you just fetched from your backend isn't saved straight back. `onSelectionChange`
   * still fires when the load clears a selection.
   */
  silent?: boolean
  /**
   * Default `true`: the load is one undo step (undo restores the previous data). `false`: no undo
   * step, and the undo/redo history is cleared, so the user can't undo back past the loaded data
   * (what `initialData` does).
   */
  undoable?: boolean
}

/** What `ref.validate()` returns. */
export interface ValidationReport {
  /** `true` when no feature has a validation error. */
  valid: boolean
  /**
   * Error messages per feature id, only for features that have errors (e.g.
   * `'Missing required property: Owner'`): the same object `onValidationError` receives.
   */
  errors: Record<string, string[]>
}

/**
 * Imperative handle of `<ElementEditor ref>` and both adapters' `<ElementEditorControls ref>`.
 * Coordinates are GeoJSON order, `[lng, lat]`, unless a method says otherwise.
 * Map methods (`flyTo`, `setZoom`, `fitBounds`, `select`'s `fit`) do nothing until the map has mounted.
 *
 * Data-changing methods go through the same store actions as the UI: `maxFeatures`, schema
 * validation, undo and the `onChange` / `onFeature*` / `onSelectionChange` callbacks behave as
 * for the user's own edits (callbacks fire synchronously, before the method returns). They work
 * in `readonly` mode too (the host app is in charge); only `setTool` is refused there.
 *
 * `TMap` is the engine's map type: `maplibregl.Map` on `@element-editor/react` and
 * `@element-editor/adapter-maplibre`, `L.Map` on `@element-editor/react/leaflet` and
 * `@element-editor/adapter-leaflet`.
 */
export interface ElementEditorImperativeAPI<TMap = unknown> {
  /**
   * Snapshot of the current data as a FeatureCollection: every feature (hidden ones included,
   * internal validation state stripped) plus `metadata.schemas` / `metadata.groups`.
   */
  getFeatureCollection: () => FeatureCollection
  /**
   * One feature by id, as `getFeatureCollection()` would return it (hidden features included), or
   * `null` for an unknown id.
   */
  getFeature: (id: string) => GeoJSONFeature | null
  /**
   * Replaces all data with `data` (like `importGeoJSON(data, 'replace')`). Plain GeoJSON is fine:
   * missing ids get UUIDs, no `metadata` means the default schema. Features without a usable
   * geometry (`geometry: null`, unknown types) are skipped and reported through `onError` /
   * the `error` event.
   *
   * By default this fires `onChange` (and `onFeatureAdd` / `onFeatureDelete`) like any change and is
   * one undo step. When you load data from your backend and save it in `onChange`, pass
   * `{ silent: true }` so the load isn't saved straight back (see `SetFeatureCollectionOptions`).
   *
   * ```ts
   * const fc = await (await fetch('/api/map')).json()
   * ref.current?.setFeatureCollection(fc, { silent: true, undoable: false })
   * ```
   */
  setFeatureCollection: (data: FeatureCollectionInput, options?: SetFeatureCollectionOptions) => void
  /** The current data serialised as a GeoJSON string (what "Export" downloads). */
  exportGeoJSON: () => string
  /** Triggers a browser download of the current data. Only `'geojson'` is supported. */
  exportAs: (format: 'geojson') => void
  /**
   * Imports a FeatureCollection (or anything parseable as one). `'replace'` (default) swaps the
   * data, `'merge'` appends. It is one undo step (undo restores the previous features, schemas and
   * groups; no file backup). Returns counts of skipped (unsupported
   * geometry) / duplicate (repeated id) / refused (type not in `geometryTypes`) features and whether
   * the import was truncated (`maxFeatures` or the internal 50,000-feature limit).
   */
  importGeoJSON: (raw: FeatureCollectionInput | unknown, mode?: 'replace' | 'merge') => ImportResult
  /**
   * Updates many features in one commit: one store update, one `onChange`, and `onFeatureUpdate`
   * once per feature whose geometry or properties changed. Each `patch` may set `properties`
   * (replaces the whole object), `geometry`, `schemaId` or `hidden`; features are re-validated
   * against their schema. The batch is one undo step (see `MutationOptions.undoable`). Unknown ids
   * and malformed patches are skipped (with a development warning).
   *
   * ```ts
   * ref.current.updateFeatures(ids.map((id) => ({ id, patch: { properties: { ...props(id), status: 'done' } } })))
   * ```
   */
  updateFeatures: (updates: ReadonlyArray<{ id: string; patch: FeaturePatch }>, options?: MutationOptions) => void
  /**
   * Adds a feature and returns it as stored (with its `id`; a missing id gets a UUID), or `null`
   * when nothing was added: the geometry isn't valid GeoJSON, the id is already used (both warn
   * in development), or `maxFeatures` is reached (reported like a user add). The feature goes on
   * top of the layer list; the selection is left alone. `groupId` is kept only if that group exists.
   * Fires `onFeatureAdd` and `onChange`.
   */
  addFeature: (feature: GeoJSONFeatureInput, options?: MutationOptions) => GeoJSONFeature | null
  /**
   * Updates one feature. `patch` may set `properties` (replaces the whole object), `geometry`,
   * `schemaId` or `hidden`; other keys are ignored. The feature is re-validated against its schema
   * (schema errors don't block the write). Returns `false`, changing nothing, for an unknown id or
   * a malformed patch (both warn in development). Fires `onFeatureUpdate` and `onChange`.
   */
  updateFeature: (id: string, patch: FeaturePatch, options?: MutationOptions) => boolean
  /**
   * Removes the features with these ids in one undo step and returns how many were removed
   * (unknown ids are skipped, with a development warning). Removed ids leave the selection.
   * Fires `onFeatureDelete` per feature and `onChange` once.
   */
  removeFeatures: (ids: string[], options?: MutationOptions) => number
  /** Ids of the selected features (a copy). */
  getSelection: () => string[]
  /**
   * Replaces the selection with these features (`[]` clears it) and fires `onSelectionChange`.
   * Unknown ids, group ids and hidden features (or features in a hidden group) are left out, with a
   * development warning. `fit: true` also fits the map to the selected features.
   */
  select: (ids: string[], options?: { fit?: boolean }) => void
  /**
   * Turns a drawing tool on, as its toolbar button does (an unfinished shape of another tool is
   * discarded); `null` turns the active tool off. Returns `false`, changing nothing, when the tool
   * isn't available: unknown or `'search'`, left out by `tools`, `maxFeatures` reached (tools that
   * add features), or `readonly` (every tool but `'measure'`, which the readonly toolbar keeps).
   */
  setTool: (tool: DrawTool | null) => boolean
  /**
   * The drawing tool that is on (as `setTool` takes it), or `null` when none is. Shape operations
   * (cut, slice, simplify, smooth, buffer) aren't tools: `null` while they run.
   */
  getTool: () => DrawTool | null
  /**
   * Puts a feature in point editing (vertex edit), as double-click or Enter does: it selects the
   * feature (like `select([id])`), turns off a drawing tool that is on, shows its point handles and,
   * for a drawn circle / rectangle / route, the one-line notice. `null` leaves point editing (the
   * selection is kept). Returns `false`, changing nothing, for an unknown or hidden feature, a
   * geometry other than a LineString or Polygon, or in `readonly` mode (each warns in development).
   * The id already in point editing returns `true` and changes nothing.
   *
   * ```ts
   * ref.current?.setVertexEdit(record.featureId) // the shape is editable straight away
   * ```
   */
  setVertexEdit: (id: string | null) => boolean
  /** Id of the feature in point editing (vertex edit), or `null`. */
  getVertexEdit: () => string | null
  /** `true` when `undo()` would change something (there is an edit to undo). */
  canUndo: () => boolean
  /** `true` when `redo()` would change something (there is an undone edit to redo). */
  canRedo: () => boolean
  /**
   * Validates every feature against its schema (required fields, number `min` / `max`) and its
   * geometry (zero-area polygons), and returns the result. Changes nothing and calls no callback:
   * use it to check before your own save, or to show errors. `submit()` runs the same check.
   *
   * ```ts
   * const { valid, errors } = ref.current!.validate()
   * if (!valid) ref.current!.select(Object.keys(errors), { fit: true })
   * ```
   */
  validate: () => ValidationReport
  /**
   * The underlying map: `maplibregl.Map` or `L.Map` (see `TMap`), or `null` until the map has
   * mounted (the MapLibre drop-in creates it once its basemap style has loaded).
   *
   * On a MapLibre map, switch basemaps with the `basemap` prop or `setBasemap`: they keep your
   * layers. After your own `map.setStyle()` Element restores its own layers; re-add yours on `style.load`.
   */
  getMap: () => TMap | null
  /**
   * Animates the map to a centre and zoom.
   *
   * - `flyTo({ center: [lng, lat], zoom? })` — preferred; GeoJSON order. Zoom defaults to 15.
   * - `flyTo([lat, lng], zoom?)` — deprecated `[lat, lng]` tuple form; still works, warns once
   *   in development.
   */
  flyTo: {
    (options: FlyToOptions): void
    /** @deprecated `[lat, lng]` order. Use `flyTo({ center: [lng, lat], zoom })`. */
    (latlng: [number, number], zoom?: number): void
  }
  /**
   * Sets the zoom immediately (no animation), clamped to the map's min/max zoom.
   * Returns `false` when the map is not mounted yet (nothing happened), `true` otherwise.
   */
  setZoom: (zoom: number) => boolean
  /**
   * Animates the map to fit a box, with padding, never zooming in past 16. Accepts:
   *
   * - a GeoJSON bbox `[minLng, minLat, maxLng, maxLat]` (= `[west, south, east, north]`), or
   * - an array of `[lng, lat]` points (fits their bounding box).
   *
   * Empty input or input without finite coordinates is ignored.
   */
  fitBounds: (target: [number, number][] | [number, number, number, number]) => void
  /**
   * Validates every feature (as `validate()` does), then submits. Returns `false` if any feature
   * has validation errors: `onValidationError` is called with them (keyed by feature id) and
   * `onSubmit` is not. Returns `true` when the data is valid: `onSubmit` (if set) is called
   * with the current FeatureCollection.
   */
  submit: () => boolean
  /** Undoes the last edit (no-op when there is nothing to undo; see `canUndo`). */
  undo: () => void
  /** Redoes the last undone edit (no-op when there is nothing to redo; see `canRedo`). */
  redo: () => void
  /** Deselects all features. */
  clearSelection: () => void
}

export interface UseAdapterControlsOptions {
  /**
   * Plain GeoJSON is fine (see `FeatureCollectionInput`); a single Feature is wrapped in a collection.
   * Applied on mount. A value that arrives later (`null` / `undefined` → data, e.g. after a fetch) is
   * applied once too, if the editor is still empty and unedited; any other change is ignored, with a
   * development warning.
   */
  initialData?: FeatureCollectionInput | GeoJSONFeatureInput | null
  schema?: Schema
  layout?: 'panel' | 'minimal' | 'split'
  readonly?: boolean
  tools?: DrawTool[] | null
  maxFeatures?: number
  /** With `maxFeatures: 1`: a draw tool replaces the only feature's geometry instead of being refused. */
  replaceAtLimit?: boolean
  /**
   * The geometry types the editor accepts (`undefined` = all). Enforced for every way a geometry gets
   * in; a refusal reports `'geometry-type-not-allowed'` and changes nothing. Tools that can't draw an
   * allowed type are left out.
   */
  geometryTypes?: GeometryType[]
  /** Opt-in clean-up of committed coordinates (see `ElementEditorProps.coordinates`). */
  coordinates?: CoordinateOptions
  /**
   * The map engine; the adapters pass it. With it, the tools `config.network` turns off are
   * synced to `uiStore.unavailableTools` (the Picker needs Overpass only on Leaflet).
   */
  engine?: 'leaflet' | 'maplibre'
  onChange?: (data: FeatureCollection) => void
  onSubmit?: (data: FeatureCollection) => void
  onValidationError?: (errors: Record<string, string[]>) => void
  onFeatureAdd?: (feature: GeoJSONFeature) => void
  onFeatureUpdate?: (id: string, feature: GeoJSONFeature) => void
  onFeatureDelete?: (id: string) => void
  onSelectionChange?: (ids: string[]) => void
  onFeatureSelect?: (feature: GeoJSONFeature | null) => void
  onZoomChange?: (zoom: number) => void
  /** Called with the tool that turned on (as `ref.getTool()` reports it), or `null` when it turned off. */
  onToolChange?: (tool: DrawTool | null) => void
  /**
   * Called with the id of the feature that entered point editing (vertex edit), or `null` when
   * point editing ended, whether the user (double-click, Enter, Esc, deselect, delete, undo) or
   * your app (`ref.setVertexEdit`) changed it.
   */
  onVertexEditChange?: (id: string | null) => void
  /**
   * @internal Called after `initialData` was applied: `late` is true for data that arrived after
   * mount. The drop-in uses it to fit the late data.
   */
  onInitialDataApplied?: (data: FeatureCollectionInput, late: boolean) => void
}

/**
 * Push a prop into a store. On mount it runs during render, so the first
 * paint already has it (nothing else subscribes yet). Later changes go
 * through a layout effect: a store update while rendering would re-render
 * other subscribers mid-render, which React warns about ("Cannot update a
 * component while rendering a different component").
 * Omitted on mount → the store keeps its value (defaults match the store's).
 */
/** Equal values, or arrays with equal items: an inline `tools={[…]}` is a new array every render. */
const sameProp = (a: unknown, b: unknown) =>
  Object.is(a, b) || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i])))

/** The tools `network` turns off: no routing → Route, no geocoder → search, no Overpass → Picker on Leaflet (MapLibre still picks from the vector tiles). */
export function networkUnavailableTools(network: { routing?: unknown; nominatim?: unknown; overpass?: unknown }, engine: 'leaflet' | 'maplibre'): string[] {
  return [
    ...(network.routing === false ? ['route'] : []),
    ...(network.nominatim === false ? ['search'] : []),
    ...(network.overpass === false && engine === 'leaflet' ? ['picker'] : []),
  ]
}

function useSyncProp<T>(value: T, setter: (v: T) => void, current: () => unknown) {
  const prev = useRef<{ has: boolean; value: T }>({ has: false, value })
  if (!prev.current.has) {
    prev.current = { has: true, value }
    // An omitted prop leaves the store alone: <ElementEditor> and the adapter
    // controls it mounts share one store, and the adapter (which gets fewer
    // props) must not reset what the wrapper set (e.g. layout="split").
    // Nor does a value the store already holds: the adapter controls mount
    // (inside the map) after the wrapper synced the same props, and a no-op
    // store write mid-render still pings every subscriber (React warns when
    // one of them has an update pending).
    if (value !== undefined && !sameProp(current(), value)) setter(value)
  }
  useLayoutEffect(() => {
    if (!sameProp(prev.current.value, value)) {
      prev.current = { has: true, value }
      setter(value)
    }
  })
}

const PATCH_KEYS = ['properties', 'geometry', 'schemaId', 'hidden'] as const

/** The patchable keys of `patch` (anything else, like `id`, is dropped), or null (warned) when malformed. */
function cleanPatch(patch: unknown, method: string): FeaturePatch | null {
  const p = patch as Record<string, unknown> | null
  if (!p || typeof p !== 'object') {
    warnOnce(`ref-${method}-patch`, `${method}: a patch must be an object; it was skipped.`)
    return null
  }
  const out: Record<string, unknown> = {}
  for (const k of PATCH_KEYS) if (p[k] !== undefined) out[k] = p[k]
  if (out.geometry !== undefined && !isGeometry(out.geometry)) {
    warnOnce(`ref-${method}-geometry`, `${method}: patch.geometry is not a valid GeoJSON geometry; the patch was skipped.`)
    return null
  }
  if (out.properties !== undefined && (typeof out.properties !== 'object' || out.properties === null || Array.isArray(out.properties))) {
    warnOnce(`ref-${method}-properties`, `${method}: patch.properties must be an object; the patch was skipped.`)
    return null
  }
  return out as FeaturePatch
}

function warnUnknownIds(method: string, ids: string[]) {
  warnOnce(`ref-${method}-unknown`, `${method}: no feature with id ${ids.slice(0, 3).map((id) => JSON.stringify(id)).join(', ')}${ids.length > 3 ? ', …' : ''}; skipped.`)
}

function stripValidation(f: GeoJSONFeature): GeoJSONFeature {
  const { _validation, ...clean } = f
  return clean as GeoJSONFeature
}

/** `ref.select`: the selectable ids (known, not hidden, not in a hidden group), deduped, in the given order. */
function selectableIds(state: DataStore, ids: string[]): { keep: GeoJSONFeature[]; dropped: string[] } {
  const byId = new Map(state.features.map((f) => [f.id, f]))
  const hiddenGroups = new Set(state.groups.filter((g) => g.hidden).map((g) => g.id))
  const keep: GeoJSONFeature[] = []
  const dropped: string[] = []
  for (const id of new Set(ids)) {
    const f = byId.get(id)
    if (f && !f.hidden && !(f.groupId && hiddenGroups.has(f.groupId))) keep.push(f)
    else dropped.push(id)
  }
  return { keep, dropped }
}

/** A single Feature wrapped in a collection; anything else as is (importGeoJSON validates it). */
function asCollection(raw: unknown): FeatureCollectionInput {
  const r = raw as { type?: unknown } | null
  return (r?.type === 'Feature' ? { type: 'FeatureCollection', features: [r] } : r) as FeatureCollectionInput
}

/** Editing mode → the tool that turns it on (modes no tool turns on, like cut-hole, are left out). */
const MODE_TOOL = Object.fromEntries(Object.entries(TOOL_MODES).map(([tool, mode]) => [mode, tool])) as Partial<Record<EditingMode, DrawTool>>
const toolOf = (mode: EditingMode): DrawTool | null => MODE_TOOL[mode] ?? null

/**
 * Validation errors per feature id (features without errors left out), checked fresh against each
 * feature's schema: imported features carry no cached `_validation`, so it can't be trusted.
 */
function validationErrors(state: DataStore): Record<string, string[]> {
  const schemas = new Map(state.schemas.map((s) => [s.id, s]))
  const fallback = state.schemas[0] ?? state.getDefaultSchema()
  const errors: Record<string, string[]> = {}
  for (const f of state.features) {
    const schema = (f.schemaId && schemas.get(f.schemaId)) || fallback
    const result = validateFeature(f, schema).errors
    if (result.length > 0) errors[f.id] = result
  }
  return errors
}

/** A feature collection Element hands back: `_validation` stripped. */
function snapshot(state: DataStore): FeatureCollection {
  return {
    type: 'FeatureCollection',
    metadata: { schemas: state.schemas, groups: state.groups },
    features: state.features.map(stripValidation),
  }
}

/** Nothing loaded and nothing edited yet: no features and no undo/redo history. */
const isPristine = (s: DataStore) => s.features.length === 0 && s.undoStack.length === 0 && s.redoStack.length === 0

/**
 * Probably the same data again, so a change isn't worth a warning: the same object, or one whose
 * features have the same ids in the same order (an inline `{ type, features }` wrapper, or
 * `JSON.parse(saved)` on every render).
 */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const fa = (a as { features?: unknown } | null)?.features
  const fb = (b as { features?: unknown } | null)?.features
  if (!Array.isArray(fa) || !Array.isArray(fb)) return false
  return fa === fb || (fa.length === fb.length && fa.every((f, i) => f?.id === fb[i]?.id))
}

export function useAdapterControls<TMap = unknown>(opts: UseAdapterControlsOptions): ElementEditorImperativeAPI<TMap> {
  const {
    initialData,
    schema,
    onChange,
    onSubmit,
    onValidationError,
    onFeatureAdd,
    onFeatureUpdate,
    onFeatureDelete,
    onSelectionChange,
    onFeatureSelect,
    onZoomChange,
    onToolChange,
    onVertexEditChange,
  } = opts

  const { dataStore, uiStore } = useGeoStore()
  const setReadonly = useUIStore((s) => s.setReadonly)
  const setEnabledTools = useUIStore((s) => s.setEnabledTools)
  const setMaxFeatures = useDataStore((s) => s.setMaxFeatures)
  const setGeometryTypes = useDataStore((s) => s.setGeometryTypes)
  const setCoordinateOptions = useDataStore((s) => s.setCoordinateOptions)
  const setLayout = useUIStore((s) => s.setLayout)
  const setUnavailableTools = useUIStore((s) => s.setUnavailableTools)
  const { network } = useElementEditorConfig()

  const mapController = useMapController()
  const mapControllerRef = useRef(mapController)
  mapControllerRef.current = mapController

  // Granular data-change callbacks (already factored). While `silent` is set (a
  // `setFeatureCollection(…, { silent: true })` load, which notifies synchronously inside the
  // store update) only the selection callback goes through.
  const silentRef = useRef(false)
  const callbacksRef = useRef<DataChangeCallbacks>({})
  callbacksRef.current = { onChange, onFeatureAdd, onFeatureUpdate, onFeatureDelete, onSelectionChange }
  useEffect(() => subscribeToDataChanges(dataStore, () => (
    silentRef.current ? { onSelectionChange: callbacksRef.current.onSelectionChange } : callbacksRef.current
  )), [dataStore])

  // Prop → store sync during render.
  useSyncProp(opts.readonly, (v) => setReadonly(v ?? false), () => uiStore.getState().readonly)
  useSyncProp(opts.tools, (v) => setEnabledTools(v ?? null), () => uiStore.getState().enabledTools)
  useSyncProp(opts.maxFeatures, setMaxFeatures, () => dataStore.getState().maxFeatures)
  useSyncProp(opts.geometryTypes, setGeometryTypes, () => dataStore.getState().geometryTypes)
  useSyncProp(opts.replaceAtLimit, (v) => dataStore.getState().setReplaceAtLimit(v ?? false), () => dataStore.getState().replaceAtLimit)
  if (opts.replaceAtLimit && opts.maxFeatures !== 1) warnOnce('replaceAtLimit-max', '`replaceAtLimit` only works with `maxFeatures={1}`; it is ignored.')
  // Before initialData loads (effects), so the first commit is already clean; an inline object is fine (the setter compares values).
  useSyncProp(opts.coordinates, setCoordinateOptions, () => dataStore.getState().coordinates)
  useSyncProp(opts.layout, (v) => setLayout(v ?? 'panel'), () => uiStore.getState().layout)
  useSyncProp(opts.engine && networkUnavailableTools(network, opts.engine), (v) => setUnavailableTools(v ?? []), () => uiStore.getState().unavailableTools)

  // Schema — append once on mount (and on subsequent prop changes if id is new).
  // Idempotent by `schema.id` so the same object passed across renders is a no-op.
  useEffect(() => {
    if (!schema) return
    dataStore.setState((s) => {
      if (s.schemas.find((ex) => ex.id === schema.id)) return s
      return { schemas: [...s.schemas, schema] }
    })
  }, [schema, dataStore])

  /** Features skipped by a load whose result the caller never sees (`initialData`, `setFeatureCollection`). */
  const reportSkipped = (what: string, skipped: number) => {
    if (skipped === 0) return
    uiStore.getState().reportError(new ElementEditorError('invalid-data', 'import',
      `${skipped} feature${skipped === 1 ? '' : 's'} in ${what} had no usable geometry (null or an unknown type) and ${skipped === 1 ? 'was' : 'were'} left out.`))
  }

  // initialData: the starting data, applied on mount, and once more when it arrives late (the
  // usual fetch → setState → initialData={data}) while the editor is still empty and unedited.
  // Any other change is ignored (warned): replacing data is `setFeatureCollection` or a `key` remount.
  // Bad input must not throw out of the effect — the error boundary would replace the whole
  // editor. Report it through the store's error sink (which reaches `onEvent` / the instance
  // toaster) and keep running empty.
  const loadedRef = useRef(false) // initialData with features was applied
  const prevInitialRef = useRef(initialData)
  const onAppliedRef = useRef(opts.onInitialDataApplied)
  onAppliedRef.current = opts.onInitialDataApplied
  const applyInitialData = (data: FeatureCollectionInput | GeoJSONFeatureInput, late: boolean) => {
    const fc = asCollection(data)
    // The starting state, not an edit: no undo step, and no onChange / onFeature* (the host
    // already has this data; saving it straight back would be a spurious write).
    silentRef.current = true
    try {
      const { skipped } = dataStore.getState().importGeoJSON(fc, 'replace', { undoable: false })
      silentRef.current = false
      reportSkipped('initialData', skipped)
      loadedRef.current = dataStore.getState().features.length > 0
      onAppliedRef.current?.(fc, late)
    } catch (err) {
      const message = `initialData is not a valid FeatureCollection (${err instanceof Error ? err.message : String(err)}). The editor started empty.`
      console.error(`[element-editor] ${message}`)
      uiStore.getState().reportError(new ElementEditorError('invalid-data', 'import', message, { cause: err }))
    } finally {
      silentRef.current = false
    }
  }
  useEffect(() => {
    if (initialData) applyInitialData(initialData, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const prev = prevInitialRef.current
    if (sameData(prev, initialData)) return
    prevInitialRef.current = initialData
    if (!initialData && !loadedRef.current) return // back to "loading": nothing was applied anyway
    // Late data: nothing loaded yet (no data, or an empty placeholder collection) and no edits.
    if (initialData && !loadedRef.current && isPristine(dataStore.getState())) {
      applyInitialData(initialData, true)
      return
    }
    const afterLoad = loadedRef.current || !initialData
    warnOnce(afterLoad ? 'initialData-changed' : 'initialData-after-edit', afterLoad
      ? '`initialData` changed after the editor loaded its data; the change was ignored (`initialData` is the starting data). '
        + 'To replace the data, call `ref.current.setFeatureCollection(data, { silent: true })`, or remount the editor with a new `key` (e.g. key={projectId}).'
      : '`initialData` arrived after the user started editing; it was ignored so their edits are kept. '
        + 'Render the editor once the data is there, call `ref.current.setFeatureCollection(data, { silent: true })`, or remount it with a new `key`.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData])

  // Latest-callback refs so subscriptions don't tear down and re-subscribe on
  // every parent render that passes a fresh inline callback identity. The
  // imperative-API methods (`submit`) also read through these refs so the API
  // itself stays stable-by-identity across renders.
  const onSubmitRef = useRef(onSubmit)
  const onValidationErrorRef = useRef(onValidationError)
  const onZoomChangeRef = useRef(onZoomChange)
  const onFeatureSelectRef = useRef(onFeatureSelect)
  useEffect(() => { onSubmitRef.current = onSubmit }, [onSubmit])
  useEffect(() => { onValidationErrorRef.current = onValidationError }, [onValidationError])
  useEffect(() => { onZoomChangeRef.current = onZoomChange }, [onZoomChange])
  useEffect(() => { onFeatureSelectRef.current = onFeatureSelect }, [onFeatureSelect])

  // onZoomChange — fire when dataStore.currentZoom changes (each adapter's
  // MapBridge writes to currentZoom on `zoomend`).
  useEffect(() => {
    return dataStore.subscribe((state, prev) => {
      if (state.currentZoom !== prev.currentZoom) onZoomChangeRef.current?.(state.currentZoom)
    })
  }, [dataStore])

  // onFeatureSelect — fire when the single-selected feature changes by id OR
  // by reference (content change → new ref via immutable updates). Uses
  // zustand's `prev` arg instead of a closure-local sentinel so re-subscribing
  // would trigger spurious fires — we ref-latch the callback so we never need
  // to re-subscribe on identity changes.
  useEffect(() => {
    return dataStore.subscribe((state, prev) => {
      const cb = onFeatureSelectRef.current
      if (!cb) return
      const newId = state.selectedIds.length === 1 ? state.selectedIds[0] : null
      const oldId = prev.selectedIds.length === 1 ? prev.selectedIds[0] : null
      const newF = newId ? state.features.find((f) => f.id === newId) ?? null : null
      const oldF = oldId ? prev.features.find((f) => f.id === oldId) ?? null : null
      if (newF === oldF) return
      cb(newF)
    })
  }, [dataStore])

  // onToolChange — fire when the tool derived from uiStore.editingMode changes.
  const onToolChangeRef = useRef(onToolChange)
  onToolChangeRef.current = onToolChange
  useEffect(() => {
    return uiStore.subscribe((state, prev) => {
      if (state.editingMode === prev.editingMode) return
      const tool = toolOf(state.editingMode)
      if (tool !== toolOf(prev.editingMode)) onToolChangeRef.current?.(tool)
    })
  }, [uiStore])

  // onVertexEditChange — fire when the feature in vertex edit changes (the store is the source of truth).
  const onVertexEditChangeRef = useRef(onVertexEditChange)
  onVertexEditChangeRef.current = onVertexEditChange
  useEffect(() => {
    return uiStore.subscribe((state, prev) => {
      if (state.vertexEditFeatureId !== prev.vertexEditFeatureId) onVertexEditChangeRef.current?.(state.vertexEditFeatureId)
    })
  }, [uiStore])

  // Imperative API — stable across renders. Only `dataStore` is in deps because
  // every other dynamic dependency is read via a ref.
  const api = useMemo<ElementEditorImperativeAPI<TMap>>(() => ({
    getFeatureCollection: () => snapshot(dataStore.getState()),
    getFeature: (id) => {
      const f = dataStore.getState().features.find((x) => x.id === id)
      return f ? stripValidation(f) : null
    },
    setFeatureCollection: (data, options) => {
      silentRef.current = !!options?.silent
      try {
        const { skipped } = dataStore.getState().importGeoJSON(data, 'replace', { undoable: options?.undoable !== false })
        reportSkipped('the data passed to setFeatureCollection', skipped)
      } finally {
        silentRef.current = false
      }
    },
    exportGeoJSON: () => dataStore.getState().exportGeoJSON(),
    exportAs: (format) => {
      if (format !== 'geojson') return
      triggerGeoJSONDownload(dataStore.getState().exportGeoJSON())
    },
    importGeoJSON: (raw, mode = 'replace') => dataStore.getState().importGeoJSON(raw, mode),
    updateFeatures: (updates, options) => {
      if (!Array.isArray(updates)) { warnOnce('ref-updateFeatures-array', 'updateFeatures: expected an array of { id, patch }.'); return }
      const ds = dataStore.getState()
      const known = new Set(ds.features.map((f) => f.id))
      const clean: { id: string; patch: FeaturePatch }[] = []
      const unknown: string[] = []
      for (const u of updates) {
        const patch = cleanPatch(u?.patch, 'updateFeatures')
        if (!patch) continue
        if (!known.has(u.id)) { unknown.push(String(u.id)); continue }
        clean.push({ id: u.id, patch })
      }
      if (unknown.length) warnUnknownIds('updateFeatures', unknown)
      if (clean.length) ds.updateFeatures(clean, { undoable: options?.undoable ?? true })
    },
    addFeature: (feature, options) => {
      const f = feature as Partial<GeoJSONFeature> | null
      if (!f || typeof f !== 'object' || !isGeometry(f.geometry)) {
        warnOnce('ref-addFeature-geometry', 'addFeature: the feature needs a valid GeoJSON geometry; nothing was added.')
        return null
      }
      const ds = dataStore.getState()
      const id = f.id !== undefined && f.id !== null && String(f.id) !== '' ? String(f.id) : crypto.randomUUID()
      if (ds.features.some((x) => x.id === id)) {
        warnOnce('ref-addFeature-duplicate', `addFeature: a feature with id ${JSON.stringify(id)} already exists; nothing was added.`)
        return null
      }
      const { _validation, bbox, ...rest } = f
      const stored = ds.addFeature(
        { ...rest, type: 'Feature', id, properties: f.properties ?? {} } as GeoJSONFeature,
        { programmatic: true, undoable: options?.undoable },
      )
      return stored && stripValidation(stored)
    },
    updateFeature: (id, patch, options) => {
      const clean = cleanPatch(patch, 'updateFeature')
      if (!clean) return false
      const ds = dataStore.getState()
      if (!ds.features.some((f) => f.id === id)) { warnUnknownIds('updateFeature', [String(id)]); return false }
      return ds.updateFeatures([{ id, patch: clean }], { undoable: options?.undoable ?? true })
    },
    removeFeatures: (ids, options) => {
      if (!Array.isArray(ids)) { warnOnce('ref-removeFeatures-array', 'removeFeatures: expected an array of ids.'); return 0 }
      const ds = dataStore.getState()
      const known = new Set(ds.features.map((f) => f.id))
      const unknown = ids.filter((id) => !known.has(id))
      if (unknown.length) warnUnknownIds('removeFeatures', unknown.map(String))
      return ds.deleteFeatures(ids, { undoable: options?.undoable })
    },
    getSelection: () => [...dataStore.getState().selectedIds],
    select: (ids, options) => {
      if (!Array.isArray(ids)) { warnOnce('ref-select-array', 'select: expected an array of feature ids.'); return }
      const ds = dataStore.getState()
      const { keep, dropped } = selectableIds(ds, ids)
      if (dropped.length) {
        warnOnce('ref-select-dropped', `select: left out ${dropped.slice(0, 3).map((id) => JSON.stringify(id)).join(', ')}${dropped.length > 3 ? ', …' : ''}: unknown ids or hidden features (a group id isn't selectable; select its features).`)
      }
      // One feature goes through selectFeature, like a click (it also sets the group new shapes land in).
      if (keep.length === 0) ds.clearSelection()
      else if (keep.length === 1) ds.selectFeature(keep[0].id)
      else ds.setSelection(keep.map((f) => f.id))
      if (options?.fit && keep.length > 0) {
        const bbox = getFeatureCollectionBBox({ type: 'FeatureCollection', features: keep } as FeatureCollection)
        if (bbox) mapControllerRef.current.fitBounds?.(bbox)
      }
    },
    setTool: (tool) => {
      const us = uiStore.getState()
      if (tool === null) { us.setEditingMode('none'); return true }
      const mode = tool !== 'search' && Object.prototype.hasOwnProperty.call(TOOL_MODES, tool)
        ? TOOL_MODES[tool as keyof typeof TOOL_MODES]
        : null
      if (!mode) {
        warnOnce(`ref-setTool-${String(tool)}`, `setTool: ${JSON.stringify(tool)} is not a drawing tool${tool === 'search' ? ' (search is a box in the toolbar, not a tool)' : ''}.`)
        return false
      }
      if (us.readonly && tool !== 'measure') {
        warnOnce('ref-setTool-readonly', `setTool(${JSON.stringify(tool)}): the editor is readonly; only 'measure' is available.`)
        return false
      }
      if (!us.isToolAvailable(tool)) {
        warnOnce(`ref-setTool-disabled-${tool}`, `setTool: ${JSON.stringify(tool)} is not available: it is not in the \`tools\` list${us.unavailableTools.includes(tool) ? ' (config.network turns it off)' : ''}, or \`geometryTypes\` allows none of the shapes it draws.`)
        return false
      }
      if (us.editingMode === mode) return true // already on: keep the shape in progress
      // Like the toolbar: a tool that adds features won't turn on at maxFeatures (canAddFeatures reports it).
      if (tool !== 'measure' && !dataStore.getState().canDraw()) return false
      us.setEditingMode(mode)
      return true
    },
    getTool: () => toolOf(uiStore.getState().editingMode),
    setVertexEdit: (id) => {
      const us = uiStore.getState()
      if (id === null) { us.setVertexEditFeature(null); return true }
      if (us.readonly) {
        warnOnce('ref-setVertexEdit-readonly', 'setVertexEdit: the editor is readonly; points can\'t be edited.')
        return false
      }
      const ds = dataStore.getState()
      const { keep } = selectableIds(ds, [id])
      const feature = keep[0]
      if (!feature) {
        warnOnce('ref-setVertexEdit-unknown', `setVertexEdit: no visible feature with id ${JSON.stringify(id)}; nothing changed.`)
        return false
      }
      if (!canVertexEdit(feature)) {
        warnOnce('ref-setVertexEdit-geometry', `setVertexEdit: a ${feature.geometry.type} has no points to edit (only a LineString or Polygon has); nothing changed.`)
        return false
      }
      if (us.vertexEditFeatureId === id && ds.selectedIds.length === 1 && ds.selectedIds[0] === id) return true
      if (us.editingMode !== 'none') us.setEditingMode('none')
      if (us.transformActive) us.setTransformActive(false)
      if (!(ds.selectedIds.length === 1 && ds.selectedIds[0] === id)) ds.selectFeature(id)
      us.setSelectedPartIndex(null)
      uiStore.getState().setVertexEditFeature(id)
      return true
    },
    getVertexEdit: () => uiStore.getState().vertexEditFeatureId,
    canUndo: () => dataStore.getState().undoStack.length > 0,
    canRedo: () => dataStore.getState().redoStack.length > 0,
    validate: () => {
      const errors = validationErrors(dataStore.getState())
      return { valid: Object.keys(errors).length === 0, errors }
    },
    getMap: () => (mapControllerRef.current.getMap?.() ?? null) as TMap | null,
    flyTo: (target: FlyToOptions | [number, number], zoom?: number) => {
      const t = normalizeFlyToTarget(target, zoom)
      // The internal map controller takes [lat, lng].
      if (t) mapControllerRef.current.flyTo?.([t.center[1], t.center[0]], t.zoom)
    },
    setZoom: (zoom) => {
      const setter = mapControllerRef.current.setZoom
      if (!setter) return false
      setter(zoom)
      return true
    },
    fitBounds: (target) => mapControllerRef.current.fitBounds?.(target),
    submit: () => {
      const state = dataStore.getState()
      const errors = validationErrors(state)
      if (Object.keys(errors).length > 0) {
        onValidationErrorRef.current?.(errors)
        return false
      }
      onSubmitRef.current?.(snapshot(state))
      return true
    },
    undo: () => dataStore.getState().undo(),
    redo: () => dataStore.getState().redo(),
    clearSelection: () => dataStore.getState().clearSelection(),
  }), [dataStore, uiStore])

  return api
}
