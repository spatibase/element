/**
 * @element-editor/core/internal
 *
 * Unstable, no semver guarantees; for @element-editor/* packages only.
 * Plumbing the other Element packages share (geometry math, topology, click guards, the shortcut
 * cache, picker tile helpers, …). Anything here may change or disappear in any release, including
 * a patch. Don't import it from application code: the public API is `@element-editor/core`.
 *
 * Both entries share one copy of every module (common chunks), so module state such as the
 * shortcut cache or the geometry runner is the same whichever entry set it.
 */

// Mercator / geometry math
export {
  project,
  unproject,
  toRadians,
  getMercatorLatCorrectionRatio,
  applyVisualTransform,
  translateGeometryVisually,
} from './mercator'
export { mapPositions, withXY, insertedPosition } from './utils/positions'
export { translateGeometrySpatially } from './utils/spatial'
export { rdp } from './utils/rdp'
export { normalizeFitBoundsTarget } from './utils/geojson'
export { normalizeBounds, normalizeFlyToTarget } from './utils/coords'
export { warnOnce, isDevBuild } from './utils/warnOnce'

// Multi-geometry parts
export {
  isMultiGeometry,
  getPartCount,
  getPartGeometry,
  setPartGeometry,
  getPartBBox,
  getPartLabel,
  offsetSimpleGeometry,
  offsetGeometry,
} from './utils/multiGeometry'

// Simplify / Smooth / Buffer eligibility
export { canProcessShape, isLineGeometryType, countShapeVertices } from './utils/shapeProcessing'

// Topology (shared vertices / edges)
export {
  findTopologicalNeighbors,
  groupNeighborsByFeature,
  applyTopoMove,
  commitTopoMove,
  commitTopoInsert,
  commitTopoDelete,
  transformUpdates,
  neighbourPatch,
} from './utils/topology'
export type { NeighborVertex, TopoUpdate } from './utils/topology'

// Floating-box placement (tooltips, cursor hints)
export { placeBox } from './utils/placeBox'
export type { PlaceMode, PlaceBounds } from './utils/placeBox'

// Click handling
export { createClickRepeatGuard, CLICK_SLOP_PX, CLICK_TOOL_MODES } from './utils/clickRepeat'
export { isTouchEvent, lastPointerWasTouch, subscribeLastPointer, attachLongPress, TOUCH_HIT_PX, TOUCH_HANDLE_CSS, LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from './utils/touch'

// Error codes from HTTP status / load failures
export { httpErrorCode, loadErrorCode } from './utils/errors'

// Picker (OSM / vector tiles)
export {
  tileCandidates,
  tileCandidateResult,
  unionPieces,
  overpassRadiusForZoom,
  addPickedFeature,
  OSM_PICK_MIN_ZOOM,
  OSM_PICK_OVERLAY_COLORS,
} from './utils/overpass'
export type { TileFeature, TileCandidate } from './utils/overpass'

// Routing / network plumbing
export { routingError, routingAttribution } from './utils/routing'
export { overrideSource, OSM_ATTRIBUTION } from './utils/network'

// Schemas
export { DEFAULT_SCHEMAS, BOUNDARIES_SCHEMA_ID, FIELD_TYPES, slugify, uniqueKey } from './utils/schema'

// Shortcut bindings + cache
export {
  CUSTOMIZABLE_SHORTCUTS,
  FIXED_SHORTCUTS,
  loadCustomBindings,
  saveCustomBindings,
  getEffectiveKey,
  findConflict,
  syncShortcutCache,
  getCurrentKey,
} from './shortcuts'
export type { CustomizableShortcut } from './shortcuts'

// Geometry worker protocol + the stores' off-main-thread runner (ui registers its worker client)
export type { GeometryWorkerRequest, GeometryWorkerResponse } from './types/geometryWorker'
export { setGeometryRunner } from './utils/geometryRunner'
export type { GeometryRunner } from './utils/geometryRunner'

// Store helpers
export { ALL_GEOMETRY_TYPES, TOOL_GEOMETRY_TYPES, geometryTypeMessage, mergeResultType, breakResultTypes } from './utils/geometryTypes'
export { canVertexEdit, featureLimitMessage, freeGeometry, vertexEditNotice, vertexEditPatch } from './store/dataStore'
export { makeCircleCoords, makeRectCoords, NARROW_EDITOR_WIDTH, sidebarTakesSpace } from './store/uiStore'
export { resolveUnitSystem } from './utils/format'

// Map insets: the part of the map the editor's panels cover (fit padding, centring)
export { coveredMapInsets, fitPadding, visibleCenterOffset } from './utils/mapInsets'
export type { MapInsets } from './utils/mapInsets'

// Default feature colour on a dark basemap
export { DEFAULT_FEATURE_COLOR_ON_DARK } from './utils/accent'
