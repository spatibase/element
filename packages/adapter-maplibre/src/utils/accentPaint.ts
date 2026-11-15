import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { readAccentPalette, type AccentPalette } from '@element-editor/core'
import { useAccentPalette } from '@element-editor/ui'

/**
 * Accent-coloured paint properties: `[layer id, paint property, value]`.
 * MapLibre paint needs concrete colours, so these are set from JS — once by
 * the layer's `init*` (via `paintAccent`) and again whenever the editor
 * accent changes (via `useAccentPaint`). Keep accent colours OUT of the
 * `addLayer` paint literals; this table is their single source.
 */
export type AccentPaint = ReadonlyArray<readonly [layerId: string, prop: string, value: (p: AccentPalette) => unknown]>

export function paintAccent(map: MapLibreMap, paints: AccentPaint, palette: AccentPalette = readAccentPalette(map.getContainer())) {
  for (const [id, prop, value] of paints) {
    // `as never`: MapLibre 6 types the property name per layer type, 5 takes any string.
    if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value(palette) as never)
  }
}

/** Re-apply `paints` when the accent changes; returns the live palette. */
export function useAccentPaint(map: MapLibreMap, paints: AccentPaint): AccentPalette {
  const palette = useAccentPalette(map.getContainer())
  useEffect(() => { paintAccent(map, paints, palette) }, [map, paints, palette])
  return palette
}
