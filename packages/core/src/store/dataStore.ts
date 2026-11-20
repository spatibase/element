import { create, type StateCreator } from 'zustand'
import type { GeoJSONFeature, SchemaField, Schema, Group, DrawType } from '../types/geojson'
import { DEFAULT_SCHEMAS, BOUNDARIES_SCHEMA_ID } from '../utils/schema'
import { validateFeature } from '../utils/validation'
import { translateGeometrySpatially } from '../utils/spatial'
import { getGeometryBBox, storedBBox, withFiniteBBox } from '../utils/geojson'
import { mergeGeometries, offsetGeometry, getRefLat, getPartCount } from '../utils/multiGeometry'
import { getMercatorLatCorrectionRatio } from '../mercator'
import { readStorage, writeStorage, type PersistScope } from '../utils/persisted'
import { ElementEditorError } from '../utils/errors'
import { geometryTypeMessage, mergeResultType, breakResultTypes, type GeometryType } from '../utils/geometryTypes'
import { hasCoordinateOptions, normaliseFeatures, type CoordinateOptions } from '../utils/normaliseCoordinates'

const LAST_SCHEMA_KEY = 'elm_lastSchemaId'

/** Hard ceiling on imported features to prevent browser tab from freezing. */
const MAX_IMPORT_FEATURES = 50_000

const GEOMETRY_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']
const DRAW_TYPES: readonly DrawType[] = ['circle', 'rectangle', 'route']

/** A geometry object renderers can take: a known type with its coordinates (or member geometries). Coordinates aren't checked deeper. */
export function isGeometry(g: unknown): boolean {
  const o = g as { type?: unknown; coordinates?: unknown; geometries?: unknown } | null
  if (!o || typeof o !== 'object' || !GEOMETRY_TYPES.includes(o.type as string)) return false
  return o.type === 'GeometryCollection' ? Array.isArray(o.geometries) && o.geometries.every(isGeometry) : Array.isArray(o.coordinates)
}

/** What `updateFeature` / `updateFeatures` may change on a feature. */
export type FeaturePatch = Partial<Pick<GeoJSONFeature, 'properties' | 'geometry' | 'schemaId' | 'hidden'>>
/** What the store's update actions take: a `FeaturePatch`, plus `_drawType: undefined` to clear it (see `freeGeometry`). */
export type StoreFeaturePatch = FeaturePatch & { _drawType?: undefined }

/**
 * Patch for a geometry produced by an operation that doesn't keep the drawn shape's constraints
 * (boolean ops, cut hole, slice, buffer, simplify, smooth): it also clears `_drawType`, so a former
 * rectangle / circle / route edits like any polygon or line afterwards. Spread it into a whole
 * feature too (`{ ...base, ...freeGeometry(g) }`); the store drops the undefined key, and with it
 * a route's `properties._waypoints`.
 */
export function freeGeometry(geometry: GeoJSONFeature['geometry']): { geometry: GeoJSONFeature['geometry']; _drawType: undefined } {
  return { geometry, _drawType: undefined }
}

/**
 * Patch for a point edit of `feature` (move, insert or delete points, edit a point's coordinates):
 * a circle, rectangle or route stops being one in the same update (`freeGeometry`: its `_drawType`
 * goes, and a route's `properties._waypoints` with it). Other features just get the geometry.
 */
export function vertexEditPatch(feature: Pick<GeoJSONFeature, '_drawType'>, geometry: GeoJSONFeature['geometry']): StoreFeaturePatch {
  return feature._drawType ? freeGeometry(geometry) : { geometry }
}

const VERTEX_EDIT_NOTICES: Record<DrawType, string> = {
  circle: 'Editing points will turn this circle into a plain shape.',
  rectangle: 'Editing points will turn this rectangle into a plain shape.',
  route: 'Editing points will turn this route into a plain line.',
}

/**
 * The one-line notice shown on entering point editing on a drawn circle / rectangle / route
 * (what the first committed change will do, see `vertexEditPatch`); `null` for other features.
 */
export function vertexEditNotice(feature: Pick<GeoJSONFeature, '_drawType'> | undefined): string | null {
  return (feature?._drawType && VERTEX_EDIT_NOTICES[feature._drawType]) || null
}

/**
 * Whether point editing can start on this feature from code (`ref.setVertexEdit`) or by Enter /
 * double-click on both engines: a LineString or a Polygon. Multi* parts need a part picked on the
 * map first, points have nothing to edit.
 */
export function canVertexEdit(feature: Pick<GeoJSONFeature, 'geometry'> | undefined): boolean {
  const t = feature?.geometry?.type
  return t === 'LineString' || t === 'Polygon'
}

/**
 * Removes `_drawType` from `f` (a copy the caller owns), plus the route metadata that only means
 * something with it: `properties._waypoints` (the clicks the route was requested with).
 */
function dropDrawType(f: GeoJSONFeature): void {
  delete f._drawType
  if (f.properties && '_waypoints' in f.properties) {
    const { _waypoints: _dropped, ...rest } = f.properties
    f.properties = rest
  }
}

/** `prev` with `updates` applied: re-validated against its schema (unless skipped), bbox refreshed on a geometry change. */
function patchFeature(schemas: Schema[], prev: GeoJSONFeature, updates: StoreFeaturePatch, options?: { skipValidation?: boolean }): GeoJSONFeature {
  const updated = { ...prev, ...updates }
  if ('_drawType' in updates && !updates._drawType) dropDrawType(updated)
  let next = updated
  if (!options?.skipValidation) {
    const schema = schemas.find(s => s.id === updated.schemaId) || schemas[0] || DEFAULT_SCHEMAS[0]
    const { errors, warnings, fixedFeature } = validateFeature(updated, schema)
    next = fixedFeature || updated
    next._validation = { errors, warnings }
  }
  // Fast path (skipValidation, e.g. during drag): just geometry + bbox
  if (updates.geometry) next.bbox = getGeometryBBox(next.geometry)
  return next
}

/** The data keys (`schemaId`, property names) `updates` changes on `prev` — what makes an edit undoable. */
function dataKeysChanged(prev: GeoJSONFeature, updates: FeaturePatch): string[] {
  const changed: string[] = []
  if (updates.schemaId !== undefined && updates.schemaId !== prev.schemaId) changed.push('schemaId')
  if (updates.properties && updates.properties !== prev.properties) {
    const a = prev.properties ?? {}, b = updates.properties
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) changed.push(k)
  }
  return changed
}

/** One change applied to every undo/redo snapshot by `rewriteHistory`. */
export type HistoryEdit =
  | { type: 'add'; feature: GeoJSONFeature }
  | { type: 'update'; patches: ReadonlyArray<{ id: string; patch: FeaturePatch }> }
  | { type: 'remove'; ids: ReadonlySet<string> }

/**
 * `entries` with `edit` applied to each snapshot's `features`, for changes made with
 * `undoable: false` (e.g. server sync): without it, undoing an earlier user edit would restore
 * a snapshot that predates the change and silently revert it. `add` puts the feature at the top
 * (where `addFeature` puts it) of snapshots that lack its id; `update` patches the feature in the
 * snapshots that have it (re-validated against that snapshot's schemas); `remove` filters it out.
 * Snapshots the edit doesn't touch keep their reference.
 * ponytail: one array copy per touched snapshot (≤ 50), fine for occasional syncs; batch bursts.
 */
export function rewriteHistory(entries: UndoEntry[], edit: HistoryEdit, schemas: Schema[]): UndoEntry[] {
  let changed = false
  const out = entries.map((entry) => {
    const features = editFeatures(entry.features, edit, entry.schemas ?? schemas)
    if (features === entry.features) return entry
    changed = true
    return { ...entry, features }
  })
  return changed ? out : entries
}

function editFeatures(features: GeoJSONFeature[], edit: HistoryEdit, schemas: Schema[]): GeoJSONFeature[] {
  if (edit.type === 'add') {
    return features.some((f) => f.id === edit.feature.id) ? features : [edit.feature, ...features]
  }
  if (edit.type === 'remove') {
    const next = features.filter((f) => !edit.ids.has(f.id))
    return next.length === features.length ? features : next
  }
  let next: GeoJSONFeature[] | null = null
  let index: Map<string, number> | null = null
  for (const { id, patch } of edit.patches) {
    index ??= new Map(features.map((f, i) => [f.id, i]))
    const idx = index.get(id)
    if (idx === undefined) continue
    next ??= features.slice()
    next[idx] = patchFeature(schemas, next[idx], patch)
  }
  return next ?? features
}

/** Whether `type` passes a `geometryTypes` list (`undefined` = everything passes). */
function isAllowedIn(allowed: GeometryType[] | undefined, type: string): boolean {
  return allowed == null || allowed.includes(type as GeometryType)
}

/** User-facing message when an add would go past `maxFeatures`. Shared with the toolbar gate. */
export function featureLimitMessage(max: number): string {
  return `Maximum of ${max} features reached — delete some to add more.`
}

