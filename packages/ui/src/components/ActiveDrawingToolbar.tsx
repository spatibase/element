import { CircleHalfTilt, ArrowsHorizontal, Hexagon } from '@phosphor-icons/react'
import { useUIStore } from '../store/StoreContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { EditToolbarBtn, ToolbarDivider } from './ui/EditToolbarBtn'
import { Kbd, KbdInvert } from './ui/Kbd'

// Same hover as the EditToolbarBtn icons beside them: one step stronger than the
// shared ghost Button, and no colour transition.
const ACTION_BTN = 'h-8 px-3 rounded-elm-control text-sm flex items-center justify-center gap-1.5 active:scale-[0.95]'

export default function ActiveDrawingToolbar() {
  const { ui } = useElementEditorConfig()
  const editingMode = useUIStore((s) => s.editingMode)
  const lineInProgress = useUIStore((s) => s.lineInProgress)
  const polygonInProgress = useUIStore((s) => s.polygonInProgress)
  const routeWaypoints = useUIStore((s) => s.routeWaypoints)
  const routeLoading = useUIStore((s) => s.routeLoading)
  const commitLine = useUIStore((s) => s.commitLine)
  const commitPolygon = useUIStore((s) => s.commitPolygon)
  const commitRoute = useUIStore((s) => s.commitRoute)
  const commitSliceShape = useUIStore((s) => s.commitSliceShape)
  const commitCutHole = useUIStore((s) => s.commitCutHole)
  const cancelDrawing = useUIStore((s) => s.cancelDrawing)

  const circleCenter = useUIStore((s) => s.circleCenter)
  const rectCorner = useUIStore((s) => s.rectCorner)
  const freehandPoints = useUIStore((s) => s.freehandPoints)
  const freehandClosed = useUIStore((s) => s.freehandClosed)
  const setFreehandClosed = useUIStore((s) => s.setFreehandClosed)
  const measurePoints = useUIStore((s) => s.measurePoints)
  const measureMode = useUIStore((s) => s.measureMode)
  const setMeasureMode = useUIStore((s) => s.setMeasureMode)

  const isDrawingLine = editingMode === 'draw-line' || editingMode === 'slice-shape'
  const isDrawingPolygon = editingMode === 'draw-polygon' || editingMode === 'cut-hole'
  const isDrawingRoute = editingMode === 'draw-route'
  const isDrawingCircle = editingMode === 'draw-circle'
  const isDrawingRect = editingMode === 'draw-rect'
  const isDrawingFreehand = editingMode === 'draw-freehand'
  const isPlacingPoint = editingMode === 'place-point'
  const isMeasuring = editingMode === 'measure'

  const isPickingShape = editingMode === 'pick-shape'
  const isDrawing = isDrawingLine || isDrawingPolygon || isDrawingRoute || isDrawingCircle || isDrawingRect || isDrawingFreehand || isPlacingPoint

  if (!isDrawing && !isMeasuring && !isPickingShape) return null

  const hasProgress = lineInProgress.length > 0 || polygonInProgress.length > 0 || !!circleCenter || !!rectCorner || routeWaypoints.length > 0 || freehandPoints.length > 0 || measurePoints.length > 0


  function handleFinish() {
    if (editingMode === 'slice-shape') {
      if (lineInProgress.length < 2) return
      commitSliceShape()
    } else if (editingMode === 'cut-hole') {
      if (polygonInProgress.length < 3) return
      commitCutHole()
    } else if (isDrawingLine) {
      if (lineInProgress.length < 2) return
      commitLine({})
    } else if (isDrawingPolygon) {
      if (polygonInProgress.length < 3) return
      commitPolygon({})
    } else if (isDrawingRoute) {
      if (routeWaypoints.length < 2) return
      commitRoute()
    }
  }

  const canFinish = isDrawingLine ? lineInProgress.length >= 2
    : isDrawingPolygon ? polygonInProgress.length >= 3
    : isDrawingRoute ? routeWaypoints.length >= 2 && !routeLoading
    : false

  const hintText = isPlacingPoint
    ? 'Click to place a point'
    : editingMode === 'draw-line'
      ? (lineInProgress.length === 0 ? 'Click to place the first point' : 'Click to add points · Double-click to finish · ⌫ undo last')
    : editingMode === 'draw-polygon'
      ? (polygonInProgress.length === 0 ? 'Click to place the first point' : polygonInProgress.length < 3 ? 'Click to continue · ⌫ undo last' : 'Click to add points · Double-click to close · ⌫ undo last')
    : isDrawingRoute
      ? (routeWaypoints.length === 0 ? 'Click to place the first waypoint' : 'Click to add waypoints · ⌫ undo last')
    : isDrawingCircle
      ? 'Click and drag to size'
    : isDrawingRect
      ? 'Click and drag to size · Hold Shift for square'
    : isDrawingFreehand
      ? 'Click and drag to draw'
    : editingMode === 'slice-shape'
      ? (lineInProgress.length === 0 ? 'Draw a line across the shape to slice it' : 'Click to add points · Double-click to cut · ⌫ undo last')
    : editingMode === 'cut-hole'
      ? (polygonInProgress.length === 0 ? 'Draw a shape inside to cut a hole' : polygonInProgress.length < 3 ? 'Click to continue · ⌫ undo last' : 'Click to add points · Double-click to cut · ⌫ undo last')
    : isMeasuring
      ? (measurePoints.length === 0
          ? 'Click to start measuring'
          : 'Click to add points · Double-click to finish · ⌫ undo last')
    : isPickingShape
      ? 'Click anywhere to import a shape from the map'
    : null

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 max-w-full bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm rounded-elm px-2 py-2 pointer-events-auto">
        {isMeasuring && (
          <>
            <EditToolbarBtn
              active={measureMode === 'distance'}
              onClick={() => setMeasureMode('distance')}
              label="Measure distance"
            >
              <ArrowsHorizontal size={24} />
            </EditToolbarBtn>
            <EditToolbarBtn
              active={measureMode === 'area'}
              onClick={() => setMeasureMode('area')}
              label="Measure area"
            >
              <Hexagon size={24} />
            </EditToolbarBtn>
          </>
        )}
        {editingMode === 'draw-freehand' && (
          <EditToolbarBtn
            active={freehandClosed}
            onClick={() => setFreehandClosed(!freehandClosed)}
            label="Closed shape"
          >
            <CircleHalfTilt size={24} weight={freehandClosed ? 'fill' : 'regular'} />
          </EditToolbarBtn>
        )}
      {(isMeasuring || editingMode === 'draw-freehand') && <ToolbarDivider />}

      {ui.hints && hintText && (
        <span className="text-sm text-elm-text-muted px-2">{hintText}</span>
      )}

      {ui.hints && hintText && <ToolbarDivider />}

      {canFinish && (
        <button
          type="button"
          onClick={handleFinish}
          className={`${ACTION_BTN} shadow-sm bg-primary-500 text-white hover:bg-primary-600`}
        >
          {isDrawingRoute ? 'Save route' : editingMode === 'slice-shape' ? 'Slice' : editingMode === 'cut-hole' ? 'Cut' : 'Finish'}
          <KbdInvert>↵</KbdInvert>
        </button>
      )}

      <button
        type="button"
        onClick={cancelDrawing}
        className={`${ACTION_BTN} text-(--elm-text-muted,var(--color-gray-600)) dark:text-(--elm-text-muted,var(--color-gray-400)) hover:bg-elm-control-hover`}
      >
        {hasProgress ? 'Cancel' : 'Exit'}
        <Kbd>Esc</Kbd>
      </button>
    </div>
  )
}
