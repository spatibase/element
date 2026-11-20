/**
 * @element-editor/ui/internal
 *
 * Unstable, no semver guarantees; for @element-editor/* packages only.
 * Plumbing shared with the adapters and `@element-editor/react`'s drop-in shell (layout
 * resolution, service attribution, the context-menu hook). Anything here may change or
 * disappear in any release. Don't import it from application code.
 */
export { resolveLayout, LAYOUT_SLOTS, isControlVisible, visibleLayoutEntries, layoutGaps } from './contexts/ElementEditorConfigContext'
export { useOptionalEmit } from './contexts/EventContext'
export { useRouting, useServiceAttribution, serviceAttribution } from './hooks/useServiceAttribution'
export { networkUnavailableTools } from './hooks/useAdapterControls'
export { useContextMenu } from './hooks/useContextMenu'
export { useGeoJSONFileImport } from './hooks/useGeoJSONFileImport'
export { RootCssVarsContext } from './hooks/useAccentStyle'
export { RootTokensContext, useRootTokens, readRootTokens, applyRootTokens, THEME_TOKENS } from './hooks/useRootTokens'
export { useTouchInput } from './hooks/useTouchInput'
