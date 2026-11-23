/**
 * FeatureLayer — renders committed GeoJSON features via MapLibre GL sources/layers.
 *
 * Sources:
 *   elm-features  — all committed features (fill, line, circle layers)
 *
 * Selection + hover are driven via MapLibre feature state so the layer paint
 * expressions respond without re-rendering React.
 */
import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import { useDataStore, useUIStore } from '../store/StoreContext'
import { emptyFC } from '../utils/geojson'
import { setRenderedFeatures } from '../utils/liveFeatureSource'
import { useFeatureStyle } from '../contexts/FeatureStyleContext'
import { useElementEditorConfig } from '@element-editor/ui'
import { useOptionalEmit } from '@element-editor/ui/internal'
import { DEFAULT_FEATURE_COLOR } from '@element-editor/core'
import { warnOnce, canProcessShape, DEFAULT_FEATURE_COLOR_ON_DARK } from '@element-editor/core/internal'
import { isDarkMapStyle } from '../utils/darkStyle'
import { stateProps } from '../utils/stateStyle'
import { useStyleEpoch } from '../contexts/StyleEpochContext'
import { paintAccent, useAccentPaint, type AccentPaint } from '../utils/accentPaint'

const SOURCE = 'elm-features'
const LINE_HIT_LAYER = 'elm-features-line-hit'
const LINE_HIT_WIDTH = 16

const HOVERED: ExpressionSpecification = ['boolean', ['feature-state', 'hovered'], false]
/** Just added under the still cursor (utils/freshFeature.ts). */
const FRESH: ExpressionSpecification = ['boolean', ['feature-state', 'fresh'], false]

/** Selected → the baked `_sel*` shade of the feature's colour (derived look, see utils/stateStyle.ts), else the accent.
 *  Otherwise the per-feature colour (`getFeatureStyle`, then `featureColor`); hovered → its baked `_hov*` shade if any.
 *  Opacity / width / radius carry the rest of the hover emphasis; only a feature with no custom colour
 *  shows the old lighter slate on hover instead of the default. */
const stateColor = (accent: string, custom: unknown[], base: { color: string; hover: string }, sel: unknown[], hov: unknown[]) => [
  'case',
  ['boolean', ['feature-state', 'selected'], false], ['coalesce', ...sel, accent],
  HOVERED, ['coalesce', ...hov, ...custom, base.hover],
  ['coalesce', ...custom, base.color],
]
const FILL_CUSTOM = [['get', '_fillColor'], ['get', '_color']]
const FILL_SEL = [['get', '_selFillColor'], ['get', '_selColor']]
const FILL_HOV = [['get', '_hovFillColor'], ['get', '_hovColor']]
const LINE_SEL = [['get', '_selColor']]
const LINE_HOV = [['get', '_hovColor']]

/** The default (no featureColor / getFeatureStyle) colour and its hover, per map base: slate, lighter on a dark basemap. */
const BASE_LIGHT = { color: DEFAULT_FEATURE_COLOR, hover: '#64748b', casing: 'rgba(255, 255, 255, 0.7)' }
const BASE_DARK = { color: DEFAULT_FEATURE_COLOR_ON_DARK, hover: '#cbd5e1', casing: 'rgba(15, 23, 42, 0.5)' }

const featurePaint = (base: { color: string; hover: string; casing: string }): AccentPaint => [
  ['elm-features-fill', 'fill-color', (p) => stateColor(p[500], FILL_CUSTOM, base, FILL_SEL, FILL_HOV)],
  ['elm-features-line-casing', 'line-color', () => base.casing],
  ['elm-features-line', 'line-color', (p) => stateColor(p[500], [['get', '_color']], base, LINE_SEL, LINE_HOV)],
  // A fresh point: one accent step darker instead of a snap ring on it.
  ['elm-features-point', 'circle-color', (p) => ['case', FRESH, p[600], stateColor(p[500], FILL_CUSTOM, base, FILL_SEL, FILL_HOV)]],
]
const ACCENT_PAINT = featurePaint(BASE_LIGHT)
const ACCENT_PAINT_DARK = featurePaint(BASE_DARK)

