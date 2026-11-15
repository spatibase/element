import { memo, useEffect, useRef, useState } from 'react'
import { Marker, Popup, useMap } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import { Check } from '@phosphor-icons/react'
import type { GeoJSONFeature } from '@element-editor/core'
import { withXY } from '@element-editor/core/internal'
import { useEmit } from '@element-editor/ui'
import { useDataStore, useGeoStore } from '../../store/StoreContext'
import { toLeaflet } from '../../utils/geojson'
import { bindFeatureTooltip, unbindFeatureTooltip } from '../../utils/featureTooltip'
import { useModifierDragCursor } from '../../hooks/useModifierDragCursor'
import { useFeatureDrag } from '../../hooks/useFeatureDrag'
import { getLastPointer, isPointerNear, isPointerOver } from '../../hooks/lastPointer'
import { setFreshFeature, useIsFreshFeature } from '../../utils/freshFeature'
import type { MapInteractionMachine } from '../../hooks/useMapInteractionMachine'
import { idlePin, makePinIcon, pinColor, tintPin, useCustomStyle, type OpenFeatureCtxMenu } from './shared'

export const POIMarker = memo(function POIMarker({ feature, selected, isMultiSelected, multiDragDelta, multiDuplicateDrag, readonly, interaction, onContextMenu }: { feature: GeoJSONFeature; selected: boolean; isMultiSelected: boolean; multiDragDelta: [number, number] | null; multiDuplicateDrag: boolean; readonly: boolean; interaction: MapInteractionMachine; onContextMenu?: OpenFeatureCtxMenu }) {
  const { dataStore } = useGeoStore()
  const map = useMap()
  const { uiStore } = useGeoStore()
  const emit = useEmit()
  const updateFeature = useDataStore((s) => s.updateFeature)
  const toggleSelection = useDataStore((s) => s.toggleSelection)
  const coords = feature.geometry.coordinates as [number, number]
  const [popupOpen, setPopupOpen] = useState(false)
  const pin = pinColor(useCustomStyle(feature))
  const [draftCoords, setDraftCoords] = useState<{ lng: string; lat: string }>({ lng: '', lat: '' })

  // Drag start/end re-render (ghost + visibility); mousemove moves the marker
  // imperatively via `mainRef` / `ghostRef`.
  const mainRef = useRef<L.Marker | null>(null)
  const ghostRef = useRef<L.Marker | null>(null)
  const { effectiveDelta, display: displayCoords, ghost: ghostCoords, dragged, handleMouseDown } = useFeatureDrag(
    feature, 'Point', coords, selected, isMultiSelected, multiDragDelta, multiDuplicateDrag, readonly, interaction,
    (translated, isDuplicate) => (isDuplicate ? ghostRef : mainRef).current?.setLatLng(toLeaflet(translated)),
  )
  const modifierCursor = useModifierDragCursor(readonly)

  // Leaflet doesn't fire `mouseover` for a marker that mounts under a
  // stationary cursor (which is exactly the state right after the point
  // tool places a new point — cursor sits on the fresh marker). Without
  // a mouseover the modifier-cursor hook never activates, so holding Cmd
  // or Alt has no visible effect until the user moves the mouse away and
  // back. Detect the mount-over-cursor case and prime the hover state
  // ourselves.
  useEffect(() => {
    if (readonly) return
    const el = mainRef.current?.getElement?.()
    if (!el || !isPointerNear(map, toLeaflet(coords)) || !isPointerOver(el)) return
    // Just placed (or otherwise added) under the cursor: quiet until the cursor leaves.
    setFreshFeature(feature.id)
    modifierCursor.enter(el, getLastPointer())
    if (!uiStore.getState().vertexEditActive) tintPin(mainRef.current, true)
    return () => { modifierCursor.leave() }
    // modifierCursor / uiStore refs are stable across renders; depending on
    // them would re-run this effect on every parent render and double-prime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id, readonly])

  // A fresh pin (see freshFeature.ts) is one accent step darker. Set on the element after
  // every render: react-leaflet's setIcon (selection, popup) replaces it.
  const fresh = useIsFreshFeature(feature.id)
  useEffect(() => { mainRef.current?.getElement?.()?.classList.toggle('elm-pin-fresh', fresh) })

  function openPreciseCoordsPopup() {
    setDraftCoords({ lng: coords[0].toFixed(6), lat: coords[1].toFixed(6) })
    setPopupOpen(true)
  }

  function handleContextMenu(e: LeafletMouseEvent) {
    e.originalEvent.preventDefault()
    e.originalEvent.stopPropagation()
    if (readonly) return
    if (onContextMenu) {
      onContextMenu({
        feature,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        requestPreciseCoords: openPreciseCoordsPopup,
      })
    }
  }

  function savePreciseCoords() {
    const lng = parseFloat(draftCoords.lng)
    const lat = parseFloat(draftCoords.lat)
    if (!isNaN(lng) && !isNaN(lat)) {
      dataStore.getState().takeSnapshot()
      updateFeature(feature.id, { geometry: { type: 'Point', coordinates: withXY(coords, [lng, lat]) } })
      setPopupOpen(false)
      emit({ type: 'success', message: 'Coordinate updated' })
    } else {
      emit({ type: 'warning', message: 'Invalid coordinates' })
    }
  }

  return (
    <>
    <Marker
      ref={(m) => { mainRef.current = (m as unknown as L.Marker | null) }}
      position={toLeaflet(displayCoords)}
      icon={(selected || isMultiSelected || popupOpen || !!effectiveDelta) ? makePinIcon(selected, isMultiSelected, pin) : idlePin(pin)}
      draggable={false}
      eventHandlers={{
        mouseover: (e: L.LeafletMouseEvent) => {
          modifierCursor.enter((e.target as L.Marker).getElement?.(), e.originalEvent)
          bindFeatureTooltip(e.target, feature, uiStore, e.latlng, e.originalEvent)
          if (!uiStore.getState().vertexEditActive) tintPin(mainRef.current, true)
        },
        mouseout: (e: L.LeafletMouseEvent) => {
          modifierCursor.leave()
          unbindFeatureTooltip(e.target)
          tintPin(e.target, false)
        },
        click: (e: LeafletMouseEvent) => {
          if (uiStore.getState().editingMode !== 'none') return
          e.originalEvent.stopPropagation()
          if (!interaction.shouldHandleFeatureClick(dragged.current)) return
          if (e.originalEvent.shiftKey && !readonly) {
            toggleSelection(feature.id)
          } else {
            interaction.markFeatureClick()
            dataStore.getState().selectFeature(feature.id)
          }
        },

        contextmenu: handleContextMenu,
        mousedown: handleMouseDown
      }}
    >
      {popupOpen && (
        <Popup
          eventHandlers={{ remove: () => setPopupOpen(false) }}
          autoClose={false}
          closeOnClick={false}
        >
          <div className="flex flex-col gap-2 min-w-[140px]" onKeyDown={(e) => { if (e.key === 'Enter') savePreciseCoords(); if (e.key === 'Escape') setPopupOpen(false) }}>
            <p className="text-xs font-semibold text-(--elm-text-secondary,var(--color-gray-700)) m-0 leading-none">Precise coordinates</p>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-xs text-(--elm-text-muted,var(--color-gray-500))">
                Lat:
                <input type="text" value={draftCoords.lat} onChange={(e) => setDraftCoords(c => ({...c, lat: e.target.value}))} className="flex-1 w-full min-w-0 border border-(--elm-border,var(--color-gray-200)) rounded-elm-chip px-1.5 py-0.5 text-xs outline-none focus-visible:border-elm-focus-ring" />
              </label>
              <label className="flex items-center gap-2 text-xs text-(--elm-text-muted,var(--color-gray-500))">
                Lng:
                <input type="text" value={draftCoords.lng} onChange={(e) => setDraftCoords(c => ({...c, lng: e.target.value}))} className="flex-1 w-full min-w-0 border border-(--elm-border,var(--color-gray-200)) rounded-elm-chip px-1.5 py-0.5 text-xs outline-none focus-visible:border-elm-focus-ring" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-1 mt-1">
              <button onClick={() => setPopupOpen(false)} className="px-2 py-1 text-xs text-(--elm-text-muted,var(--color-gray-500)) hover:bg-(--elm-surface-hover,var(--color-gray-100)) rounded-elm-chip transition-colors">Cancel</button>
              <button onClick={savePreciseCoords} className="px-2 py-1 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-elm-chip transition-colors font-medium flex items-center gap-1">
                <Check size={12} weight="bold" /> Save
              </button>
            </div>
          </div>
        </Popup>
      )}
    </Marker>
    {ghostCoords && (
      <Marker
        ref={(m) => { ghostRef.current = (m as unknown as L.Marker | null) }}
        position={toLeaflet(ghostCoords)}
        icon={makePinIcon(true, false)}
        opacity={0.5}
        interactive={false}
      />
    )}
    </>
  )
}, (prev, next) =>
  prev.feature === next.feature &&
  prev.selected === next.selected &&
  prev.isMultiSelected === next.isMultiSelected &&
  prev.multiDragDelta === next.multiDragDelta &&
  prev.multiDuplicateDrag === next.multiDuplicateDrag &&
  prev.readonly === next.readonly &&
  prev.interaction === next.interaction
)
