/**
 * TransformControls — scale and rotate handles for the current selection
 * (1..N features). Handles are maplibregl.Marker instances anchored at the
 * corners + mid-edges of the selection's bbox; a rotate handle hangs off the
 * top edge.
 *
 * Live preview: while a handle is being dragged, we imperatively patch the
 * transformed geometries into the `elm-features` GL source (once per frame,
 * see utils/liveFeatureSource) so the rotation/scale is visible live. Commit
 * happens once on mouseup via `takeSnapshot()` + one `updateFeatures`
 * per affected feature. This mirrors the adapter-leaflet TransformControls and
 * the imperative translate pattern used by FeatureInteractionLayer.
 *
 * Modifiers during scale (same as adapter-leaflet, see `scaleForDrag`):
 *   - Shift: uniform scale on every handle — preserves shape in projected space.
 *   - Alt:   scale from the box centre (not the opposite corner/edge); combines with Shift.
 * Rotation pivots on the box centre.
 *
 * Mercator correctness: rotation/non-uniform scale are applied in a latRatio-
 * corrected local frame; uniform scale runs in projected (Mercator) space per
 * vertex so wide-latitude shapes don't distort.
 */
import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { rafThrottle } from '../utils/rafThrottle'
import { paintLiveGeometries } from '../utils/liveFeatureSource'
import type { GeoJSONFeature, Geometry as ElementEditorGeom } from '@element-editor/core'
import { applyVisualTransform, getMercatorLatCorrectionRatio, toRadians, project, unproject, transformUpdates, mapPositions, offsetGeometry } from '@element-editor/core/internal'
import { transformRotate } from '@turf/transform-rotate'
import { featureCollection } from '@turf/helpers'
import { bbox } from '@turf/bbox'
import type { Feature, Geometry } from 'geojson'

// ─── Geometry helpers ─────────────────────────────────────────────────────────

interface BboxGeom {
  corners: [number, number][]
  edges: [number, number][]
  center: [number, number]
  rotateHandle: [number, number]
}

/** The delta `offsetGeometry` takes for a move from `from` to `to` (projected units in visual mode). */
function moveDelta(from: [number, number], to: [number, number], visual: boolean): [number, number] {
  if (!visual) return [to[0] - from[0], to[1] - from[1]]
  const a = project(from), b = project(to)
  return [b[0] - a[0], b[1] - a[1]]
}

function offsetPoints(points: [number, number][], delta: [number, number], visual: boolean): [number, number][] {
  return (offsetGeometry({ type: 'MultiPoint', coordinates: points }, delta, visual) as { coordinates: [number, number][] }).coordinates
}

/**
 * Whether container point `p` is inside the polygon `ring` or within `tolerance` px of its
 * outline (so a flat box, e.g. around a horizontal line, can still be grabbed).
 */
function pointInBox(p: { x: number; y: number }, ring: { x: number; y: number }[], tolerance: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    const dx = b.x - a.x, dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
    if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= tolerance) return true
  }
  return inside
}

/** Pixels the pointer must travel before a press inside the box becomes a move (a click stays a click). */
const MOVE_THRESHOLD_PX = 3
/** A press this close outside the box outline still grabs it (as on Leaflet). */
const BOX_GRAB_TOLERANCE_PX = 8

function computeAxisAlignedBbox(features: Feature<Geometry>[]): BboxGeom {
  const fc = featureCollection(features)
  const [minLng, minLat, maxLng, maxLat] = bbox(fc)
  const midLng = (minLng + maxLng) / 2
  const midLat = boxMidLat(minLat, maxLat)
  return {
    corners: [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ],
    edges: [
      [midLng, maxLat],
      [maxLng, midLat],
      [midLng, minLat],
      [minLng, midLat],
    ],
    // The box centre (rotation pivot, Alt-scale anchor), not the vertex mean.
    center: [midLng, midLat],
    rotateHandle: [midLng, maxLat],
  }
}

/** Rotate points around a pivot (used during rotation drag). */
function rotatePoints(
  points: [number, number][],
  pivot: [number, number],
  angleDeg: number,
): [number, number][] {
  const [cx, cy] = pivot
  const angleRad = toRadians(angleDeg)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  const latRatio = getMercatorLatCorrectionRatio(cy)
  return points.map(([lng, lat]) => {
    const dx = (lng - cx) * latRatio
    const dy = lat - cy
    return [
      cx + (dx * cosA - dy * sinA) / latRatio,
      cy + (dx * sinA + dy * cosA),
    ] as [number, number]
  })
}

