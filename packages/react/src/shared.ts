// Engine-neutral public API, re-exported by both entries (`@element-editor/react` and `/leaflet`).
export type { ElementEditorConfig, DrawTool, LayoutSlot, LayoutControl, LayoutGroup, LayoutEntry, LayoutSlotConfig, LayoutConfig, MapSlot, StatusSlot, MapGroup, StatusGroup, MapEntry, StatusEntry, MapSlotConfig, StatusSlotConfig, LayoutPatch, SlotFor, RasterBasemap } from '@element-editor/ui'
export { DEFAULT_LAYOUT, withLayout } from '@element-editor/ui'
export type { FeatureCollection, GeoJSONFeature, FeatureCollectionInput, GeoJSONFeatureInput, GeometryInput, Schema, SchemaField, Group, Geometry, EditingMode } from './types/geojson'
export type { ElementEditorEvent, ElementEditorErrorHandler, ErrorCode, ErrorSource } from '@element-editor/ui'
// Option / result types of the ref methods.
export type { MutationOptions, SetFeatureCollectionOptions, ValidationReport } from '@element-editor/ui'
export { ElementEditorError } from '@element-editor/core'
export { IconButton, Tooltip } from '@element-editor/ui'
export { accentPalette, DEFAULT_ACCENT, ACCENT_STEPS } from '@element-editor/core'
export type { AccentShade, GeometryType } from '@element-editor/core'
// Return shape of `getFeatureStyle` (type-only; works for both engines).
export type { FeatureStyle, FeatureStyleState, SelectionStyle } from '@element-editor/core'
export type { ElementEditorBaseProps } from './shell/types'
export type { InitialView } from './shell/savedView'
export type { BBox, BoundsInput, CoordinateOptions, FlyToOptions } from '@element-editor/core'
