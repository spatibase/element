import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsonCode } from '../../../../ui/src/components/ui/JsonCode'

const render = (v: unknown) => renderToStaticMarkup(<JsonCode json={JSON.stringify(v, null, 2)} />)

describe('JsonCode', () => {
  it('colours keys, strings, numbers, booleans and null distinctly', () => {
    const html = render({ name: 'a "q" b', n: -1.5e3, ok: true, none: null })
    expect(html).toContain('<span class="text-gray-800 dark:text-[#e06c75]">&quot;name&quot;</span>:')
    expect(html).toContain('text-[#a11] dark:text-[#98c379]">&quot;a \\&quot;q\\&quot; b&quot;</span>')
    expect(html).toContain('text-[#164] dark:text-[#d19a66]">-1500</span>')
    expect(html).toContain('text-[#219] dark:text-[#d19a66]">true</span>')
    expect(html).toContain('text-[#164] dark:text-[#d19a66]">null</span>')
  })
  it('keeps the text byte-for-byte', () => {
    const v = { geometry: { type: 'Point', coordinates: [2.7, 43.18] }, tags: ['x:y', ''] }
    const text = renderToStaticMarkup(<JsonCode json={JSON.stringify(v, null, 2)} />).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"')
    expect(text).toBe(JSON.stringify(v, null, 2))
  })
})
