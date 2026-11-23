import { createContext, useContext, useMemo, useState, useCallback, useRef, type ReactNode } from 'react'
import { readPersisted, writePersisted } from '@element-editor/core'
import { warnOnce } from '@element-editor/core/internal'
import type { EditingMode, NetworkConfig, GeoJSONFeature, SelectionStyle } from '@element-editor/core'

export type DrawTool =
  | 'polygon' | 'rectangle' | 'circle' | 'line' | 'point' | 'freehand' | 'route' | 'picker'
  | 'measure' | 'search'

/** The editing mode each tool turns on (`'search'` is a box, not a mode). The tools that add a feature are all but `measure`. */
export const TOOL_MODES = {
  point: 'place-point', line: 'draw-line', polygon: 'draw-polygon', route: 'draw-route',
  circle: 'draw-circle', rectangle: 'draw-rect', freehand: 'draw-freehand', picker: 'pick-shape',
  measure: 'measure',
} as const satisfies Record<Exclude<DrawTool, 'search'>, EditingMode>

/**
 * Where a control can go (`config.ui.layout`): eight places on the map (four
 * corners, four edge centers) and the two ends of the status bar under it.
 */
export type LayoutSlot = MapSlot | StatusSlot
/** The eight places on the map. */
export type MapSlot =
  | 'topLeft' | 'topCenter' | 'topRight'
  | 'leftCenter' | 'rightCenter'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight'
/** The two ends of the status bar under the map. */
export type StatusSlot = 'statusLeft' | 'statusRight'

/** Every placeable built-in control. */
export type LayoutControl =
  | 'toolbar'                       // the floating toolbar (drawing tools + search)
  | 'undo' | 'redo'
  | 'fitBounds' | 'locate' | 'zoomIndicator'
  | 'table' | 'schema' | 'geojson' | 'settings' | 'keyboard'
  | 'applyChanges'
  | 'attribution'                   // tile/data credits; status bar slots only
  | 'basemap'                       // basemap picker; only when the editor has basemaps; never in a group

type MapControl = Exclude<LayoutControl, 'attribution'>
type StatusControl = Exclude<LayoutControl, 'toolbar' | 'applyChanges'>
/** Controls drawn as one joined pill on the map. No toolbar or basemap picker inside. */
export type MapGroup = { group: ReadonlyArray<Exclude<MapControl, 'toolbar' | 'basemap'> | 'separator'> }
/** Controls drawn as a tight cluster in the status bar. */
export type StatusGroup = { group: ReadonlyArray<Exclude<StatusControl, 'basemap'> | 'separator'> }
/** A map slot entry. No bare `'separator'` (nothing to draw it on over the tiles): put it in a group. */
export type MapEntry = MapControl | MapGroup
export type StatusEntry = StatusControl | 'separator' | StatusGroup
export type MapSlotConfig = readonly MapEntry[] | { items: readonly MapEntry[]; direction?: 'horizontal' | 'vertical' }
/** Status slots are always horizontal. */
export type StatusSlotConfig = readonly StatusEntry[]
export type LayoutGroup = MapGroup | StatusGroup
export type LayoutEntry = MapEntry | StatusEntry
export type LayoutSlotConfig = MapSlotConfig | StatusSlotConfig
/** Where every built-in control goes (`config.ui.layout`). Each slot only takes the entries it can show. */
export type LayoutConfig = { [S in MapSlot]?: MapSlotConfig } & { [S in StatusSlot]?: StatusSlotConfig }

/** A slot after resolution: duplicates and invalid entries removed, groups normalised. */
export type ResolvedLayout = Record<LayoutSlot, { items: LayoutEntry[]; direction: 'horizontal' | 'vertical' }>

/** Slot order. A control listed twice stays at its first place in this order. */
export const LAYOUT_SLOTS: readonly LayoutSlot[] = [
  'topLeft', 'topCenter', 'topRight',
  'leftCenter', 'rightCenter',
  'bottomLeft', 'bottomCenter', 'bottomRight',
  'statusLeft', 'statusRight',
]

const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o) }
  return o
}

/**
 * Layout used when `ui.layout` isn't set.
 * Deep-frozen (shared by every editor on the page). To change it, use {@link withLayout}.
 */
