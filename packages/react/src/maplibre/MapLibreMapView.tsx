import { memo, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { MapOptions, StyleSpecification } from 'maplibre-gl'
import { ensureWorkerUrl } from './workerUrl'
import { ElementEditorControls, useBasemap, type FeatureStyleFn } from '@element-editor/adapter-maplibre'
import { useServiceAttribution } from '@element-editor/ui/internal'
import { loadBasemapStyle, resolveBasemap, type BasemapInput } from '@element-editor/adapter-maplibre/basemaps'
import { useUIStore } from '../store/StoreContext'
import { useElementEditorConfig } from '@element-editor/ui'
import { resolveInitialView, saveView, FIT_MAX_ZOOM, FIT_PADDING, type InitialView } from '../shell/savedView'
import { ElementEditorError, type BoundsInput, type FeatureCollectionInput, type GeoJSONFeatureInput } from '@element-editor/core'
import { loadErrorCode } from '@element-editor/core/internal'
import { useAttributionAutoCollapse } from '../shell/useAttributionAutoCollapse'

/** Creation-time inputs of the map, read once (the entry passes the first values). */
export interface MapSetup {
  initialView?: InitialView
  initialData?: FeatureCollectionInput | GeoJSONFeatureInput | null
  bounds?: BoundsInput
  /** Already filtered of the keys Element owns. */
  mapOptions?: Partial<MapOptions>
}

/** Fallback when the basemap style can't be loaded: the editor still works, on a blank map. */
const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] }

/**
 * Owns the `maplibregl.Map`. The map is created only after the initial basemap style is loaded and
 * is created WITH it, so the adapter's init (add `elm-*` source/layers) never races a `setStyle`
 * and nothing depends on maplibre's unreliable `isStyleLoaded()` under StrictMode.
 * Also keeps the map on the current `basemap` (and `'auto'` on the theme) even when no picker is mounted.
 */
