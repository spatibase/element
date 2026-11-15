import { useUIStore, useDataStore, useGeoStore } from '../store/StoreContext'
import { DataTable } from './lazyParts'
import { useRef, useState, useCallback, useEffect, useLayoutEffect, Suspense } from 'react'
import { clsx } from 'clsx'
import { X, ArrowsOutSimple, ArrowsInSimple, Plus } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { sidebarTakesSpace } from '@element-editor/core/internal'
import { useMapController } from '../contexts/MapControllerContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { Button } from './ui/Button'
import { resizeEdgeTop } from './ui/resizeEdge'
import { startDragShield } from '../hooks/dragShield'
import { Tooltip } from './ui/Tooltip'
import { NoFeaturesEmptyState } from './ui/NoFeaturesEmptyState'
import { panelHeaderIconBtn, panelHeaderBar } from './ui/panelHeader'

const MIN_HEIGHT = 160
const MAX_HEIGHT_VH = 80

// Typed so the editor root can transition it: the table (bottom) and every
// toolbar/slot positioned from it then slide together, like the layers panel.
try {
  CSS.registerProperty({ name: '--elm-table-offset', syntax: '<length>', inherits: true, initialValue: '0px' })
} catch { /* already registered (HMR, second bundle copy) or no CSS API (SSR) */ }

// Class string shared between the live input and its hidden measuring twin.
// Any typography/padding/border change must match on both — otherwise the
// measured width won't match what the browser actually renders.
const RENAME_INPUT_CLASS =
  'px-2.5 py-1 rounded-elm-control text-xs font-medium bg-elm-surface text-elm-text ring-1 ring-primary-400 outline-none'

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | undefined>(undefined)

  // Measure the hidden twin on every value change — offsetWidth includes
  // padding + border, so the input's width can be set directly without
  // further math. +4 keeps the caret visible at the end and prevents the
  // browser from scrolling the first character out of view (the bug we
  // saw with `field-sizing: content`, which sizes content-box exactly to
  // the text and leaves no caret room).
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    setWidth(el.offsetWidth + 4)
  }, [value])

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden
        // Pulled out of the tab flow with `position: absolute` + `visibility: hidden`
        // so it takes the same space as the input but doesn't affect layout and
        // isn't read by screen readers. `whitespace-pre` preserves trailing
        // spaces so width matches exactly.
        className={`${RENAME_INPUT_CLASS} absolute invisible pointer-events-none whitespace-pre left-[-9999px] top-[-9999px]`}
      >
        {value || ' '}
      </span>
      <input
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          if (e.key === 'Escape') { onCancel(); e.preventDefault() }
        }}
        style={{ width }}
        className={RENAME_INPUT_CLASS}
      />
    </>
  )
}

interface DataTablePanelProps {
  /**
   * Embedded mode: fills its parent container (no absolute positioning,
   * no resize handle, no show/hide animation, no fullscreen toggle, no
   * close button). Used by the split layout which owns the container.
   */
  embedded?: boolean
}

// Shared header icon button; light hover one step darker on this tinted header.
const headerIconBtn = `flex ${panelHeaderIconBtn.replace('hover:bg-(--elm-surface-hover,var(--color-gray-100))', 'hover:bg-(--elm-surface-hover,var(--color-gray-200))')}`

