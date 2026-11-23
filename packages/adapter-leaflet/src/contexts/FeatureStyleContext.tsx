import { createContext, useContext, type ReactNode } from 'react'
import type { PathOptions } from 'leaflet'
import type { FeatureStyle, FeatureStyleState, GeoJSONFeature } from '@element-editor/core'

export type { FeatureStyle, FeatureStyleState }

/**
 * Per-feature style: the engine-neutral `FeatureStyle` plus any other Leaflet
 * `PathOptions` (dashArray, lineCap, …). `fillColor` falls back to `color`;
 * `undefined`/`null` = default look.
 */
export type FeatureStyleFn = (feature: GeoJSONFeature, state?: FeatureStyleState) => (FeatureStyle & PathOptions) | undefined | null

const FeatureStyleContext = createContext<FeatureStyleFn | undefined>(undefined)

export function FeatureStyleProvider({
  getFeatureStyle,
  children,
}: {
  getFeatureStyle?: FeatureStyleFn
  children: ReactNode
}) {
  return (
    <FeatureStyleContext.Provider value={getFeatureStyle}>
      {children}
    </FeatureStyleContext.Provider>
  )
}

export function useFeatureStyle(): FeatureStyleFn | undefined {
  return useContext(FeatureStyleContext)
}
