import { memo, useState, useRef, useEffect } from 'react'
import { Marker, Tooltip } from 'react-leaflet'
import type L from 'leaflet'
import { divIcon } from 'leaflet'
import { useDataStore, useGeoStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import type { GeoJSONFeature } from '@element-editor/core'
import { translateGeometrySpatially } from '@element-editor/core/internal'
import { translateGeometryVisually, project, withXY } from '@element-editor/core/internal'
import { useDuplicateDrag } from '../hooks/useDuplicateDrag'
import { computeDragDisplay } from '../utils/dragUtils'
import { setFeatureDragActive } from '../utils/featureTooltip'
import { useModifierDragCursor } from '../hooks/useModifierDragCursor'

const invisibleIcon = divIcon({ className: 'hidden' })

export const TextLabelLayer = memo(function TextLabelLayer({
  feature,
  selected,
  isMultiSelected,
  multiDragDelta,
  multiDuplicateDrag,
  readonly,
  suppressDoubleClickZoomForGesture
}: {
  feature: GeoJSONFeature
  selected: boolean
  isMultiSelected: boolean
  multiDragDelta: [number, number] | null
  multiDuplicateDrag: boolean
  readonly: boolean
  suppressDoubleClickZoomForGesture?: () => void
}) {
  const { dataStore } = useGeoStore()
    const updateFeature = useDataStore((s) => s.updateFeature)
  const coords = feature.geometry.coordinates as [number, number]

  // `dragDelta` state flips only at drag start/end; mousemove updates the marker
  // imperatively via `mainRef` / `ghostRef`.
  const [dragDelta, setDragDelta] = useState<[number, number] | null>(null)
  const liveDeltaRef = useRef<[number, number] | null>(null)
  const mainRef = useRef<L.Marker | null>(null)
  const ghostRef = useRef<L.Marker | null>(null)
  const dragStart = useRef<{ lng: number; lat: number } | null>(null)
  const dragged = useRef(false)
  const { isDupDrag, setDuplicateDrag, resetDuplicateDrag } = useDuplicateDrag(dragDelta, multiDuplicateDrag)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [isEditingText, setIsEditingText] = useState(!feature.properties.name)
  const [hovered, setHovered] = useState(false)
  const modifierCursor = useModifierDragCursor(readonly)

  const renderedLocalDelta = liveDeltaRef.current ?? dragDelta
  const effectiveDelta = isMultiSelected && multiDragDelta ? multiDragDelta : renderedLocalDelta
  const { display: displayCoords, ghost: ghostCoords } = computeDragDisplay<[number, number]>(coords, effectiveDelta, isDupDrag, dataStore.getState().geometryMode)

  function handleMouseDown(e: import('leaflet').LeafletMouseEvent) {
    if (readonly) return
    dragged.current = false
    const isAlt = e.originalEvent.altKey
    const isCtrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey
    if (!isAlt && !isCtrl) return
    if (isMultiSelected && dataStore.getState().selectedIds.length >= 2) return
    e.originalEvent.preventDefault()
    e.originalEvent.stopPropagation()
    const m = e.target._map || (window as unknown as { _leafletMap?: L.Map })._leafletMap
    if (!m) return
    m.dragging.disable()
    const isDuplicate = isAlt
    setDuplicateDrag(isDuplicate)
    const mode = dataStore.getState().geometryMode
    if (mode === 'visual') {
      const startProj = project([e.latlng.lng, e.latlng.lat])
      dragStart.current = { lng: startProj[0], lat: startProj[1] }
    } else {
      dragStart.current = { lng: e.latlng.lng, lat: e.latlng.lat }
    }

    if (!selected && !isMultiSelected) dataStore.getState().selectFeature(feature.id)
    setDragDelta([0, 0])

    function onMove(ev: import('leaflet').LeafletMouseEvent) {
      if (!dragStart.current) return
      if (!dragged.current) setFeatureDragActive(true)
      dragged.current = true
      const mMode = dataStore.getState().geometryMode
      const delta: [number, number] = mMode === 'visual'
        ? (() => { const p = project([ev.latlng.lng, ev.latlng.lat]); return [p[0] - dragStart.current!.lng, p[1] - dragStart.current!.lat] })()
        : [ev.latlng.lng - dragStart.current.lng, ev.latlng.lat - dragStart.current.lat]
      liveDeltaRef.current = delta
      const translated = mMode === 'visual'
        ? translateGeometryVisually(coords as [number, number], delta[0], delta[1])
        : ([coords[0] + delta[0], coords[1] + delta[1]] as [number, number])
      const ll = toLeaflet(translated)
      if (isDuplicate) {
        ghostRef.current?.setLatLng(ll)
      } else {
        mainRef.current?.setLatLng(ll)
      }
    }

    function onUp(ev: import('leaflet').LeafletMouseEvent) {
      m.off('mousemove', onMove)
      m.off('mouseup', onUp)
      m.dragging.enable()
      setFeatureDragActive(false)
      if (!dragStart.current || !dragged.current) {
        dragStart.current = null
        resetDuplicateDrag()
        liveDeltaRef.current = null
        setDragDelta(null)
        return
      }
      const mMode = dataStore.getState().geometryMode
      let dlng, dlat
      if (mMode === 'visual') {
        const evProj = project([ev.latlng.lng, ev.latlng.lat])
        dlng = evProj[0] - dragStart.current.lng
        dlat = evProj[1] - dragStart.current.lat
      } else {
        dlng = ev.latlng.lng - dragStart.current.lng
        dlat = ev.latlng.lat - dragStart.current.lat
      }
      dragStart.current = null
      resetDuplicateDrag()
      liveDeltaRef.current = null
      setDragDelta(null)
      const newCoords = mMode === 'visual' ? translateGeometryVisually(coords as [number, number], dlng, dlat) : withXY(coords, [coords[0] + dlng, coords[1] + dlat])
      if (isDuplicate) {
        dataStore.getState().duplicateFeaturesAtPosition([{ sourceId: feature.id, geometry: { type: 'Point', coordinates: newCoords } }])
      } else {
        updateFeature(feature.id, { geometry: { type: 'Point', coordinates: newCoords } })
      }
    }

    m.on('mousemove', onMove)
    m.on('mouseup', onUp)
  }

  const text = (feature.properties.name as string) || ''

  useEffect(() => {
    if (!selected) setIsEditingText(false)
  }, [selected])

  useEffect(() => {
    if (isEditingText && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isEditingText])

  return (
    <>
      <Marker
        ref={(m) => { mainRef.current = (m as unknown as L.Marker | null) }}
        position={toLeaflet(displayCoords)}
        icon={invisibleIcon}
        eventHandlers={{
          mousedown: handleMouseDown,
          click: (e) => {
            e.originalEvent.stopPropagation()
            if (e.originalEvent.shiftKey && !readonly) {
              dataStore.getState().toggleSelection(feature.id)
            } else if (!selected && !isMultiSelected) {
              dataStore.getState().selectFeature(feature.id)
            }
            // Only focus if single selected
            if (!readonly && !e.originalEvent.shiftKey) {
              setTimeout(() => inputRef.current?.focus(), 50)
            }
          }
        }}
      >
        <Tooltip
          permanent
          interactive
          direction="center"
          className="!bg-transparent !border-0 !shadow-none !p-0"
          eventHandlers={{
            click: (e) => {
              e.originalEvent.stopPropagation()
              if (e.originalEvent.shiftKey && !readonly) {
                dataStore.getState().toggleSelection(feature.id)
              } else if (!readonly && !selected) {
                dataStore.getState().selectFeature(feature.id)
              }
              if (!readonly && !e.originalEvent.shiftKey && selected) {
                 // Focus if already selected and they click again without shift
                 setTimeout(() => inputRef.current?.focus(), 50)
              }
            },
            dblclick: (e) => {
              e.originalEvent.stopPropagation()
              suppressDoubleClickZoomForGesture?.()

              if (!readonly) {
                dataStore.getState().selectFeature(feature.id)
                setIsEditingText(true)
              }
            },
            mouseover: (e) => {
              modifierCursor.enter((e.target as L.Tooltip).getElement?.(), e.originalEvent)
              setHovered(true)
            },
            mouseout: () => {
              modifierCursor.leave()
              setHovered(false)
            },
            mousedown: () => {
              // Need to stop propagation to prevent map dragging if we are inside the box,
              // but the Marker itself handles the Cmd+Drag logic.
              // So we don't stop propagation here, let it bubble to the Marker!
            }
          }}
        >
          <div
            className={`flex items-center justify-center w-max px-3 py-1.5 rounded text-sm font-medium transition-colors border ${isEditingText && !effectiveDelta ? 'bg-white/95 backdrop-blur-md border border-gray-800 text-gray-800 focus-within:ring-2 focus-within:ring-elm-focus-ring' : selected ? 'bg-primary-500 text-white' : hovered ? 'bg-slate-700 text-white' : 'bg-slate-600 text-white'} ${(effectiveDelta && !isDupDrag) ? 'cursor-grabbing opacity-80' : ''}`}
            onMouseDown={(e) => {
              if (e.target === inputRef.current) {
                e.stopPropagation() // prevent map drag when clicking in input
              }
            }}
          >
            {readonly || (!isEditingText || effectiveDelta) ? (
              <div className="whitespace-pre min-w-[12px] text-center text-inherit cursor-pointer leading-tight">
                {text || ' '}
              </div>
            ) : (
              <div className="grid items-center justify-items-center text-center leading-tight">
                {/* Invisible mirror to perfectly auto-size the textarea's width and height */}
                <div
                  className="invisible whitespace-pre pointer-events-none col-start-1 row-start-1 min-w-[12px] px-[2px]"
                  aria-hidden="true"
                >
                  {text + ' '}
                </div>
                <textarea
                  ref={inputRef}
                  autoFocus
                  value={text}
                  onChange={(e) => {
                    updateFeature(feature.id, { properties: { ...feature.properties, name: e.target.value } })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      setIsEditingText(false)
                      dataStore.getState().selectFeature(null)
                    }
                  }}
                  onBlur={() => setIsEditingText(false)}
                  className="bg-transparent outline-none resize-none overflow-hidden text-center text-inherit whitespace-pre min-w-0 min-h-0 col-start-1 row-start-1 px-[2px] w-full h-full m-0 border-none justify-self-stretch self-stretch"
                />
              </div>
            )}
          </div>
        </Tooltip>
      </Marker>
      {ghostCoords && (
        <Marker
          ref={(m) => { ghostRef.current = (m as unknown as L.Marker | null) }}
          position={toLeaflet(ghostCoords)}
          icon={invisibleIcon}
          draggable={false}
          opacity={0.5}
          interactive={false}
        >
          <Tooltip permanent direction="center" className="!bg-transparent !border-0 !shadow-none !p-0">
            <div className="flex items-center justify-center w-max px-3 py-1.5 rounded text-sm font-medium border bg-primary-500/60 text-white/80 border-primary-400/40" style={{ borderStyle: 'dashed' }}>
              <div className="whitespace-pre min-w-[12px] text-center text-inherit leading-tight">
                {text || ' '}
              </div>
            </div>
          </Tooltip>
        </Marker>
      )}
    </>
  )
})