export interface DataStoreOptions {
  /**
   * Called when an action is refused or fails (e.g. the `maxFeatures` limit, code `'limit-reached'`).
   * `quiet`: report it to `onError` only, no toast. Defaults to console.error.
   */
  onError?: (error: ElementEditorError, opts?: { quiet?: boolean }) => void
  /** Storage scope for the remembered last-used schema. */
  persist?: PersistScope
}

// Validation runs synchronously via validateFeature; async worker enhancement
// is provided by the adapter package (e.g. @element-editor/react) at store init time.

/**
 * One entry in the undo/redo stack. `features` is the snapshot we restore to;
 * `groups` rides alongside so that group-mutating actions (e.g. deleteGroup
 * 'delete-features') can be reversed without leaving features pointing at a
 * deleted group; `extras` is an opaque payload the paired uiStore registers
 * via `setUndoExtrasHandlers` so non-feature state (e.g. completed
 * measurements) rides on the same timeline as feature edits without dataStore
 * needing to know about uiStore. See `setUndoExtrasHandlers`. `schemas` rides
 * along too so schema edits (add/rename/delete schema, field changes) undo on
 * the same timeline. All three are stored by reference — every action replaces
 * these arrays immutably, so an entry costs no cloning.
 */
export type UndoEntry = { features: GeoJSONFeature[]; groups?: Group[]; schemas?: Schema[]; extras?: unknown }

/**
 * The editor's data store (Zustand): features, schemas, groups, selection and undo history, plus
 * the actions the UI uses. Inside the editor tree read it with `useDataStore(selector)` or
 * `useGeoStore().dataStore` from `@element-editor/ui`. From host code, prefer the ref API
 * (`ElementEditorImperativeAPI`), which validates input and never throws.
 */
export interface DataStore {
  geometryMode: 'visual' | 'spatial'
  setGeometryMode: (mode: 'visual' | 'spatial') => void
  currentZoom: number
  setCurrentZoom: (z: number) => void
  /** Every feature, in layer-list order (hidden ones included). Replaced immutably on each commit. */
  features: GeoJSONFeature[]
  /** Every schema (at least one). On export they travel as `metadata.schemas`. */
  schemas: Schema[]
  /** Every group, in layer-list order. On export they travel as `metadata.groups`. */
  groups: Group[]
  lastUsedSchemaId: string | null
  /** Ids of the selected features, in selection order. */
  selectedIds: string[]
  /** Set when the user explicitly clicks a group name (or creates a group with
   *  Cmd+G). Distinct from "every feature in this group happens to be selected"
   *  — needed so a 1-feature group can be selected separately from its sole
   *  feature. Cleared by every feature-selection action. */
  selectedGroupId: string | null
  lastActiveGroupId: string | null
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  lastModifiedAt: number | null
  clipboard: GeoJSONFeature[]
  /** Cap on the total feature count; `undefined` = unlimited. Every action that
   *  adds features checks it (refuses, or truncates imports) and reports via `onError`. */
  maxFeatures?: number
  setMaxFeatures: (max?: number) => void
  /** Opt-in clean-up of committed coordinates (`wrap`, `precision`); undefined = off. */
  coordinates?: CoordinateOptions
  /** Sets the clean-up and applies it once to the features already in the store (no undo step). */
  setCoordinateOptions: (options?: CoordinateOptions) => void
  /** True when `count` more features fit under `maxFeatures`. On false it also
   *  reports the limit message via `onError` — callers can just bail. */
  canAddFeatures: (count: number) => boolean
  /** The geometry types the editor accepts (`undefined` = all). Every way a geometry gets in checks it
   *  (adds, geometry updates, imports, paste, merge, break apart, geometry operations); a refusal is
   *  reported via `onError` (`'geometry-type-not-allowed'`) and changes nothing. */
  geometryTypes?: GeometryType[]
  setGeometryTypes: (types?: GeometryType[]) => void
  /** Whether `type` is allowed by `geometryTypes`. Silent: for deciding what to offer. */
  isGeometryTypeAllowed: (type: string) => boolean
  /** True when every type in `types` is allowed. On false it also reports the refusal via
   *  `onError` — callers can just bail. */
  canUseGeometryTypes: (types: Iterable<string>, source?: 'editor' | 'import' | 'clipboard' | 'geometry') => boolean
  /** Draw tools replace the only feature instead of being refused at the limit (`replaceAtLimit` prop).
   *  Effective only with `maxFeatures === 1`; paste, duplicate, import merge and the ref's `addFeature` still refuse. */
  replaceAtLimit: boolean
  setReplaceAtLimit: (on: boolean) => void
  /** Can a draw tool start or commit: room for one more, or the single feature gets replaced. Reports the limit otherwise. */
  canDraw: () => boolean

  /** When `skipSnapshot` is true the call does NOT push to undoStack — used
   *  by atomic multi-feature operations (e.g. slice/cut) that take their own
   *  single snapshot first and then perform several adds in one logical step. */
  /**
   * Returns the stored feature (validated, with bbox), or null (and adds nothing) when `maxFeatures`
   * is reached. `programmatic` (the ref API): leave the selection alone and don't inherit the last
   * active group (an explicit `groupId` is kept only if that group exists). `undoable: false`: push
   * no undo entry and add the feature to every undo/redo snapshot (see `rewriteHistory`).
   * `draw` (a draw tool's commit): with `replaceAtLimit` on and exactly one feature held under
   * `maxFeatures: 1`, the new geometry replaces that feature's (same id, properties, schema and
   * group; `_drawType` / `_waypoints` follow the new shape) as one undo step, and it is selected.
   */
  addFeature: (feature: GeoJSONFeature, options?: { insertAfterId?: string; skipSnapshot?: boolean; programmatic?: boolean; undoable?: boolean; draw?: boolean }) => GeoJSONFeature | null
  /**
   * Patches one feature (`properties` replaces the whole object, `geometry`, `schemaId`, `hidden`;
   * `_drawType: undefined` clears it, see `freeGeometry`) and re-validates it. A property edit is an
   * undo step; geometry-only patches aren't (drags take their own snapshot). No-op for an unknown id.
   * Returns false (nothing written, refusal reported) when the geometry's type is new to the feature
   * and isn't in `geometryTypes`.
   */
  updateFeature: (id: string, updates: StoreFeaturePatch, options?: { skipValidation?: boolean }) => boolean
  /**
   * `updateFeature` for many features in one commit: one array copy, one store
   * notification, at most one undo entry (pushed when any patch is an
   * undoable data edit, by updateFeature's rule — geometry-only patches don't
   * push). Unknown ids are skipped; nothing to update = no commit. Returns false (nothing written)
   * when a patch's geometry type isn't in `geometryTypes`. A later
   * patch for the same id applies on top of an earlier one.
   * `undoable: true` (the ref API): also push for geometry changes, never coalesce.
   * `undoable: false`: push nothing and apply the patches to every undo/redo snapshot.
   */
  updateFeatures: (updates: ReadonlyArray<{ id: string; patch: StoreFeaturePatch }>, options?: { skipValidation?: boolean; undoable?: boolean }) => boolean
  updateFeatureValidation: (id: string, warnings: string[], errors: string[]) => void

  /** No-op (no commit, no undo entry) for an unknown id. */
  deleteFeature: (id: string) => void
  /**
   * Removes the features with these ids in one commit and one undo step; returns how many were
   * removed (0 = no commit). Removed ids leave the selection; nothing else gets selected.
   * `undoable: false`: push nothing and remove them from every undo/redo snapshot too.
   */
  deleteFeatures: (ids: Iterable<string>, options?: { undoable?: boolean }) => number
  /**
   * Removes the features with `removeIds` and adds `added` (validated, at the top of the list) in
   * one commit and ONE undo step, then selects the added features. For commands that turn several
   * features into new ones (union / subtract / intersect / exclude). Returns false (no commit)
   * when nothing would change.
   */
  replaceFeatures: (removeIds: Iterable<string>, added: GeoJSONFeature[]) => boolean
  // The adding actions below return false when refused by `maxFeatures` (or a no-op).
  duplicateFeature: (id: string) => boolean
  duplicateFeaturesAtPosition: (entries: Array<{ sourceId: string; geometry: GeoJSONFeature['geometry'] }>) => boolean
  duplicateSelection: () => boolean
  /**
   * Copy the selection to the internal clipboard and the system clipboard. Resolves true when the
   * system clipboard was written too, false when it wasn't (reported quietly) or nothing is selected.
   */
  copySelection: () => Promise<boolean>
  /** All-or-nothing: refused when the whole clipboard doesn't fit under `maxFeatures`. */
  pasteSelection: () => boolean
  takeSnapshot: () => void
  /**
   * Register capture / restore callbacks for the snapshot `extras` payload.
   * Called once by the paired uiStore at construction time. `capture` is run
   * synchronously by `takeSnapshot` and `undo`/`redo` as they push the current
   * state onto the opposite stack; `restore` is run synchronously by
   * `undo`/`redo` after popping the target entry, before `set` returns.
   */
  setUndoExtrasHandlers: (
    capture: () => unknown,
    restore: (extras: unknown) => void,
  ) => void
  /** Selects one feature (`null` clears), like a click; also makes its group the one new shapes go to. */
  selectFeature: (id: string | null) => void
  /** Adds the feature to the selection, or removes it (Shift+click). */
  toggleSelection: (id: string) => void
  /** Replaces the selection with these ids (not checked: pass known, visible ids). */
  setSelection: (ids: string[]) => void
  /** Deselects everything. */
  clearSelection: () => void
  /** Mark a group as the explicitly-selected one (or null to clear). Does NOT
   *  touch `selectedIds` — callers usually pair it with `setSelection(...)`. */
  selectGroup: (id: string | null) => void
  deleteSelection: () => void
  /** Refused (returns false) when the extra parts would exceed `maxFeatures`. */
  breakMultiGeometry: (id: string) => boolean
  /** Replaces the selected features with one merged feature (one undo step). False when nothing was merged: fewer than two selected, or the merged type isn't in `geometryTypes` (reported). */
  mergeFeatures: () => boolean
  /** Restores the state before the last undo step (no-op when `undoStack` is empty). Max 25 steps. */
  undo: () => void
  /** Re-applies the last undone step (no-op when `redoStack` is empty). Any new edit clears it. */
  redo: () => void