export const DEFAULT_LAYOUT: LayoutConfig = deepFreeze({
  topCenter: ['toolbar'],
  leftCenter: [{ group: ['undo', 'redo'] }],
  bottomLeft: ['basemap', 'fitBounds', 'locate', 'zoomIndicator', 'table', 'schema', 'geojson', 'settings', 'keyboard', 'applyChanges'],
})

/**
 * Drop separators that would show nothing useful: at the start or end of a
 * section and right after another separator. Call it after hidden buttons
 * are removed, so a separator next to a hidden button disappears too.
 */
export function collapseSeparators<T>(entries: readonly (T | 'separator')[]): (T | 'separator')[] {
  const out: (T | 'separator')[] = []
  for (const e of entries) {
    if (e === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue
    out.push(e)
  }
  if (out[out.length - 1] === 'separator') out.pop()
  return out
}

/**
 * Whether a placed control renders at all, given the visibility flags.
 * `<ElementEditor>` uses it both to render a control and to decide whether a
 * slot, group or the status bar has anything left to show, so they can't drift.
 */
export function isControlVisible(
  id: LayoutControl,
  ui: ResolvedConfig['ui'],
  ctx: { readonly: boolean; canSubmit: boolean; hasBasemaps: boolean },
): boolean {
  switch (id) {
    case 'fitBounds':     return ui.zoomToAll
    case 'locate':        return ui.locateButton
    case 'zoomIndicator': return ui.zoomIndicator
    case 'table':         return ui.dataTable
    case 'schema':        return ui.schemaEditor && !ctx.readonly
    case 'geojson':       return ui.geojsonEditor
    case 'settings':      return ui.settings
    case 'keyboard':      return ui.keyboardShortcuts.show
    case 'applyChanges':  return ctx.canSubmit && !ctx.readonly
    case 'undo':
    case 'redo':          return !ctx.readonly // nothing to undo when nothing can be edited
    case 'basemap':       return ctx.hasBasemaps
    default:              return true // toolbar, attribution
  }
}

/**
 * A slot's entries with hidden controls removed, then empty groups and
 * dangling separators (also inside groups) dropped.
 */
export function visibleLayoutEntries(
  entries: readonly LayoutEntry[],
  isVisible: (id: LayoutControl) => boolean,
): LayoutEntry[] {
  const out: LayoutEntry[] = []
  for (const e of entries) {
    if (typeof e === 'object') {
      const group = collapseSeparators(e.group.filter((g) => g === 'separator' || isVisible(g)))
      if (group.length) out.push({ group } as LayoutGroup)
    } else if (e === 'separator' || isVisible(e)) out.push(e)
  }
  return collapseSeparators(out)
}

/** A raster tile basemap (XYZ). Engine-neutral, so the Leaflet drop-in needs no MapLibre types. */
export interface RasterBasemap {
  id?: string
  label?: string
  thumbnail?: string
  url: string
  attribution: string
  maxZoom?: number
}

/**
 * Where the floating toolbar is anchored inside the map container
 * (`ResolvedConfig.toolbar.position`, derived from the toolbar's layout slot).
 *
 * Eight positions — the four corners, the four edge-centers:
 *
 *   top-left     top-center     top-right
 *                                left-center   right-center
 *   bottom-left  bottom-center  bottom-right
 */
export type ToolbarPosition =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'left-center' | 'right-center'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** The hover tooltip over a feature (`config.featureTooltip`). */
export interface FeatureTooltipOptions {
  /**
   * `'cursor'` (default): follows the pointer. `'anchor'`: stays put while the pointer is on the
   * feature and follows the map when it pans or zooms. Anchored above a point's marker, halfway
   * along a line, and at a spot guaranteed inside an area.
   */
  placement?: 'cursor' | 'anchor'
  /**
   * The tooltip text for a feature. `null` or `''`: no tooltip for it. `undefined`: the default
   * label (name, else area / length). Called once per hover.
   */
  content?: (feature: GeoJSONFeature) => string | null | undefined
}

export interface ElementEditorConfig {
  /** Color theme. Default: 'system' (follows OS preference). */
  mode?: 'light' | 'dark' | 'system'

  /**
   * Brand accent: any CSS colour (`'#ea580c'`, `'rebeccapurple'`, `'oklch(…)'`).
   * The whole primary 50…950 scale (buttons, active tools, selection, checkboxes,
   * links) is derived from it in CSS. Applied as `--elm-accent` on the editor
   * root and on Element's portals; updates live. Default: undefined (blue).
   * `<ElementEditor accentColor>` wins over this.
   */
  accentColor?: string

  /**
   * Default colour of every feature (polygon outline + fill, line, point): any
   * CSS colour. Opacity and weight keep their defaults. `getFeatureStyle` (per
   * field) and the selected / hovered looks win over it. Updates live.
   * `<ElementEditor featureColor>` wins over this. Default: undefined (slate `#475569`).
   */
  featureColor?: string

  /**
   * The tooltip shown while the pointer is over a feature. `false`: none, and Settings hides its
   * "Show name on hover" switch. `true` / omitted: the feature's name following the pointer (the
   * user's Settings switch still applies). An object picks the `placement` and the `content`.
   */
  featureTooltip?: boolean | FeatureTooltipOptions

  /**
   * Colour of a selected / hovered feature. `'auto'` (default): a feature with its own
   * colour (`featureColor` or `getFeatureStyle`) is drawn in a darker shade of it plus a
   * heavier stroke, and the default slate keeps the accent. `'accent'`: always the accent
   * colour. `'feature'`: always a shade of the feature's colour, even the default slate.
   * Buttons, the drawing bar and the snap marker keep the accent in every mode.
   */
  selectionStyle?: SelectionStyle

  /** Which drawing tools are available. Default: 'all'. */
  tools?: DrawTool[] | 'all'

  /**
   * Namespace for everything this editor remembers in localStorage (theme,
   * settings, units, shortcuts, window positions/sizes, panel widths, map view,
   * basemap pick, last schema): `elm_theme` becomes `elm_<persistKey>_theme`.
   * Give each editor on an origin its own key so they don't overwrite each other.
   * Default: undefined (the shared `elm_*` keys).
   */
  persistKey?: string

  /** `false`: read and write nothing in localStorage (every reload starts from config). Default: true. */
  persist?: boolean

  /**
   * Every third-party server this editor talks to: basemap tiles, glyphs, sprite and elevation,
   * the Picker's Overpass lookups, the Route tool's routing, the search box's geocoder, plus a
   * `fetch` for Element's own requests. Per editor. `false` on a service hides what needs it.
   * Map tiles are read when a basemap loads (changes apply on the next basemap switch). Headers
   * for map resources: the MapLibre drop-in's `mapOptions.transformRequest`.
   * See the "Third-party services and self-hosting" guide.
   *
   * @example network: { routing: { apiKey: ORS_KEY }, nominatim: { url: 'https://geo.example.com/search' } }
   */
  network?: NetworkConfig

  /** UI element visibility. All default to true. */
  ui?: {
    /** Drawing action hints in the active toolbar (e.g. "Click and drag to size"). Default: true */
    hints?: boolean
    /** Data table panel (spreadsheet view of all features). Default: true */
    dataTable?: boolean
    /** Layers/features list panel. Default: true */
    layerList?: boolean
    /** Schema editor button. Default: true */
    schemaEditor?: boolean
    /** GeoJSON editor button. Default: true */
    geojsonEditor?: boolean
    /**
     * Open the GeoJSON inspector when the editor mounts (initial state only;
     * the user's toggles win afterwards), in the user's last Dock/Undock mode,
     * docked beside the map by default. `'docked'` behaves like `true` (the
     * dock is the default now). Ignored when
     * `geojsonEditor` is false. With an adapter it sets `codeModalOpen`; render
     * `GeoJSONModal` from it. Default: false
     */
    geojsonEditorOpen?: boolean | 'docked'
    /** Editor settings button. Default: true */
    settings?: boolean
    /** "Fit all features" zoom button. Default: true */
    zoomToAll?: boolean
    /** Click-to-edit zoom level indicator. Default: true */
    zoomIndicator?: boolean
    /** "Fly to my location" geolocation button. Default: true */
    locateButton?: boolean
    /**
     * Where every built-in control goes: a map of slots to ordered entries.
     * Map slots: `topLeft`, `topCenter`, `topRight`, `leftCenter`,
     * `rightCenter`, `bottomLeft`, `bottomCenter`, `bottomRight`; status bar
     * (under the map): `statusLeft`, `statusRight`.
     *
     * An entry is a control id, `'separator'`, or `{ group: [...] }` (one
     * joined pill). A slot is an array, or `{ items, direction }` to pick a
     * direction (map slots; default vertical for `leftCenter`/`rightCenter`,
     * horizontal elsewhere). The first item sits at the slot's edge.
     *
     * Controls not listed are hidden, except `'attribution'`, which stays on
     * the map unless placed in a status slot. A control listed twice stays at
     * its first place. The visibility flags (`zoomToAll`, `dataTable`, …) still
     * apply on top.
     *
     * `'separator'` (a thin divider) only goes inside a group or in a status
     * slot; directly in a map slot there's no surface to draw it on.
     *
     * To move, add or hide a few controls and keep the rest of the default,
     * use {@link withLayout}: `layout: withLayout({ move: { table: 'topRight' } })`.
     * Default: {@link DEFAULT_LAYOUT}.
     *
     * @example layout: { topCenter: ['toolbar'], bottomLeft: ['fitBounds', { group: ['table', 'separator', 'schema'] }], statusRight: ['attribution'] }
     */
    layout?: LayoutConfig

    /**
     * Keyboard shortcuts control.
     * Pass `false` to disable shortcuts entirely.
     * Pass `{ enabled, show, mapZoom }` for fine-grained control.
     * Default: `{ enabled: true, show: true, mapZoom: false }`.
     *
     * `mapZoom`: when true, intercepts Cmd/Ctrl + (`+`/`=`) and Cmd/Ctrl + (`-`)
     * to zoom the map (only while the cursor is over the editor and no input
     * is focused). Defaults to false because hijacking the browser's
     * page-zoom shortcut is a behavior change consumers should opt into.
     */
    keyboardShortcuts?: boolean | { enabled?: boolean; show?: boolean; mapZoom?: boolean }
  }

  /** Floating toolbar layout. Its place is the `'toolbar'` entry in `ui.layout`. */
  toolbar?: {
    /**
     * How tool buttons are laid out inside the toolbar.
     * 'vertical' hides the search bar and stacks tools top-to-bottom.
     * Default: 'horizontal'.
     */
    direction?: 'horizontal' | 'vertical'
  }

  /** Measurement and number display settings. */
  units?: {
    /** Length unit. 'auto' picks metric/imperial from the browser locale. Default: 'auto' */
    length?: 'metric' | 'imperial' | 'auto'
    /** Area unit. 'auto' picks metric/imperial from the browser locale. Default: 'auto' */
    area?: 'metric' | 'imperial' | 'auto'
    /** Number display style. 'human' = "1.2 km", 'raw' = "1234.56 m". Default: 'human' */
    display?: 'human' | 'raw'
    /** Decimal places in 'raw' display mode. Default: 2 */
    precision?: number
  }
}

export interface ResolvedConfig {
  mode: 'light' | 'dark' | 'system'
  /** Storage scope; pass the resolved config itself to the core storage helpers. */
  persistKey: string | undefined
  persist: boolean
  /** `config.network` as given (`{}` when absent); `fetch` is a stable wrapper around the latest one. */
  network: NetworkConfig
  accentColor: string | undefined
  featureColor: string | undefined
  featureTooltip: { enabled: boolean; placement: 'cursor' | 'anchor'; content?: FeatureTooltipOptions['content'] }
  selectionStyle: SelectionStyle
  tools: DrawTool[] | 'all'
  ui: {
    hints: boolean
    dataTable: boolean
    layerList: boolean
    schemaEditor: boolean
    geojsonEditor: boolean
    /** Already false when `geojsonEditor` is false. */
    geojsonEditorOpen: boolean | 'docked'
    settings: boolean
    zoomToAll: boolean
    zoomIndicator: boolean
    locateButton: boolean
    keyboardShortcuts: { enabled: boolean; show: boolean; mapZoom: boolean }
    /** Every slot, resolved from `ui.layout` (or `DEFAULT_LAYOUT`). Rendering reads only this. */
    layout: ResolvedLayout
  }
  toolbar: {
    /** The toolbar's slot as a position (tooltip/popup sides, standalone placement). */
    position: ToolbarPosition
    direction: 'horizontal' | 'vertical'
  }
  units: {
    length: 'metric' | 'imperial' | 'auto'
    area: 'metric' | 'imperial' | 'auto'
    display: 'human' | 'raw'
    precision: number
  }
}

function resolveShortcuts(
  v: boolean | { enabled?: boolean; show?: boolean; mapZoom?: boolean } | undefined
): ResolvedConfig['ui']['keyboardShortcuts'] {
  if (v === false) return { enabled: false, show: false, mapZoom: false }
  if (v === true || v === undefined) return { enabled: true, show: true, mapZoom: false }
  return { enabled: v.enabled ?? true, show: v.show ?? true, mapZoom: v.mapZoom ?? false }
}

const LAYOUT_CONTROL_IDS: ReadonlySet<string> = new Set<LayoutControl>([
  'toolbar', 'undo', 'redo', 'fitBounds', 'locate', 'zoomIndicator',
  'table', 'schema', 'geojson', 'settings', 'keyboard', 'applyChanges', 'attribution', 'basemap',
])

const isStatusSlot = (s: LayoutSlot) => s === 'statusLeft' || s === 'statusRight'
const isGroup = (e: unknown): e is LayoutGroup =>
  !!e && typeof e === 'object' && Array.isArray((e as LayoutGroup).group)

/** Why `id` can't go at this place, or null when it can. */
function placementProblem(id: string, slot: LayoutSlot, inGroup: boolean): string | null {
  if (!LAYOUT_CONTROL_IDS.has(id)) return `'${id}' is not a control`
  if ((id === 'toolbar' || id === 'basemap') && inGroup) return `'${id}' can't go in a group`
  if (isStatusSlot(slot) && (id === 'toolbar' || id === 'applyChanges')) return `'${id}' can't go in the status bar`
  if (id === 'attribution' && !isStatusSlot(slot)) return `'attribution' can only go in statusLeft or statusRight`
  return null
}

type Direction = 'horizontal' | 'vertical'
/** A slot's items and given direction, tolerating junk from JS callers. */
const slotParts = (raw: unknown): { items: readonly unknown[]; direction?: Direction } =>
  Array.isArray(raw) ? { items: raw } : {
    items: Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [],
    direction: (raw as { direction?: Direction })?.direction,
  }

/**
 * Normalise a `ui.layout` map: every slot present, groups as `{ group }`,
 * invalid entries and repeats dropped (first place wins, in `LAYOUT_SLOTS`
 * order then array order) with a dev-only warning, dangling separators gone.
 */
export function resolveLayout(layout: LayoutConfig): ResolvedLayout {
  const seen = new Map<string, LayoutSlot>()
  const out = {} as ResolvedLayout
  for (const slot of LAYOUT_SLOTS) {
    const raw = slotParts(layout[slot])
    const direction = isStatusSlot(slot) ? 'horizontal'
      : raw.direction || (slot === 'leftCenter' || slot === 'rightCenter' ? 'vertical' : 'horizontal')
    const repeat = (id: string) => {
      const first = seen.get(id)
      if (!first) return null
      return first === slot
        ? `'${id}' is listed twice in ${slot}; keeping the first one`
        : `'${id}' is in both ${first} and ${slot}; keeping ${first} (the first in slot order). `
          + `To move one control without relisting the defaults, use withLayout({ move: { ${id}: '${slot}' } })`
    }
    const take = (e: unknown, inGroup: boolean): boolean => {
      const problem = e === 'separator'
        ? (inGroup || isStatusSlot(slot) ? null : "'separator' only goes inside a group or in the status bar (there's nothing to draw it on over the map); put it inside a { group: [...] }")
        : typeof e !== 'string'
        ? (isGroup(e) ? "groups can't be nested" : `${JSON.stringify(e)} is not a control, 'separator' or { group: [...] }`)
        : placementProblem(e, slot, inGroup) ?? repeat(e)
      if (problem) {
        warnOnce(`${slot}:${problem}`, `config.ui.layout.${slot}: ${problem}. Ignoring it.`)
        return false
      }
      if (e !== 'separator') seen.set(e as string, slot)
      return true
    }
    const items: LayoutEntry[] = []
    for (const e of raw.items) {
      if (isGroup(e)) {
        const group = collapseSeparators(e.group.filter((g) => take(g, true)))
        if (group.length) items.push({ group } as LayoutGroup)
      } else if (take(e, false)) items.push(e as LayoutEntry)
    }
    out[slot] = { items: collapseSeparators(items), direction }
  }
  return out
}

/** The slots a control may go to (`'attribution'` only in the status bar, `'toolbar'` / `'applyChanges'` only on the map). */
export type SlotFor<C extends LayoutControl> =
  C extends 'attribution' ? StatusSlot : C extends 'toolbar' | 'applyChanges' ? MapSlot : LayoutSlot

/** Changes to a layout for {@link withLayout}. */
export interface LayoutPatch {
  /**
   * Put a control in a slot, wherever it was before (or add it if it wasn't
   * placed). It goes at the end of the slot (farthest from the slot's edge),
   * or first with `{ slot, at: 'start' }`. A control moved out of a group
   * leaves the rest of the group in place.
   */
  move?: { [C in LayoutControl]?: SlotFor<C> | { slot: SlotFor<C>; at?: 'start' | 'end' } }
  /** Take controls off the layout (the feature itself stays; use the `ui` flags to turn it off). Wins over `move`. */
  hide?: readonly LayoutControl[]
}

/**
 * A copy of `base` (default {@link DEFAULT_LAYOUT}) with a few controls moved,
 * added or hidden, so you don't have to relist every other control:
 *
 * @example layout: withLayout({ move: { table: 'topRight', attribution: 'statusRight' }, hide: ['keyboard'] })
 */
export function withLayout(patch: LayoutPatch, base: LayoutConfig = DEFAULT_LAYOUT): LayoutConfig {
  const moves = Object.entries(patch.move ?? {}) as [string, string | { slot: string; at?: 'start' | 'end' }][]
  const hide = new Set<string>(patch.hide ?? [])
  for (const id of [...moves.map(([id]) => id), ...hide]) {
    if (!LAYOUT_CONTROL_IDS.has(id)) warnOnce(`withLayout:${id}`, `withLayout: '${id}' is not a control. Ignoring it.`)
  }
  const gone = new Set([...hide, ...moves.map(([id]) => id)])
  const keep = (e: unknown) => !(typeof e === 'string' && gone.has(e))
  const out: Record<string, unknown> = {}
  const put = (slot: LayoutSlot, raw: unknown, items: unknown[]) => {
    out[slot] = Array.isArray(raw) || raw === undefined ? items : { ...(raw as object), items }
  }
  for (const slot of LAYOUT_SLOTS) {
    const raw = base[slot]
    if (raw === undefined) continue
    const items = slotParts(raw).items.flatMap((e) => {
      if (!isGroup(e)) return keep(e) ? [e] : []
      const group = collapseSeparators(e.group.filter(keep))
      return group.length ? [{ group }] : []
    })
    put(slot, raw, collapseSeparators(items))
  }
  for (const [id, to] of moves) {
    if (!LAYOUT_CONTROL_IDS.has(id)) continue
    if (hide.has(id)) { warnOnce(`withLayout:both:${id}`, `withLayout: '${id}' is both moved and hidden; hiding it.`); continue }
    const { slot, at = 'end' } = typeof to === 'string' ? { slot: to } : to ?? {}
    if (!(LAYOUT_SLOTS as readonly string[]).includes(slot as string)) {
      warnOnce(`withLayout:slot:${String(slot)}`, `withLayout: '${String(slot)}' is not a slot (moving '${id}'). Ignoring it.`)
      continue
    }
    const raw = out[slot as LayoutSlot]
    const items = [...slotParts(raw).items]
    put(slot as LayoutSlot, raw, at === 'start' ? [id, ...items] : [...items, id])
  }
  return out as LayoutConfig
}

/**
 * Dev-only check that a layout doesn't leave something unreachable by surprise:
 * the drawing toolbar, the "Apply changes" button with `onSubmit`, undo/redo
 * with keyboard shortcuts off. Looks at placement only, so turning a control
 * off with its `ui` flag never counts. Returns one message per gap.
 */
export function layoutGaps(
  layout: ResolvedLayout,
  ctx: { readonly: boolean; canSubmit: boolean; tools: readonly string[] | null; shortcuts: boolean },
): string[] {
  const placed = new Set(LAYOUT_SLOTS.flatMap((s) => layout[s].items.flatMap((e): readonly string[] => (typeof e === 'object' ? e.group : [e]))))
  const gaps: string[] = []
  const canDraw = !ctx.readonly && (ctx.tools === null || ctx.tools.length > 0)
  if (canDraw && !placed.has('toolbar')) {
    gaps.push(`'toolbar' isn't placed, so the drawing tools are ${ctx.shortcuts ? 'reachable only by keyboard shortcut' : 'unreachable'}. `
      + "Put it in a map slot (withLayout({ move: { toolbar: 'topCenter' } })), or set readonly / tools: [] if that's on purpose")
  }
  if (ctx.canSubmit && !ctx.readonly && !placed.has('applyChanges')) {
    gaps.push("onSubmit is set but 'applyChanges' isn't placed, so users can't submit. Place it, or call ref.submit() yourself")
  }
  const missing = (['undo', 'redo'] as const).filter((id) => !placed.has(id))
  if (!ctx.readonly && !ctx.shortcuts && missing.length) {
    gaps.push(`${missing.map((id) => `'${id}'`).join(' and ')} ${missing.length > 1 ? "aren't" : "isn't"} placed and keyboard shortcuts are off, so users can't ${missing.join(' or ')}`)
  }
  return gaps
}

const SLOT_TO_POSITION: Partial<Record<LayoutSlot, ToolbarPosition>> = {
  topLeft: 'top-left', topCenter: 'top-center', topRight: 'top-right',
  leftCenter: 'left-center', rightCenter: 'right-center',
  bottomLeft: 'bottom-left', bottomCenter: 'bottom-center', bottomRight: 'bottom-right',
}

function resolveFeatureTooltip(v: ElementEditorConfig['featureTooltip']): ResolvedConfig['featureTooltip'] {
  if (v === false) return { enabled: false, placement: 'cursor' }
  const o = typeof v === 'object' && v ? v : {}
  return { enabled: true, placement: o.placement === 'anchor' ? 'anchor' : 'cursor', content: o.content }
}

export function resolveConfig(config?: ElementEditorConfig): ResolvedConfig {
  const layout = resolveLayout(config?.ui?.layout ?? DEFAULT_LAYOUT)
  const toolbarSlot = LAYOUT_SLOTS.find((s) => layout[s].items.includes('toolbar'))
  return {
    mode: config?.mode ?? 'system',
    persistKey: config?.persistKey || undefined,
    persist: config?.persist ?? true,
    network: config?.network ?? {},
    accentColor: config?.accentColor || undefined,
    featureColor: config?.featureColor || undefined,
    featureTooltip: resolveFeatureTooltip(config?.featureTooltip),
    selectionStyle: config?.selectionStyle ?? 'auto',
    tools: config?.tools ?? 'all',
    ui: {
      hints: config?.ui?.hints ?? true,
      dataTable: config?.ui?.dataTable ?? true,
      layerList: config?.ui?.layerList ?? true,
      schemaEditor: config?.ui?.schemaEditor ?? true,
      geojsonEditor: config?.ui?.geojsonEditor ?? true,
      geojsonEditorOpen: (config?.ui?.geojsonEditor ?? true) && (config?.ui?.geojsonEditorOpen ?? false),
      settings: config?.ui?.settings ?? true,
      zoomToAll: config?.ui?.zoomToAll ?? true,
      zoomIndicator: config?.ui?.zoomIndicator ?? true,
      locateButton: config?.ui?.locateButton ?? true,
      keyboardShortcuts: resolveShortcuts(config?.ui?.keyboardShortcuts),
      layout,
    },
    toolbar: {
      position: (toolbarSlot && SLOT_TO_POSITION[toolbarSlot]) || 'top-center',
      direction: config?.toolbar?.direction ?? 'horizontal',
    },
    units: {
      length: config?.units?.length ?? 'auto',
      area: config?.units?.area ?? 'auto',
      display: config?.units?.display ?? 'human',
      precision: config?.units?.precision ?? 2,
    },
  }
}

const ElementEditorConfigContext = createContext<ResolvedConfig>(resolveConfig())

/** Runtime user override for units. Persists to localStorage so the choice
 *  sticks across reloads. Any provided field overrides the consumer-supplied
 *  `config.units.*`; missing fields fall through to the consumer config. */
export type UnitsOverride = Partial<{
  length: 'metric' | 'imperial' | 'auto'
  area: 'metric' | 'imperial' | 'auto'
  display: 'human' | 'raw'
  precision: number
}>

interface UnitsContextValue {
  override: UnitsOverride
  setUnits: (next: UnitsOverride | ((prev: UnitsOverride) => UnitsOverride)) => void
  resetUnits: () => void
}

const UnitsContext = createContext<UnitsContextValue>({
  override: {},
  setUnits: () => {},
  resetUnits: () => {},
})

const UNITS_STORAGE_KEY = 'elm_units'
const UNITS_VERSION = 1

function isUnitChoice(v: unknown): v is 'metric' | 'imperial' | 'auto' {
  return v === 'metric' || v === 'imperial' || v === 'auto'
}

function parseStoredUnits(raw: unknown): UnitsOverride | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: UnitsOverride = {}
  if (isUnitChoice(r.length)) out.length = r.length
  if (isUnitChoice(r.area)) out.area = r.area
  if (r.display === 'human' || r.display === 'raw') out.display = r.display
  if (typeof r.precision === 'number' && r.precision >= 0 && r.precision <= 6) {
    out.precision = r.precision
  }
  return out
}

