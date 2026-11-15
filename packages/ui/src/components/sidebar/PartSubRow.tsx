import { clsx } from 'clsx'
import { GeometryTypeIcon } from '../ui/GeometryTypeIcon'
import type { Geometry } from '@element-editor/core'
import { getPartGeometry, getPartLabel } from '@element-editor/core/internal'

interface PartSubRowProps {
  geometry: Geometry
  partIndex: number
  isSelected: boolean
  onClick: () => void
}

export default function PartSubRow({ geometry, partIndex, isSelected, onClick }: PartSubRowProps) {
  const partGeom = getPartGeometry(geometry, partIndex)
  const label = getPartLabel(geometry, partIndex)

  return (
    // ml-5 nests the sub-row under its parent feature visually.
    <li style={{ listStyle: 'none' }} className="ml-5">
      <div
        className={clsx(
          // Fixed h-9, like FeatureRow: FeatureList computes the expanded row's height.
          'flex items-center gap-2 px-2 h-9 rounded-elm-control text-sm cursor-default',
          isSelected
            ? 'bg-(--elm-row-selected) hover:bg-(--elm-row-selected-hover) text-primary-700 dark:text-primary-300'
            : 'text-elm-text-muted hover:bg-(--elm-row-hover)',
        )}
        onClick={(e) => { e.stopPropagation(); onClick() }}
      >
        <span className={clsx(
          'flex-shrink-0',
          isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-(--elm-text-subtle,var(--color-gray-400))',
        )}>
          <GeometryTypeIcon type={partGeom.type} />
        </span>
        {/* Match FeatureRow's name padding so icon→text spacing is identical. */}
        <span className="flex-1 min-w-0 font-normal truncate leading-snug border border-transparent rounded-elm-control px-1.5 py-0.5">{label}</span>
      </div>
    </li>
  )
}
