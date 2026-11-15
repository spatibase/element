import type { GeoJSONFeature, Group } from '@element-editor/core'

/** Returns feature IDs in the visual order they appear in the layer list. */
export function getVisualFeatureOrder(features: GeoJSONFeature[], groups: Group[]): string[] {
  if (groups.length === 0) return features.map((f) => f.id)
  const ids: string[] = []
  for (const group of groups) {
    for (const f of features) {
      if (f.groupId === group.id) ids.push(f.id)
    }
  }
  for (const f of features) {
    if (!f.groupId) ids.push(f.id)
  }
  return ids
}

/**
 * Like `getVisualFeatureOrder` but skips features inside collapsed groups
 * (they aren't rendered, so they shouldn't receive keyboard focus when tabbing
 * through inline rename inputs).
 */
export function getTabbableFeatureIds(features: GeoJSONFeature[], groups: Group[]): string[] {
  const ids: string[] = []
  for (const g of groups) {
    if (g.collapsed) continue
    for (const f of features) if (f.groupId === g.id) ids.push(f.id)
  }
  for (const f of features) if (!f.groupId) ids.push(f.id)
  return ids
}
