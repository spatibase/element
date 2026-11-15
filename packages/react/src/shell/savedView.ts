import { readPersisted, writePersisted, getFeatureCollectionBBox, type PersistScope, type BBox, type BoundsInput, type FeatureCollection, type FeatureCollectionInput, type GeoJSONFeatureInput } from '@element-editor/core'
import { normalizeBounds, warnOnce } from '@element-editor/core/internal'

/** Persisted map view, shared by the Leaflet and MapLibre drop-ins (`elm_mapView`). */
const MAP_VIEW_KEY = 'elm_mapView'
const MAP_VIEW_VERSION = 1
type MapViewShape = { lat: number; lng: number; zoom: number }

/**
 * Where the map starts: a centre (`[lng, lat]`) and zoom, a GeoJSON bbox to fit, or `'data'`
 * (fit `initialData`).
 */
export type InitialView = { center: [number, number]; zoom: number } | { bounds: BBox } | 'data'

/** A resolved start view: centre `[lng, lat]` + zoom, or a bbox to fit. */
export type ResolvedView = { center: [number, number]; zoom: number } | { bounds: BBox }

/** Used when nothing else gives a view: Europe. */
export const DEFAULT_VIEW: ResolvedView = { center: [10, 48], zoom: 5 }

/** Fit options for a `{ bounds }` start view; same as `ref.fitBounds`. */
export const FIT_PADDING = 40
export const FIT_MAX_ZOOM = 16

/** Last saved view (`[lng, lat]` + zoom), or null when none is stored or persistence is off. */
export function loadSavedView(scope?: PersistScope): { center: [number, number]; zoom: number } | null {
  try {
    const stored = readPersisted<MapViewShape>(MAP_VIEW_KEY, MAP_VIEW_VERSION, (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const v = raw as Partial<MapViewShape>
      if (typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.zoom === 'number') {
        return { lat: v.lat, lng: v.lng, zoom: v.zoom }
      }
      return null
    }, scope)
    if (stored) return { center: [stored.lng, stored.lat], zoom: stored.zoom }
  } catch { /* ignore */ }
  return null
}

export function saveView(lat: number, lng: number, zoom: number, scope?: PersistScope) {
  writePersisted<MapViewShape>(MAP_VIEW_KEY, MAP_VIEW_VERSION, { lat, lng, zoom }, scope)
}

type InitialData = FeatureCollectionInput | GeoJSONFeatureInput

const finite = (...n: unknown[]) => n.every((x) => typeof x === 'number' && Number.isFinite(x))

/** Bbox of `initialData` (a FeatureCollection or a single Feature), or null when it has no usable geometry. */
function dataBBox(data: InitialData | null | undefined): BBox | null {
  if (!data) return null
  try {
    const raw = data as unknown as { type?: unknown }
    const fc = (raw.type === 'Feature' ? { type: 'FeatureCollection', features: [raw] } : raw) as FeatureCollection
    return getFeatureCollectionBBox(fc)
  } catch {
    return null // malformed geometry: the shell reports invalid initialData itself
  }
}

/** The explicit `initialView`, or null (with a dev warning) when it is malformed. */
function explicitView(view: InitialView, data: InitialData | null | undefined): ResolvedView | null {
  if (view === 'data') return (b => (b ? { bounds: b } : null))(dataBBox(data))
  if (view && typeof view === 'object') {
    if ('bounds' in view) {
      const b = view.bounds
      if (Array.isArray(b) && b.length === 4 && finite(...b)) return { bounds: [b[0], b[1], b[2], b[3]] }
    } else if ('center' in view) {
      const c = view.center
      if (Array.isArray(c) && c.length === 2 && finite(c[0], c[1], view.zoom)) return { center: [c[0], c[1]], zoom: view.zoom }
    }
  }
  warnOnce('initialView-invalid', `initialView=${JSON.stringify(view)} is not { center: [lng, lat], zoom }, { bounds: [west, south, east, north] } or 'data'; it was ignored.`)
  return null
}

/**
 * The view the map starts with. First that applies:
 * 1. `initialView` (`'data'` with no usable geometry falls through),
 * 2. the saved view (`elm_mapView`; none when `persist: false`),
 * 3. a fit of `initialData`, when it has features (first visit: there was no saved view),
 * 4. a fit of the `bounds` prop,
 * 5. Europe ({@link DEFAULT_VIEW}).
 */
export function resolveInitialView(
  { initialView, initialData, bounds }: { initialView?: InitialView; initialData?: InitialData | null; bounds?: BoundsInput | null },
  scope?: PersistScope,
): ResolvedView {
  const explicit = initialView === undefined ? null : explicitView(initialView, initialData)
  if (explicit) return explicit
  const saved = loadSavedView(scope)
  if (saved) return saved
  const data = initialView === 'data' ? null : dataBBox(initialData) // 'data' already tried
  if (data) return { bounds: data }
  const b = normalizeBounds(bounds)
  if (b) return { bounds: b }
  return DEFAULT_VIEW
}

/**
 * `mapOptions` minus the keys Element sets itself. Each dropped key warns once (dev) with what to
 * use instead. The types already leave them out; this covers JS callers and casts.
 */
export function pickMapOptions<T extends object>(options: T | undefined, owned: Record<string, string>, engine: string): Partial<T> {
  if (!options || typeof options !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(options)) {
    if (k in owned) {
      if (v !== undefined) warnOnce(`mapOptions-${engine}-${k}`, `<ElementEditor mapOptions.${k}> is set by Element and was ignored. ${owned[k]}`)
    } else out[k] = v
  }
  return out as Partial<T>
}