  /** Adds an empty group at the top of the layer list. */
  addGroup: (name: string) => void
  updateGroup: (id: string, updates: Partial<Pick<Group, 'name' | 'collapsed' | 'hidden'>>) => void
  deleteGroup: (id: string, mode: 'ungroup' | 'delete-features') => void
  toggleGroupCollapsed: (id: string) => void
  toggleGroupHidden: (id: string) => void
  toggleFeatureHidden: (id: string) => void
  moveFeatureToGroup: (featureId: string, groupId: string | null) => void
  reorderFeatures: (orderedIds: string[]) => void
  reorderGroups: (orderedIds: string[]) => void
  /** Atomically create a new group containing the current selection.
   *  Returns the new group id, or null if the selection was empty. */
  groupSelection: (name?: string) => string | null
  /** Clear `groupId` from every selected feature. No-op if none are grouped. */
  ungroupSelection: () => void

  getDefaultSchema: () => Schema
  getSchemaForFeature: (featureId: string) => Schema
  getVisibleSchemas: () => Schema[]
  setLastUsedSchemaId: (id: string) => void

  /** Adds a schema (optionally seeded with fields) as one undo step; returns its id. */
  addSchema: (name: string, fields?: SchemaField[]) => string
  updateSchema: (id: string, updates: { name: string }) => void
  /** No-op when `id` is the last remaining schema — there is always at least one. */
  deleteSchema: (id: string) => void

  /** Adds a field to a schema; every feature using the schema gets it (an undo step). */
  addSchemaField: (schemaId: string, field: SchemaField) => void
  updateSchemaField: (schemaId: string, key: string, updates: Partial<SchemaField>) => void
  /** Removes the field from the schema; values already stored in `properties` are kept. */
  removeSchemaField: (schemaId: string, key: string) => void

  /** The data as GeoJSON text (a `FeatureCollection` with `metadata`), what "Export" downloads. */
  exportGeoJSON: () => string
  /**
   * Loads a FeatureCollection: `'replace'` swaps the data (schemas and groups too), `'merge'`
   * appends. Throws for something that isn't a FeatureCollection; skips features without a usable
   * geometry (`skipped`) and repeated ids (`duplicates`); truncates at `maxFeatures` / 50,000.
   * One undo step.
   *
   * `undoable: false` (replace only — the editor's `initialData` load): push no undo entry and clear
   * the undo/redo history, so Cmd+Z can't step back past the loaded data.
   */
  importGeoJSON: (raw: unknown, mode: 'replace' | 'merge', limits?: { maxFeatures?: number; maxInputSize?: number; undoable?: boolean }) => { skipped: number; duplicates: number; truncated: boolean; refused: number }
  updateFeaturesFromEditor: (raw: unknown) => void
}


/** Fallback label for unnamed features (mirrors featureLabel / geometryTypeLabel in @element-editor/ui). */
function _geomLabel(type: string): string {
  switch (type) {
    case 'Point': return 'Point'
    case 'MultiPoint': return 'Points'
    case 'MultiLineString': return 'Lines'
    case 'Polygon': return 'Area'
    case 'MultiPolygon': return 'Areas'
    case 'GeometryCollection': return 'Mixed'
    default: return 'Line'
  }
}

/** Returns a copy of properties with the name set to "<label> (copy)". */
function makeCopyProperties(properties: Record<string, unknown>, geometryType: string): Record<string, unknown> {
  const newProps = { ...properties }
  const originalName = (typeof newProps.name === 'string' && newProps.name) ? newProps.name : _geomLabel(geometryType)
  if (!originalName.endsWith('(copy)')) {
    newProps.name = `${originalName} (copy)`
  }
  return newProps
}

/**
 * Visual layer-list order: grouped features first (per group order, in feature
 * order within each group), then ungrouped features in feature order. Mirrors
 * `getVisualFeatureOrder` in @element-editor/ui's `layerOrder.ts` so dataStore can
 * pick a "next" feature after a delete without depending on the UI package.
 */
function visualOrder(features: GeoJSONFeature[], groups: Group[]): GeoJSONFeature[] {
  if (groups.length === 0) return features
  const out: GeoJSONFeature[] = []
  for (const g of groups) {
    for (const f of features) if (f.groupId === g.id) out.push(f)
  }
  for (const f of features) if (!f.groupId) out.push(f)
  return out
}

/**
 * After deleting `deletedIds`, pick the feature to select next in the layer
 * list — the survivor whose visual position is at the lowest deleted index, or
 * the last survivor if every deleted item was at the end. Returns `[]` when
 * everything was deleted (selection cleared) or when no provided id was
 * actually deleted (caller should leave selection as-is).
 */
function pickNextSelectionAfterDelete(
  features: GeoJSONFeature[],
  groups: Group[],
  deletedIds: Set<string>,
): string[] | null {
  const visual = visualOrder(features, groups)
  const deletedPositions: number[] = []
  for (let i = 0; i < visual.length; i++) {
    if (deletedIds.has(visual[i].id)) deletedPositions.push(i)
  }
  if (deletedPositions.length === 0) return null
  const survivors = visual.filter((f) => !deletedIds.has(f.id))
  if (survivors.length === 0) return []
  const anchor = deletedPositions[0]
  let beforeAnchor = 0
  for (let i = 0; i < anchor; i++) {
    if (!deletedIds.has(visual[i].id)) beforeAnchor++
  }
  const next = beforeAnchor < survivors.length ? survivors[beforeAnchor] : survivors[survivors.length - 1]
  return [next.id]
}

/** Undo / redo keep the selection (and so an open vertex edit / transform) for the features that still exist. */
function keepExisting(selectedIds: string[], features: GeoJSONFeature[]): string[] {
  if (selectedIds.length === 0) return selectedIds
  const ids = new Set(features.map((f) => f.id))
  const kept = selectedIds.filter((id) => ids.has(id))
  return kept.length === selectedIds.length ? selectedIds : kept
}

/** Validates a feature against its schema and sets bbox + _validation. */
function validateAndFinalize(feature: GeoJSONFeature, schemas: Schema[]): GeoJSONFeature {
  if ('_drawType' in feature && !feature._drawType) {
    feature = { ...feature }
    dropDrawType(feature)
  }
  const schema = schemas.find(s => s.id === feature.schemaId) || schemas[0] || DEFAULT_SCHEMAS[0]
  const { errors, warnings, fixedFeature } = validateFeature(feature, schema)
  const final = fixedFeature || feature
  final._validation = { errors, warnings }
  final.bbox = getGeometryBBox(final.geometry)
  return final
}

// --- Helper: Clone a feature with offset ---
function cloneFeature(feature: GeoJSONFeature, schemas: Schema[], zoom: number, mode: 'visual' | 'spatial'): GeoJSONFeature {
  const newId = crypto.randomUUID()
  let newGeom: GeoJSONFeature['geometry']
  if (mode === 'spatial') {
    const cloned = structuredClone(feature.geometry)
    cloned.coordinates = translateGeometrySpatially(cloned.coordinates as unknown[], [0, 0], [0.0005, -0.0005]) as typeof cloned.coordinates // ~55m at equator
    newGeom = cloned
  } else {
    const dLat = (20 * 360 / (256 * Math.pow(2, zoom)))
    const refLat = getRefLat(feature.geometry)
    const dLng = dLat / getMercatorLatCorrectionRatio(refLat)
    newGeom = offsetGeometry(feature.geometry, [dLng, -dLat], false)
  }

  const properties = makeCopyProperties(feature.properties, feature.geometry.type)
  return validateAndFinalize({ ...feature, id: newId, geometry: newGeom, properties }, schemas)
}

