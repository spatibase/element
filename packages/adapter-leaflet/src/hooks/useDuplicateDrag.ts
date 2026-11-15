import { useRef } from 'react'

/**
 * Manages the isDuplicateDrag ref for Alt+drag duplicate across geometry layer components.
 * When local drag is active (dragDelta set), uses the local ref; otherwise uses multi-drag state.
 */
export function useDuplicateDrag(
  dragDelta: [number, number] | null,
  multiDuplicateDrag: boolean,
) {
  const ref = useRef(false)
  const isDupDrag = dragDelta ? ref.current : multiDuplicateDrag

  return {
    isDupDrag,
    setDuplicateDrag: (v: boolean) => { ref.current = v },
    resetDuplicateDrag: () => { ref.current = false },
  }
}
