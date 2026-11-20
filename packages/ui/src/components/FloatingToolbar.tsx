import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import {
  MapPin, LineSegment, Polygon, X, MagnifyingGlass, Circle, Rectangle, Path, ScribbleLoop, Ruler, HandTap,
} from '@phosphor-icons/react'
import { featureLimitMessage, sidebarTakesSpace } from '@element-editor/core/internal'
import { useDataStore, useUIStore } from '../store/StoreContext'
import { useShortcutConfig } from '../contexts/ShortcutConfigContext'
import { useEmit } from '../contexts/EventContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import type { ToolbarPosition } from '../contexts/ElementEditorConfigContext'
import { useSearchState, inCodeEditor } from '../hooks/useSearchState'
import { useIsEventForEditor } from '../hooks/useKeyboardShortcuts'
import { SearchDropdown, type SearchDropdownHandle } from './ui/SearchDropdown'
import { Kbd } from './ui/Kbd'
import { ToolButton, ToolbarDivider } from './ui/ToolButton'
import { RowDivider } from './ui/RowDivider'

/** The inline search box's width (`w-52`): what the compact toolbar would need to show it. */
const SEARCH_BOX_WIDTH = 208

const positionMap: Record<ToolbarPosition, { style: CSSProperties; className: string }> = {
  'top-left':     { style: { top: 16, left: 16 },                                     className: 'flex-col items-start' },
  'top-center':   { style: { top: 16, left: 0, right: 0 },                            className: 'flex-col items-center' },
  'top-right':    { style: { top: 16, right: 16 },                                    className: 'flex-col items-end' },
  'left-center':  { style: { left: 16, top: '50%', transform: 'translateY(-50%)' },   className: 'flex-col items-start' },
  'right-center': { style: { right: 16, top: '50%', transform: 'translateY(-50%)' }, className: 'flex-col items-end' },
  'bottom-left':  { style: { bottom: 16, left: 16 },                                  className: 'flex-col-reverse items-start' },
  'bottom-center':{ style: { bottom: 16, left: 0, right: 0 },                         className: 'flex-col-reverse items-center' },
  'bottom-right': { style: { bottom: 16, right: 16 },                                 className: 'flex-col-reverse items-end' },
}

