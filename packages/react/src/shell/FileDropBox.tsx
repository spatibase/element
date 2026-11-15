import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { FileArrowUp } from '@phosphor-icons/react'
import { useGeoJSONFileImport } from '@element-editor/ui/internal'

// The GeoJSON inspector (CodeMirror) handles its own drops: leave them alone.
const skip = (e: DragEvent) => !e.dataTransfer?.types?.includes('Files') || !!(e.target as Element).closest?.('.cm-editor')

/**
 * Dropping a .geojson / .json file on the editor imports it like Cmd+O (replace, one undo step,
 * fit to the data). `active` while a file is dragged over. Spread `handlers` on a
 * pointer-events-auto element (pointer-events: none elements get no drag events).
 */
function useFileDrop(enabled: boolean) {
  const importFile = useGeoJSONFileImport()
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!enabled || skip(e)) return
    e.preventDefault()
    e.stopPropagation() // a host drop zone around the editor doesn't import it twice
    depth.current += 1
    setActive(true)
  }, [enabled])
  const onDragOver = useCallback((e: DragEvent) => {
    if (!enabled || skip(e)) return
    e.preventDefault() // lets the drop happen
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [enabled])
  const onDragLeave = useCallback((e: DragEvent) => {
    if (!enabled || skip(e)) return
    e.stopPropagation()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setActive(false)
  }, [enabled])
  const onDrop = useCallback((e: DragEvent) => {
    depth.current = 0
    setActive(false)
    if (!enabled || skip(e)) return
    e.preventDefault() // no browser navigation to the file
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) void importFile(file)
  }, [enabled, importFile])

  return { active: enabled && active, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

/**
 * The shell's map area (map, panels, slots), plus `footer` (the status bar) below it. Its own
 * component: the import reports through `useEmit`, which needs the shell's EventProvider above it.
 * The drop handlers sit on a `display: contents` wrapper around both, so a file dropped anywhere
 * on the editor (status bar included) is imported here and never reaches a host drop zone or
 * the browser's open-the-file default; the overlay covers the map area.
 */
export function FileDropBox({ enabled, children, footer }: { enabled: boolean; children: ReactNode; footer?: ReactNode }) {
  const drop = useFileDrop(enabled)
  return (
    <div style={{ display: 'contents' }} {...drop.handlers}>
    <div className="relative flex-1 min-h-0 flex">
      {children}
      {drop.active && (
        <div data-elm-file-drop="" className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none bg-gray-900/10 dark:bg-black/30 border-2 border-dashed border-primary-500 rounded-sm">
          <div className="flex items-center gap-2 px-4 py-2 bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm text-sm text-(--elm-text-secondary,var(--color-gray-700)) dark:text-(--elm-text-secondary,var(--color-gray-200)) antialiased select-none">
            <FileArrowUp size={20} className="text-elm-text-muted" />
            <span>Drop GeoJSON to import</span>
          </div>
        </div>
      )}
    </div>
    {footer}
    </div>
  )
}
