import type { LeafletMouseEvent } from 'leaflet'
import { useMapEvents } from 'react-leaflet'

type MapClickHandlerProps = {
  onMapClick: (e: LeafletMouseEvent) => void
}

export function MapClickHandler({ onMapClick }: MapClickHandlerProps) {
  useMapEvents({ click: onMapClick })
  return null
}