/**
 * Scale along rotated axes: un-rotate by `angleDeg`, scale, re-rotate.
 * Reduces to plain axis-aligned scaling when angleDeg=0.
 */
function rotatedScalePoints(
  points: [number, number][],
  origin: [number, number],
  scaleX: number,
  scaleY: number,
  angleDeg: number,
): [number, number][] {
  const [ox, oy] = origin
  const angleRad = toRadians(angleDeg)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  const latRatio = getMercatorLatCorrectionRatio(oy)
  return points.map(([lng, lat]) => {
    const dx = (lng - ox) * latRatio
    const dy = lat - oy
    const ux = dx * cosA + dy * sinA
    const uy = -dx * sinA + dy * cosA
    const sx = ux * scaleX
    const sy = uy * scaleY
    const rx = sx * cosA - sy * sinA
    const ry = sx * sinA + sy * cosA
    return [ox + rx / latRatio, oy + ry] as [number, number]
  })
}

/**
 * Scale a feature uniformly in projected (Mercator) space so shapes are
 * preserved visually. The non-projected applyRotatedScale uses a single latRatio
 * at the origin which distorts shapes that span many degrees of latitude.
 */
function applyProjectedUniformScale(
  feature: Feature<Geometry>,
  origin: [number, number],
  scaleFactor: number,
  angleDeg: number,
): Feature<Geometry> {
  const pOrigin = project(origin)
  const angleRad = toRadians(angleDeg)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)

  function t(coord: [number, number]): [number, number] {
    const p = project(coord)
    const dx = p[0] - pOrigin[0]
    const dy = p[1] - pOrigin[1]
    const ux = dx * cosA + dy * sinA
    const uy = -dx * sinA + dy * cosA
    const sx = ux * scaleFactor
    const sy = uy * scaleFactor
    const rx = sx * cosA - sy * sinA
    const ry = sx * sinA + sy * cosA
    return unproject([pOrigin[0] + rx, pOrigin[1] + ry])
  }

  // Every geometry type; altitude (3rd position member) is kept.
  return { ...feature, geometry: mapPositions(feature.geometry, t) }
}

function projectedUniformScalePoints(
  points: [number, number][],
  origin: [number, number],
  scaleFactor: number,
  angleDeg: number,
): [number, number][] {
  const pOrigin = project(origin)
  const angleRad = toRadians(angleDeg)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  return points.map(pt => {
    const p = project(pt)
    const dx = p[0] - pOrigin[0]
    const dy = p[1] - pOrigin[1]
    const ux = dx * cosA + dy * sinA
    const uy = -dx * sinA + dy * cosA
    const sx = ux * scaleFactor
    const sy = uy * scaleFactor
    const rx = sx * cosA - sy * sinA
    const ry = sx * sinA + sy * cosA
    return unproject([pOrigin[0] + rx, pOrigin[1] + ry])
  })
}

function applyRotatedScale(
  feature: Feature<Geometry>,
  origin: [number, number],
  scaleX: number,
  scaleY: number,
  angleDeg: number,
): Feature<Geometry> {
  const [ox, oy] = origin
  const angleRad = toRadians(angleDeg)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  const latRatio = getMercatorLatCorrectionRatio(oy)

  function t(coord: [number, number]): [number, number] {
    const dx = (coord[0] - ox) * latRatio
    const dy = coord[1] - oy
    const ux = dx * cosA + dy * sinA
    const uy = -dx * sinA + dy * cosA
    const sx = ux * scaleX
    const sy = uy * scaleY
    const rx = sx * cosA - sy * sinA
    const ry = sx * sinA + sy * cosA
    return [ox + rx / latRatio, oy + ry]
  }

  // Every geometry type; altitude (3rd position member) is kept.
  return { ...feature, geometry: mapPositions(feature.geometry, t) }
}

/**
 * Latitude of the box's middle as drawn on the (Web Mercator) map: the midpoint of `minLat..maxLat`
 * in projected space, so the centre and the side handles sit where the user sees the middle.
 */
function boxMidLat(minLat: number, maxLat: number): number {
  return unproject([0, (project([0, minLat])[1] + project([0, maxLat])[1]) / 2])[1]
}

