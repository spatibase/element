/**
 * OsmTraceHandler — one-click OSM feature pick. While editingMode is
 * 'pick-shape', clicking the map fetches nearby OSM polygons via Overpass and
 * either commits the single result or opens a small chooser for multiple
 * candidates. Hovered candidate is highlighted via the elm-osm-trace source.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, MapMouseEvent, MapLayerMouseEvent } from 'maplibre-gl'
import type { MultiPolygon, Polygon } from 'geojson'
import { useEmit, useIsEventForEditor, useIsToolKeyForEditor, runGeometryWorkerOperation, useElementEditorConfig, useAccentStyle, useTheme } from '@element-editor/ui'
import { useStyleEpoch } from '../contexts/StyleEpochContext'
import {
  fetchOverpassFeatures,
  overpassErrorMessage,
  OverpassError,
  type OverpassResult,
} from '@element-editor/core'
import {
  tileCandidates,
  tileCandidateResult,
  unionPieces,
  overpassRadiusForZoom,
  addPickedFeature,
  OSM_PICK_MIN_ZOOM,
  OSM_PICK_OVERLAY_COLORS as OVERLAY_COLORS,
  type TileCandidate,
  type TileFeature,
} from '@element-editor/core/internal'
import { useGeoStore, useUIStore } from '../store/StoreContext'
import { emptyFC } from '../utils/geojson'
import { toolCursor } from '../utils/toolCursor'
const OVERLAY_SOURCE = 'elm-osm-trace'
const PULSE_SOURCE = 'elm-osm-trace-pulse'

// --- Loading indicator styles (injected once) ---
let stylesInjected = false
function ensureStyles() {
  if (stylesInjected) return
  const s = document.createElement('style')
  s.textContent = `
    @keyframes elm-osm-pulse {
      0% { transform: scale(0.6); opacity: 0.7; }
      100% { transform: scale(3); opacity: 0; }
    }
    @keyframes elm-osm-spin {
      to { transform: rotate(360deg); }
    }
    .elm-osm-pulse-ring {
      width: 64px; height: 64px; border-radius: 50%;
      background: color-mix(in srgb, var(--color-primary-500) 20%, transparent);
      animation: elm-osm-pulse 1.4s ease-out infinite;
      pointer-events: none;
    }
    .elm-osm-spinner {
      width: 24px; height: 24px; border-radius: 50%;
      border: 4px solid color-mix(in srgb, var(--color-primary-500) 20%, transparent);
      border-top-color: var(--color-primary-500);
      animation: elm-osm-spin 0.8s linear infinite;
      pointer-events: none;
    }
  `
  document.head.appendChild(s)
  stylesInjected = true
}

export function initOverlayLayers(map: MapLibreMap) {
  if (!map.getSource(OVERLAY_SOURCE)) {
    map.addSource(OVERLAY_SOURCE, { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection })
    map.addLayer({
      id: 'elm-osm-trace-fill',
      type: 'fill',
      source: OVERLAY_SOURCE,
      paint: {
        'fill-color': ['get', '_color'],
        'fill-opacity': [
          'case',
          ['boolean', ['get', '_hovered'], false], 0.3,
          0.12,
        ],
      },
    })
    map.addLayer({
      id: 'elm-osm-trace-line',
      type: 'line',
      source: OVERLAY_SOURCE,
      paint: {
        'line-color': ['get', '_color'],
        'line-width': [
          'case',
          ['boolean', ['get', '_hovered'], false], 3,
          2,
        ],
        'line-opacity': [
          'case',
          ['boolean', ['get', '_hovered'], false], 1,
          0.7,
        ],
      },
    })
  }
}

export function cleanupOverlayLayers(map: MapLibreMap) {
  for (const id of ['elm-osm-trace-line', 'elm-osm-trace-fill']) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(OVERLAY_SOURCE)) map.removeSource(OVERLAY_SOURCE)
}

/** A shape the click found: from Overpass (ready to add) or from the tiles (merged once chosen). */
type Candidate = OverpassResult | TileCandidate

