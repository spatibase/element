import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { ShortcutId } from '@element-editor/core'
import { useElementEditorConfig } from './ElementEditorConfigContext'
import {
  loadCustomBindings,
  saveCustomBindings,
  getEffectiveKey,
  findConflict,
  syncShortcutCache,
} from '@element-editor/core/internal'

interface ShortcutConfigCtx {
  custom: Partial<Record<ShortcutId, string>>
  getKey: (id: ShortcutId) => string
  setKey: (id: ShortcutId, key: string) => ShortcutId | null
  resetKey: (id: ShortcutId) => void
  resetAll: () => void
}

const ShortcutConfigContext = createContext<ShortcutConfigCtx | null>(null)

export function ShortcutConfigProvider({ children }: { children: ReactNode }) {
  const scope = useElementEditorConfig() // a resolved config is a PersistScope (persistKey / persist)
  const [custom, setCustom] = useState<Partial<Record<ShortcutId, string>>>(() => {
    const loaded = loadCustomBindings(scope)
    syncShortcutCache(loaded)
    return loaded
  })

  const getKey = useCallback((id: ShortcutId) => getEffectiveKey(id, custom), [custom])

  const setKey = useCallback((id: ShortcutId, key: string): ShortcutId | null => {
    const conflict = findConflict(key, id, custom)
    if (conflict) return conflict
    const next = { ...custom, [id]: key }
    setCustom(next)
    saveCustomBindings(next, scope)
    syncShortcutCache(next)
    return null
  }, [custom, scope])

  const resetKey = useCallback((id: ShortcutId) => {
    const next = { ...custom }
    delete next[id]
    setCustom(next)
    saveCustomBindings(next, scope)
    syncShortcutCache(next)
  }, [custom, scope])

  const resetAll = useCallback(() => {
    setCustom({})
    saveCustomBindings({}, scope)
    syncShortcutCache({})
  }, [scope])

  return (
    <ShortcutConfigContext.Provider value={{ custom, getKey, setKey, resetKey, resetAll }}>
      {children}
    </ShortcutConfigContext.Provider>
  )
}

/** @internal This editor's bindings, or null outside a `ShortcutConfigProvider`. */
export function useOptionalShortcutConfig(): ShortcutConfigCtx | null {
  return useContext(ShortcutConfigContext)
}

export function useShortcutConfig(): ShortcutConfigCtx {
  const ctx = useContext(ShortcutConfigContext)
  if (!ctx) throw new Error('useShortcutConfig must be used inside ShortcutConfigProvider')
  return ctx
}
