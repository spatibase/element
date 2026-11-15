import { useMap, useMapEvents } from 'react-leaflet'
import { useGeoStore, useUIStore } from '../store/StoreContext'
import { findSnapPoint } from '../utils/snapping'
import { Marker } from 'react-leaflet'
import { divIcon, type LeafletMouseEvent } from 'leaflet'
import { toLeaflet } from '../utils/geojson'
import { useEffect, useRef, useState } from 'react'
import { rafThrottle } from '../utils/rafThrottle'
import { freshFeatureId } from '../utils/freshFeature'

function snapIcon(isVertex: boolean) {
  return divIcon({
    className: '',
    html: `<div class="w-3 h-3 ${isVertex ? 'bg-primary-500 rounded-full' : 'bg-primary-400 rotate-45 rounded-sm'} border-2 border-white shadow-md"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}

export default function SnapController() {
  const { dataStore, uiStore } = useGeoStore()
  const snapEnabled = useUIStore((s) => s.snapEnabled)
  const snappedCoord = useUIStore((s) => s.snappedCoord)
  const editingMode = useUIStore((s) => s.editingMode)
  const vertexEditActive = useUIStore((s) => s.vertexEditActive)
  
  const isSnappingRelevant = snapEnabled && (editingMode !== 'none' || vertexEditActive)
  
  const snapInfoRef = useRef<{ isVertex: boolean } | null>(null)
  const map = useMap()

  function updateSnap(e: LeafletMouseEvent) {
    const modKey = e.originalEvent.metaKey || e.originalEvent.ctrlKey
    if (!isSnappingRelevant || modKey) {
      if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
      return
    }

    const target = e.originalEvent?.target as HTMLElement | null
    if (target?.closest?.('.elm-midpoint-marker')) {
      if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
      return
    }

    const features = dataStore.getState().features
    // Never snap to a feature just added under the still cursor (freshFeature.ts).
    const fresh = freshFeatureId()
    const exclude = new Set<string>(fresh ? [fresh] : [])
    const snap = findSnapPoint(e.latlng.lng, e.latlng.lat, map, features, 15, exclude)

    if (snap) {
      if (vertexEditActive && snap.isVertex) {
        snapInfoRef.current = null
        if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
      } else {
        snapInfoRef.current = { isVertex: snap.isVertex }
        uiStore.getState().setSnappedCoord(snap.latlng)
      }
    } else {
      snapInfoRef.current = null
      if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
    }
  }
  const updateSnapRef = useRef(updateSnap)
  updateSnapRef.current = updateSnap

  // At most one snap search per animation frame. Clicks read snappedCoord
  // (DrawingLayer), so a pending search is flushed on pointerdown/up —
  // window capture runs before any map handler — and the click always sees
  // the snap for the latest cursor position.
  const [snapFrame] = useState(() => rafThrottle((e: LeafletMouseEvent) => updateSnapRef.current(e)))
  useEffect(() => {
    const flush = () => snapFrame.flush()
    window.addEventListener('pointerdown', flush, true)
    window.addEventListener('pointerup', flush, true)
    return () => {
      snapFrame.cancel()
      window.removeEventListener('pointerdown', flush, true)
      window.removeEventListener('pointerup', flush, true)
    }
  }, [snapFrame])

  useMapEvents({
    mousemove(e) { snapFrame.schedule(e) },
    mouseout() {
      snapFrame.cancel()
      if (uiStore.getState().snappedCoord) uiStore.getState().setSnappedCoord(null)
    }
  })

  if (!isSnappingRelevant || !snappedCoord) return null

  return (
    <Marker
      position={toLeaflet(snappedCoord)}
      icon={snapIcon(snapInfoRef.current?.isVertex ?? true)}
      interactive={false}
      zIndexOffset={10000}
    />
  )
}
