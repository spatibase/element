import { lazyWithPreload, registerPreload } from './utils/lazyWithPreload'

// ─── Store context ────────────────────────────────────────────────────────────
export { GeoStoreProvider, StoreContext, useDataStore, useUIStore, useGeoStore } from './store/StoreContext'
// State types of the stores those hooks read (defined in @element-editor/core, re-exported for convenience).
export type { DataStore, UIStore } from '@element-editor/core'

// ─── Contexts ─────────────────────────────────────────────────────────────────
export { MapControllerProvider, useMapController, useSetMapController } from './contexts/MapControllerContext'
export type { MapController } from './contexts/MapControllerContext'
export { ThemeContext, useTheme, ThemeReportingProvider, useReportThemeFromRoot } from './contexts/ThemeContext'
export type { ResolvedTheme } from './contexts/ThemeContext'
export { EventProvider, useEmit, useIsManaged, useToasterId, type EmittedEvent } from './contexts/EventContext'
export { ShortcutConfigProvider, useShortcutConfig } from './contexts/ShortcutConfigContext'
export { ElementEditorConfigProvider, useElementEditorConfig, useUnitsOverride, resolveConfig, DEFAULT_LAYOUT, withLayout } from './contexts/ElementEditorConfigContext'
// The drop-in shell's layout plumbing (resolveLayout, LAYOUT_SLOTS, isControlVisible,
// visibleLayoutEntries) lives in `@element-editor/ui/internal`, which is not semver-covered.
export type { ElementEditorConfig, ResolvedConfig, DrawTool, ToolbarPosition, LayoutSlot, LayoutControl, RasterBasemap, LayoutGroup, LayoutEntry, LayoutSlotConfig, LayoutConfig, ResolvedLayout, MapSlot, StatusSlot, MapGroup, StatusGroup, MapEntry, StatusEntry, MapSlotConfig, StatusSlotConfig, LayoutPatch, SlotFor, UnitsOverride } from './contexts/ElementEditorConfigContext'

// ─── Types ────────────────────────────────────────────────────────────────────
export type { ElementEditorEvent, ElementEditorErrorHandler } from './types/events'
export { ElementEditorError } from '@element-editor/core'
export type { ErrorCode, ErrorSource } from '@element-editor/core'

// ─── Panels & modals ─────────────────────────────────────────────────────────
export { default as LayersPanel } from './components/sidebar/LayersPanel'
export { default as FeatureSidePanel } from './components/sidebar/FeatureSidePanel'
export { default as FeatureRow, featureLabel } from './components/sidebar/FeatureRow'
export { default as GroupRow } from './components/sidebar/GroupRow'
export { default as PartSubRow } from './components/sidebar/PartSubRow'
// Lazy (render inside <Suspense>): the list's drag-and-drop, the data grid and the
// schema editor load in their own chunks. See components/lazyParts.ts.
export { FeatureList, SchemaEditor, DataTable } from './components/lazyParts'

