// Leaflet fires a trailing `click` after a modifier drag (Cmd/Alt) completes.
// If the modifier is released before the click fires, e.originalEvent.metaKey/altKey
// is already false and the drawing guard misses it — causing an unwanted vertex or
// shape commit.  We use a short timestamp window (identical to freehandCommitFlag)
// to suppress the trailing click.
let _stamp = 0

export function markModifierDragEnd() {
  _stamp = Date.now()
}

export function isModifierDragConsumed() {
  return Date.now() - _stamp < 200
}
