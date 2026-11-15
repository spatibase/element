import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { BasemapPicker, useTheme, useElementEditorConfig, type IconButtonSize, type TooltipSide } from '@element-editor/ui'
import { readStorage, writeStorage, ElementEditorError } from '@element-editor/core'
import { warnOnce, loadErrorCode } from '@element-editor/core/internal'
import { useOptionalEmit } from '@element-editor/ui/internal'
import { useOptionalMapLibre } from './ElementEditorControls'
import type { BasemapInput } from './basemaps'

export interface BasemapControlProps {
  /** Defaults to the map of the surrounding `ElementEditorControls`. */
  map?: MapLibreMap
  /** Choices, in order. Default: `'auto'` + all built-ins. */
  basemaps?: BasemapInput[]
  value?: BasemapInput
  /**
   * Initial choice when uncontrolled. Default `'auto'`, shown as selected but not applied: with
   * no `value`, `defaultValue` or remembered pick, your map keeps its own style until the user picks.
   */
  defaultValue?: BasemapInput
  onChange?: (basemap: BasemapInput) => void
  /**
   * Persist the chosen built-in id / `'auto'` / custom `id` in localStorage under this key (namespaced
   * by `config.persistKey`, skipped when `config.persist` is false) and restore it on mount.
   */
  storageKey?: string
  /**
   * Set when the map was created with the initial choice already in its style (the drop-in does):
   * the first apply is skipped. A choice restored from `storageKey` that differs is still applied.
   */
  initialApplied?: boolean
  /** Button size and tooltip side; the editor's layout passes these so the picker fits its slot (compact in the status bar). */
  size?: IconButtonSize
  tooltipSide?: TooltipSide
}

const BUILTIN = ['streets', 'terrain', 'light', 'dark', 'osm']

// Id-less style objects are told apart by identity (`i` < 0) or by list position.
const anonIds = new WeakMap<object, string>()
let anonCount = 0
function optionId(b: BasemapInput, i: number): string {
  if (typeof b === 'string') return b
  const named = b.id ?? b.label ?? ('url' in b ? b.url : typeof b.style === 'string' ? b.style : undefined)
  if (named) return named
  if (i >= 0) return `custom-${i}`
  if (!anonIds.has(b)) anonIds.set(b, `custom-anon-${++anonCount}`)
  return anonIds.get(b)!
}

// Lazy, in two chunks: loading/switching (small) and the picker's catalog (labels + inlined
// thumbnails, ~25 KB gzip), so an editor that only applies a basemap never fetches the thumbnails.
const loadLib = () => import('./basemaps/style')
const loadPickerLib = () => Promise.all([loadLib(), import('./basemaps/catalog')]).then(([style, catalog]) => ({ ...style, ...catalog }))

// A failed dynamic import stays failed until a reload: report it once per page, not once per hook.
let chunkReported = false
const chunkError = (err: unknown) => new ElementEditorError('network', 'basemap',
  `The basemap catalog could not be loaded (${err instanceof Error ? err.message : String(err)}). Reload the page to try again.`, { cause: err })

/** Reports through the enclosing editor's events (onError → toast / onEvent); console.error outside one (BYO map). */
function useBasemapErrorReporter() {
  const emit = useOptionalEmit()
  const ref = useRef(emit)
  ref.current = emit
  return useCallback((error: ElementEditorError) => {
    if (ref.current) ref.current({ type: 'error', code: error.code, source: 'basemap', message: error.message, error })
    else console.error(`[element-editor] ${error.message}`)
  }, [])
}

/**
 * Keeps `map` showing `basemap` with `setBasemap` (keeps Element's layers): applies it whenever the
 * choice or, for `'auto'`, the theme changes. `BasemapControl` uses it; mount it yourself to keep
 * `'auto'` following the theme while no picker is mounted. `initialApplied`: the map was created with
 * the first `basemap` (and theme) this hook was called with already in its style, so that one is
 * not re-applied; a different value by the time the map arrives is. The built-ins load from the
 * servers in the editor's `config.network` (read when a basemap is applied).
 */
