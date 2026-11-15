import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { accentStyle, useAccentStyle, useApplyAccentToRoot, RootCssVarsContext } from '../../../../ui/src/hooks/useAccentStyle'
import { ElementEditorConfigProvider, resolveConfig } from '../../../../ui/src/contexts/ElementEditorConfigContext'
import { RootTokensContext, readRootTokens } from '../../../../ui/src/hooks/useRootTokens'

describe('accentColor', () => {
  it('resolveConfig passes accentColor through, default undefined', () => {
    expect(resolveConfig().accentColor).toBeUndefined()
    expect(resolveConfig({ accentColor: '' }).accentColor).toBeUndefined()
    expect(resolveConfig({ accentColor: '#ea580c' }).accentColor).toBe('#ea580c')
  })

  it('accentStyle sets --elm-accent only when given', () => {
    expect(accentStyle(undefined)).toBeUndefined()
    expect(accentStyle('#ea580c')).toEqual({ '--elm-accent': '#ea580c' })
  })

  it('useApplyAccentToRoot writes onto the themed root, updates live, cleans up', () => {
    const root = document.createElement('div')
    root.setAttribute('data-elm-theme', 'light')
    const container = document.createElement('div')
    root.appendChild(container)
    // No provider above → no accent → nothing written.
    renderHook(() => useApplyAccentToRoot(container)).unmount()
    expect(root.style.getPropertyValue('--elm-accent')).toBe('')

    let accent: string | undefined = '#ea580c'
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <ElementEditorConfigProvider config={{ accentColor: accent }}>{children}</ElementEditorConfigProvider>
    )
    const hook = renderHook(() => useApplyAccentToRoot(container), { wrapper: Wrapper })
    expect(root.style.getPropertyValue('--elm-accent')).toBe('#ea580c')
    expect(container.style.getPropertyValue('--elm-accent')).toBe('')

    accent = 'rebeccapurple'
    hook.rerender()
    expect(root.style.getPropertyValue('--elm-accent')).toBe('rebeccapurple')

    accent = undefined
    hook.rerender()
    expect(root.style.getPropertyValue('--elm-accent')).toBe('')
    hook.unmount()
  })

  it('leaves a root value it did not write (e.g. <ElementEditor> style prop)', () => {
    const root = document.createElement('div')
    root.setAttribute('data-elm-theme', 'light')
    root.style.setProperty('--elm-accent', '#ea580c')
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <ElementEditorConfigProvider config={{ accentColor: '#ea580c' }}>{children}</ElementEditorConfigProvider>
    )
    const { unmount } = renderHook(() => useApplyAccentToRoot(root), { wrapper: Wrapper })
    unmount()
    expect(root.style.getPropertyValue('--elm-accent')).toBe('#ea580c')
  })

  it('useAccentStyle: portals get accentColor, then the root style\'s CSS variables (which win)', () => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <ElementEditorConfigProvider config={{ accentColor: '#ea580c' }}>
        <RootCssVarsContext.Provider value={{ '--elm-accent': '#7c3aed', '--elm-primary-50': '#faf5ff' } as CSSProperties}>
          {children}
        </RootCssVarsContext.Provider>
      </ElementEditorConfigProvider>
    )
    expect(renderHook(() => useAccentStyle(), { wrapper: Wrapper }).result.current)
      .toEqual({ '--elm-accent': '#7c3aed', '--elm-primary-50': '#faf5ff' })
    // Without root vars: accentColor only; without either: nothing.
    const ConfigOnly = ({ children }: { children: ReactNode }) => (
      <ElementEditorConfigProvider config={{ accentColor: '#ea580c' }}>{children}</ElementEditorConfigProvider>
    )
    expect(renderHook(() => useAccentStyle(), { wrapper: ConfigOnly }).result.current).toEqual({ '--elm-accent': '#ea580c' })
    expect(renderHook(() => useAccentStyle()).result.current).toBeUndefined()
  })

  it('useAccentStyle: the root\'s resolved design tokens sit between accentColor and the style vars', () => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <ElementEditorConfigProvider config={{ accentColor: '#ea580c' }}>
        <RootTokensContext.Provider value={{ '--elm-accent': '#0d9488', '--elm-surface': '#fdf8f0', '--elm-radius': '16px' } as CSSProperties}>
          <RootCssVarsContext.Provider value={{ '--elm-surface': '#ffffff' } as CSSProperties}>{children}</RootCssVarsContext.Provider>
        </RootTokensContext.Provider>
      </ElementEditorConfigProvider>
    )
    expect(renderHook(() => useAccentStyle(), { wrapper: Wrapper }).result.current)
      .toEqual({ '--elm-accent': '#0d9488', '--elm-surface': '#ffffff', '--elm-radius': '16px' })
  })

  it('readRootTokens returns only the tokens set on (or inherited by) the root', () => {
    const outer = document.createElement('div')
    outer.style.setProperty('--elm-text', '#3b2a1e')
    const root = document.createElement('div')
    root.setAttribute('data-elm-theme', 'light')
    root.style.setProperty('--elm-surface', '#fbf6ee')
    root.style.setProperty('--elm-panel-offset', '320px') // layout var: never copied
    outer.appendChild(root)
    document.body.appendChild(outer)
    expect(readRootTokens(root)).toEqual({ '--elm-surface': '#fbf6ee', '--elm-text': '#3b2a1e' })
    expect(readRootTokens(document.createElement('div'))).toBeUndefined()
    outer.remove()
  })
})
