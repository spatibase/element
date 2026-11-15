import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { Folder, FolderOpen, Pencil, Trash, Eye, EyeClosed, DotsThree, FolderMinus } from '@phosphor-icons/react'
import type { Group } from '@element-editor/core'
import { Tooltip } from '../ui/Tooltip'
import { ContextMenu } from '../ui/ContextMenu'
import { useInlineRename } from '../../hooks/useInlineRename'
import { useUIStore } from '../../store/StoreContext'

interface GroupRowProps {
  group: Group
  featureCount: number
  autoFocus?: boolean
  /** True when every feature in this group is currently selected — drives the
   *  highlighted row appearance after a name-click selects the group. */
  isSelected?: boolean
  onToggleCollapse: () => void
  onToggleHidden: () => void
  onRename: (name: string) => void
  onDelete: (mode: 'ungroup' | 'delete-features') => void
  /** Selects every feature in the group and fits the map to their combined bbox. */
  onSelect?: () => void
  innerRef?: (node: HTMLElement | null) => void
  dragHandleProps?: Record<string, unknown>
  containerProps?: Record<string, unknown>
  isDragging?: boolean
}

export default function GroupRow({ group, featureCount, autoFocus, isSelected, onToggleCollapse, onToggleHidden, onRename, onDelete, onSelect, innerRef, dragHandleProps, containerProps, isDragging }: GroupRowProps) {
  const readonly = useUIStore((s) => s.readonly)
  const { isRenaming, startRenaming, inputProps } = useInlineRename({
    initialLabel: group.name,
    disabled: readonly,
    onCommit: onRename,
    autoFocus,
  })
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation()
    const btn = menuBtnRef.current
    if (btn) {
      const rect = btn.getBoundingClientRect()
      setMenuPos({ x: rect.right, y: rect.bottom + 4 })
    }
  }

  // Defer the group's select+zoom on plain clicks of the name so a follow-up
  // dblclick (rename) can cancel it — keeps the map stationary while renaming.
  const pendingNameClickRef = useRef<number | null>(null)
  useEffect(() => () => { if (pendingNameClickRef.current !== null) clearTimeout(pendingNameClickRef.current) }, [])

  const showHide = {
    label: group.hidden ? 'Show on map' : 'Hide from map',
    icon: group.hidden ? <Eye size={16} /> : <EyeClosed size={16} />,
    onClick: () => onToggleHidden(),
  }
  // Readonly: show / hide only (view state).
  const menuItems = readonly ? [showHide] : [
    showHide,
    {
      label: 'Rename',
      icon: <Pencil size={16} />,
      onClick: () => startRenaming(group.name),
    },
    { separator: true as const },
    {
      // Removes the group but keeps its features at the top level.
      label: 'Ungroup',
      icon: <FolderMinus size={16} />,
      onClick: () => onDelete('ungroup'),
    },
    {
      label: 'Delete group',
      icon: <Trash size={16} />,
      onClick: () => onDelete('delete-features'),
    },
  ]

  return (
    <>
    {menuPos && (
      <ContextMenu
        x={menuPos.x}
        y={menuPos.y}
        onClose={() => setMenuPos(null)}
        items={menuItems}
      />
    )}
    <div
      ref={innerRef}
      {...containerProps}
      {...dragHandleProps}
      className={clsx(
        'group flex items-center gap-2 px-2 py-1.5 rounded-elm-control text-sm font-medium cursor-default',
        isDragging
          ? 'shadow-elm-control bg-elm-surface-raised'
          : isSelected
            ? 'bg-(--elm-row-selected) hover:bg-(--elm-row-selected-hover) text-primary-700 dark:text-primary-300'
            : group.hidden
              ? 'text-elm-text-disabled hover:bg-(--elm-row-hover)'
              : 'text-elm-text-secondary hover:bg-(--elm-row-hover)',
      )}
      style={{ outline: 'none', cursor: isDragging ? 'grabbing' : 'default', ...(containerProps as { style?: React.CSSProperties })?.style }}
      onClick={() => { if (onSelect) onSelect() }}
      onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }) }}
    >
      <span
        className={clsx(
          'flex-shrink-0 cursor-pointer',
          group.hidden ? 'text-elm-text-disabled' : 'text-elm-text-muted',
        )}
        onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
        aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
      >
        {group.collapsed
          ? <Folder size={20} weight="fill" />
          : <FolderOpen size={20} weight="fill" />}
      </span>

      {isRenaming ? (
        <input
          {...inputProps}
          className="flex-1 min-w-0 bg-elm-surface outline-none text-sm font-medium text-elm-text-secondary border border-primary-400 rounded-elm-control px-1.5 py-0.5 leading-snug"
        />
      ) : (
        <span
          // Match the rename input's dimensional footprint with a transparent
          // border + identical padding so toggling rename mode doesn't shift
          // the row's height (which would re-center the folder icon).
          className="flex-1 min-w-0 truncate cursor-default leading-snug border border-transparent rounded-elm-control px-1.5 py-0.5"
          onClick={(e) => {
            // Always swallow the click so it doesn't bubble to the row's
            // collapse-toggle handler — the name area is reserved for select+zoom.
            e.stopPropagation()
            if (!onSelect || e.metaKey || e.ctrlKey || e.shiftKey) return
            if (pendingNameClickRef.current !== null) {
              clearTimeout(pendingNameClickRef.current)
              pendingNameClickRef.current = null
            }
            if (e.detail >= 2) return
            pendingNameClickRef.current = window.setTimeout(() => {
              onSelect()
              pendingNameClickRef.current = null
            }, 300)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (pendingNameClickRef.current !== null) {
              clearTimeout(pendingNameClickRef.current)
              pendingNameClickRef.current = null
            }
            startRenaming(group.name)
          }}
        >
          {group.name}
        </span>
      )}

      {!isRenaming && <div className="ml-auto flex items-center gap-1 flex-shrink-0">
        {group.hidden && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleHidden() }}
            className="text-elm-text p-1 rounded-elm-control hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700))"
            aria-label="Show on map"
          >
            <EyeClosed size={16} />
          </button>
        )}
        <div className="opacity-0 group-hover:opacity-100">
          <Tooltip content="More options">
            <button
              ref={menuBtnRef}
              onClick={openMenu}
              className="text-elm-text p-1 rounded-elm-control hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700))"
              aria-label="More options"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          </Tooltip>
        </div>

        <span className={clsx(
          'font-normal w-7 text-right text-sm',
          group.hidden ? 'text-elm-text-disabled' : 'text-elm-text-subtle',
        )}>{featureCount}</span>
      </div>}
    </div>
    </>
  )
}