function setOverlayData(map: MapLibreMap, candidates: Candidate[] | null, hoveredIdx: number | null) {
  const src = map.getSource(OVERLAY_SOURCE) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined
  if (!src) return
  if (!candidates) { src.setData(emptyFC()); return }
  const features: GeoJSON.Feature[] = candidates.map((c, i) => ({
    type: 'Feature',
    properties: {
      _color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
      _hovered: hoveredIdx === i,
      _idx: i,
    },
    geometry: c.geometry as unknown as GeoJSON.Geometry,
  }))
  src.setData({ type: 'FeatureCollection', features })
}

// OpenMapTiles source layers worth picking (OpenFreeMap and most OSM vector basemaps).
const PICKABLE_SOURCE_LAYERS = new Set(['building', 'landuse', 'landcover', 'park', 'water', 'aeroway'])

/**
 * Shapes under the click from the basemap's vector tiles, smallest first. Each
 * feature's pieces from every loaded tile are gathered (one query per source
 * layer) but not merged: only the chosen one is (`mergeCandidate`).
 * ponytail: only loaded tiles count, so a park running far off screen comes back
 * cut at the loaded area; zoom out or fall back to Overpass if that bites.
 */
function pickFromTiles(map: MapLibreMap, pt: { x: number; y: number }): TileCandidate[] {
  const rendered: TileFeature[] = []
  const queries = new Map<string, { source: string; sourceLayer: string; ids: Set<string | number> }>()
  for (const f of map.queryRenderedFeatures([pt.x, pt.y])) {
    if (!f.sourceLayer || !PICKABLE_SOURCE_LAYERS.has(f.sourceLayer) || f.id == null) continue
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue
    rendered.push({ source: f.source, sourceLayer: f.sourceLayer, id: f.id, properties: f.properties, geometry: f.geometry })
    const q = `${f.source}\n${f.sourceLayer}`
    const entry = queries.get(q)
    if (entry) entry.ids.add(f.id)
    else queries.set(q, { source: f.source, sourceLayer: f.sourceLayer, ids: new Set([f.id]) })
  }
  const pieces: TileFeature[] = []
  for (const { source, sourceLayer, ids } of queries.values()) {
    for (const p of map.querySourceFeatures(source, { sourceLayer, filter: ['in', ['id'], ['literal', [...ids]]] })) {
      pieces.push({ source, sourceLayer, id: p.id, properties: p.properties, geometry: p.geometry })
    }
  }
  return tileCandidates(rendered, pieces)
}

/** The chosen tile shape, its pieces merged in the geometry worker (on this thread if the worker fails). */
async function mergeCandidate(c: TileCandidate, clickLngLat: [number, number]): Promise<OverpassResult | null> {
  let merged: Polygon | MultiPolygon | null = c.pieces.length === 1 ? c.pieces[0].geometry : null
  if (!merged) {
    try { merged = await runGeometryWorkerOperation({ type: 'boolean', op: 'union', features: c.pieces }) as Polygon | MultiPolygon }
    catch { merged = await unionPieces(c.pieces) }
  }
  return tileCandidateResult(c, merged, clickLngLat)
}

interface Props {
  map: MapLibreMap
}

