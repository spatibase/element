import { create, type StoreApi } from 'zustand'
import type { EditingMode, GeoJSONFeature } from '../types/geojson'
import { freeGeometry, type DataStore } from './dataStore'

import { rdp } from '../utils/rdp'
import { normalizeBounds, type BBox, type BoundsInput } from '../utils/coords'
import { readPersisted, writePersisted, readStorage, writeStorage, type PersistScope } from '../utils/persisted'
import { featureCollection, lineString, polygon, point as turfPoint } from '@turf/helpers'
import { distance as turfDistance } from '@turf/distance'
import { destination as turfDestination } from '@turf/destination'
import { project, unproject } from '../mercator'
import { ElementEditorError } from '../utils/errors'
import { getGeometryRunner } from '../utils/geometryRunner'
import { TOOL_GEOMETRY_TYPES } from '../utils/geometryTypes'
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson'

export type DialogState =
  | { type: 'closed' }
  | { type: 'new-point'; coords: [number, number]; prefill?: Record<string, string> }
  | { type: 'edit'; featureId: string; isNew?: boolean; focusFirstField?: boolean }

export interface PanelPrefs {
  coordsOpen: boolean | null  // null = use default
  sourceOpen: boolean | null  // null = use default
}

const PANEL_PREFS_KEY = 'elm_panel_prefs'
const PANEL_PREFS_VERSION = 1

function loadPanelPrefs(scope?: PersistScope): PanelPrefs {
  const stored = readPersisted<PanelPrefs>(
    PANEL_PREFS_KEY,
    PANEL_PREFS_VERSION,
    (raw) => (raw && typeof raw === 'object' ? (raw as PanelPrefs) : null),
    scope,
  )
  return stored ?? { coordsOpen: null, sourceOpen: null }
}

export interface CompletedMeasurement {
  id: string
  points: [number, number][]
  mode: 'distance' | 'area'
}

/**
 * The editor's UI store (Zustand): the active tool / editing mode, shapes in progress, panels and
 * modals, settings. Inside the editor tree read it with `useUIStore(selector)` or
 * `useGeoStore().uiStore` from `@element-editor/ui`. From host code, prefer the ref API
 * (`setTool` / `getTool`).
 */
export interface UIStore {
  settingsModalOpen: boolean
  setSettingsModalOpen: (open: boolean) => void
  /** True while the ZoomIndicator is in its inline edit state. */
  zoomEditing: boolean
  setZoomEditing: (editing: boolean) => void
  showMeasurements: boolean
  setShowMeasurements: (show: boolean) => void
  showFeatureNameOnHover: boolean
  setShowFeatureNameOnHover: (show: boolean) => void
  /** What the map is doing: `'none'`, a drawing tool's mode (`'draw-polygon'`, …), `'measure'`, or a shape operation (`'cut-hole'`, …). */
  editingMode: EditingMode
  /** Tools the `tools` prop allows; `null` = all. */
  enabledTools: string[] | null
  /** Tools the editor's `config.network` turns off (`routing: false` → `'route'`, …), on top of `enabledTools`. */
  unavailableTools: string[]
  lineInProgress: [number, number][]
  polygonInProgress: [number, number][]
  circleCenter: [number, number] | null
  rectCorner: [number, number] | null
  routeWaypoints: [number, number][]
  routePreview: [number, number][] | null   // snapped path from OSRM (or null while pending)
  routeLoading: boolean
  routeCursorPos: [number, number] | null   // current cursor position while drawing
  routeCursorPreview: [number, number][] | null  // debounced snapped ghost from last wp → cursor
  dialogState: DialogState
  tableOpen: boolean
  /** True when DataTablePanel's local fullscreen mode is active. Lives in uiStore
   *  so floating editor UI (toolbar, undo/redo, corner buttons) can hide while
   *  the table covers the entire viewport. Ephemeral — not persisted. */
  tableFullscreen: boolean
  sidebarOpen: boolean
  /** True while the editor is narrower than NARROW_EDITOR_WIDTH (its own
   *  width, not the viewport's: it's often embedded). The right-hand panels
   *  (layers panel, docked GeoJSON inspector) then open as overlays on top of
   *  the map and the controls don't move aside for them. Written by the
   *  panels (usePanelOffset). See `sidebarTakesSpace()`. */
  narrow: boolean
  // [south, north, west, east] — set by useBoundaryFromURL, consumed+cleared by BoundaryAutoFit inside MapContainer
  boundaryAutofitBbox: [number, number, number, number] | null
  panelPrefs: PanelPrefs
  /** Id of the feature in vertex edit, or `null`. The source of truth for vertex edit. */
  vertexEditFeatureId: string | null
  /** `vertexEditFeatureId !== null`, kept in step with it (many readers only need the flag). */
  vertexEditActive: boolean
  transformActive: boolean
  transformDragging: boolean
  geometryProcessing: boolean
  simplifyTolerance: number
  smoothIterations: number
  bufferDistance: number
  bufferCreateNew: boolean
  geometryPreview: import('../types/geojson').Geometry | null
  /** Synced from the `readonly` prop: editing UI and shortcuts off. */
  readonly: boolean
  snapEnabled: boolean
  topoEditEnabled: boolean
  /** When true, drawing/measure tools deactivate to 'none' after each commit.
   *  When false, the tool stays active so the user can keep drawing. Default false. */
  autoExitAfterDraw: boolean
  /** True while the `autoExitAfterDraw` prop is set: it wins over the saved setting and the Settings toggle is read-only. */
  autoExitLocked: boolean
  userTheme: 'light' | 'dark' | 'system'
  setUserTheme: (theme: 'light' | 'dark' | 'system') => void
  snappedCoord: [number, number] | null
  /** Pan restriction, canonical GeoJSON bbox `[west, south, east, north]` (see `setBounds`). */
  bounds?: BBox
  shortcutsModalOpen: boolean
  schemaModalOpen: boolean
  codeModalOpen: boolean
  /** Width of the docked GeoJSON inspector (left of the layers panel); 0 when floating or closed. */
  codeDockWidth: number
  sidebarWidth: number
  selectedPartIndex: number | null
  layout: 'panel' | 'minimal' | 'split'
  /** Group id whose name input should auto-focus into rename mode after creation.
   *  Set by the "New group" button and the Cmd+G shortcut, cleared by LayersPanel
   *  once consumed. Survives one render cycle. */
  autoFocusGroupId: string | null
  setAutoFocusGroupId: (id: string | null) => void

