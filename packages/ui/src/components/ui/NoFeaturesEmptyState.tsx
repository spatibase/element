import { MapPinPlus } from '@phosphor-icons/react'

export function NoFeaturesEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-full text-elm-text-muted">
      <MapPinPlus size={40} weight="light" />
      <p className="text-sm text-center text-balance leading-snug">
        No features yet — add a point, line, or area
      </p>
    </div>
  )
}
