import { useEffect, useRef, startTransition } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import { useDataStore, useGeoStore, useUIStore } from '../../store/StoreContext'
import { getGeometryBBox, readAccentPalette } from '@element-editor/core'
import booleanIntersects from '@turf/boolean-intersects'
import { bboxInside, sameIdSet } from '../../utils/boxSelect'
import type { Feature, Polygon as GeoPolygon } from 'geojson'

type BoxSelectHandlerProps = {
  onSelect: (featureId: string, indices: number[]) => void
  onDragStart: () => void
  readonly: boolean
  /** Vertex-mode only: read the currently-selected vertex indices when the
   *  shift+drag begins so live preview can show (initial ∪ in-box) without
   *  losing previously additive picks. */
  getInitialVertexIndices?: () => number[]
  /** Vertex-mode only: per-tick preview of the rubber-band selection so the
   *  parent can highlight vertices in real time as the user drags. Sends the
   *  full target set (`initial ∪ in-box`); replace, don't merge. */
  onVertexBoxPreview?: (featureId: string, indices: number[]) => void
}

/** Handles Shift+drag rubber-band selection of points and line vertices. */
export function BoxSelectHandler({ onSelect, onDragStart, readonly, getInitialVertexIndices, onVertexBoxPreview }: BoxSelectHandlerProps) {
  const { dataStore } = useGeoStore()
  const map = useMap()
  const editingMode = useUIStore((s) => s.editingMode)
  const transformActive = useUIStore((s) => s.transformActive)
  const vertexEditActive = useUIStore((s) => s.vertexEditActive)
  const setSelection = useDataStore((s) => s.setSelection)
  const editingModeRef = useRef(editingMode)
  const transformActiveRef = useRef(transformActive)
  const vertexEditActiveRef = useRef(vertexEditActive)
  const setMultiSelectedRef = useRef(setSelection)
  editingModeRef.current = editingMode
  transformActiveRef.current = transformActive
  vertexEditActiveRef.current = vertexEditActive
  setMultiSelectedRef.current = setSelection

  useEffect(() => {
    map.boxZoom.disable()
    return () => {
      map.boxZoom.enable()
    }
  }, [map])

  useMapEvents({
    mousedown(e) {
      if (!e.originalEvent.shiftKey || readonly) return
      if (transformActiveRef.current) return

      // Two operating modes:
      // - vertex-mode: rubber-band selects vertices on the currently-edited feature.
      // - feature-mode: rubber-band selects features (the original behaviour).
      // Drawing modes block both — shift means something else there (e.g. snapping).
      const inVertexEdit = vertexEditActiveRef.current
      if (!inVertexEdit && editingModeRef.current !== 'none') return

      const startX = e.originalEvent.clientX
      const startY = e.originalEvent.clientY
      let dragging = false
      let selectionDiv: HTMLDivElement | null = null

      const initialSelection = [...dataStore.getState().selectedIds]
      let lastSelectionTime = 0
      // Vertex-mode: capture the user's pre-drag vertex selection so each tick
      // can publish (initial ∪ in-box). Without the base, vertices the user
      // had additively picked across earlier drags would flicker on/off.
      const initialVertexIndices: Set<number> | null = inVertexEdit
        ? new Set(getInitialVertexIndices?.() ?? [])
        : null
      let lastVertexPreviewTime = 0

      function boxLatLngBounds(ev: MouseEvent) {
        const containerRect = map.getContainer().getBoundingClientRect()
        const x1 = Math.min(startX, ev.clientX) - containerRect.left
        const y1 = Math.min(startY, ev.clientY) - containerRect.top
        const x2 = Math.max(startX, ev.clientX) - containerRect.left
        const y2 = Math.max(startY, ev.clientY) - containerRect.top
        const nw = map.containerPointToLatLng([x1, y1])
        const se = map.containerPointToLatLng([x2, y2])
        return {
          latMin: Math.min(nw.lat, se.lat),
          latMax: Math.max(nw.lat, se.lat),
          lngMin: Math.min(nw.lng, se.lng),
          lngMax: Math.max(nw.lng, se.lng),
        }
      }

      function vertexIndicesInBox(ev: MouseEvent): { id: string; indices: number[] } | null {
        const editId = dataStore.getState().selectedIds[0]
        if (!editId) return null
        const f = dataStore.getState().features.find((x) => x.id === editId)
        if (!f) return null
        let coords: [number, number][]
        if (f.geometry.type === 'LineString') {
          coords = f.geometry.coordinates as [number, number][]
        } else if (f.geometry.type === 'Polygon') {
          coords = (f.geometry.coordinates as [number, number][][])[0].slice(0, -1)
        } else {
          return null
        }
        const { latMin, latMax, lngMin, lngMax } = boxLatLngBounds(ev)
        const indices: number[] = []
        for (let i = 0; i < coords.length; i++) {
          const [lng, lat] = coords[i]
          if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) indices.push(i)
        }
        return { id: editId, indices }
      }

      function updateRealtimeSelection(ev: MouseEvent) {
        const containerRect = map.getContainer().getBoundingClientRect()
        const x1 = Math.min(startX, ev.clientX) - containerRect.left
        const y1 = Math.min(startY, ev.clientY) - containerRect.top
        const x2 = Math.max(startX, ev.clientX) - containerRect.left
        const y2 = Math.max(startY, ev.clientY) - containerRect.top

        const nw = map.containerPointToLatLng([x1, y1])
        const se = map.containerPointToLatLng([x2, y2])
        const latMin = Math.min(nw.lat, se.lat)
        const latMax = Math.max(nw.lat, se.lat)
        const lngMin = Math.min(nw.lng, se.lng)
        const lngMax = Math.max(nw.lng, se.lng)

        const state = dataStore.getState()
        const hiddenGroupIds = new Set(state.groups.filter((g) => g.hidden).map((g) => g.id))
        const visible = state.features.filter((f) => !f.groupId || !hiddenGroupIds.has(f.groupId))

        const selectionPoly: Feature<GeoPolygon> = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [lngMin, latMin], [lngMax, latMin],
              [lngMax, latMax], [lngMin, latMax],
              [lngMin, latMin],
            ]],
          },
        }

        const newSelectedIds: string[] = []

        for (const f of visible) {
          if (f.geometry.type === 'Point') {
            const [lng, lat] = f.geometry.coordinates as [number, number]
            if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) {
              newSelectedIds.push(f.id)
            }
          } else {
            // Fast bbox pre-filter, then accurate geometry intersection
            const bbox = f.bbox || getGeometryBBox(f.geometry)
            const [w, s, e, n] = bbox
            if (w <= lngMax && e >= lngMin && s <= latMax && n >= latMin) {
              // Fully inside the box → always a hit; skip the turf call
              if (bboxInside(bbox, lngMin, latMin, lngMax, latMax)) {
                newSelectedIds.push(f.id)
                continue
              }
              try {
                if (booleanIntersects(selectionPoly, f as Feature)) {
                  newSelectedIds.push(f.id)
                }
              } catch {
                // Fallback to bbox if geometry is invalid
                newSelectedIds.push(f.id)
              }
            }
          }
        }

        let next = initialSelection
        if (newSelectedIds.length > 0) {
          const currentSelected = new Set(initialSelection)
          newSelectedIds.forEach((id) => currentSelected.add(id))
          next = Array.from(currentSelected)
        }
        // Unchanged hit set → skip the store write (it would re-render every layer).
        // setSelection also clears selectedGroupId, so only skip once that's already null.
        if (sameIdSet(state.selectedIds, next) && state.selectedGroupId === null) return
        startTransition(() => {
          setMultiSelectedRef.current(next)
        })
      }

      function onMouseMove(ev: MouseEvent) {
        const dx = Math.abs(ev.clientX - startX)
        const dy = Math.abs(ev.clientY - startY)

        if (!dragging && dx < 5 && dy < 5) return

        if (!dragging) {
          dragging = true
          onDragStart()
          map.dragging.disable()
          document.body.style.userSelect = 'none'
          window.getSelection()?.removeAllRanges()
          selectionDiv = document.createElement('div')
          const accent = readAccentPalette(map.getContainer())[500]
          selectionDiv.style.cssText = [
            'position:fixed',
            // Body-level and outside the scoped preflight — size by the border box explicitly.
            'box-sizing:border-box',
            `left:${startX}px`,
            `top:${startY}px`,
            'width:0',
            'height:0',
            `border:2px dashed ${accent}`,
            `background:color-mix(in srgb, ${accent} 8%, transparent)`,
            'pointer-events:none',
            'z-index:10000',
          ].join(';')
          document.body.appendChild(selectionDiv)
        }

        if (selectionDiv) {
          const left = Math.min(startX, ev.clientX)
          const top = Math.min(startY, ev.clientY)
          selectionDiv.style.left = `${left}px`
          selectionDiv.style.top = `${top}px`
          selectionDiv.style.width = `${Math.abs(ev.clientX - startX)}px`
          selectionDiv.style.height = `${Math.abs(ev.clientY - startY)}px`
        }

        if (!inVertexEdit && Date.now() - lastSelectionTime > 30) {
          updateRealtimeSelection(ev)
          lastSelectionTime = Date.now()
        }

        if (inVertexEdit && onVertexBoxPreview && Date.now() - lastVertexPreviewTime > 30) {
          const result = vertexIndicesInBox(ev)
          if (result) {
            const merged = new Set(initialVertexIndices ?? [])
            for (const i of result.indices) merged.add(i)
            onVertexBoxPreview(result.id, [...merged].sort((a, b) => a - b))
          }
          lastVertexPreviewTime = Date.now()
        }
      }

      function onMouseUp(ev: MouseEvent) {
        const targetWindow =
          (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
        targetWindow.removeEventListener('mousemove', onMouseMove)
        targetWindow.removeEventListener('mouseup', onMouseUp)

        if (!dragging) return

        map.dragging.enable()
        document.body.style.userSelect = ''
        if (selectionDiv) document.body.removeChild(selectionDiv)

        // Vertex-edit mode: rubber band only selects vertices on the edited
        // feature — never touches feature multi-selection or the fallback path.
        if (inVertexEdit) {
          const result = vertexIndicesInBox(ev)
          if (result) {
            // Mouseup fires the final commit. Preview ticks already wrote
            // (initial ∪ in-box) into selectedVertexIndices; pass the same
            // union here so the parent's merge/replace path lands on the
            // identical set (idempotent, but covers the case where the last
            // move tick was throttled out).
            const merged = new Set(initialVertexIndices ?? [])
            for (const i of result.indices) merged.add(i)
            const finalIndices = [...merged].sort((a, b) => a - b)
            if (finalIndices.length > 0) onSelect(result.id, finalIndices)
          }
          return
        }

        updateRealtimeSelection(ev)

        const finalSelectedIds = dataStore.getState().selectedIds
        const addedAny = finalSelectedIds.length > initialSelection.length

        if (!addedAny) {
          const containerRect = map.getContainer().getBoundingClientRect()
          const x1 = Math.min(startX, ev.clientX) - containerRect.left
          const y1 = Math.min(startY, ev.clientY) - containerRect.top
          const x2 = Math.max(startX, ev.clientX) - containerRect.left
          const y2 = Math.max(startY, ev.clientY) - containerRect.top

          const nw = map.containerPointToLatLng([x1, y1])
          const se = map.containerPointToLatLng([x2, y2])
          const latMin = Math.min(nw.lat, se.lat)
          const latMax = Math.max(nw.lat, se.lat)
          const lngMin = Math.min(nw.lng, se.lng)
          const lngMax = Math.max(nw.lng, se.lng)

          const state = dataStore.getState()
          const hiddenGroupIds = new Set(state.groups.filter((g) => g.hidden).map((g) => g.id))
          const visible = state.features.filter((f) => !f.groupId || !hiddenGroupIds.has(f.groupId))

          let bestId: string | null = null
          let bestIndices: number[] = []
          for (const f of visible) {
            if (!state.selectedIds.includes(f.id)) continue
            let coords: [number, number][]
            if (f.geometry.type === 'LineString') {
              coords = f.geometry.coordinates as [number, number][]
            } else if (f.geometry.type === 'Polygon') {
              const ring = (f.geometry.coordinates as [number, number][][])[0]
              coords = ring.slice(0, -1)
            } else {
              continue
            }

            const indices = coords.reduce<number[]>((acc, [lng, lat], i) => {
              if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) acc.push(i)
              return acc
            }, [])

            if (indices.length > bestIndices.length) {
              bestId = f.id
              bestIndices = indices
            }
          }

          if (bestId && bestIndices.length > 0) onSelect(bestId, bestIndices)
        }
      }

      const targetWindow =
        (document.querySelector('.leaflet-container') as HTMLElement | null)?.ownerDocument?.defaultView || window
      targetWindow.addEventListener('mousemove', onMouseMove)
      targetWindow.addEventListener('mouseup', onMouseUp)
    },
  })

  return null
}
