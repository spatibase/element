// MapLibre fires a trailing `click` after a Cmd/Alt-modifier drag mouseup.
// If the user releases the modifier before the click fires (common: lift the
// finger off Cmd before lifting the mouse), `e.originalEvent.metaKey/altKey`
// is already false and the live guard in DrawingLayer misses it — the click
// then drops a stray vertex or shape on the map. Same shape as
// `measureClickFlag.ts`: a 200 ms timestamp window the issuer marks at the
// end of its drag and the suppressee checks at the top of its click handler.
let _stamp = 0

export function markModifierDragEnd() {
  _stamp = Date.now()
}

export function isModifierDragConsumed() {
  return Date.now() - _stamp < 200
}
