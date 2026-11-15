import { Eye } from '@phosphor-icons/react'
import { useUIStore } from '../store/StoreContext'

export default function ReadonlyBanner() {
  const readonly = useUIStore((s) => s.readonly)
  if (!readonly) return null
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm text-sm text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300)) pointer-events-auto antialiased select-none">
      <Eye size={20} weight="duotone" className="text-elm-text-muted" />
      <span>View-only mode</span>
    </div>
  )
}
