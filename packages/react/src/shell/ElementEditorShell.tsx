import React, { useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useMemo, useState } from 'react'
import {
  EditingToolbar,
  ControlGroup,
  ActiveDrawingToolbar,
  SimplifyPanel,
  SmoothPanel,
  BufferPanel,
  ReadonlyBanner,
  LayersPanel,
  MapControllerProvider,
  ShortcutConfigProvider,
  EventProvider,
  useUIStore,
  GeoStoreProvider,
  useGeoStore,
  ThemeContext,
  ElementEditorErrorBoundary,
  useAdapterControls,
  useMapController,
} from '@element-editor/ui'
// Not semver-covered: same-version workspace sibling, pinned via `workspace:*`.
import { isControlVisible, visibleLayoutEntries, layoutGaps, LAYOUT_SLOTS, RootCssVarsContext, RootTokensContext, useRootTokens } from '@element-editor/ui/internal'
import { getFeatureCollectionBBox, type BBox } from '@element-editor/core'
import { warnOnce } from '@element-editor/core/internal'
import type { ElementEditorBaseProps } from './types'
import type { LayoutControl, LayoutSlot, MapSlot, LayoutEntry, TooltipSide, ElementEditorImperativeAPI, DrawTool } from '@element-editor/ui'
import { loadSavedView } from './savedView'
import { useDevChecks } from './useDevChecks'
import { ElementEditorConfigProvider, useElementEditorConfig } from '@element-editor/ui'
import { useResolvedTheme } from './useResolvedTheme'
import { useSlotAutoLayout } from './useSlotAutoLayout'
import { ShellControl } from './ShellControl'
import { SplitPanel, ShellModals } from './ShellPanels'
import { FileDropBox } from './FileDropBox'

// Canonical shape lives in `@element-editor/ui`.
export type { ImportResult } from '@element-editor/ui'

/**
 * Imperative handle for `<ElementEditor ref={...} />`: `ElementEditorImperativeAPI` from
 * `@element-editor/ui`, the same surface as the adapters' `ElementEditorControlsRef`.
 * Engine-neutral here (`getMap()` returns `unknown`); each entry re-exports it with its map type
 * (`maplibre/ElementEditor.tsx`, `leaflet/ElementEditor.tsx`), so neither entry's types reach the
 * other engine's.
 */
export type ElementEditorRef<TMap = unknown> = ElementEditorImperativeAPI<TMap>

// Keyboard shortcuts are mounted by <ElementEditorControls> inside <MapView>;
// calling the hook again here would double every global shortcut (e.g. a
// single Tab press would advance selection twice).

// Flex classes per map slot, [horizontal, vertical]: the first item sits at
// the slot's anchor edge (right slots reverse on X, bottom slots on Y), cross
// axis aligned to that edge.
// When an edge row is too narrow for its slots (data-elm-wrap), a horizontal
// slot also wraps its own entries (bottom slots upward) instead of running
// off the editor.
const TOP_WRAP = 'in-data-[elm-wrap]:flex-wrap in-data-[elm-wrap]:max-w-full'
const BOTTOM_WRAP = 'in-data-[elm-wrap]:flex-wrap-reverse in-data-[elm-wrap]:max-w-full'
const SLOT_FLEX: Record<MapSlot, [string, string]> = {
  topLeft:      [`flex-row items-start ${TOP_WRAP}`,                      'flex-col items-start'],
  topCenter:    [`flex-row items-start justify-center ${TOP_WRAP}`,       'flex-col items-center'],
  topRight:     [`flex-row-reverse items-start ${TOP_WRAP}`,              'flex-col items-end'],
  leftCenter:   ['flex-row items-center',        'flex-col items-start'],
  rightCenter:  ['flex-row-reverse items-center', 'flex-col items-end'],
  bottomLeft:   [`flex-row items-end ${BOTTOM_WRAP}`,                     'flex-col-reverse items-start'],
  bottomCenter: [`flex-row items-end justify-center ${BOTTOM_WRAP}`,      'flex-col-reverse items-center'],
  bottomRight:  [`flex-row-reverse items-end ${BOTTOM_WRAP}`,             'flex-col-reverse items-end'],
}

