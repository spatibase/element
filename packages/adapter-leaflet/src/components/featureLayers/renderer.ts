import { Canvas } from 'leaflet'
import { createContext, useContext, useEffect, useMemo } from 'react'
import { SELECTED_FEATURE_CLASS } from '../../utils/selectedDrag'

// ─── Renderers ────────────────────────────────────────────────────────────────
//
// Unselected paths draw on ONE shared canvas (renderer='canvas', the default):
// at 5k features, painting thousands of SVG paths on every moveend was ~86% of
// the pan cost. Selected paths, and every editing overlay, stay on the map's SVG
// renderer, so editing UX is unchanged. A feature's layer moves between the two
// on select/deselect (remove + re-add of the same layer, no remount).
//
// The canvas lives in its own pane just under overlayPane (400), so SVG paths
// paint and hit-test above it.

export type FeatureRenderer = 'canvas' | 'svg'

/** Width of the invisible SVG hit path under a line: 8 px of slack each side of the cursor. */
export const LINE_HIT_WEIGHT = 16

const IDLE_PANE = 'elmIdleFeatures'

/** Casing under unselected lines: `width` px each side of the stroke, white at `opacity` (× the line's); none while the canvas holds more than `maxPaths` paths. */
export const LINE_CASING = { color: '#ffffff', width: 1.5, opacity: 0.7, maxPaths: 5000 }

/** Leaflet's canvas throttles hit-testing to one per 32 ms and DROPS the mousemove
 *  in between, including the map's own (drawing previews, snapping, drags over a
 *  canvas that covers the whole map). Throttle the hit test only, and keep firing
 *  map mousemoves during a pan / zoom animation like SVG does. A move that lands
 *  in the throttle window is hit-tested once the window ends: Leaflet never tests
 *  it, so a quick exit off a line (or stop next to it) left the hover, pointer
 *  cursor and name tooltip stuck on, or never turned them on. */
const IdleCanvas = (Canvas as unknown as { extend: (p: object) => new (o: L.RendererOptions & { tolerance?: number }) => L.Canvas }).extend({
  /** Lines get a thin light casing under their stroke (LINE_CASING), so they read over busy raster tiles. */
  // It costs a second stroke per line: above LINE_CASING.maxPaths paths on the canvas
  // (where a dense map gains nothing from it anyway) there's none, so panning 50k
  // lines stays as fast as before.
  _initPath(this: CanvasInternals, layer: L.Path) {
    this._pathCount = (this._pathCount ?? 0) + 1
    ;(Canvas.prototype as unknown as { _initPath: (l: L.Path) => void })._initPath.call(this, layer)
  },
  _removePath(this: CanvasInternals, layer: L.Path) {
    this._pathCount = Math.max(0, (this._pathCount ?? 0) - 1)
    ;(Canvas.prototype as unknown as { _removePath: (l: L.Path) => void })._removePath.call(this, layer)
  },
  _fillStroke(this: CanvasInternals, ctx: CanvasRenderingContext2D, layer: L.Path) {
    const o = layer.options
    if ((this._pathCount ?? 0) <= LINE_CASING.maxPaths && o.stroke !== false && !o.fill && '_parts' in layer && (o.opacity ?? 1) > 0.05 && !o.dashArray) {
      // No save/restore: Leaflet's stroke below sets every property this touches.
      ctx.globalAlpha = (o.opacity ?? 1) * LINE_CASING.opacity
      ctx.lineWidth = (o.weight ?? 3) + 2 * LINE_CASING.width
      ctx.strokeStyle = LINE_CASING.color
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash([])
      ctx.stroke()
    }
    ;(Canvas.prototype as unknown as { _fillStroke: (ctx: CanvasRenderingContext2D, layer: L.Path) => void })._fillStroke.call(this, ctx, layer)
  },
  _onMouseMove(this: CanvasInternals, e: MouseEvent) {
    if (!this._map) return
    if ((this._map.dragging as unknown as { moving: () => boolean }).moving() || this._map._animatingZoom) { this._fireEvent(false, e); return }
    this._handleMouseHover(e, this._map.mouseEventToLayerPoint(e))
  },
  _handleMouseHover(this: CanvasInternals, e: MouseEvent, point: L.Point) {
    if (this._mouseHoverThrottled) {
      this._trailingHover = [e, point]
      this._fireEvent(this._hoveredLayer ? [this._hoveredLayer] : false, e)
      return
    }
    this._trailingHover = null
    ;(Canvas.prototype as unknown as CanvasInternals)._handleMouseHover.call(this, e, point)
    clearTimeout(this._trailingTimer)
    // Just after Leaflet's own 32 ms throttle timer.
    this._trailingTimer = setTimeout(() => {
      const t = this._trailingHover
      this._trailingHover = null
      if (t && this._map) this._hoverHitTest(t[0], t[1])
    }, 33)
  },
  /** Leaflet's hover hit test (topmost interactive path wins) without re-firing the mousemove. */
  _hoverHitTest(this: CanvasInternals, e: MouseEvent, point: L.Point) {
    let hit: L.Layer | undefined
    for (let o = this._drawFirst; o; o = o.next) {
      if (o.layer.options.interactive && o.layer._containsPoint(point)) hit = o.layer
    }
    if (hit === (this._hoveredLayer ?? undefined)) return
    this._handleMouseOut(e)
    if (!hit) return
    this._container.classList.add('leaflet-interactive')
    this._fireEvent([hit], e, 'mouseover')
    this._hoveredLayer = hit
  },
})
type CanvasLayer = L.Layer & { options: { interactive?: boolean }; _containsPoint: (p: L.Point) => boolean }
type CanvasInternals = {
  _pathCount?: number
  _map: L.Map & { _animatingZoom?: boolean }
  _container: HTMLCanvasElement
  _drawFirst: { layer: CanvasLayer; next: CanvasInternals['_drawFirst'] } | null
  _hoveredLayer: L.Layer | null
  _mouseHoverThrottled: boolean
  _trailingHover: [MouseEvent, L.Point] | null
  _trailingTimer: ReturnType<typeof setTimeout> | undefined
  _fireEvent: (layers: L.Layer[] | false, e: MouseEvent, type?: string) => void
  _handleMouseHover: (e: MouseEvent, point: L.Point) => void
  _handleMouseOut: (e: MouseEvent) => void
  _hoverHitTest: (e: MouseEvent, point: L.Point) => void
}

