// Leaflet always fires both path-click AND map-click for the same event.
// This flag is set synchronously by a measurement's click handler so that
// DrawingLayer's map-click handler can skip addMeasurePoint that tick.
let _consumed = false

export function markMeasureClick() {
  _consumed = true
  Promise.resolve().then(() => { _consumed = false })
}

export function isMeasureClickConsumed() { return _consumed }
