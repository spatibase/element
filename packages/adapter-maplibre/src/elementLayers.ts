// Element's own sources, layers and images on a MapLibre map, in stacking order (first = lowest).
import type { Map as MapLibreMap } from 'maplibre-gl'
import { readAccentPalette } from '@element-editor/core'
import { initFeatureLayers, cleanupFeatureLayers } from './components/FeatureLayer'
import { initPreviewLayers, cleanupPreviewLayers } from './components/DrawingPreviewLayer'
import { initSnapLayers, cleanupSnapLayers, ensureDiamondIcon } from './components/SnapController'
import { initProcessingPreviewLayers, cleanupProcessingPreviewLayers } from './components/GeometryProcessingPreview'
import { initMeasurePreviewLayers, cleanupMeasurePreviewLayers } from './components/MeasurePreviewLayer'
import { initDragGhostLayers, cleanupDragGhostLayers } from './components/FeatureInteractionLayer'
import { initOverlayLayers, cleanupOverlayLayers } from './components/OsmTraceHandler'
import { getBasemapIds, rememberBasemap } from './basemapIds'

const FEATURES_SOURCE = 'elm-features'

/**
 * Adds whatever of Element's sources, layers and images the map's style lacks, on top of the
 * style. Idempotent. Throws while the style is still loading ("Style is not done loading").
 */
export function ensureElementLayers(map: MapLibreMap) {
  initFeatureLayers(map)
  initPreviewLayers(map)
  initSnapLayers(map)
  initProcessingPreviewLayers(map)
  initMeasurePreviewLayers(map)
  initDragGhostLayers(map)
  initOverlayLayers(map)
  ensureDiamondIcon(map, readAccentPalette(map.getContainer())[400])
}

export function cleanupElementLayers(map: MapLibreMap) {
  cleanupOverlayLayers(map)
  cleanupDragGhostLayers(map)
  cleanupFeatureLayers(map)
  cleanupPreviewLayers(map)
  cleanupSnapLayers(map)
  cleanupProcessingPreviewLayers(map)
  cleanupMeasurePreviewLayers(map)
  if (map.hasImage('elm-snap-diamond')) map.removeImage('elm-snap-diamond')
}

/**
 * Keeps Element's layers on `map`: adds them now (or once the style can take them) and again
 * whenever the style is replaced — anyone's `map.setStyle`, full rebuild or diff (both drop
 * `elm-*`), or a full rebuild in our own `setBasemap` (which carries the layers over, but as new
 * sources without their feature-state). The trigger: `elm-features` is missing or isn't the source
 * object last synced. Nothing gates on `isStyleLoaded()` / `loaded()` (both lie under StrictMode):
 * a still-loading style throws, and the next `styledata` / `style.load` / `load` retries.
 * `onSynced` runs after each (re)add, so callers refill the new, empty sources. Returns the unsubscribe.
 */
export function watchElementLayers(map: MapLibreMap, onSynced: () => void): () => void {
  let synced: unknown
  let busy = false // ensureElementLayers' addImage fires `styledata` synchronously
  const sync = () => {
    if (busy) return
    const before = map.getSource(FEATURES_SOURCE)
    if (before && before === synced) return
    busy = true
    try {
      ensureElementLayers(map)
    } catch {
      return // style not ready yet
    } finally {
      busy = false
    }
    // What's on the map now (minus Element's layers) is the basemap: `setBasemap` replaces it and
    // carries everything else over. Recorded once, and again after a foreign `setStyle` (Element's
    // source was gone), since that style is the basemap now.
    if (!getBasemapIds(map) || (synced && !before)) rememberBasemap(map, map.getStyle())
    synced = map.getSource(FEATURES_SOURCE)
    onSynced()
  }
  sync()
  const events = ['styledata', 'style.load', 'load'] as const
  for (const e of events) map.on(e, sync)
  return () => { for (const e of events) map.off(e, sync) }
}
