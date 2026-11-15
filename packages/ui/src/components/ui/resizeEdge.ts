// Resize handles on panel edges: a 4px grab area showing a 2px neutral line on
// hover and while dragging (`data-dragging`, set by startDragShield). Not tied
// to the accent colour.
const line = 'after:absolute after:transition-colors hover:after:bg-elm-focus-ring data-[dragging]:after:bg-elm-focus-ring'

/** Vertical edge on a panel's left side (col-resize). */
export const resizeEdgeLeft = `absolute left-0 top-0 h-full w-1 z-20 cursor-col-resize after:inset-y-0 after:left-0 after:w-0.5 ${line}`

/** Horizontal edge on a panel's top side (row-resize). */
export const resizeEdgeTop = `absolute top-0 left-0 right-0 h-1 z-10 cursor-row-resize after:inset-x-0 after:top-0 after:h-0.5 ${line}`