/** Lines are drawn heavier than polygon outlines so a route reads over a busy basemap. */
const IS_LINE: ExpressionSpecification = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]]
const IDLE_WIDTH: ExpressionSpecification = ['coalesce', ['get', '_weight'], ['case', IS_LINE, 3.5, 1.8]]
const LINE_WIDTH: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'selected'], false], ['coalesce', ['get', '_selWeight'], ['case', IS_LINE, 4, 2.5]],
  HOVERED, ['+', IDLE_WIDTH, 0.7],
  IDLE_WIDTH,
]
/** A casing under lines, this many px each side (light on a light basemap, dark on a dark one). */
const LINE_CASING_WIDTH = 1.5

// ─── Source/layer initialisation (called once after map style is loaded) ──────

export function initFeatureLayers(map: MapLibreMap) {
  if (map.getSource(SOURCE)) return // already initialised (Strict Mode double-mount)

  map.addSource(SOURCE, {
    type: 'geojson',
    data: emptyFC() as GeoJSON.FeatureCollection,
    promoteId: 'id', // use each feature's `id` property as the MapLibre feature ID
  })

  // Polygon fill (covers both Polygon and MultiPolygon — maplibre reports the
  // exact GeoJSON type in ['geometry-type'], so Multi* needs explicit matches).
  // Paint expressions `coalesce` a per-feature `_fillColor` / `_strokeColor` /
  // etc. into the hard-coded state-driven defaults so `getFeatureStyle` can
  // override per feature without us rebuilding layers.
  map.addLayer({
    id: 'elm-features-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 0.28,
        HOVERED, ['max', ['coalesce', ['get', '_fillOpacity'], 0.13], 0.22],
        ['coalesce', ['get', '_fillOpacity'], 0.13],
      ],
    },
  })

  // Casing under lines (not polygon outlines), so a line reads over busy raster tiles.
  map.addLayer({
    id: 'elm-features-line-casing',
    type: 'line',
    source: SOURCE,
    filter: IS_LINE,
    paint: {
      'line-width': ['+', LINE_WIDTH, 2 * LINE_CASING_WIDTH],
      'line-opacity': ['coalesce', ['get', '_opacity'], 1],
    },
  })

  // Polygon + line outlines (Multi* variants included)
  map.addLayer({
    id: 'elm-features-line',
    type: 'line',
    source: SOURCE,
    filter: [
      'in',
      ['geometry-type'],
      ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']],
    ],
    paint: {
      'line-width': LINE_WIDTH,
      'line-opacity': ['coalesce', ['get', '_opacity'], 1],
    },
  })

  // Invisible hover / click band around lines, LINE_HIT_WIDTH px wide (8 px each side of
  // the cursor), so a thin line needn't be hit dead-on. Above the fill, so a line inside a
  // polygon still wins near its stroke; below points.
  map.addLayer({
    id: LINE_HIT_LAYER,
    type: 'line',
    source: SOURCE,
    filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
    paint: { 'line-width': LINE_HIT_WIDTH, 'line-color': '#000', 'line-opacity': 0 },
  })

  // Points (Point + MultiPoint, excluding text features)
  map.addLayer({
    id: 'elm-features-point',
    type: 'circle',
    source: SOURCE,
    filter: [
      'all',
      ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
      ['!=', ['get', '_isText'], 'true'],
    ],
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], ['coalesce', ['get', '_selRadius'], 10],
        HOVERED, 9,
        8,
      ],
      'circle-opacity': ['coalesce', ['get', '_fillOpacity'], 1],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })

  // Text labels (symbol layer). A style without `glyphs` (e.g. a host's own `setStyle`) can't draw
  // text and MapLibre rejects the layer, so skip just this one.
  if (!map.getGlyphs()) {
    warnOnce('maplibre-no-glyphs', 'The map style has no `glyphs`, so Element can\'t show text features. Use a style with glyphs that serve "Noto Sans Regular".')
  } else map.addLayer({
    id: 'elm-features-text',
    type: 'symbol',
    source: SOURCE,
    filter: ['==', ['get', '_isText'], 'true'],
    layout: {
      'text-field': ['get', 'name'],
      // OpenFreeMap's glyph server only has Noto Sans (Open Sans 404s), see basemaps/index.ts.
      'text-font': ['Noto Sans Regular'],
      'text-size': 14,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': DEFAULT_FEATURE_COLOR,
      'text-halo-width': 2,
    },
  })
  paintAccent(map, ACCENT_PAINT)
}

