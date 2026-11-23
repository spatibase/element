import { memo, useRef, useEffect, useState, useCallback } from 'react'
import { Marker, Polyline, Polygon, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import { transformRotate } from '@turf/transform-rotate'
import { featureCollection } from '@turf/helpers'
import { bbox } from '@turf/bbox'
import type { Feature, Geometry, Position } from 'geojson'
import type { Geometry as ElementEditorGeom } from '@element-editor/core'
import { useAccentPalette } from '@element-editor/ui'
import { useHandleVars } from './featureLayers/shared'
import { applyVisualTransform, getMercatorLatCorrectionRatio, toRadians, project, unproject, transformUpdates, offsetGeometry, mapPositions } from '@element-editor/core/internal'


function transformIcon(type: 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | 'rotate') {
  const isResize = type !== 'rotate'
  let cursorClass = ''
  if (type === 'nw' || type === 'se') cursorClass = 'cursor-nwse-resize'
  else if (type === 'ne' || type === 'sw') cursorClass = 'cursor-nesw-resize'
  else if (type === 'n' || type === 's') cursorClass = 'cursor-ns-resize'
  else if (type === 'e' || type === 'w') cursorClass = 'cursor-ew-resize'

  const rotateCursor = `url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGcgZmlsdGVyPSJkcm9wLXNoYWRvdygwIDAgMXB4IHdoaXRlKSBkcm9wLXNoYWRvdygwIDAgMXB4IHdoaXRlKSI+PHBhdGggZD0iTTIxLjUgMnY2aC02TTIxLjM0IDE1LjU3YTEwIDEwIDAgMSAxLS41OS05LjVsMS4yNSAxLjkzIi8+PC9nPjwvc3ZnPg==') 12 12, grab`

  return L.divIcon({
    className: '',
    html: isResize
      ? `<div class="w-3 h-3 bg-white border-2 shadow-md rounded-sm ${cursorClass} hover:scale-125 transition-transform" style="border-color:var(--elm-handle,var(--color-primary-600))"></div>`
      : `<div class="group relative flex items-center justify-center">
           <div class="w-0.5 h-6" style="background:var(--elm-handle,var(--color-primary-600))"></div>
           <div
             class="absolute -top-3 w-4 h-4 bg-white border-2 shadow-md rounded-full hover:scale-125 transition-transform flex items-center justify-center"
             style="cursor: ${rotateCursor}; border-color:var(--elm-handle,var(--color-primary-600));"
           >
             <div class="w-1.5 h-1.5 rounded-full" style="background:var(--elm-handle,var(--color-primary-600))"></div>
           </div>
         </div>`,
    iconSize: isResize ? [12, 12] : [16, 32],
    iconAnchor: isResize ? [6, 6] : [8, 32],
  })
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface BboxGeom {
  corners: [number, number][]
  edges: [number, number][]
  center: [number, number]
  rotateHandle: [number, number]
}

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
 * This is the correct transform for resizing when the bbox is rotated.
 * When angleDeg=0 this reduces to a plain axis-aligned scale.
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
    // un-rotate into local frame
    const ux = dx * cosA + dy * sinA
    const uy = -dx * sinA + dy * cosA
    // scale in local frame
    const sx = ux * scaleX
    const sy = uy * scaleY
    // re-rotate back
    const rx = sx * cosA - sy * sinA
    const ry = sx * sinA + sy * cosA
    return [ox + rx / latRatio, oy + ry] as [number, number]
  })
}

/**
 * Scale a feature uniformly in projected (Mercator) space so shapes are preserved visually.
 * Regular applyRotatedScale uses a single latRatio at the origin which causes Mercator
 * distortion (eggs, trapezoids) when features span many degrees of latitude.
 * This function projects each vertex individually, scales in projected space, then unprojects.
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

/** Scale bbox points uniformly in projected (Mercator) space. */
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

/** Apply rotated-scale transform to all coordinates in a GeoJSON feature. */
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

