// A drag-drawn shape (freehand, rect, circle) commits on mouseup. MapLibre still
// fires a `click` when the pointer ends within its click tolerance of where it went
// down (a freehand loop closed on its start, a click-placed circle). With
// editingMode already back to 'none', FeatureInteractionLayer's click handler
// would clear the new shape's selection. Same 200 ms timestamp window as
// adapter-leaflet's freehandCommitFlag.
let _stamp = 0

export function markFreehandCommit() {
  _stamp = Date.now()
}

export function isFreehandCommitConsumed() {
  return Date.now() - _stamp < 200
}
