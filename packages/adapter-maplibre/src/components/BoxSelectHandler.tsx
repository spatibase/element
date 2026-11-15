/**
 * BoxSelectHandler — Shift+drag rubber-band selection for the MapLibre adapter.
 *
 * Matches adapter-leaflet's BoxSelectHandler behaviour:
 *   - Union with pre-drag selection (doesn't clobber shift-clicked items).
 *   - Filters out features in hidden groups.
 *   - Real-time selection updates during drag (30 ms throttle).
 *   - Vertex-box-select fallback: when the box matches no features but a
 *     line/polygon is already selected, select the vertices inside the box on
 *     that feature (handled by the parent via `onVertexSelect`).
 *
 * Only active when:
 *   - editingMode === 'none'
 *   - vertexEditActive === false  (vertex-box-select is a pre-vertex-edit action)
 *   - transformActive === false
 *   - Shift key is held on mousedown
 *   - readonly === false
 */
import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { getGeometryBBox } from '@element-editor/core'
import booleanIntersects from '@turf/boolean-intersects'
import { bboxInside, sameIdSet } from '../utils/boxSelect'

interface Props {
  map: MapLibreMap
  /**
   * Called when the drag ends without matching any features but a single
   * line/polygon is already selected — supplies indices of vertices that
   * fell inside the rubber band. Parent can choose whether to enter vertex
   * edit mode with those pre-selected.
   */
  onVertexBoxSelect?: (featureId: string, indices: number[]) => void
}