/** What a scale-handle drag needs to know (from the drag state). */
interface ScaleDrag {
  initialBbox: BboxGeom
  /** The opposite corner / side of the pressed handle. */
  origin: [number, number]
  startLngLat: [number, number]
  /** 0 N, 1 E, 2 S, 3 W for a side handle; undefined for a corner. */
  edgeIndex?: number
  /** The box's rotation (degrees, Mercator-corrected frame). */
  rotationAngle: number
}

type ScaleResult =
  | { origin: [number, number]; uniform: true; factor: number }
  | { origin: [number, number]; uniform: false; scaleX: number; scaleY: number }

/**
 * The scale for a handle drag. Same rules on both engines (adapter-leaflet and adapter-maplibre
 * keep this function identical):
 * - plain: anchored at the opposite corner / side; a corner scales both box axes, a side one.
 * - Shift: uniform on every handle. A corner takes the cursor's projection onto the box diagonal,
 *   a side the dragged axis. Computed (and applied) in projected space per vertex, so the shape
 *   keeps its on-screen proportions at any latitude.
 * - Alt / Option: anchored at the box centre instead (combines with Shift).
 * Factors are clamped away from 0 so the shape never collapses.
 */
function scaleForDrag(d: ScaleDrag, cursor: [number, number], shift: boolean, alt: boolean): ScaleResult {
  const origin = alt ? d.initialBbox.center : d.origin
  const cosA = Math.cos(toRadians(d.rotationAngle))
  const sinA = Math.sin(toRadians(d.rotationAngle))
  // Offset from the origin in the box's own (un-rotated) frame.
  let toLocal: (p: [number, number]) => [number, number]
  if (shift) {
    const pO = project(origin)
    toLocal = (p) => {
      const q = project(p)
      const dx = q[0] - pO[0], dy = q[1] - pO[1]
      return [dx * cosA + dy * sinA, -dx * sinA + dy * cosA]
    }
  } else {
    const latRatio = getMercatorLatCorrectionRatio(origin[1])
    toLocal = (p) => {
      const dx = (p[0] - origin[0]) * latRatio, dy = p[1] - origin[1]
      return [dx * cosA + dy * sinA, -dx * sinA + dy * cosA]
    }
  }
  const [x0, y0] = toLocal(d.startLngLat)
  const [x1, y1] = toLocal(cursor)
  const vertical = d.edgeIndex === 0 || d.edgeIndex === 2 // N / S side: height only
  const horizontal = d.edgeIndex === 1 || d.edgeIndex === 3 // E / W side: width only
  const clamp = (s: number) => (Math.abs(s) < 0.01 ? (s < 0 ? -0.01 : 0.01) : s)
  const ratio = (cur: number, start: number) => (Math.abs(start) > 1e-9 ? cur / start : 1)

  if (shift) {
    let factor: number
    if (vertical) factor = ratio(y1, y0)
    else if (horizontal) factor = ratio(x1, x0)
    else {
      const len2 = x0 * x0 + y0 * y0
      factor = len2 > 1e-18 ? (x1 * x0 + y1 * y0) / len2 : 1
    }
    return { origin, uniform: true, factor: clamp(factor) }
  }
  return {
    origin,
    uniform: false,
    scaleX: horizontal || !vertical ? clamp(ratio(x1, x0)) : 1,
    scaleY: vertical || !horizontal ? clamp(ratio(y1, y0)) : 1,
  }
}

/** Apply a `scaleForDrag` result to the drag's features and box. */
function applyScale(features: Feature<Geometry>[], box: BboxGeom, s: ScaleResult, angle: number): { features: Feature<Geometry>[]; box: BboxGeom } {
  const pts = s.uniform
    ? (p: [number, number][]) => projectedUniformScalePoints(p, s.origin, s.factor, angle)
    : (p: [number, number][]) => rotatedScalePoints(p, s.origin, s.scaleX, s.scaleY, angle)
  return {
    features: features.map((f) => s.uniform
      ? applyProjectedUniformScale(f, s.origin, s.factor, angle)
      : applyRotatedScale(f, s.origin, s.scaleX, s.scaleY, angle)),
    box: {
      corners: pts(box.corners),
      edges: pts(box.edges),
      center: pts([box.center])[0],
      rotateHandle: pts([box.rotateHandle])[0],
    },
  }
}

