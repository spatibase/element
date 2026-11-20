import { useSyncExternalStore } from 'react'
import { lastPointerWasTouch, subscribeLastPointer } from '@element-editor/core/internal'

/**
 * `true` while the user's last press was a finger (re-renders when that switches). Touch-only UI
 * (Done, Undo point, Edit points, tap wording) shows for a finger only; a mouse keeps today's UI.
 */
export function useTouchInput(): boolean {
  return useSyncExternalStore(subscribeLastPointer, lastPointerWasTouch, () => false)
}
