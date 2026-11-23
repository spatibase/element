import './index.css'

// Store provider + hooks
export { GeoStoreProvider, StoreContext } from './store/StoreContext'
export { useDataStore, useUIStore, useGeoStore } from './store/StoreContext'

// Map controller context
export { MapControllerProvider, useMapController, useSetMapController } from './contexts/MapControllerContext'
export type { MapController } from './contexts/MapControllerContext'

// Main component
export { ElementEditorControls, useMapLibre } from './ElementEditorControls'
export type { ElementEditorControlsProps, ElementEditorControlsRef, DrawingTool } from './ElementEditorControls'

// Basemap switcher (the catalog itself lives in the lazy `@element-editor/adapter-maplibre/basemaps` entry)
export { BasemapControl, useBasemap } from './BasemapControl'
export type { BasemapControlProps } from './BasemapControl'

// UI provider + config types
export { ElementEditorUIProvider } from '@element-editor/ui'
export { ElementEditorError } from '@element-editor/core'
export type { ElementEditorEvent, ElementEditorErrorHandler, ErrorCode, ErrorSource } from '@element-editor/ui'
export type { ElementEditorUIProviderProps } from '@element-editor/ui'
export type { ElementEditorConfig, FeatureTooltipOptions, ResolvedConfig, ToolbarPosition } from '@element-editor/ui'

// Per-feature style override
export { FeatureStyleProvider, useFeatureStyle } from './contexts/FeatureStyleContext'
export type { FeatureStyle, FeatureStyleFn, FeatureStyleState } from './contexts/FeatureStyleContext'

// UI toolbars (require ElementEditorUIProvider + GeoStoreProvider in tree)
export { FloatingToolbar, EditingToolbar, ActiveDrawingToolbar, useKeyboardShortcuts } from '@element-editor/ui'

// Individual layer components (for advanced usage). Element adds their GL sources and layers
// itself (ensureElementLayers), so they only work under ElementEditorControls' map.
export { default as FeatureLayer } from './components/FeatureLayer'
export { default as DrawingLayer } from './components/DrawingLayer'
export { default as DrawingPreviewLayer } from './components/DrawingPreviewLayer'
export { default as FeatureInteractionLayer } from './components/FeatureInteractionLayer'
export { default as VertexEditor } from './components/VertexEditor'
export { default as TransformControls } from './components/TransformControls'
export { default as SnapController } from './components/SnapController'
export { default as BoundaryLayer, FitBounds } from './components/BoundaryLayer'
export { default as GeometryProcessingPreview } from './components/GeometryProcessingPreview'
export { default as MeasurePreviewLayer } from './components/MeasurePreviewLayer'
export { default as MeasurementTooltip } from './components/MeasurementTooltip'
export { default as OsmTraceHandler } from './components/OsmTraceHandler'
export { default as BoxSelectHandler } from './components/BoxSelectHandler'

// Utilities
export { findSnapPoint, snapToAngle } from './utils/snapping'
