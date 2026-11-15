import { useEffect, useRef } from 'react'
import type { StoreApi } from 'zustand'
import { subscribeToDataChanges } from '@element-editor/core'
import type { DataStore, DataChangeCallbacks } from '@element-editor/core'

/**
 * React wrapper around `subscribeToDataChanges`. Owns the callback ref
 * plumbing so hosts can pass a fresh object each render without resubscribing.
 *
 * The subscription only tears down when `store` itself changes.
 */
export function useDataChangeSubscription(
  store: StoreApi<DataStore>,
  callbacks: DataChangeCallbacks,
): void {
  const ref = useRef(callbacks)
  ref.current = callbacks

  useEffect(() => {
    return subscribeToDataChanges(store, () => ref.current)
  }, [store])
}