export default function BoxSelectHandler({ map, onVertexBoxSelect }: Props) {
  const { dataStore } = useGeoStore()
  const editingMode = useUIStore((s) => s.editingMode)
  const vertexEditActive = useUIStore((s) => s.vertexEditActive)
  const transformActive = useUIStore((s) => s.transformActive)
  const readonly = useUIStore((s) => s.readonly)

  const editingModeRef = useRef(editingMode)
  const vertexEditRef = useRef(vertexEditActive)
  const transformActiveRef = useRef(transformActive)
  const readonlyRef = useRef(readonly)
  editingModeRef.current = editingMode
  vertexEditRef.current = vertexEditActive
  transformActiveRef.current = transformActive
  readonlyRef.current = readonly

  useEffect(() => {
    const canvas = map.getCanvas()
    const container = map.getContainer()

    const onMousedown = (e: MouseEvent) => {
      if (!e.shiftKey) return
      if (readonlyRef.current) return
      if (transformActiveRef.current) return

      // Two operating modes:
      // - vertex-mode: rubber-band selects vertices on the currently-edited feature.
      // - feature-mode: rubber-band selects features (the original behaviour).
      // Drawing modes block both.
      const inVertexEdit = vertexEditRef.current
      if (!inVertexEdit && editingModeRef.current !== 'none') return

      e.preventDefault()
      map.dragPan.disable()
      map.boxZoom.disable()

      const startX = e.clientX
      const startY = e.clientY
      const containerRect = container.getBoundingClientRect()

      // Preserve what the user already had selected before starting the drag;
      // the rubber band adds to this set rather than replacing it.
      const initialSelection = [...dataStore.getState().selectedIds]

      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:absolute',
        'pointer-events:none',
        'border:2px solid var(--color-primary-500)',
        'background:color-mix(in srgb, var(--color-primary-500) 8%, transparent)',
        'z-index:9999',
        'border-radius:2px',
      ].join(';')
      // The container is already positioned (maplibre-gl.css, or the drop-in's inline
      // `absolute`); forcing `relative` here collapsed the drop-in's map to zero width.
      container.appendChild(overlay)

      let dragging = false
      let lastUpdate = 0

      function boxBounds(ev: MouseEvent) {
        const x1 = Math.min(startX, ev.clientX) - containerRect.left
        const y1 = Math.min(startY, ev.clientY) - containerRect.top
        const x2 = Math.max(startX, ev.clientX) - containerRect.left
        const y2 = Math.max(startY, ev.clientY) - containerRect.top
        const nw = map.unproject([x1, y1])
        const se = map.unproject([x2, y2])
        return {
          boxW: nw.lng,
          boxE: se.lng,
          boxN: nw.lat,
          boxS: se.lat,
          overlayX: x1,
          overlayY: y1,
          overlayW: x2 - x1,
          overlayH: y2 - y1,
        }
      }

      function computeMatched(ev: MouseEvent): string[] {
        const { boxW, boxE, boxN, boxS } = boxBounds(ev)
        const state = dataStore.getState()
        const hiddenGroupIds = new Set(state.groups.filter((g) => g.hidden).map((g) => g.id))
        const visible = state.features.filter(
          (f) => !f.hidden && (!f.groupId || !hiddenGroupIds.has(f.groupId)),
        )
        const selectionPoly = {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [boxW, boxS], [boxE, boxS],
              [boxE, boxN], [boxW, boxN],
              [boxW, boxS],
            ]],
          },
        }

        const matched: string[] = []
        for (const f of visible) {
          if (f.geometry.type === 'Point') {
            const [lng, lat] = f.geometry.coordinates as [number, number]
            if (lng >= boxW && lng <= boxE && lat >= boxS && lat <= boxN) {
              matched.push(f.id)
            }
            continue
          }
          const bbox = f.bbox ?? getGeometryBBox(f.geometry)
          const [fW, fS, fE, fN] = bbox
          if (fE >= boxW && fW <= boxE && fN >= boxS && fS <= boxN) {
            // Fully inside the box → always a hit; skip the turf call
            if (bboxInside(bbox, boxW, boxS, boxE, boxN)) {
              matched.push(f.id)
              continue
            }
            try {
              if (booleanIntersects(selectionPoly as unknown as GeoJSON.Feature, f as unknown as GeoJSON.Feature)) {
                matched.push(f.id)
              }
            } catch {
              matched.push(f.id)
            }
          }
        }
        return matched
      }

      // Union of the pre-drag selection and the box hits. Skips the store
      // write when nothing changed (it would re-render every layer);
      // setSelection also clears selectedGroupId, so only skip once that's
      // already null.
      function applySelection(matched: string[]) {
        const merged = new Set(initialSelection)
        matched.forEach((id) => merged.add(id))
        const next = Array.from(merged)
        const state = dataStore.getState()
        if (sameIdSet(state.selectedIds, next) && state.selectedGroupId === null) return
        state.setSelection(next)
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
        const { boxW, boxE, boxN, boxS } = boxBounds(ev)
        const indices: number[] = []
        for (let i = 0; i < coords.length; i++) {
          const [lng, lat] = coords[i]
          if (lng >= boxW && lng <= boxE && lat >= boxS && lat <= boxN) indices.push(i)
        }
        return { id: editId, indices }
      }

      const onMousemove = (ev: MouseEvent) => {
        const dx = Math.abs(ev.clientX - startX)
        const dy = Math.abs(ev.clientY - startY)
        if (!dragging && dx < 5 && dy < 5) return
        dragging = true

        const { overlayX, overlayY, overlayW, overlayH } = boxBounds(ev)
        overlay.style.left = `${overlayX}px`
        overlay.style.top = `${overlayY}px`
        overlay.style.width = `${overlayW}px`
        overlay.style.height = `${overlayH}px`

        if (!inVertexEdit && Date.now() - lastUpdate > 30) {
          applySelection(computeMatched(ev))
          lastUpdate = Date.now()
        }
      }

      const onMouseup = (ev: MouseEvent) => {
        overlay.remove()
        map.dragPan.enable()
        map.boxZoom.enable()
        window.removeEventListener('mousemove', onMousemove)
        window.removeEventListener('mouseup', onMouseup)
        if (!dragging) return

        // Vertex-edit mode: rubber band only selects vertices on the edited
        // feature. Skip the feature-selection update + vertex-fallback path.
        if (inVertexEdit) {
          const result = vertexIndicesInBox(ev)
          if (result && result.indices.length > 0 && onVertexBoxSelect) {
            onVertexBoxSelect(result.id, result.indices)
          }
          return
        }

        const matched = computeMatched(ev)
        applySelection(matched)

        // No features matched AND the user already had a single line/polygon
        // selected: fall back to vertex-box-select. Parent decides what to do
        // with the indices (typically: enter vertex edit with them highlighted).
        if (matched.length === 0 && initialSelection.length === 1 && onVertexBoxSelect) {
          const feature = dataStore.getState().features.find((f) => f.id === initialSelection[0])
          if (feature && (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon')) {
            const result = vertexIndicesInBox(ev)
            if (result && result.indices.length > 0) onVertexBoxSelect(result.id, result.indices)
          }
        }
      }

      window.addEventListener('mousemove', onMousemove)
      window.addEventListener('mouseup', onMouseup)
    }

    canvas.addEventListener('mousedown', onMousedown)
    return () => canvas.removeEventListener('mousedown', onMousedown)
  }, [map, dataStore, onVertexBoxSelect])

  return null
}