// memo: the shell re-renders on every host render (inline props); the map and its
// controls (which draw every feature) only need to when these props change.
export default memo(function MapLibreMapView({ basemap, themeMode, attributionTarget, attributionCorner, getFeatureStyle, setup, onReady }: {
  /** Current basemap choice; the first value is the one the map is created with. */
  basemap: BasemapInput
  themeMode: 'light' | 'dark'
  /** Status bar element to move the attribution control into (instead of the compact "i" toggle). */
  attributionTarget?: HTMLElement | null
  /** Shell element (bottom-right end of the slot row) to move the compact attribution into; else the map's corner. */
  attributionCorner?: HTMLElement | null
  getFeatureStyle?: FeatureStyleFn
  /** Start view + extra map options; only the first value is used. */
  setup: MapSetup
  /** Stable: called once per map once Element's layers are on it. */
  onReady?: (map: maplibregl.Map) => void
}) {
  const readonly = useUIStore((s) => s.readonly)
  const reportError = useUIStore((s) => s.reportError)
  const bounds = useUIStore((s) => s.bounds)
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  // Only the first values matter (the map is created once); later theme/basemap changes go through useBasemap.
  const initial = useRef({ basemap, themeMode, scope: useElementEditorConfig(), setup })
  const reportErrorRef = useRef(reportError)
  reportErrorRef.current = reportError
  useBasemap(map, basemap, { theme: themeMode, initialApplied: true })
  const credit = useServiceAttribution()

  useEffect(() => {
    const el = container.current
    if (!el) return
    let dead = false
    let created: maplibregl.Map | null = null
    let ro: ResizeObserver | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const { basemap, themeMode, scope, setup } = initial.current
    const fail = (err: unknown) => {
      const message = `The basemap could not be loaded (${err instanceof Error ? err.message : String(err)}). The map shows no basemap; editing still works.`
      console.error(`[element-editor] ${message}`)
      reportErrorRef.current(new ElementEditorError(loadErrorCode(err), 'basemap', message, { cause: err }))
    }
    loadBasemapStyle(resolveBasemap(basemap, themeMode), { network: scope.network, theme: themeMode }).catch((err) => {
      if (!dead) fail(err)
      return EMPTY_STYLE
    }).then((style) => {
      if (dead) return
      const view = resolveInitialView(setup, scope)
      ensureWorkerUrl(scope.network?.maplibreWorker)
      const m = new maplibregl.Map({
        ...setup.mapOptions,
        container: el,
        style,
        ...('bounds' in view
          ? { bounds: [[view.bounds[0], view.bounds[1]], [view.bounds[2], view.bounds[3]]], fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM } }
          : { center: view.center, zoom: view.zoom }),
        attributionControl: false,
      })
      created = m
      // A style URL is fetched by maplibre itself; if that fails the map never loads (nor the editor
      // layers). An error before the first `styledata` (the style JSON itself parsed) is the style
      // failing: fall back to empty. Later ones (a sprite or glyph 404) leave the basemap alone.
      if (typeof style === 'string') {
        const onError = (e: { error?: unknown }) => { m.off('error', onError); fail(e.error); m.setStyle(EMPTY_STYLE, { diff: false }) }
        m.on('error', onError)
        m.once('styledata', () => m.off('error', onError))
      }
      m.on('moveend', () => {
        clearTimeout(timer)
        timer = setTimeout(() => { const c = m.getCenter(); saveView(c.lat, c.lng, m.getZoom(), scope) }, 300)
      })
      ro = new ResizeObserver(() => m.resize())
      ro.observe(el)
      setMap(m)
    })
    return () => {
      dead = true
      clearTimeout(timer)
      ro?.disconnect()
      created?.remove()
      setMap(null)
    }
  }, [])

  // Attribution: compact "i" toggle on the map, or non-compact and moved into the status bar.
  // Compact, it shows expanded at load (MapLibre adds maplibregl-compact-show once the first
  // attribution arrives) and collapses on the first map interaction or after five seconds (OSM
  // Foundation attribution guidelines); MapLibre itself collapses it again on every map drag.
  const attribEl = useRef<HTMLElement | null>(null)
  const stopAutoCollapse = useAttributionAutoCollapse(map?.getContainer(), () => {
    const el = attribEl.current
    // Not collapsed while it has nothing to show yet: it then appears expanded, and a drag folds it.
    if (el && el.classList.contains('maplibregl-compact') && !el.classList.contains('maplibregl-attrib-empty')) {
      el.classList.remove('maplibregl-compact-show')
    }
  }, !!map && !attributionTarget)
  useEffect(() => {
    if (!map) return
    // Service credits (geocoder, router), as the Leaflet adapter adds.
    const ctrl = new maplibregl.AttributionControl({
      compact: !attributionTarget,
      ...(credit && { customAttribution: credit }),
    })
    map.addControl(ctrl, 'bottom-right')
    const el = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib')
    attribEl.current = el
    const host = attributionTarget ?? attributionCorner
    if (host && el) { el.classList.add(attributionTarget ? 'elm-attribution-bar' : 'elm-attribution-corner'); host.appendChild(el) }
    // The user toggling it themselves cancels the pending auto-collapse.
    const button = el?.querySelector('.maplibregl-ctrl-attrib-button')
    button?.addEventListener('click', stopAutoCollapse)
    return () => {
      button?.removeEventListener('click', stopAutoCollapse)
      attribEl.current = null
      try { map.removeControl(ctrl) } catch { /* map already removed */ }
    }
  }, [map, attributionTarget, attributionCorner, credit, stopAutoCollapse])

  return (
    <>
      {/* Inline, not classes: maplibre-gl.css (unlayered) sets `.maplibregl-map { position: relative }`, which beats Tailwind's layered `absolute`. */}
      <div ref={container} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      {map && (
        <ElementEditorControls
          map={map}
          readonly={readonly}
          drawingBar={false}
          getFeatureStyle={getFeatureStyle}
          maxBounds={bounds ?? null} // uiStore holds a bbox, which MapLibre takes as-is
          onReady={onReady}
        />
      )}
    </>
  )
})