export interface ElementEditorShellProps extends ElementEditorBaseProps {
  /**
   * Renders the engine's map. `attributionTarget`: the status-bar element its attribution control
   * moves into (full line), or null. Otherwise `attributionCorner`: the element at the bottom-right
   * end of the bottom slot row its compact attribution moves into, so the row's layout keeps every
   * control off it (null while the row is hidden: the map's own corner).
   */
  renderMap: (args: { attributionTarget: HTMLElement | null; attributionCorner: HTMLElement | null; themeMode: 'light' | 'dark' }) => React.ReactNode
  /** Rendered for the `'basemap'` layout control; the control is hidden when omitted. */
  basemapControl?: React.ReactNode
  /** Entry-specific ref methods (e.g. `getBasemap` / `setBasemap`) merged into the handle. Keep it stable. */
  extraApi?: object
  /** Which drop-in renders the shell (for development messages, e.g. which stylesheet to import). */
  engine?: 'maplibre' | 'leaflet'
}

const ElementEditorInternal = forwardRef<ElementEditorRef, ElementEditorShellProps>(({
  initialData,
  initialView,
  schema,
  tools,
  maxFeatures,
  geometryTypes,
  bounds,
  readonly = false,
  layout = 'panel',
  className = '',
  style,
  theme,
  onChange,
  onSubmit,
  onValidationError,
  onFeatureSelect,
  onZoomChange,
  onEvent,
  onError,
  onFeatureAdd,
  onFeatureUpdate,
  onFeatureDelete,
  onSelectionChange,
  onToolChange,
  slots,
  renderMap,
  basemapControl,
  extraApi,
  fileDrop = true,
  engine = 'maplibre',
}, ref) => {
  const cfg = useElementEditorConfig()
  const { dataStore, uiStore } = useGeoStore()
  const mapController = useMapController()

  // Flat `tools` prop wins; otherwise inherit from config ('all' → unrestricted)
  const effectiveTools: DrawTool[] | null = tools ? tools : cfg.tools === 'all' ? null : cfg.tools

  // `initialData` that arrives after mount is fitted as the map would have fitted it on mount:
  // with `initialView: 'data'`, or with no `initialView` when there was no saved view to start
  // from (resolveInitialView). Read the saved view now: the map saves its own view as it moves.
  const [fitLateData] = useState(() => initialView === 'data' || (initialView === undefined && !loadSavedView(cfg)))
  const [pendingFit, setPendingFit] = useState<BBox | null>(null)
  const onInitialDataApplied = useCallback((_data: unknown, late: boolean) => {
    if (!late || !fitLateData) return
    const bbox = getFeatureCollectionBBox({ type: 'FeatureCollection', metadata: { schemas: [], groups: [] }, features: dataStore.getState().features })
    if (bbox) setPendingFit(bbox)
  }, [fitLateData, dataStore])
  // The map may not exist yet (MapLibre waits for its style): fit once its controller is there.
  useEffect(() => {
    if (!pendingFit || !mapController.fitBounds) return
    mapController.fitBounds(pendingFit)
    setPendingFit(null)
  }, [pendingFit, mapController])

  // Shared editor wiring — prop sync (readonly / tools / maxFeatures /
  // layout), schema mount, initialData mount, granular data-
  // change subscription, callback subscriptions (onZoomChange, onFeatureSelect,
  // onChange, per-feature, selection), and the imperative API. The wrapper
  // keeps only its own concerns (theme persistence, slots, tile layer, dev
  // affordances, the `bounds → uiStore` UI-shell sync below).
  const api = useAdapterControls({
    initialData,
    schema,
    layout,
    readonly,
    tools: effectiveTools,
    maxFeatures,
    geometryTypes,
    onChange,
    onSubmit,
    onValidationError,
    onFeatureAdd,
    onFeatureUpdate,
    onFeatureDelete,
    onSelectionChange,
    onFeatureSelect,
    onZoomChange,
    onToolChange,
    onInitialDataApplied,
  })
  const handle = useMemo(() => (extraApi ? { ...api, ...extraApi } : api), [api, extraApi])
  useImperativeHandle(ref, () => handle, [handle])

  // Dev-only window expose for E2E test access. Gated by import.meta.env.DEV
  // so production builds drop it entirely.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __elementEditorTest?: unknown; __elementEditorRef?: unknown }
    // Merge: the adapter's ElementEditorControls (a child, so its effect ran
    // first) already put `map` here; the perf benchmark drives the map with it.
    w.__elementEditorTest = { ...(w.__elementEditorTest as object | undefined), dataStore, uiStore }
    w.__elementEditorRef = handle
    return () => {
      delete w.__elementEditorTest
      delete w.__elementEditorRef
    }
  }, [dataStore, uiStore, handle])

  // `bounds` → uiStore, on mount and on every change. The map views read it
  // and restrict panning (Leaflet: adapter `bounds` → `setMaxBounds`;
  // MapLibre: adapter `maxBounds`). Synced in a layout effect, not during
  // render: a store update while rendering re-renders other subscribers
  // mid-render (React warns).
  useLayoutEffect(() => {
    uiStore.getState().setBounds(bounds)
  }, [bounds, uiStore])

  const tableFullscreen = useUIStore((s) => s.tableFullscreen)
  // Not sidebarWidth / codeDockWidth: they change on every mousemove of a panel
  // resize. Right-side clearance rides --elm-panel-offset (usePanelOffset) instead.
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)

  // `theme` is the mode only. A JS caller may still pass the removed object form
  // (CSS variables): ignore it and point to `style` / `accentColor`.
  const themeIsObject = theme !== null && typeof theme === 'object'
  useEffect(() => {
    if (themeIsObject) warnOnce('theme-object', '<ElementEditor theme> takes only \'light\' | \'dark\' | \'auto\'; the object is ignored. Set CSS variables with `style` (e.g. style={{ \'--elm-accent\': \'#7c3aed\' }}) or the brand colour with `accentColor`.')
  }, [themeIsObject])
  const themeMode = useResolvedTheme(themeIsObject ? undefined : theme)

  // `--elm-accent` on the root re-derives every primary-* shade below it
  // (shared.css). Portals get it via useAccentStyle().
  const mergedStyle = {
    ...(cfg.accentColor ? { '--elm-accent': cfg.accentColor } : {}),
    // Bottom edge of the contextual bottom-center stack (EditingToolbar, …).
    // --elm-bottom-row-height is the measured lift (see below).
    '--elm-bottom-stack-offset': layout === 'split'
      ? 'calc(33.33% + 16px + var(--elm-bottom-row-height, 0px))'
      : 'calc(var(--elm-table-offset, 0px) + var(--elm-bottom-row-height, 0px) + 16px)',
    ...style,
  } as unknown as React.CSSProperties
  // The CSS variables of `style` (`--elm-accent`, `--elm-primary-N`, …) also go on
  // Element's body-level portals (useAccentStyle), which don't inherit the root's.
  // Keyed by value: hosts usually pass a fresh inline `style` object every render.
  const cssVarEntries = style ? Object.entries(style).filter(([k, v]) => k.startsWith('--') && v != null && v !== '') : []
  const cssVarsKey = cssVarEntries.length ? JSON.stringify(cssVarEntries) : ''
  const rootCssVars = useMemo(
    () => (cssVarsKey ? Object.fromEntries(JSON.parse(cssVarsKey) as [string, string][]) as React.CSSProperties : undefined),
    [cssVarsKey],
  )

  // Every control is placed through cfg.ui.layout (`ui.layout` or DEFAULT_LAYOUT).
  // Hidden controls (visibility flags, readonly) are dropped first, so empty
  // groups and dangling separators disappear and an empty slot renders nothing.
  const visible = (id: LayoutControl) => isControlVisible(id, cfg.ui, { readonly, canSubmit: !!onSubmit, hasBasemaps: !!basemapControl })
  const entries = (slot: LayoutSlot) => visibleLayoutEntries(cfg.ui.layout[slot].items, visible)
  // Dev only (warnOnce): a layout that leaves drawing, submitting or undo unreachable.
  const shortcutsOn = cfg.ui.keyboardShortcuts.enabled
  const toolsKey = effectiveTools?.join() ?? null
  useEffect(() => {
    for (const gap of layoutGaps(cfg.ui.layout, { readonly, canSubmit: !!onSubmit, tools: effectiveTools, shortcuts: shortcutsOn })) {
      warnOnce(`layoutGap:${gap}`, `config.ui.layout: ${gap}.`)
    }
  }, [cfg.ui.layout, readonly, !!onSubmit, toolsKey, shortcutsOn]) // eslint-disable-line react-hooks/exhaustive-deps -- tools read through toolsKey
  // The engine's map view moves its attribution control into this element (see CompactAttribution).
  const [attributionEl, setAttributionEl] = useState<HTMLElement | null>(null)
  // …or, without a status-bar entry, into this element: the first item of the bottomRight slot
  // (the corner), so the bottom row wraps instead of covering the attribution (a licence requirement).
  const [attributionCorner, setAttributionCorner] = useState<HTMLElement | null>(null)

  const control = (id: LayoutControl, size: 'md' | 'sm' | 'group', side: TooltipSide) => (
    <ShellControl key={id} id={id} size={size} side={side}
      onSubmit={api.submit} basemapControl={basemapControl} attributionRef={setAttributionEl} />
  )

  const renderEntries = (slot: LayoutSlot, list: LayoutEntry[]): React.ReactNode[] => {
    const status = slot === 'statusLeft' || slot === 'statusRight'
    const vertical = cfg.ui.layout[slot].direction === 'vertical'
    // Tooltips open away from the slot's edge (and off a vertical column).
    const side: TooltipSide = vertical
      ? (slot.endsWith('Right') || slot === 'rightCenter' ? 'left' : 'right')
      : slot.startsWith('top') ? 'bottom' : 'top'
    // Separators sit in the status bar or inside a group's pill (resolveLayout
    // drops them anywhere else: over map tiles they have no surface).
    const sep = (key: string) => (
      <div key={key} aria-hidden data-elm-separator="" className={`flex-shrink-0 bg-elm-border ${
        status ? 'w-px h-4 mx-1' : vertical ? 'h-px w-5 my-0.5' : 'w-px h-5 mx-1'}`} />
    )
    return list.map((e, i) => {
      if (e === 'separator') return sep(`sep-${i}`)
      if (typeof e === 'string') return control(e, status ? 'sm' : 'md', side)
      const inner = e.group.map((g, j) => g === 'separator' ? sep(`gsep-${j}`) : control(g, status ? 'sm' : 'group', side))
      return status
        ? <div key={`group-${i}`} data-elm-group="" className="flex items-center">{inner}</div>
        : <ControlGroup key={`group-${i}`} direction={vertical ? 'vertical' : 'horizontal'}>{inner}</ControlGroup>
    })
  }

  // A map slot: flex box whose FIRST item sits at the slot's anchor edge.
  // `lead` (bottomRight: the attribution corner) goes first, then custom `slots.<corner>` JSX.
  const toolbarSlot = LAYOUT_SLOTS.find((s) => entries(s).includes('toolbar'))
  const mapSlot = (slot: MapSlot, className: string, style?: React.CSSProperties, ref?: React.Ref<HTMLDivElement>, lead?: React.ReactNode) => {
    const list = entries(slot)
    const custom = (slots as Record<string, React.ReactNode> | undefined)?.[slot]
    const [h, v] = SLOT_FLEX[slot]
    return (
      <div ref={ref} data-elm-slot={slot} style={style}
        className={`flex ${cfg.ui.layout[slot].direction === 'vertical' ? v : h} gap-2 ${list.length || custom ? 'pointer-events-auto' : ''} ${className}`}>
        {lead}
        {custom}
        {renderEntries(slot, list)}
      </div>
    )
  }
  // The toolbar's search dropdown must stack above the other map controls.
  const zFor = (...s: LayoutSlot[]) => (toolbarSlot && s.includes(toolbarSlot) ? 'z-[500]' : 'z-[400]')

  // Right-side slots move left by --elm-panel-offset (open layers panel +
  // docked GeoJSON inspector, written by those panels) so buttons never sit on
  // top of them. When the panel is collapsed the top edge also clears its
  // toggle button (48px + 8px gap, level with the panel header).
  const panelWithList = layout === 'panel' && cfg.ui.layerList
  const toggleClearance = panelWithList && !sidebarOpen ? 56 : 0
  const panelOffset = 'var(--elm-panel-offset, 0px)'
  // In split layout the bottom 1/3 is a panel: bottom slots sit above it.
  // Otherwise they ride above the data table when it's open.
  const bottomOffset = layout === 'split' ? 'calc(33.33% + 16px)' : 'calc(var(--elm-table-offset, 0px) + 16px)'

  const {
    rootRef, topRowRef, bottomRowRef, bottomLeftRef, bottomCenterRef, bottomRightRef,
    contextualRef, leftEdgeRef, rightEdgeRef, leftCenterRef, rightCenterRef,
  } = useSlotAutoLayout(tableFullscreen, toggleClearance)
  useDevChecks(rootRef, engine)
  // Design tokens the host set on the root (any channel: a stylesheet rule, `style`, :root),
  // as resolved there, for Element's body-level portals (useAccentStyle). Re-read on theme input
  // changes only, never per frame.
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setRootEl(rootRef.current) }, [rootRef])
  const rootTokens = useRootTokens(rootEl) as React.CSSProperties | undefined

  const statusLeft = entries('statusLeft')
  const statusRight = entries('statusRight')
  // A bar whose entries are all hidden isn't rendered.
  const showStatusBar = statusLeft.length + statusRight.length > 0
  const attributionInBar = showStatusBar && !!attributionEl

  // `toaster` mounts this instance's own <Toaster> with a per-instance id
  // (skipped when onEvent is set), so a host <Toaster> or a second
  // <ElementEditor/> never shows the same toast twice.
  return (
    <ThemeContext.Provider value={themeMode}>
    <RootCssVarsContext.Provider value={rootCssVars}>
    <RootTokensContext.Provider value={rootTokens}>
    <EventProvider onEvent={onEvent} onError={onError} toaster>
    <div
      ref={rootRef}
      data-elm-theme={themeMode}
      className={`relative w-full h-full overflow-clip bg-(--elm-surface-sunken,var(--color-gray-50)) dark:bg-(--elm-surface-sunken,var(--color-gray-950)) flex flex-col ${className}`}
      style={mergedStyle}
    >
      {/* Everything except the status bar lives in this box, so the absolute-
          positioned panels, corners and data table measure against the map
          area and the status bar never covers them. */}
      <FileDropBox enabled={fileDrop && !readonly} footer={showStatusBar && (
        <div
          data-elm-status-bar=""
          role="toolbar"
          aria-label="Status bar"
          className="flex-shrink-0 h-7 px-2 flex items-center justify-between gap-1 bg-elm-surface border-t border-elm-border z-[400]"
        >
          <div data-elm-slot="statusLeft" className="flex items-center gap-1 min-w-0">{renderEntries('statusLeft', statusLeft)}</div>
          <div data-elm-slot="statusRight" className="flex items-center gap-1 min-w-0">{renderEntries('statusRight', statusRight)}</div>
        </div>
      )}>
      {renderMap({ attributionTarget: attributionInBar ? attributionEl : null, attributionCorner: attributionInBar ? null : attributionCorner, themeMode })}
      {!tableFullscreen && slots?.toolbar}
      {!tableFullscreen && slots?.mapOverlay && (
        <div className="absolute inset-0 z-[300] pointer-events-none">
          {slots.mapOverlay}
        </div>
      )}
      {/* Map slots (cfg.ui.layout). Hidden while the data table is in
          fullscreen so the user gets a clean table-only view (issue #12).
          Each edge's left / center / right slots share one grid row
          (1fr auto 1fr), so they push each other aside instead of
          overlapping; the center stays centered on the visible map while
          there's room. The row ends at the right-hand panels (layers panel +
          docked GeoJSON inspector, --elm-panel-offset), so nothing covers them. */}
      {!tableFullscreen && (
        <div ref={topRowRef} data-elm-edge="top" style={{ top: 16, left: 16, right: `calc(${panelOffset} + 16px)` }}
          className={`absolute ${zFor('topLeft', 'topCenter', 'topRight')} transition-[right] duration-200 grid grid-cols-[1fr_auto_1fr] items-start gap-2 pointer-events-none data-[elm-wrap]:flex data-[elm-wrap]:flex-wrap`}>
          {mapSlot('topLeft', 'justify-self-start')}
          {mapSlot('topCenter', 'justify-self-center mx-auto')}
          {/* Wrapped, the row itself clears the toggle (padding), not this slot. */}
          {mapSlot('topRight', 'justify-self-end ml-auto transition-[margin] duration-200 in-data-[elm-wrap]:mr-0!', { marginRight: toggleClearance })}
        </div>
      )}
      {/* Left / right edge: a column between the top and bottom offsets, so a
          side-center slot centers on the visible map (above the table or the
          split panel) and the box resizes with them (observed). Its slot is
          shifted clear of the top / bottom rows' slots on that side. */}
      {!tableFullscreen && (
        <div ref={leftEdgeRef} data-elm-edge="left" style={{ top: 16, bottom: bottomOffset, left: 16 }}
          className={`absolute ${zFor('leftCenter')} flex flex-col justify-center pointer-events-none`}>
          {mapSlot('leftCenter', 'relative', { top: 'var(--elm-left-center-shift, 0px)' }, leftCenterRef)}
        </div>
      )}
      {!tableFullscreen && (
        <div ref={rightEdgeRef} data-elm-edge="right" style={{ top: 16, bottom: bottomOffset, right: `calc(${panelOffset} + 16px)` }}
          className={`absolute ${zFor('rightCenter')} flex flex-col justify-center pointer-events-none transition-[right] duration-200`}>
          {mapSlot('rightCenter', 'relative', { top: 'var(--elm-right-center-shift, 0px)' }, rightCenterRef)}
        </div>
      )}
      {!tableFullscreen && (
        <div ref={bottomRowRef} data-elm-edge="bottom" style={{ bottom: bottomOffset, left: 16, right: `calc(${panelOffset} + 16px)` }}
          className={`absolute ${zFor('bottomLeft', 'bottomCenter', 'bottomRight')} transition-[right] duration-200 grid grid-cols-[1fr_auto_1fr] items-end gap-2 pointer-events-none data-[elm-wrap]:flex data-[elm-wrap]:flex-wrap-reverse`}>
          {mapSlot('bottomLeft', 'justify-self-start', undefined, bottomLeftRef)}
          {mapSlot('bottomCenter', 'justify-self-center mx-auto', undefined, bottomCenterRef)}
          {mapSlot('bottomRight', 'justify-self-end ml-auto max-w-full', undefined, bottomRightRef,
            // One line when the row has room for it (max-content), else as wide as the whole row
            // (--elm-row-room, written by useSlotAutoLayout): its width never depends on whether
            // the row wraps, so the wrap decision can't flip-flop.
            !attributionInBar && <div ref={setAttributionCorner} data-elm-attribution-corner=""
              className="pointer-events-auto flex items-end justify-end w-max" style={{ maxWidth: 'var(--elm-row-room, 100%)' }} />)}
        </div>
      )}
      {/* Bottom-center contextual toolbars, above the static bottomCenter
          entries (or the whole bottom row when they'd overlap it). Its bottom
          edge is --elm-bottom-stack-offset, which VertexSelectionBar rides too. */}
      {!tableFullscreen && (
        <div
          className="absolute z-[400] flex justify-center pointer-events-none transition-[right] duration-200"
          style={{ bottom: 'var(--elm-bottom-stack-offset)', left: 16, right: `calc(${panelOffset} + 16px)` }}
        >
          {/* Never wider than the map: a narrow editor wraps the bars instead. */}
          <div ref={contextualRef} data-elm-contextual="" className="flex flex-wrap justify-center gap-2 max-w-full min-w-0">
            <EditingToolbar />
            <ActiveDrawingToolbar />
            <SimplifyPanel />
            <SmoothPanel />
            <BufferPanel />
            <ReadonlyBanner />
          </div>
        </div>
      )}

      {!tableFullscreen && cfg.ui.layerList && layout === 'panel' && <LayersPanel footer={slots?.panelFooter} />}

      {layout === 'split' && <SplitPanel />}

      <ShellModals layout={layout} />
      </FileDropBox>
    </div>
    </EventProvider>
    </RootTokensContext.Provider>
    </RootCssVarsContext.Provider>
    </ThemeContext.Provider>
  )
})