export function ElementEditorConfigProvider({
  config,
  children,
}: {
  config?: ElementEditorConfig
  children: ReactNode
}) {
  const persistKey = config?.persistKey
  const persist = config?.persist
  const [override, setOverride] = useState<UnitsOverride>(
    () => readPersisted<UnitsOverride>(UNITS_STORAGE_KEY, UNITS_VERSION, parseStoredUnits, { persistKey, persist }) ?? {}
  )

  const setUnits = useCallback<UnitsContextValue['setUnits']>((next) => {
    setOverride((prev) => {
      const value = typeof next === 'function' ? next(prev) : { ...prev, ...next }
      writePersisted(UNITS_STORAGE_KEY, UNITS_VERSION, value, { persistKey, persist })
      return value
    })
  }, [persistKey, persist])

  const resetUnits = useCallback(() => {
    setOverride({})
    writePersisted(UNITS_STORAGE_KEY, UNITS_VERSION, {}, { persistKey, persist })
  }, [persistKey, persist])

  // Integrators often write `config={{ … }}`: a new object every host render. Config is plain
  // data, so key the memo on its content and an equal config keeps the same context value
  // (otherwise every consumer, the map views included, re-renders on each host render).
  // A function doesn't survive the content key: `network.fetch` goes through a stable wrapper
  // around the latest one, so an inline `fetch` doesn't re-render every consumer.
  const configKey = JSON.stringify(config ?? null)
  const fetchRef = useRef(config?.network?.fetch)
  fetchRef.current = config?.network?.fetch
  const hasFetch = !!config?.network?.fetch
  // Same for `featureTooltip.content`: a stable wrapper around the latest callback.
  const tipObj = typeof config?.featureTooltip === 'object' ? config.featureTooltip : undefined
  const tipContentRef = useRef(tipObj?.content)
  tipContentRef.current = tipObj?.content
  const hasTipContent = !!tipObj?.content
  const tipContent = useCallback<NonNullable<FeatureTooltipOptions['content']>>((f) => tipContentRef.current?.(f), [])
  const resolved = useMemo(() => {
    const base = resolveConfig(config)
    if (hasFetch) base.network = { ...base.network, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchRef.current!(input, init) }
    if (hasTipContent) base.featureTooltip = { ...base.featureTooltip, content: tipContent }
    return {
      ...base,
      units: {
        length: override.length ?? base.units.length,
        area: override.area ?? base.units.area,
        display: override.display ?? base.units.display,
        precision: override.precision ?? base.units.precision,
      },
    }
  }, [configKey, override, hasFetch, hasTipContent, tipContent]) // eslint-disable-line react-hooks/exhaustive-deps -- `config` is read through its content key

  const unitsCtx = useMemo<UnitsContextValue>(
    () => ({ override, setUnits, resetUnits }),
    [override, setUnits, resetUnits]
  )

  return (
    <ElementEditorConfigContext.Provider value={resolved}>
      <UnitsContext.Provider value={unitsCtx}>
        {children}
      </UnitsContext.Provider>
    </ElementEditorConfigContext.Provider>
  )
}

export function useElementEditorConfig(): ResolvedConfig {
  return useContext(ElementEditorConfigContext)
}

/** Read/write the user's persisted units override. Use this from settings UIs;
 *  consumers reading current values should prefer `useElementEditorConfig().units`. */
export function useUnitsOverride(): UnitsContextValue {
  return useContext(UnitsContext)
}
