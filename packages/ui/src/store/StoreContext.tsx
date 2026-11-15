import React, { createContext, useCallback, useContext, useRef } from 'react'
import { useStore, type StoreApi } from 'zustand'
import { createDataStore, type DataStore, createUIStore, type UIStore, type ElementEditorError } from '@element-editor/core'
import { toast } from 'sonner'
import { EventContext, StoreErrorSinkContext } from '../contexts/EventContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'

/** UI stores whose GeoJSON inspector is still in its on-load open (`ui.geojsonEditorOpen`); it doesn't take focus. */
export const inspectorOpenedOnLoad = new WeakSet<StoreApi<UIStore>>()

interface StoreContextValue {
  dataStore: StoreApi<DataStore>
  uiStore: StoreApi<UIStore>
}

export const StoreContext = createContext<StoreContextValue | null>(null)

export function GeoStoreProvider({ children }: { children: React.ReactNode }) {
  const storesRef = useRef<StoreContextValue | null>(null)
  // Store errors go through the instance's emit (so `onEvent` sees them and
  // toasts land in the right <Toaster>): an EventProvider below registers its
  // emit via StoreErrorSinkContext; one above is read directly. Bare toast only
  // when there's no EventProvider at all — never swallow the error.
  const sinkRef = useRef<((error: ElementEditorError, opts?: { quiet?: boolean }) => void) | null>(null)
  const emitAbove = useContext(EventContext)?.emit
  const emitAboveRef = useRef(emitAbove)
  emitAboveRef.current = emitAbove
  const registerSink = useCallback((sink: ((error: ElementEditorError, opts?: { quiet?: boolean }) => void) | null) => { sinkRef.current = sink }, [])
  const cfg = useElementEditorConfig()
  const openInspector = cfg.ui.geojsonEditorOpen

  if (!storesRef.current) {
    const onError = (error: ElementEditorError, opts?: { quiet?: boolean }) => {
      if (sinkRef.current) sinkRef.current(error, opts)
      else if (emitAboveRef.current) emitAboveRef.current({ type: 'error', code: error.code, source: error.source, message: error.message, error, quiet: opts?.quiet })
      else if (!opts?.quiet) toast.error(error.message)
    }
    const persist = { persistKey: cfg.persistKey, persist: cfg.persist }
    const dataStore = createDataStore({ onError, persist })
    const uiStore = createUIStore(dataStore, { onError, persist })
    // `ui.geojsonEditorOpen`: open from the first render, so the dock is in the first paint.
    if (openInspector) {
      uiStore.setState({ codeModalOpen: true })
      inspectorOpenedOnLoad.add(uiStore)
      const unsub = uiStore.subscribe((s) => {
        if (!s.codeModalOpen) { inspectorOpenedOnLoad.delete(uiStore); unsub() }
      })
    }
    storesRef.current = { dataStore, uiStore }
  }

  return (
    <StoreContext.Provider value={storesRef.current}>
      <StoreErrorSinkContext.Provider value={registerSink}>
        {children}
      </StoreErrorSinkContext.Provider>
    </StoreContext.Provider>
  )
}

export function useDataStore<T>(selector: (state: DataStore) => T): T {
  const context = useContext(StoreContext)
  if (!context) throw new Error('useDataStore must be used within GeoStoreProvider')
  return useStore(context.dataStore, selector)
}

export function useUIStore<T>(selector: (state: UIStore) => T): T {
  const context = useContext(StoreContext)
  if (!context) throw new Error('useUIStore must be used within GeoStoreProvider')
  return useStore(context.uiStore, selector)
}

// For imperative access
export function useGeoStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error('useGeoStore must be used within GeoStoreProvider')
  return context
}