export function OsmTraceHandler({ map }: Props) {
  const { dataStore, uiStore } = useGeoStore()
  // `config.network.overpass` / `fetch`, read at click time.
  const network = useElementEditorConfig().network
  const networkRef = useRef(network)
  networkRef.current = network
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const isToolKey = useIsToolKeyForEditor()
  const editingMode = useUIStore((s) => s.editingMode)

  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const accentStyle = useAccentStyle()
  // The picker portals to <body>: it carries the editor's mode itself (it rendered light in dark mode).
  const theme = useTheme()

  const clickLngLatRef = useRef<[number, number] | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pulseMarkerRef = useRef<maplibregl.Marker | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  // The overlay source/layers come with Element's (ensureElementLayers); only the pulse marker is ours.
  useEffect(() => {
    return () => {
      if (pulseMarkerRef.current) { pulseMarkerRef.current.remove(); pulseMarkerRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Reflect candidates + hoveredIdx changes into the source data (again after a style swap)
  const styleEpoch = useStyleEpoch()
  useEffect(() => {
    setOverlayData(map, candidates, hoveredIdx)
  }, [map, candidates, hoveredIdx, styleEpoch])

  const addFeature = useCallback(
    (result: OverpassResult) => addPickedFeature(dataStore.getState(), uiStore.getState(), result),
    [dataStore, uiStore],
  )

  const removePulse = useCallback(() => {
    if (pulseMarkerRef.current) { pulseMarkerRef.current.remove(); pulseMarkerRef.current = null }
  }, [])

  const cleanup = useCallback(() => {
    setCandidates(null)
    setHoveredIdx(null)
    clickLngLatRef.current = null
    removePulse()
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
  }, [removePulse])

  // Adds the chosen shape. A tile shape is merged first (async); leaving the
  // tool or clicking again meanwhile drops it, as for a lookup in flight.
  const choose = useCallback((c: Candidate) => {
    const click = clickLngLatRef.current
    cleanup()
    if (!('pieces' in c)) { addFeature(c); return }
    if (!click) return
    const controller = new AbortController()
    abortRef.current = controller
    void mergeCandidate(c, click).then((r) => {
      if (controller.signal.aborted) return
      abortRef.current = null
      if (r) addFeature(r)
    })
  }, [addFeature, cleanup])

  // Cancel picker on Escape, also while the lookup is still loading. Map clicks are handled by the click handler below.
  useEffect(() => {
    if (!candidates && editingMode !== 'pick-shape') return
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape' && (isForThisEditor(e) || isToolKey(e, { ignoreHandled: true }))) cleanup() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [candidates, editingMode, cleanup, isForThisEditor])

  // Map-level click: triggers pick lookup (only in pick-shape mode)
  useEffect(() => {
    if (editingMode !== 'pick-shape') return

    const onClick = (e: MapMouseEvent) => {
      if (map.getZoom() < OSM_PICK_MIN_ZOOM) {
        emit({ type: 'warning', message: 'Zoom in further to use the picker' })
        return
      }

      e.originalEvent.preventDefault()
      cleanup()

      const controller = new AbortController()
      abortRef.current = controller

      const lng = e.lngLat.lng
      const lat = e.lngLat.lat
      clickLngLatRef.current = [lng, lat]

      // Show loading indicator anchored to the clicked lngLat via a Marker
      // so MapLibre repositions it automatically during pan/zoom.
      ensureStyles()
      const el = document.createElement('div')
      el.style.cssText = 'width:64px;height:64px;pointer-events:none;display:flex;align-items:center;justify-content:center;'
      el.innerHTML = `
        <div class="elm-osm-pulse-ring" style="position:absolute"></div>
        <div class="elm-osm-spinner"></div>
      `
      pulseMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map)

      // The basemap's vector tiles usually have the shape already: instant, no
      // network. Overpass only when they don't (raster or non-OSM basemap, bare spot).
      // `overpass: false`: the tiles are all there is.
      const fromTiles = pickFromTiles(map, e.point)
      const { overpass, fetch: netFetch } = networkRef.current
      const tilesOnly = overpass === false
      const lookup: Promise<Candidate[]> = fromTiles.length > 0 || tilesOnly
        ? Promise.resolve(fromTiles)
        : fetchOverpassFeatures(lat, lng, overpassRadiusForZoom(map.getZoom()), [lng, lat], { ...overpass, fetch: netFetch, signal: controller.signal })

      lookup
        .then(results => {
          removePulse()
          if (results.length === 0) {
            emit({ type: 'warning', message: tilesOnly ? 'No shape here in the basemap' : 'No features found here' })
            cleanup()
          } else if (results.length === 1) {
            choose(results[0])
          } else {
            setCandidates(results)
          }
        })
        .catch(err => {
          // An aborted older request must not remove the newer request's pulse.
          if (err?.name === 'AbortError') return
          removePulse()
          emit({ type: 'error', code: err instanceof OverpassError ? err.code : 'unknown', source: 'picker', message: overpassErrorMessage(err), cause: err })
          cleanup()
        })
    }

    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [editingMode, map, cleanup, removePulse, choose, emit])

  // Keep picker glued to click point during zoom/pan
  useEffect(() => {
    if (!candidates || !clickLngLatRef.current) return
    const lngLat = clickLngLatRef.current
    let raf: number
    function update() {
      if (!pickerRef.current) { raf = requestAnimationFrame(update); return }
      const pt = map.project(lngLat)
      const rect = map.getContainer().getBoundingClientRect()
      pickerRef.current.style.left = `${rect.left + pt.x + 16}px`
      pickerRef.current.style.top = `${rect.top + pt.y - 8}px`
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [candidates, map])

  // Hover + click on overlay polygons (GL layer interactions)
  useEffect(() => {
    if (!candidates) return

    const onLayerClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const idx = f.properties?._idx as number | undefined
      if (typeof idx !== 'number') return
      e.originalEvent.stopPropagation()
      const chosen = candidates[idx]
      if (chosen) choose(chosen)
    }

    const onLayerEnter = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const idx = f.properties?._idx as number | undefined
      if (typeof idx === 'number') setHoveredIdx(idx)
      map.getCanvas().style.cursor = 'pointer'
    }

    // Back to the tool's cursor (DrawingLayer owns it: crosshair while a tool is active).
    const restoreCursor = () => {
      map.getCanvas().style.cursor = toolCursor(uiStore.getState().editingMode)
    }

    const onLayerLeave = () => {
      setHoveredIdx(null)
      restoreCursor()
    }

    const layerIds = ['elm-osm-trace-fill', 'elm-osm-trace-line']
    for (const id of layerIds) {
      map.on('click', id, onLayerClick)
      map.on('mouseenter', id, onLayerEnter)
      map.on('mouseleave', id, onLayerLeave)
    }
    return () => {
      for (const id of layerIds) {
        map.off('click', id, onLayerClick)
        map.off('mouseenter', id, onLayerEnter)
        map.off('mouseleave', id, onLayerLeave)
      }
      // The overlay goes away without a mouseleave when a candidate is picked.
      restoreCursor()
    }
  }, [candidates, map, choose, uiStore])

  // Reset when mode changes away from pick-shape
  useEffect(() => {
    if (editingMode !== 'pick-shape') cleanup()
  }, [editingMode, cleanup])

  if (!candidates) return null

  return createPortal(
    <div ref={pickerRef} data-elm-portal data-elm-theme={theme} style={{ ...accentStyle, position: 'fixed', zIndex: 10000 }}>
      <div className="bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 text-elm-text-secondary shadow-elm rounded-elm overflow-hidden min-w-[180px] max-w-[280px] text-sm py-1">
        {candidates.map((c, i) => (
          <button
            key={'key' in c ? c.key : `${c.osmId}/${i}`}
            onClick={() => choose(c)}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
              hoveredIdx === i ? 'bg-primary-50 dark:bg-white/5' : 'hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-elm-surface-hover'
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: OVERLAY_COLORS[i % OVERLAY_COLORS.length] }}
            />
            <span className="flex flex-col min-w-0">
              <span className="font-medium text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100)) truncate">
                {c.name || `Unnamed ${c.type.toLowerCase()}`}
              </span>
              <span className="text-xs text-(--elm-text-subtle,var(--color-gray-400))">{c.type}</span>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

export default OsmTraceHandler