export default function DataTablePanel({ embedded = false }: DataTablePanelProps = {}) {
  const { dataStore } = useGeoStore()
  const cfg = useElementEditorConfig()
  const tableOpen = useUIStore((s) => s.tableOpen)
  const readonly = useUIStore((s) => s.readonly)
  const toggleTable = useUIStore((s) => s.toggleTable)
  const setTableFullscreen = useUIStore((s) => s.setTableFullscreen)
  const sidebarBeside = useUIStore(sidebarTakesSpace)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const codeDockWidth = useUIStore((s) => s.codeDockWidth)
  // Right-side offset only applies when the layers panel actually occupies
  // that space — i.e. panel layout, layerList enabled, and sidebar open.
  // In minimal layout (no panel) the table should span the full width.
  const panelVisibleRight = cfg.ui.layerList && sidebarBeside

  // ONLY subscribe to the length to prevent this panel from re-rendering
  // on every single feature property/geometry update (which would be O(N) lag)
  const featureCount = useDataStore((s) => s.features.length)
  const schemas = useDataStore(useShallow((s) => s.getVisibleSchemas()))

  const { getCenter } = useMapController()

  // No window on the server: any height does there, the closed table is off-screen.
  const [panelHeight, setPanelHeight] = useState(() => typeof window === 'undefined' ? 360 : Math.round(window.innerHeight * 0.42))
  const [schemaFilter, setSchemaFilter] = useState('all')
  const [fullscreen, setFullscreen] = useState(false)
  // Mirror local fullscreen into the store so floating editor UI in <ElementEditor>
  // (toolbar, undo/redo, corner buttons) can hide while the table covers the
  // viewport — issue #12. Reset on unmount so a remount doesn't leak state.
  useEffect(() => {
    setTableFullscreen(fullscreen)
    return () => setTableFullscreen(false)
  }, [fullscreen, setTableFullscreen])
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set())
  const [renamingSchemaId, setRenamingSchemaId] = useState<string | null>(null)

  // Keep DataTable mounted after first open so scroll/sort/selection/column widths
  // survive hide→show. Lazy-load still defers the bundle until first open.
  // In embedded mode (split layout) the table is always visible.
  const openedOnceRef = useRef(false)
  if (tableOpen || embedded) openedOnceRef.current = true
  // Content goes display:none only once the 200 ms slide-out has finished,
  // so the closing table doesn't slide away empty.
  const [closedSettled, setClosedSettled] = useState(!tableOpen)
  useEffect(() => {
    if (tableOpen) { setClosedSettled(false); return }
    const t = setTimeout(() => setClosedSettled(true), 200)
    return () => clearTimeout(t)
  }, [tableOpen])

  // Shield keeps the row-resize cursor over the map and blocks hovers; pointer
  // capture still routes the moves to the handle.
  const endShieldRef = useRef<(() => void) | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    endShieldRef.current = startDragShield('row-resize', e.currentTarget)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!endShieldRef.current) return
    const maxHeight = Math.round(window.innerHeight * MAX_HEIGHT_VH / 100)
    const newHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, window.innerHeight - e.clientY))
    setPanelHeight(newHeight)
  }, [])

  const onPointerUp = useCallback(() => {
    endShieldRef.current?.()
    endShieldRef.current = null
  }, [])

  // Publish the data table's current height as --elm-table-offset on the nearest
  // Element root so left/bottom-anchored floating toolbars can move out of the
  // way instead of sitting on top of the table. Skipped in embedded mode — the
  // split layout's own reserved bottom area handles that separately.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (embedded) return
    const host = rootRef.current?.closest('[data-elm-theme]') as HTMLElement | null
    if (!host) return
    const h = !tableOpen ? 0 : fullscreen ? host.clientHeight : panelHeight
    host.style.setProperty('--elm-table-offset', `${h}px`)
    // Same 200 ms `ease` as the layers panel. Added after the first value is
    // painted, so a table that starts open doesn't slide in on page load.
    if (!host.style.transition) requestAnimationFrame(() => { host.style.transition = '--elm-table-offset 200ms ease' })
    return () => { host.style.setProperty('--elm-table-offset', '0px') }
  }, [embedded, tableOpen, fullscreen, panelHeight])

  // Opaque (not /95 + blur): the sticky last column needs a solid bg to mask
  // scrolled cells, and only an opaque panel lets normal cells match it.
  const rootClass = embedded
    ? 'absolute inset-0 bg-elm-surface flex flex-col'
    : clsx(
        // `right` follows the layers panel / docked inspector, which animate
        // `right` with the same 200 ms `ease`: same mechanism + same curve =
        // edges stay together every frame (a compositor transform or another
        // easing on either side drifts and opens a gap).
        // Show/hide: `bottom` rides the (transitioned) --elm-table-offset, so
        // the table slides with everything stacked on it. min() keeps it put
        // while the offset comes back down from fullscreen height.
        'absolute left-0 z-20 bg-elm-surface border-t border-elm-border/80 flex flex-col transition-[right] duration-200 ease-[ease]',
        // Closed, the panel waits just below the editor's bottom edge. Hidden once the slide-out
        // is over, so a host container that doesn't clip its overflow never shows it.
        !tableOpen && closedSettled && 'invisible',
      )
  const rootStyle: React.CSSProperties | undefined = embedded
    ? undefined
    : fullscreen
      ? { top: 0, bottom: 0, right: 0, height: '100%' }
      : {
        height: panelHeight,
        bottom: `calc(min(var(--elm-table-offset, 0px), ${panelHeight}px) - ${panelHeight}px)`,
        right: (panelVisibleRight ? sidebarWidth : 0) + codeDockWidth,
      }

  return (
    <div ref={rootRef} className={rootClass} style={rootStyle}>
      {!embedded && !fullscreen && (
        <div
          className={resizeEdgeTop}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={onPointerUp}
        />
      )}

      <div className={`${panelHeaderBar} gap-3 px-4`}>
        {!readonly && (
        <Tooltip content="Add new entry">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const coords = getCenter?.() ?? [0, 0]
            const { schemas, getDefaultSchema } = dataStore.getState()
            const schemaId =
              schemaFilter !== 'all' && schemas.find((s) => s.id === schemaFilter)
                ? schemaFilter
                : getDefaultSchema().id
            const schema = schemas.find((s) => s.id === schemaId) ?? getDefaultSchema()
            const properties: Record<string, unknown> = {}
            for (const f of schema.fields) properties[f.key] = ''
            const id = crypto.randomUUID()
            const added = dataStore.getState().addFeature({
              type: 'Feature',
              id,
              schemaId,
              geometry: { type: 'Point', coordinates: coords },
              properties,
            })
            if (added) setFocusRowId(id)
          }}
        >
          <Plus size={11} weight="bold" />
          Add new
        </Button>
        </Tooltip>
        )}
        <span className="text-xs text-elm-text-muted">
          {featureCount} feature{featureCount !== 1 ? 's' : ''}
          {selectedRows.size > 0 && `, ${selectedRows.size} selected`}
        </span>


        {schemas.length > 1 && (
          <div role="tablist" aria-label="Filter by schema" className="ml-1 flex items-center gap-0.5 text-xs">
            {[{ id: 'all', name: 'All' }, ...schemas].map((s) => {
              const active = schemaFilter === s.id
              const isAll = s.id === 'all'
              const editing = renamingSchemaId === s.id
              if (editing) {
                return (
                  <InlineRenameInput
                    key={s.id}
                    initialValue={s.name}
                    onCommit={(next) => {
                      if (next && next !== s.name) dataStore.getState().updateSchema(s.id, { name: next })
                      setRenamingSchemaId(null)
                    }}
                    onCancel={() => setRenamingSchemaId(null)}
                  />
                )
              }
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSchemaFilter(s.id)}
                  onDoubleClick={() => { if (!isAll && !readonly) setRenamingSchemaId(s.id) }}
                  title={isAll || readonly ? undefined : 'Double-click to rename'}
                  className={clsx(
                    'px-2.5 py-1 rounded-elm-control transition-colors whitespace-nowrap',
                    active
                      ? 'bg-elm-surface hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-800)) text-elm-text font-medium shadow-sm ring-1 ring-(--elm-border,var(--color-gray-200)) dark:ring-(--elm-border,var(--color-gray-700))'
                      : 'text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300)) hover:bg-(--elm-surface-hover,var(--color-gray-200)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700))',
                  )}
                >
                  {s.name}
                </button>
              )
            })}
          </div>
        )}

        {!embedded && (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip content={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              <button
                type="button"
                onClick={() => setFullscreen((v) => !v)}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className={headerIconBtn}
              >
                {fullscreen ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
              </button>
            </Tooltip>
            <button type="button" onClick={toggleTable} aria-label="Close data table" className={headerIconBtn}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      <div className={clsx('flex-1 min-h-0 overflow-hidden', !embedded && !tableOpen && closedSettled && 'hidden')}>
        {featureCount === 0 ? (
          <NoFeaturesEmptyState />
        ) : (
          openedOnceRef.current && (
            <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-sm text-(--elm-text-subtle,var(--color-gray-400))">Loading grid...</div>}>
              <DataTable
              schemaFilter={schemaFilter}
              focusRowId={focusRowId}
              onFocusRowHandled={() => setFocusRowId(null)}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
            />
            </Suspense>
          )
        )}
      </div>
    </div>
  )
}
