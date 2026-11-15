import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { ArrowUpRight, Plus, Polygon } from '@phosphor-icons/react'
import type { NominatimResult } from '../../hooks/useNominatim'
import { Tooltip } from './Tooltip'

interface Props {
  results: NominatimResult[]
  loading: boolean
  error: string | null
  onGo: (r: NominatimResult) => void
  /** Omitted (readonly editor): no Add / Shape buttons. */
  onAdd?: (r: NominatimResult) => void
  onAddShape?: (r: NominatimResult) => void
  activeIndex?: number
  onHoverIndex?: (i: number) => void
  onNavigate?: (delta: 1 | -1, fromIndex: number) => void
  className?: string
  /**
   * `stack` — name on top, action buttons on a second row. Used in the
   * vertical-toolbar side popup (~320px wide) where the single-row layout
   * would truncate names to single characters.
   * `row` — single horizontal row, action buttons on the right. Used when
   * the toolbar is horizontal and the dropdown inherits the full toolbar
   * width, so there's room for both on one line.
   */
  layout?: 'stack' | 'row'
}

export interface SearchDropdownHandle {
  focusAdd: (index: number) => void
}

function shortAddress(displayName: string): string {
  const parts = displayName.split(',').map((s) => s.trim()).filter(Boolean)
  const rest = parts.slice(1)
  const meaningful = rest.filter((p) => !/^\d+$/.test(p))
  return meaningful.slice(-2).join(', ')
}

export const SearchDropdown = forwardRef<SearchDropdownHandle, Props>(function SearchDropdown(
  { results, loading, error, onGo, onAdd, onAddShape, activeIndex = -1, onHoverIndex, onNavigate, className, layout = 'stack' },
  ref,
) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const addButtonRefs = useRef<(HTMLButtonElement | null)[]>([])

  useImperativeHandle(ref, () => ({
    focusAdd(index: number) {
      addButtonRefs.current[index]?.focus()
    },
  }))

  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  return (
    <div className={className}>
      {error && <p className="px-3 py-2.5 text-sm text-rose-500">{error}</p>}
      {!error && loading && results.length === 0 && (
        <p className="px-3 py-2.5 text-sm text-(--elm-text-subtle,var(--color-gray-400))">Searching…</p>
      )}
      {!error && !loading && results.length === 0 && (
        <p className="px-3 py-2.5 text-sm text-(--elm-text-subtle,var(--color-gray-400))">No results found</p>
      )}
      {!error && results.map((r, i) => {
        const hasShape = r.geojson && r.geojson.type !== 'Point'
        const actions = (
          <>
            <Tooltip content="Fly to location">
              <button onClick={(e) => { e.stopPropagation(); onGo(r) }} className="flex-shrink-0 px-2 py-1 text-xs text-elm-text-muted hover:bg-(--elm-surface-hover,var(--color-gray-200)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) dark:hover:text-(--elm-text-secondary,var(--color-gray-300)) rounded-elm-card flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-elm-surface">
                <ArrowUpRight size={12} /> Go
              </button>
            </Tooltip>
            {onAdd && <Tooltip content="Add as point">
              <button
                ref={(el) => { addButtonRefs.current[i] = el }}
                onClick={(e) => { e.stopPropagation(); onAdd(r) }}
                className="flex-shrink-0 px-2 py-1 text-xs bg-primary-500 text-white hover:bg-primary-600 rounded-elm-card flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-elm-surface"
              >
                <Plus size={12} /> Add
              </button>
            </Tooltip>}
            {hasShape && onAddShape && (
              <Tooltip content="Add as boundary shape">
                <button onClick={(e) => { e.stopPropagation(); onAddShape(r) }} className="flex-shrink-0 px-2 py-1 text-xs bg-emerald-500 text-white hover:bg-emerald-600 rounded-elm-card flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-elm-surface">
                  <Polygon size={12} /> Shape
                </button>
              </Tooltip>
            )}
          </>
        )
        const nameAndType = (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-200)) font-medium truncate">
              {r.display_name.split(',')[0]}
            </span>
            {r.addresstype && (
              <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-elm-surface-hover text-elm-text-muted capitalize">
                {r.addresstype.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        )
        const address = (
          <span className="block text-xs text-elm-text-subtle mt-0.5 truncate">
            {shortAddress(r.display_name)}
          </span>
        )
        return (
          <div
            key={r.place_id}
            ref={(el) => { itemRefs.current[i] = el }}
            onClick={() => onGo(r)}
            onMouseEnter={() => onHoverIndex?.(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); onNavigate?.(1, i) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); onNavigate?.(-1, i) }
            }}
            className={
              layout === 'row'
                ? `flex items-center gap-2 px-3 py-2 border-b border-elm-border-subtle last:border-b-0 transition-colors cursor-pointer ${i === activeIndex ? 'bg-primary-50 dark:bg-white/5' : ''}`
                : `flex flex-col gap-1.5 px-3 py-2 border-b border-elm-border-subtle last:border-b-0 transition-colors cursor-pointer ${i === activeIndex ? 'bg-primary-50 dark:bg-white/5' : ''}`
            }
          >
            {layout === 'row' ? (
              <>
                <div className="flex-1 min-w-0">
                  {nameAndType}
                  {address}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  {nameAndType}
                  {address}
                </div>
                <div className="flex items-center gap-1 justify-start">{actions}</div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
})