export default function FloatingToolbar({ embedded }: { embedded?: boolean } = {}) {
  const featuresCount = useDataStore((s) => s.features.length)
  const maxFeatures = useDataStore((s) => s.maxFeatures)
  const replaceAtLimit = useDataStore((s) => s.replaceAtLimit)
  const isAtMax = maxFeatures != null && featuresCount >= maxFeatures && !(replaceAtLimit && maxFeatures === 1)
  const emit = useEmit()
  const cfg = useElementEditorConfig()
  const { toolbar } = cfg
  const isVertical = toolbar.direction === 'vertical'
  const basePosInfo = positionMap[toolbar.position]

  // Layers panel awareness — when the panel is visible (configured + open),
  // shift right-edge-anchored toolbars and full-width centered ones inward
  // so the toolbar doesn't render under the panel. Same principle as the
  // corner buttons in ElementEditor.tsx.
  const sidebarBeside = useUIStore(sidebarTakesSpace)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const codeDockWidth = useUIStore((s) => s.codeDockWidth)
  const layout = useUIStore((s) => s.layout)
  // The right-side LayersPanel is only rendered in `panel` layout. In
  // `minimal` (modal) and `split` (bottom panel) layouts the right edge is
  // free, so the toolbar can sit flush at right:16.
  const panelVisible = cfg.ui.layerList && sidebarBeside
  // In split layout the bottom 1/3 of the editor is taken by a panel. Two
  // adjustments are needed so the toolbar stays inside the visible map:
  // - Bottom-anchored positions: push up above the panel.
  // - Side-center positions (left-center / right-center): re-center on the
  //   map area (top 2/3) instead of the full viewport, otherwise the toolbar
  //   sits right on the boundary between the map and the panel.
  const isBottomAnchored = toolbar.position.startsWith('bottom')
  const isSideCenter = toolbar.position === 'left-center' || toolbar.position === 'right-center'
  const splitBottomOffset = layout === 'split' && isBottomAnchored
  const splitSideCenter = layout === 'split' && isSideCenter
  const posInfo = (() => {
    let style: CSSProperties = basePosInfo.style
    const isRightAnchored = toolbar.position.endsWith('-right') || toolbar.position.startsWith('right')
    if (panelVisible) {
      if (isRightAnchored) {
        style = { ...style, right: sidebarWidth + 16 + codeDockWidth }
      }
      // top-center / bottom-center use left:0 right:0 — they stay truly centered
      // in the full viewport and must not be affected by the side panel.
    } else if (cfg.ui.layerList && layout === 'panel' && toolbar.position === 'top-right') {
      // Collapsed panel: its open-toggle sits at the top-right edge (48px + gap).
      style = { ...style, right: 72 + codeDockWidth }
    } else if (isRightAnchored && codeDockWidth) {
      // Docked GeoJSON inspector on the right edge.
      style = { ...style, right: 16 + codeDockWidth }
    }
    if (splitBottomOffset) {
      style = { ...style, bottom: 'calc(33.33% + 16px)' }
    } else if (isBottomAnchored) {
      // Clear the data table panel (floating layout) so the toolbar doesn't
      // render on top of the table. The CSS var is published by DataTablePanel.
      style = { ...style, bottom: 'calc(var(--elm-table-offset, 0px) + 16px)' }
    }
    if (splitSideCenter) {
      style = { ...style, top: '33.33%' }
    }
    return style === basePosInfo.style ? basePosInfo : { ...basePosInfo, style }
  })()

  const editingMode = useUIStore((s) => s.editingMode)
  const enabledTools = useUIStore((s) => s.enabledTools)
  const unavailableTools = useUIStore((s) => s.unavailableTools)
  const readonly = useUIStore((s) => s.readonly)
  const setEditingMode = useUIStore((s) => s.setEditingMode)

  function handleToolClick(mode: import('@element-editor/core').EditingMode) {
    if (isAtMax && mode !== 'none') {
      emit({ type: 'error', code: 'limit-reached', source: 'editor', message: featureLimitMessage(maxFeatures) })
      return
    }
    setEditingMode(mode)
  }

  const { getKey } = useShortcutConfig()
  const { query, setQuery, setOpen, showDropdown, containerRef, inputRef, focused, setFocused, results, loading, error, flyToResult, handleAdd, handleAddShape, clear, activeIndex, setActiveIndex, handleInputKeyDown } = useSearchState()
  const dropdownRef = useRef<SearchDropdownHandle>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // When the toolbar is at a bottom position (standalone, not embedded), publish
  // its height as --elm-bottom-toolbar-offset so contextual toolbars above it
  // (EditingToolbar, ActiveDrawingToolbar, etc.) can clear it automatically.
  useEffect(() => {
    if (embedded || !isBottomAnchored) return
    const host = barRef.current?.closest('[data-elm-theme]') as HTMLElement | null
    if (!host) return
    const update = () => {
      const h = barRef.current?.offsetHeight ?? 0
      host.style.setProperty('--elm-bottom-toolbar-offset', `${h + 8}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    if (barRef.current) ro.observe(barRef.current)
    return () => {
      ro.disconnect()
      host.style.setProperty('--elm-bottom-toolbar-offset', '0px')
    }
  }, [embedded, isBottomAnchored])

  // Vertical mode: search collapses to an icon button that opens a popup
  // beside the toolbar so the feature isn't lost in the alternate layout.
  const [searchPopupOpen, setSearchPopupOpen] = useState(false)
  const searchPopupRef = useRef<HTMLDivElement>(null)
  const searchToggleRef = useRef<HTMLDivElement>(null)

  // Horizontal toolbar wider than the room it has (narrow editor, panels
  // open): the search box becomes an icon whose popup opens under the bar,
  // and if the tools still don't fit, the bar wraps onto a second line. The
  // room is the edge row's width minus its corner clearance, which doesn't
  // depend on this, and the width compared is the one-line, full-search
  // width, so the switch can't flip-flop.
  const [compact, setCompact] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const pill = pillRef.current
    if (isVertical || !pill) { setCompact(false); return }
    const edge = (containerRef.current?.closest('[data-elm-edge="top"], [data-elm-edge="bottom"]') ?? null) as HTMLElement | null
    const area = edge ?? (containerRef.current?.offsetParent as HTMLElement | null)
    if (!area) return
    // Tooltip wrappers are `display: contents`: measure what they wrap.
    const widthsOf = (els: Element[]): number[] => els.flatMap((k) =>
      getComputedStyle(k).display === 'contents' ? widthsOf([...k.children]) : [(k as HTMLElement).offsetWidth])
    const check = () => {
      const widths = widthsOf([...pill.children]).filter((w) => w > 0)
      const cs = getComputedStyle(pill)
      const chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
      let full = widths.reduce((a, b) => a + b, 0) + 8 * Math.max(0, widths.length - 1) + chrome
      const icon = pill.querySelector<HTMLElement>('[data-elm-search-toggle]')
      if (icon) full += SEARCH_BOX_WIDTH - icon.offsetWidth
      const room = edge ? edge.clientWidth - (parseFloat(edge.dataset.elmClearance ?? '') || 0) : area.clientWidth - 32
      setCompact(room > 0 && full > room + 0.5)
    }
    check()
    const ro = new ResizeObserver(() => check())
    ro.observe(area)
    ro.observe(pill)
    return () => ro.disconnect()
  }, [isVertical, containerRef])
  const searchAsIcon = isVertical || compact
  const searchAsIconRef = useRef(searchAsIcon)
  searchAsIconRef.current = searchAsIcon
  // Leaving compact mode closes its popup (the inline box takes over).
  useEffect(() => { if (!searchAsIcon) setSearchPopupOpen(false) }, [searchAsIcon])

  // Press feedback on the search input. We drive the CSS `press-pulse`
  // animation imperatively via ref so we can RESTART it on every trigger
  // without remounting (remount would kill the input's focus/caret and
  // make the user unable to type).
  const searchRowRef = useRef<HTMLDivElement>(null)
  const isForThisEditor = useIsEventForEditor()
  function triggerSearchPress() {
    const el = searchRowRef.current
    if (!el) return
    el.style.animation = 'none'
    // Force a reflow between clearing and re-applying so the browser treats
    // it as a fresh animation and re-runs from frame 0. Reading offsetWidth
    // is the canonical way to force a synchronous layout flush.
    void el.offsetWidth
    el.style.animation = 'press-pulse 200ms ease-out'
  }

  // Cmd+F fires even when the input is already focused — onFocus won't run
  // in that case, so we trigger the press here directly. Click-focus still
  // goes through onFocus below.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey) && isForThisEditor(e) && !inCodeEditor(e)) {
        // Search behind an icon: open its popup (which focuses the input).
        if (searchAsIconRef.current) setSearchPopupOpen(true)
        else triggerSearchPress()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isForThisEditor])
  // Open the search popup AWAY from whichever map edge the toolbar is anchored
  // to. Right-edge anchors (right-top / right-center / right-bottom AND the
  // top-right / bottom-right corners) all need the popup to flip left so it
  // doesn't overflow the viewport / sit under the layers panel.
  const popupSide: 'left' | 'right' =
    toolbar.position.startsWith('right') || toolbar.position.endsWith('-right')
      ? 'left'
      : 'right'

  useEffect(() => {
    if (!searchPopupOpen) return
    requestAnimationFrame(() => inputRef.current?.focus())
    function handleClickOutside(e: MouseEvent) {
      // Not the toggle: its own click closes it (closing here first would reopen it).
      if (!searchPopupRef.current?.contains(e.target as Node) && !searchToggleRef.current?.contains(e.target as Node)) setSearchPopupOpen(false)
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setSearchPopupOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [searchPopupOpen, inputRef])

  const isPlacingPoint = editingMode === 'place-point'
    const isDrawingLine = editingMode === 'draw-line'
    const isDrawingPolygon = editingMode === 'draw-polygon'
  const isDrawingCircle = editingMode === 'draw-circle'
  const isDrawingRect = editingMode === 'draw-rect'
  const isDrawingRoute = editingMode === 'draw-route'
  const isDrawingFreehand = editingMode === 'draw-freehand'
  const isPickingShape = editingMode === 'pick-shape'
  const isMeasuring = editingMode === 'measure'
  const shouldShow = (tool: string) => (!enabledTools || enabledTools.includes(tool)) && !unavailableTools.includes(tool)


  const hintText = null


  function handleSearchKeyDown(e: Parameters<typeof handleInputKeyDown>[0]) {
    if (e.key === 'Tab' && activeIndex >= 0) {
      e.preventDefault()
      dropdownRef.current?.focusAdd(activeIndex)
      return
    }
    handleInputKeyDown(e)
  }

  function handleDropdownNavigate(delta: 1 | -1, fromIndex: number) {
    const newIndex = ((fromIndex + delta) % results.length + results.length) % results.length
    setActiveIndex(newIndex)
    dropdownRef.current?.focusAdd(newIndex)
  }

  // A vertical toolbar never wraps; a horizontal one does at narrow widths, where a
  // divider must not be left alone at the start or end of a row.
  const divider = isVertical ? <ToolbarDivider vertical /> : <RowDivider><ToolbarDivider /></RowDivider>

  // When `embedded` is true, ElementEditor.tsx renders us inside a layout
  // slot (config.ui.layout) — skip the outer absolute-positioned wrapper so
  // the slot's flex layout handles placement. Standalone (adapter users), we
  // position ourselves by `toolbar.position` (the toolbar's layout slot).
  return (
    <div
      ref={containerRef}
      // `data-elm-search-open` lets the global keyboard shortcut hook
      // (useKeyboardShortcuts) skip its layer-jump Tab handler when the
      // search popover is in use, so Tab/Shift+Tab walk the popover's
      // result buttons natively.
      data-elm-search-open={showDropdown ? 'true' : undefined}
      className={
        embedded
          ? 'select-none'  // corner container handles positioning + pointer-events
          : clsx('absolute z-[500] flex gap-2 pointer-events-none select-none', posInfo.className)
      }
      style={embedded ? undefined : posInfo.style}
    >

      {/* Main bar + dropdown anchored to the same width */}
      <div ref={barRef} className="relative w-fit max-w-full">

        {/* Dropdown — horizontal mode: opens downward normally, upward when bottom-anchored */}
        {showDropdown && !searchAsIcon && (
          <SearchDropdown
            ref={dropdownRef}
            results={results}
            loading={loading}
            error={error}
            onGo={flyToResult}
            onAdd={readonly ? undefined : handleAdd}
            onAddShape={readonly ? undefined : handleAddShape}
            activeIndex={activeIndex}
            onHoverIndex={setActiveIndex}
            onNavigate={handleDropdownNavigate}
            layout="row"
            className={`absolute left-0 right-0 bg-elm-surface border border-elm-border rounded-elm shadow-elm z-50 overflow-hidden pointer-events-auto ${isBottomAnchored ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          />
        )}

        <div ref={pillRef} className={clsx(
          'flex gap-2 bg-elm-surface/95 backdrop-blur-md border border-(--elm-border,color-mix(in_oklab,var(--color-black)_10%,transparent)) dark:border-(--elm-border,color-mix(in_oklab,var(--color-white)_10%,transparent)) shadow-elm rounded-elm pointer-events-auto antialiased',
          isVertical ? 'flex-col items-center p-[7px]' : 'flex-row flex-wrap justify-center items-center p-[7px]',
        )}>

          {!readonly ? (
            <>

              {shouldShow('point') && (
                <ToolButton active={isPlacingPoint} disabled={!isPlacingPoint && isAtMax} onClick={() => handleToolClick(isPlacingPoint ? 'none' : 'place-point')} label="Point" shortcut={getKey('place-point').toUpperCase()} shortcutId="place-point">
                  <MapPin size={24} />
                </ToolButton>
              )}
              {shouldShow('line') && (
                <ToolButton active={isDrawingLine} disabled={!isDrawingLine && isAtMax} onClick={() => handleToolClick(isDrawingLine ? 'none' : 'draw-line')} label="Line" shortcut={getKey('draw-line').toUpperCase()} shortcutId="draw-line">
                  <LineSegment size={24} />
                </ToolButton>
              )}
              {shouldShow('polygon') && (
                <ToolButton active={isDrawingPolygon} disabled={!isDrawingPolygon && isAtMax} onClick={() => handleToolClick(isDrawingPolygon ? 'none' : 'draw-polygon')} label="Area" shortcut={getKey('draw-polygon').toUpperCase()} shortcutId="draw-polygon">
                  <Polygon size={24} />
                </ToolButton>
              )}
              {shouldShow('route') && (
                <ToolButton active={isDrawingRoute} disabled={!isDrawingRoute && isAtMax} onClick={() => handleToolClick(isDrawingRoute ? 'none' : 'draw-route')} label="Route" shortcut={getKey('draw-route').toUpperCase()} shortcutId="draw-route">
                  <Path size={24} />
                </ToolButton>
              )}
              {shouldShow('circle') && (
                <ToolButton active={isDrawingCircle} disabled={!isDrawingCircle && isAtMax} onClick={() => handleToolClick(isDrawingCircle ? 'none' : 'draw-circle')} label="Circle" shortcut={getKey('draw-circle').toUpperCase()} shortcutId="draw-circle">
                  <Circle size={24} />
                </ToolButton>
              )}
              {shouldShow('rectangle') && (
                <ToolButton active={isDrawingRect} disabled={!isDrawingRect && isAtMax} onClick={() => handleToolClick(isDrawingRect ? 'none' : 'draw-rect')} label="Rectangle" shortcut={getKey('draw-rect').toUpperCase()} shortcutId="draw-rect">
                  <Rectangle size={24} />
                </ToolButton>
              )}
              {shouldShow('freehand') && (
                <ToolButton active={isDrawingFreehand} disabled={!isDrawingFreehand && isAtMax} onClick={() => handleToolClick(isDrawingFreehand ? 'none' : 'draw-freehand')} label="Freehand" shortcut={getKey('draw-freehand').toUpperCase()} shortcutId="draw-freehand">
                  <ScribbleLoop size={24} />
                </ToolButton>
              )}
              {shouldShow('picker') && (
                <ToolButton active={isPickingShape} disabled={!isPickingShape && isAtMax} onClick={() => handleToolClick(isPickingShape ? 'none' : 'pick-shape')} label="Picker" shortcut={getKey('picker').toUpperCase()} shortcutId="picker">
                  <HandTap size={24} />
                </ToolButton>
              )}
            </>

          ) : null}

          {shouldShow('measure') && (
            <>
              {!readonly && divider}
              <ToolButton active={isMeasuring} onClick={() => setEditingMode(isMeasuring ? 'none' : 'measure')} label="Measure" shortcut={getKey('measure').toUpperCase()} shortcutId="measure">
                <Ruler size={24} />
              </ToolButton>
              {searchAsIcon && shouldShow('search') && divider}
            </>
          )}

          {/* Search — inline input in horizontal mode; icon button + side popup in vertical mode.
              Outer div owns background + padding + rounded border so those stay static; the
              press-scale only squeezes the inner row (icon + input + spinner/clear).
              The ⌘F hint sits OUTSIDE the animated row so it doesn't bounce with the press. */}
          {shouldShow('search') && !searchAsIcon && (
            <div className="flex items-center gap-2 pl-2.5 pr-3 py-1.5 bg-(--elm-surface-sunken,var(--color-gray-100)) dark:bg-(--elm-surface-sunken,color-mix(in_oklab,var(--color-white)_7%,transparent)) hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-gray-200)_70%,transparent)) dark:hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-white)_10%,transparent)) rounded-elm-control transition-colors w-52 focus-within:ring-1 focus-within:ring-inset focus-within:ring-elm-focus-ring">
              <div
                ref={searchRowRef}
                className="flex items-center gap-2 flex-1 min-w-0"
              >
                <MagnifyingGlass size={14} className="text-elm-text-subtle flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => { setFocused(true); triggerSearchPress(); query.trim().length >= 2 && setOpen(true) }}
                  onBlur={() => setFocused(false)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search places…"
                  className="bg-transparent text-sm text-elm-text-secondary placeholder-elm-text-muted outline-none w-full"
                  autoComplete="off"
                />
                {loading && (
                  <div className="w-3 h-3 border-2 border-(--elm-border-strong,var(--color-gray-300)) border-t-primary-500 rounded-full animate-spin flex-shrink-0" />
                )}
                {!loading && query && (
                  <button onClick={clear} className="p-1 -m-1 rounded-elm-chip text-elm-text hover:bg-(--elm-control-hover,var(--color-gray-200)) dark:hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-white)_15%,transparent)) transition-colors flex-shrink-0" aria-label="Clear search">
                    <X size={12} />
                  </button>
                )}
              </div>
              {!loading && !query && (
                // Sibling of the animated row — excluded from the press-pulse scale.
                // Still fades opacity+scale on focus so the hint animates out when
                // the user starts searching.
                <span
                  className={clsx(
                    'flex items-center gap-0.5 flex-shrink-0 transition-all duration-110 ease-out',
                    focused ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100',
                  )}
                >
                  <Kbd>⌘</Kbd><Kbd>F</Kbd>
                </span>
              )}
            </div>
          )}

          {shouldShow('search') && searchAsIcon && (
            <div ref={searchToggleRef} data-elm-search-toggle="" className={isVertical ? 'relative' : undefined}>
              <ToolButton
                active={searchPopupOpen}
                onClick={() => setSearchPopupOpen((o) => !o)}
                label="Search places"
                shortcut="⌘F"

              >
                <MagnifyingGlass size={24} />
              </ToolButton>
              {searchPopupOpen && (
                <div
                  ref={searchPopupRef}
                  className={clsx(
                    'absolute z-50 bg-elm-surface/97 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm pointer-events-auto antialiased flex flex-col',
                    // Vertical: beside the column. Compact horizontal: under
                    // (or above) the bar, as wide as it, like the inline dropdown.
                    !isVertical ? `left-0 right-0 min-w-0 ${isBottomAnchored ? 'bottom-full mb-2' : 'top-full mt-2'}`
                      : popupSide === 'right' ? 'top-0 w-80 left-full ml-2' : 'top-0 w-80 right-full mr-2',
                  )}
                >
                  <div className="m-1 flex items-center gap-2 px-2 py-1 rounded-elm-control focus-within:ring-1 focus-within:ring-inset focus-within:ring-elm-focus-ring">
                    <MagnifyingGlass size={16} className="text-elm-text-subtle flex-shrink-0" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onFocus={() => { setFocused(true); query.trim().length >= 2 && setOpen(true) }}
                      onBlur={() => setFocused(false)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Search places…"
                      className="bg-transparent text-sm text-elm-text-secondary placeholder-elm-text-muted outline-none w-full"
                      autoComplete="off"
                    />
                    {loading && (
                      <div className="w-3 h-3 border-2 border-(--elm-border-strong,var(--color-gray-300)) border-t-primary-500 rounded-full animate-spin flex-shrink-0" />
                    )}
                    {!loading && query && (
                      <button onClick={clear} className="p-1 -m-1 rounded-elm-chip text-elm-text hover:bg-(--elm-control-hover,var(--color-gray-200)) dark:hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-white)_15%,transparent)) transition-colors flex-shrink-0" aria-label="Clear search">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {showDropdown && (
                    <SearchDropdown
                      ref={dropdownRef}
                      results={results}
                      loading={loading}
                      error={error}
                      onGo={(r) => { flyToResult(r); setSearchPopupOpen(false) }}
                      onAdd={readonly ? undefined : (r) => { handleAdd(r); setSearchPopupOpen(false) }}
                      onAddShape={readonly ? undefined : (r) => { handleAddShape(r); setSearchPopupOpen(false) }}
                      activeIndex={activeIndex}
                      onHoverIndex={setActiveIndex}
                      onNavigate={handleDropdownNavigate}
                      className="border-t border-elm-border max-h-80 overflow-y-auto"
                    />
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Hint bar */}
      {!readonly && hintText && (
        <div className={clsx(
          'px-4 py-1.5 text-xs rounded-elm shadow-elm-control backdrop-blur-md pointer-events-auto whitespace-nowrap',
          'bg-elm-surface/95 border border-elm-border/80 text-elm-text-muted font-medium shadow-md'
        )}>
          {hintText}
        </div>
      )}
    </div>
  )
}
