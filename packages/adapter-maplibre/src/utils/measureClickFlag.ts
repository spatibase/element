// MapLibre fires both the path/layer click and the map-level click for the same
// pointer event when querying with queryRenderedFeatures. This flag is set
// synchronously by a measurement segment's click handler so that DrawingLayer's
// map-click handler can skip addMeasurePoint that tick.
let _consumed = false

export function markMeasureClick() {
  _consumed = true
  Promise.resolve().then(() => { _consumed = false })
}

export function isMeasureClickConsumed() { return _consumed }
