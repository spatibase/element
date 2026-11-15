/**
 * SnapController — tracks cursor position during drawing / vertex-editing and
 * sets snappedCoord in UIStore when a nearby vertex or edge is found. Renders
 * a snap indicator (vertex: filled circle; edge: diamond) via two elm-snap
 * layers driven by a `_kind` property.
 *
 * Parity with adapter-leaflet:
 *   - Cmd/Ctrl held → snap suppressed (user explicitly disabling).
 *   - Cursor hovering a `.elm-midpoint-marker` → snap suppressed (the midpoint
 *     handle owns that click; snapping would fight it).
 *   - During vertex-edit, we don't snap to vertices that belong to the
 *     feature being edited — otherwise the dragged vertex would snap to
 *     itself. Edge snapping on the same feature is allowed.
 */
import { useEffect } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { useUIStore, useGeoStore, useDataStore } from '../store/StoreContext'
import { findSnapPoint } from '../utils/snapping'
import { emptyFC } from '../utils/geojson'
import { rafThrottle } from '../utils/rafThrottle'
import { freshFeatureId } from '../utils/freshFeature'
import { paintAccent, useAccentPaint, type AccentPaint } from '../utils/accentPaint'

const SOURCE = 'elm-snap'

const ACCENT_PAINT: AccentPaint = [
  ['elm-snap-vertex', 'circle-color', (p) => p[500]],
]

export function initSnapLayers(map: MapLibreMap) {
  if (map.getSource(SOURCE)) return
  map.addSource(SOURCE, { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection })
  // Vertex indicator: filled blue circle (matches adapter-leaflet's `bg-primary-500 rounded-full`).
  map.addLayer({
    id: 'elm-snap-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', '_kind'], 'vertex'],
    paint: {
      'circle-radius': 6,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
  // Edge indicator: rotated square outline (matches adapter-leaflet's diamond
  // rendered via `rotate-45 rounded-sm`).
  map.addLayer({
    id: 'elm-snap-edge',
    type: 'symbol',
    source: SOURCE,
    filter: ['==', ['get', '_kind'], 'edge'],
    layout: {
      'icon-image': 'elm-snap-diamond',
      'icon-size': 1,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
  paintAccent(map, ACCENT_PAINT)
}

export function cleanupSnapLayers(map: MapLibreMap) {
  for (const id of ['elm-snap-edge', 'elm-snap-vertex']) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

/**
 * Registers a small diamond icon in the map's sprite sheet so the edge snap
 * can use a symbol layer. Idempotent per colour; repaints (updateImage) when
 * the accent changes.
 */
const diamondColor = new WeakMap<MapLibreMap, string>()
export function ensureDiamondIcon(map: MapLibreMap, color: string) {
  const has = map.hasImage('elm-snap-diamond')
  if (has && diamondColor.get(map) === color) return
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  const s = 8
  ctx.fillRect(-s / 2, -s / 2, s, s)
  ctx.strokeRect(-s / 2, -s / 2, s, s)
  ctx.restore()
  const imageData = ctx.getImageData(0, 0, size, size)
  if (has) map.updateImage('elm-snap-diamond', imageData as unknown as ImageData)
  else map.addImage('elm-snap-diamond', imageData as unknown as ImageData)
  diamondColor.set(map, color)
}

interface Props {
  map: MapLibreMap
}

export default function SnapController({ map }: Props) {
  const { uiStore, dataStore } = useGeoStore()
  const editingMode = useUIStore((s) => s.editingMode)
  const snapEnabled = useUIStore((s) => s.snapEnabled)
  const features = useDataStore((s) => s.features)
  const vertexEditActive = useUIStore((s) => s.vertexEditActive)
  const palette = useAccentPaint(map, ACCENT_PAINT)

  useEffect(() => {
    ensureDiamondIcon(map, palette[400])

    const isSnappingRelevant = editingMode !== 'none' || vertexEditActive

    const clearSnap = () => {
      if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
      const src = map.getSource(SOURCE) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined
      src?.setData(emptyFC())
    }

    if (!isSnappingRelevant) {
      clearSnap()
      return
    }

    const updateSnap = (e: MapMouseEvent) => {
      if (!snapEnabled) { clearSnap(); return }

      // Cmd/Ctrl suppresses snapping — lets the user place an exact
      // coordinate even if a nearby vertex/edge would otherwise snap.
      const origEv = e.originalEvent
      if (origEv.metaKey || origEv.ctrlKey) { clearSnap(); return }

      // If the cursor is over a midpoint handle (from VertexEditor), don't
      // snap — the handle owns that click, snapping there just adds noise.
      const target = origEv.target as HTMLElement | null
      if (target?.closest?.('.elm-midpoint-marker')) { clearSnap(); return }

      // Never snap to a feature just added under the still cursor (freshFeature.ts).
      const fresh = freshFeatureId()
      const snap = findSnapPoint(e.lngLat.lng, e.lngLat.lat, map, features, 15, new Set(fresh ? [fresh] : []))
      if (!snap) { clearSnap(); return }

      // During vertex-edit, don't snap to the feature's OWN vertices — that
      // would mean the dragged vertex tries to snap to itself. Edge snap on
      // the same feature is still fine.
      if (vertexEditActive && snap.isVertex) {
        const selected = new Set(dataStore.getState().selectedIds)
        if (snap.featureId && selected.has(snap.featureId)) { clearSnap(); return }
      }

      uiStore.getState().setSnappedCoord(snap.lnglat)
      const src = map.getSource(SOURCE) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined
      src?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { _kind: snap.isVertex ? 'vertex' : 'edge' },
          geometry: { type: 'Point', coordinates: snap.lnglat },
        }],
      })
    }

    // At most one snap search per animation frame. Clicks read snappedCoord
    // (DrawingLayer), so a pending search is flushed on pointerdown/up —
    // window capture runs before any map handler — and the click always sees
    // the snap for the latest cursor position.
    const snapFrame = rafThrottle(updateSnap)
    const onMousemove = (e: MapMouseEvent) => snapFrame.schedule(e)
    const flush = () => snapFrame.flush()
    const onMouseout = () => { snapFrame.cancel(); clearSnap() }

    map.on('mousemove', onMousemove)
    map.on('mouseout', onMouseout)
    window.addEventListener('pointerdown', flush, true)
    window.addEventListener('pointerup', flush, true)
    return () => {
      snapFrame.cancel()
      map.off('mousemove', onMousemove)
      map.off('mouseout', onMouseout)
      window.removeEventListener('pointerdown', flush, true)
      window.removeEventListener('pointerup', flush, true)
    }
  }, [editingMode, snapEnabled, features, vertexEditActive, map, uiStore, dataStore, palette])

  return null
}