// Heavy optional modals — lazy-loaded so their deps (CodeMirror, react-data-grid,
// @hello-pangea/dnd reuse, etc.) split into their own chunks. Callers must wrap
// render sites in <Suspense>.
export const GeoJSONModal = lazyWithPreload(() => import('./components/sidebar/GeoJSONModal'))
// Eager: the inspector's Suspense fallback (an empty dock frame while the chunk loads).
export { GeoJSONDockPlaceholder } from './components/sidebar/codeDock'
export const SchemaModal = lazyWithPreload(() => import('./components/sidebar/SchemaModal'))
export const FeatureEditModal = lazyWithPreload(() => import('./components/sidebar/FeatureEditModal'))
export const DataTablePanel = lazyWithPreload(() => import('./components/DataTablePanel'))
export const SettingsModal = lazyWithPreload(() => import('./components/dialogs/SettingsModal'))
export const ShortcutsModal = lazyWithPreload(() =>
  import('./components/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal }))
)
registerPreload(GeoJSONModal, SchemaModal, FeatureEditModal, DataTablePanel, SettingsModal, ShortcutsModal)
export { preloadEditorPanelsWhenIdle } from './utils/lazyWithPreload'

// ─── Toolbars ─────────────────────────────────────────────────────────────────
export { default as FloatingToolbar } from './components/FloatingToolbar'
export { default as EditingToolbar } from './components/EditingToolbar'
export { VertexSelectionBar } from './components/VertexSelectionBar'
export { FeatureMapContextMenu } from './components/FeatureMapContextMenu'
export type { FeatureContextMenuData } from './components/FeatureMapContextMenu'
export { default as UndoRedoToolbar } from './components/UndoRedoToolbar'
export { UndoButton, RedoButton, ControlGroup } from './components/UndoRedoToolbar'
export { default as ActiveDrawingToolbar } from './components/ActiveDrawingToolbar'
export { default as FitBoundsButton } from './components/FitBoundsButton'
export { default as ZoomIndicator } from './components/ZoomIndicator'
export { default as LocateButton } from './components/LocateButton'
export { default as ReadonlyBanner } from './components/ReadonlyBanner'
export const BooleanOperations = lazyWithPreload(() => import('./components/BooleanOperations'))
registerPreload(BooleanOperations)
export { default as SimplifyPanel } from './components/SimplifyPanel'
export { default as SmoothPanel } from './components/SmoothPanel'
export { default as BufferPanel } from './components/BufferPanel'

// ─── Base UI components ───────────────────────────────────────────────────────
export { Button } from './components/ui/Button'
export { ContextMenu, isContextMenuOpen, CONTEXT_MENU_MARKER_ATTR } from './components/ui/ContextMenu'
export { Input, Textarea, SelectInput } from './components/ui/Input'
export { Kbd, KbdDark, KbdInvert } from './components/ui/Kbd'
export { SearchDropdown } from './components/ui/SearchDropdown'
export type { SearchDropdownHandle } from './components/ui/SearchDropdown'
export { ToolButton } from './components/ui/ToolButton'
export { IconButton } from './components/ui/IconButton'
export type { IconButtonSize } from './components/ui/IconButton'
export { BasemapPicker } from './components/BasemapPicker'
export type { BasemapPickerOption, BasemapPickerProps } from './components/BasemapPicker'
export { Tooltip } from './components/ui/Tooltip'
export type { TooltipSide } from './components/ui/Tooltip'
export { ElementToaster } from './components/ui/ElementToaster'
export { EditToolbarBtn, ToolbarDivider } from './components/ui/EditToolbarBtn'

// ─── Hooks ────────────────────────────────────────────────────────────────────
export { useKeyboardShortcuts, useIsEventForEditor } from './hooks/useKeyboardShortcuts'
export { useDataChangeSubscription } from './hooks/useDataChangeSubscription'
export { useNominatim } from './hooks/useNominatim'
export type { NominatimResult } from './hooks/useNominatim'
export { useAccentPalette } from './hooks/useAccentPalette'
export { useAccentStyle, useApplyAccentToRoot, accentStyle } from './hooks/useAccentStyle'
export { useGeoJSONDrop } from './hooks/useGeoJSONDrop'
export type { UseGeoJSONDropOptions, UseGeoJSONDropReturn, GeoJSONDropError } from './hooks/useGeoJSONDrop'
export { useGeoJSONExport } from './hooks/useGeoJSONExport'
export type { UseGeoJSONExportOptions, UseGeoJSONExportReturn, GeoJSONExportError } from './hooks/useGeoJSONExport'
export { useAdapterControls } from './hooks/useAdapterControls'
export type { UseAdapterControlsOptions, ElementEditorImperativeAPI, MutationOptions, SetFeatureCollectionOptions, ValidationReport, ImportResult } from './hooks/useAdapterControls'
export { triggerGeoJSONDownload, saveGeoJSONFile } from './utils/download'

// ─── Geometry utilities ───────────────────────────────────────────────────────
export { runGeometryWorkerOperation, disposeGeometryWorker } from './utils/geometryWorkerClient'

// Error boundary — wraps the editor tree and shows a minimal recovery UI on
// any render/runtime error. Mounted automatically by `ElementEditorUIProvider`;
// exposed here for standalone consumers who want finer placement.
export { ElementEditorErrorBoundary } from './components/ElementEditorErrorBoundary'

// Full UI context stack for adapter setups — re-exported by both adapters.
export { ElementEditorUIProvider } from './components/ElementEditorUIProvider'
export type { ElementEditorUIProviderProps } from './components/ElementEditorUIProvider'