export const ElementEditorShell = forwardRef<ElementEditorRef, ElementEditorShellProps>((props, ref) => {
  // Flat `accentColor` / `featureColor` win over their `config.*` twins. The deprecated
  // `routingApiKey` is the routing key only when `config.network.routing` gives none.
  const { config, accentColor, featureColor, routingApiKey, onError } = props
  if (routingApiKey !== undefined) warnOnce('routingApiKey', 'The `routingApiKey` prop is deprecated: use `config.network.routing.apiKey`.')
  const routing = config?.network?.routing
  const keyFromProp = !!routingApiKey && routing !== false && !routing?.apiKey
  const mergedConfig = useMemo(
    () => (accentColor || featureColor || keyFromProp
      ? {
          ...config,
          ...(accentColor && { accentColor }),
          ...(featureColor && { featureColor }),
          ...(keyFromProp && { network: { ...config?.network, routing: { ...(routing || {}), apiKey: routingApiKey } } }),
        }
      : config),
    [config, accentColor, featureColor, keyFromProp, routing, routingApiKey],
  )
  return (
    <ElementEditorErrorBoundary onError={onError}>
      <ElementEditorConfigProvider config={mergedConfig}>
        <GeoStoreProvider>
          <ShortcutConfigProvider>
            <MapControllerProvider>
              <ElementEditorInternal {...props} ref={ref} />
            </MapControllerProvider>
          </ShortcutConfigProvider>
        </GeoStoreProvider>
      </ElementEditorConfigProvider>
    </ElementEditorErrorBoundary>
  )
})

ElementEditorShell.displayName = 'ElementEditorShell'