/**
 * Zustand middleware: when `coordinates` options are set, every write that replaces `features`
 * (store actions and direct `setState`) passes through `normaliseFeatures` first, so the store,
 * `onChange` and undo snapshots all hold the cleaned values. Off by default: the fast path is one
 * property read.
 */
function normalisingWrites(init: StateCreator<DataStore>): StateCreator<DataStore> {
  return (set, get, api) => {
    const wrapped: typeof set = (partial, replace) => {
      const opts = get().coordinates
      if (!opts) return set(partial as never, replace as never)
      const current = get()
      const next = typeof partial === 'function' ? partial(current) : partial
      if (next && next !== current && next.features && next.features !== current.features) {
        const features = normaliseFeatures(next.features, opts)
        if (features !== next.features) return set({ ...next, features } as never, replace as never)
      }
      return set(next as never, replace as never)
    }
    api.setState = wrapped
    return init(wrapped, get, api)
  }
}

export const createDataStore = (options?: DataStoreOptions) => {
  const reportError = options?.onError ?? ((err: ElementEditorError) => console.error(err))
  // Cross-store snapshot extras — set by the paired uiStore at construction.
  // Lets the uiStore piggyback on the feature undo/redo timeline (e.g. for
  // completed measurements) without dataStore importing uiStore.
  const extrasHandlers: {
    capture: (() => unknown) | null
    restore: ((extras: unknown) => void) | null
  } = { capture: null, restore: null }
  // Only ever called inside `set` updaters, after `store` exists, so reading
  // the current (pre-update) schemas via getState() is safe.
  const snap = (features: GeoJSONFeature[], groups: Group[]): UndoEntry => ({
    features,
    groups,
    schemas: store.getState().schemas,
    extras: extrasHandlers.capture?.(),
  })

  // Undo push for schema and feature-data actions. Repeated updates with the same `coalesceKey`
  // (e.g. typing a field's Min value, one update per keystroke) within 1 s of
  // each other share the first update's undo step, as long as nothing else was
  // pushed in between.
  let undoCoalesce: { key: string; entry: UndoEntry; at: number } | null = null
  const pushUndo = (state: DataStore, coalesceKey?: string): Partial<DataStore> => {
    const now = Date.now()
    const top = state.undoStack[state.undoStack.length - 1]
    if (coalesceKey && undoCoalesce?.key === coalesceKey && undoCoalesce.entry === top && now - undoCoalesce.at < 1000) {
      undoCoalesce.at = now
      return {}
    }
    const entry = snap(state.features, state.groups)
    undoCoalesce = coalesceKey ? { key: coalesceKey, entry, at: now } : null
    return { undoStack: [...state.undoStack, entry].slice(-25), redoStack: [] }
  }

  /** Undo/redo stacks with a non-undoable change applied to every snapshot. */
  const historyEdit = (state: DataStore, edit: HistoryEdit): Partial<DataStore> => ({
    undoStack: rewriteHistory(state.undoStack, edit, state.schemas),
    redoStack: rewriteHistory(state.redoStack, edit, state.schemas),
  })

  const visibleSchemasMemo: { features: GeoJSONFeature[] | null; schemas: Schema[] | null; result: Schema[] } = { features: null, schemas: null, result: [] }

  const store = create<DataStore>(normalisingWrites((set, get) => ({
  geometryMode: 'visual',
  setGeometryMode: (mode) => set({ geometryMode: mode }),
  currentZoom: 14,
  setCurrentZoom: (z) => set({ currentZoom: z }),
  features: [],
  schemas: DEFAULT_SCHEMAS,
  groups: [],
  lastUsedSchemaId: readStorage(LAST_SCHEMA_KEY, options?.persist),
  selectedIds: [],
  selectedGroupId: null,
  lastActiveGroupId: null,
  undoStack: [],
  redoStack: [],
  lastModifiedAt: null,
  clipboard: [],
  maxFeatures: undefined,
  setMaxFeatures: (maxFeatures) => set({ maxFeatures }),
  geometryTypes: undefined,
  // An empty list is "nothing allowed"; only undefined / null means all.
  setGeometryTypes: (geometryTypes) => set({ geometryTypes: geometryTypes ?? undefined }),
  isGeometryTypeAllowed: (type) => {
    const allowed = get().geometryTypes
    return allowed == null || allowed.includes(type as GeometryType)
  },
  canUseGeometryTypes: (types, source = 'editor') => {
    const allowed = get().geometryTypes
    if (allowed == null) return true
    let refused: Set<string> | null = null
    for (const t of types) if (!allowed.includes(t as GeometryType)) (refused ??= new Set()).add(t)
    if (!refused) return true
    reportError(new ElementEditorError('geometry-type-not-allowed', source, geometryTypeMessage(allowed, refused)))
    return false
  },
  coordinates: undefined,
  setCoordinateOptions: (options) => {
    const coordinates = hasCoordinateOptions(options) ? { ...options } : undefined
    const prev = get().coordinates
    if (prev === coordinates || (prev && coordinates && prev.wrap === coordinates.wrap && prev.precision === coordinates.precision)) return
    set({ coordinates }) // the middleware normalises with the new options only on the next write
    if (coordinates) {
      const features = normaliseFeatures(get().features, coordinates)
      if (features !== get().features) set({ features, lastModifiedAt: Date.now() })
    }
  },
  canAddFeatures: (count) => {
    const { maxFeatures, features } = get()
    if (maxFeatures == null || count <= 0 || features.length + count <= maxFeatures) return true
    reportError(new ElementEditorError('limit-reached', 'editor', featureLimitMessage(maxFeatures)))
    return false
  },
  replaceAtLimit: false,
  setReplaceAtLimit: (replaceAtLimit) => set({ replaceAtLimit }),
  canDraw: () => {
    const { replaceAtLimit, maxFeatures } = get()
    return (replaceAtLimit && maxFeatures === 1) || get().canAddFeatures(1)
  },

  addFeature: (feature, options) => {
    // Geometry type first: a forbidden type is refused even when the draw would replace.
    if (!get().canUseGeometryTypes([feature.geometry.type])) return null
    const cur = get()
    if (options?.draw && cur.replaceAtLimit && cur.maxFeatures === 1 && cur.features.length === 1) {
      let replaced: GeoJSONFeature | null = null
      set((state) => {
        const prev = state.features[0]
        const { _waypoints: _old, ...keptProps } = prev.properties ?? {}
        const properties = feature.properties && '_waypoints' in feature.properties
          ? { ...keptProps, _waypoints: feature.properties._waypoints }
          : keptProps
        const next = patchFeature(state.schemas, { ...prev, _drawType: feature._drawType }, { geometry: feature.geometry, properties })
        if (!next._drawType) delete next._drawType
        replaced = next
        return {
          undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
          redoStack: [],
          features: [next],
          selectedIds: [next.id],
          lastModifiedAt: Date.now()
        }
      })
      return replaced
    }
    if (!get().canAddFeatures(1)) return null
    let stored: GeoJSONFeature | null = null
    set((state) => {
      // Inherit the last active group so new shapes land in the group the user
      // was working in. Drawing clears selectedIds before commit, so we rely on
      // lastActiveGroupId (set by selectFeature) rather than selectedIds.
      let groupId = feature.groupId
      if (options?.programmatic) {
        if (groupId && !state.groups.some((g) => g.id === groupId)) groupId = undefined
      } else if (!groupId && state.lastActiveGroupId) {
        // Verify the group still exists before using it
        const groupExists = state.groups.some((g) => g.id === state.lastActiveGroupId)
        if (groupExists) groupId = state.lastActiveGroupId
      }
      const withGroup = groupId === feature.groupId ? { ...feature } : { ...feature, groupId }
      if ('_drawType' in withGroup && !withGroup._drawType) dropDrawType(withGroup)

      const schema = state.schemas.find(s => s.id === withGroup.schemaId) || state.schemas[0] || DEFAULT_SCHEMAS[0]
      const { errors, warnings, fixedFeature } = validateFeature(withGroup, schema)
      const finalFeature = fixedFeature || withGroup
      finalFeature._validation = { errors, warnings }
      finalFeature.bbox = getGeometryBBox(finalFeature.geometry)

      // Default insertion is at the top of the layer list (array index 0). When
      // `insertAfterId` is given — e.g. Buffer-with-New-Shape — insert right
      // after that feature so the derived shape appears directly below its
      // source in the list instead of floating to the top.
      let features: GeoJSONFeature[]
      if (options?.insertAfterId) {
        const idx = state.features.findIndex((f) => f.id === options.insertAfterId)
        if (idx >= 0) {
          features = [...state.features.slice(0, idx + 1), finalFeature, ...state.features.slice(idx + 1)]
        } else {
          features = [finalFeature, ...state.features]
        }
      } else {
        features = [finalFeature, ...state.features]
      }

      // skipSnapshot: caller already took an explicit snapshot for the
      // surrounding atomic operation (e.g. slice). Don't push another entry
      // or the user would have to undo twice to reach the pre-op state.
      const undoUpdate = options?.undoable === false
        ? historyEdit(state, { type: 'add', feature: finalFeature })
        : options?.skipSnapshot
          ? {}
          : { undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25), redoStack: [] }
      stored = finalFeature
      if (options?.programmatic) return { ...undoUpdate, features, lastModifiedAt: Date.now() }
      return {
        ...undoUpdate,
        features,
        selectedIds: [finalFeature.id],
        lastActiveGroupId: finalFeature.groupId ?? state.lastActiveGroupId,
        lastModifiedAt: Date.now()
      }
    })
    return stored
  },

  updateFeature: (id, updates, options) => {
    let refused = null as string | null
    set((state) => {
      // Structural sharing: only the target slot changes; every other feature keeps its reference.
      const idx = state.features.findIndex((f) => f.id === id)
      if (idx < 0) return state // unknown id: no commit
      const prev = state.features[idx]
      // A geometry that brings in a type the editor doesn't accept is refused whole (a patch that keeps
      // the feature's own type, like a drag or a point edit, is never a "new" type and costs nothing).
      if (updates.geometry && updates.geometry.type !== prev.geometry.type && !isAllowedIn(state.geometryTypes, updates.geometry.type)) {
        refused = updates.geometry.type
        return state
      }
      const features = state.features.slice()
      features[idx] = patchFeature(state.schemas, prev, updates, options)
      // Data edits (properties / schemaId) are one undo step each; same-feature
      // same-keys edits within 1 s coalesce (per-keystroke label typing).
      // Geometry updates never push — their callers snapshot (drag start,
      // takeSnapshot), so geometry+properties stays one step. `hidden` is view state.
      const changed = dataKeysChanged(prev, updates)
      const undo = !updates.geometry && changed.length > 0 ? pushUndo(state, `feature:${id}:${changed.sort().join()}`) : {}
      return { ...undo, features, lastModifiedAt: Date.now() }
    })
    if (refused) { get().canUseGeometryTypes([refused]); return false }
    return true
  },

  updateFeatures: (updates, options) => {
    let refused = null as string | null
    set((state) => {
      let index: Map<string, number> | null = null
      let features: GeoJSONFeature[] | null = null
      let undoable = false
      for (const { id, patch } of updates) {
        index ??= new Map(state.features.map((f, i) => [f.id, i]))
        const idx = index.get(id)
        if (idx === undefined) continue // unknown id: skipped, as updateFeature does
        features ??= state.features.slice()
        const prev = features[idx]
        if (patch.geometry && patch.geometry.type !== prev.geometry.type && !isAllowedIn(state.geometryTypes, patch.geometry.type)) {
          refused = patch.geometry.type // the whole batch is refused: nothing is written
          return state
        }
        features[idx] = patchFeature(state.schemas, prev, patch, options)
        // The same rule as updateFeature, but one entry for the whole batch;
        // `undoable: true` counts geometry changes too.
        if (!undoable && (options?.undoable || !patch.geometry) && dataKeysChanged(prev, patch).length > 0) undoable = true
        if (!undoable && options?.undoable && patch.geometry && patch.geometry !== prev.geometry) undoable = true
      }
      if (!features) return state // nothing to update: no commit
      const undo = options?.undoable === false
        ? historyEdit(state, { type: 'update', patches: updates })
        : undoable ? pushUndo(state) : {}
      return { ...undo, features, lastModifiedAt: Date.now() }
    })
    if (refused) { get().canUseGeometryTypes([refused]); return false }
    return true
  },

  updateFeatureValidation: (id, warnings, errors) =>
    set((state) => {
      const idx = state.features.findIndex((f) => f.id === id)
      if (idx < 0) return state
      const f = state.features[idx]
      // Merge worker warnings/errors with existing schema errors
      const currentValidation = f._validation || { errors: [], warnings: [] }
      const newErrors = Array.from(new Set([...currentValidation.errors, ...errors]))
      const newWarnings = Array.from(new Set([...currentValidation.warnings, ...warnings]))
      // Nothing new: keep the features array as-is so subscribers see no commit.
      if (newErrors.length === currentValidation.errors.length && newWarnings.length === currentValidation.warnings.length) return state
      const features = state.features.slice()
      features[idx] = { ...f, _validation: { errors: newErrors, warnings: newWarnings } }
      return { features } // No lastModified bump for async validation result to avoid infinite loops
    }),

  deleteFeature: (id) =>
    set((state) => {
      if (!state.features.some((f) => f.id === id)) return state // unknown id: no commit, no undo entry
      const wasSelected = state.selectedIds.includes(id)
      const newFeatures = state.features.filter((f) => f.id !== id)
      // Auto-select the next layer in the list if the deleted feature was the
      // single selection — avoids leaving the user with no selection in the
      // middle of an editing session.
      let selectedIds = state.selectedIds.filter((m) => m !== id)
      if (wasSelected && state.selectedIds.length === 1) {
        const next = pickNextSelectionAfterDelete(state.features, state.groups, new Set([id]))
        if (next !== null) selectedIds = next
      }
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: newFeatures,
        selectedIds,
        lastModifiedAt: Date.now(),
      }
    }),

  deleteFeatures: (ids, options) => {
    const remove = new Set(ids)
    let removed = 0
    set((state) => {
      const features = state.features.filter((f) => !remove.has(f.id))
      removed = state.features.length - features.length
      if (removed === 0) return state
      const selectedIds = state.selectedIds.filter((id) => !remove.has(id))
      const undo = options?.undoable === false
        ? historyEdit(state, { type: 'remove', ids: remove })
        : { undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25), redoStack: [] }
      return {
        ...undo,
        features,
        ...(selectedIds.length !== state.selectedIds.length ? { selectedIds } : {}),
        lastModifiedAt: Date.now(),
      }
    })
    return removed
  },

  replaceFeatures: (removeIds, added) => {
    const remove = new Set(removeIds)
    let changed = false
    if (!get().canUseGeometryTypes(added.map((f) => f.geometry.type), 'geometry')) return false
    set((state) => {
      const kept = state.features.filter((f) => !remove.has(f.id))
      if (kept.length === state.features.length && added.length === 0) return state
      changed = true
      const finals = added.map((f) => validateAndFinalize(f, state.schemas))
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: [...finals, ...kept],
        selectedIds: finals.map((f) => f.id),
        selectedGroupId: null,
        lastModifiedAt: Date.now(),
      }
    })
    return changed
  },

  duplicateFeature: (id) => {
    const state = get()
    const feature = state.features.find((f) => f.id === id)
    if (!feature || !state.canAddFeatures(1)) return false
    const finalDup = cloneFeature(feature, state.schemas, state.currentZoom, state.geometryMode)
    set((s) => ({
      // One undo step, like duplicateSelection (it used to push none, so Cmd+Z undid the edit before).
      undoStack: [...s.undoStack, snap(s.features, s.groups)].slice(-25),
      redoStack: [],
      features: [...s.features, finalDup],
      lastModifiedAt: Date.now(),
    }))
    return true
  },

  duplicateFeaturesAtPosition: (entries) => {
    const ids = new Set(get().features.map((f) => f.id))
    if (!get().canAddFeatures(entries.filter((e) => ids.has(e.sourceId)).length)) return false
    let added = false
    set((state) => {
      const duplicates: GeoJSONFeature[] = []
      for (const { sourceId, geometry } of entries) {
        const source = state.features.find((f) => f.id === sourceId)
        if (!source) continue
        const properties = makeCopyProperties(source.properties, source.geometry.type)
        const dup: GeoJSONFeature = {
          ...source,
          id: crypto.randomUUID(),
          geometry: structuredClone(geometry),
          properties,
        }
        duplicates.push(validateAndFinalize(dup, state.schemas))
      }
      if (duplicates.length === 0) return state
      added = true
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: [...state.features, ...duplicates],
        selectedIds: duplicates.map(d => d.id),
        lastModifiedAt: Date.now(),
      }
    })
    return added
  },

  duplicateSelection: () => {
    const state = get()
    if (state.selectedIds.length === 0) return false
    const selectedSet = new Set(state.selectedIds)
    const toDuplicate = state.features.filter((f) => selectedSet.has(f.id))
    if (!state.canAddFeatures(toDuplicate.length)) return false
    const duplicates = toDuplicate.map(f => cloneFeature(f, state.schemas, state.currentZoom, state.geometryMode))
    set((s) => ({
      undoStack: [...s.undoStack, snap(s.features, s.groups)].slice(-25),
      redoStack: [],
      features: [...s.features, ...duplicates],
      selectedIds: duplicates.map(d => d.id),
      lastModifiedAt: Date.now(),
    }))
    return true
  },

  copySelection: () => {
    const state = get()
    if (state.selectedIds.length === 0) return Promise.resolve(false)
    const selectedSet = new Set(state.selectedIds)
    const selected = state.features.filter((f) => selectedSet.has(f.id))
    set({ clipboard: selected })

    // Also write the system clipboard. A failure is reported quietly (`onError` only): the internal
    // copy above still works for pasting in this editor.
    const only = 'the selection can only be pasted in this editor'
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (!clip?.writeText) {
      reportError(new ElementEditorError('unsupported', 'clipboard', `The system clipboard is not available here; ${only}`), { quiet: true })
      return Promise.resolve(false)
    }
    const json = JSON.stringify({ type: 'FeatureCollection', features: selected }, null, 2)
    return clip.writeText(json).then(() => true, (err: unknown) => {
      reportError(new ElementEditorError('permission-denied', 'clipboard', `The browser blocked the system clipboard; ${only}`, { cause: err }), { quiet: true })
      return false
    })
  },

  pasteSelection: () => {
    const state = get()
    // ponytail: all-or-nothing — a partial paste of a selection would be a surprise.
    if (state.clipboard.length === 0 || !state.canAddFeatures(state.clipboard.length)) return false
    if (!state.canUseGeometryTypes(state.clipboard.map((f) => f.geometry?.type), 'clipboard')) return false
    const pasted = state.clipboard.map(f => cloneFeature(f, state.schemas, state.currentZoom, state.geometryMode))
    set((s) => ({
      undoStack: [...s.undoStack, snap(s.features, s.groups)].slice(-25),
      redoStack: [],
      features: [...s.features, ...pasted],
      selectedIds: pasted.map(p => p.id),
      clipboard: pasted, // update clipboard to the pasted items so pasting again offsets further
      lastModifiedAt: Date.now(),
    }))
    return true
  },


  takeSnapshot: () => set((state) => ({ undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25), redoStack: [] })),

  setUndoExtrasHandlers: (capture, restore) => {
    extrasHandlers.capture = capture
    extrasHandlers.restore = restore
  },

  selectFeature: (id) =>
    set((state) => {
      const feature = id ? state.features.find((f) => f.id === id) : null
      return {
        selectedIds: id ? [id] : [],
        // Selecting an individual feature always cancels group-level selection.
        selectedGroupId: null,
        // Track the group of the last individually selected feature so addFeature
        // can inherit it even after drawing clears the selection. Explicit
        // deselect (id === null) drops the context entirely so the next draw
        // lands outside any group.
        lastActiveGroupId: id !== null ? (feature?.groupId ?? null) : null,
      }
    }),

  toggleSelection: (id) =>
    set((state) => {
      const exists = state.selectedIds.includes(id)
      const newIds = exists
        ? state.selectedIds.filter((x) => x !== id)
        : [...state.selectedIds, id]
      return { selectedIds: newIds, selectedGroupId: null }
    }),

  setSelection: (ids) =>
    set({ selectedIds: ids, selectedGroupId: null }),

  clearSelection: () =>
    // Treat as a user-initiated full deselect — drop the active-group context too
    // so the next draw lands outside any group. Drawing tools that internally
    // clear the visual selection right before adding a new feature should bypass
    // this action and call `setState({ selectedIds: [] })` directly to preserve
    // the group context for inheritance.
    set({ selectedIds: [], selectedGroupId: null, lastActiveGroupId: null }),

  selectGroup: (id) => set({ selectedGroupId: id }),

  deleteSelection: () =>
    set((state) => {
      if (state.selectedIds.length === 0) return state
      const toDelete = new Set(state.selectedIds)
      // Auto-select the next layer in the visual list — the survivor at the
      // earliest deleted position, or the last survivor if everything deleted
      // was at the bottom.
      const next = pickNextSelectionAfterDelete(state.features, state.groups, toDelete)
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: state.features.filter((f) => !toDelete.has(f.id)),
        selectedIds: next ?? [],
        lastModifiedAt: Date.now(),
      }
    }),

  breakMultiGeometry: (id) => {
    const target = get().features.find((f) => f.id === id)
    if (!target) return false
    const partCount = getPartCount(target.geometry)
    if (partCount < 2 || !get().canAddFeatures(partCount - 1)) return false
    if (!get().canUseGeometryTypes(breakResultTypes(target.geometry), 'geometry')) return false
    set((state) => {
      const feature = state.features.find((f) => f.id === id)
      if (!feature) return state
      const { geometry } = feature

      let parts: Array<GeoJSONFeature['geometry']> = []
      if (geometry.type === 'MultiPoint') {
        parts = geometry.coordinates.map((coords) => ({ type: 'Point' as const, coordinates: coords }))
      } else if (geometry.type === 'MultiPolygon') {
        parts = geometry.coordinates.map((coords) => ({ type: 'Polygon' as const, coordinates: coords }))
      } else if (geometry.type === 'MultiLineString') {
        parts = geometry.coordinates.map((coords) => ({ type: 'LineString' as const, coordinates: coords }))
      } else if (geometry.type === 'GeometryCollection') {
        parts = geometry.geometries.map((g) => g as GeoJSONFeature['geometry'])
      }
      if (parts.length < 2) return state

      // First part replaces the original feature
      const updatedOriginal: GeoJSONFeature = {
        ...feature,
        geometry: parts[0] as GeoJSONFeature['geometry'],
        _drawType: undefined,
        bbox: getGeometryBBox(parts[0] as GeoJSONFeature['geometry']),
      }

      // Remaining parts become new features
      const newFeatures = parts.slice(1).map((geom) => {
        const g = geom as GeoJSONFeature['geometry']
        const f: GeoJSONFeature = {
          type: 'Feature',
          id: crypto.randomUUID(),
          geometry: g,
          properties: { ...feature.properties },
          schemaId: feature.schemaId,
          groupId: feature.groupId,
          bbox: getGeometryBBox(g),
        }
        const schema = state.schemas.find(s => s.id === f.schemaId) || state.schemas[0] || DEFAULT_SCHEMAS[0]
        const { errors, warnings, fixedFeature } = validateFeature(f, schema)
        const final = fixedFeature || f
        final._validation = { errors, warnings }
        return final
      })

      // Validate the updated original too
      const origSchema = state.schemas.find(s => s.id === updatedOriginal.schemaId) || state.schemas[0] || DEFAULT_SCHEMAS[0]
      const origVal = validateFeature(updatedOriginal, origSchema)
      const finalOriginal = origVal.fixedFeature || updatedOriginal
      finalOriginal._validation = { errors: origVal.errors, warnings: origVal.warnings }

      // Insert new features right after the original's position
      const originalIndex = state.features.findIndex((f) => f.id === id)
      const updatedFeatures = [...state.features]
      updatedFeatures[originalIndex] = finalOriginal
      updatedFeatures.splice(originalIndex + 1, 0, ...newFeatures)

      const allNewIds = [id, ...newFeatures.map((f) => f.id)]

      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: updatedFeatures,
        selectedIds: allNewIds,
        lastModifiedAt: Date.now(),
      }
    })
    return true
  },

  mergeFeatures: () => {
    let refused = null as string | null
    let merged = false
    set((state) => {
      if (state.selectedIds.length < 2) return state
      const featuresById = new Map(state.features.map(f => [f.id, f]))
      const selectedFeatures = state.selectedIds.flatMap(id => {
        const f = featuresById.get(id)
        return f ? [f] : []
      })
      if (selectedFeatures.length < 2) return state
      const resultType = mergeResultType(selectedFeatures.map((f) => f.geometry.type))
      if (!isAllowedIn(state.geometryTypes, resultType)) { refused = resultType; return state }

      const mergedGeometry = mergeGeometries(selectedFeatures)
      const baseFeature = selectedFeatures[0]
      const newId = crypto.randomUUID()
      const newFeature: GeoJSONFeature = {
        type: 'Feature',
        id: newId,
        geometry: mergedGeometry,
        properties: { ...baseFeature.properties },
        schemaId: baseFeature.schemaId,
        groupId: baseFeature.groupId,
        bbox: getGeometryBBox(mergedGeometry),
      }

      const schema = state.schemas.find(s => s.id === newFeature.schemaId) || state.schemas[0] || DEFAULT_SCHEMAS[0]
      const { errors, warnings, fixedFeature } = validateFeature(newFeature, schema)
      const finalFeature = fixedFeature || newFeature
      finalFeature._validation = { errors, warnings }
      finalFeature.bbox = getGeometryBBox(finalFeature.geometry)

      const deleteSet = new Set(state.selectedIds)
      merged = true
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: [finalFeature, ...state.features.filter(f => !deleteSet.has(f.id))],
        selectedIds: [newId],
        lastModifiedAt: Date.now(),
      }
    })
    if (refused) get().canUseGeometryTypes([refused], 'geometry')
    return merged
  },

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state
      const prev = state.undoStack[state.undoStack.length - 1]
      // Snapshot current extras BEFORE restoring so redo can return to where
      // we were. Then restore the prev entry's extras into the paired store.
      const redoEntry = snap(state.features, state.groups)
      extrasHandlers.restore?.(prev.extras)
      return {
        features: prev.features,
        groups: prev.groups ?? state.groups,
        schemas: prev.schemas ?? state.schemas,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, redoEntry].slice(-25),
        selectedIds: keepExisting(state.selectedIds, prev.features),
        lastModifiedAt: Date.now(),
      }
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state
      const next = state.redoStack[state.redoStack.length - 1]
      const undoEntry = snap(state.features, state.groups)
      extrasHandlers.restore?.(next.extras)
      return {
        features: next.features,
        groups: next.groups ?? state.groups,
        schemas: next.schemas ?? state.schemas,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, undoEntry].slice(-25),
        selectedIds: keepExisting(state.selectedIds, next.features),
        lastModifiedAt: Date.now(),
      }
    }),

  addGroup: (name) =>
    set((state) => {
      const newGroup = { id: crypto.randomUUID(), name, collapsed: false }
      return {
        groups: [...state.groups, newGroup],
        lastModifiedAt: Date.now(),
      }
    }),

  updateGroup: (id, updates) =>
    set((state) => {
      // A rename is undoable; collapsed / hidden are view state.
      const renamed = updates.name !== undefined && state.groups.some((g) => g.id === id && g.name !== updates.name)
      return {
        ...(renamed ? pushUndo(state) : {}),
        groups: state.groups.map((g) => (g.id === id ? { ...g, ...updates } : g)),
        lastModifiedAt: Date.now(),
      }
    }),

  deleteGroup: (id, mode) =>
    set((state) => {
      const features = mode === 'delete-features'
        ? state.features.filter((f) => f.groupId !== id)
        : state.features.map((f) => (f.groupId === id ? { ...f, groupId: undefined } : f))
      // Both modes are now snapshotted — `groups` rides on the entry (issue #7),
      // so undo correctly restores the group + child groupIds in either case.
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        groups: state.groups.filter((g) => g.id !== id),
        features,
        // The selected group just stopped existing — drop the highlight.
        selectedGroupId: state.selectedGroupId === id ? null : state.selectedGroupId,
        lastActiveGroupId: state.lastActiveGroupId === id ? null : state.lastActiveGroupId,
        lastModifiedAt: Date.now(),
      }
    }),

  toggleGroupCollapsed: (id) =>
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    })),

  toggleGroupHidden: (id) =>
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, hidden: !g.hidden } : g)),
    })),

  toggleFeatureHidden: (id) =>
    set((state) => ({
      features: state.features.map((f) => (f.id === id ? { ...f, hidden: !f.hidden } : f)),
      lastModifiedAt: Date.now(),
    })),

  moveFeatureToGroup: (featureId, groupId) =>
    set((state) => ({
      features: state.features.map((f) => (f.id === featureId ? { ...f, groupId: groupId ?? undefined } : f)),
      lastModifiedAt: Date.now(),
    })),

  reorderFeatures: (orderedIds) =>
    set((state) => {
      const idMap = new Map(orderedIds.map((id, index) => [id, index]))
      const features = [...state.features].sort((a, b) => {
        const idxA = idMap.get(a.id) ?? Infinity
        const idxB = idMap.get(b.id) ?? Infinity
        return idxA - idxB
      })
      return { features, lastModifiedAt: Date.now() }
    }),

  reorderGroups: (orderedIds) =>
    set((state) => {
      const idMap = new Map(orderedIds.map((id, index) => [id, index]))
      const groups = [...state.groups].sort((a, b) => {
        const idxA = idMap.get(a.id) ?? Infinity
        const idxB = idMap.get(b.id) ?? Infinity
        return idxA - idxB
      })
      return { groups }
    }),

  groupSelection: (name) => {
    let newId: string | null = null
    set((state) => {
      if (state.selectedIds.length === 0) return state
      const id = crypto.randomUUID()
      newId = id
      const selectedSet = new Set(state.selectedIds)
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        groups: [...state.groups, { id, name: name ?? 'New group', collapsed: false }],
        features: state.features.map((f) => (selectedSet.has(f.id) ? { ...f, groupId: id } : f)),
        // Hand off selection from individual features to the new group itself —
        // matches the user's mental model of "I just made a group out of this".
        selectedGroupId: id,
        lastActiveGroupId: id,
        lastModifiedAt: Date.now(),
      }
    })
    return newId
  },

  ungroupSelection: () =>
    set((state) => {
      if (state.selectedIds.length === 0) return state
      const selectedSet = new Set(state.selectedIds)
      const hasGrouped = state.features.some((f) => selectedSet.has(f.id) && f.groupId)
      if (!hasGrouped) return state
      return {
        undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
        redoStack: [],
        features: state.features.map((f) =>
          selectedSet.has(f.id) && f.groupId ? { ...f, groupId: undefined } : f,
        ),
        // The user just removed these features from a group — drop the group-
        // selection state and active context so the next draw doesn't get
        // inserted back into it.
        selectedGroupId: null,
        lastActiveGroupId: null,
        lastModifiedAt: Date.now(),
      }
    }),

  getDefaultSchema: () => {
    const s = get()
    const found = s.lastUsedSchemaId ? s.schemas.find((x) => x.id === s.lastUsedSchemaId) : null
    return found || s.schemas[0] || DEFAULT_SCHEMAS[0]
  },

  getSchemaForFeature: (featureId) => {
    const s = get()
    const feature = s.features.find((f) => f.id === featureId)
    if (!feature || !feature.schemaId) return s.schemas[0] || DEFAULT_SCHEMAS[0]
    return s.schemas.find((x) => x.id === feature.schemaId) || s.schemas[0] || DEFAULT_SCHEMAS[0]
  },

  getVisibleSchemas: () => {
    const s = get()
    // Used as a selector by several panels, so it runs on every store update:
    // skip the O(n) feature scan when there's no boundaries schema to hide, and
    // otherwise scan once per features/schemas reference.
    if (!s.schemas.some((schema) => schema.id === BOUNDARIES_SCHEMA_ID)) return s.schemas
    if (visibleSchemasMemo.features !== s.features || visibleSchemasMemo.schemas !== s.schemas) {
      const hasBoundaries = s.features.some((f) => f.schemaId === BOUNDARIES_SCHEMA_ID)
      visibleSchemasMemo.features = s.features
      visibleSchemasMemo.schemas = s.schemas
      visibleSchemasMemo.result = hasBoundaries ? s.schemas : s.schemas.filter((schema) => schema.id !== BOUNDARIES_SCHEMA_ID)
    }
    return visibleSchemasMemo.result
  },

  setLastUsedSchemaId: (id) => {
    set({ lastUsedSchemaId: id })
    writeStorage(LAST_SCHEMA_KEY, id, options?.persist)
  },

  addSchema: (name, fields = []) => {
    const id = crypto.randomUUID()
    set((state) => ({
      ...pushUndo(state),
      schemas: [...state.schemas, { id, name, fields }],
    }))
    return id
  },

  updateSchema: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      schemas: state.schemas.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  deleteSchema: (id) =>
    set((state) => {
      if (state.schemas.length <= 1 || !state.schemas.some((s) => s.id === id)) return state
      // Features keep their (now dangling) schemaId and fall back to schemas[0]
      // at read time — undo restores the schema and they reattach as-is.
      return {
        ...pushUndo(state),
        schemas: state.schemas.filter((s) => s.id !== id),
      }
    }),

  addSchemaField: (schemaId, field) =>
    set((state) => ({
      ...pushUndo(state),
      schemas: state.schemas.map((s) =>
        s.id === schemaId ? { ...s, fields: [...s.fields, field] } : s
      ),
      features: state.features.map((f) =>
        f.schemaId === schemaId && f.properties[field.key] === undefined
          ? { ...f, properties: { ...f.properties, [field.key]: '' } }
          : f
      ),
    })),

  updateSchemaField: (schemaId, key, updates) =>
    set((state) => {
      // If the key is changing, we must rename the property in all existing features
      // that use this schema to prevent their data from being orphaned.
      let features = state.features
      if (updates.key && updates.key !== key) {
        features = state.features.map(f => {
          if (f.schemaId === schemaId) {
            const newProps = { ...f.properties }
            newProps[updates.key as string] = newProps[key] !== undefined ? newProps[key] : ''
            delete newProps[key]
            return { ...f, properties: newProps }
          }
          return f
        })
      }

      return {
        ...pushUndo(state, `field:${schemaId}:${key}:${Object.keys(updates).sort().join()}`),
        features,
        schemas: state.schemas.map((s) =>
          s.id === schemaId
            ? {
                ...s,
                fields: s.fields.map((f) => (f.key === key ? { ...f, ...updates } : f)),
              }
            : s
        ),
      }
    }),

  // Non-destructive: feature property values for `key` are left untouched.
  removeSchemaField: (schemaId, key) =>
    set((state) => ({
      ...pushUndo(state),
      schemas: state.schemas.map((s) =>
        s.id === schemaId
          ? { ...s, fields: s.fields.filter((f) => f.key !== key) }
          : s
      ),
    })),

  exportGeoJSON: () => {
    const s = get()
    // Drop our internal _leaflys_group and schemaId before export, restore if round-tripped
    // Actually, storing them as foreign members (per RFC 7946 §6.1) is perfectly legal.
    // They are just flat string properties at the Feature root.
    
    // We clean the validation property
    const cleanFeatures = s.features.map(f => {
      const clean = withFiniteBBox({ ...f })
      delete clean._validation
      return clean
    })
    
    const collection = {
      type: 'FeatureCollection',
      metadata: {
        schemas: s.schemas,
        groups: s.groups,
      },
      features: cleanFeatures,
    }
    
    return JSON.stringify(collection, null, 2)
  },

  importGeoJSON: (raw, mode, limits) => {
    const input = raw as Record<string, unknown>
    if (!raw || typeof raw !== 'object' || input.type !== 'FeatureCollection') {
      throw new Error('Not a FeatureCollection')
    }
    if (input.features != null && !Array.isArray(input.features)) {
      throw new Error('FeatureCollection.features is not an array')
    }

    let skipped = 0
    let duplicates = 0
    let truncated = false
    const refusedTypes = new Set<string>()
    let refusedCount = 0
    let limitHit: { max: number; added: number; incoming: number } | null = null
    set((state) => {
      const incomingFeatures = (input.features as GeoJSONFeature[] | undefined) || []
      const maxFeatures = limits?.maxFeatures ?? state.maxFeatures

      const newFeatures: GeoJSONFeature[] = []
      // Merge dedupes against current features; replace only dedupes within
      // the incoming set (seeding from state would drop every re-imported id).
      const existingIds = new Set(mode === 'merge' ? state.features.map((f) => f.id) : [])
      const meta = (input.metadata as { schemas?: Schema[]; schema?: unknown; groups?: Group[] } | undefined) || {}

      // Handle legacy single-schema exports
      let incomingSchemas: Schema[] = meta.schemas || []
      if (!meta.schemas && meta.schema) {
        const schemaVal = meta.schema as Schema | SchemaField[]
        if (Array.isArray(schemaVal) && schemaVal.length > 0 && !('fields' in schemaVal[0])) {
           // It's an array of fields
           incomingSchemas = [{ id: 'default', name: 'Default schema', fields: schemaVal as SchemaField[] }]
        } else {
           incomingSchemas = Array.isArray(schemaVal) ? schemaVal as unknown as Schema[] : [schemaVal as Schema]
        }
      }

      const incomingGroups: Group[] = meta.groups || []
      const incomingGroupIds = new Set(incomingGroups.map((g) => g.id))

      // Compute capacity: in merge mode, existing features count toward the limit
      const existingCount = mode === 'merge' ? state.features.length : 0
      const userLimit = maxFeatures != null ? Math.max(0, maxFeatures - existingCount) : MAX_IMPORT_FEATURES
      const capacity = Math.min(userLimit, MAX_IMPORT_FEATURES)

      for (const f of incomingFeatures) {
        // Enforce feature limit
        if (newFeatures.length >= capacity) {
          truncated = true
          if (maxFeatures != null && capacity === userLimit) {
            limitHit = { max: maxFeatures, added: newFeatures.length, incoming: incomingFeatures.length }
          }
          break
        }

        // A known type alone isn't enough: a geometry without coordinates would crash
        // getGeometryBBox (and every renderer) and abort the whole import.
        if (!isGeometry(f?.geometry)) {
          skipped++
          continue
        }
        // A type the editor doesn't accept: skipped and counted apart from unusable geometry.
        if (!isAllowedIn(state.geometryTypes, f.geometry.type)) {
          refusedTypes.add(f.geometry.type)
          refusedCount++
          continue
        }

        // RFC 7946 ids may be numbers, including 0: only a missing or empty id gets a UUID.
        const id = f.id != null && String(f.id) !== '' ? String(f.id) : crypto.randomUUID()

        // Merge: skip ids already on the map. Replace: skip ids repeated within the incoming set.
        if (existingIds.has(id)) {
          duplicates++
          continue
        }
        
        existingIds.add(id)
        
        // Strip orphan groupId
        let groupId = f.groupId ? String(f.groupId) : undefined
        if (groupId && mode === 'replace' && !incomingGroupIds.has(groupId)) {
          groupId = undefined
        } else if (groupId && mode === 'merge' && !incomingGroupIds.has(groupId) && !state.groups.some(g => g.id === groupId)) {
          groupId = undefined
        }

        const feat = {
          type: 'Feature',
          id,
          schemaId: f.schemaId ? String(f.schemaId) : undefined,
          groupId,
          // Element's own foreign members survive a round-trip (export writes them).
          ...(f.hidden === true && { hidden: true }),
          ...(DRAW_TYPES.includes(f._drawType as DrawType) && { _drawType: f._drawType }),
          geometry: f.geometry,
          properties: f.properties || {},
        } as GeoJSONFeature

        // Only compute bbox during import — defer expensive validation to async worker.
        // Empty geometries get none (consumers fall back to getGeometryBBox).
        const bbox = storedBBox(feat.geometry)
        if (bbox) feat.bbox = bbox
        
        newFeatures.push(feat)
      }

      if (mode === 'replace') {
        return {
          undoStack: limits?.undoable === false ? [] : [...state.undoStack, snap(state.features, state.groups)].slice(-25),
          redoStack: [],
          features: newFeatures,
          schemas: incomingSchemas.length > 0 ? incomingSchemas : DEFAULT_SCHEMAS,
          groups: incomingGroups,
          selectedIds: [],
          lastModifiedAt: Date.now(),
        }
      } else {
        const newSchemasToAdd = incomingSchemas.filter((s: Schema) => !state.schemas.some((ex) => ex.id === s.id))
        const newGroupsToAdd = incomingGroups.filter((g: Group) => !state.groups.some((ex) => ex.id === g.id))
        // A merge that adds nothing is a no-op: no undo entry, redo kept.
        if (newFeatures.length === 0 && newSchemasToAdd.length === 0 && newGroupsToAdd.length === 0) return state
        return {
          undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
          redoStack: [],
          features: [...state.features, ...newFeatures],
          schemas: [...state.schemas, ...newSchemasToAdd],
          groups: [...state.groups, ...newGroupsToAdd],
          lastModifiedAt: Date.now(),
        }
      }
    })
    if (limitHit) {
      const { max, added, incoming } = limitHit as { max: number; added: number; incoming: number }
      reportError(new ElementEditorError('limit-reached', 'import', `Imported ${added} of ${incoming} features — ${featureLimitMessage(max)}`))
    }
    if (refusedCount > 0) {
      const allowed = get().geometryTypes ?? []
      reportError(new ElementEditorError('geometry-type-not-allowed', 'import', `Skipped ${refusedCount} ${refusedCount === 1 ? 'feature' : 'features'}. ${geometryTypeMessage(allowed, refusedTypes)}`))
    }
    return { skipped, duplicates, truncated, refused: refusedCount }
  },

  updateFeaturesFromEditor: (raw) => {
    if (!raw || typeof raw !== 'object') return
    const input = raw as Record<string, unknown>
    if (input.type !== 'FeatureCollection' || !Array.isArray(input.features)) return
    const incoming = input.features as GeoJSONFeature[]
    // Features passed through as the store's own objects keep their reference
    // (the inspector re-parses only the features the user edited).
    const known = new Set(get().features)
    // Half-typed text (geometry lines deleted to retype them) isn't a feature
    // yet: write nothing rather than hand renderers a feature with no geometry.
    if (incoming.some((f) => !known.has(f) && (f?.type !== 'Feature' || !isGeometry(f.geometry)))) return
    // Editing raw GeoJSON may add features too; refuse a net increase past the limit.
    if (!get().canAddFeatures(incoming.length - get().features.length)) return
    // Only features the text brought in (new objects) can carry a new type: O(changed).
    if (!get().canUseGeometryTypes(incoming.filter((f) => !known.has(f)).map((f) => f.geometry.type))) return
    const features = incoming.map((f) => known.has(f) ? f : ({
      ...f,
      id: (f.id !== undefined && f.id !== null && String(f.id).length > 0) ? String(f.id) : crypto.randomUUID(),
      type: 'Feature' as const,
      properties: f.properties ?? {},
    }))
    // Features deleted in the text leave the selection.
    const ids = new Set(features.map((f) => f.id))
    set((state) => ({
      features,
      selectedIds: state.selectedIds.every((id) => ids.has(id)) ? state.selectedIds : state.selectedIds.filter((id) => ids.has(id)),
      undoStack: [...state.undoStack, snap(state.features, state.groups)].slice(-25),
      redoStack: [],
      lastModifiedAt: Date.now(),
    }))
  },
})))

  return store
}