/** The renderer for unselected paths; undefined = the map's default (SVG). */
export const IdleRendererContext = createContext<L.Renderer | undefined>(undefined)

export function useIdleRenderer(map: L.Map, mode: FeatureRenderer): L.Renderer | undefined {
  const renderer = useMemo(() => {
    if (mode !== 'canvas') return undefined
    if (!map.getPane(IDLE_PANE)) map.createPane(IDLE_PANE).style.zIndex = '399'
    // tolerance: a 3 px line gets a 15 px hover / click band (7.5 px each side), like the
    // 16 px SVG hit path (LINE_HIT_WEIGHT). Polygons get the same outer margin.
    return new IdleCanvas({ pane: IDLE_PANE, padding: 0.25, tolerance: 6 })
  }, [map, mode])
  useEffect(() => {
    if (!renderer) return
    // The SVG root spans the map: let events over its empty area fall through to
    // the canvas. Inherited, so interactive paths opt back in via leaflet.css.
    const overlay = map.getPane('overlayPane')!
    overlay.style.pointerEvents = 'none'
    return () => { renderer.remove(); overlay.style.pointerEvents = '' }
  }, [map, renderer])
  return renderer
}

/** DOM element to style for a path's cursor: its SVG element, or the shared canvas. */
export function pathElement(layer: L.Path): Element | undefined {
  return layer.getElement() ?? (layer as unknown as { _renderer?: { _container?: HTMLElement } })._renderer?._container
}

/**
 * Puts a feature's layers on the idle canvas while unselected and on SVG (on top)
 * while selected. Returns the renderer to mount with. On a flip it swaps the
 * existing layers in place; `onSwap` lets the caller fix per-renderer options
 * (set before the re-add) and re-target hover state afterwards.
 */
export function useFeatureRenderer(
  selected: boolean,
  getLayers: () => Iterable<L.Path | null | undefined>,
  onSwap?: { before?: (l: L.Path, onCanvas: boolean) => void; after?: () => void },
): L.Renderer | undefined {
  const idle = useContext(IdleRendererContext)
  const target = selected ? undefined : idle
  useEffect(() => {
    let swapped = false
    for (const l of getLayers()) {
      if (!l) continue
      const map = (l as unknown as { _map?: L.Map })._map
      if (map && l.options.renderer !== target) {
        map.removeLayer(l)
        l.options.renderer = target
        onSwap?.before?.(l, !!target)
        map.addLayer(l)
        swapped = true
      }
      // Selected features paint (and hit-test) above their neighbours.
      if (selected) l.bringToFront()
      // Move cursor + one-finger move on selected paths (utils/selectedDrag). Canvas paths have no element.
      l.getElement()?.classList.toggle(SELECTED_FEATURE_CLASS, selected)
    }
    if (swapped) onSwap?.after?.()
    // getLayers / onSwap read refs; only a selection or renderer flip re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, target])
  return target
}