/** Translation delta from `from` to `to`: projected metres in visual mode, degrees otherwise. */
function moveDelta(from: [number, number], to: [number, number], visual: boolean): [number, number] {
  if (!visual) return [to[0] - from[0], to[1] - from[1]]
  const a = project(from), b = project(to)
  return [b[0] - a[0], b[1] - a[1]]
}

function offsetPoints(points: [number, number][], delta: [number, number], visual: boolean): [number, number][] {
  return (offsetGeometry({ type: 'MultiPoint', coordinates: points }, delta, visual) as { coordinates: [number, number][] }).coordinates
}

/**
 * Whether container point `p` is inside the box `ring` or within `tolerance` px of its outline
 * (so a flat box, e.g. around a horizontal line, can still be grabbed).
 */
function pointInBox(p: L.Point, ring: L.Point[], tolerance: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    if (L.LineUtil.pointToSegmentDistance(p, a, b) <= tolerance) return true
  }
  return inside
}

/** Pixels the pointer must travel before a press inside the box becomes a move (a click stays a click). */
const MOVE_THRESHOLD_PX = 3
/** A press this close outside the box outline still grabs it (half the 16 px line hit band). */
const BOX_GRAB_TOLERANCE_PX = 8

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TransformControls = memo(function TransformControls() {
  const map = useMap()
  const accent = useAccentPalette(map.getContainer())[500]
  const { dataStore, uiStore } = useGeoStore()
  const selectedIds = useDataStore((s) => s.selectedIds)
  const features = useDataStore((s) => s.features)
  const transformActive = useUIStore((s) => s.transformActive)
  const setTransformDragging = useUIStore((s) => s.setTransformDragging)
  const handleColor = useHandleVars(transformActive && selectedIds.length === 1 ? features.find((f) => f.id === selectedIds[0]) : undefined, map.getContainer())
  const accent500 = handleColor ?? accent // the box outline follows the handles

  // Live preview during drag
  const [previewFeatures, setPreviewFeatures] = useState<Feature<Geometry>[] | null>(null)
  const [previewBbox, setPreviewBbox] = useState<BboxGeom | null>(null)
  const previewFeaturesRef = useRef<Feature<Geometry>[] | null>(null)
  const previewBboxRef = useRef<BboxGeom | null>(null)
  previewFeaturesRef.current = previewFeatures
  previewBboxRef.current = previewBbox

  // Persists across drag operations — gives Figma-style rotated bbox
  const [orientedBbox, setOrientedBbox] = useState<BboxGeom | null>(null)
  const cumulativeAngle = useRef(0)

  // Reset oriented state when selection changes
  const selectionKey = selectedIds.join(',')
  useEffect(() => {
    setOrientedBbox(null)
    cumulativeAngle.current = 0
  }, [selectionKey])

  const dragState = useRef<{
    type: 'rotate' | 'scale' | 'move'
    initialFeatures: Feature<Geometry>[]
    initialBbox: BboxGeom
    rotationAngle: number // cumulative angle at drag start
    center?: Position
    origin?: [number, number]
    startLatLng?: [number, number]
    edgeIndex?: number
    initialAngle?: number
    /** move: press point in container pixels; `moving` once it passed MOVE_THRESHOLD_PX. */
    startPoint?: L.Point
    moving?: boolean
  } | null>(null)

  const pixelToLatLng = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = map.getContainer().getBoundingClientRect()
    return map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top))
  }, [map])

  useEffect(() => {
    // The last pointer position of the drag, re-applied when Shift / Alt change without a move.
    let lastPointer: { clientX: number; clientY: number } | null = null

    function onMouseMove(e: MouseEvent) {
      if (!dragState.current) return
      e.preventDefault()
      lastPointer = { clientX: e.clientX, clientY: e.clientY }
      applyPointer(e)
    }

    // Shift / Alt pressed or released mid-drag take effect at once (scale handles).
    function onModifierKey(e: KeyboardEvent) {
      if (e.key !== 'Shift' && e.key !== 'Alt') return
      if (dragState.current?.type !== 'scale' || !lastPointer) return
      e.preventDefault()
      applyPointer({ ...lastPointer, shiftKey: e.shiftKey, altKey: e.altKey })
    }

    function applyPointer(e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) {
      if (!dragState.current) return
      const latlng = pixelToLatLng(e)
      const lat = latlng.lat
      const lng = latlng.lng
      const state = dragState.current
      const mode = dataStore.getState().geometryMode

      if (state.type === 'move') {
        if (!state.moving) {
          const rect = map.getContainer().getBoundingClientRect()
          if (state.startPoint!.distanceTo(L.point(e.clientX - rect.left, e.clientY - rect.top)) < MOVE_THRESHOLD_PX) return
          state.moving = true
          setTransformDragging(true)
        }
        const visual = mode === 'visual'
        const delta = moveDelta(state.startLatLng!, [lng, lat], visual)
        setPreviewFeatures(state.initialFeatures.map(f => ({ ...f, geometry: offsetGeometry(f.geometry as ElementEditorGeom, delta, visual) as Geometry })))
        setPreviewBbox({
          corners: offsetPoints(state.initialBbox.corners, delta, visual),
          edges: offsetPoints(state.initialBbox.edges, delta, visual),
          center: offsetPoints([state.initialBbox.center], delta, visual)[0],
          rotateHandle: offsetPoints([state.initialBbox.rotateHandle], delta, visual)[0],
        })
      } else if (state.type === 'rotate') {
        const latRatio = getMercatorLatCorrectionRatio(state.center![1])
        const dy = lat - state.center![1]
        const dx = mode === 'visual'
          ? (lng - state.center![0]) * latRatio
          : (lng - state.center![0])
        const currentAngle = Math.atan2(dy, dx)
        const dAngle = (currentAngle - state.initialAngle!) * (180 / Math.PI)

        const updated = state.initialFeatures.map(f =>
          mode === 'visual'
            ? applyVisualTransform(f, state.center! as [number, number], 1, 1, dAngle)
            : transformRotate(f, dAngle, { pivot: state.center! }),
        )
        setPreviewFeatures(updated)

        // Rotate the oriented bbox by the same delta
        const pivot = state.center! as [number, number]
        setPreviewBbox({
          corners: rotatePoints(state.initialBbox.corners, pivot, dAngle),
          edges: rotatePoints(state.initialBbox.edges, pivot, dAngle),
          center: pivot,
          rotateHandle: rotatePoints([state.initialBbox.rotateHandle], pivot, dAngle)[0],
        })
      } else if (state.type === 'scale') {
        const angle = state.rotationAngle
        const scale = scaleForDrag({
          initialBbox: state.initialBbox,
          origin: state.origin!,
          startLngLat: state.startLatLng!,
          edgeIndex: state.edgeIndex,
          rotationAngle: angle,
        }, [lng, lat], e.shiftKey, e.altKey)
        const next = applyScale(state.initialFeatures, state.initialBbox, scale, angle)
        setPreviewFeatures(next.features)
        setPreviewBbox(next.box)
      }
    }

    function onMouseUp() {
      if (!dragState.current) return
      const finalFeatures = previewFeaturesRef.current
      const finalBbox = previewBboxRef.current
      const wasRotation = dragState.current.type === 'rotate'
      const wasMove = dragState.current.type === 'move'
      const prevAngle = dragState.current.rotationAngle

      dragState.current = null
      map.dragging.enable()
      setTransformDragging(false)

      // The browser follows this mouseup with a click on the press/release common ancestor (the
      // map when the press was on empty box space, or on a handle re-rendered meanwhile), which
      // would exit transform and clear the selection. Swallow that one click after any handle
      // press and after a real move (a plain click inside the box stays a click); it is
      // dispatched before the timeout runs.
      if (!wasMove || finalFeatures) {
        const container = map.getContainer()
        const swallow = (ce: MouseEvent) => ce.stopPropagation()
        container.addEventListener('click', swallow, true)
        setTimeout(() => container.removeEventListener('click', swallow, true), 0)
      }

      if (finalFeatures) {
        // The store isn't touched during the drag (preview only), so one snapshot here is the whole
        // gesture's undo step — and only once it really moved (a press without a move is no step).
        dataStore.getState().takeSnapshot()
        // One commit: the transformed features plus (topo) the neighbours' shared vertices.
        dataStore.getState().updateFeatures(transformUpdates(dataStore.getState().features,
          finalFeatures.map(f => ({ id: String(f.id), geometry: f.geometry as ElementEditorGeom })),
          uiStore.getState().topoEditEnabled))
      }

      // Persist the oriented bbox so it stays rotated/scaled
      if (finalBbox) {
        setOrientedBbox(finalBbox)
        if (wasRotation) {
          // Compute new cumulative angle from the bbox orientation
          // The angle is the direction from center to the "east" edge (index 1)
          const c = finalBbox.center
          const e = finalBbox.edges[1] // east edge in rotated frame
          const latRatio = getMercatorLatCorrectionRatio(c[1])
          const dx = (e[0] - c[0]) * latRatio
          const dy = e[1] - c[1]
          cumulativeAngle.current = Math.atan2(dy, dx) * (180 / Math.PI)
        }
        // Scale doesn't change the cumulative angle
      }

      setPreviewFeatures(null)
      setPreviewBbox(null)
      lastPointer = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onModifierKey)
    document.addEventListener('keyup', onModifierKey)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onModifierKey)
      document.removeEventListener('keyup', onModifierKey)
    }
  }, [map, pixelToLatLng, setTransformDragging])

  // What a press inside the box would move (set below while the box is shown).
  const moveTargetRef = useRef<{ box: BboxGeom; features: Feature<Geometry>[] } | null>(null)
  moveTargetRef.current = null

  // A plain press inside the box (on the feature or the empty space around it) and drag
  // moves the selection. Handles are markers (bubblingMouseEvents: false) and start their
  // own drag; Shift (toggle/box select) and Cmd/Alt (move/duplicate drag) keep their
  // handlers. Disabling map dragging here, before Leaflet's Draggable sees this mousedown
  // on the container, is what stops the map panning.
  useMapEvents({
    mousedown(e) {
      const target = moveTargetRef.current
      const ev = e.originalEvent
      if (!target || dragState.current || ev.button !== 0) return
      if (ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return
      const ui = uiStore.getState()
      if (ui.readonly || ui.editingMode !== 'none' || ui.vertexEditActive) return
      if ((ev.target as Element | null)?.closest?.('.leaflet-marker-icon')) return
      const ring = target.box.corners.map(c => map.latLngToContainerPoint(toLeaflet(c)))
      if (!pointInBox(e.containerPoint, ring, BOX_GRAB_TOLERANCE_PX)) return
      ev.preventDefault()
      map.dragging.disable()
      dragState.current = {
        type: 'move',
        initialFeatures: structuredClone(target.features),
        initialBbox: target.box,
        rotationAngle: cumulativeAngle.current,
        startLatLng: [e.latlng.lng, e.latlng.lat],
        startPoint: e.containerPoint,
        moving: false,
      }
    },
  })

  if (!transformActive || selectedIds.length === 0) return null

  const selectedSet = new Set(selectedIds)
  const targetFeatures = features.filter(f => selectedSet.has(f.id))
  if (targetFeatures.length === 0) return null

  // Priority: live preview → persisted oriented → fresh axis-aligned
  const bboxGeom = previewBbox || orientedBbox || computeAxisAlignedBbox(targetFeatures as Feature<Geometry>[])
  if (!previewBbox) moveTargetRef.current = { box: bboxGeom, features: targetFeatures as Feature<Geometry>[] }
  const { corners, edges, rotateHandle: rotateHandlePos } = bboxGeom
  const rectPositions = [...corners, corners[0]].map(toLeaflet)

  function startDrag(e: L.LeafletMouseEvent) {
    e.originalEvent?.preventDefault?.()
    e.originalEvent?.stopPropagation?.()
    map.dragging.disable()
  }

  function handleRotateStart(e: L.LeafletMouseEvent) {
    startDrag(e)

    const currentBbox = orientedBbox || computeAxisAlignedBbox(targetFeatures as Feature<Geometry>[])
    const combinedCenter = currentBbox.center

    const latlng = pixelToLatLng(e.originalEvent)
    const mode = dataStore.getState().geometryMode
    const latRatio = getMercatorLatCorrectionRatio(combinedCenter[1])
    const dy = latlng.lat - combinedCenter[1]
    const dx = mode === 'visual'
      ? (latlng.lng - combinedCenter[0]) * latRatio
      : (latlng.lng - combinedCenter[0])

    dragState.current = {
      type: 'rotate',
      initialFeatures: structuredClone(targetFeatures),
      initialBbox: currentBbox,
      rotationAngle: cumulativeAngle.current,
      center: combinedCenter,
      initialAngle: Math.atan2(dy, dx),
    }
    setTransformDragging(true)
  }

  function handleScaleStart(e: L.LeafletMouseEvent, index: number, isEdge: boolean) {
    startDrag(e)

    const currentBbox = orientedBbox || computeAxisAlignedBbox(targetFeatures as Feature<Geometry>[])
    const latlng = pixelToLatLng(e.originalEvent)

    const origin = isEdge
      ? currentBbox.edges[(index + 2) % 4]
      : currentBbox.corners[(index + 2) % 4]

    dragState.current = {
      type: 'scale',
      initialFeatures: structuredClone(targetFeatures),
      initialBbox: currentBbox,
      rotationAngle: cumulativeAngle.current,
      origin,
      startLatLng: [latlng.lng, latlng.lat],
      edgeIndex: isEdge ? index : undefined,
    }
    setTransformDragging(true)
  }

  return (
    <>
      {previewFeatures?.map(f => {
        if (f.geometry.type === 'Polygon') {
          return (
            <Polygon key={f.id} positions={f.geometry.coordinates.map((r: Position[]) => r.map(toLeaflet))}
              pathOptions={{ color: accent500, weight: 2, fillOpacity: 0.1, dashArray: '5 5' }} interactive={false} />
          )
        }
        if (f.geometry.type === 'MultiPolygon') {
          return (
            <Polygon key={f.id} positions={f.geometry.coordinates.map((poly: Position[][]) => poly.map((r: Position[]) => r.map(toLeaflet)))}
              pathOptions={{ color: accent500, weight: 2, fillOpacity: 0.1, dashArray: '5 5' }} interactive={false} />
          )
        }
        if (f.geometry.type === 'LineString') {
          return (
            <Polyline key={f.id} positions={f.geometry.coordinates.map(toLeaflet)}
              pathOptions={{ color: accent500, weight: 2, dashArray: '5 5' }} interactive={false} />
          )
        }
        if (f.geometry.type === 'MultiLineString') {
          return (
            <Polyline key={f.id} positions={f.geometry.coordinates.map((line: Position[]) => line.map(toLeaflet))}
              pathOptions={{ color: accent500, weight: 2, dashArray: '5 5' }} interactive={false} />
          )
        }
        return null
      })}

      <Polyline positions={rectPositions}
        pathOptions={{ color: accent500, weight: 1.5, dashArray: '4 4', fill: false }} interactive={false} />

      {corners.map((c, i) => (
        <Marker key={`corner-${i}`} position={toLeaflet(c)}
          icon={transformIcon((['nw', 'ne', 'se', 'sw'] as const)[i])}
          draggable={false}
          eventHandlers={{ mousedown: (e) => handleScaleStart(e, i, false) }} />
      ))}

      {edges.map((ePos, i) => (
        <Marker key={`edge-${i}`} position={toLeaflet(ePos)}
          icon={transformIcon((['n', 'e', 's', 'w'] as const)[i])}
          draggable={false}
          eventHandlers={{ mousedown: (e) => handleScaleStart(e, i, true) }} />
      ))}

      <Marker position={toLeaflet(rotateHandlePos)} icon={transformIcon('rotate')}
        draggable={false}
        eventHandlers={{ mousedown: (e) => handleRotateStart(e) }} />
    </>
  )
})
