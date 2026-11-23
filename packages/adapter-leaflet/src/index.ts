import './index.css'

// Provider + store hooks
export { GeoStoreProvider, StoreContext } from './store/StoreContext'
export { useDataStore, useUIStore, useGeoStore } from './store/StoreContext'

// Map controller context
export { MapControllerProvider, useMapController, useSetMapController } from './contexts/MapControllerContext'
export type { MapController } from './contexts/MapControllerContext'

// FSM hook
export { useMapInteractionMachine } from './hooks/useMapInteractionMachine'
export type { MapInteractionMachine, InteractionPhase } from './hooks/useMapInteractionMachine'

// Main component
export { ElementEditorControls } from './ElementEditorControls'
export type { ElementEditorControlsProps, ElementEditorControlsRef, DrawingTool } from './ElementEditorControls'
export type { FeatureRenderer } from './components/FeatureInteractionLayer'

// Per-feature style override (parity with adapter-maplibre)
export { FeatureStyleProvider, useFeatureStyle } from './contexts/FeatureStyleContext'
export type { FeatureStyle, FeatureStyleFn } from './contexts/FeatureStyleContext'

// UI provider + config types
export { ElementEditorUIProvider } from '@element-editor/ui'
export { ElementEditorError } from '@element-editor/core'
export type { ElementEditorEvent, ElementEditorErrorHandler, ErrorCode, ErrorSource } from '@element-editor/ui'
export type { ElementEditorUIProviderProps } from '@element-editor/ui'
export type { ElementEditorConfig, FeatureTooltipOptions, ResolvedConfig, ToolbarPosition } from '@element-editor/ui'

// UI toolbars (require ElementEditorUIProvider + GeoStoreProvider in tree)
export { FloatingToolbar, EditingToolbar, ActiveDrawingToolbar, useKeyboardShortcuts } from '@element-editor/ui'

// Individual map layer components (for advanced usage)
export { default as DrawingLayer } from './components/DrawingLayer'
export { default as FeatureInteractionLayer, FitBounds } from './components/FeatureInteractionLayer'
export { default as DrawingPreviewLayer } from './components/DrawingPreviewLayer'
export { default as SnapController } from './components/SnapController'
export { TransformControls } from './components/TransformControls'
export { default as RoutePreviewLayer } from './components/RoutePreviewLayer'
export { default as BoundaryLayer } from './components/BoundaryLayer'
export { default as MeasurementTooltip } from './components/MeasurementTooltip'

// Utilities
export { toLeaflet, toGeoJSON } from './utils/geojson'
export { findSnapPoint, snapToAngle } from './utils/snapping'