export function useBasemap(
  map: MapLibreMap | null | undefined,
  basemap: BasemapInput,
  opts: { theme: 'light' | 'dark'; initialApplied?: boolean },
): void {
  const { theme } = opts
  const network = useElementEditorConfig().network
  const networkRef = useRef(network)
  networkRef.current = network
  const [lib, setLib] = useState<typeof import('./basemaps/style') | null>(null)
  const report = useBasemapErrorReporter()
  useEffect(() => { let on = true; loadLib().then((m) => on && setLib(m), (err) => {
    if (on && !chunkReported) { chunkReported = true; report(chunkError(err)) }
  }); return () => { on = false } }, [])

  // Key of what the map currently shows (resolved id, so theme flips of 'auto' re-apply).
  const resolvedKey = (b: BasemapInput) => { const r = lib?.resolveBasemap(b, theme) ?? b; return optionId(r, -1) }
  const applied = useRef<string | null | undefined>(undefined)
  // `initialApplied`: the map was created with the FIRST basemap + theme this hook saw. Remember
  // those, not the values current when the map arrives: a change during the initial style load
  // must still be applied.
  const created = useRef(opts.initialApplied ? { basemap, theme } : null)
  if (applied.current === undefined) applied.current = created.current ? '' : null

  useEffect(() => {
    if (!map || !lib) return
    const key = resolvedKey(basemap)
    if (applied.current === '') applied.current = optionId(lib.resolveBasemap(created.current!.basemap, created.current!.theme), -1)
    if (applied.current === key) return
    // Apply once the style is usable. `isStyleLoaded()` can lie, so also accept Element's own source
    // (present once the adapter's init ran) and keep retrying on `styledata`.
    let done = false
    const detail = (err: unknown) => err instanceof Error ? err.message : String(err)
    // A style URL is fetched by MapLibre after setStyle: an error before the new style's first
    // `styledata` is that fetch failing (sprite / glyph / tile errors come later and are left alone).
    const r = lib.resolveBasemap(basemap, theme)
    const urlStyle = typeof r === 'object' && 'style' in r && typeof r.style === 'string'
    const onStyleError = (e: { error?: unknown }) => {
      unwatch()
      applied.current = null
      report(new ElementEditorError(loadErrorCode(e.error), 'basemap', `The basemap could not be loaded (${detail(e.error)}).`, { cause: e.error }))
    }
    const unwatch = () => { map.off('error', onStyleError); map.off('styledata', unwatch) }
    const go = () => {
      if (done || !(map.isStyleLoaded() || map.getSource('elm-features'))) return
      done = true
      map.off('styledata', go)
      applied.current = key
      lib.setBasemap(map, basemap, { theme, network: networkRef.current }).then(() => {
        if (urlStyle && !unwatched) { map.on('error', onStyleError); map.once('styledata', unwatch) }
      }, (err: unknown) => {
        applied.current = null
        report(new ElementEditorError(loadErrorCode(err), 'basemap', `The basemap could not be switched (${detail(err)}). The map keeps the previous one.`, { cause: err }))
      })
    }
    let unwatched = false
    map.on('styledata', go)
    go()
    return () => { done = true; unwatched = true; map.off('styledata', go); unwatch() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lib, basemap, theme])
}

/**
 * Basemap picker that applies the choice to the map with `setBasemap` (keeps Element's layers).
 * `'auto'` follows the editor theme. The basemap catalog is loaded lazily from `./basemaps`.
 * With no `map` (and outside `ElementEditorControls`) it is a plain `value`/`onChange` picker.
 */
export function BasemapControl(props: BasemapControlProps) {
  const { basemaps, value, defaultValue = 'auto', onChange, storageKey, initialApplied, size, tooltipSide } = props
  const ctxMap = useOptionalMapLibre()
  const map = props.map ?? ctxMap
  const theme = useTheme()
  const [lib, setLib] = useState<typeof import('./basemaps') | null>(null)
  const report = useBasemapErrorReporter()
  useEffect(() => { let on = true; loadPickerLib().then((m) => on && setLib(m), (err) => {
    if (on && !chunkReported) { chunkReported = true; report(chunkError(err)) }
  }); return () => { on = false } }, []) // eslint-disable-line react-hooks/exhaustive-deps -- report is stable

  const scope = useElementEditorConfig()
  const inputs = useMemo<BasemapInput[]>(() => basemaps ?? ['auto', ...(BUILTIN as BasemapInput[])], [basemaps])
  const ids = inputs.map(optionId)
  if (inputs.filter((b) => typeof b === 'object' && !b.id && !b.label && !('url' in b) && typeof b.style !== 'string').length > 1
    || new Set(ids).size < ids.length) {
    warnOnce('basemap-ids', 'BasemapControl: give each custom basemap a unique `id` (two entries without one, or with the same id/label, cannot be told apart).')
  }

  const [restored] = useState(() => {
    const saved = storageKey ? readStorage(storageKey, scope) : null
    return saved ? inputs.find((b, i) => optionId(b, i) === saved) : undefined
  })
  const [inner, setInner] = useState<BasemapInput>(restored ?? defaultValue)
  // Bring-your-own map: nothing to apply until there is a real choice (a `value`, a `defaultValue`,
  // a remembered pick or the user's pick), so the integrator's own style is left alone on mount.
  const [engaged, setEngaged] = useState(value !== undefined || props.defaultValue !== undefined || restored !== undefined)
  const selected = value ?? inner
  const at = inputs.indexOf(selected)
  const selectedId = at >= 0 ? ids[at] : optionId(selected, -1)

  // A choice restored from `storageKey` that differs from `defaultValue` is still applied.
  useBasemap(engaged || value !== undefined ? map : null, selected, {
    theme,
    initialApplied: engaged && initialApplied && selectedId === optionId(defaultValue, inputs.indexOf(defaultValue)),
  })

  const choose = useCallback((id: string) => {
    const i = ids.indexOf(id)
    if (i < 0) return
    const next = inputs[i]
    setEngaged(true)
    if (value === undefined) setInner(next)
    if (storageKey && (typeof next === 'string' || next.id)) writeStorage(storageKey, id, scope)
    onChange?.(next)
  }, [ids, inputs, value, storageKey, onChange, scope])

  if (!lib) return null
  const thumbOf = (id: string) => lib.BASEMAPS.find((b) => b.id === id)?.thumbnail
  const options = inputs.map((b, i) => {
    const id = ids[i]
    const builtin = typeof b === 'string' ? lib.BASEMAPS.find((x) => x.id === b) : undefined
    return {
      id,
      label: b === 'auto' ? 'Auto' : builtin?.label ?? ((typeof b === 'object' && b.label) || id),
      // Auto shows both looks it switches between (light → streets, dark → dark).
      thumbnail: b === 'auto'
        ? [thumbOf('streets'), thumbOf('dark')].every(Boolean) ? [thumbOf('streets')!, thumbOf('dark')!] as [string, string] : undefined
        : typeof b === 'string' ? thumbOf(b) : b.thumbnail,
    }
  })
  return <BasemapPicker options={options} value={selectedId} onChange={choose} size={size} tooltipSide={tooltipSide} />
}
