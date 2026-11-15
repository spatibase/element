import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BasemapPicker } from '../../../../ui/src/components/BasemapPicker'
import { isContextMenuOpen } from '../../../../ui/src/components/ui/ContextMenu'

const options = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta', thumbnail: 'x.png' }]

describe('BasemapPicker', () => {
  it('opens, marks the active option, picks and stays open', () => {
    const onChange = vi.fn()
    render(<BasemapPicker options={options} value="a" onChange={onChange} />)
    const btn = screen.getByRole('button', { name: 'Basemap' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe(screen.getByRole('group', { name: 'Basemap' }).id)
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Beta' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.getByRole('group', { name: 'Basemap' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Basemap' }).textContent).not.toContain('Basemap')
  })

  it('ignores outside clicks; closes on the toggle and on Escape', () => {
    render(<BasemapPicker options={options} value="a" onChange={() => {}} />)
    const toggle = () => fireEvent.click(screen.getByRole('button', { name: 'Basemap' }))
    toggle(); fireEvent.pointerDown(document.body)
    expect(screen.getByRole('group', { name: 'Basemap' })).toBeTruthy()
    toggle()
    expect(screen.queryByRole('group', { name: 'Basemap' })).toBeNull()
    toggle(); fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Basemap' })).toBeNull()
  })

  it('focuses the active tile on open, arrows move between tiles, Escape returns focus', () => {
    render(<BasemapPicker options={options} value="b" onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Basemap' })
    fireEvent.click(btn)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Beta' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Alpha' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Basemap' })).toBeNull()
    expect(document.activeElement).toBe(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('owns Escape while open: a window capture listener registered earlier yields to it', () => {
    // Mirrors useKeyboardShortcuts' deselect handler, which yields to isContextMenuOpen().
    const deselect = vi.fn()
    const editorEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isContextMenuOpen()) deselect() }
    const later = vi.fn()
    window.addEventListener('keydown', editorEsc, { capture: true })
    try {
      render(<BasemapPicker options={options} value="a" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: 'Basemap' }))
      window.addEventListener('keydown', later)
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('group', { name: 'Basemap' })).toBeNull()
      expect(deselect).not.toHaveBeenCalled()
      expect(later).not.toHaveBeenCalled()
      // Closed: Escape goes back to the editor.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(deselect).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', editorEsc, { capture: true })
      window.removeEventListener('keydown', later)
    }
  })
})
