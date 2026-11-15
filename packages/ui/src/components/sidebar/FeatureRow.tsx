import { useRef, memo, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { PencilSimple, Eye, EyeClosed } from '@phosphor-icons/react'
import { GeometryTypeIcon, geometryTypeLabel } from '../ui/GeometryTypeIcon'
import type { GeoJSONFeature } from '@element-editor/core'
import { useInlineRename } from '../../hooks/useInlineRename'
import { useUIStore } from '../../store/StoreContext'

/** A feature's display name: its `name`, else its geometry type in plain words (Point, Line, Area, …). */
export function featureLabel(feature: GeoJSONFeature): string {
  const name = feature.properties.name
  if (typeof name === 'string' && name.trim()) return name
  return geometryTypeLabel(feature.geometry.type)
}

interface FeatureRowProps {
  feature: GeoJSONFeature
  isSelected: boolean
  // Handlers receive the feature id so callers can use stable refs (no per-row arrow).
  onRowClick: (id: string) => void
  /** Selection without the map move — used to keep multi/range-select chains
   *  responsive when a name-click defers the row's pan/fit. */
  onRowSelectOnly?: (id: string) => void
  /** Just the pan/fit — invoked by the name-click's deferred timer so a
   *  follow-up dblclick (rename) can cancel it. */
  onRowJump?: (id: string) => void
  onEdit: (id: string) => void
  onToggleHidden: (id: string) => void
  // spread onto <li ref={rowRef}> — carries dnd library's draggable props + style
  containerProps?: Record<string, unknown>
  // spread onto the row <div> — makes the whole row a drag handle
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  innerRef?: (node: HTMLElement | null) => void
  isMultiSelected?: boolean
  onMultiSelectToggle?: (id: string) => void
  onRangeSelect?: (id: string) => void
  isContextMenuActive?: boolean
  /** When dragging multiple selected items, shows a count badge on the drag preview */
  dragCountBadge?: number
  /** Dims the row when it's being dragged along as part of a multi-drag */
  isGhosted?: boolean
  onRename?: (id: string, name: string) => void
  /** Parent-controlled rename activation (drives Tab / Shift+Tab navigation between rows). */
  renameActive?: boolean
  onRenameEnd?: () => void
  onRenameTab?: (direction: 'next' | 'prev') => void
  /** Square off the top / bottom corners (selected neighbour joins this row). */
  joinTop?: boolean
  joinBottom?: boolean
}

const FeatureRow = memo(function FeatureRow({
  feature,
  isSelected,
  onRowClick,
  onRowSelectOnly,
  onRowJump,
  onEdit,
  onToggleHidden,
  containerProps,
  dragHandleProps,
  isDragging,
  innerRef,
  isMultiSelected,
  onMultiSelectToggle,
  onRangeSelect,
  isContextMenuActive,
  dragCountBadge,
  isGhosted,
  onRename,
  renameActive,
  onRenameEnd,
  onRenameTab,
  joinTop,
  joinBottom,
}: FeatureRowProps) {
  const rowRef = useRef<HTMLLIElement>(null)
  const label = featureLabel(feature)
  const readonly = useUIStore((s) => s.readonly)
  const { isRenaming, startRenaming, inputProps } = useInlineRename({
    initialLabel: label,
    disabled: readonly,
    onCommit: (name) => onRename?.(feature.id, name),
    activate: renameActive,
    onEnd: onRenameEnd,
    onTab: onRenameTab,
  })

  // Defer the row's pan/fit on plain clicks of the layer name so a follow-up
  // dblclick (rename) can cancel it — keeps map view stationary while renaming.
  const pendingNameClickRef = useRef<number | null>(null)
  useEffect(() => () => { if (pendingNameClickRef.current !== null) clearTimeout(pendingNameClickRef.current) }, [])

  const imageUrl = typeof feature.properties.imageUrl === 'string' && feature.properties.imageUrl
    ? feature.properties.imageUrl
    : null
  // Pre-validate the image with an off-screen `Image()` BEFORE mounting the
  // visible `<img>`. Without this, the visible img mounts immediately on URL
  // change, paints its empty bordered slot for the load duration, and then
  // disappears once `onError` fires — that flash of "empty bordered box →
  // geometry icon" looks like a glitch to the user. Pre-validating keeps the
  // geometry-icon fallback in place during loading; the real img only swaps
  // in once the browser has a successful load (and is therefore cached, so
  // mounting it paints instantly with no further round-trip).
  const [imgReady, setImgReady] = useState(false)
  useEffect(() => {
    setImgReady(false)
    if (!imageUrl) return
    const probe = new Image()
    let cancelled = false
    probe.onload = () => { if (!cancelled) setImgReady(true) }
    probe.onerror = () => { /* keep imgReady false — fallback stays */ }
    probe.src = imageUrl
    return () => { cancelled = true; probe.onload = null; probe.onerror = null }
  }, [imageUrl])
  const showImage = imageUrl !== null && imgReady

  const { style: containerStyle, ...restContainerProps } = (containerProps ?? {}) as { style?: React.CSSProperties } & Record<string, unknown>

  return (
    <li
      ref={(node) => { rowRef.current = node as HTMLLIElement; innerRef?.(node) }}
      {...restContainerProps}
      {...dragHandleProps}
      style={{ listStyle: 'none', opacity: isGhosted ? 0.4 : undefined, outline: 'none', ...containerStyle }}
    >
      {/* data-feature-id is read by FeatureList's native contextmenu handler */}
      <div
        data-feature-id={feature.id}
        className={clsx(
          // Fixed h-9 (36 px): FeatureList's virtualiser computes row offsets from it.
          'group flex items-center gap-2 px-2 h-9 rounded-elm-control text-sm cursor-default',
          !isDragging && joinTop && 'rounded-t-none',
          !isDragging && joinBottom && 'rounded-b-none',
          isDragging ? 'cursor-grabbing shadow-elm-control bg-elm-surface-raised'
            // Row state colours (--elm-row-*, index.css) are shared with the data table.
            : isMultiSelected || isSelected ? 'bg-(--elm-row-selected) hover:bg-(--elm-row-selected-hover) text-primary-700 dark:text-primary-300'
            : feature.hidden ? clsx('text-elm-text-disabled', isContextMenuActive ? 'bg-(--elm-row-hover)' : 'hover:bg-(--elm-row-hover)')
            : isContextMenuActive ? 'bg-(--elm-row-hover) text-elm-text-secondary'
            : 'hover:bg-(--elm-row-hover) text-elm-text-secondary',
        )}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) { e.stopPropagation(); onMultiSelectToggle?.(feature.id); return }
          if (e.shiftKey) { e.stopPropagation(); onRangeSelect?.(feature.id); return }
          onRowClick(feature.id)
        }}
      >
        {/* Type icon or thumbnail. The image is pre-validated (above) via an
            off-screen Image() probe — the visible <img> only mounts after a
            confirmed successful load, so we never flash the empty bordered
            slot for failed URLs. The geometry-type icon stays as the fallback
            for absent / loading / failed URLs. */}
        {showImage ? (
          <img
            src={imageUrl}
            alt=""
            className="w-5 h-5 rounded-elm-chip object-cover flex-shrink-0 border border-(--elm-border,var(--color-gray-200))"
          />
        ) : (
          <span className={clsx(
            'flex-shrink-0',
            // Selected rows tint the icon to match their text color (primary).
            // Hidden rows mute it to the row's dimmed text. Otherwise stay neutral gray.
            (isSelected || isMultiSelected)
              ? 'text-primary-700 dark:text-primary-300'
              : feature.hidden
                ? 'text-elm-text-disabled'
                : 'text-(--elm-text-subtle,var(--color-gray-400))',
          )}>
            <GeometryTypeIcon type={feature.geometry.type} />
          </span>
        )}

        {isRenaming ? (
          <input
            {...inputProps}
            className="flex-1 min-w-0 bg-elm-surface outline-none text-sm font-normal text-elm-text-secondary border border-primary-400 rounded-elm-control px-1.5 py-0.5 leading-snug"
          />
        ) : (
          <span
            // Match the rename input's dimensional footprint with a transparent
            // border + identical padding so toggling rename mode doesn't shift
            // the row's height (which would re-center the type icon).
            className="flex-1 min-w-0 font-normal truncate leading-snug border border-transparent rounded-elm-control px-1.5 py-0.5"
            onClick={(e) => {
              // Modifier clicks fall through to the row's multi/range-select handler.
              if (e.metaKey || e.ctrlKey || e.shiftKey) return
              // Don't defer if the parent FeatureList didn't supply the split handlers.
              if (!onRowSelectOnly || !onRowJump) return
              e.stopPropagation()
              // Select immediately so multi-select chains (shift/cmd-click) stay responsive.
              onRowSelectOnly(feature.id)
              if (pendingNameClickRef.current !== null) {
                clearTimeout(pendingNameClickRef.current)
                pendingNameClickRef.current = null
              }
              if (e.detail >= 2) return
              // Defer just the map move so a follow-up dblclick (rename) can cancel it.
              pendingNameClickRef.current = window.setTimeout(() => {
                onRowJump(feature.id)
                pendingNameClickRef.current = null
              }, 300)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (pendingNameClickRef.current !== null) {
                clearTimeout(pendingNameClickRef.current)
                pendingNameClickRef.current = null
              }
              startRenaming(label)
            }}
          >
            {label}
          </span>
        )}

        {!isRenaming && dragCountBadge && dragCountBadge > 1 && (
          <span className="flex-shrink-0 bg-primary-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none">
            {dragCountBadge}
          </span>
        )}



        {!isRenaming && <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Edit only appears on hover. */}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(feature.id) }}
            className="text-elm-text hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) p-1 rounded-elm-control opacity-0 group-hover:opacity-100"
            aria-label="Edit"
          >
            <PencilSimple size={16} />
          </button>
          {/* Visibility toggle: stays visible when the layer is hidden so users
              spot hidden layers at a glance, hover-only when visible. */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleHidden(feature.id) }}
            className={clsx(
              'text-elm-text hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) p-1 rounded-elm-control',
              feature.hidden ? '' : 'opacity-0 group-hover:opacity-100',
            )}
            aria-label="Toggle visibility"
          >
            {feature.hidden ? <EyeClosed size={16} /> : <Eye size={16} />}
          </button>
        </div>}
      </div>
    </li>
  )
})

export default FeatureRow
