import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Polygon, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useEmit, useIsEventForEditor, useIsToolKeyForEditor, useElementEditorConfig, useAccentStyle, useTheme } from '@element-editor/ui'
import { useGeoStore, useUIStore } from '../../store/StoreContext'
import {
  fetchOverpassFeatures,
  overpassErrorMessage,
  OverpassError,
  type OverpassResult,
} from '@element-editor/core'
import {
  overpassRadiusForZoom,
  addPickedFeature,
  OSM_PICK_MIN_ZOOM,
  OSM_PICK_OVERLAY_COLORS as OVERLAY_COLORS,
} from '@element-editor/core/internal'
import { toLeaflet } from '../../utils/geojson'

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

const pulseIcon = () => {
  ensureStyles()
  return L.divIcon({
    className: '',
    html: `<div style="width:64px;height:64px;position:relative;display:flex;align-items:center;justify-content:center">
      <div class="elm-osm-pulse-ring" style="position:absolute"></div>
      <div class="elm-osm-spinner"></div>
    </div>`,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  })
}

export function OsmTraceHandler() {
  const map = useMap()
  const { dataStore, uiStore } = useGeoStore()
  // `config.network.overpass` / `fetch`, read at click time (`overpass: false` hides the Picker on Leaflet).
  const network = useElementEditorConfig().network
  const networkRef = useRef(network)
  networkRef.current = network
  const emit = useEmit()
  const isForThisEditor = useIsEventForEditor()
  const isToolKey = useIsToolKeyForEditor()
  const editingMode = useUIStore((s) => s.editingMode)

  const [candidates, setCandidates] = useState<OverpassResult[] | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const accentStyle = useAccentStyle()
  // The picker portals to <body>: it carries the editor's mode itself (it rendered light in dark mode).
  const theme = useTheme()

  const clickLatLngRef = useRef<L.LatLng | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pulseMarkerRef = useRef<L.Marker | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return () => { pulseMarkerRef.current?.remove(); abortRef.current?.abort() }
  }, [])

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
    clickLatLngRef.current = null
    removePulse()
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
  }, [removePulse])

  // Cancel picker on Escape, also while the lookup is still loading. Left-clicks on the map are handled by the
  // pick-shape useMapEvents handler below, which starts a fresh pick.
  useEffect(() => {
    if (!candidates && editingMode !== 'pick-shape') return
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape' && (isForThisEditor(e) || isToolKey(e, { ignoreHandled: true }))) cleanup() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [candidates, editingMode, cleanup, isForThisEditor])

  useMapEvents({
    click(e) {
      if (editingMode !== 'pick-shape') return
      if (map.getZoom() < OSM_PICK_MIN_ZOOM) {
        emit({ type: 'warning', message: 'Zoom in further to use the picker' })
        return
      }

      e.originalEvent.preventDefault()
      cleanup()

      const controller = new AbortController()
      abortRef.current = controller

      const { lat, lng } = e.latlng
      clickLatLngRef.current = e.latlng

      // Show loading indicator
      pulseMarkerRef.current = L.marker(e.latlng, { icon: pulseIcon(), interactive: false }).addTo(map)

      const { overpass, fetch: netFetch } = networkRef.current
      if (overpass === false) { removePulse(); cleanup(); return }
      fetchOverpassFeatures(lat, lng, overpassRadiusForZoom(map.getZoom()), [lng, lat], { ...overpass, fetch: netFetch, signal: controller.signal })
        .then(results => {
          removePulse()
          if (results.length === 0) {
            emit({ type: 'warning', message: 'No features found here' })
            cleanup()
          } else if (results.length === 1) {
            addFeature(results[0])
            cleanup()
          } else {
            setCandidates(results)
          }
        })
        .catch(err => {
          // Aborted = superseded or cancelled; its pulse is gone already, and
          // removing now would take the newer request's pulse.
          if (err?.name === 'AbortError') return
          removePulse()
          emit({ type: 'error', code: err instanceof OverpassError ? err.code : 'unknown', source: 'picker', message: overpassErrorMessage(err), cause: err })
          cleanup()
        })
    },
  })

  // Reset when mode changes away from pick-shape: drop the candidates (they'd
  // stay clickable under the next tool) and abort an in-flight lookup.
  useEffect(() => {
    if (editingMode !== 'pick-shape') cleanup()
  }, [editingMode, cleanup])

  // Keep picker glued to click point during zoom/pan animations
  useEffect(() => {
    if (!candidates || !clickLatLngRef.current) return
    const latLng = clickLatLngRef.current
    let raf: number
    function update() {
      if (!pickerRef.current) { raf = requestAnimationFrame(update); return }
      const pt = map.latLngToContainerPoint(latLng)
      const rect = map.getContainer().getBoundingClientRect()
      pickerRef.current.style.left = `${rect.left + pt.x + 16}px`
      pickerRef.current.style.top = `${rect.top + pt.y - 8}px`
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [candidates, map])

  return (
    <>
      {candidates && candidates.map((c, i) => (
        <Polygon
          key={`${c.osmId}/${i}`} // a way and a relation can share an id
          positions={c.geometry.coordinates[0].map(toLeaflet)}
          pathOptions={{
            color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
            fillColor: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
            weight: hoveredIdx === i ? 3 : 2,
            opacity: hoveredIdx === i ? 1 : 0.7,
            fillOpacity: hoveredIdx === i ? 0.3 : 0.12,
          }}
          eventHandlers={{
            click: (e) => { e.originalEvent.stopPropagation(); addFeature(c); cleanup() },
            mouseover: () => setHoveredIdx(i),
            mouseout: () => setHoveredIdx(null),
          }}
        />
      ))}

      {candidates && createPortal(
        <div ref={pickerRef} data-elm-portal data-elm-theme={theme} style={{ ...accentStyle, position: 'fixed', zIndex: 10000 }}>
          <div className="bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 text-elm-text-secondary shadow-elm rounded-elm overflow-hidden min-w-[180px] max-w-[280px] text-sm py-1">
            {candidates.map((c, i) => (
              <button
                key={`${c.osmId}/${i}`} // a way and a relation can share an id
                onClick={() => { addFeature(c); cleanup() }}
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
        document.body
      )}
    </>
  )
}