  /** Switches the mode and discards any shape in progress. No availability checks (`ref.setTool` does those). */
  setEditingMode: (mode: EditingMode) => void
  setSelectedPartIndex: (index: number | null) => void
  setEnabledTools: (tools: string[] | null) => void
  setUnavailableTools: (tools: string[]) => void
  /** Whether `tool` is offered: in `enabledTools` and not in `unavailableTools`. */
  isToolAvailable: (tool: string) => boolean
  setSidebarWidth: (width: number) => void
  setCodeDockWidth: (width: number) => void
  setLayout: (layout: 'panel' | 'minimal' | 'split') => void
  openShortcutsModal: () => void
  closeShortcutsModal: () => void
  toggleSchemaModal: () => void
  toggleCodeModal: () => void
  setPanelPref: (key: keyof PanelPrefs, value: boolean) => void
  /** `true` puts the single selected feature in vertex edit (nothing when the selection isn't one feature); `false` leaves it. */
  setVertexEditActive: (active: boolean) => void
  /** Puts this feature in vertex edit (`null` leaves it). Doesn't select it or check its geometry: callers do. */
  setVertexEditFeature: (id: string | null) => void
  setTransformActive: (active: boolean) => void
  setTransformDragging: (dragging: boolean) => void
  setGeometryProcessing: (processing: boolean) => void
  setSimplifyTolerance: (v: number) => void
  setSmoothIterations: (v: number) => void
  setBufferDistance: (v: number) => void
  setBufferCreateNew: (v: boolean) => void
  setGeometryPreview: (geom: import('../types/geojson').Geometry | null) => void
  commitGeometryProcess: () => void
  cancelGeometryProcess: () => void
  commitBufferProcess: () => void
  cancelBufferProcess: () => void
  setReadonly: (readonly: boolean) => void
  /**
   * Report a failure through the instance's error sink: the host's `onError`, then `onEvent` or a
   * toast. `quiet`: `onError` only, no toast.
   */
  reportError: (error: ElementEditorError, opts?: { quiet?: boolean }) => void
  setSnapEnabled: (snap: boolean) => void
  setTopoEditEnabled: (enabled: boolean) => void
  setAutoExitAfterDraw: (enabled: boolean) => void
  /** Sync of the `autoExitAfterDraw` prop (`undefined` = unset). Not persisted. */
  setAutoExitProp: (value: boolean | undefined) => void
  setSnappedCoord: (coord: [number, number] | null) => void
  /** Accepts a bbox or the deprecated `[[s, w], [n, e]]` form; always stores a bbox. */
  setBounds: (bounds?: BoundsInput | null) => void
  setBoundaryAutofitBbox: (bbox: [number, number, number, number] | null) => void
  toggleTable: () => void
  setTableFullscreen: (fullscreen: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setNarrow: (narrow: boolean) => void
  commitPoint: (coord: [number, number], prefill?: Record<string, string>) => void
  openEditDialog: (featureId: string, options?: { focusFirstField?: boolean }) => void
  closeDialog: () => void

  addLineVertex: (coord: [number, number]) => void
  removeLastLineVertex: () => void
  commitLine: (properties: Record<string, unknown>) => void
  addPolygonVertex: (coord: [number, number]) => void
  removeLastPolygonVertex: () => void
  commitPolygon: (properties: Record<string, unknown>) => void
  setCircleCenter: (coord: [number, number]) => void
  commitCircle: (center: [number, number], edge: [number, number], properties: Record<string, unknown>) => void
  setRectCorner: (coord: [number, number]) => void
  commitRect: (corner1: [number, number], corner2: [number, number], properties: Record<string, unknown>, isSquare?: boolean) => void
  cancelDrawing: () => void

  commitCutHole: () => void
  commitSliceShape: () => void

  addRouteWaypoint: (coord: [number, number]) => void
  removeLastRouteWaypoint: () => void
  setRoutePreview: (coords: [number, number][] | null, loading: boolean) => void
  setRouteCursorPos: (coord: [number, number] | null) => void
  setRouteCursorPreview: (coords: [number, number][] | null) => void
  commitRoute: () => void

  freehandPoints: [number, number][]
  freehandClosed: boolean
  setFreehandClosed: (closed: boolean) => void
  addFreehandPoint: (coord: [number, number]) => void
  clearFreehandPoints: () => void
  commitFreehand: (epsilon: number) => void

  measurePoints: [number, number][]
  measureMode: 'distance' | 'area'
  completedMeasurements: CompletedMeasurement[]
  selectedMeasurementId: string | null
  setMeasureMode: (mode: 'distance' | 'area') => void
  addMeasurePoint: (coord: [number, number]) => void
  removeLastMeasurePoint: () => void
  removeMeasurement: (id: string) => void
  setSelectedMeasurementId: (id: string | null) => void
  toggleMeasurementSelection: (id: string) => void
  completeMeasure: () => void
}

/** Same position (to ~1 cm): repeated clicks on one spot. */
/** Slice line that didn't split the shape (stops inside it, or misses it): nothing is changed. */
const SLICE_DID_NOT_SPLIT = "The line didn't cut the shape apart, so nothing changed. Draw it all the way across the shape."

const samePoint = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7

/** Below this editor width (px) the layers panel overlays the map instead of sitting beside it. */
export const NARROW_EDITOR_WIDTH = 640

/** The open layers panel takes room from the map (panel layout, open, editor not narrow). Callers also check `ui.layerList`. */
export const sidebarTakesSpace = (s: Pick<UIStore, 'layout' | 'sidebarOpen' | 'narrow'>) =>
  s.layout === 'panel' && s.sidebarOpen && !s.narrow

export function makeCircleCoords(center: [number, number], edge: [number, number], mode: 'visual' | 'spatial', steps = 64): [number, number][] {
  if (mode === 'visual') {
    const pCenter = project(center)
    const pEdge = project(edge)
    const radiusProj = Math.hypot(pEdge[0] - pCenter[0], pEdge[1] - pCenter[1])
    
    const ring: [number, number][] = Array.from({ length: steps }, (_, i) => {
      const angle = (2 * Math.PI * i) / steps
      return unproject([pCenter[0] + radiusProj * Math.cos(angle), pCenter[1] + radiusProj * Math.sin(angle)])
    })
    ring.push(ring[0])
    return ring
  } else {
    const radiusKm = turfDistance(turfPoint(center), turfPoint(edge))
    const ring: [number, number][] = Array.from({ length: steps }, (_, i) => {
      const bearing = (i * 360) / steps
      const p = turfDestination(turfPoint(center), radiusKm, bearing)
      return p.geometry.coordinates as [number, number]
    })
    ring.push(ring[0])
    return ring
  }
}

export function makeRectCoords(c1: [number, number], c2: [number, number], mode: 'visual' | 'spatial', isSquare = false): [number, number][] {
  if (mode === 'visual') {
    const p1 = project(c1)
    const p2 = project(c2)
    let [px2, py2] = p2

    if (isSquare) {
      const dx = px2 - p1[0]
      const dy = py2 - p1[1]
      const maxDist = Math.max(Math.abs(dx), Math.abs(dy), 1e-10)
      px2 = p1[0] + (dx >= 0 ? 1 : -1) * maxDist
      py2 = p1[1] + (dy >= 0 ? 1 : -1) * maxDist
    }

    return [
      c1,
      unproject([px2, p1[1]]),
      unproject([px2, py2]),
      unproject([p1[0], py2]),
      c1
    ]
  } else {
    const [lng1, lat1] = c1
    let [lng2, lat2] = c2

    if (isSquare) {
      const dx = lng2 - lng1
      const dy = lat2 - lat1
      const maxDist = Math.max(Math.abs(dx), Math.abs(dy), 1e-10)
      lng2 = lng1 + (dx >= 0 ? 1 : -1) * maxDist
      lat2 = lat1 + (dy >= 0 ? 1 : -1) * maxDist
    }

    return [[lng1, lat1], [lng2, lat1], [lng2, lat2], [lng1, lat2], [lng1, lat1]]
  }
}

export interface UIStoreOptions {
  /** Called when a geometry operation (or anything reported with `reportError`) fails. Defaults to console.error. */
  onError?: (error: ElementEditorError, opts?: { quiet?: boolean }) => void
  /** Storage scope for the persisted preferences (theme, settings toggles, panel prefs/width). */
  persist?: PersistScope
}

export const createUIStore = (dataStore: StoreApi<DataStore>, options?: UIStoreOptions) => create<UIStore>((set, get) => {
  const reportError = options?.onError ?? ((err: ElementEditorError) => console.error(err))
  const scope = options?.persist
  const read = (key: string) => readStorage(key, scope)
  const write = (key: string, value: string) => writeStorage(key, value, scope)
  /** Shared post-commit cleanup: reset drawing mode, clear tool-specific state, select the new feature.
   *  When `autoExitAfterDraw` is true (off by default), also drops the active tool back to 'none' so the user
   *  returns to select mode after each shape (Settings → "Return to select after each shape"). */
  function finishDrawing(feature: GeoJSONFeature, toolState: Partial<UIStore> = {}) {
    // Over `maxFeatures`: addFeature reports the limit; keep the in-progress
    // shape so the user can delete something and finish, or Esc.
    if (!dataStore.getState().addFeature(feature, { draw: true })) { set({ dialogState: { type: 'closed' } as DialogState }); return }
    const exit = get().autoExitAfterDraw
    const patch: Partial<UIStore> = {
      dialogState: { type: 'closed' } as DialogState,
      ...(exit ? { editingMode: 'none' as EditingMode } : {}),
      ...toolState,
    }
    set(patch as Partial<UIStore>)
  }

  // Auto-clear selectedPartIndex when feature selection changes
  let prevSelectedIds: string[] = []
  dataStore.subscribe((state) => {
    if (state.selectedIds !== prevSelectedIds) {
      prevSelectedIds = state.selectedIds
      if (get().selectedPartIndex !== null) set({ selectedPartIndex: null })
      // Nothing selected (deselect, delete, an undo that removed the feature): vertex edit and
      // transform end too, so the next click doesn't drop straight into a stale mode.
      if (state.selectedIds.length === 0 && (get().vertexEditActive || get().transformActive)) {
        set({ vertexEditFeatureId: null, vertexEditActive: false, transformActive: false })
      }
    }
  })

  // Piggyback completed measurements on dataStore's undo/redo timeline so
  // creating, completing, or removing a measurement participates in the
  // global Cmd+Z stack. We only mirror `completedMeasurements` — selection
  // and in-progress points are ephemeral UI state.
  dataStore.getState().setUndoExtrasHandlers(
    () => ({ measurements: get().completedMeasurements }),
    (extras) => {
      const e = extras as { measurements?: CompletedMeasurement[] } | undefined
      if (e && Array.isArray(e.measurements)) {
        set({ completedMeasurements: e.measurements, selectedMeasurementId: null })
      }
    },
  )

  return ({
  userTheme: (() => { const v = read('elm_theme'); return (v === 'light' || v === 'dark' || v === 'system') ? v : 'system' })(),
  setUserTheme: (theme) => {
    write('elm_theme', theme)
    set({ userTheme: theme })
  },
  showMeasurements: read('elm_showMeasurements') === 'true',
  setShowMeasurements: (show) => {
    write('elm_showMeasurements', String(show))
    set({ showMeasurements: show })
  },
  showFeatureNameOnHover: read('elm_showFeatureNameOnHover') !== 'false',
  setShowFeatureNameOnHover: (show) => {
    write('elm_showFeatureNameOnHover', String(show))
    set({ showFeatureNameOnHover: show })
  },
  editingMode: 'none',
  enabledTools: null,
  unavailableTools: [],
  lineInProgress: [],
  polygonInProgress: [],
  circleCenter: null,
  rectCorner: null,
  routeWaypoints: [],
  routePreview: null,
  routeLoading: false,
  routeCursorPos: null,
  routeCursorPreview: null,
  freehandPoints: [],
  freehandClosed: false,
  setFreehandClosed: (closed) => set({ freehandClosed: closed }),
  measurePoints: [],
  measureMode: 'distance',
  completedMeasurements: [],
  selectedMeasurementId: null,
  dialogState: { type: 'closed' },
  tableOpen: false,
  tableFullscreen: false,
  sidebarOpen: true,
  narrow: false,
  boundaryAutofitBbox: null,
  panelPrefs: loadPanelPrefs(scope),
  vertexEditFeatureId: null,
  vertexEditActive: false,
  transformActive: false,
  transformDragging: false,
  geometryProcessing: false,
  simplifyTolerance: 40,
  smoothIterations: 2,
  bufferDistance: 100,
  bufferCreateNew: true,
  geometryPreview: null,
  readonly: false,
  snapEnabled: true,
  topoEditEnabled: read('elm_topoEditEnabled') !== 'false',
  // Default: tools stay active after each commit. Stored absent → false; only an
  // explicit 'true' (the user turned it on) returns to select after each shape.
  autoExitAfterDraw: read('elm_autoExitAfterDraw') === 'true',
  autoExitLocked: false,
  snappedCoord: null,
  bounds: undefined,
  settingsModalOpen: false,
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
  zoomEditing: false,
  setZoomEditing: (editing) => set({ zoomEditing: editing }),
  shortcutsModalOpen: false,
  schemaModalOpen: false,
  codeModalOpen: false,
  codeDockWidth: 0,
  sidebarWidth: parseInt(read('elm_panel_width') ?? '', 10) || 288,
  layout: 'panel',
  selectedPartIndex: null,
  autoFocusGroupId: null,
  setAutoFocusGroupId: (id) => set({ autoFocusGroupId: id }),

  // Switching tools discards every tool's draft (route waypoints, freehand and measure points included).
  setEditingMode: (mode) => set({
    editingMode: mode, lineInProgress: [], polygonInProgress: [], circleCenter: null, rectCorner: null, geometryPreview: null,
    routeWaypoints: [], routePreview: null, routeLoading: false, routeCursorPos: null, routeCursorPreview: null,
    freehandPoints: [], measurePoints: [],
  }),
  setEnabledTools: (tools) => set({ enabledTools: tools }),
  setUnavailableTools: (tools) => set((s) => (s.unavailableTools.join() === tools.join() ? s : { unavailableTools: tools })),
  isToolAvailable: (tool) => {
    const s = get()
    if ((s.enabledTools && !s.enabledTools.includes(tool)) || s.unavailableTools.includes(tool)) return false
    // `geometryTypes`: a tool none of whose output types is allowed can't produce anything the editor accepts.
    const need = TOOL_GEOMETRY_TYPES[tool]
    if (need) {
      const ds = dataStore.getState()
      if (ds.geometryTypes && !need.some((t) => ds.isGeometryTypeAllowed(t))) return false
    }
    return true
  },
  openShortcutsModal: () => set({ shortcutsModalOpen: true }),
  closeShortcutsModal: () => set({ shortcutsModalOpen: false }),
  toggleSchemaModal: () => set((s) => ({ schemaModalOpen: !s.schemaModalOpen })),
  toggleCodeModal: () => set((s) => ({ codeModalOpen: !s.codeModalOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setCodeDockWidth: (width) => set({ codeDockWidth: width }),
  setLayout: (layout) => set({ layout }),
  setSelectedPartIndex: (index) => set({ selectedPartIndex: index }),
  setVertexEditActive: (active) => {
    const sel = dataStore.getState().selectedIds
    get().setVertexEditFeature(active && sel.length === 1 ? sel[0] : null)
  },
  setVertexEditFeature: (id) => {
    if (get().vertexEditFeatureId === id) return
    set({ vertexEditFeatureId: id, vertexEditActive: id !== null })
  },
  setTransformActive: (active) => set({ transformActive: active }),
  setTransformDragging: (dragging) => set({ transformDragging: dragging }),
  setGeometryProcessing: (processing) => set({ geometryProcessing: processing }),
  setSimplifyTolerance: (v) => set({ simplifyTolerance: v }),
  setSmoothIterations: (v) => set({ smoothIterations: v }),
  setBufferDistance: (v) => set({ bufferDistance: v }),
  setBufferCreateNew: (v) => set({ bufferCreateNew: v }),
  setGeometryPreview: (geom) => set({ geometryPreview: geom }),
  commitGeometryProcess: () => {
    const { geometryPreview } = get()
    if (!geometryPreview) return
    const ds = dataStore.getState()
    const targetId = ds.selectedIds[0]
    if (!targetId) return
    // Refused (reported) before the snapshot, so a refusal leaves no undo step.
    if (!ds.canUseGeometryTypes([geometryPreview.type], 'geometry')) { set({ editingMode: 'none', geometryPreview: null }); return }
    ds.takeSnapshot()
    ds.updateFeature(targetId, freeGeometry(geometryPreview as GeoJSONFeature['geometry']))
    set({ editingMode: 'none', geometryPreview: null })
  },
  cancelGeometryProcess: () => set({ editingMode: 'none', geometryPreview: null }),
  commitBufferProcess: () => {
    const { geometryPreview, bufferCreateNew } = get()
    if (!geometryPreview) return
    const ds = dataStore.getState()
    const targetId = ds.selectedIds[0]
    if (!targetId) return
    if (bufferCreateNew && !ds.canAddFeatures(1)) return
    if (!ds.canUseGeometryTypes([geometryPreview.type], 'geometry')) { set({ editingMode: 'none', geometryPreview: null }); return }
    ds.takeSnapshot()
    if (bufferCreateNew) {
      const source = ds.features.find(f => f.id === targetId)
      const bufferedType = (geometryPreview as GeoJSONFeature['geometry']).type
      const sourceName = (typeof source?.properties?.name === 'string' && source.properties.name)
        ? source.properties.name
        : bufferedType
      const newFeature: GeoJSONFeature = {
        type: 'Feature',
        id: crypto.randomUUID(),
        schemaId: source?.schemaId ?? ds.getDefaultSchema().id,
        // freeGeometry: a route's `_waypoints` isn't inherited by the buffer polygon.
        ...freeGeometry(geometryPreview as GeoJSONFeature['geometry']),
        // Inherit source properties so schema-driven fields carry over, but override
        // the name to "<source> (buffer)" so the layers panel makes it obvious which
        // shape is the derived one.
        properties: { ...(source?.properties ?? {}), name: `${sourceName} (buffer)` },
      }
      // Place the buffered shape directly below its source in the layer list
      // rather than at the top — visually it's a derived child of the source.
      // skipSnapshot — takeSnapshot() above already captured the pre-buffer
      // state, so the whole buffer-as-new is a single undo step.
      ds.addFeature(newFeature, { insertAfterId: targetId, skipSnapshot: true })
    } else {
      ds.updateFeature(targetId, freeGeometry(geometryPreview as GeoJSONFeature['geometry']))
    }
    set({ editingMode: 'none', geometryPreview: null })
  },
  cancelBufferProcess: () => set({ editingMode: 'none', geometryPreview: null }),
  setReadonly: (readonly) => set({ readonly }),
  reportError: (error, opts) => reportError(error, opts),
  setSnapEnabled: (snap) => set({ snapEnabled: snap }),
  setTopoEditEnabled: (enabled) => {
    write('elm_topoEditEnabled', String(enabled))
    set({ topoEditEnabled: enabled })
  },
  setAutoExitProp: (value) => {
    // A prop value wins over the saved preference and is never written to storage; unset restores the saved one.
    if (value === undefined) set({ autoExitLocked: false, autoExitAfterDraw: read('elm_autoExitAfterDraw') === 'true' })
    else set({ autoExitLocked: true, autoExitAfterDraw: value })
  },
  setAutoExitAfterDraw: (enabled) => {
    if (get().autoExitLocked) return
    write('elm_autoExitAfterDraw', String(enabled))
    set({ autoExitAfterDraw: enabled })
  },
  setSnappedCoord: (coord) => set((state) => {
    if (!state.snappedCoord && !coord) return state
    if (state.snappedCoord && coord && state.snappedCoord[0] === coord[0] && state.snappedCoord[1] === coord[1]) return state
    return { snappedCoord: coord }
  }),
  setBounds: (bounds) => set({ bounds: normalizeBounds(bounds) }),
  setPanelPref: (key, value) => set((state) => {
    const prefs = { ...state.panelPrefs, [key]: value }
    writePersisted(PANEL_PREFS_KEY, PANEL_PREFS_VERSION, prefs, scope)
    return { panelPrefs: prefs }
  }),
  setBoundaryAutofitBbox: (bbox) => set({ boundaryAutofitBbox: bbox }),
  toggleTable: () => set((state) => ({ tableOpen: !state.tableOpen, tableFullscreen: false })),
  setTableFullscreen: (fullscreen) => set({ tableFullscreen: fullscreen }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setNarrow: (narrow) => set({ narrow }),

  commitPoint: (coord, prefill) => {
    const ds = dataStore.getState()
    const schema = ds.getDefaultSchema()
    const properties: Record<string, unknown> = { ...prefill }
    for (const field of schema.fields) {
      if (properties[field.key] === undefined) {
        properties[field.key] = ''
      }
    }
    const feature: import('../types/geojson').GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: schema.id,
      geometry: { type: 'Point', coordinates: coord },
      properties,
    }
    finishDrawing(feature)
  },

  openEditDialog: (featureId, options) => {
    dataStore.getState().selectFeature(featureId)
    set({ dialogState: { type: 'edit', featureId, focusFirstField: options?.focusFirstField } })
  },

  closeDialog: () => set({ dialogState: { type: 'closed' } }),

  addLineVertex: (coord) =>
    set((state) => ({ lineInProgress: [...state.lineInProgress, coord] })),

  removeLastLineVertex: () =>
    set((state) => ({ lineInProgress: state.lineInProgress.slice(0, -1) })),

  commitLine: (properties) => {
    const { lineInProgress } = get()
    if (lineInProgress.length < 2) return
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: dataStore.getState().getDefaultSchema().id,
      geometry: { type: 'LineString', coordinates: lineInProgress },
      properties,
    }
    finishDrawing(feature, { lineInProgress: [] })
  },

  addPolygonVertex: (coord) =>
    set((state) => ({ polygonInProgress: [...state.polygonInProgress, coord] })),

  removeLastPolygonVertex: () =>
    set((state) => ({ polygonInProgress: state.polygonInProgress.slice(0, -1) })),

  commitPolygon: (properties) => {
    const { polygonInProgress } = get()
    if (polygonInProgress.length < 3) return
    // Close the ring: GeoJSON requires first === last
    const ring: [number, number][] = [...polygonInProgress, polygonInProgress[0]]
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: dataStore.getState().getDefaultSchema().id,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties,
    }
    finishDrawing(feature, { polygonInProgress: [] })
  },

  setCircleCenter: (coord) => set({ circleCenter: coord }),

  commitCircle: (center, edge, properties) => {
    const ring = makeCircleCoords(center, edge, dataStore.getState().geometryMode)
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: dataStore.getState().getDefaultSchema().id,
      _drawType: 'circle',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties,
    }
    finishDrawing(feature, { circleCenter: null })
  },

  setRectCorner: (coord) => set({ rectCorner: coord }),

  commitRect: (corner1, corner2, properties, isSquare = false) => {
    const ring = makeRectCoords(corner1, corner2, dataStore.getState().geometryMode, isSquare)
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: dataStore.getState().getDefaultSchema().id,
      _drawType: 'rectangle',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties,
    }
    finishDrawing(feature, { rectCorner: null })
  },

  commitCutHole: async () => {
    const { polygonInProgress } = get()
    if (polygonInProgress.length < 3) return
    const ds = dataStore.getState()
    const targetId = ds.selectedIds.length === 1 ? ds.selectedIds[0] : null
    const target = ds.features.find(f => f.id === targetId)
    if (!target || (target.geometry.type !== 'Polygon' && target.geometry.type !== 'MultiPolygon')) {
      set({ polygonInProgress: [], editingMode: 'none' })
      return
    }

    if (get().geometryProcessing) return // a cut / slice is already running (worker round trip)
    const ring = [...polygonInProgress, polygonInProgress[0]]
    // Leave the tool before the (async) work, so a second Enter can't commit the same ring twice.
    set({ geometryProcessing: true, polygonInProgress: [], editingMode: 'none' })
    try {
      // Off the main thread when @element-editor/ui registered its worker (seconds on a 50k-vertex shape).
      const runner = getGeometryRunner()
      const targetPoly = { type: 'Feature', geometry: target.geometry, properties: {} } as Feature<Polygon | MultiPolygon>
      let geometry: Geometry
      if (runner) {
        geometry = await runner({ type: 'cut-hole', target: targetPoly, ring })
      } else {
        // Loaded on use: the polygon clipper (+ bignumber.js) is ~30 KB gzip that first paint never needs.
        const { difference } = await import('@turf/difference')
        const diff = difference(featureCollection([targetPoly, polygon([ring])]))
        if (!diff?.geometry) throw new Error('Failed to cut hole: resulting shape is empty or invalid.')
        geometry = diff.geometry
      }

      // Re-read fresh state — target may have been deleted/deselected during async op
      const freshDs = dataStore.getState()
      if (!freshDs.features.some(f => f.id === targetId)) {
        reportError(new ElementEditorError('geometry', 'geometry', 'Target feature was removed during operation', { featureId: targetId! }))
        return
      }

      if (!freshDs.canUseGeometryTypes([geometry.type], 'geometry')) return
      freshDs.takeSnapshot()
      freshDs.updateFeature(targetId!, freeGeometry(geometry as GeoJSONFeature['geometry']))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Couldn\'t cut the hole. Draw it inside the shape and try again.'
      reportError(new ElementEditorError('geometry', 'geometry', message, { cause: err, featureId: targetId! }))
    } finally {
      set({ geometryProcessing: false })
    }
  },

  commitSliceShape: async () => {
    const { lineInProgress } = get()
    if (lineInProgress.length < 2) return
    const ds = dataStore.getState()
    const targetId = ds.selectedIds.length === 1 ? ds.selectedIds[0] : null
    const target = ds.features.find(f => f.id === targetId)
    if (!target || (target.geometry.type !== 'Polygon' && target.geometry.type !== 'MultiPolygon')) {
      set({ lineInProgress: [], editingMode: 'none' })
      return
    }

    if (get().geometryProcessing) return // a cut / slice is already running (worker round trip)
    // Leave the tool before the (async) work, so a second Enter can't commit the same line twice.
    set({ geometryProcessing: true, lineInProgress: [], editingMode: 'none' })
    try {
      // Off the main thread when @element-editor/ui registered its worker (seconds on a 50k-vertex shape).
      const runner = getGeometryRunner()
      const targetPoly = { type: 'Feature', geometry: target.geometry, properties: {} } as Feature<Polygon | MultiPolygon>
      let geometry: Geometry
      if (runner) {
        geometry = await runner({ type: 'slice-shape', target: targetPoly, line: lineInProgress })
      } else {
        // Loaded on use: @turf/buffer pulls in JSTS + d3-geo (~70 KB gzip), the clipper ~30 KB.
        const [{ buffer }, { difference }] = await Promise.all([import('@turf/buffer'), import('@turf/difference')])
        const bufferedLine = buffer(lineString(lineInProgress), 0.01, { units: 'meters', steps: 1 })
        const split = difference(featureCollection([targetPoly, bufferedLine as Feature<Polygon | MultiPolygon>]))
        if (!split?.geometry) throw new Error('Failed to slice shape: result is empty')
        geometry = split.geometry
      }

      // Re-read fresh state — target may have been deleted/deselected during async op
      const freshDs = dataStore.getState()
      if (!freshDs.features.some(f => f.id === targetId)) {
        reportError(new ElementEditorError('geometry', 'geometry', 'Target feature was removed during operation', { featureId: targetId! }))
        return
      }

      if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
        reportError(new ElementEditorError('geometry', 'geometry', 'Failed to slice shape: result is not polygonal', { featureId: targetId! }))
        return
      }
      // A slice only counts when the shape actually falls apart into more pieces than it had.
      // A line that stops inside (or misses) the shape leaves the same number of pieces, merely
      // notched by the 0.01 m cut: change nothing then (no store write, no undo step), just say so.
      const partsBefore = target.geometry.type === 'MultiPolygon' ? target.geometry.coordinates.length : 1
      const partsAfter = geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1
      if (partsAfter <= partsBefore) {
        reportError(new ElementEditorError('geometry', 'geometry', SLICE_DID_NOT_SPLIT, { featureId: targetId! }))
        return
      }

      if (!freshDs.canAddFeatures(partsAfter - 1)) return
      if (!freshDs.canUseGeometryTypes(['Polygon'], 'geometry')) return // every piece becomes its own Polygon
      freshDs.takeSnapshot()
      if (geometry.type === 'MultiPolygon') {
        const coords = geometry.coordinates as [number, number][][][]
        freshDs.updateFeature(targetId!, freeGeometry({ type: 'Polygon', coordinates: coords[0] }))

        for (let i = 1; i < coords.length; i++) {
          const feat: GeoJSONFeature = {
            ...target,
            id: crypto.randomUUID(),
            ...freeGeometry({ type: 'Polygon', coordinates: coords[i] }),
          }
          // skipSnapshot — the takeSnapshot above already captured the
          // pre-slice state, so the whole slice is a single undo step.
          freshDs.addFeature(feat, { skipSnapshot: true })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to slice shape. Try drawing a simpler line completely across the shape.'
      reportError(new ElementEditorError('geometry', 'geometry', message, { cause: err, featureId: targetId! }))
    } finally {
      set({ geometryProcessing: false })
    }
  },

  cancelDrawing: () => set((state) => {
    if (state.editingMode === 'measure') {
      // Always exit; keep completedMeasurements, clear any in-progress points
      return { editingMode: 'none', measurePoints: [] }
    }
    const hasProgress = state.lineInProgress.length > 0 || state.polygonInProgress.length > 0 || state.circleCenter || state.rectCorner || state.routeWaypoints.length > 0 || state.freehandPoints.length > 0
    if (hasProgress) {
      return { lineInProgress: [], polygonInProgress: [], circleCenter: null, rectCorner: null, routeWaypoints: [], routePreview: null, routeLoading: false, routeCursorPos: null, routeCursorPreview: null, freehandPoints: [] }
    } else {
      return { editingMode: 'none' }
    }
  }),

  addRouteWaypoint: (coord) =>
    set((state) => ({ routeWaypoints: [...state.routeWaypoints, coord] })),

  removeLastRouteWaypoint: () =>
    set((state) => ({
      routeWaypoints: state.routeWaypoints.slice(0, -1),
      routePreview: null,
      routeCursorPreview: null,
    })),

  setRoutePreview: (coords, loading) =>
    set({ routePreview: coords, routeLoading: loading }),

  setRouteCursorPos: (coord) => set({ routeCursorPos: coord }),

  setRouteCursorPreview: (coords) => set({ routeCursorPreview: coords }),

  commitRoute: () => {
    const { routeWaypoints, routePreview } = get()
    if (routeWaypoints.length < 2) return
    // Use snapped path if available, otherwise straight lines between waypoints
    const coordinates = routePreview ?? routeWaypoints
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: dataStore.getState().getDefaultSchema().id,
      _drawType: 'route',
      geometry: { type: 'LineString', coordinates },
      properties: { _waypoints: routeWaypoints },
    }
    finishDrawing(feature, {
      routeWaypoints: [],
      routePreview: null,
      routeLoading: false,
      routeCursorPos: null,
      routeCursorPreview: null,
    })
  },

  addFreehandPoint: (coord) =>
    set((state) => ({ freehandPoints: [...state.freehandPoints, coord] })),

  clearFreehandPoints: () => set({ freehandPoints: [] }),

  commitFreehand: (epsilon) => {
    const { freehandPoints, freehandClosed } = get()
    
    const minPts = freehandClosed ? 3 : 2
    if (freehandPoints.length < minPts) return
    
    const simplified = rdp(freehandPoints, epsilon)
    if (simplified.length < minPts) return
    
    let geometry: GeoJSONFeature['geometry']
    if (freehandClosed) {
      const ring: [number, number][] = [...simplified, simplified[0]]
      geometry = { type: 'Polygon', coordinates: [ring] }
    } else {
      geometry = { type: 'LineString', coordinates: simplified }
    }

    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: dataStore.getState().getDefaultSchema().id,
      geometry,
      properties: {},
    }
    
    finishDrawing(feature, { freehandPoints: [] })
  },

  setMeasureMode: (mode) => set({ measureMode: mode }),

  // A click on the point just placed (the first half of a finishing
  // double-click, a repeat click) adds nothing: a zero-length segment would
  // leave a "0 m" label on the last point.
  addMeasurePoint: (coord) =>
    set((state) => {
      const last = state.measurePoints[state.measurePoints.length - 1]
      return last && samePoint(last, coord) ? {} : { measurePoints: [...state.measurePoints, coord] }
    }),

  removeLastMeasurePoint: () =>
    set((state) => ({ measurePoints: state.measurePoints.slice(0, -1) })),

  removeMeasurement: (id) => {
    // Snapshot before the change so Cmd+Z restores the deleted measurement.
    dataStore.getState().takeSnapshot()
    set((state) => ({
      completedMeasurements: state.completedMeasurements.filter((m) => m.id !== id),
      selectedMeasurementId: state.selectedMeasurementId === id ? null : state.selectedMeasurementId,
    }))
  },
  setSelectedMeasurementId: (id) => set({ selectedMeasurementId: id }),
  toggleMeasurementSelection: (id) =>
    set((state) => ({ selectedMeasurementId: state.selectedMeasurementId === id ? null : id })),

  completeMeasure: () => {
    const state = get()
    const minPts = state.measureMode === 'area' ? 3 : 2
    if (state.measurePoints.length < minPts) return
    const pts = state.measureMode === 'area'
      ? [...state.measurePoints, state.measurePoints[0]]
      : state.measurePoints.filter((p, i, all) => i === 0 || !samePoint(all[i - 1], p))
    const newMeasurement: CompletedMeasurement = {
      id: crypto.randomUUID(),
      points: pts,
      mode: state.measureMode,
    }
    // Snapshot the pre-create state so Cmd+Z removes the new measurement.
    dataStore.getState().takeSnapshot()
    set({
      completedMeasurements: [...state.completedMeasurements, newMeasurement],
      measurePoints: [],
      selectedMeasurementId: newMeasurement.id,
      ...(state.autoExitAfterDraw ? { editingMode: 'none' as EditingMode } : {}),
    })
  },
})})

