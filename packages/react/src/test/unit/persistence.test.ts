import { describe, it, expect, beforeEach } from 'vitest'
import { scopedKey, readStorage, writeStorage, readPersisted, writePersisted } from '../../../../core/src/utils/persisted'
import { createDataStore } from '../../../../core/src/store/dataStore'
import { createUIStore } from '../../../../core/src/store/uiStore'
import { loadCustomBindings, saveCustomBindings } from '../../../../core/src/shortcuts'

describe('persistKey / persist', () => {
  beforeEach(() => localStorage.clear())

  it('namespaces elm_ keys and turns storage off with persist: false', () => {
    expect(scopedKey('elm_theme')).toBe('elm_theme')
    expect(scopedKey('elm_theme', { persistKey: 'a' })).toBe('elm_a_theme')
    expect(scopedKey('mine', { persistKey: 'a' })).toBe('a_mine')
    expect(scopedKey('elm_theme', { persistKey: 'a', persist: false })).toBeNull()
  })

  it('raw and versioned helpers read and write under the scoped key only', () => {
    writeStorage('elm_x', '1', { persistKey: 'a' })
    expect(localStorage.getItem('elm_a_x')).toBe('1')
    expect(localStorage.getItem('elm_x')).toBeNull()
    expect(readStorage('elm_x', { persistKey: 'b' })).toBeNull()

    writePersisted('elm_v', 1, { n: 2 }, { persistKey: 'a' })
    expect(readPersisted('elm_v', 1, undefined, { persistKey: 'a' })).toEqual({ n: 2 })
    expect(readPersisted('elm_v', 1)).toBeNull()
  })

  it('persist: false reads and writes nothing', () => {
    localStorage.setItem('elm_theme', 'dark')
    expect(readStorage('elm_theme', { persist: false })).toBeNull()
    writeStorage('elm_theme', 'light', { persist: false })
    writePersisted('elm_units', 1, {}, { persist: false })
    expect(localStorage.getItem('elm_theme')).toBe('dark')
    expect(localStorage.getItem('elm_units')).toBeNull()
  })

  it('two editors with different persistKeys keep separate store preferences', () => {
    const make = (persistKey: string) => {
      const data = createDataStore({ persist: { persistKey } })
      return { data, ui: createUIStore(data, { persist: { persistKey } }) }
    }
    const a = make('a')
    a.ui.getState().setUserTheme('dark')
    a.ui.getState().setShowMeasurements(true)
    a.data.getState().setLastUsedSchemaId('s1')
    const b = make('b')
    expect(b.ui.getState().userTheme).toBe('system')
    expect(b.ui.getState().showMeasurements).toBe(false)
    expect(b.data.getState().lastUsedSchemaId).toBeNull()
    expect(make('a').ui.getState().userTheme).toBe('dark')
    expect(localStorage.getItem('elm_theme')).toBeNull()
  })

  it('a store with persist: false ignores and leaves existing storage alone', () => {
    localStorage.setItem('elm_theme', 'dark')
    const data = createDataStore({ persist: { persist: false } })
    const ui = createUIStore(data, { persist: { persist: false } })
    expect(ui.getState().userTheme).toBe('system')
    ui.getState().setUserTheme('light')
    expect(localStorage.getItem('elm_theme')).toBe('dark')
  })

  it('shortcut bindings are scoped too', () => {
    saveCustomBindings({ 'draw-line': 'q' }, { persistKey: 'a' })
    expect(loadCustomBindings({ persistKey: 'a' })).toEqual({ 'draw-line': 'q' })
    expect(loadCustomBindings({ persistKey: 'b' })).toEqual({})
    expect(loadCustomBindings()).toEqual({})
  })
})
