import { describe, it, expect } from 'vitest'
import { accentPalette, mixOklab, parseColor, readAccentPalette } from '../../../../core/src/utils/accent'

describe('accent palette', () => {
  it('parses hex and rgb()', () => {
    expect(parseColor('#f80')).toEqual([255, 136, 0])
    expect(parseColor('#3b82f6')).toEqual([59, 130, 246])
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(parseColor('rgb(10 20 30 / 0.5)')).toEqual([10, 20, 30])
    expect(parseColor('nonsense')).toBeNull()
  })
  it('500 is the accent itself; the scale runs light → dark', () => {
    const p = accentPalette('#ea580c')
    expect(p[500]).toBe('#ea580c')
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
    for (let i = 1; i < shades.length; i++) expect(lum(p[shades[i]])).toBeLessThan(lum(p[shades[i - 1]]))
  })
  it('mixes in OKLab (endpoints exact, unknown input falls back to blue)', () => {
    expect(mixOklab([255, 255, 255], [0, 0, 0], 1)).toBe('#ffffff')
    expect(mixOklab([255, 255, 255], [0, 0, 0], 0)).toBe('#000000')
    expect(accentPalette('not-a-colour')[500]).toBe('#3b82f6')
  })
  it('readAccentPalette falls back to the JS scale when CSS resolves nothing (no DOM / jsdom)', () => {
    expect(readAccentPalette(null)).toEqual(accentPalette())
    const el = document.createElement('div')
    el.style.setProperty('--elm-accent', '#ea580c')
    document.body.appendChild(el)
    expect(readAccentPalette(el)).toEqual(accentPalette('#ea580c'))
    // one probe per element, reused across reads
    readAccentPalette(el)
    const probes = el.querySelectorAll('[data-elm-accent-probe]')
    expect(probes).toHaveLength(1)
    expect(probes[0].children).toHaveLength(11)
    expect((probes[0].children[5] as HTMLElement).style.color).toBe('var(--color-primary-500)')
    el.remove()
  })
})
