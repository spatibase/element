import { createPortal } from 'react-dom'
import { LineSegments, Trash } from '@phosphor-icons/react'
import { EditToolbarBtn, ToolbarDivider } from './ui/EditToolbarBtn'
import { Kbd } from './ui/Kbd'

// EditingToolbar is always up while points are selected (vertex edit implies a
// selected feature), so the bar sits one toolbar height (50px) + 8px gap above
// the bottom-center stack. <ElementEditor> publishes that stack's bottom edge
// as --elm-bottom-stack-offset (split layout and a lifted stack included);
// adapter-only setups fall back to the table/toolbar offsets + 16px.
const BOTTOM = 'calc(var(--elm-bottom-stack-offset, calc(var(--elm-table-offset, 0px) + var(--elm-bottom-toolbar-offset, 0px) + 16px)) + 58px)'

/**
 * Bar shown while vertex points are selected: count, Simplify, Delete.
 * Portals into the map container's parent (not <body>) so it inherits
 * [data-elm-theme] and the offset vars, while its clicks never bubble through
 * the map container itself.
 */
export function VertexSelectionBar({ mapContainer, count, onSimplify, onDelete }: {
  mapContainer: HTMLElement
  count: number
  onSimplify: () => void
  onDelete: () => void
}) {
  const host = mapContainer.parentElement
  if (!host) return null
  return createPortal(
    <div
      className="absolute left-0 right-0 z-[400] flex justify-center pointer-events-none"
      style={{ bottom: BOTTOM }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-2 py-2 pointer-events-auto antialiased">
        <span className="px-1 text-sm text-elm-text-muted tabular-nums">
          {count} point{count !== 1 ? 's' : ''} selected
        </span>
        <ToolbarDivider />
        <EditToolbarBtn label="Simplify selected points" onClick={onSimplify} disabled={count < 3}>
          <LineSegments size={24} />
          <span className="px-1 font-medium">Simplify</span>
        </EditToolbarBtn>
        <EditToolbarBtn label="Delete selected points" onClick={onDelete}>
          <Trash size={24} />
          <span className="px-1 font-medium">Delete</span>
        </EditToolbarBtn>
        <Kbd>Del</Kbd>
      </div>
    </div>,
    host,
  )
}