export function cleanupFeatureLayers(map: MapLibreMap) {
  for (const id of ['elm-features-text', 'elm-features-point', LINE_HIT_LAYER, 'elm-features-line', 'elm-features-line-casing', 'elm-features-fill']) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

// ─── React component ──────────────────────────────────────────────────────────

export const INTERACTIVE_FEATURE_LAYERS = ['elm-features-fill', 'elm-features-line', LINE_HIT_LAYER, 'elm-features-point']

interface Props {
  map: MapLibreMap
}

export default function FeatureLayer({ map }: Props) {
  const features = useDataStore((s) => s.features)
  const groups = useDataStore((s) => s.groups)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const editingMode = useUIStore((s) => s.editingMode)
  // Boolean selector: slider ticks change the preview's content, not its presence.
  const previewActive = useUIStore((s) => s.geometryPreview !== null)
  const bufferCreateNew = useUIStore((s) => s.bufferCreateNew)
  const getFeatureStyle = useFeatureStyle()
  const { featureColor, selectionStyle } = useElementEditorConfig()
  // Bumped when the source was (re)created on a new style: refill it and re-apply the selection.
  const styleEpoch = useStyleEpoch()
  // A dark basemap gets the lighter default colour (a new style re-inits the
  // layers with the light one, so repaint on every style epoch).
  // Read on every style change: the epoch can bump before a new style's layers
  // are readable (the demo's first load missed it), so follow `styledata` too.
  const [darkMap, setDarkMap] = useState(() => isDarkMapStyle(map))
  useEffect(() => {
    const read = () => setDarkMap(isDarkMapStyle(map))
    read()
    map.on('styledata', read)
    return () => { map.off('styledata', read) }
  }, [map, styleEpoch])
  const paints = darkMap ? ACCENT_PAINT_DARK : ACCENT_PAINT
  // Only the 'feature' look derives from the default colour, which differs per basemap tone.
  const defaultColor = selectionStyle === 'feature' && darkMap ? DEFAULT_FEATURE_COLOR_ON_DARK : DEFAULT_FEATURE_COLOR
  const palette = useAccentPaint(map, paints)
  useEffect(() => { paintAccent(map, paints, palette) }, [styleEpoch]) // eslint-disable-line react-hooks/exhaustive-deps -- the hook covers the rest

  // A style without glyphs can't draw text features (initFeatureLayers skips that layer). Tell the
  // host quietly (onError only), once per mount.
  const emit = useOptionalEmit()
  const glyphlessReported = useRef(false)
  useEffect(() => {
    if (glyphlessReported.current || map.getGlyphs()) return
    glyphlessReported.current = true
    emit?.({
      type: 'error', code: 'unsupported', source: 'basemap', quiet: true,
      message: 'The map style has no glyphs, so text features are not shown. Use a style whose glyphs serve "Noto Sans Regular".',
    })
  }, [map, styleEpoch, emit])

  // Selection only affects the source data while a simplify / smooth / buffer
  // preview hides the selected shapes (GeometryProcessingPreview draws them
  // instead). Outside that, selection is pure feature-state, so a click must
  // not re-send (and re-tile) the whole collection. Likewise only the preview's
  // presence matters here, not its per-slider-tick content.
  const hidePreviewTarget =
    previewActive &&
    (editingMode === 'simplify-shape' ||
      editingMode === 'smooth-shape' ||
      (editingMode === 'buffer-shape' && !bufferCreateNew))
  const previewHiddenIds = hidePreviewTarget ? selectedIds : null

  // Update source data whenever the feature list changes. No JS viewport
  // culling: geojson-vt tiles the source, so culling here only forced a full
  // re-parse + re-tile on every pan.
  useEffect(() => {
    const source = map.getSource(SOURCE) as GeoJSONSource | undefined
    if (!source) return

    const hiddenGroupIds = new Set(groups.filter((g) => g.hidden).map((g) => g.id))
    const previewHiddenSet = previewHiddenIds ? new Set(previewHiddenIds) : null

    const visible = features.filter((f) => {
      if (f.hidden) return false
      if (f.groupId && hiddenGroupIds.has(f.groupId)) return false
      if (
        previewHiddenSet?.has(f.id) &&
        canProcessShape(f.geometry.type)
      ) {
        return false
      }
      return true
    })

    // Strip internal fields and ensure `id` is in properties for promoteId.
    // GeometryCollection features are expanded into one render-feature per
    // sub-geometry, all sharing the parent's `id` — feature-state (selected /
    // hovered) applied to the parent id then cascades to every sub-part, and
    // queryRenderedFeatures hit-testing still reports the parent id.
    const rendered: GeoJSON.Feature[] = []
    // False once any id appears twice (GC expansion) — `updateData` needs
    // unique ids, so live drag previews fall back to `setData`.
    let uniqueIds = true
    for (const f of visible) {
      const { _validation, ...rest } = f
      // Bake getFeatureStyle() result into feature properties so the paint
      // expressions above can read per-feature overrides via `['get', '_color']`
      // etc. Missing keys fall through to the defaults. `featureColor` stands in
      // for a missing `color`, so the fill (`_fillColor` → `_color`) follows it too.
      const style = getFeatureStyle?.(f, { selected: false, hovered: false }) ?? undefined
      const styleProps: Record<string, unknown> = {}
      const color = style?.color ?? featureColor
      if (color !== undefined) styleProps._color = color
      if (style) {
        if (style.fillColor !== undefined) styleProps._fillColor = style.fillColor
        if (style.opacity !== undefined) styleProps._opacity = style.opacity
        if (style.fillOpacity !== undefined) styleProps._fillOpacity = style.fillOpacity
        if (style.weight !== undefined) styleProps._weight = style.weight
      }
      // Selected / hovered shades of this feature's colour (derived look) and the host's per-state style.
      const baseStyle = color !== undefined || style ? { ...style, ...(color !== undefined && { color }) } : undefined
      const lineLike = f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'
      const look = stateProps(f, baseStyle, getFeatureStyle, selectionStyle, defaultColor, lineLike ? 4 : 2.5)
      if (look) Object.assign(styleProps, look)
      if (f.geometry.type === 'GeometryCollection') {
        if (f.geometry.geometries.length > 1) uniqueIds = false
        for (const sub of f.geometry.geometries) {
          rendered.push({
            ...rest,
            geometry: sub as unknown as GeoJSON.Geometry,
            properties: { ...rest.properties, ...styleProps, id: f.id },
          } as unknown as GeoJSON.Feature)
        }
      } else {
        rendered.push({
          ...rest,
          properties: { ...rest.properties, ...styleProps, id: f.id },
        } as unknown as GeoJSON.Feature)
      }
    }

    source.setData({ type: 'FeatureCollection', features: rendered } as GeoJSON.FeatureCollection)
    setRenderedFeatures(map, rendered, uniqueIds)
  }, [features, groups, map, previewHiddenIds, getFeatureStyle, featureColor, selectionStyle, defaultColor, styleEpoch])

  // Sync `selected` feature state — only for ids whose selection changed.
  // MapLibre keeps feature state per id across setData, so unchanged ids
  // keep theirs. A new source (new style epoch) has none: re-apply them all.
  const prevSelectedRef = useRef<Set<string>>(new Set())
  const selectedEpochRef = useRef(styleEpoch)
  useEffect(() => {
    if (!map.getSource(SOURCE)) return // mid style swap; the repair bumps the epoch
    if (selectedEpochRef.current !== styleEpoch) {
      selectedEpochRef.current = styleEpoch
      prevSelectedRef.current = new Set()
    }
    const prev = prevSelectedRef.current
    const next = new Set(selectedIds)
    for (const id of prev) {
      if (!next.has(id)) map.setFeatureState({ source: SOURCE, id }, { selected: false })
    }
    for (const id of next) {
      if (!prev.has(id)) map.setFeatureState({ source: SOURCE, id }, { selected: true })
    }
    prevSelectedRef.current = next
  }, [selectedIds, map, styleEpoch])

  return null
}

// Re-export type for use in other components
declare module 'maplibre-gl' {
  interface GeoJSONSource {
    setData(data: GeoJSON.FeatureCollection | string): void
  }
}

// Helper to set hover state from outside this component
export function setHoverState(map: MapLibreMap, id: string | null, prevId: string | null) {
  if (!map.getSource(SOURCE)) return // mid style swap
  if (prevId) map.setFeatureState({ source: SOURCE, id: prevId }, { hovered: false })
  if (id) map.setFeatureState({ source: SOURCE, id: id }, { hovered: true })
}
