// Leaflet fires a synthesized `click` after mousedown+mouseup even for a drag when
// `dragging.disable()` is set (the Map.Drag handler that normally sets `_moved` is
// off). For freehand, commit happens on mouseup — so the trailing click reaches
// MapClickHandler with editingMode already 'none' and wipes the just-set selection.
// A microtask flag doesn't work here (the click event is a separate macrotask that
// fires after microtasks drain), so we use a short timestamp window instead.
let _stamp = 0

export function markFreehandCommit() {
  _stamp = Date.now()
}

export function isFreehandCommitConsumed() {
  return Date.now() - _stamp < 200
}