// ─── Handle DOM ───────────────────────────────────────────────────────────────

type HandleKind = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | 'rotate'

function cursorFor(kind: HandleKind): string {
  if (kind === 'nw' || kind === 'se') return 'nwse-resize'
  if (kind === 'ne' || kind === 'sw') return 'nesw-resize'
  if (kind === 'n' || kind === 's') return 'ns-resize'
  if (kind === 'e' || kind === 'w') return 'ew-resize'
  return 'grab'
}

function makeHandleEl(kind: HandleKind): HTMLElement {
  const el = document.createElement('div')
  if (kind === 'rotate') {
    el.style.cssText = [
      'position:relative',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:16px',
      'height:32px',
      'cursor:grab',
    ].join(';')
    const stem = document.createElement('div')
    stem.style.cssText = 'position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:2px;height:24px;background:var(--color-primary-600);'
    el.appendChild(stem)
    const knob = document.createElement('div')
    knob.style.cssText = [
      'position:absolute',
      'top:0',
      'left:50%',
      'transform:translateX(-50%)',
      'width:16px',
      'height:16px',
      'background:#ffffff',
      'border:2px solid var(--color-primary-600)',
      'border-radius:50%',
      'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
    ].join(';')
    const dot = document.createElement('div')
    dot.style.cssText = 'width:6px;height:6px;background:var(--color-primary-600);border-radius:50%;'
    knob.appendChild(dot)
    el.appendChild(knob)
    return el
  }
  el.style.cssText = [
    'width:12px',
    'height:12px',
    'background:#ffffff',
    'border:2px solid var(--color-primary-600)',
    'border-radius:3px',
    `cursor:${cursorFor(kind)}`,
    'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
  ].join(';')
  return el
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  map: MapLibreMap
  features: GeoJSONFeature[]
}

