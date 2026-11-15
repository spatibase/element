import { Suspense } from 'react'
import type { DialogState } from '@element-editor/core'
import {
  SettingsModal,
  SchemaModal,
  GeoJSONModal,
  GeoJSONDockPlaceholder,
  LayersPanel,
  FeatureEditModal,
  DataTablePanel,
  ShortcutsModal,
  useUIStore,
  useElementEditorConfig,
} from '@element-editor/ui'
import type { ElementEditorBaseProps } from './types'

type Layout = NonNullable<ElementEditorBaseProps['layout']>

/** Split layout: the bottom 1/3 of the map area is a data table + layers panel. */
export function SplitPanel() {
  const cfg = useElementEditorConfig()
  return (
    <div className="absolute bottom-0 left-0 w-full h-1/3 bg-elm-surface border-t border-elm-border z-[400] flex shadow-[0_-8px_12px_-8px_rgb(0_0_0/0.12)]">
      {/* Left side: data table (always visible — split layout's whole point
          is the dashboard pattern of "data + detail"). Uses the embedded
          variant so it inherits the Add entry / schema tabs / count header. */}
      {cfg.ui.dataTable && (
        <div className="flex-1 h-full relative overflow-hidden border-r border-elm-border">
          <Suspense fallback={null}>
            <DataTablePanel embedded />
          </Suspense>
        </div>
      )}
      {/* Right side: layers panel (swaps to feature edit form internally
          when a feature is selected). */}
      {cfg.ui.layerList && (
        <div className="w-[320px] flex-shrink-0 h-full relative overflow-hidden bg-elm-surface">
          <LayersPanel />
        </div>
      )}
    </div>
  )
}

/**
 * The shell's lazy dialogs and the floating data table. Owns the
 * dialog / schema / GeoJSON open-state subscriptions so toggling them doesn't
 * re-render the whole shell.
 */
export function ShellModals({ layout }: { layout: Layout }) {
  const cfg = useElementEditorConfig()
  const dialogState = useUIStore((s) => s.dialogState)
  const schemaOpen = useUIStore((s) => s.schemaModalOpen)
  const toggleSchemaModal = useUIStore((s) => s.toggleSchemaModal)
  const readonly = useUIStore((s) => s.readonly)
  const codeOpen = useUIStore((s) => s.codeModalOpen)
  const toggleCodeModal = useUIStore((s) => s.toggleCodeModal)
  const settingsOpen = useUIStore((s) => s.settingsModalOpen)
  const shortcutsOpen = useUIStore((s) => s.shortcutsModalOpen)

  // Each lazy component gets its own Suspense boundary — a shared boundary
  // would unmount already-loaded siblings every time a new modal suspended.
  return (
    <>
      {layout === 'minimal' && dialogState.type !== 'closed' && (
        <Suspense fallback={null}>
          <FeatureEditModal dialogState={dialogState as Exclude<DialogState, { type: 'closed' }>} />
        </Suspense>
      )}
      {cfg.ui.dataTable && layout !== 'split' && (
        <Suspense fallback={null}><DataTablePanel /></Suspense>
      )}
      {/* Mounted only while open (they render nothing closed), so their chunks
          load on first open or on idle, not with the editor. */}
      {cfg.ui.keyboardShortcuts.show && shortcutsOpen && (
        <Suspense fallback={null}><ShortcutsModal /></Suspense>
      )}
      {cfg.ui.settings && settingsOpen && (
        <Suspense fallback={null}><SettingsModal /></Suspense>
      )}
      {cfg.ui.schemaEditor && schemaOpen && !readonly && (
        <Suspense fallback={null}><SchemaModal onClose={toggleSchemaModal} /></Suspense>
      )}
      {cfg.ui.geojsonEditor && codeOpen && (
        <Suspense fallback={<GeoJSONDockPlaceholder />}>
          <GeoJSONModal onClose={toggleCodeModal} />
        </Suspense>
      )}
    </>
  )
}
