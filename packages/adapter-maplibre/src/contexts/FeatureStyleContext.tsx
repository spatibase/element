import { createContext, useContext, type ReactNode } from 'react'
import type { FeatureStyle, GeoJSONFeature } from '@element-editor/core'

// Canonical type lives in @element-editor/core — re-exported for backwards compatibility.
export type { FeatureStyle }

export type FeatureStyleFn = (feature: GeoJSONFeature) => FeatureStyle | undefined | null

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
