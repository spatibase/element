/**
 * The "fresh" feature: one just added under a still cursor (a placed point, a line
 * finished with Enter on its last vertex). Until the cursor leaves it, it shows no
 * name tooltip and is no snap target (the snap ring would sit on the point you just
 * placed); a fresh point is painted one accent step darker instead (feature-state
 * `fresh`, see FeatureLayer). FeatureInteractionLayer sets and clears it.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

const SOURCE = 'elm-features'
let freshId: string | null = null

export const freshFeatureId = () => freshId

export function setFreshFeature(map: MapLibreMap, id: string | null) {
  if (freshId === id) return
  if (map.getSource(SOURCE)) { // absent mid style swap
    if (freshId) map.setFeatureState({ source: SOURCE, id: freshId }, { fresh: false })
    if (id) map.setFeatureState({ source: SOURCE, id }, { fresh: true })
  }
  freshId = id
}
