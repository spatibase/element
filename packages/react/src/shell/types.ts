import type React from 'react'
import type { FeatureCollection, FeatureCollectionInput, Schema, GeoJSONFeature, GeoJSONFeatureInput } from '../types/geojson'
import type { BoundsInput, CoordinateOptions, GeometryType } from '@element-editor/core'
import type { InitialView } from './savedView'
import type { ElementEditorEvent, ElementEditorErrorHandler, ElementEditorConfig, DrawTool } from '@element-editor/ui'

export interface ElementEditorBaseProps {
  /**
   * The starting data: any GeoJSON `FeatureCollection` (`@types/geojson`'s type-checks as is; ids,
   * `properties` and `metadata` are optional) or a single `Feature`. Pass back what `onChange`
   * gave you to restore schemas and groups too.
   *
   * Applied once, on mount, without an undo step. Data that arrives later (`null` / `undefined` →
   * data, e.g. after a fetch) is applied once too, if the editor is still empty and the user
   * hasn't edited yet; the map then fits it as on mount (see `initialView`). Any other change is
   * ignored, with a development warning: to replace the data call
   * `ref.setFeatureCollection(data, { silent: true })`, or remount with a new `key`.
   *
   * Invalid data doesn't crash the editor: it reports an `error` event and starts empty. Features
   * without a usable geometry (`geometry: null`) are left out and reported the same way.
   *
   * @default undefined (an empty editor)
   * @example
   * const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null)
   * useEffect(() => { fetch('/api/map').then((r) => r.json()).then(setData) }, [])
   * <ElementEditor initialData={data} onChange={save} />
   */
  initialData?: FeatureCollectionInput | GeoJSONFeatureInput | null
  /**
   * Where the map starts: `{ center: [lng, lat], zoom }`, `{ bounds: [west, south, east, north] }`
   * (fitted) or `'data'` (fit `initialData`). Wins over the view remembered from the last visit.
   * Read once, when the map is created.
   *
   * Without it the map starts at the remembered view (none with `config.persist: false`), else
   * fits `initialData` when it has features, else fits `bounds`, else shows Europe. `'data'` with
   * no features falls back the same way.
   *
   * @example initialView={{ center: [14.42, 50.09], zoom: 12 }} // Prague
   */
  initialView?: InitialView
  /**
   * A schema added on mount (and when a schema with a new `id` is passed later): the fields the
   * feature panel and data table show for `feature.properties`. Features follow the schema their
   * `schemaId` names, else the first one. Users can add more schemas in the editor. Schemas in
   * `initialData.metadata.schemas` are loaded too.
   *
   * @default undefined (a built-in default schema)
   * @example schema={{ id: 'parcel', name: 'Parcel', fields: [{ key: 'owner', label: 'Owner', type: 'text', required: true }] }}
   */
  schema?: Schema
  /**
   * Tools to offer: drawing tools plus `'picker'`, `'measure'` and `'search'`. Tools left out
   * disappear from the toolbar, and their keyboard shortcuts and `ref.setTool` are refused.
   * Wins over `config.tools`.
   *
   * @default all tools (`config.tools`, default `'all'`)
   * @example tools={['polygon', 'rectangle', 'point', 'measure']}
   */
  tools?: DrawTool[]
  /**
   * Most features the editor may hold. Every way of adding features respects it: drawing tools
   * turn off at the limit, duplicate / paste are refused, imports are truncated (each refusal
   * reports an `error` event, `code: 'limit-reached'`). Undo and redo are never blocked.
   *
   * @default undefined (no limit; imports are still capped at 50,000 features)
   */
  maxFeatures?: number
  /**
   * Geometry types the editor accepts, as GeoJSON type names; omit to allow all. Enforced for every
   * way a geometry gets in (drawing, paste, import, `initialData`, merge, break apart, boolean ops,
   * buffer, the ref API, ...): a refusal changes nothing and reports an `error` event, `code:
   * 'geometry-type-not-allowed'`. Drawing tools that can't draw an allowed type are left out, and
   * menu actions whose result would be refused are hidden. Works with `tools` and `maxFeatures`.
   *
   * @default undefined (every type)
   * @example geometryTypes={['Polygon', 'MultiPolygon']}
   */
  geometryTypes?: GeometryType[]
  /**
   * With `maxFeatures={1}`: a draw tool (point, line, area, rectangle, circle, freehand, route, picker)
   * replaces the only feature's geometry instead of being refused, keeping its `id`, properties, schema
   * and group. One undo step, one `onFeatureUpdate`. Tools stay available at the limit. Paste, duplicate,
   * import merge and the ref's `addFeature` still refuse. Ignored (with a dev warning) for any other
   * `maxFeatures`. For a "pick the location" field: `tools={['point']} maxFeatures={1} replaceAtLimit`.
   *
   * @default false
   */
  replaceAtLimit?: boolean
  /**
   * Opt-in clean-up of every committed coordinate (drawing, vertex edits, transforms, import, paste,
   * undo/redo, `initialData`, ref methods), so the store, `onChange` and undo history hold the same
   * values. Both parts are off unless set:
   * - `wrap: true` shifts a feature as a whole by a multiple of 360 degrees so the centre of its
   *   longitude range lies in [-180, 180] (RFC 7946 positions). Vertices stay continuous, so a shape
   *   crossing the antimeridian keeps its outline; one side may then lie beyond +-180. Latitudes
   *   beyond +-90 are clamped; others are left alone.
   * - `precision: n` rounds x and y to `n` decimals (integer 0 to 15; 6 is about 0.1 m). Altitude is kept
   *   untouched. Consecutive duplicate vertices created by rounding are dropped when the shape stays valid.
   *
   * Unrelated to `config.units.precision`, which only formats what is displayed.
   *
   * @default undefined (coordinates are stored as the map reports them)
   */
  coordinates?: CoordinateOptions
  /**
   * Restricts panning to this box: the user can't drag the map outside it. The map starts fitted
   * to it only when nothing else gives a start view (see `initialView`). A GeoJSON bbox `[west, south, east, north]`
   * (`[lng, lat]` order, same as your data), on both engines. Reactive; `undefined` removes the
   * restriction.
   *
   * Deprecated: the nested `[[south, west], [north, east]]` (`[lat, lng]`) form still works and
   * logs a one-time dev warning with the bbox equivalent.
   *
   * @example bounds={[14.2, 49.9, 14.7, 50.2]} // Prague
   */
  bounds?: BoundsInput
  /**
   * Light or dark mode. Colours are not set here: use `accentColor` for the brand colour, or
   * `style` for CSS variables (`--elm-accent`, a single `--elm-primary-N` shade).
   *
   * - `'light'` / `'dark'`: that mode, always (the settings' theme picker can still switch it until
   *   the prop changes; the prop is never saved to localStorage).
   * - `'auto'`: follows the OS (`prefers-color-scheme`).
   *
   * @default undefined: `config.mode` (default `'system'`, like `'auto'`), unless the user picked a theme in settings
   * @example theme="dark"
   */
  theme?: 'light' | 'dark' | 'auto'
  /**
   * Brand accent: any CSS colour. The whole primary scale (buttons, active
   * tools, selection, checkboxes, links, portals) is derived from it.
   * Wins over `config.accentColor`. Default: blue.
   */
  accentColor?: string
  /**
   * Default colour of every feature (polygon outline + fill, line, point): any CSS colour.
   * Opacity and weight keep their defaults; `getFeatureStyle` and the selected / hovered
   * looks win over it. Wins over `config.featureColor`. Default: slate `#475569`.
   */
  featureColor?: string
  /**
   * Where feature details and the list live:
   * - `'panel'`: a layers sidebar on the right (feature list, feature properties).
   * - `'minimal'`: no sidebar; a selected feature's properties open in a floating window.
   * - `'split'`: no sidebar; the bottom third is a panel with the data table on the left and the
   *   layers panel on its right (map controls sit above it).
   *
   * @default 'panel'
   */
  layout?: 'panel' | 'minimal' | 'split'
  /**
   * View-only mode for the user. Reactive.
   *
   * Still available: selecting features (map, layers list, table rows), zoom-to, the details panel
   * (fields disabled), show/hide of features and groups, collapsing groups, measure, search, copy,
   * export, the data table and the GeoJSON inspector (both read-only).
   *
   * Off: drawing tools and the picker, vertex edit, transform and drag, cut/slice/buffer/simplify/
   * smooth, boolean ops, merge and break apart, delete, duplicate, paste, group/ungroup, renaming,
   * layers drag-reorder, table cell edits / row delete / "Add new", the schema editor, import
   * (Cmd+O and file drop), and undo/redo (buttons hidden, keys ignored).
   *
   * Your app is still in charge: the ref's data methods (`addFeature`, `updateFeature`,
   * `setFeatureCollection`, …) keep working; only `ref.setTool` is refused (except `'measure'`).
   *
   * @default false
   * @example readonly={!user.canEdit}
   */
  readonly?: boolean
  /**
   * Dropping a `.geojson` / `.json` file on the editor imports it, like Cmd+O: replaces the data
   * (one undo step; `maxFeatures` truncates) and fits the map to it. Off in `readonly`.
   * Default: true.
   */
  fileDrop?: boolean
  /** Class added to the editor's root element (it already fills its parent: `width` / `height: 100%`). */
  className?: string
  /**
   * Inline styles merged onto the editor's root element (after Element's own and after
   * `accentColor`, so they win). Its CSS variables are Element's theming hook:
   * `'--elm-accent'` re-derives the whole primary scale (chrome, map selection and drawing
   * colours), `'--elm-primary-N'` overrides one shade. They also reach Element's body-level
   * portals (modals, menus, tooltips). CSS variables type-check without a cast. See the theming
   * guide for every variable.
   *
   * @example style={{ '--elm-accent': '#7c3aed' }}
   */
  style?: React.CSSProperties | (React.CSSProperties & { [cssVar: `--${string}`]: string | number | undefined })
  /**
   * Called after every committed change (an add, a finished drag, a property edit, an undo, an
   * import, `ref` data methods) with the full current data: features without internal state plus
   * `metadata` (schemas and groups), ready to store and pass back as `initialData`. Not called
   * while a drag is in progress, nor for the `initialData` load. `ref.setFeatureCollection` calls it
   * unless you pass `{ silent: true }`. For large data, prefer `onFeatureAdd` / `onFeatureUpdate` /
   * `onFeatureDelete`, or debounce.
   *
   * @example
   * onChange={(data) => localStorage.setItem('my-map', JSON.stringify(data))}
   */
  onChange?: (data: FeatureCollection) => void
  /**
   * Called by the "Apply changes" button (shown only when this is set) or `ref.submit()` when every
   * feature passes validation, with the full current data. When some don't, `onValidationError`
   * is called instead.
   */
  onSubmit?: (data: FeatureCollection) => void
  /**
   * Called instead of `onSubmit` when a submit finds validation errors (missing required fields,
   * numbers out of range, zero-area polygons): error messages keyed by feature id. To check without
   * submitting, use `ref.validate()`.
   */
  onValidationError?: (errors: Record<string, string[]>) => void
  /**
   * Called with the selected feature when exactly one is selected, and with `null` when that ends
   * (deselected, or a second feature joins the selection). Also called again when the selected
   * feature itself changes (its geometry or properties are edited), so it suits a details panel
   * that shows one feature. For the full selection (multi-select, lasso), use `onSelectionChange`.
   */
  onFeatureSelect?: (feature: GeoJSONFeature | null) => void
  /** Called with the new zoom level when the map's zoom changes (after the zoom ends). */
  onZoomChange?: (zoom: number) => void
  /**
   * Called with the tool that turned on (as `ref.getTool()` reports it), or `null` when the active
   * tool turned off (finished, cancelled, or `ref.setTool(null)`), whether the user or your app
   * changed it.
   */
  onToolChange?: (tool: DrawTool | null) => void
  /**
   * Called with the id of the feature that entered point editing (vertex edit, as
   * `ref.getVertexEdit()` reports it), or `null` when point editing ended, whether the user
   * (double-click, Enter, Esc, a click away, delete, undo) or your app (`ref.setVertexEdit`) changed it.
   */
  onVertexEditChange?: (id: string | null) => void
  /**
   * Receives every message the editor would show the user (errors, warnings, confirmations,
   * `feature:deleted` with an `undo`, …). With it set, the editor shows no toasts: your app
   * displays them. Without it, the editor renders its own toaster. Read once, on mount.
   */
  onEvent?: (event: ElementEditorEvent) => void
  /**
   * Called first for every runtime failure with an `ElementEditorError`: a stable `code`
   * (`'rate-limited'`, `'timeout'`, `'limit-reached'`, …), a `source` (`'basemap'`, `'picker'`,
   * `'routing'`, `'search'`, `'import'`, …) and an honest English `message`. Also fires with
   * `onEvent` set, for failures that show no toast (a failed preview, the system clipboard, the
   * search box) and for a render crash (`code: 'crash'`). Return nothing to keep the built-in toast,
   * `false` to stop it (and the `onEvent` error event), or a string to show that text instead.
   */
  onError?: ElementEditorErrorHandler
  /** Called once per newly added feature. Avoids diffing full snapshots. */
  onFeatureAdd?: (feature: GeoJSONFeature) => void
  /** Called when a feature's geometry or properties change (fires on commit, not during drag). */
  onFeatureUpdate?: (id: string, feature: GeoJSONFeature) => void
  /** Called once per deleted feature, including bulk and group deletions. */
  onFeatureDelete?: (id: string) => void
  /**
   * Called with the ids of the selected features whenever the selection changes, including
   * multi-select and lasso (`[]` when cleared). For one selected feature's data, see `onFeatureSelect`.
   */
  onSelectionChange?: (ids: string[]) => void
  /**
   * @deprecated Use `config.network.routing.apiKey` (it wins over this; dev warning).
   * OpenRouteService key for the Route tool's pedestrian routing.
   */
  routingApiKey?: string
  /**
   * Named content slots for injecting custom UI.
   *
   * - `toolbar`     — rendered inside the map area, right after the map element, with no
   *   positioning of its own (position it yourself, e.g. `position: absolute`). Hidden while the
   *   data table is fullscreen.
   * - `mapOverlay`  — absolute, full-map overlay above the map; `pointer-events: none` by default
   * - `panelFooter` — rendered below the layers/feature panel (`layout="panel"`)
   * - map slots (`topLeft`, `topCenter`, `topRight`, `leftCenter`, `rightCenter`, `bottomLeft`,
   *   `bottomCenter`, `bottomRight`) — rendered first in that slot, before the built-in
   *   controls placed there via `config.ui.layout`. The status-bar slots are not available.
   */
  slots?: {
    toolbar?: React.ReactNode
    mapOverlay?: React.ReactNode
    panelFooter?: React.ReactNode
    topLeft?: React.ReactNode
    topCenter?: React.ReactNode
    topRight?: React.ReactNode
    leftCenter?: React.ReactNode
    rightCenter?: React.ReactNode
    bottomLeft?: React.ReactNode
    bottomCenter?: React.ReactNode
    bottomRight?: React.ReactNode
  }
  /**
   * Structured configuration object. Covers theme, tools, UI visibility, toolbar layout, and units.
   * Flat props (tools, theme, accentColor, featureColor) take precedence over config when both are provided.
   */
  config?: ElementEditorConfig
}
