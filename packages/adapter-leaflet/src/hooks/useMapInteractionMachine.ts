import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import { setFeatureDragActive } from '../utils/featureTooltip'

export type InteractionPhase = 'Idle' | 'MouseDown' | 'Dragging' | 'MouseUp' | 'Click'

type MachineState = {
  phase: InteractionPhase
  suppressMapClick: boolean
  suppressFeatureClick: boolean
  suppressVertexExit: boolean
  doubleClickGestureSuppressed: boolean
}

export type MapInteractionMachine = {
  getPhase: () => InteractionPhase
  markDragStart: () => void
  markDragEnd: () => void
  shouldHandleFeatureClick: (didDragLocal?: boolean) => boolean
  markFeatureClick: () => void
  shouldHandleMapClick: () => boolean
  suppressNextVertexExit: () => void
  shouldHandleVertexExit: () => boolean
  suppressDoubleClickZoomForGesture: () => void
}

function transition(state: MachineState, next: InteractionPhase): MachineState {
  const current = state.phase
  if (current === next) return state
  if (current === 'Idle' && next === 'MouseDown') return { ...state, phase: next }
  if (current === 'MouseDown' && (next === 'Dragging' || next === 'MouseUp')) return { ...state, phase: next }
  if (current === 'Dragging' && next === 'MouseUp') return { ...state, phase: next }
  if (current === 'MouseUp' && next === 'Click') return { ...state, phase: next }
  if ((current === 'Click' || current === 'MouseUp') && next === 'Idle') return { ...state, phase: next }
  if (next === 'MouseDown') return { ...state, phase: next }
  return { ...state, phase: next }
}

export function useMapInteractionMachine(lockDoubleClickZoom: boolean): MapInteractionMachine {
  const map = useMap()
  const stateRef = useRef<MachineState>({
    phase: 'Idle',
    suppressMapClick: false,
    suppressFeatureClick: false,
    suppressVertexExit: false,
    doubleClickGestureSuppressed: false,
  })
  const lockRef = useRef(lockDoubleClickZoom)
  lockRef.current = lockDoubleClickZoom

  const setPhase = useCallback((next: InteractionPhase) => {
    stateRef.current = transition(stateRef.current, next)
  }, [])

  const setSuppression = useCallback((patch: Partial<MachineState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
  }, [])

  const restoreDoubleClickZoom = useCallback(() => {
    const st = stateRef.current
    if (st.doubleClickGestureSuppressed) {
      setSuppression({ doubleClickGestureSuppressed: false })
    }
    if (!lockRef.current) {
      map.doubleClickZoom.enable()
    }
  }, [map, setSuppression])

  const suppressDoubleClickZoomForGesture = useCallback(() => {
    setSuppression({ doubleClickGestureSuppressed: true })
    map.doubleClickZoom.disable()
    requestAnimationFrame(restoreDoubleClickZoom)
  }, [map, restoreDoubleClickZoom, setSuppression])

  useEffect(() => {
    if (lockDoubleClickZoom) {
      map.doubleClickZoom.disable()
      return
    }
    if (!stateRef.current.doubleClickGestureSuppressed) {
      map.doubleClickZoom.enable()
    }
  }, [lockDoubleClickZoom, map])

  useMapEvents({
    mousedown: () => {
      setPhase('MouseDown')
    },
    mousemove: () => {
      const st = stateRef.current
      if (st.phase === 'MouseDown') setPhase('Dragging')
    },
    mouseup: () => {
      const st = stateRef.current
      if (st.phase === 'Dragging' || st.phase === 'MouseDown') setPhase('MouseUp')
    },
    click: () => {
      setPhase('Click')
    },
  })

  return useMemo<MapInteractionMachine>(() => ({
    getPhase: () => stateRef.current.phase,
    markDragStart: () => {
      setPhase('Dragging')
      // Hide the feature-name tooltip while the user is moving something —
      // the label adds cognitive load without helping the drag.
      setFeatureDragActive(true)
    },
    markDragEnd: () => {
      setPhase('MouseUp')
      // Only suppress the next map click — the synthesized click on the
      // dragged feature itself is already caught by each layer's local
      // `dragged.current` + the `didDragLocal` branch in
      // `shouldHandleFeatureClick`. Blocking *all* feature clicks after a
      // drag means clicking a different feature got eaten on the first
      // click (you had to click twice to select neighbour B after dragging A).
      setSuppression({ suppressMapClick: true })
      setFeatureDragActive(false)
    },
    shouldHandleFeatureClick: (didDragLocal = false) => {
      if (didDragLocal) return false
      const st = stateRef.current
      if (st.suppressFeatureClick) {
        setSuppression({ suppressFeatureClick: false })
        setPhase('Idle')
        return false
      }
      return true
    },
    markFeatureClick: () => {
      setPhase('Click')
      setSuppression({ suppressMapClick: true })
    },
    shouldHandleMapClick: () => {
      const st = stateRef.current
      if (st.suppressMapClick) {
        setSuppression({ suppressMapClick: false })
        setPhase('Idle')
        return false
      }
      return true
    },
    suppressNextVertexExit: () => {
      setSuppression({ suppressVertexExit: true })
    },
    shouldHandleVertexExit: () => {
      const st = stateRef.current
      if (st.suppressVertexExit) {
        setSuppression({ suppressVertexExit: false })
        return false
      }
      return true
    },
    suppressDoubleClickZoomForGesture,
  }), [setPhase, setSuppression, suppressDoubleClickZoomForGesture])
}