export default function TransformControls({ map, features }: Props) {
  const { dataStore, uiStore } = useGeoStore()
  const selectedIds = useDataStore((s) => s.selectedIds)
  const transformActive = useUIStore((s) => s.transformActive)
  const setTransformDragging = useUIStore((s) => s.setTransformDragging)

  // Keep the features list in a ref so the drag handlers don't need to be
  // rebuilt when the features prop tick-updates during preview re-renders.
  const featuresRef = useRef<GeoJSONFeature[]>(features)
  featuresRef.current = features

  // Oriented bbox persists across drag operations — after a rotation the handles
  // stay aligned with the new axis (Figma-style).
  const [orientedBbox, setOrientedBbox] = useState<BboxGeom | null>(null)
  const orientedBboxRef = useRef<BboxGeom | null>(null)
  orientedBboxRef.current = orientedBbox
  const cumulativeAngle = useRef(0)

  // Reset oriented state when the selection identity changes.
  const selectionKey = selectedIds.join(',')
  useEffect(() => {
    setOrientedBbox(null)
    cumulativeAngle.current = 0
  }, [selectionKey])

  // Hold the *live* transformed features during a drag so mouseup can commit.
  const previewFeaturesRef = useRef<Feature<Geometry>[] | null>(null)
  const previewBboxRef = useRef<BboxGeom | null>(null)

  const markersRef = useRef<maplibregl.Marker[]>([])

  function clearMarkers() {
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
  }

  /** Patch the transformed features' geometries in elm-features (updateData diff). */
  function paintLiveSource(transformed: Feature<Geometry>[]) {
    const live = new Map<string, ElementEditorGeom>()
    for (const tf of transformed) live.set(String(tf.id ?? ''), tf.geometry as ElementEditorGeom)
    paintLiveGeometries(map, live)
  }

  /** Imperatively move the handle markers to match the current bbox. */
  function paintHandles(b: BboxGeom) {
    // markers are stored in a fixed order: 4 corners, 4 edges, 1 rotate
    const ms = markersRef.current
    if (ms.length !== 9) return
    for (let i = 0; i < 4; i++) ms[i].setLngLat(b.corners[i])
    for (let i = 0; i < 4; i++) ms[4 + i].setLngLat(b.edges[i])
    ms[8].setLngLat(b.rotateHandle)
  }

  const dragState = useRef<{
    type: 'rotate' | 'scale' | 'move'
    startPoint?: { x: number; y: number }
    moving?: boolean
    initialFeatures: Feature<Geometry>[]
    initialBbox: BboxGeom
    rotationAngle: number
    center?: [number, number]
    origin?: [number, number]
    startLngLat?: [number, number]
    edgeIndex?: number
    initialAngle?: number
  } | null>(null)

  // ── Rebuild markers when the selection changes / oriented bbox updates ─────
  useEffect(() => {
    if (!transformActive) return
    if (features.length === 0) return

    clearMarkers()

    const bboxGeom = orientedBboxRef.current ?? computeAxisAlignedBbox(features as unknown as Feature<Geometry>[])

    const cornerKinds: HandleKind[] = ['nw', 'ne', 'se', 'sw']
    const edgeKinds: HandleKind[] = ['n', 'e', 's', 'w']

    const newMarkers: maplibregl.Marker[] = []

    bboxGeom.corners.forEach((c, i) => {
      const el = makeHandleEl(cornerKinds[i])
      const marker = new maplibregl.Marker({ element: el, draggable: false })
        .setLngLat(c)
        .addTo(map)
      el.addEventListener('mousedown', (ev) => handleScaleStart(ev, i, false))
      newMarkers.push(marker)
    })

    bboxGeom.edges.forEach((c, i) => {
      const el = makeHandleEl(edgeKinds[i])
      const marker = new maplibregl.Marker({ element: el, draggable: false })
        .setLngLat(c)
        .addTo(map)
      el.addEventListener('mousedown', (ev) => handleScaleStart(ev, i, true))
      newMarkers.push(marker)
    })

    {
      const el = makeHandleEl('rotate')
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: false })
        .setLngLat(bboxGeom.rotateHandle)
        .addTo(map)
      el.addEventListener('mousedown', (ev) => handleRotateStart(ev))
      newMarkers.push(marker)
    }

    markersRef.current = newMarkers

    return () => {
      clearMarkers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformActive, selectionKey, orientedBbox, map])

  // ── Document-level mousemove / mouseup while a drag is active ──────────────
  useEffect(() => {
    function pixelToLngLat(e: { clientX: number; clientY: number }): [number, number] {
      const rect = map.getCanvasContainer().getBoundingClientRect()
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
      return [ll.lng, ll.lat]
    }

    // Transform + repaint at most once per animation frame with the latest
    // pointer event; mouseup flushes so the commit sees the final position.
    const moveFrame = rafThrottle(applyMove)
    // The last pointer position of the drag, re-applied when Shift / Alt change without a move.
    let lastPointer: { clientX: number; clientY: number } | null = null

    function onMouseMove(e: MouseEvent) {
      if (!dragState.current) return
      e.preventDefault()
      lastPointer = { clientX: e.clientX, clientY: e.clientY }
      moveFrame.schedule(e)
    }

    // Shift / Alt pressed or released mid-drag take effect at once (scale handles).
    function onModifierKey(e: KeyboardEvent) {
      if (e.key !== 'Shift' && e.key !== 'Alt') return
      if (dragState.current?.type !== 'scale' || !lastPointer) return
      e.preventDefault()
      moveFrame.schedule({ ...lastPointer, shiftKey: e.shiftKey, altKey: e.altKey })
    }

    function applyMove(e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) {
      const state = dragState.current
      if (!state) return

      const [lng, lat] = pixelToLngLat(e)
      const mode = dataStore.getState().geometryMode

      if (state.type === 'move') {
        if (!state.moving) {
          const rect = map.getCanvasContainer().getBoundingClientRect()
          if (Math.hypot(e.clientX - rect.left - state.startPoint!.x, e.clientY - rect.top - state.startPoint!.y) < MOVE_THRESHOLD_PX) return
          state.moving = true
          setTransformDragging(true)
        }
        const visual = mode === 'visual'
        const delta = moveDelta(state.startLngLat!, [lng, lat], visual)
        const moved = state.initialFeatures.map((f) => ({ ...f, geometry: offsetGeometry(f.geometry as ElementEditorGeom, delta, visual) as Geometry }))
        const b = state.initialBbox
        const previewBbox: BboxGeom = {
          corners: offsetPoints(b.corners, delta, visual),
          edges: offsetPoints(b.edges, delta, visual),
          center: offsetPoints([b.center], delta, visual)[0],
          rotateHandle: offsetPoints([b.rotateHandle], delta, visual)[0],
        }
        previewFeaturesRef.current = moved
        previewBboxRef.current = previewBbox
        paintLiveSource(moved)
        paintHandles(previewBbox)
      } else if (state.type === 'rotate') {
        const center = state.center!
        const latRatio = getMercatorLatCorrectionRatio(center[1])
        const dy = lat - center[1]
        const dx = mode === 'visual'
          ? (lng - center[0]) * latRatio
          : (lng - center[0])
        const currentAngle = Math.atan2(dy, dx)
        const dAngle = (currentAngle - state.initialAngle!) * (180 / Math.PI)

        const updated = state.initialFeatures.map(f =>
          mode === 'visual'
            ? (applyVisualTransform(f as unknown as GeoJSONFeature, center, 1, 1, dAngle) as unknown as Feature<Geometry>)
            : transformRotate(f, dAngle, { pivot: center }),
        )
        const previewBbox: BboxGeom = {
          corners: rotatePoints(state.initialBbox.corners, center, dAngle),
          edges: rotatePoints(state.initialBbox.edges, center, dAngle),
          center,
          rotateHandle: rotatePoints([state.initialBbox.rotateHandle], center, dAngle)[0],
        }
        previewFeaturesRef.current = updated
        previewBboxRef.current = previewBbox
        paintLiveSource(updated)
        paintHandles(previewBbox)
      } else if (state.type === 'scale') {
        const angle = state.rotationAngle
        const scale = scaleForDrag({
          initialBbox: state.initialBbox,
          origin: state.origin!,
          startLngLat: state.startLngLat!,
          edgeIndex: state.edgeIndex,
          rotationAngle: angle,
        }, [lng, lat], e.shiftKey, e.altKey)
        const next = applyScale(state.initialFeatures, state.initialBbox, scale, angle)
        previewFeaturesRef.current = next.features
        previewBboxRef.current = next.box
        paintLiveSource(next.features)
        paintHandles(next.box)
      }
    }

    function onMouseUp() {
      moveFrame.flush()
      const state = dragState.current
      if (!state) return

      const finalFeatures = previewFeaturesRef.current
      const finalBbox = previewBboxRef.current
      const wasRotation = state.type === 'rotate'

      dragState.current = null
      lastPointer = null
      previewFeaturesRef.current = null
      previewBboxRef.current = null
      map.dragPan.enable()
      setTransformDragging(false)

      // After a real move the browser follows this mouseup with a click on the canvas, which
      // (on empty box space) would clear the selection. Swallow that one click; it is
      // dispatched before the timeout runs. A press without a move stays a click.
      if (state.type === 'move' && finalFeatures) {
        const container = map.getContainer()
        const swallow = (ce: MouseEvent) => ce.stopPropagation()
        container.addEventListener('click', swallow, true)
        setTimeout(() => container.removeEventListener('click', swallow, true), 0)
      }

      if (finalFeatures) {
        dataStore.getState().takeSnapshot()
        // One commit: the transformed features plus (topo) the neighbours' shared vertices.
        dataStore.getState().updateFeatures(transformUpdates(dataStore.getState().features,
          finalFeatures.flatMap((f) => (f.id == null || f.id === '' ? [] : [{ id: String(f.id), geometry: f.geometry as ElementEditorGeom }])),
          uiStore.getState().topoEditEnabled))
      }

      if (finalBbox) {
        if (wasRotation) {
          const c = finalBbox.center
          const e = finalBbox.edges[1]
          const latRatio = getMercatorLatCorrectionRatio(c[1])
          const dx = (e[0] - c[0]) * latRatio
          const dy = e[1] - c[1]
          cumulativeAngle.current = Math.atan2(dy, dx) * (180 / Math.PI)
        }
        setOrientedBbox(finalBbox) // triggers marker rebuild
      }
    }

    function handleScaleStart(ev: MouseEvent, index: number, isEdge: boolean) {
      ev.preventDefault()
      ev.stopPropagation()
      map.dragPan.disable()

      const currentBbox = orientedBboxRef.current ?? computeAxisAlignedBbox(featuresRef.current as unknown as Feature<Geometry>[])
      const [lng, lat] = pixelToLngLat(ev)

      const origin = isEdge
        ? currentBbox.edges[(index + 2) % 4]
        : currentBbox.corners[(index + 2) % 4]

      dragState.current = {
        type: 'scale',
        initialFeatures: structuredClone(featuresRef.current) as unknown as Feature<Geometry>[],
        initialBbox: currentBbox,
        rotationAngle: cumulativeAngle.current,
        origin,
        startLngLat: [lng, lat],
        edgeIndex: isEdge ? index : undefined,
      }
      setTransformDragging(true)
    }

    function handleRotateStart(ev: MouseEvent) {
      ev.preventDefault()
      ev.stopPropagation()
      map.dragPan.disable()

      const currentBbox = orientedBboxRef.current ?? computeAxisAlignedBbox(featuresRef.current as unknown as Feature<Geometry>[])
      const center = currentBbox.center
      const [lng, lat] = pixelToLngLat(ev)
      const mode = dataStore.getState().geometryMode
      const latRatio = getMercatorLatCorrectionRatio(center[1])
      const dy = lat - center[1]
      const dx = mode === 'visual'
        ? (lng - center[0]) * latRatio
        : (lng - center[0])

      dragState.current = {
        type: 'rotate',
        initialFeatures: structuredClone(featuresRef.current) as unknown as Feature<Geometry>[],
        initialBbox: currentBbox,
        rotationAngle: cumulativeAngle.current,
        center,
        initialAngle: Math.atan2(dy, dx),
      }
      setTransformDragging(true)
    }

    // A plain press inside the box (on a selected feature, or the empty space around it) and
    // drag moves the whole selection, as on Leaflet. Capture phase on the map container runs
    // before MapLibre's own handlers; stopping the event there keeps drag-pan, box select and
    // the feature drag in FeatureInteractionLayer out of it. Handles (markers) start their
    // own drags; Shift (toggle / box select) and Cmd/Alt (move / duplicate drag) keep theirs.
    function onContainerMouseDown(ev: MouseEvent) {
      if (dragState.current || ev.button !== 0) return
      if (ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return
      if (ev.target !== map.getCanvas()) return
      const ui = uiStore.getState()
      if (!ui.transformActive || ui.readonly || ui.editingMode !== 'none' || ui.vertexEditActive) return
      const feats = featuresRef.current
      if (feats.length === 0) return
      const box = orientedBboxRef.current ?? computeAxisAlignedBbox(feats as unknown as Feature<Geometry>[])
      const rect = map.getCanvasContainer().getBoundingClientRect()
      const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
      if (!pointInBox(p, box.corners.map((c) => map.project(c)), BOX_GRAB_TOLERANCE_PX)) return
      ev.preventDefault()
      ev.stopPropagation()
      map.dragPan.disable()
      dragState.current = {
        type: 'move',
        initialFeatures: structuredClone(feats) as unknown as Feature<Geometry>[],
        initialBbox: box,
        rotationAngle: cumulativeAngle.current,
        startLngLat: pixelToLngLat(ev),
        startPoint: p,
        moving: false,
      }
    }
    const container = map.getContainer()
    container.addEventListener('mousedown', onContainerMouseDown, true)

    // Expose the start handlers to the marker setup (closure over this effect)
    startersRef.current.handleScaleStart = handleScaleStart
    startersRef.current.handleRotateStart = handleRotateStart

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onModifierKey)
    document.addEventListener('keyup', onModifierKey)
    return () => {
      moveFrame.cancel()
      container.removeEventListener('mousedown', onContainerMouseDown, true)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onModifierKey)
      document.removeEventListener('keyup', onModifierKey)
    }
  }, [map, dataStore, uiStore, setTransformDragging])

  // Shared reference so the marker-setup effect and the document-level effect
  // can both see the latest start handlers without ordering dependencies.
  const startersRef = useRef<{
    handleScaleStart: (ev: MouseEvent, index: number, isEdge: boolean) => void
    handleRotateStart: (ev: MouseEvent) => void
  }>({
    handleScaleStart: () => {},
    handleRotateStart: () => {},
  })

  // Adapters — marker mousedowns route through the starters ref so the live
  // closures (with up-to-date state) run.
  function handleScaleStart(ev: MouseEvent, index: number, isEdge: boolean) {
    startersRef.current.handleScaleStart(ev, index, isEdge)
  }
  function handleRotateStart(ev: MouseEvent) {
    startersRef.current.handleRotateStart(ev)
  }

  return null
}
